import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { normalizeTitle } from "./normalize.js";

const realizationId = getRequiredArg("--realization-id");
const dryRun = !process.argv.includes("--sync");

const config = getConfig();
const bitrixClient = new BitrixClient(config.bitrix);
const clocksterClient = new ClocksterClient(config.clockster);

const bitrixLocations = await bitrixClient.getActiveLocations();
const clocksterLocations = await clocksterClient.getLocations();

const bitrixMatches = bitrixLocations.filter(
  (location) => propertyValue(location.raw.PROPERTY_1013) === realizationId,
);
const clocksterMatches = clocksterLocations.filter(
  (location) => normalizeTitle(location.description) === realizationId,
);

if (bitrixMatches.length !== 1) {
  throw new Error(`Expected 1 Bitrix location for realization ${realizationId}, found ${bitrixMatches.length}`);
}

if (clocksterMatches.length !== 1) {
  throw new Error(`Expected 1 Clockster location for realization ${realizationId}, found ${clocksterMatches.length}`);
}

const bitrix = bitrixMatches[0];
const clockster = clocksterMatches[0];
const newTitle = bitrix.title;
const oldTitle = normalizeTitle(clockster.title);

const payload = {
  title: newTitle,
  description: realizationId,
  latitude: clockster.latitude ?? "",
  longitude: clockster.longitude ?? "",
  radius: clockster.radius ?? "",
};

console.log(`Mode: ${dryRun ? "dry-run" : "sync"}`);
console.log(`Realization ID: ${realizationId}`);
console.log(`Bitrix ID: ${bitrix.bitrixId}`);
console.log(`Clockster ID: ${clockster.id}`);
console.log(`Old title: ${oldTitle}`);
console.log(`New title: ${newTitle}`);
console.log(`Latitude: ${payload.latitude}`);
console.log(`Longitude: ${payload.longitude}`);
console.log(`Radius: ${payload.radius}`);

if (oldTitle === newTitle) {
  console.log("No rename needed.");
  process.exit(0);
}

if (dryRun) {
  console.log("Dry-run only. Nothing changed.");
  process.exit(0);
}

await updateClocksterLocation(clocksterClient, clockster.id, payload);
console.log("Renamed successfully.");

function propertyValue(property) {
  if (!property || typeof property !== "object") return "";
  return normalizeTitle(Object.values(property)[0] ?? "");
}

async function updateClocksterLocation(client, id, data) {
  const body = new URLSearchParams();
  body.set("title", data.title);
  body.set("description", data.description);
  if (data.latitude && data.longitude) {
    body.set("latitude", data.latitude);
    body.set("longitude", data.longitude);
  }
  if (data.radius) body.set("radius", data.radius);

  return client.request(`${client.config.apiBase}/locations/${id}`, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
}

function getRequiredArg(name) {
  const prefix = `${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
    if (arg === name && process.argv[index + 1]) return process.argv[index + 1].trim();
  }
  throw new Error(`Missing required argument: ${name}`);
}
