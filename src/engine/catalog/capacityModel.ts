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
import type {
  ComponentNode,
  ProcessingConfig,
  QueueConfig,
  ResourceConfig,
  TopologyJSON
} from '../core/types'
import { deriveNodeConcurrency, hasInstanceModel } from '../nodes/resourceDerivation'
import { instantiateTemplate } from './paletteTemplates'
import { pickTemplateForNode } from './templateForNode'

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

/**
 * What a node of this type runs with when the document says nothing about it: the profile a fresh palette
 * node of that type is built with (its queue, instance and service time). The canvas imports a node by
 * starting from that same template, so using it here is what makes a file run the same everywhere.
 * Returns null for a type with no template.
 */
export interface DefaultProfile {
  queue?: QueueConfig
  resources?: ResourceConfig
  processing?: ProcessingConfig
}

const profileCache = new Map<string, DefaultProfile | null>()

export function defaultProfileFor(node: ComponentNode): DefaultProfile | null {
  const template = pickTemplateForNode(node)
  if (!template) return null
  if (!profileCache.has(template.id)) {
    const sim = instantiateTemplate(template.id).sim
    profileCache.set(
      template.id,
      sim ? { queue: sim.queue, resources: sim.resources, processing: sim.processing } : null
    )
  }
  const profile = profileCache.get(template.id) ?? null
  return profile ? structuredClone(profile) : null
}

/**
 * Return the topology with each node's missing capacity and service time filled from its default profile.
 * Anything the document authored is left exactly as written, so this is idempotent and never overrides an
 * authored queue, instance or service time:
 *   - no queue and no resources (the `engine-default` model): the profile's queue and resources
 *   - no processing: the profile's service-time distribution and timeout
 */
export function normalizeTopology(topology: TopologyJSON): TopologyJSON {
  let changed = false
  const nodes = topology.nodes.map((node) => {
    const model = resolveCapacityModel(node, topology)
    if (model === 'not-applicable') return node
    const needsCapacity = model === 'engine-default'
    if (!needsCapacity && node.processing) return node
    const profile = defaultProfileFor(node)
    if (!profile) return node
    const next = { ...node }
    if (needsCapacity) {
      if (profile.queue) next.queue = profile.queue
      if (profile.resources) next.resources = profile.resources
    }
    if (!node.processing && profile.processing) next.processing = profile.processing
    if (
      next.queue === node.queue &&
      next.resources === node.resources &&
      next.processing === node.processing
    ) {
      return node
    }
    changed = true
    return next
  })
  return changed ? { ...topology, nodes } : topology
}

function meanMs(distribution: ProcessingConfig['distribution'] | undefined): number | null {
  if (!distribution) return null
  if (distribution.type === 'constant' || distribution.type === 'deterministic')
    return distribution.value
  if (distribution.type === 'exponential') return 1 / distribution.lambda
  return null
}

function roundedMs(ms: number): string {
  return `${ms >= 10 ? Math.round(ms) : Math.round(ms * 10) / 10} ms`
}

/**
 * Plain words for what a node gets from its default profile, for the validator. `capacity` reads like
 * "8 concurrent workers" and `service` like "about 3.6 ms per request, 144 ms timeout". Null when the type
 * has no template.
 */
export function describeDefaultProfile(
  node: ComponentNode
): { capacity: string; service: string } | null {
  const profile = defaultProfileFor(node)
  if (!profile) return null
  const workers = deriveNodeConcurrency({
    ...node,
    queue: profile.queue,
    resources: profile.resources
  }).effectiveC
  const mean = meanMs(profile.processing?.distribution)
  const timeout = profile.processing?.timeout
  return {
    capacity: `${workers} concurrent worker${workers === 1 ? '' : 's'}`,
    service: `${mean === null ? 'a default service time' : `about ${roundedMs(mean)} per request`}${
      timeout === undefined ? '' : `, ${roundedMs(timeout)} timeout`
    }`
  }
}
