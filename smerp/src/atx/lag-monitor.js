// lag-monitor.js

/**
 * UI / Event Loop Lag Monitor
 * =========================================================
 *
 * This utility measures whether a function causes visible UI
 * lag or main-thread blocking while it runs.
 *
 * It combines:
 *
 * 1. Long Task API
 *    Detects catastrophic blocking (>50ms main-thread blocks)
 *
 * 2. requestAnimationFrame monitoring
 *    Detects dropped / delayed frames and UI stutter
 *
 * 3. Total execution duration
 *    Measures how long the function existed overall
 *
 *
 * =========================================================
 * EXAMPLE USAGE
 * =========================================================
 *
 * import { measureLag } from "./lag-monitor.js";
 *
 * const result = await measureLag(
 *   async () => {
 *
 *     // expensive work
 *     heavyFunction();
 *
 *     // async work
 *     await fetch("/api/data");
 *
 *     // more expensive work
 *     processBigArray();
 *
 *     return "done";
 *   },
 *   {
 *     name: "loadMessages",
 *     debug: true,
 *   }
 * );
 *
 *
 * =========================================================
 * METRICS EXPLAINED
 * =========================================================
 *
 * duration
 * --------
 * Total wall-clock time the function existed.
 *
 * IMPORTANT:
 * Includes:
 * - network waits
 * - awaits
 * - timers
 * - async pauses
 *
 * A long duration DOES NOT mean UI was blocked.
 *
 *
 * longTasks
 * ---------
 * Array of browser Long Tasks (>50ms blocking).
 *
 * Example:
 * [
 *   { duration: 78 },
 *   { duration: 122 }
 * ]
 *
 * Interpretation:
 * - Any long task means the main thread froze.
 * - User interactions and rendering were blocked.
 * - Multiple long tasks usually indicate expensive sync work.
 *
 *
 * droppedFrames
 * -------------
 * Number of delayed animation frames.
 *
 * Interpretation:
 *
 * 0:
 *   Smooth rendering.
 *
 * 1-3:
 *   Minor UI stutter.
 *
 * 4+:
 *   Noticeable jank.
 *
 * 10+:
 *   Serious frame drops / freezing.
 *
 *
 * worstFrameDelay
 * ---------------
 * Largest frame delay in milliseconds.
 *
 * Interpretation:
 *
 * < 20ms:
 *   Excellent.
 *
 * 20-50ms:
 *   Minor stutter.
 *
 * 50-100ms:
 *   Noticeable freeze.
 *
 * 100ms+:
 *   Severe UI hitching.
 *
 *
 * =========================================================
 * IMPORTANT LIMITATIONS
 * =========================================================
 *
 * This measures lag that occurred WHILE the function existed.
 *
 * If your function awaits network requests or timers,
 * unrelated code elsewhere in the app may also contribute
 * to measured lag during that time window.
 *
 * For exact attribution:
 * - measure smaller sections
 * - wrap expensive synchronous work directly
 *
 *
 * =========================================================
 * BROWSER SUPPORT
 * =========================================================
 *
 * Long Task API:
 * - Chromium browsers: supported
 * - Safari: partial
 * - Firefox: limited
 *
 * requestAnimationFrame:
 * - universally supported in browsers
 *
 * Node.js:
 * - frame metrics unavailable
 * - falls back to timing only
 */

const isBrowser =
  typeof window !== "undefined" &&
  typeof performance !== "undefined";

const hasLongTaskAPI =
  typeof PerformanceObserver !== "undefined";

const hasRAF =
  typeof requestAnimationFrame !== "undefined";

/**
 * @typedef LagMetrics
 * @property {string} name
 * @property {number} duration
 * @property {number} droppedFrames
 * @property {number} worstFrameDelay
 * @property {number} totalBlockingTime
 * @property {Array<{duration:number,start:number}>} longTasks
 */

/**
 * Measure UI lag while a function runs.
 *
 * @template T
 * @param {() => Promise<T> | T} fn
 * @param {{
 *   name?: string,
 *   debug?: boolean,
 *   log?: boolean,
 * }} options
 *
 * @returns {Promise<T>}
 */
export async function measureLag(
  fn,
  {
    name = fn?.name || "anonymous",
    debug = true,
    log = true,
  } = {}
) {
  if (!debug) {
    return await fn();
  }

  const startedAt = now();

  // ---------------------------------------------------
  // LONG TASK TRACKING
  // ---------------------------------------------------

  /** @type {Array<{duration:number,start:number}>} */
  const longTasks = [];

  let observer = null;

  if (isBrowser && hasLongTaskAPI) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({
          start: entry.startTime,
          duration: Math.round(entry.duration),
        });
      }
    });

    observer.observe({
      entryTypes: ["longtask"],
    });
  }

  // ---------------------------------------------------
  // FRAME DROP TRACKING
  // ---------------------------------------------------

  let droppedFrames = 0;
  let worstFrameDelay = 0;

  let rafRunning = true;

  let lastFrame = now();

  function frameTick(frameNow) {
    const delta = frameNow - lastFrame;

    // 60fps ~= 16.67ms
    // anything above ~20ms indicates frame delay
    if (delta > 20) {
      droppedFrames++;

      if (delta > worstFrameDelay) {
        worstFrameDelay = delta;
      }
    }

    lastFrame = frameNow;

    if (rafRunning) {
      requestAnimationFrame(frameTick);
    }
  }

  if (isBrowser && hasRAF) {
    requestAnimationFrame(frameTick);
  }

  // ---------------------------------------------------
  // EXECUTION
  // ---------------------------------------------------

  try {
    return await fn();
  } finally {
    rafRunning = false;

    if (observer) {
      observer.disconnect();
    }

    const duration =
      Math.round(now() - startedAt);

    const totalBlockingTime =
      longTasks.reduce(
        (sum, task) => sum + task.duration,
        0
      );

    /** @type {LagMetrics} */
    const metrics = {
      name,
      duration,
      droppedFrames,
      worstFrameDelay:
        Math.round(worstFrameDelay),

      totalBlockingTime,

      longTasks,
    };

    if (log) {
      console.group(
        `[LagMonitor] ${name}`
      );

      console.table(metrics);

      if (longTasks.length > 0) {
        console.table(longTasks);
      }

      console.groupEnd();
    }
  }
}

function now() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
}