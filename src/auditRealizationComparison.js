import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { normalizeTitle } from "./normalize.js";

const config = getConfig();
const bitrixClient = new BitrixClient(config.bitrix);
const clocksterClient = new ClocksterClient(config.clockster);

const bitrixLocations = await bitrixClient.getActiveLocations();
const clocksterLocations = await clocksterClient.getLocations();

const bitrixByRealizationId = new Map();
const bitrixWithoutRealizationId = [];

for (const location of bitrixLocations) {
  const realizationId = propertyValue(location.raw.PROPERTY_1013);
  if (!realizationId) {
    bitrixWithoutRealizationId.push(toBitrixRow(location, ""));
    continue;
  }

  if (!bitrixByRealizationId.has(realizationId)) {
    bitrixByRealizationId.set(realizationId, []);
  }
  bitrixByRealizationId.get(realizationId).push(toBitrixRow(location, realizationId));
}

const clocksterByRealizationId = new Map();
const clocksterWithoutRealizationId = [];

for (const location of clocksterLocations) {
  const realizationId = extractRealizationId(location.description);
  const row = toClocksterRow(location, realizationId);

  if (!realizationId) {
    clocksterWithoutRealizationId.push(row);
    continue;
  }

  if (!clocksterByRealizationId.has(realizationId)) {
    clocksterByRealizationId.set(realizationId, []);
  }
  clocksterByRealizationId.get(realizationId).push(row);
}

const matched = [];
const bitrixMissingInClockster = [];
const clocksterNotInBitrix = [];
const duplicateBitrixRealizationIds = [];
const duplicateClocksterRealizationIds = [];

for (const [realizationId, bitrixRows] of bitrixByRealizationId.entries()) {
  if (bitrixRows.length > 1) {
    duplicateBitrixRealizationIds.push({ realizationId, count: bitrixRows.length, items: bitrixRows });
  }

  const clocksterRows = clocksterByRealizationId.get(realizationId) ?? [];
  if (!clocksterRows.length) {
    for (const bitrix of bitrixRows) {
      bitrixMissingInClockster.push(bitrix);
    }
    continue;
  }

  for (const bitrix of bitrixRows) {
    for (const clockster of clocksterRows) {
      matched.push({
        realizationId,
        bitrixId: bitrix.bitrixId,
        bitrixTitle: bitrix.bitrixTitle,
        cleanAddress: bitrix.cleanAddress,
        city: bitrix.city,
        clocksterId: clockster.clocksterId,
        clocksterTitle: clockster.clocksterTitle,
        titleEquals: normalizeTitle(bitrix.bitrixTitle) === normalizeTitle(clockster.clocksterTitle),
        hasCoordinates: Boolean(clockster.latitude && clockster.longitude),
        latitude: clockster.latitude,
        longitude: clockster.longitude,
        radius: clockster.radius,
        clocksterDescription: clockster.description,
      });
    }
  }
}

