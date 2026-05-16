export const LoggerDefault = {
    info: (msg, ...args) => console.info(msg, ...args),
    warn: (msg, ...args) => console.warn(msg, ...args),
    error: (msg, ...args) => console.error(msg, ...args),

    clock: { now: () => Date.now() },

    debug: false,
    _debugTrace: [],

    debugAdd(o) {
        if (this.debug) {
            this._debugTrace.push({
                s: JSON.stringify(o, null, 2),
                timestamp: this.clock.now()
            });
        }
    }
};