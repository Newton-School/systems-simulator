/**
 * What connector mode throws away.
 *
 * In connector mode (`edgeModel === 'connector'`) every connection is a plain wire: the canvas serializer
 * replaces its latency, loss, errors, fan-out, connection model and batching with neutral values before a
 * run (`neutralizeConnectorEdge` in the renderer's canvasTopologySerializer). That is a deliberate teaching
 * choice, but it used to be silent: a file with a 50 ms link and a 20% error rate imported without a word and
 * then ran as if neither existed. This lists what would be ignored, in the same terms the serializer neutralizes,
 * so the importer can say so.
 *
 * Bandwidth and concurrency limits are also ignored, but every edge carries a default for them, so an authored
 * value cannot be told from the default and they are not used as a trigger.
 */
import type { EdgeDefinition, TopologyJSON } from '../core/types'

export interface IgnoredEdgeSettings {
  edgeId: string
  source: string
  target: string
  /** Plain-words fragments, e.g. "latency 50 ms", "20% errors". */
  settings: string[]
}

function latencyPhrase(edge: EdgeDefinition): string | null {
  const dist = edge.latency?.distribution
  if (!dist) return null
  if (dist.type === 'constant' || dist.type === 'deterministic') {
    return dist.value > 0 ? `latency ${dist.value} ms` : null
  }
  return 'a latency distribution'
}

function percent(rate: number): string {
  const pct = rate * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`
}

export function describeIgnoredEdgeSettings(edge: EdgeDefinition): string[] {
  const settings: string[] = []
  const latency = latencyPhrase(edge)
  if (latency) settings.push(latency)
  if (edge.errorRate > 0) settings.push(`${percent(edge.errorRate)} errors`)
  if (edge.packetLossRate > 0) settings.push(`${percent(edge.packetLossRate)} packet loss`)
  if (edge.fanoutFactor !== undefined && edge.fanoutFactor > 1) {
    settings.push(`fan-out x${edge.fanoutFactor}`)
  }
  if (edge.connection) settings.push('a connection model')
  if (edge.batching) settings.push('batching')
  return settings
}

export function findIgnoredEdgeSettings(
  topology: Pick<TopologyJSON, 'edges'>
): IgnoredEdgeSettings[] {
  return topology.edges.flatMap((edge) => {
    const settings = describeIgnoredEdgeSettings(edge)
    return settings.length > 0
      ? [{ edgeId: edge.id, source: edge.source, target: edge.target, settings }]
      : []
  })
}

/**
 * One notice for the whole document, or null when nothing would be ignored. `labelOf` maps a node id to the
 * name the user sees.
 */
export function connectorModeNotice(
  topology: Pick<TopologyJSON, 'edges'>,
  labelOf: (nodeId: string) => string = (id) => id
): string | null {
  const ignored = findIgnoredEdgeSettings(topology)
  if (ignored.length === 0) return null
  const example = ignored[0]
  const where = `${labelOf(example.source)} -> ${labelOf(example.target)} (${example.settings.join(', ')})`
  const count = ignored.length === 1 ? '1 connection sets' : `${ignored.length} connections set`
  const eg = ignored.length === 1 ? where : `for example ${where}`
  return (
    `Connector mode ignores connection settings: ${count} latency, errors, loss or similar, ${eg}. ` +
    `A run will treat every connection as a plain wire. To simulate them, switch ` +
    `Settings > Environments > Edge model to Network.`
  )
}
