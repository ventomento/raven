export const LoggerDefault = {
    info: (msg, ...args) => console.info(msg, ...args),
    warn: (msg, ...args) => console.warn(msg, ...args),
    error: (msg, ...args) => console.error(msg, ...args),

    clock: { now: () => Date.now() },

    debug: false,
    debugTrace: [],

    debugAdd(o) {
        if (this.debug) {
            this.debugTrace.push({
                //s: JSON.stringify(o, null, 2),
                s: safeStringify(o),
                timestamp: this.clock.now()
            });
        }
    }
};

function serializeError(err) {
    if (!(err instanceof Error)) return err;

    return {
        name: err.name,
        message: err.message,
        stack: err.stack,
        cause: err.cause,
        code: err.code,
        ...err
    };
}

// 2. Safe Stringify
function safeStringify(obj, space = 2) {
    return JSON.stringify(obj, (key, value) => {
        if (value instanceof Error) {
            return serializeError(value);
        }
        if (value instanceof Promise) {
            return "[Promise]";
        }
        return value;
    }, space);
}