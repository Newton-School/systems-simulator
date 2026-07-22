import type { MetricLens } from '@renderer/types/ui'

export const METRIC_LENS_TOOLTIPS: Record<MetricLens, string> = {
  concurrency: 'Shows how much work each node can process at once before queueing begins.',
  queueCapacity: 'Shows how much work each node can buffer once concurrency is exhausted.',
  timeout: 'Shows the timeout budget configured on each node before requests fail.',
  traffic: 'Highlights request flow and fail rate across nodes and edges.',
  saturation: 'Highlights utilization headroom and queue pressure.',
  latency: 'Highlights response time so slow hops stand out.',
  errors: 'Highlights failure rate and dominant failure cause.',
  throughput: 'Highlights requests per second across nodes and edges.'
}

export const RESULTS_SUMMARY_TOOLTIPS = {
  requestsPostWarmup:
    "Total requests that entered the system after warmup ended. Warmup samples are excluded so transient startup behavior doesn't skew the metrics.",
  successful: 'Requests that both entered after warmup and eventually completed successfully.',
  throughput:
    'Requests completed per second, averaged over the post-warmup window. If this exceeds your configured Base RPS, something is amplifying traffic.',
  errorRate:
    'Fraction of post-warmup requests that failed. This includes instant rejects, timeout walls, and connection resets.',
  inFlightAtCutoff:
    'Requests that had entered at least one node after warmup, but had not yet completed, timed out, or been rejected when the simulation stopped.',
  offeredArrivalCv:
    'Coefficient of variation of source-generated inter-arrival gaps after warmup. 0 means perfectly even; about 1 is Poisson.'
} as const

export const RESULTS_E2E_PERCENTILE_TOOLTIPS: Record<
  'p50' | 'p90' | 'p95' | 'p99' | 'max',
  string
> = {
  p50: 'Median end-to-end latency. Half of requests were faster than this, half slower.',
  p90: '90th percentile. 10% of requests were slower than this value.',
  p95: '95th percentile. Typical SLO target for latency-sensitive services.',
  p99: '99th percentile tail latency. 1% of requests were slower. Most user-facing SLOs live here.',
  max: 'Slowest observed request. Useful for spotting outliers, not as a reliable tail metric.'
}

export const RESULTS_HEALTH_CHECK_TOOLTIPS = {
  slo: "Compares each node's measured p99 latency and availability against the SLO targets configured on the node.",
  errorRate:
    'Breakdown of rejected, timed-out, and connection-reset requests by node. Rejections happen when the queue is full, timeouts happen when the caller waits too long, and resets happen when in-flight work is explicitly dropped.',
  littlesLaw:
    "Little's Law (L = λ·W) is a queueing-theory identity that must hold in steady state. Violations usually indicate either measurement noise at low utilization, or that the simulation never reached steady state. At very low L, relative errors can be large while absolute differences are sub-request.",
  conservation:
    'Verifies that for every node: arrived = processed + rejected + timed out + connection reset + in-flight at cutoff. Small non-zero in-flight counts are expected when the run ends with requests still being processed.',
  warmup:
    "Checks that warmup duration is at least 10× the max observed p99. If it isn't, post-warmup metrics may still be contaminated by startup transients."
} as const

export const RESULTS_PER_NODE_COLUMN_TOOLTIPS = {
  arrived: 'Requests that reached this node during the post-warmup window.',
  done: 'Requests this node finished processing before the simulation cutoff in the post-warmup window.',
  reject: "Requests turned away because the node's queue was full.",
  timedOut: "Requests that exceeded this node's processing timeout.",
  reset:
    'Requests explicitly terminated with connection_reset while queued, in service, or released from a hung recovery path.',
  errorRate:
    'Rejected + timed out + connection reset, divided by post-warmup arrivals at this node. Read the latency columns with this value, never by themselves.',
  arrivalCV:
    'Coefficient of variation of inter-arrival gaps at this node. 0 = perfectly even; about 1 = Poisson. If this exceeds the offered CV, upstream jitter or contention bunched requests before this node.',
  inFlight:
    'Requests that had arrived at this node but were still queued or processing when the simulation ended.',
  avgQueue: 'Time-averaged queue depth. Requests waiting, not yet being processed.',
  util: 'Fraction of workers busy on average. Near 100% means the node is saturated.',
  p50: 'Median service + queue time at this node only. Does not include network or link latency.',
  p95: '95th percentile per-hop latency at this node.',
  p99: '99th percentile per-hop latency at this node. Per-hop p99s do not sum to end-to-end p99.',
  lambda: 'Arrival rate (λ, requests per second) during the post-warmup window.',
  w: 'Mean time a request spends at this node (W, service + queue). End-to-end latency is roughly the sum of W across the path.',
  l: "Average number of requests concurrently at this node (L). By Little's Law, L = λ·W."
} as const

export const RUNTIME_NODE_METRIC_TOOLTIPS = {
  completedReceived:
    'Requests this node completed out of requests that reached it in the post-warmup window.',
  rejectedTimedOut:
    'Requests dropped because the queue filled, or requests that waited longer than the timeout.'
} as const

export const RESULTS_CONTEXTUAL_TOOLTIPS = {
  percentilesDoNotCompose:
    "Percentiles don't compose. End-to-end p99 is not the sum of per-hop p99s. Use per-node mean (W) for additive decomposition.",
  offeredCvVsArrivalCv:
    "Source-generated inter-arrival CV after warmup. Compare against this node's arrival CV to see how much variance the network added.",
  arrivalCvNode:
    'Delivered inter-arrival CV at this node after warmup. 0 means perfectly even; about 1 is Poisson.'
} as const

export function formatInFlightAtCutoffBanner(count: number): string {
  const noun = count === 1 ? 'request was' : 'requests were'
  return `${count.toLocaleString()} ${noun} still in flight when the simulation hit its duration limit. They are not counted as completed or failed.`
}
