import { requestJson } from "./http.js";
import { normalizeTitle } from "./normalize.js";

export class BitrixClient {
  constructor(config) {
    this.config = config;
  }

  async getActiveLocations() {
    const locations = [];
    let start = 0;

    while (start !== null) {
      const body = new URLSearchParams({
        IBLOCK_TYPE_ID: this.config.iblockTypeId,
        IBLOCK_ID: this.config.iblockId,
        start: String(start),
      });
      body.append(`FILTER[${this.config.statusField}]`, this.config.activeStatus);

      const data = await requestJson(`${this.config.webhookUrl}/lists.element.get.json`, {
        method: "POST",
        body,
      });

      for (const element of data.result ?? []) {
        const title = normalizeTitle(element.NAME);
        locations.push({
          bitrixId: String(element.ID),
          title,
          raw: element,
        });
      }

      start = data.next ?? null;
      await pause(350);
    }

    return locations;
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
