export function normalizeTitle(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForCompare(value) {
  return normalizeTitle(value).toLocaleLowerCase("ru-KZ");
}

export function bitrixMarker(bitrixId) {
  return `bitrix:${bitrixId}`;
}

export function getClocksterBitrixId(location) {
  const description = String(location?.description ?? "");
  const match = description.match(/\bbitrix:(\d+)\b/i);
  return match?.[1] ?? null;
}
