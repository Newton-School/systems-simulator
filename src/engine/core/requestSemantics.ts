import type { Request } from './events'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export const REQUEST_MATCH_FIELDS = ['type', 'method', 'path', 'host'] as const

export type RequestMatchField = (typeof REQUEST_MATCH_FIELDS)[number]

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

export function requestFieldValue(
  request: RequestSemanticsInput,
  field: RequestMatchField
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

  return asNonEmptyString(request.metadata?.[field])
}

export function requestFieldMatches(
  request: RequestSemanticsInput,
  field: RequestMatchField,
  expectedValue: string
): boolean {
  const actualValue = requestFieldValue(request, field)
  if (!actualValue) {
    return false
  }

  if (field === 'method') {
    return actualValue === expectedValue.trim().toUpperCase()
  }

  return actualValue === expectedValue
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
