import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { requestJson } from "./http.js";
import { normalizeForCompare } from "./normalize.js";

export class GeocoderClient {
  constructor(config, cachePath = "data/geocode-cache.json") {
    this.config = config;
    this.cachePath = resolve(process.cwd(), cachePath);
    this.cache = {};
    if (existsSync(this.cachePath)) {
      this.cache = JSON.parse(readFileSync(this.cachePath, "utf8"));
    }
  }

  isEnabled() {
    if (this.config.provider === "2gis") return Boolean(this.config.twoGisKey);
    if (this.config.provider === "google") return Boolean(this.config.googleKey);
    return false;
  }

  async geocode(query) {
    const key = normalizeForCompare(`${this.config.provider}:${query}`);
    if (this.cache[key]) return this.cache[key];

    if (!this.isEnabled()) {
      return {
        status: "disabled",
        query,
        message: "No geocoder provider/key configured",
      };
    }

    const result = this.config.provider === "2gis"
      ? await this.geocode2Gis(query)
      : await this.geocodeGoogle(query);

    this.cache[key] = result;
    this.save();
    return result;
  }

  async geocode2Gis(query) {
    const url = new URL("https://catalog.api.2gis.com/3.0/items/geocode");
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "items.point,items.full_name,items.address_name,items.purpose_name");
    url.searchParams.set("key", this.config.twoGisKey);

    const data = await requestJson(url);
    const item = data.result?.items?.[0];
    const point = item?.point;
    if (!point?.lat || !point?.lon) {
      return { status: "not_found", query, provider: "2gis" };
    }

    return {
      status: "ok",
      provider: "2gis",
      query,
      latitude: point.lat,
      longitude: point.lon,
      label: item.full_name || item.address_name || item.purpose_name || "",
      raw: item,
    };
  }

  async geocodeGoogle(query) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", this.config.googleKey);

    const data = await requestJson(url);
    const item = data.results?.[0];
    const location = item?.geometry?.location;
    if (!location?.lat || !location?.lng) {
      return { status: "not_found", query, provider: "google", googleStatus: data.status };
    }

    return {
      status: "ok",
      provider: "google",
      query,
      latitude: location.lat,
      longitude: location.lng,
      label: item.formatted_address || "",
      raw: item,
    };
  }

  save() {
    mkdirSync(dirname(this.cachePath), { recursive: true });
    writeFileSync(this.cachePath, `${JSON.stringify(this.cache, null, 2)}\n`);
  }
}
