// lag-monitor.js
export class LagMonitor {
  #interval = null;
  #lastTime = null;
  #records = [];
  #thresholdMs = 50;
  #longTaskObserver = null;        // ← Declared here (fixed)
  #isBrowser = typeof window !== 'undefined' && 
               typeof PerformanceObserver !== 'undefined';

  constructor(thresholdMs = 50) {
    this.#thresholdMs = thresholdMs;
  }

  start() {
    this.#records = [];
    this.#lastTime = this.#now();

    if (this.#isBrowser) {
      this.#startBrowserMonitoring();
    } else {
      this.#startNodeMonitoring();
    }
  }

  stop() {
    if (this.#interval) {
      clearInterval(this.#interval);
      this.#interval = null;
    }
    return this.getStats();
  }

  getStats() {
    if (this.#records.length === 0) {
      return { maxLag: 0, avgLag: 0, totalBlocked: 0, records: [] };
    }

    const lags = this.#records.map(r => r.lag);
    return {
      maxLag: Math.max(...lags),
      avgLag: lags.reduce((a, b) => a + b, 0) / lags.length,
      totalBlocked: lags.reduce((a, b) => a + b, 0),
      records: this.#records
    };
  }

  #now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  #startNodeMonitoring() {
    const intervalMs = 16;
    this.#interval = setInterval(() => {
      const now = this.#now();
      const lag = now - this.#lastTime - intervalMs;

      if (lag > this.#thresholdMs) {
        this.#records.push({
          timestamp: Date.now(),
          lag: Math.round(lag),
          environment: 'node'
        });
      }
      this.#lastTime = now;
    }, intervalMs);
  }

  #startBrowserMonitoring() {
    // Long Task API - Best for detecting UI-blocking lag
    if (typeof PerformanceObserver !== 'undefined') {
      this.#longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.#records.push({
            timestamp: entry.startTime,
            lag: Math.round(entry.duration),
            environment: 'browser'
          });
        }
      });

      this.#longTaskObserver.observe({ entryTypes: ['longtask'] });
    } 
    // Fallback for older browsers
    else {
      this.#startNodeMonitoring();
    }
  }

  destroy() {
    if (this.#longTaskObserver) {
      this.#longTaskObserver.disconnect();
      this.#longTaskObserver = null;
    }
    this.stop();
  }
}

export async function measureLag(f, debug=false) {
  if (!debug){
    return await f();
  }

  const monitor = new EventLoopLagMonitor(20);
  const name = f?.name || 'anonymous';

  monitor.start();

  try {
    return await f();
  } finally {
    const stats = monitor.stop();
    console.log(name + 'Lag stats:', stats);
    return stats;
  }
}

// Usage
//const result = await measureLag(() => myLib.encrypt(bigData, key));