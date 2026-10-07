/**
 * Edge link transmission model (bandwidth enforcement, issue #181).
 *
 * Each edge is modeled as one FIFO serializing link whose capacity is
 * `edge.bandwidth` in megabits per second (Mbps). A transfer of S bytes holds
 * the link for its transmission time:
 *
 *   transmissionMs = S / (bandwidthMbps * 125)      (1 Mbps = 125 bytes per ms)
 *
 * Transfers that arrive while the link is still serializing an earlier payload
 * wait their turn (store-and-forward, first-come-first-served), so the bytes
 * that leave an edge can never exceed its bandwidth. That wait is reported as
 * the edge's link-queue delay.
 *
 * Not modeled: response payloads (responses do not traverse edges in the
 * engine), packet-level segmentation / TCP windowing, and full-duplex capacity
 * split. The link is a single shared pipe for the request direction.
 */

/** Transmission time of `sizeBytes` over a link of `bandwidthMbps`, in ms. */
export function transmissionTimeMs(sizeBytes: number, bandwidthMbps: number): number {
  if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) {
    return 0
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return 0
  }
  return sizeBytes / (bandwidthMbps * 125)
}

export interface LinkReservation {
  /** Time spent waiting for the link to finish earlier transfers, in µs. */
  queueWaitUs: number
  /** When this transfer starts serializing onto the link, in µs. */
  startUs: number
  /** How long this transfer holds the link, in µs. */
  busyUs: number
}

/**
 * Per-edge FIFO link occupancy. Times are kept as fractional microseconds so a
 * fast link carrying tiny payloads does not drift through integer rounding.
 */
export class LinkSerializer {
  private readonly freeAtUsByEdgeId = new Map<string, number>()

  /**
   * Reserve the link for `busyUs` starting no earlier than `nowUs`. Returns the
   * wait before transmission begins. A zero-length reservation never waits and
   * never moves the link's free time (an effectively unlimited link).
   */
  reserve(edgeId: string, nowUs: number, busyUs: number): LinkReservation {
    if (!(busyUs > 0)) {
      return { queueWaitUs: 0, startUs: nowUs, busyUs: 0 }
    }
    const freeAtUs = this.freeAtUsByEdgeId.get(edgeId) ?? 0
    const startUs = freeAtUs > nowUs ? freeAtUs : nowUs
    this.freeAtUsByEdgeId.set(edgeId, startUs + busyUs)
    return { queueWaitUs: startUs - nowUs, startUs, busyUs }
  }

  /** When the link next becomes free (µs), or 0 when it has never been used. */
  freeAtUs(edgeId: string): number {
    return this.freeAtUsByEdgeId.get(edgeId) ?? 0
  }
}

/**
 * Per-transfer split of edge latency. Every field is a component the engine
 * actually applies; they sum to the transfer's total edge latency (up to 1 µs
 * of rounding). Jitter is not a separate term: it is the spread of the sampled
 * propagation distribution itself.
 */
export interface EdgeLatencyBreakdownSample {
  /** Path-type / configured latency distribution sample (or geo latency). */
  propagationMs: number
  /**
   * Extra delay from the concurrency-utilization model: the propagation sample
   * is inflated by 1 / (1 - u), u = in-flight transfers / maxConcurrentRequests.
   */
  congestionMs: number
  /** Serialization time: request bytes / bandwidth. */
  transmissionMs: number
  /** Waiting for the link to finish earlier transfers (bandwidth contention). */
  linkQueueMs: number
  /** Fixed per-request protocol cost (reduced for streaming links). */
  protocolOverheadMs: number
  /** Second transit after a reliable-protocol packet loss. */
  retransmissionMs: number
}

export const EDGE_LATENCY_COMPONENTS = [
  'propagationMs',
  'congestionMs',
  'transmissionMs',
  'linkQueueMs',
  'protocolOverheadMs',
  'retransmissionMs'
] as const satisfies ReadonlyArray<keyof EdgeLatencyBreakdownSample>

export type EdgeLatencyComponent = (typeof EDGE_LATENCY_COMPONENTS)[number]
