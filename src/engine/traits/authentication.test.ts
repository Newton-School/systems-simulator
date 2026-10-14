import { describe, expect, it } from 'vitest'
import type { ComponentNode } from '../core/types'
import type { BeforeArrivalDecision } from './types'
import { authenticationTrait } from './authentication'
import { resolveTraits } from './resolveTraits'

function node(config: Record<string, unknown> = {}): ComponentNode {
  return {
    id: 'auth',
    type: 'auth-service',
    category: 'compute',
    role: 'processor',
    label: 'Auth Service',
    position: { x: 0, y: 0 },
    queue: { workers: 1, capacity: 10, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 },
    config
  }
}

function decide(
  config: Record<string, unknown>,
  metadata: Record<string, unknown> = {}
): BeforeArrivalDecision | undefined {
  return authenticationTrait.beforeArrival?.({
    node: node(config),
    request: { metadata } as never,
    clock: 0n
  })
}

function counters(decision: BeforeArrivalDecision | undefined): Record<string, number> {
  const payload = decision && 'payload' in decision ? decision.payload : undefined
  return (payload?.['metricCounters'] as Record<string, number>) ?? {}
}

describe('authenticationTrait', () => {
  it('is attached to both node types whose titles advertise authentication', () => {
    const names = (component: ComponentNode['type']) =>
      resolveTraits({ ...node({ authenticationEnabled: true }), type: component }).map(
        (trait) => trait.name
      )

    expect(names('api-gateway')).toContain('security.authentication')
    expect(names('auth-service')).toContain('security.authentication')
    expect(names('microservice')).not.toContain('security.authentication')
  })

  it('is inert until authentication is explicitly enabled', () => {
    expect(decide({}, {})).toEqual({ action: 'continue' })
  })

  it('rejects missing, invalid, and expired credentials distinctly', () => {
    const enabled = { authenticationEnabled: true }

    const missing = decide(enabled)
    expect(missing).toMatchObject({ action: 'rejected', reason: 'auth_missing_credentials' })
    expect(counters(missing)).toEqual({ authAttempts: 1, authMissingCredentials: 1 })

    const invalid = decide(enabled, { authToken: 'token', authStatus: 'invalid' })
    expect(invalid).toMatchObject({ action: 'rejected', reason: 'auth_invalid_credentials' })
    expect(counters(invalid).authInvalidCredentials).toBe(1)

    expect(decide(enabled, { authToken: 'token', authStatus: 'revoked' })).toMatchObject({
      action: 'rejected',
      reason: 'auth_invalid_credentials'
    })

    const expired = decide(enabled, { authToken: 'token', authStatus: 'expired' })
    expect(expired).toMatchObject({ action: 'rejected', reason: 'auth_expired_credentials' })
    expect(counters(expired).authExpiredCredentials).toBe(1)
  })

  it('enforces every required scope for array and comma-separated metadata', () => {
    const config = {
      authenticationEnabled: true,
      authRequiredScopes: 'orders:read, orders:write'
    }

    const forbidden = decide(config, {
      authToken: 'token',
      authScopes: ['orders:read']
    })
    expect(forbidden).toMatchObject({ action: 'rejected', reason: 'auth_forbidden' })
    expect(counters(forbidden).authForbidden).toBe(1)

    const accepted = decide(config, {
      authToken: 'token',
      authScopes: 'orders:write, orders:read'
    })
    expect(accepted).toMatchObject({ action: 'continue' })
    expect(counters(accepted)).toEqual({ authAttempts: 1, authSucceeded: 1 })
  })

  it('supports customized metadata field names', () => {
    const decision = decide(
      {
        authenticationEnabled: true,
        authTokenField: 'credential',
        authStatusField: 'credentialState',
        authScopesField: 'permissions',
        authRequiredScopes: 'checkout'
      },
      { credential: 'token', credentialState: 'valid', permissions: ['checkout'] }
    )

    expect(decision).toMatchObject({ action: 'continue' })
    expect(counters(decision).authSucceeded).toBe(1)
  })
})
