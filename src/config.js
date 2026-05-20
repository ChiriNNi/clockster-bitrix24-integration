import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(file = ".env") {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name, fallback = "") {
  return process.env[name] ?? fallback;
}

export function getConfig({ bitrixOnly = false } = {}) {
  const clocksterToken = bitrixOnly
    ? optional("CLOCKSTER_TOKEN")
    : required("CLOCKSTER_TOKEN");

  return {
    bitrix: {
      webhookUrl: required("BITRIX_WEBHOOK_URL").replace(/\/+$/, ""),
      iblockTypeId: optional("BITRIX_IBLOCK_TYPE_ID", "lists"),
      iblockId: optional("BITRIX_IBLOCK_ID", "115"),
      statusField: optional("BITRIX_STATUS_FIELD", "PROPERTY_1249"),
      activeStatus: optional("BITRIX_ACTIVE_STATUS", "4467"),
    },
    clockster: {
      apiBase: optional(
        "CLOCKSTER_API_BASE",
        "https://api.clockster.com/company/v2",
      ).replace(/\/+$/, ""),
      token: clocksterToken,
      titleMax: Number(optional("CLOCKSTER_TITLE_MAX", "200")),
      defaultRadius: optional("DEFAULT_LOCATION_RADIUS"),
    },
    syncMode: optional("SYNC_MODE", "dry-run"),
  };
}
