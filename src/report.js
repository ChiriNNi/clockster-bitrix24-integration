import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function writeReport(report) {
  mkdirSync(resolve(process.cwd(), "logs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(process.cwd(), "logs", `sync-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export function printSummary(report) {
  console.log(`Mode: ${report.mode}`);
  console.log(`Bitrix active locations: ${report.counts.bitrix}`);
  console.log(`Clockster locations: ${report.counts.clockster}`);
  console.log(`Created: ${report.created.length}`);
  console.log(`Updated: ${report.updated.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Only in Clockster: ${report.onlyInClockster.length}`);
  console.log(`Errors: ${report.errors.length}`);
  console.log(`Report: ${report.reportPath}`);
}
