export class LightLog {

  static MAX_ENTRIES = 100;

  constructor({
    debug = false,
  } = {}) {

    this.debug = debug;
    this.entries = [];
  }

  warn(message, data = null) {
    if (!this.debug) return;

    this.#addEntry("WARN", message, data);
  }

  info(message, data = null) {
    if (!this.debug) return;

    this.#addEntry("INFO", message, data);
  }

  error(message, errorOrData = null) {
    if (!this.debug) return;

    this.#addEntry(
      "ERROR",
      message,
      this.#normalize(errorOrData)
    );
  }

  getLogs() {
    return [...this.entries];
  }

  logs() {
    console.log(
      JSON.stringify(
        this.getLogs(),
        null,
        2
      )
    );
  }

  clear() {
    this.entries = [];
  }

  // =====================================================
  // INTERNAL
  // =====================================================

  #addEntry(level, message, data) {

    const normalized =
      data === null || data === undefined
        ? data
        : this.#normalize(data);

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: normalized,
    };

    this.entries.push(entry);

    // Cap memory usage
    if (this.entries.length > LightLog.MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  #normalize(value) {

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    return this.#safeClone(value);
  }

  #safeClone(value) {

    const seen = new WeakSet();

    try {

      return JSON.parse(
        JSON.stringify(
          value,
          (key, val) => {

            // Error objects
            if (val instanceof Error) {
              return {
                name: val.name,
                message: val.message,
                stack: val.stack,
              };
            }

            // Circular refs
            if (
              typeof val === "object" &&
              val !== null
            ) {

              if (seen.has(val)) {
                return "[Circular]";
              }

              seen.add(val);
            }

            // BigInt support
            if (typeof val === "bigint") {
              return val.toString();
            }

            return val;
          }
        )
      );

    } catch (err) {

      return {
        serializationError: true,
        message: err.message,
      };
    }
  }
}