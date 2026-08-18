export const REQUEST_OUTCOME_FAMILIES = [
  'success_2xx',
  'client_error_4xx',
  'server_error_5xx',
  'network_timeout',
  'network_drop',
  'connection_reset',
  'in_flight'
] as const

export type RequestOutcomeFamily = (typeof REQUEST_OUTCOME_FAMILIES)[number]
export type RequestOutcomeStatusClass =
  | '2xx'
  | '4xx'
  | '5xx'
  | 'timeout'
  | 'dropped'
  | 'reset'
  | 'in-flight'

export interface RequestOutcomeClassification {
  family: RequestOutcomeFamily
  statusClass: RequestOutcomeStatusClass
  label: string
  statusCodeHint: string | null
}

type OutcomeStatusLike = 'success' | 'timeout' | 'rejected' | 'connection_reset' | 'in-flight'

const CLIENT_ERROR_HINTS: Record<string, string> = {
  rate_limited: '429',
  security_blocked: '403'
}

const SERVER_ERROR_HINTS: Record<string, string> = {
  capacity_exceeded: '503',
  oom: '503',
  max_concurrency_exceeded: '503',
  no_healthy_targets: '503',
  circuit_breaker_open: '503',
  read_only_node: '503',
  node_failed: '503',
  node_error_rate: '500',
  trait_invalid_reroute: '500',
  test_reject: '500'
}

const NETWORK_DROP_REASONS = new Set(['connection_refused', 'edge_error_rate'])
const NETWORK_TIMEOUT_REASONS = new Set(['packet_loss', 'deadline_exceeded'])

export function createEmptyRequestOutcomeBreakdown(): Record<RequestOutcomeFamily, number> {
  return Object.fromEntries(REQUEST_OUTCOME_FAMILIES.map((key) => [key, 0])) as Record<
    RequestOutcomeFamily,
    number
  >
}

export function classifyRequestOutcome(
  status: OutcomeStatusLike,
  reasonCode?: string | null
): RequestOutcomeClassification {
  switch (status) {
    case 'success':
      return {
        family: 'success_2xx',
        statusClass: '2xx',
        label: '2xx success',
        statusCodeHint: null
      }
    case 'timeout':
      return {
        family: 'network_timeout',
        statusClass: 'timeout',
        label: 'Timeout',
        statusCodeHint: null
      }
    case 'connection_reset':
      return {
        family: 'connection_reset',
        statusClass: 'reset',
        label: 'Reset',
        statusCodeHint: null
      }
    case 'in-flight':
      return {
        family: 'in_flight',
        statusClass: 'in-flight',
        label: 'In flight',
        statusCodeHint: null
      }
    case 'rejected':
      if (reasonCode && Object.hasOwn(CLIENT_ERROR_HINTS, reasonCode)) {
        return {
          family: 'client_error_4xx',
          statusClass: '4xx',
          label: '4xx reject',
          statusCodeHint: CLIENT_ERROR_HINTS[reasonCode]
        }
      }
      if (reasonCode && NETWORK_DROP_REASONS.has(reasonCode)) {
        return {
          family: 'network_drop',
          statusClass: 'dropped',
          label: 'Network drop',
          statusCodeHint: null
        }
      }
      if (reasonCode && NETWORK_TIMEOUT_REASONS.has(reasonCode)) {
        return {
          family: 'network_timeout',
          statusClass: 'timeout',
          label: 'Timeout',
          statusCodeHint: null
        }
      }
      return {
        family: 'server_error_5xx',
        statusClass: '5xx',
        label: '5xx failure',
        statusCodeHint: (reasonCode && SERVER_ERROR_HINTS[reasonCode]) ?? null
      }
  }
}
