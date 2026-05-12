// transport-default.js

import { TransportInterface } from "./transport-interface.js";

export class TransportDefault extends TransportInterface {
  /**
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout=10000]
   */
  async transport({
    url,
    options = {},
    timeout = 10000,
  }) {
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      const body = await response.text();

      const headers = Object.fromEntries(response.headers.entries());

      return {
        status: response.status,
        headers,
        body,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeout}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}