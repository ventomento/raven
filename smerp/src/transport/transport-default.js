// transport-default.js

import { TransportInterface } from "./transport-interface.js";

export class TransportDefault extends TransportInterface {
  /**
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout=10000]  whole request, body included
   */

  static async transport({
    url,
    options = {},
    timeout = 10000,
    logger,
  }) {

    if (!logger){
      throw new Error("transport void logger");
    }
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      const status = response.status;
      // Relay bodies are bytes (envelopes, batches) or empty.
      const body = new Uint8Array(await response.arrayBuffer());
      const headers = Object.fromEntries(response.headers.entries());

      if (status === 200){
        logger.info("Transport received 200 response", {status, headers});
      }

      return {
        status,
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
