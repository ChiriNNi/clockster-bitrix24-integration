import { requestJson } from "./http.js";
import { normalizeTitle } from "./normalize.js";

export class BitrixDealClient {
  constructor(bitrixConfig, dealConfig) {
    this.bitrixConfig = bitrixConfig;
    this.dealConfig = dealConfig;
  }

  async getDeals() {
    const deals = [];
    let start = 0;
    const selectFields = this.dealConfig.selectFields
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);

    while (start !== null) {
      const body = new URLSearchParams({
        start: String(start),
      });
      body.append("filter[CATEGORY_ID]", this.dealConfig.categoryId);
      for (const field of selectFields) body.append("select[]", field);

      const data = await requestJson(`${this.bitrixConfig.webhookUrl}/crm.deal.list.json`, {
        method: "POST",
        body,
      });

      for (const deal of data.result ?? []) {
        const title = normalizeTitle(deal[this.dealConfig.titleField] || deal.TITLE);
        deals.push({
          dealId: String(deal.ID),
          title,
          latitude: parseCoordinate(
            deal[this.dealConfig.latitudeField],
            this.dealConfig.latitudeMin,
            this.dealConfig.latitudeMax,
          ),
          longitude: parseCoordinate(
            deal[this.dealConfig.longitudeField],
            this.dealConfig.longitudeMin,
            this.dealConfig.longitudeMax,
          ),
          latitudeRaw: deal[this.dealConfig.latitudeField] ?? "",
          longitudeRaw: deal[this.dealConfig.longitudeField] ?? "",
          raw: deal,
        });
      }

      start = data.next ?? null;
      await pause(350);
    }

    return deals;
  }
}

function parseCoordinate(value, min, max) {
  const number = Number(String(value ?? "").replace(",", ".").trim());
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
