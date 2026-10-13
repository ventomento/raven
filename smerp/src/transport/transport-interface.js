// transport-interface.js

export class TransportInterface {
  /**
   * Perform an HTTP request.
   *
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout]  ms for the whole request, body included
   * @param {number} [params.maxBytes]  largest body to read; a longer one
   *   rejects without being buffered (default MAX_RESPONSE_BYTES)
   *
   * Redirects are never followed: a 3xx rejects. A relay must not be
   * able to send a signed request, or its token, elsewhere.
   *
   * @returns {Promise<{
   *   status: number,
   *   headers: Record<string, string>,   lowercase names
   *   body: Uint8Array                   possibly empty
   * }>}
   */
  async transport({
    url,
    options,
    timeout,
    maxBytes,
  }) {
    throw new Error(
      "TransportInterface.transport() must be implemented by subclass"
    );
  }
}