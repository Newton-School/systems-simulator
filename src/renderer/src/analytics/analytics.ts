import type { AnalyticsEvent, AnalyticsEventMap, AnalyticsEventName } from './events'
import { consoleSink, createPostHogSink, noopSink, type AnalyticsSink } from './sinks'

const ANONYMOUS_ID_KEY = 'nssimulator.analytics-id'
const OPT_OUT_KEY = 'nssimulator.analytics-opt-out'

let activeSinks: readonly AnalyticsSink[] = [noopSink]
const sentOnce = new Set<string>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** True when the browser asks not to be tracked or the person turned reporting off. */
export function analyticsOptedOut(): boolean {
  if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return true
  return storage()?.getItem(OPT_OUT_KEY) === '1'
}

export function setAnalyticsOptOut(optedOut: boolean): void {
  const target = storage()
  if (!target) return
  if (optedOut) target.setItem(OPT_OUT_KEY, '1')
  else target.removeItem(OPT_OUT_KEY)
}

/** A random id for this browser, with no link to a person, account or assignment. */
export function anonymousId(): string {
  const target = storage()
  const existing = target?.getItem(ANONYMOUS_ID_KEY)
  if (existing) return existing
  const created = crypto.randomUUID()
  try {
    target?.setItem(ANONYMOUS_ID_KEY, created)
  } catch {
    // Private mode: a per-page id is fine.
  }
  return created
}

/**
 * Choose where events go. Called once at startup; `track` does nothing before that. Pass more
 * than one sink to report to several places at once.
 */
export function configureAnalytics(sinks: readonly AnalyticsSink[]): void {
  activeSinks = sinks.length > 0 ? sinks : [noopSink]
  sentOnce.clear()
}

/** Report an event. Never throws, and does nothing if the person opted out. */
export function track<N extends AnalyticsEventName>(
  name: N,
  properties: AnalyticsEventMap[N]
): void {
  if (analyticsOptedOut()) return
  const event: AnalyticsEvent = { name, properties, timestamp: Date.now() } as AnalyticsEvent
  for (const sink of activeSinks) {
    try {
      sink.send(event)
    } catch {
      // A broken destination must not break the app or the other destinations.
    }
  }
}

/** Like `track`, but only the first time per session for this key. */
export function trackOnce<N extends AnalyticsEventName>(
  key: string,
  name: N,
  properties: AnalyticsEventMap[N]
): void {
  if (sentOnce.has(key)) return
  sentOnce.add(key)
  track(name, properties)
}

interface AnalyticsEnv {
  /** Comma-separated: posthog, console. Empty or unset sends nothing. */
  VITE_ANALYTICS_SINKS?: string
  VITE_POSTHOG_KEY?: string
  VITE_POSTHOG_HOST?: string
}

/** The sinks named by the build's environment. Unknown names and missing keys are skipped. */
export function sinksFromEnv(env: AnalyticsEnv): AnalyticsSink[] {
  const names = (env.VITE_ANALYTICS_SINKS ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const sinks: AnalyticsSink[] = []
  for (const name of names) {
    if (name === 'console') sinks.push(consoleSink)
    if (name === 'posthog' && env.VITE_POSTHOG_KEY) {
      sinks.push(
        createPostHogSink({
          apiKey: env.VITE_POSTHOG_KEY,
          host: env.VITE_POSTHOG_HOST,
          distinctId: anonymousId
        })
      )
    }
  }
  return sinks
}

/** Start reporting to whatever the build's environment configures. */
export function startAnalytics(env: AnalyticsEnv = import.meta.env as AnalyticsEnv): void {
  configureAnalytics(sinksFromEnv(env))
}
