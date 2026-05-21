import { normalizeForCompare, normalizeTitle } from "./normalize.js";

export function extractRealizationId(description) {
  const text = normalizeTitle(description);
  if (!text) return "";
  if (/\bbitrix:\d+\b/i.test(text)) return "";

  const numericMatches = [...text.matchAll(/\b\d{4,}\b/g)].map((match) => match[0]);
  if (numericMatches.length !== 1) return "";
  return numericMatches[0];
}

export function indexClocksterLocations(locations) {
  const byRealizationId = new Map();
  const byExactTitle = new Map();

  for (const location of locations) {
    const realizationId = extractRealizationId(location.description);
    if (realizationId) addToMapArray(byRealizationId, realizationId, location);
    addToMapArray(byExactTitle, normalizeForCompare(location.title), location);
  }

  return { byRealizationId, byExactTitle };
}

export function findFuzzyCandidates(title, locations, { minScore = 0.78, limit = 5 } = {}) {
  const preparedTitle = prepare(title);
  return locations
    .map((location) => ({
      clocksterId: location.id,
      clocksterTitle: normalizeTitle(location.title),
      description: normalizeTitle(location.description),
      latitude: location.latitude ?? "",
      longitude: location.longitude ?? "",
      radius: location.radius ?? "",
      score: similarity(preparedTitle, prepare(location.title)),
    }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate) => ({
      ...candidate,
      score: Number(candidate.score.toFixed(4)),
    }));
}

function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function prepare(value) {
  return {
    tokens: tokenSet(value),
    bigrams: bigramSet(value),
  };
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

function similarity(left, right) {
  return overlapScore(left.tokens, right.tokens) * 0.65 + diceScore(left.bigrams, right.bigrams) * 0.35;
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
