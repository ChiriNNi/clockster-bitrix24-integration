import { BitrixClient } from "./bitrixClient.js";
import { ClocksterClient } from "./clocksterClient.js";
import { getConfig } from "./config.js";
import { MappingStore } from "./mappingStore.js";
import { printSummary, writeReport } from "./report.js";
import { syncLocations } from "./syncLocations.js";

const args = new Set(process.argv.slice(2));
const bitrixOnly = args.has("--bitrix-only");
const dryRun = args.has("--dry-run") || (!args.has("--sync") && process.env.SYNC_MODE !== "sync");
const onlyBitrixIds = getCsvArg("--only-bitrix-id");

try {
  const config = getConfig({ bitrixOnly });
  const bitrixClient = new BitrixClient(config.bitrix);

  if (bitrixOnly) {
    const locations = await bitrixClient.getActiveLocations();
    console.log(`Bitrix active locations: ${locations.length}`);
    console.log(JSON.stringify(locations.slice(0, 5), null, 2));
    process.exit(0);
  }

  const clocksterClient = new ClocksterClient(config.clockster);
  const mappingStore = new MappingStore().load();

  const report = await syncLocations({
    bitrixClient,
    clocksterClient,
    mappingStore,
    dryRun,
    titleMax: config.clockster.titleMax,
    onlyBitrixIds,
  });

  report.reportPath = writeReport(report);
  printSummary(report);

  process.exit(report.errors.length ? 1 : 0);
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

function getCsvArg(name) {
  const prefix = `${name}=`;
  const values = [];

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      values.push(...arg.slice(prefix.length).split(","));
      continue;
    }
    if (arg === name && process.argv[index + 1]) {
      values.push(...process.argv[index + 1].split(","));
      index += 1;
    }
  }

  return values.map((value) => value.trim()).filter(Boolean);
}
