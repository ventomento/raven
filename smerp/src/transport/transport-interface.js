// transport-interface.js

export class TransportInterface {
  /**
   * Perform an HTTP request.
   *
   * @param {Object} params
   * @param {string} params.url
   * @param {RequestInit} [params.options]
   * @param {number} [params.timeout]
   *
   * @returns {Promise<{
   *   status: number,
   *   headers: Record<string, string>,
   *   body: string
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