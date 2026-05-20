import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PATH = "data/mappings.json";

export class MappingStore {
  constructor(path = DEFAULT_PATH) {
    this.path = resolve(process.cwd(), path);
    this.data = { bitrixToClockster: {} };
  }

  load() {
    if (!existsSync(this.path)) return this;
    this.data = JSON.parse(readFileSync(this.path, "utf8"));
    this.data.bitrixToClockster ??= {};
    return this;
  }

  get(bitrixId) {
    return this.data.bitrixToClockster[String(bitrixId)] ?? null;
  }

  set(bitrixId, clocksterId) {
    this.data.bitrixToClockster[String(bitrixId)] = Number(clocksterId);
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}
