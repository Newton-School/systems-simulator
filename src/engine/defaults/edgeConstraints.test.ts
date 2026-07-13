import { describe, expect, it } from 'vitest'
import { getEdgeConstraints, validateEdgeConstraintSelection } from './edgeConstraints'

describe('edgeConstraints', () => {
  it('limits datastore edges to tcp', () => {
    const constraints = getEdgeConstraints('microservice', 'relational-db')

    expect(constraints.allowedProtocols).toEqual(['tcp'])
    expect(constraints.reasons.protocol.https).toContain('Datastores and caches')
  })

  it('warns when an l4 load balancer uses conditional routing', () => {
    const warnings = validateEdgeConstraintSelection(
      {
        protocol: 'tcp',
        mode: 'conditional',
        packetLossRate: 0,
        maxConcurrentRequests: 100,
        bandwidth: 100
      },
      'load-balancer-l4',
      'microservice'
    )

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cannot evaluate application-layer conditions')
      ])
    )
  })
})
