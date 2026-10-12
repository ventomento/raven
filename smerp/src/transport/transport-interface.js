// transport-interface.js

export class TransportInterface {
  /**
   * Perform an HTTP request.
   *
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout]  ms for the whole request, body included
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
  }) {
    throw new Error(
      "TransportInterface.transport() must be implemented by subclass"
    );
  }
}