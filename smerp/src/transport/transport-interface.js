export class TransportInterface {
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