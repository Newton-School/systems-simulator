import type { TopologyJSON } from '../core/types'
import { PLACEMENT_STRATEGIES } from '../cluster/clusterScheduler'
import { CLUSTER_COMPONENT_TYPES, resolveScheduledCluster } from '../traits/scheduler'
import { CONSUMER_ORDERING_MODES } from '../traits/changeStream'
import { nodeFieldLabel } from './fieldLabels'
import { nonNegativeNumber, oneOf, positiveNumber, probability } from './validationCopy'

interface PathedError {
  path: string
  message: string
}

const NON_NEGATIVE_MS_FIELDS = [
  'podStartupMs',
  'rescheduleDelayMs',
  'machineProvisionMs',
  'machineFailureAtMs',
  'machineRecoveryAtMs',
  'heartbeatCostMs',
  'pushSendMs'
] as const

const POSITIVE_FIELDS = [
  ['clusterMaxMachines', 'machines'],
  ['machineFailureCount', 'machines'],
  ['telemetryIngestRps', 'events/s'],
  ['pushRecipients', 'connections'],
  ['heldConnections', 'connections'],
  ['maxConnectionsPerInstance', 'connections'],
  ['memPerConnectionKb', 'KB'],
  ['heartbeatIntervalMs', 'ms']
] as const

/**
 * Field checks for the scheduler, telemetry sink, change stream and held
 * connection traits. Engine config is a free record, so a mistyped value would
 * otherwise be silently ignored by the trait's parser.
 */
export function validateTraitConfig(topology: TopologyJSON, errors: PathedError[]): void {
  topology.nodes.forEach((node, index) => {
    const config = node.config ?? {}
    const label = (field: string): string =>
      nodeFieldLabel(`config.${field}`, { componentType: node.type })
    const at = (field: string): string => `nodes[${index}].config.${field}`

    for (const field of NON_NEGATIVE_MS_FIELDS) {
      const value = config[field]
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      ) {
        errors.push({ path: at(field), message: nonNegativeNumber(label(field), 'ms') })
      }
    }
    for (const [field, unit] of POSITIVE_FIELDS) {
      const value = config[field]
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      ) {
        errors.push({ path: at(field), message: positiveNumber(label(field), unit) })
      }
    }
    const sampleRate = config['telemetrySampleRate']
    if (
      sampleRate !== undefined &&
      (typeof sampleRate !== 'number' ||
        !Number.isFinite(sampleRate) ||
        sampleRate < 0 ||
        sampleRate > 1)
    ) {
      errors.push({
        path: at('telemetrySampleRate'),
        message: probability(label('telemetrySampleRate'))
      })
    }
    for (const field of ['telemetryAsyncIngest', 'changeStreamOrdering'] as const) {
      const value = config[field]
      if (value !== undefined && typeof value !== 'boolean') {
        errors.push({ path: at(field), message: `${label(field)} must be either on or off.` })
      }
    }
    const strategy = config['placementStrategy']
    if (strategy !== undefined && !PLACEMENT_STRATEGIES.includes(strategy as never)) {
      errors.push({
        path: at('placementStrategy'),
        message: oneOf(label('placementStrategy'), PLACEMENT_STRATEGIES)
      })
    }
    const ordering = config['consumerOrdering']
    if (ordering !== undefined && !CONSUMER_ORDERING_MODES.includes(ordering as never)) {
      errors.push({
        path: at('consumerOrdering'),
        message: oneOf(label('consumerOrdering'), CONSUMER_ORDERING_MODES)
      })
    }
    const changeKeyField = config['changeKeyField']
    if (
      changeKeyField !== undefined &&
      (typeof changeKeyField !== 'string' || !changeKeyField.trim())
    ) {
      errors.push({
        path: at('changeKeyField'),
        message: `${label('changeKeyField')} must be a field name.`
      })
    }

    const scheduledOn = config['scheduledOn']
    if (scheduledOn !== undefined) {
      if (typeof scheduledOn !== 'string' || !scheduledOn.trim()) {
        errors.push({
          path: at('scheduledOn'),
          message: `${label('scheduledOn')} must name a Kubernetes Cluster component.`
        })
      } else if (!resolveScheduledCluster(topology, node)) {
        errors.push({
          path: at('scheduledOn'),
          message: `${label('scheduledOn')} '${scheduledOn.trim()}' does not name a Kubernetes Cluster component (use its name or id; names must be unique).`
        })
      } else if (resolveScheduledCluster(topology, node)?.id === node.id) {
        errors.push({
          path: at('scheduledOn'),
          message: `${label('scheduledOn')} cannot name the component itself.`
        })
      }
    }
  })
}

/** True when this node is a cluster some workload is scheduled onto (it carries no traffic itself). */
export function isSchedulingCluster(topology: TopologyJSON, nodeId: string): boolean {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !(CLUSTER_COMPONENT_TYPES as readonly string[]).includes(node.type)) return false
  return topology.nodes.some(
    (candidate) => resolveScheduledCluster(topology, candidate)?.id === nodeId
  )
}
