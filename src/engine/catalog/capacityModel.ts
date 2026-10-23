/**
 * The single owner of "how is this node's capacity defined".
 *
 * A node's concurrency comes from one of three places, and a document picks exactly one by what it
 * authors. The engine, the canvas importer, the canvas serializer and the validator all ask this
 * function, so none of them carries its own idea of a default:
 *
 *   instance        the document authored `resources`: c and K derive from the hardware
 *                   (resourceDerivation.ts).
 *   raw-queue       the document authored a `queue` and no `resources`: the queue is used as
 *                   written. An authored queue is never overridden by a palette default.
 *   engine-default  neither was authored: the engine's built-in single worker applies.
 *
 * Before this existed the canvas replaced a raw queue with a default instance on import (1 authored
 * worker became 64), so one file gave different answers in the UI and in the CLI, the grader and
 * `runSimulation`.
 */
import type { ComponentNode, TopologyJSON } from '../core/types'
import { hasInstanceModel } from '../nodes/resourceDerivation'

export type CapacityModel = 'instance' | 'raw-queue' | 'engine-default' | 'not-applicable'

/** Traffic generators are not capacity-bound servers. */
function isTrafficSource(node: ComponentNode, topology?: Pick<TopologyJSON, 'workload'>): boolean {
  return node.role === 'source' || topology?.workload?.sourceNodeId === node.id
}

export function resolveCapacityModel(
  node: Pick<ComponentNode, 'id' | 'role' | 'queue' | 'resources'>,
  topology?: Pick<TopologyJSON, 'workload'>
): CapacityModel {
  if (isTrafficSource(node as ComponentNode, topology)) return 'not-applicable'
  if (hasInstanceModel(node.resources)) return 'instance'
  return node.queue ? 'raw-queue' : 'engine-default'
}
