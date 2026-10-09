/**
 * Producer-side record batching on a Kafka edge (issue #181 task 7).
 *
 * Opt-in per edge through `edge.batching`, and only on `protocol: 'kafka'`
 * edges (the Kafka producer's record accumulator). Records sent over the edge
 * join the edge's open batch. The batch is sent as one produce request when it
 * reaches `maxBatchBytes` (Kafka `batch.size`) or `lingerMs` after its first
 * record (Kafka `linger.ms`), whichever comes first.
 *
 * A sent batch is one transfer: it pays one propagation sample, one protocol
 * overhead, serializes its total bytes on the link once and takes one slot of
 * the edge's `maxConcurrentRequests` (Kafka's in-flight requests). That is
 * where the throughput gain comes from, and it is measured: under the same
 * in-flight cap an unbatched edge refuses records a batched one carries. The
 * cost is also measured: every record waits in the accumulator until its batch
 * is sent (reported as batch wait in the edge latency breakdown).
 *
 * Not modeled: compression, producer acks levels (acks=0/1/all need replica
 * acknowledgement timing on the write), buffer.memory back-pressure (a batch
 * that finds the in-flight cap full is refused, like any other transfer), and
 * per-partition batches (one accumulator per edge).
 */

import type { EdgeBatchingConfig, EdgeDefinition } from '../core/types'

export type { EdgeBatchingConfig }

/** Kafka producer default `batch.size` (bytes). */
export const DEFAULT_KAFKA_BATCH_BYTES = 16_384

export interface ResolvedEdgeBatching {
  lingerUs: bigint
  maxBatchBytes: number
}

export function resolveEdgeBatching(edge: EdgeDefinition): ResolvedEdgeBatching | null {
  const config = edge.batching
  if (!config || edge.protocol !== 'kafka') return null
  const lingerMs =
    typeof config.lingerMs === 'number' && Number.isFinite(config.lingerMs) && config.lingerMs >= 0
      ? config.lingerMs
      : 0
  const maxBatchBytes =
    typeof config.maxBatchBytes === 'number' &&
    Number.isFinite(config.maxBatchBytes) &&
    config.maxBatchBytes > 0
      ? config.maxBatchBytes
      : DEFAULT_KAFKA_BATCH_BYTES
  return { lingerUs: BigInt(Math.round(lingerMs * 1000)), maxBatchBytes }
}

export interface OpenEdgeBatch<R> {
  id: string
  edgeId: string
  openedAtUs: bigint
  records: R[]
  bytes: number
}

/** The open (not yet sent) batch per edge. */
export class EdgeBatchAccumulator<R> {
  private readonly openByEdgeId = new Map<string, OpenEdgeBatch<R>>()
  private counter = 0

  /**
   * Add a record. Returns the batch it joined, whether that batch was just
   * opened (the caller schedules its linger flush) and whether it is now full.
   */
  add(
    edgeId: string,
    record: R,
    sizeBytes: number,
    nowUs: bigint,
    maxBatchBytes: number
  ): { batch: OpenEdgeBatch<R>; opened: boolean; full: boolean } {
    let batch = this.openByEdgeId.get(edgeId)
    let opened = false
    if (!batch) {
      batch = {
        id: `${edgeId}#batch-${++this.counter}`,
        edgeId,
        openedAtUs: nowUs,
        records: [],
        bytes: 0
      }
      this.openByEdgeId.set(edgeId, batch)
      opened = true
    }
    batch.records.push(record)
    batch.bytes += Math.max(0, sizeBytes)
    return { batch, opened, full: batch.bytes >= maxBatchBytes }
  }

  /** Close the edge's open batch if it is `batchId` (a stale linger flush finds nothing). */
  take(edgeId: string, batchId: string): OpenEdgeBatch<R> | undefined {
    const batch = this.openByEdgeId.get(edgeId)
    if (!batch || batch.id !== batchId) return undefined
    this.openByEdgeId.delete(edgeId)
    return batch
  }
}
