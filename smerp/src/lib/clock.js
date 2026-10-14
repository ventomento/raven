export const RealClock = Object.freeze({
    now: () => Date.now(),
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    timer: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
    },
});
