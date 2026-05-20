import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { getClocksterBitrixId, normalizeForCompare, normalizeTitle } from "./normalize.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MIN_SCORE = Number(process.env.AUDIT_MIN_SCORE ?? "0.45");
const TOP_MATCHES = Number(process.env.AUDIT_TOP_MATCHES ?? "3");

const config = getConfig();
const bitrixClient = new BitrixClient(config.bitrix);
const clocksterClient = new ClocksterClient(config.clockster);

const bitrixLocations = await bitrixClient.getActiveLocations();
const clocksterLocations = await clocksterClient.getLocations();

const clocksterPrepared = clocksterLocations.map((location) => {
  const title = normalizeTitle(location.title);
  return {
    id: location.id,
    title,
    latitude: location.latitude ?? "",
    longitude: location.longitude ?? "",
    radius: location.radius ?? "",
    description: location.description ?? "",
    bitrixId: getClocksterBitrixId(location),
    normalizedTitle: normalizeForCompare(title),
    tokens: tokenSet(title),
    bigrams: bigramSet(title),
  };
});

const byMarker = new Map(
  clocksterPrepared
    .filter((location) => location.bitrixId)
    .map((location) => [location.bitrixId, location]),
);
const byExactTitle = new Map(
  clocksterPrepared.map((location) => [location.normalizedTitle, location]),
);

const rows = [];
for (const bitrix of bitrixLocations) {
  const cleanAddress = propertyValue(bitrix.raw.PROPERTY_839);
  const city = propertyValue(bitrix.raw.PROPERTY_959);
  const searchText = normalizeTitle([bitrix.title, cleanAddress, city].filter(Boolean).join(" "));
  const preparedBitrix = {
    normalizedTitle: normalizeForCompare(bitrix.title),
    tokens: tokenSet(searchText),
    bigrams: bigramSet(searchText),
  };

  const markerMatch = byMarker.get(bitrix.bitrixId);
  const exactMatch = byExactTitle.get(preparedBitrix.normalizedTitle);
  const candidates = [];

  if (markerMatch) {
    candidates.push(toCandidate(markerMatch, "bitrix_marker", 1));
  }
  if (exactMatch && exactMatch.id !== markerMatch?.id) {
    candidates.push(toCandidate(exactMatch, "exact_title", 1));
  }

  for (const clockster of clocksterPrepared) {
    if (clockster.id === markerMatch?.id || clockster.id === exactMatch?.id) continue;
    const score = similarity(preparedBitrix, clockster);
    if (score >= MIN_SCORE) {
      candidates.push(toCandidate(clockster, "fuzzy", score));
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const uniqueCandidates = dedupeCandidates(candidates).slice(0, TOP_MATCHES);
  const best = uniqueCandidates[0] ?? null;

  rows.push({
    bitrixId: bitrix.bitrixId,
    bitrixTitle: bitrix.title,
    cleanAddress,
    city,
    bestMatchType: best?.matchType ?? "no_match",
    bestScore: best?.score ?? 0,
    bestClocksterId: best?.clocksterId ?? "",
    bestClocksterTitle: best?.clocksterTitle ?? "",
    bestLatitude: best?.latitude ?? "",
    bestLongitude: best?.longitude ?? "",
    bestRadius: best?.radius ?? "",
    topMatches: uniqueCandidates,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  thresholds: {
    minScore: MIN_SCORE,
    topMatches: TOP_MATCHES,
  },
  counts: {
    bitrixActive: bitrixLocations.length,
    clockster: clocksterLocations.length,
    markerMatches: rows.filter((row) => row.bestMatchType === "bitrix_marker").length,
    exactTitleMatches: rows.filter((row) => row.bestMatchType === "exact_title").length,
    fuzzyMatches: rows.filter((row) => row.bestMatchType === "fuzzy").length,
    noMatches: rows.filter((row) => row.bestMatchType === "no_match").length,
    withCoordinates: rows.filter((row) => row.bestLatitude && row.bestLongitude).length,
  },
};

const report = {
  summary,
  rows,
};

mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = resolve(process.cwd(), "logs", `comparison-${stamp}.json`);
const csvPath = resolve(process.cwd(), "logs", `comparison-${stamp}.csv`);

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(csvPath, toCsv(rows));

console.log(`Bitrix active locations: ${summary.counts.bitrixActive}`);
console.log(`Clockster locations: ${summary.counts.clockster}`);
console.log(`Marker matches: ${summary.counts.markerMatches}`);
console.log(`Exact title matches: ${summary.counts.exactTitleMatches}`);
console.log(`Fuzzy matches: ${summary.counts.fuzzyMatches}`);
console.log(`No matches: ${summary.counts.noMatches}`);
console.log(`Matches with coordinates: ${summary.counts.withCoordinates}`);
console.log(`JSON: ${jsonPath}`);
console.log(`CSV: ${csvPath}`);

function propertyValue(property) {
  if (!property || typeof property !== "object") return "";
  return normalizeTitle(Object.values(property)[0] ?? "");
}

function toCandidate(location, matchType, score) {
  return {
    matchType,
    score: Number(score.toFixed(4)),
    clocksterId: location.id,
    clocksterTitle: location.title,
    latitude: location.latitude,
    longitude: location.longitude,
    radius: location.radius,
    description: location.description,
  };
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.clocksterId)) continue;
    seen.add(candidate.clocksterId);
    result.push(candidate);
  }
  return result;
}

function tokenSet(value) {
  return new Set(
    normalizeForCompare(value)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function bigramSet(value) {
  const compact = normalizeForCompare(value).replace(/\s+/g, " ");
  const result = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

function similarity(bitrix, clockster) {
  const tokenScore = overlapScore(bitrix.tokens, clockster.tokens);
  const bigramScore = diceScore(bitrix.bigrams, clockster.bigrams);
  return tokenScore * 0.65 + bigramScore * 0.35;
}

function overlapScore(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.min(left.size, right.size);
}

function diceScore(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function toCsv(items) {
  const headers = [
    "bitrix_id",
    "bitrix_title",
    "clean_address",
    "city",
    "best_match_type",
    "best_score",
    "clockster_id",
    "clockster_title",
    "latitude",
    "longitude",
    "radius",
    "top_matches",
  ];

  const lines = [headers.join(",")];
  for (const item of items) {
    lines.push(
      [
        item.bitrixId,
        item.bitrixTitle,
        item.cleanAddress,
        item.city,
        item.bestMatchType,
        item.bestScore,
        item.bestClocksterId,
        item.bestClocksterTitle,
        item.bestLatitude,
        item.bestLongitude,
        item.bestRadius,
        item.topMatches
          .map((match) => `${match.matchType}:${match.score}:${match.clocksterId}:${match.clocksterTitle}`)
          .join(" | "),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
