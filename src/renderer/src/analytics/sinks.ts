import type { AnalyticsEvent } from './events'

/** A destination for events. Adding a service means adding one of these and nothing else. */
export interface AnalyticsSink {
  readonly id: string
  send(event: AnalyticsEvent): void
}

/** Sends nothing. What runs until a destination is configured. */
export const noopSink: AnalyticsSink = { id: 'none', send: () => {} }

/** Prints events to the console, for development. */
export const consoleSink: AnalyticsSink = {
  id: 'console',
  send: (event) => console.info('[analytics]', event.name, event.properties)
}

export interface PostHogSinkOptions {
  apiKey: string
  /** PostHog ingestion host; the US cloud by default, or the EU or a self-hosted one. */
  host?: string
  /** A random id kept in this browser, not tied to a person. */
  distinctId: () => string
  fetchImpl?: typeof fetch
}

/**
 * PostHog over its public capture endpoint, with no SDK: one small POST per event, so there is
 * no extra dependency, bundle weight or auto-captured data. Failures are swallowed because
 * analytics must never break the app.
 */
export function createPostHogSink(options: PostHogSinkOptions): AnalyticsSink {
  const host = (options.host ?? 'https://us.i.posthog.com').replace(/\/+$/, '')
  const send = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  return {
    id: 'posthog',
    send(event) {
      try {
        void send(`${host}/capture/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({
            api_key: options.apiKey,
            event: event.name,
            distinct_id: options.distinctId(),
            timestamp: new Date(event.timestamp).toISOString(),
            properties: { ...event.properties, $process_person_profile: false }
          })
        }).catch(() => {})
      } catch {
        // Never let a reporting failure reach the app.
      }
    }
  }
}
