// Time source. All times are milliseconds. Injected everywhere time
// matters, so tests can fake it.
//
//   now()            current time
//   sleep(ms)        Promise resolved after ms
//   timer(ms, fn)    calls fn after ms; returns a function that cancels it
export const RealClock = Object.freeze({
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    timer: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
    },
});
