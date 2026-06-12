// transport-default.js

import { TransportInterface } from "./transport-interface.js";

export class TransportDefault extends TransportInterface {
  /**
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout=10000]
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
      const body = await this.getResponseBody(response);
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

  static async getResponseBody(response) {

    const contentType = response.headers.get("content-type") || "";

    // JSON
    if (contentType.includes("application/json")) {
      return await response.json();
    }

    // Binary data (images, files, buffers, etc.)
    if (contentType.includes("application/octet-stream") ||
        contentType.includes("image/") ||
        contentType.includes("application/pdf")) {
      return await response.arrayBuffer();     // or .blob()
    }

    // Text (HTML, plain text, CSV, etc.)
    return await response.text();
  }
}