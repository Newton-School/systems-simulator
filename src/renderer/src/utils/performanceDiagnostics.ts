const LONG_TASK_THRESHOLD_MS = 50

export function installPerformanceDiagnostics(): void {
  if (!import.meta.env.DEV || typeof PerformanceObserver === 'undefined') {
    return
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
          console.warn('[perf] long main-thread task', {
            durationMs: Math.round(entry.duration * 10) / 10,
            startTimeMs: Math.round(entry.startTime * 10) / 10,
            name: entry.name
          })
        }
      }
    })

    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // The longtask entry type is unavailable in some embedded/browser contexts.
  }
}
