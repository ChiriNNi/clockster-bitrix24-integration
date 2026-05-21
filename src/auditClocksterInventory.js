import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { normalizeForCompare, normalizeTitle } from "./normalize.js";

const config = getConfig();
const bitrixClient = new BitrixClient(config.bitrix);
const clocksterClient = new ClocksterClient(config.clockster);

const bitrixLocations = await bitrixClient.getActiveLocations();
const clocksterLocations = await clocksterClient.getLocations();

const activeRealizationIds = new Set();
const activeBitrixTitles = new Set();

for (const location of bitrixLocations) {
  const realizationId = propertyValue(location.raw.PROPERTY_1013);
  if (realizationId) activeRealizationIds.add(realizationId);
  activeBitrixTitles.add(normalizeForCompare(location.title));
}

const rows = clocksterLocations.map((location) => {
  const title = normalizeTitle(location.title);
  const description = normalizeTitle(location.description);
  const realizationId = extractRealizationId(description);
  const category = categorize({
    title,
    realizationId,
    activeRealizationIds,
    activeBitrixTitles,
  });

  return {
    category,
    clocksterId: location.id,
    clocksterTitle: title,
    description,
    realizationId,
    inActiveBitrixByRealizationId: realizationId ? activeRealizationIds.has(realizationId) : false,
    exactTitleInActiveBitrix: activeBitrixTitles.has(normalizeForCompare(title)),
    hasCoordinates: Boolean(location.latitude && location.longitude),
    latitude: location.latitude ?? "",
    longitude: location.longitude ?? "",
    radius: location.radius ?? "",
  };
});

const categoryCounts = rows.reduce((acc, row) => {
  acc[row.category] = (acc[row.category] ?? 0) + 1;
  return acc;
}, {});

const summary = {
  generatedAt: new Date().toISOString(),
  counts: {
    bitrixActive: bitrixLocations.length,
    clockster: clocksterLocations.length,
    ...categoryCounts,
    withCoordinates: rows.filter((row) => row.hasCoordinates).length,
    withoutCoordinates: rows.filter((row) => !row.hasCoordinates).length,
  },
};

mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = resolve(process.cwd(), "logs", `clockster-inventory-${stamp}.json`);
const csvPath = resolve(process.cwd(), "logs", `clockster-inventory-${stamp}.csv`);
const htmlPath = resolve(process.cwd(), "logs", `clockster-inventory-${stamp}.html`);

writeFileSync(jsonPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
writeFileSync(csvPath, toCsv(rows));
writeFileSync(htmlPath, toHtml(summary, rows));

console.log(`Bitrix active locations: ${summary.counts.bitrixActive}`);
console.log(`Clockster locations: ${summary.counts.clockster}`);
for (const [category, count] of Object.entries(categoryCounts).sort()) {
  console.log(`${category}: ${count}`);
}
console.log(`With coordinates: ${summary.counts.withCoordinates}`);
console.log(`Without coordinates: ${summary.counts.withoutCoordinates}`);
console.log(`JSON: ${jsonPath}`);
console.log(`CSV: ${csvPath}`);
console.log(`HTML: ${htmlPath}`);

function categorize({ title, realizationId, activeRealizationIds, activeBitrixTitles }) {
  if (realizationId && activeRealizationIds.has(realizationId)) {
    return "active_bitrix_linked_by_realization_id";
  }
  if (realizationId) {
    return "realization_id_not_in_active_bitrix";
  }
  if (/^bitrix:\d+$/i.test(normalizeTitle(title))) {
    return "test_or_old_bitrix_marker_title";
  }
  if (activeBitrixTitles.has(normalizeForCompare(title))) {
    return "exact_title_in_active_bitrix_without_realization_id";
  }
  return "no_realization_id_not_exact_active_bitrix";
}

function propertyValue(property) {
  if (!property || typeof property !== "object") return "";
  return normalizeTitle(Object.values(property)[0] ?? "");
}

function extractRealizationId(description) {
  const text = normalizeTitle(description);
  if (!text) return "";
  if (/\bbitrix:\d+\b/i.test(text)) return "";

  const numericMatches = [...text.matchAll(/\b\d{4,}\b/g)].map((match) => match[0]);
  if (numericMatches.length !== 1) return "";
  return numericMatches[0];
}

function toCsv(items) {
  const headers = Object.keys(items[0] ?? {});
  if (!headers.length) return "";
  return `${[
    headers.join(","),
    ...items.map((item) => headers.map((header) => csvEscape(item[header])).join(",")),
  ].join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toHtml(summary, items) {
  const rowsHtml = items
    .map(
      (row) => `<tr>${[
        row.category,
        row.clocksterId,
        row.clocksterTitle,
        row.description,
        row.realizationId,
        row.inActiveBitrixByRealizationId,
        row.exactTitleInActiveBitrix,
        row.hasCoordinates,
        row.latitude,
        row.longitude,
      ]
        .map((value) => `<td>${escapeHtml(value)}</td>`)
        .join("")}</tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Clockster inventory</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1 { font-size: 22px; }
    pre { background: #f3f4f6; padding: 12px; border-radius: 8px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th { position: sticky; top: 0; background: #eef2ff; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    tr:nth-child(even) { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>Clockster inventory</h1>
  <pre>${escapeHtml(JSON.stringify(summary.counts, null, 2))}</pre>
  <table>
    <thead>
      <tr>
        <th>category</th><th>clocksterId</th><th>clocksterTitle</th><th>description</th><th>realizationId</th>
        <th>inActiveBitrixByRealizationId</th><th>exactTitleInActiveBitrix</th><th>hasCoordinates</th>
        <th>latitude</th><th>longitude</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
