// Time source: { now(): ms, sleep(ms): Promise }. All times are
// milliseconds. Injected everywhere time matters, so tests can fake it.
export const RealClock = Object.freeze({
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
});
