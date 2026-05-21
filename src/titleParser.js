import { normalizeTitle } from "./normalize.js";

export function buildGeocodeQueryFromDealTitle(title, countrySuffix = "Казахстан") {
  const normalized = normalizeTitle(title);
  const cityAddress = extractCityAndAddress(normalized);
  const query = cityAddress
    ? `${cityAddress.city}, ${cityAddress.address}`
    : normalized;

  return appendCountry(query, countrySuffix);
}

export function extractCityAndAddress(title) {
  const normalized = normalizeTitle(title);
  const patterns = [
    /(?:^|[\s,])г\.?\s*([^,]+),\s*(.+)$/i,
    /(?:^|[\s,])город\s+([^,]+),\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const city = normalizeTitle(match[1]);
    const address = normalizeTitle(match[2]);
    if (city && address) return { city, address };
  }

  return null;
}

function appendCountry(query, countrySuffix) {
  const normalizedQuery = normalizeTitle(query);
  const normalizedCountry = normalizeTitle(countrySuffix);
  if (!normalizedCountry) return normalizedQuery;
  if (normalizedQuery.toLocaleLowerCase("ru-KZ").includes(normalizedCountry.toLocaleLowerCase("ru-KZ"))) {
    return normalizedQuery;
  }
  return `${normalizedQuery}, ${normalizedCountry}`;
}
