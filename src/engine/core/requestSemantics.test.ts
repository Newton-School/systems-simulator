import { describe, expect, it } from 'vitest'
import { describeRequestOperation, requestFieldMatches } from './requestSemantics'

describe('requestFieldMatches', () => {
  it('matches a named header case-insensitively', () => {
    const request = { type: 'GET', metadata: { headers: { 'X-Api-Version': '2' } } }
    expect(requestFieldMatches(request, 'header', '2', 'equals', 'x-api-version')).toBe(true)
    expect(requestFieldMatches(request, 'header', '3', 'equals', 'X-Api-Version')).toBe(false)
    expect(requestFieldMatches(request, 'header', '2', 'equals', 'missing')).toBe(false)
  })

  it('returns false for a header rule with no header name', () => {
    const request = { type: 'GET', metadata: { headers: { a: 'b' } } }
    expect(requestFieldMatches(request, 'header', 'b', 'equals')).toBe(false)
  })

  it('supports prefix matching on path', () => {
    const request = { type: 'GET', metadata: { path: '/api/v2/orders' } }
    expect(requestFieldMatches(request, 'path', '/api/', 'prefix')).toBe(true)
    expect(requestFieldMatches(request, 'path', '/web/', 'prefix')).toBe(false)
  })

  it('supports regex matching and fails closed on an invalid pattern', () => {
    const request = { type: 'GET', metadata: { host: 'shard-07.internal' } }
    expect(requestFieldMatches(request, 'host', '^shard-\\d+', 'regex')).toBe(true)
    expect(requestFieldMatches(request, 'host', 'shard-[', 'regex')).toBe(false) // invalid regex
  })

  it('keeps equals as the default and stays case-insensitive for method', () => {
    const request = { type: 'create', metadata: { method: 'post' } }
    expect(requestFieldMatches(request, 'method', 'POST')).toBe(true)
    expect(requestFieldMatches(request, 'type', 'create')).toBe(true)
  })
})

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
