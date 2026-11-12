/**
 * Main-thread responsiveness probe for benchmarks: longest task (Long Tasks API where
 * supported) and the longest gap between event-loop turns (everywhere), counted only inside
 * the windows marked with resume()/pause() so the benchmark's own signal generation does not
 * count. Benchmark-only; not audio timing.
 */

export interface MainThreadStats {
  /** Longest task reported by the Long Tasks API (≥ 50 ms only; 0 = none), null if unsupported. */
  longestTaskMs: number | null;
  /** Longest observed gap between consecutive timer turns (baseline ≈ 4 ms timer clamp). */
  maxGapMs: number;
  /** Highest main-thread JS heap seen (Chrome's performance.memory), or null. */
  peakJsHeapBytes: number | null;
}

export interface MainThreadProbe {
  /** Start (or continue) measuring. */
  resume(): void;
  /** Stop measuring until the next resume(). */
  pause(): void;
  stop(): MainThreadStats;
}

interface MemoryPerformance {
  memory?: { usedJSHeapSize: number };
}

export function startMainThreadProbe(): MainThreadProbe {
  const windows: [number, number][] = [];
  let openSince: number | null = null;
  let longest: number | null = null;
  let observer: PerformanceObserver | null = null;
  const inWindow = (start: number, end: number) =>
    windows.some(([a, b]) => start < b && end > a) || (openSince !== null && end > openSince);
  const tasks: { start: number; duration: number }[] = [];
  try {
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes?.includes('longtask')
    ) {
      longest = 0;
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) tasks.push({ start: e.startTime, duration: e.duration });
      });
      observer.observe({ type: 'longtask', buffered: false });
    }
  } catch {
    observer = null;
  }

  const mem = () => (performance as Performance & MemoryPerformance).memory?.usedJSHeapSize;
  let peakHeap: number | null = mem() ?? null;
  let maxGap = 0;
  let last = performance.now();
  let running = true;
  const tick = () => {
    const now = performance.now();
    if (openSince !== null && last >= openSince) maxGap = Math.max(maxGap, now - last);
    last = now;
    const m = mem();
    if (m !== undefined) peakHeap = Math.max(peakHeap ?? 0, m);
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);

  return {
    resume() {
      if (openSince === null) openSince = performance.now();
    },
    pause() {
      if (openSince !== null) windows.push([openSince, performance.now()]);
      openSince = null;
    },
    stop() {
      this.pause();
      running = false;
      if (observer) {
        for (const e of observer.takeRecords())
          tasks.push({ start: e.startTime, duration: e.duration });
        observer.disconnect();
        for (const t of tasks) {
          if (inWindow(t.start, t.start + t.duration)) longest = Math.max(longest ?? 0, t.duration);
        }
      }
      return {
        longestTaskMs: longest === null ? null : Math.round(longest),
        maxGapMs: Math.round(maxGap * 10) / 10,
        peakJsHeapBytes: peakHeap,
      };
    },
  };
}
