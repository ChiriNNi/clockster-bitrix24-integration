import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BitrixDealClient } from "./bitrixDealClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { GeocoderClient } from "./geocoderClient.js";
import { getConfig } from "./config.js";
import { findFuzzyCandidates, indexClocksterLocations } from "./matchUtils.js";
import { normalizeForCompare, normalizeTitle } from "./normalize.js";
import { buildGeocodeQueryFromDealTitle } from "./titleParser.js";

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--sync");
const createEnabled = args.has("--create") || process.env.DEAL_SYNC_CREATE_ENABLED === "true";
const limit = Number(getArg("--limit", "0"));
const onlyDealId = getArg("--deal-id", "");

const config = getConfig();
const dealClient = new BitrixDealClient(config.bitrix, config.deals);
const clocksterClient = new ClocksterClient(config.clockster);
const geocoderClient = new GeocoderClient(config.geocoder);

const deals = (await dealClient.getDeals())
  .filter((deal) => !onlyDealId || deal.dealId === onlyDealId);
const clocksterLocations = await clocksterClient.getLocations();
const { byRealizationId, byExactTitle } = indexClocksterLocations(clocksterLocations);

const report = {
  generatedAt: new Date().toISOString(),
  mode: dryRun ? "dry-run" : "sync",
  options: {
    createEnabled,
    onlyDealId,
    geocoderProvider: config.geocoder.provider,
    geocoderEnabled: geocoderClient.isEnabled(),
  },
  counts: {},
  actions: [],
  updated: [],
  linked: [],
  created: [],
  review: [],
  skipped: [],
  errors: [],
};

for (const deal of deals) {
  const action = await planDealAction(deal);
  report.actions.push(action);
}

const executableActions = report.actions.filter((action) =>
  ["update_existing_title", "link_exact_title", "create_location"].includes(action.action),
);
const workItems = limit > 0 ? executableActions.slice(0, limit) : executableActions;

if (!dryRun) {
  for (const action of workItems) {
    try {
      if (action.action === "update_existing_title") {
        await clocksterClient.updateLocationFromPayload(action.clocksterId, action.payload);
        report.updated.push(action);
      } else if (action.action === "link_exact_title") {
        await clocksterClient.updateLocationFromPayload(action.clocksterId, action.payload);
        report.linked.push(action);
      } else if (action.action === "create_location") {
        if (!createEnabled) {
          report.skipped.push({ ...action, reason: "create_disabled" });
          continue;
        }
        const response = await clocksterClient.createLocationFromPayload(action.payload);
        report.created.push({ ...action, createdClocksterId: response.data?.id ?? null });
      }

      console.log(`${action.action}: deal ${action.dealId}`);
      await pause(750);
    } catch (error) {
      report.errors.push({ ...action, message: error.message });
      console.error(`Failed ${action.action} deal ${action.dealId}: ${error.message}`);
      break;
    }
  }
}

finalizeReport();

