import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const CERTIFICATE_EXPIRY_COMPONENT_TYPES = [
  'certificate-distro'
] as const satisfies readonly ComponentType[]

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Certificate expiry (chapter 21 section 4). A certificate stops being valid at `certificateValidUntilMs` and every
 * new connection through the node then fails with `certificate_expired`, all at the same instant. If automation
 * renews it at `certificateRenewedAtMs` (after the expiry) the outage ends there; before the expiry a renewal
 * keeps the certificate valid, so the outage window is [validUntil, renewedAt). With neither set it never expires.
 */
export const certificateExpiryTrait: NodeBehaviourTrait = {
  name: 'dns.certificate-expiry',
  beforeArrival: ({ node, clock }) => {
    const validUntilMs = asNonNegativeNumber(node.config?.['certificateValidUntilMs'])
    if (validUntilMs === null) return { action: 'continue' }
    const nowMs = Number(clock) / 1000
    if (nowMs < validUntilMs) return { action: 'continue' }
    const renewedAtMs = asNonNegativeNumber(node.config?.['certificateRenewedAtMs'])
    if (renewedAtMs !== null && nowMs >= renewedAtMs) return { action: 'continue' }
    return {
      action: 'rejected',
      reason: 'certificate_expired',
      payload: { metricCounters: { certificateExpiredRejects: 1 } }
    }
  }
}

export const certificateExpiryCapabilityModule: NodeCapabilityModule = {
  name: 'dns.certificate-expiry',
  appliesTo: CERTIFICATE_EXPIRY_COMPONENT_TYPES,
  hooks: certificateExpiryTrait,
  config: {
    sections: [
      {
        id: 'certificate-expiry',
        title: 'Certificate',
        note: 'After the valid-until time every new connection through this node fails; a renewal time ends the outage. Models the margin automation has to renew in.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.certificateValidUntilMs',
            type: 'input',
            inputType: 'number',
            label: 'Valid until',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            why: 'Simulated time at which the certificate expires. Empty means it never does.'
          },
          {
            path: 'sim.certificateRenewedAtMs',
            type: 'input',
            inputType: 'number',
            label: 'Renewed at',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            why: 'Simulated time at which a new certificate is in place. If it is after Valid until, requests fail in between.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['certificateExpiredRejects'], rejectionReasons: ['certificate_expired'] },
  honesty: {
    simulates: [
      'a certificate expiring at one instant, failing every request through the node until it is renewed'
    ],
    notModeled: [
      'renewal automation itself, partial rollout across terminators, or revocation checks'
    ]
  }
}
