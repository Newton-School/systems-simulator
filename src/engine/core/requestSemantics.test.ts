import { describe, expect, it } from 'vitest'
import { describeRequestOperation } from './requestSemantics'

describe('describeRequestOperation', () => {
  it('builds an endpoint-aware operation label when method, host, and path exist', () => {
    expect(
      describeRequestOperation({
        type: 'create-order',
        metadata: {
          method: 'POST',
          host: 'api.internal',
          path: '/checkout'
        }
      })
    ).toMatchObject({
      method: 'POST',
      host: 'api.internal',
      path: '/checkout',
      endpointLabel: 'api.internal/checkout',
      operationLabel: 'POST api.internal/checkout'
    })
  })

  it('falls back to the coarse request type when no endpoint metadata exists', () => {
    expect(describeRequestOperation({ type: 'GET' })).toMatchObject({
      requestType: 'GET',
      method: 'GET',
      operationLabel: 'GET'
    })
  })
})
