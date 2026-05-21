import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { normalizeTitle } from "./normalize.js";

const dryRun = !process.argv.includes("--sync");
const limit = Number(getOptionalArg("--limit", "0"));

const config = getConfig();
const bitrixClient = new BitrixClient(config.bitrix);
const clocksterClient = new ClocksterClient(config.clockster);

const bitrixLocations = await bitrixClient.getActiveLocations();
const clocksterLocations = await clocksterClient.getLocations();

const bitrixByRealizationId = new Map();
for (const location of bitrixLocations) {
  const realizationId = propertyValue(location.raw.PROPERTY_1013);
  if (!realizationId) continue;

  if (!bitrixByRealizationId.has(realizationId)) {
    bitrixByRealizationId.set(realizationId, []);
  }
  bitrixByRealizationId.get(realizationId).push(location);
}

const clocksterByRealizationId = new Map();
for (const location of clocksterLocations) {
  const realizationId = extractRealizationId(location.description);
  if (!realizationId) continue;

  if (!clocksterByRealizationId.has(realizationId)) {
    clocksterByRealizationId.set(realizationId, []);
  }
  clocksterByRealizationId.get(realizationId).push(location);
}

const planned = [];
const skipped = [];
const updated = [];
const errors = [];

for (const [realizationId, bitrixMatches] of bitrixByRealizationId.entries()) {
  const clocksterMatches = clocksterByRealizationId.get(realizationId) ?? [];

  if (bitrixMatches.length !== 1 || clocksterMatches.length !== 1) {
    if (clocksterMatches.length) {
      skipped.push({
        realizationId,
        reason: "non_unique_match",
        bitrixCount: bitrixMatches.length,
        clocksterCount: clocksterMatches.length,
      });
    }
    continue;
  }

  const bitrix = bitrixMatches[0];
  const clockster = clocksterMatches[0];
  const oldTitle = normalizeTitle(clockster.title);
  const newTitle = normalizeTitle(bitrix.title);

  if (oldTitle === newTitle) continue;

  planned.push({
    realizationId,
    bitrixId: bitrix.bitrixId,
    clocksterId: clockster.id,
    oldTitle,
    newTitle,
    latitude: clockster.latitude ?? "",
    longitude: clockster.longitude ?? "",
    radius: clockster.radius ?? "",
  });
}

const workItems = limit > 0 ? planned.slice(0, limit) : planned;

console.log(`Mode: ${dryRun ? "dry-run" : "sync"}`);
console.log(`Planned renames: ${planned.length}`);
if (limit > 0) console.log(`Limit: ${limit}`);

if (!dryRun) {
  for (const item of workItems) {
    try {
      await updateClocksterLocation(clocksterClient, item);
      updated.push(item);
      console.log(`Renamed ${updated.length}/${workItems.length}: ${item.clocksterId} realization ${item.realizationId}`);
      await pause(750);
    } catch (error) {
      errors.push({ ...item, message: error.message });
      console.error(`Failed ${item.clocksterId} realization ${item.realizationId}: ${error.message}`);
      break;
    }
  }
} else {
  console.log("Dry-run only. Nothing changed.");
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: dryRun ? "dry-run" : "sync",
  counts: {
    bitrixActive: bitrixLocations.length,
    clockster: clocksterLocations.length,
    planned: planned.length,
    attempted: dryRun ? 0 : workItems.length,
    updated: updated.length,
    skipped: skipped.length,
    errors: errors.length,
  },
  planned,
  updated,
  skipped,
  errors,
};

mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(process.cwd(), "logs", `rename-all-realization-${stamp}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Updated: ${updated.length}`);
console.log(`Skipped: ${skipped.length}`);
console.log(`Errors: ${errors.length}`);
console.log(`Report: ${reportPath}`);

process.exit(errors.length ? 1 : 0);

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

async function updateClocksterLocation(client, item) {
  const body = new URLSearchParams();
  body.set("title", item.newTitle);
  body.set("description", item.realizationId);
  if (item.latitude && item.longitude) {
    body.set("latitude", item.latitude);
    body.set("longitude", item.longitude);
  }
  if (item.radius) body.set("radius", item.radius);

  return client.request(`${client.config.apiBase}/locations/${item.clocksterId}`, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

function getOptionalArg(name, fallback) {
  const prefix = `${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
    if (arg === name && process.argv[index + 1]) return process.argv[index + 1].trim();
  }
  return fallback;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
