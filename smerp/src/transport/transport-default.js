import { TransportInterface } from "./transport-interface.js";
import { MAX_RESPONSE_BYTES } from "../protocol/index.js";

export class TransportDefault extends TransportInterface {
  static async transport({
    url,
    options = {},
    timeout = 10000,
    maxBytes = MAX_RESPONSE_BYTES,
  }) {

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        ...options,
        redirect: "error",
        signal: controller.signal,
      });

      const status = response.status;
      const body = await readBody(response, maxBytes, controller);
      const headers = Object.fromEntries(response.headers.entries());

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

async function readBody(response, maxBytes, controller) {

  const tooLarge = () => {
    controller.abort();
    return new Error(`Response larger than ${maxBytes} bytes`);
  };

  if (Number(response.headers.get("content-length")) > maxBytes) {
    throw tooLarge();
  }

  if (!response.body) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;

  for (;;) {

    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > maxBytes) {
      throw tooLarge();
    }

    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}
