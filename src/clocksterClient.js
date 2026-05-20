import { requestJson } from "./http.js";
import { bitrixMarker } from "./normalize.js";

export class ClocksterClient {
  constructor(config) {
    this.config = config;
  }

  async getLocations() {
    const locations = [];
    let page = 1;
    let lastPage = 1;

    do {
      const url = new URL(`${this.config.apiBase}/locations`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "50");
      url.searchParams.set("sort", "id");
      url.searchParams.set("order", "asc");

      const data = await this.request(url);
      locations.push(...(data.data ?? []));
      lastPage = Number(data.meta?.last_page ?? page);
      page += 1;
      await pause(700);
    } while (page <= lastPage);

    return locations;
  }

  async createLocation(bitrixLocation) {
    const body = new FormData();
    body.set("title", bitrixLocation.title);
    body.set("description", bitrixMarker(bitrixLocation.bitrixId));
    if (this.config.defaultRadius) body.set("radius", this.config.defaultRadius);

    return this.request(`${this.config.apiBase}/locations`, {
      method: "POST",
      body,
    });
  }

  async updateLocation(clocksterId, bitrixLocation) {
    const body = new URLSearchParams();
    body.set("title", bitrixLocation.title);
    body.set("description", bitrixMarker(bitrixLocation.bitrixId));
    if (this.config.defaultRadius) body.set("radius", this.config.defaultRadius);

    return this.request(`${this.config.apiBase}/locations/${clocksterId}`, {
      method: "PUT",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  async request(url, options = {}) {
    return requestJson(url.toString(), {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.token}`,
        ...(options.headers ?? {}),
      },
    });
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
