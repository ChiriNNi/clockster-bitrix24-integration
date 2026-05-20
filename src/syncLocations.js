import {
  bitrixMarker,
  getClocksterBitrixId,
  normalizeForCompare,
} from "./normalize.js";

export async function syncLocations({
  bitrixClient,
  clocksterClient,
  mappingStore,
  dryRun,
  titleMax,
  onlyBitrixIds = [],
}) {
  const allBitrixLocations = await bitrixClient.getActiveLocations();
  const onlySet = new Set(onlyBitrixIds.map(String));
  const bitrixLocations = onlySet.size
    ? allBitrixLocations.filter((location) => onlySet.has(location.bitrixId))
    : allBitrixLocations;
  const validBitrixLocations = [];
  const skipped = [];

  for (const location of bitrixLocations) {
    if (location.title.length < 2) {
      skipped.push({ bitrixId: location.bitrixId, title: location.title, reason: "title_too_short" });
      continue;
    }
    if (location.title.length > titleMax) {
      skipped.push({
        bitrixId: location.bitrixId,
        title: location.title,
        reason: `title_longer_than_${titleMax}`,
      });
      continue;
    }
    validBitrixLocations.push(location);
  }

  const clocksterLocations = await clocksterClient.getLocations();
  const byId = new Map(clocksterLocations.map((location) => [Number(location.id), location]));
  const byBitrixId = new Map();
  const byTitle = new Map();

  for (const location of clocksterLocations) {
    const markerId = getClocksterBitrixId(location);
    if (markerId) byBitrixId.set(markerId, location);
    byTitle.set(normalizeForCompare(location.title), location);
  }

  const created = [];
  const updated = [];
  const errors = [];
  const matchedClocksterIds = new Set();

  for (const bitrixLocation of validBitrixLocations) {
    const mappedId = mappingStore.get(bitrixLocation.bitrixId);
    const mappedLocation = mappedId ? byId.get(Number(mappedId)) : null;
    const markerLocation = byBitrixId.get(bitrixLocation.bitrixId);
    const titleLocation = byTitle.get(normalizeForCompare(bitrixLocation.title));
    const clocksterLocation = mappedLocation ?? markerLocation ?? titleLocation ?? null;

    try {
      if (!clocksterLocation) {
        if (!dryRun) {
          const response = await clocksterClient.createLocation(bitrixLocation);
          const id = response.data?.id;
          if (id) mappingStore.set(bitrixLocation.bitrixId, id);
          created.push({ bitrixId: bitrixLocation.bitrixId, clocksterId: id ?? null, title: bitrixLocation.title });
        } else {
          created.push({ bitrixId: bitrixLocation.bitrixId, clocksterId: null, title: bitrixLocation.title });
        }
        continue;
      }

      matchedClocksterIds.add(Number(clocksterLocation.id));
      mappingStore.set(bitrixLocation.bitrixId, clocksterLocation.id);

      const titleChanged = clocksterLocation.title !== bitrixLocation.title;
      const description = String(clocksterLocation.description ?? "");
      const markerMissing = !description.includes(bitrixMarker(bitrixLocation.bitrixId));

      if (titleChanged || markerMissing) {
        if (!dryRun) {
          await clocksterClient.updateLocation(clocksterLocation.id, bitrixLocation);
        }
        updated.push({
          bitrixId: bitrixLocation.bitrixId,
          clocksterId: clocksterLocation.id,
          oldTitle: clocksterLocation.title,
          newTitle: bitrixLocation.title,
          titleChanged,
          markerMissing,
        });
      }
    } catch (error) {
      errors.push({
        bitrixId: bitrixLocation.bitrixId,
        title: bitrixLocation.title,
        message: error.message,
      });
    }
  }

  const bitrixTitleSet = new Set(validBitrixLocations.map((location) => normalizeForCompare(location.title)));
  const onlyInClockster = clocksterLocations
    .filter((location) => !matchedClocksterIds.has(Number(location.id)))
    .filter((location) => !bitrixTitleSet.has(normalizeForCompare(location.title)))
    .map((location) => ({
      clocksterId: location.id,
      title: location.title,
    }));

  if (!dryRun) mappingStore.save();

  return {
    mode: dryRun ? "dry-run" : "sync",
    filters: {
      onlyBitrixIds,
    },
    counts: {
      bitrixAll: allBitrixLocations.length,
      bitrix: bitrixLocations.length,
      bitrixValid: validBitrixLocations.length,
      clockster: clocksterLocations.length,
    },
    created,
    updated,
    skipped,
    onlyInClockster,
    errors,
  };
}