for (const [realizationId, clocksterRows] of clocksterByRealizationId.entries()) {
  if (clocksterRows.length > 1) {
    duplicateClocksterRealizationIds.push({ realizationId, count: clocksterRows.length, items: clocksterRows });
  }

  if (!bitrixByRealizationId.has(realizationId)) {
    clocksterNotInBitrix.push(...clocksterRows);
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  counts: {
    bitrixActive: bitrixLocations.length,
    bitrixWithRealizationId: bitrixLocations.length - bitrixWithoutRealizationId.length,
    bitrixWithoutRealizationId: bitrixWithoutRealizationId.length,
    clockster: clocksterLocations.length,
    clocksterWithRealizationId: clocksterLocations.length - clocksterWithoutRealizationId.length,
    clocksterWithoutRealizationId: clocksterWithoutRealizationId.length,
    matched: matched.length,
    matchedTitleDifferent: matched.filter((row) => !row.titleEquals).length,
    matchedWithoutCoordinates: matched.filter((row) => !row.hasCoordinates).length,
    bitrixMissingInClockster: bitrixMissingInClockster.length,
    clocksterNotInBitrix: clocksterNotInBitrix.length,
    duplicateBitrixRealizationIds: duplicateBitrixRealizationIds.length,
    duplicateClocksterRealizationIds: duplicateClocksterRealizationIds.length,
  },
};

const report = {
  summary,
  matched,
  bitrixMissingInClockster,
  clocksterNotInBitrix,
  bitrixWithoutRealizationId,
  clocksterWithoutRealizationId,
  duplicateBitrixRealizationIds,
  duplicateClocksterRealizationIds,
};

mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = resolve(process.cwd(), "logs", `realization-comparison-${stamp}.json`);
const matchedCsvPath = resolve(process.cwd(), "logs", `realization-matched-${stamp}.csv`);
const renameCsvPath = resolve(process.cwd(), "logs", `realization-rename-needed-${stamp}.csv`);
const missingCsvPath = resolve(process.cwd(), "logs", `realization-missing-in-clockster-${stamp}.csv`);
const extraCsvPath = resolve(process.cwd(), "logs", `realization-clockster-not-in-bitrix-${stamp}.csv`);

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(matchedCsvPath, toCsv(matched));
writeFileSync(renameCsvPath, toCsv(matched.filter((row) => !row.titleEquals)));
writeFileSync(missingCsvPath, toCsv(bitrixMissingInClockster));
writeFileSync(extraCsvPath, toCsv(clocksterNotInBitrix));

console.log(`Bitrix active locations: ${summary.counts.bitrixActive}`);
console.log(`Bitrix with realization ID: ${summary.counts.bitrixWithRealizationId}`);
console.log(`Clockster locations: ${summary.counts.clockster}`);
console.log(`Clockster with realization ID in description: ${summary.counts.clocksterWithRealizationId}`);
console.log(`Matched by realization ID: ${summary.counts.matched}`);
console.log(`Matched but title differs: ${summary.counts.matchedTitleDifferent}`);
console.log(`Matched without coordinates: ${summary.counts.matchedWithoutCoordinates}`);
console.log(`Bitrix missing in Clockster: ${summary.counts.bitrixMissingInClockster}`);
console.log(`Clockster realization IDs not in active Bitrix: ${summary.counts.clocksterNotInBitrix}`);
console.log(`JSON: ${jsonPath}`);
console.log(`Matched CSV: ${matchedCsvPath}`);
console.log(`Rename-needed CSV: ${renameCsvPath}`);
console.log(`Missing CSV: ${missingCsvPath}`);
console.log(`Extra CSV: ${extraCsvPath}`);

function propertyValue(property) {
  if (!property || typeof property !== "object") return "";
  return normalizeTitle(Object.values(property)[0] ?? "");
}

function extractRealizationId(description) {
  const text = normalizeTitle(description);
  if (!text) return "";

  const bitrixMatch = text.match(/\bbitrix:(\d+)\b/i);
  if (bitrixMatch) return "";

  const numericMatches = [...text.matchAll(/\b\d{4,}\b/g)].map((match) => match[0]);
  if (numericMatches.length !== 1) return "";
  return numericMatches[0];
}

function toBitrixRow(location, realizationId) {
  return {
    realizationId,
    bitrixId: location.bitrixId,
    bitrixTitle: location.title,
    cleanAddress: propertyValue(location.raw.PROPERTY_839),
    city: propertyValue(location.raw.PROPERTY_959),
  };
}

function toClocksterRow(location, realizationId) {
  return {
    realizationId,
    clocksterId: location.id,
    clocksterTitle: normalizeTitle(location.title),
    description: normalizeTitle(location.description),
    latitude: location.latitude ?? "",
    longitude: location.longitude ?? "",
    radius: location.radius ?? "",
  };
}

function toCsv(items) {
  if (!items.length) return "";
  const headers = Object.keys(items[0]);
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
