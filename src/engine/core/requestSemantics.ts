import type { Request } from './events'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export const REQUEST_MATCH_FIELDS = ['type', 'method', 'path', 'host', 'header'] as const

export type RequestMatchField = (typeof REQUEST_MATCH_FIELDS)[number]

/** How a routing rule compares its value against the request field. */
export const MATCH_OPERATORS = ['equals', 'prefix', 'regex'] as const

export type MatchOperator = (typeof MATCH_OPERATORS)[number]

export interface RequestSemanticsInput {
  type?: string
  metadata?: Record<string, unknown>
}

export interface RequestOperationSummary {
  requestType: string | null
  method: string | null
  host: string | null
  path: string | null
  endpointLabel: string | null
  operationLabel: string
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function inferHttpMethodFromRequestType(
  requestType: string | undefined
): HttpMethod | undefined {
  const normalized = asNonEmptyString(requestType)?.toUpperCase()
  if (!normalized) {
    return undefined
  }

  return (HTTP_METHODS as readonly string[]).includes(normalized)
    ? (normalized as HttpMethod)
    : undefined
}

/**
 * Resolves the request's value for a match field. `header` needs a header name
 * (`key`) and reads `metadata.headers[name]` case-insensitively, since HTTP
 * header names are case-insensitive.
 */
export function requestFieldValue(
  request: RequestSemanticsInput,
  field: RequestMatchField,
  key?: string
): string | undefined {
  if (field === 'type') {
    return asNonEmptyString(request.type)
  }

  if (field === 'method') {
    const explicitMethod = asNonEmptyString(request.metadata?.method)
    if (explicitMethod) {
      return explicitMethod.toUpperCase()
    }

    return inferHttpMethodFromRequestType(request.type)
  }

  if (field === 'header') {
    const headers = request.metadata?.headers
    const name = asNonEmptyString(key)
    if (!headers || typeof headers !== 'object' || !name) {
      return undefined
    }
    const wanted = name.toLowerCase()
    for (const [headerName, headerValue] of Object.entries(headers as Record<string, unknown>)) {
      if (headerName.toLowerCase() === wanted) {
        return asNonEmptyString(headerValue)
      }
    }
    return undefined
  }

  return asNonEmptyString(request.metadata?.[field])
}

/**
 * Tests whether a request field satisfies a rule. `operator` selects the
 * comparison (`equals` default, `prefix`, or `regex`); `key` names the header for
 * the `header` field. An invalid regex never matches (fails closed).
 */
export function requestFieldMatches(
  request: RequestSemanticsInput,
  field: RequestMatchField,
  expectedValue: string,
  operator: MatchOperator = 'equals',
  key?: string
): boolean {
  const actualValue = requestFieldValue(request, field, key)
  if (!actualValue) {
    return false
  }

  // Method comparison is case-insensitive for exact matches only.
  const expected =
    field === 'method' && operator === 'equals' ? expectedValue.trim().toUpperCase() : expectedValue

  switch (operator) {
    case 'prefix':
      return actualValue.startsWith(expected)
    case 'regex':
      try {
        return new RegExp(expected).test(actualValue)
      } catch {
        return false
      }
    case 'equals':
    default:
      return actualValue === expected
  }
}

function joinEndpoint(host: string | null, path: string | null): string | null {
  if (host && path) return `${host}${path}`
  return path ?? host
}

export function describeRequestOperation(
  request: RequestSemanticsInput | Pick<Request, 'type' | 'metadata'>
): RequestOperationSummary {
  const requestType = asNonEmptyString(request.type) ?? null
  const method = requestFieldValue(request, 'method') ?? null
  const host = requestFieldValue(request, 'host') ?? null
  const path = requestFieldValue(request, 'path') ?? null
  const endpointLabel = joinEndpoint(host, path)

  let operationLabel = requestType ?? endpointLabel ?? 'request'
  if (method && endpointLabel) {
    operationLabel = `${method} ${endpointLabel}`
  } else if (method && requestType && requestType.toUpperCase() !== method) {
    operationLabel = `${method} · ${requestType}`
  } else if (method) {
    operationLabel = method
  } else if (endpointLabel && requestType) {
    operationLabel = `${requestType} · ${endpointLabel}`
  } else if (endpointLabel) {
    operationLabel = endpointLabel
  }

  return {
    requestType,
    method,
    host,
    path,
    endpointLabel,
    operationLabel
  }
}
