export class LightLog {
  static MAX_ENTRIES = 100;

  constructor({ debug = false } = {}) {
    this.debug = debug;
    this.entries = [];
  }

  debugLog(message, data = null) {
    if (!this.debug) return;
    this.#addEntry("DEBUG", message, data);
  }

  info(message, data = null) {
    if (!this.debug) return;
    this.#addEntry("INFO", message, data);
  }

  error(message, errorOrData = null) {
    this.#addEntry(
      "ERROR",
      message,
      this.#normalizeError(errorOrData)
    );
  }

  getLogs() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }

  #addEntry(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    this.entries.push(entry);

    // Cap memory usage
    if (this.entries.length > LightLog.MAX_ENTRIES) {
      this.entries.shift();
    }

    // Console output
    const prefix = `[${entry.timestamp}] [${level}]`;

    if (data !== null && data !== undefined) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  #normalizeError(value) {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    return value;
  }
}