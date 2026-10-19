// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  analyticsOptedOut,
  configureAnalytics,
  setAnalyticsOptOut,
  sinksFromEnv,
  track,
  trackOnce
} from './analytics'
import { createPostHogSink, type AnalyticsSink } from './sinks'

function recorder(): AnalyticsSink & { events: string[] } {
  const events: string[] = []
  return { id: 'recorder', events, send: (event) => void events.push(event.name) }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  configureAnalytics([])
  localStorage.clear()
})

describe('track', () => {
  it('sends to every configured sink, and to none by default', () => {
    track('palette_opened', {})
    const a = recorder()
    const b = recorder()
    configureAnalytics([a, b])
    track('palette_opened', {})
    expect(a.events).toEqual(['palette_opened'])
    expect(b.events).toEqual(['palette_opened'])
  })

  it('keeps going when one sink throws', () => {
    const good = recorder()
    configureAnalytics([
      {
        id: 'broken',
        send: () => {
          throw new Error('down')
        }
      },
      good
    ])
    expect(() => track('palette_opened', {})).not.toThrow()
    expect(good.events).toEqual(['palette_opened'])
  })

  it('sends nothing once the person has opted out, and again after opting back in', () => {
    const sink = recorder()
    configureAnalytics([sink])
    setAnalyticsOptOut(true)
    expect(analyticsOptedOut()).toBe(true)
    track('palette_opened', {})
    expect(sink.events).toEqual([])
    setAnalyticsOptOut(false)
    track('palette_opened', {})
    expect(sink.events).toEqual(['palette_opened'])
  })

  it('trackOnce sends the first call for a key and ignores the rest', () => {
    const sink = recorder()
    configureAnalytics([sink])
    trackOnce('first-run', 'run_started', { first: true, layout: 'simple', ms_since_open: 1 })
    trackOnce('first-run', 'run_started', { first: true, layout: 'simple', ms_since_open: 2 })
    expect(sink.events).toEqual(['run_started'])
  })
})

describe('sinksFromEnv', () => {
  it('builds nothing from an empty environment', () => {
    expect(sinksFromEnv({})).toEqual([])
  })

  it('needs a key for PostHog and skips names it does not know', () => {
    expect(sinksFromEnv({ VITE_ANALYTICS_SINKS: 'posthog' })).toEqual([])
    expect(sinksFromEnv({ VITE_ANALYTICS_SINKS: 'mystery' })).toEqual([])
    expect(
      sinksFromEnv({ VITE_ANALYTICS_SINKS: ' PostHog , console ', VITE_POSTHOG_KEY: 'phc_x' }).map(
        (sink) => sink.id
      )
    ).toEqual(['posthog', 'console'])
  })
})

describe('PostHog sink', () => {
  it('posts the event to the capture endpoint without creating a person profile', () => {
    const fetchImpl = vi.fn().mockResolvedValue({})
    const sink = createPostHogSink({
      apiKey: 'phc_key',
      host: 'https://eu.i.posthog.com/',
      distinctId: () => 'anon-1',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    sink.send({ name: 'run_completed', properties: { verdict: 'passed' }, timestamp: 0 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://eu.i.posthog.com/capture/')
    expect(JSON.parse(init.body)).toMatchObject({
      api_key: 'phc_key',
      event: 'run_completed',
      distinct_id: 'anon-1',
      properties: { verdict: 'passed', $process_person_profile: false }
    })
  })

  it('swallows network failures', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const sink = createPostHogSink({
      apiKey: 'k',
      distinctId: () => 'a',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(() => sink.send({ name: 'palette_opened', properties: {}, timestamp: 0 })).not.toThrow()
    await Promise.resolve()
  })
})