function finalizeReport() {
  const actionCounts = report.actions.reduce((acc, action) => {
    acc[action.action] = (acc[action.action] ?? 0) + 1;
    return acc;
  }, {});

  report.counts = {
    deals: deals.length,
    clocksterLocations: clocksterLocations.length,
    executable: executableActions.length,
    updated: report.updated.length,
    linked: report.linked.length,
    created: report.created.length,
    skipped: report.skipped.length,
    errors: report.errors.length,
    ...actionCounts,
  };

  mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = resolve(process.cwd(), "logs", `deal-sync-${stamp}.json`);
  const csvPath = resolve(process.cwd(), "logs", `deal-sync-${stamp}.csv`);
  const htmlPath = resolve(process.cwd(), "logs", `deal-sync-${stamp}.html`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(csvPath, toCsv(report.actions));
  writeFileSync(htmlPath, toHtml(report));

  console.log(`Mode: ${report.mode}`);
  console.log(`Deals: ${report.counts.deals}`);
  console.log(`Clockster locations: ${report.counts.clocksterLocations}`);
  for (const [key, value] of Object.entries(actionCounts).sort()) console.log(`${key}: ${value}`);
  console.log(`Updated: ${report.updated.length}`);
  console.log(`Linked: ${report.linked.length}`);
  console.log(`Created: ${report.created.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Errors: ${report.errors.length}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`HTML: ${htmlPath}`);
}

async function planDealAction(deal) {
  const title = normalizeTitle(deal.title);
  const base = {
    dealId: deal.dealId,
    dealTitle: title,
    stageId: deal.raw.STAGE_ID ?? "",
  };

  if (!title || title.length < 2) return { ...base, action: "skip_invalid_title", reason: "empty_or_short_title" };
  if (title.length > config.clockster.titleMax) {
    return { ...base, action: "skip_invalid_title", reason: `title_longer_than_${config.clockster.titleMax}` };
  }

  const linkedMatches = byRealizationId.get(deal.dealId) ?? [];
  if (linkedMatches.length > 1) {
    return {
      ...base,
      action: "review_duplicate_clockster_description",
      candidates: linkedMatches.map(toCandidate),
    };
  }

  if (linkedMatches.length === 1) {
    const location = linkedMatches[0];
    const oldTitle = normalizeTitle(location.title);
    if (normalizeForCompare(oldTitle) === normalizeForCompare(title)) {
      return { ...base, action: "ok_existing_link", clocksterId: location.id };
    }

    return {
      ...base,
      action: "update_existing_title",
      clocksterId: location.id,
      oldTitle,
      newTitle: title,
      payload: payloadFromLocation(location, title, deal.dealId),
    };
  }

  const exactMatches = (byExactTitle.get(normalizeForCompare(title)) ?? [])
    .filter((location) => !byRealizationId.has(deal.dealId) && !normalizeTitle(location.description));
  if (exactMatches.length === 1) {
    const location = exactMatches[0];
    return {
      ...base,
      action: "link_exact_title",
      clocksterId: location.id,
      payload: payloadFromLocation(location, title, deal.dealId),
    };
  }
  if (exactMatches.length > 1) {
    return {
      ...base,
      action: "review_multiple_exact_title_matches",
      candidates: exactMatches.map(toCandidate),
    };
  }

  const fuzzyCandidates = findFuzzyCandidates(title, clocksterLocations, { minScore: 0.82, limit: 5 });
  if (fuzzyCandidates.length) {
    return {
      ...base,
      action: "review_possible_existing_location",
      candidates: fuzzyCandidates,
    };
  }

  const geocodeQuery = buildGeocodeQueryFromDealTitle(title, config.geocoder.countrySuffix);
  const geocode = await geocoderClient.geocode(geocodeQuery);
  if (geocode.status !== "ok") {
    return {
      ...base,
      action: "needs_geocode_review",
      geocodeQuery,
      geocode,
    };
  }

  return {
    ...base,
    action: "create_location",
    geocodeQuery,
    geocode,
    payload: {
      title,
      description: deal.dealId,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      radius: config.clockster.defaultRadius,
    },
  };
}

function payloadFromLocation(location, title, dealId) {
  return {
    title,
    description: dealId,
    latitude: location.latitude ?? "",
    longitude: location.longitude ?? "",
    radius: location.radius ?? config.clockster.defaultRadius,
  };
}

function toCandidate(location) {
  return {
    clocksterId: location.id,
    clocksterTitle: normalizeTitle(location.title),
    description: normalizeTitle(location.description),
    latitude: location.latitude ?? "",
    longitude: location.longitude ?? "",
    radius: location.radius ?? "",
  };
}

function getArg(name, fallback) {
  const prefix = `${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
    if (arg === name && process.argv[index + 1]) return process.argv[index + 1].trim();
  }
  return fallback;
}

function toCsv(items) {
  const headers = ["dealId", "action", "dealTitle", "clocksterId", "oldTitle", "newTitle", "geocodeQuery", "reason"];
  const lines = [headers.join(",")];
  for (const item of items) {
    lines.push(headers.map((header) => csvEscape(item[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toHtml(data) {
  const rows = data.actions
    .map((action) => `<tr>${[
      action.action,
      action.dealId,
      action.dealTitle,
      action.clocksterId ?? "",
      action.oldTitle ?? "",
      action.newTitle ?? "",
      action.geocodeQuery ?? "",
      action.geocode?.status ?? "",
      action.candidates?.length ? JSON.stringify(action.candidates) : "",
      action.reason ?? "",
    ].map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Deal location sync dry-run</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1 { font-size: 22px; }
    pre { background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th { position: sticky; top: 0; background: #eef2ff; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    tr:nth-child(even) { background: #f9fafb; }
  </style>
</head>
<body>
  <h1>Deal location sync</h1>
  <pre>${escapeHtml(JSON.stringify(data.counts, null, 2))}</pre>
  <table>
    <thead>
      <tr>
        <th>action</th><th>dealId</th><th>dealTitle</th><th>clocksterId</th><th>oldTitle</th>
        <th>newTitle</th><th>geocodeQuery</th><th>geocodeStatus</th><th>candidates</th><th>reason</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
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

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
