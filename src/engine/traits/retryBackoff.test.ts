import { describe, expect, it } from 'vitest'
import { computeRetryDelayMs, readRetryBackoffConfig } from './retryBackoff'

describe('retryBackoff', () => {
  it('reads retry config from resilience.retry and applies defaults for optional fields', () => {
    const config = readRetryBackoffConfig({
      resilience: {
        retry: {
          maxAttempts: 3,
          baseDelay: 250
        }
      }
    })

    expect(config).toEqual({
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 5_000,
      multiplier: 2,
      jitter: false
    })
  })

  it('returns null when max attempts is not configured', () => {
    expect(readRetryBackoffConfig({ resilience: undefined })).toBeNull()
    expect(readRetryBackoffConfig({ resilience: { retry: { baseDelay: 100 } } })).toBeNull()
  })

  it('computes capped exponential backoff without jitter', () => {
    const delay = computeRetryDelayMs(
      3,
      {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 500,
        multiplier: 2,
        jitter: false
      },
      () => 0.25
    )

    expect(delay).toBe(500)
  })

  it('applies full jitter against the capped delay', () => {
    const delay = computeRetryDelayMs(
      1,
      {
        maxAttempts: 5,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        multiplier: 2,
        jitter: true
      },
      () => 0.25
    )

    expect(delay).toBe(50)
  })
})
