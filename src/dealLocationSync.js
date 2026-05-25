import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BitrixDealClient } from "./bitrixDealClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { findFuzzyCandidates, indexClocksterLocations } from "./matchUtils.js";
import { normalizeForCompare, normalizeTitle } from "./normalize.js";

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--sync");
const createEnabled = args.has("--create") || process.env.DEAL_SYNC_CREATE_ENABLED === "true";
const limit = Number(getArg("--limit", "0"));
const onlyDealId = getArg("--deal-id", "");

const config = getConfig();
const dealClient = new BitrixDealClient(config.bitrix, config.deals);
const clocksterClient = new ClocksterClient(config.clockster);

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
    latitudeField: config.deals.latitudeField,
    longitudeField: config.deals.longitudeField,
    locationUpdateDistanceMeters: config.locationUpdateDistanceMeters,
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
  [
    "update_existing_title",
    "update_existing_coordinates",
    "update_existing_location",
    "link_exact_title",
    "create_location",
  ].includes(action.action),
);
const workItems = limit > 0 ? executableActions.slice(0, limit) : executableActions;

if (!dryRun) {
  for (const action of workItems) {
    try {
      if (
        action.action === "update_existing_title" ||
        action.action === "update_existing_coordinates" ||
        action.action === "update_existing_location"
      ) {
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
    bitrixLatitude: deal.latitude,
    bitrixLongitude: deal.longitude,
  };

  if (!title || title.length < 2) return { ...base, action: "skip_invalid_title", reason: "empty_or_short_title" };
  if (title.length > config.clockster.titleMax) {
    return { ...base, action: "skip_invalid_title", reason: `title_longer_than_${config.clockster.titleMax}` };
  }
  if (!hasBitrixCoordinates(deal)) {
    return {
      ...base,
      action: "review_missing_bitrix_coordinates",
      latitudeRaw: deal.latitudeRaw,
      longitudeRaw: deal.longitudeRaw,
    };
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
    const titleMatches = normalizeForCompare(oldTitle) === normalizeForCompare(title);
    const coordinateDiff = coordinateDifference(location, deal);
    const coordinatesMatch = coordinateDiff !== null && coordinateDiff <= config.locationUpdateDistanceMeters;

    if (titleMatches && coordinatesMatch) {
      return {
        ...base,
        action: "ok_existing_link",
        clocksterId: location.id,
        clocksterLatitude: parseCoordinate(location.latitude),
        clocksterLongitude: parseCoordinate(location.longitude),
        coordinateDiffMeters: coordinateDiff,
      };
    }

    const action = !titleMatches && !coordinatesMatch
      ? "update_existing_location"
      : titleMatches
        ? "update_existing_coordinates"
        : "update_existing_title";

    return {
      ...base,
      action,
      clocksterId: location.id,
      oldTitle,
      newTitle: title,
      clocksterLatitude: parseCoordinate(location.latitude),
      clocksterLongitude: parseCoordinate(location.longitude),
      coordinateDiffMeters: coordinateDiff,
      payload: payloadFromDeal(deal, location.radius),
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
      clocksterLatitude: parseCoordinate(location.latitude),
      clocksterLongitude: parseCoordinate(location.longitude),
      coordinateDiffMeters: coordinateDifference(location, deal),
      payload: payloadFromDeal(deal, location.radius),
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
      plannedPayload: payloadFromDeal(deal),
    };
  }

  return {
    ...base,
    action: "create_location",
    payload: payloadFromDeal(deal),
  };
}

function payloadFromDeal(deal, radius = config.clockster.defaultRadius) {
  return {
    title: normalizeTitle(deal.title),
    description: deal.dealId,
    latitude: deal.latitude,
    longitude: deal.longitude,
    radius,
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

function hasBitrixCoordinates(deal) {
  return Number.isFinite(deal.latitude) && Number.isFinite(deal.longitude);
}

function parseCoordinate(value) {
  const number = Number(String(value ?? "").replace(",", ".").trim());
  return Number.isFinite(number) ? number : null;
}

function coordinateDifference(location, deal) {
  const latitude = parseCoordinate(location.latitude);
  const longitude = parseCoordinate(location.longitude);
  if (latitude === null || longitude === null || !hasBitrixCoordinates(deal)) return null;
  return Math.round(distanceMeters(latitude, longitude, deal.latitude, deal.longitude));
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
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
  const headers = [
    "dealId",
    "action",
    "dealTitle",
    "clocksterId",
    "oldTitle",
    "newTitle",
    "bitrixLatitude",
    "bitrixLongitude",
    "clocksterLatitude",
    "clocksterLongitude",
    "coordinateDiffMeters",
    "reason",
  ];
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
  const actionCounts = data.actions.reduce((acc, action) => {
    acc[action.action] = (acc[action.action] ?? 0) + 1;
    return acc;
  }, {});
  const actionButtons = [
    ["all", "Все", data.actions.length],
    ...Object.entries(actionCounts).sort(([left], [right]) => left.localeCompare(right)),
  ]
    .map(([action, labelOrCount, maybeCount]) => {
      const label = action === "all" ? labelOrCount : action;
      const count = action === "all" ? maybeCount : labelOrCount;
      return `<button class="filter-btn${action === "all" ? " active" : ""}" type="button" data-action="${escapeHtml(action)}">${escapeHtml(label)} <span>${escapeHtml(count)}</span></button>`;
    })
    .join("\n");

  const rows = data.actions
    .map((action) => `<tr data-action="${escapeHtml(action.action)}" data-search="${escapeHtml([
      action.action,
      action.dealId,
      action.dealTitle,
      action.clocksterId ?? "",
      action.oldTitle ?? "",
      action.newTitle ?? "",
      action.candidates?.length ? JSON.stringify(action.candidates) : "",
      action.reason ?? "",
    ].join(" ").toLowerCase())}">${[
      action.action,
      action.dealId,
      action.dealTitle,
      action.clocksterId ?? "",
      action.oldTitle ?? "",
      action.newTitle ?? "",
      action.bitrixLatitude ?? "",
      action.bitrixLongitude ?? "",
      action.clocksterLatitude ?? "",
      action.clocksterLongitude ?? "",
      action.coordinateDiffMeters ?? "",
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
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; background: #fff; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .meta { color: #6b7280; margin-bottom: 16px; }
    .toolbar { position: sticky; top: 0; z-index: 3; background: #fff; padding: 0 0 12px; border-bottom: 1px solid #e5e7eb; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .filter-btn { border: 1px solid #d1d5db; border-radius: 7px; background: #f9fafb; color: #1f2937; padding: 7px 10px; cursor: pointer; font-size: 13px; }
    .filter-btn:hover { background: #eef2ff; }
    .filter-btn.active { background: #2563eb; border-color: #2563eb; color: white; }
    .filter-btn span { opacity: 0.75; margin-left: 4px; }
    .search { width: min(720px, 100%); box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 7px; padding: 10px 12px; font-size: 14px; }
    .visible-count { margin-top: 8px; color: #6b7280; font-size: 13px; }
    details { margin: 12px 0; }
    pre { background: #f3f4f6; padding: 12px; border-radius: 8px; white-space: pre-wrap; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th { position: sticky; top: 125px; background: #eef2ff; z-index: 2; }
    th, td { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    tr:nth-child(even) { background: #f9fafb; }
    tr.hidden { display: none; }
    code { color: #4b5563; }
  </style>
</head>
<body>
  <h1>Deal location sync</h1>
  <div class="meta">Mode: <code>${escapeHtml(data.mode)}</code> · Generated: <code>${escapeHtml(data.generatedAt)}</code></div>
  <div class="toolbar">
    <input class="search" id="search" type="search" placeholder="Поиск по Bitrix ID, названию, Clockster ID, description...">
    <div class="summary" id="filters">${actionButtons}</div>
    <div class="visible-count" id="visibleCount"></div>
  </div>
  <details>
    <summary>Сводка counts</summary>
    <pre>${escapeHtml(JSON.stringify(data.counts, null, 2))}</pre>
  </details>
  <table>
    <thead>
      <tr>
        <th>action</th><th>dealId</th><th>dealTitle</th><th>clocksterId</th><th>oldTitle</th>
        <th>newTitle</th><th>bitrixLatitude</th><th>bitrixLongitude</th><th>clocksterLatitude</th>
        <th>clocksterLongitude</th><th>coordinateDiffMeters</th><th>candidates</th><th>reason</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const buttons = Array.from(document.querySelectorAll(".filter-btn"));
    const search = document.getElementById("search");
    const visibleCount = document.getElementById("visibleCount");
    let activeAction = "all";

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      for (const row of rows) {
        const actionMatches = activeAction === "all" || row.dataset.action === activeAction;
        const queryMatches = !query || row.dataset.search.includes(query);
        const visible = actionMatches && queryMatches;
        row.classList.toggle("hidden", !visible);
        if (visible) shown += 1;
      }
      visibleCount.textContent = \`Показано: \${shown} из \${rows.length}\`;
    }

    for (const button of buttons) {
      button.addEventListener("click", () => {
        activeAction = button.dataset.action;
        for (const item of buttons) item.classList.toggle("active", item === button);
        applyFilters();
      });
    }
    search.addEventListener("input", applyFilters);
    applyFilters();
  </script>
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
