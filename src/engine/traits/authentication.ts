import type { ComponentType } from '../core/types'
import type { BeforeArrivalDecision, NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const AUTHENTICATION_COMPONENT_TYPES = [
  'api-gateway',
  'auth-service'
] as const satisfies readonly ComponentType[]

const DEFAULT_TOKEN_FIELD = 'authToken'
const DEFAULT_STATUS_FIELD = 'authStatus'
const DEFAULT_SCOPES_FIELD = 'authScopes'

type CredentialStatus = 'valid' | 'invalid' | 'expired'

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function fieldName(
  config: Record<string, unknown> | undefined,
  key: string,
  fallback: string
): string {
  return nonEmptyString(config?.[key]) ?? fallback
}

function stringSet(value: unknown): Set<string> {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return new Set(
    values
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  )
}

function credentialStatus(value: unknown): CredentialStatus {
  if (value === undefined || value === null || value === '' || value === 'valid') return 'valid'
  return value === 'expired' ? 'expired' : 'invalid'
}

function rejection(reason: string, counter: string): BeforeArrivalDecision {
  return {
    action: 'rejected',
    reason,
    payload: {
      authDecision: 'rejected',
      authReason: reason,
      metricCounters: { authAttempts: 1, [counter]: 1 }
    }
  }
}

export const authenticationTrait: NodeBehaviourTrait = {
  name: 'security.authentication',
  isEnabledFor: (node) => node.config?.['authenticationEnabled'] === true,
  beforeArrival: ({ node, request }): BeforeArrivalDecision => {
    const config = node.config
    if (config?.['authenticationEnabled'] !== true) return { action: 'continue' }

    const tokenField = fieldName(config, 'authTokenField', DEFAULT_TOKEN_FIELD)
    const token = nonEmptyString(request.metadata[tokenField])
    if (!token) return rejection('auth_missing_credentials', 'authMissingCredentials')

    const statusField = fieldName(config, 'authStatusField', DEFAULT_STATUS_FIELD)
    const status = credentialStatus(request.metadata[statusField])
    if (status === 'invalid') return rejection('auth_invalid_credentials', 'authInvalidCredentials')
    if (status === 'expired') return rejection('auth_expired_credentials', 'authExpiredCredentials')

    const requiredScopes = stringSet(config?.['authRequiredScopes'])
    if (requiredScopes.size > 0) {
      const scopesField = fieldName(config, 'authScopesField', DEFAULT_SCOPES_FIELD)
      const grantedScopes = stringSet(request.metadata[scopesField])
      if ([...requiredScopes].some((scope) => !grantedScopes.has(scope))) {
        return rejection('auth_forbidden', 'authForbidden')
      }
    }

    return {
      action: 'continue',
      payload: {
        authDecision: 'authenticated',
        metricCounters: { authAttempts: 1, authSucceeded: 1 }
      }
    }
  }
}

export const authenticationCapabilityModule: NodeCapabilityModule = {
  name: 'security.authentication',
  appliesTo: AUTHENTICATION_COMPONENT_TYPES,
  hooks: authenticationTrait,
  config: {
    sections: [
      {
        id: 'authentication',
        title: 'Authentication & Authorization',
        note: 'When enabled, requests need a token and every required scope. Workloads provide these through request metadata.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.authenticationEnabled',
            type: 'boolean',
            label: 'Enforce authentication',
            defaultValue: false,
            altitude: 'primary',
            why: 'Rejects missing, invalid, expired, or insufficiently scoped credentials before the request is processed.'
          },
          {
            path: 'sim.authRequiredScopes',
            type: 'input',
            inputType: 'text',
            label: 'Required scopes',
            placeholder: 'orders:read, orders:write',
            altitude: 'primary',
            visible: (data) => data.sim?.authenticationEnabled === true,
            why: 'Comma-separated scopes that every accepted request must contain.'
          },
          {
            path: 'sim.authTokenField',
            type: 'input',
            inputType: 'text',
            label: 'Token metadata field',
            placeholder: DEFAULT_TOKEN_FIELD,
            altitude: 'advanced',
            visible: (data) => data.sim?.authenticationEnabled === true,
            why: 'Request metadata field containing the credential token.'
          },
          {
            path: 'sim.authStatusField',
            type: 'input',
            inputType: 'text',
            label: 'Status metadata field',
            placeholder: DEFAULT_STATUS_FIELD,
            altitude: 'advanced',
            visible: (data) => data.sim?.authenticationEnabled === true,
            why: 'Optional request metadata value: valid, invalid, or expired.'
          },
          {
            path: 'sim.authScopesField',
            type: 'input',
            inputType: 'text',
            label: 'Scopes metadata field',
            placeholder: DEFAULT_SCOPES_FIELD,
            altitude: 'advanced',
            visible: (data) => data.sim?.authenticationEnabled === true,
            why: 'Request metadata field containing an array or comma-separated list of granted scopes.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.authenticationEnabled',
      value: false,
      rationale: 'Opt-in preserves existing topologies whose workloads do not carry credentials.'
    }
  ],
  metrics: {
    counters: [
      'authAttempts',
      'authSucceeded',
      'authMissingCredentials',
      'authInvalidCredentials',
      'authExpiredCredentials',
      'authForbidden'
    ],
    rejectionReasons: [
      'auth_missing_credentials',
      'auth_invalid_credentials',
      'auth_expired_credentials',
      'auth_forbidden'
    ]
  },
  honesty: {
    simulates: [
      'deterministic credential presence, validity, expiry, and required-scope decisions',
      'distinct authentication and authorization rejection counters usable by Question Studio'
    ],
    notModeled: [
      'cryptographic JWT or signature verification',
      'issuer, audience, JWK fetch/rotation, token minting, and identity-provider flows',
      'external policy engines and hierarchical RBAC/ABAC evaluation'
    ]
  }
}
