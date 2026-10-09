import type { Edge, Node } from 'reactflow'
import type { TopologyJSON } from '../../../../engine/core/types'
import {
  canEditEdgesForQuestion,
  canEditResourcesForQuestion,
  resolveEdgeModel
} from '../../../../engine/analysis/environmentProfile'
import { hasWorkloadSourceConfig } from '../../../../engine/catalog/sourceNodeSemantics'
import { validateTopology } from '../../../../engine/validation/validator'
import { palette } from '../../../../shared/ansi'
import { fieldKeysFor } from '../../../../shared/commands/commands/config'
import type {
  CommandDeps,
  ConfigFieldView,
  ConfigWriteResult,
  EdgeFieldView,
  SimulationAccess,
  ValidationView
} from '../../../../shared/commands/types'
import { getNodeConfigSections, type ResolvedFieldDefinition } from '@renderer/config/fieldConfig'
import {
  isSourceWorkloadFieldPath,
  resolveDisplayedSourceWorkload,
  resolveEffectiveSelectedSourceNodeId,
  updateWorkloadOverrideForField,
  withDisplayedSourceWorkload
} from '@renderer/hooks/useEffectiveSourceWorkload'
import useStore from '@renderer/store/useStore'
import type { AnyNodeData, EdgeSimulationData, ScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import { coerceFieldInput, getPathValue, setPathValue } from '@renderer/utils/nodeFieldEdit'
import { getSavedTopologyBaseline } from './terminalStore'
import { builderPolicyContext } from '@renderer/utils/builderPolicyContext'
import { definitionEditBlockReason } from '../../../../engine/analysis/builderPolicy'

/**
 * CommandDeps for the in-app terminal. Every read goes through the same
 * canvas -> TopologyJSON serializer a run uses, and every write through the
 * same store actions as the properties panel (so it is undoable the same way).
 *
 * Honesty guard: before a write, the canvas is serialized with and without the
 * change. If the engine topology is identical, the setting does not reach the
 * simulation in this context and the write is refused instead of pretending.
 */

/** Panel editors that the terminal cannot express as `set <key> <value>`. */
const LIST_RENDERERS = new Set([
  'routing-rules',
  'request-distribution',
  'traffic-origins',
  'queue-weights',
  'bulkhead-partitions'
])

type StoreState = ReturnType<typeof useStore.getState>

let topologyCache: {
  nodes: Node[]
  edges: Edge[]
  scenario: ScenarioState
  connector: boolean
  result: { topology: TopologyJSON | null; errors: string[] }
} | null = null

function connectorMode(state: StoreState): boolean {
  return resolveEdgeModel(state.environmentProfile, state.activeQuestion) === 'connector'
}

function serialize(
  nodes: Node[],
  edges: Edge[],
  scenario: ScenarioState,
  connector: boolean
): { topology: TopologyJSON | null; errors: string[] } {
  const result = serializeCanvasToTopology(
    { nodes, edges, scenario },
    { connectorMode: connector, lenient: true }
  )
  return { topology: result.topology, errors: result.errors }
}

/** The current canvas as the engine sees it (memoized on store identity). */
export function currentTopology(): { topology: TopologyJSON | null; errors: string[] } {
  const state = useStore.getState()
  const connector = connectorMode(state)
  if (
    topologyCache &&
    topologyCache.nodes === state.nodes &&
    topologyCache.edges === state.edges &&
    topologyCache.scenario === state.scenario &&
    topologyCache.connector === connector
  ) {
    return topologyCache.result
  }
  const result = serialize(state.nodes, state.edges, state.scenario, connector)
  topologyCache = {
    nodes: state.nodes,
    edges: state.edges,
    scenario: state.scenario,
    connector,
    result
  }
  return result
}

function sameEngineTopology(a: TopologyJSON | null, b: TopologyJSON | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validate(topology: TopologyJSON): ValidationView {
  const state = useStore.getState()
  const result = validateTopology(topology, {
    edgeModel: resolveEdgeModel(state.environmentProfile, state.activeQuestion)
  })
  return { valid: result.valid, errors: result.errors ?? [], warnings: result.warnings ?? [] }
}

// ─── Node fields ─────────────────────────────────────────────────────────────

interface ResolvedNodeField {
  view: ConfigFieldView
  definition: ResolvedFieldDefinition
}

function scenarioManagedSource(state: StoreState, nodeId: string, data: AnyNodeData): boolean {
  const selected = resolveEffectiveSelectedSourceNodeId(
    state.nodes as Array<{ id: string; data: Pick<AnyNodeData, 'source'> }>,
    state.scenario.selectedSourceNodeId
  )
  return hasWorkloadSourceConfig(data) && nodeId === selected
}

function displayedData(state: StoreState, nodeId: string, data: AnyNodeData): AnyNodeData {
  if (!scenarioManagedSource(state, nodeId, data)) return data
  const selected = resolveEffectiveSelectedSourceNodeId(
    state.nodes as Array<{ id: string; data: Pick<AnyNodeData, 'source'> }>,
    state.scenario.selectedSourceNodeId
  )
  return withDisplayedSourceWorkload(
    data,
    resolveDisplayedSourceWorkload(nodeId, data, selected, state.scenario.workloadOverride)
  )
}

function resolveNodeFields(nodeId: string): ResolvedNodeField[] {
  const state = useStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return []
  const data = node.data as AnyNodeData
  const formData = displayedData(state, nodeId, data)
  const canEditResources = canEditResourcesForQuestion(
    state.environmentProfile,
    state.activeQuestion
  )
  const canEditExecutionProfile = state.environmentProfile.capabilities.canEditExecutionProfile
  const sections = getNodeConfigSections(formData)
  const entries = sections.flatMap((section) =>
    section.fields
      .filter((field) => canEditExecutionProfile || field.path !== 'sim.resources.workloadKind')
      .map((field) => ({ section, field }))
  )
  const keys = fieldKeysFor(entries.map(({ field }) => field.path))
  return entries.map(({ section, field }) => {
    const raw = getPathValue(formData, field.path)
    const displayValue =
      field.displayAs && raw !== undefined ? field.displayAs.toDisplay(raw, formData) : raw
    const editable =
      !LIST_RENDERERS.has(field.renderer) &&
      field.accuracy !== 'not-simulated' &&
      !(section.id === 'resources' && !canEditResources)
    return {
      definition: field,
      view: {
        path: field.path,
        key: keys.get(field.path) ?? field.path,
        label: field.label,
        section: section.title,
        type: field.type,
        unit: field.unit,
        options: field.options,
        min: field.min,
        max: field.max,
        displayValue,
        editable,
        optional: field.optional
      }
    }
  })
}

function writeNodeField(
  nodeId: string,
  key: string,
  value: unknown,
  describe: string
): ConfigWriteResult {
  const state = useStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return { ok: false, reason: `Node '${nodeId}' is not on the canvas.` }
  const field = resolveNodeFields(nodeId).find((candidate) => candidate.view.key === key)
  if (!field) return { ok: false, reason: `No setting '${key}' on ${nodeId}.` }
  if (!field.view.editable) {
    return {
      ok: false,
      reason:
        field.definition.accuracy === 'not-simulated'
          ? `${field.view.label} is not simulated, so the terminal does not offer it.`
          : `${field.view.label} cannot be changed here (list editor or locked in this environment).`
    }
  }
  const data = node.data as AnyNodeData
  const path = field.view.path
  const connector = connectorMode(state)
  const before = currentTopology().topology

  if (scenarioManagedSource(state, nodeId, data) && isSourceWorkloadFieldPath(path)) {
    const scenario: ScenarioState = {
      ...state.scenario,
      workloadOverride: updateWorkloadOverrideForField(state.scenario.workloadOverride, path, value)
    }
    const after = serialize(state.nodes, state.edges, scenario, connector).topology
    if (sameEngineTopology(before, after)) {
      return { ok: false, reason: `No change: ${describe} leaves the simulated topology as it is.` }
    }
    state.updateScenario(() => scenario)
    return {
      ok: true,
      undoable: false,
      message: 'scenario workload override, like the panel (not on the canvas undo stack)'
    }
  }

  const patch = setPathValue(data, path, value)
  // Same builder-policy guard as the store and the properties panel: a created
  // node's definition (and its trait-backed settings) cannot be changed here
  // when the question locks or disallows them.
  const policy = builderPolicyContext(state)
  if (policy.restrictive && !state.scaffoldNodeIds.includes(nodeId)) {
    const before = data as unknown as Record<string, unknown>
    const blocked = definitionEditBlockReason(
      policy.policy,
      before,
      { ...before, ...(patch as Record<string, unknown>) },
      policy.locked
    )
    if (blocked) return { ok: false, reason: blocked }
  }
  const nextNodes = state.nodes.map((candidate) =>
    candidate.id === nodeId ? { ...candidate, data: { ...data, ...patch } } : candidate
  )
  const after = serialize(nextNodes, state.edges, state.scenario, connector).topology
  if (sameEngineTopology(before, after)) {
    return {
      ok: false,
      reason:
        getPathValue(data, path) === value
          ? `${field.view.key} is already ${describe}.`
          : `${field.view.label} does not change the simulated topology here, so it was not applied.`
    }
  }
  state.updateNodeData(nodeId, patch)
  const written = useStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (written?.data === node.data) {
    return {
      ok: false,
      reason: 'This node is locked in this environment (provided by the question).'
    }
  }
  return { ok: true, undoable: true }
}

// ─── Edge fields ─────────────────────────────────────────────────────────────

interface EdgeFieldSpec {
  key: string
  field: keyof EdgeSimulationData
  label: string
  unit?: string
  options?: readonly string[]
  kind: 'enum' | 'number' | 'text' | 'boolean'
  /** `auto` in the path-type select stores undefined. */
  autoValue?: string
}

const EDGE_FIELDS: readonly EdgeFieldSpec[] = [
  {
    key: 'protocol',
    field: 'protocol',
    label: 'Protocol',
    kind: 'enum',
    options: ['https', 'grpc', 'tcp', 'udp', 'websocket', 'amqp', 'kafka']
  },
  {
    key: 'mode',
    field: 'mode',
    label: 'Interaction mode',
    kind: 'enum',
    options: ['synchronous', 'asynchronous', 'streaming', 'conditional']
  },
  {
    key: 'path-type',
    field: 'pathType',
    label: 'Network path',
    kind: 'enum',
    options: ['auto', 'same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'],
    autoValue: 'auto'
  },
  {
    key: 'latency-model',
    field: 'latencyDistributionType',
    label: 'Latency model',
    kind: 'enum',
    options: ['constant', 'log-normal']
  },
  {
    key: 'latency',
    field: 'latencyValue',
    label: 'Latency (constant model)',
    unit: 'ms',
    kind: 'number'
  },
  { key: 'latency-mu', field: 'latencyMu', label: 'Latency mu (log-normal)', kind: 'number' },
  {
    key: 'latency-sigma',
    field: 'latencySigma',
    label: 'Latency sigma (log-normal)',
    kind: 'number'
  },
  { key: 'bandwidth', field: 'bandwidth', label: 'Bandwidth', unit: 'Mbps', kind: 'number' },
  {
    key: 'max-concurrent',
    field: 'maxConcurrentRequests',
    label: 'Max concurrent requests',
    kind: 'number'
  },
  { key: 'weight', field: 'weight', label: 'Routing weight', kind: 'number' },
  { key: 'packet-loss', field: 'packetLossRate', label: 'Packet loss', unit: '%', kind: 'number' },
  { key: 'error-rate', field: 'errorRate', label: 'Error rate', unit: '%', kind: 'number' },
  { key: 'fanout-factor', field: 'fanoutFactor', label: 'Fan-out factor', kind: 'number' },
  {
    key: 'connection-reuse',
    field: 'connectionReuse',
    label: 'Connection reuse',
    kind: 'enum',
    options: ['off', 'per-request', 'keep-alive', 'persistent'],
    autoValue: 'off'
  },
  {
    key: 'tls',
    field: 'tlsVersion',
    label: 'TLS version',
    kind: 'enum',
    options: ['default', 'none', '1.2', '1.3'],
    autoValue: 'default'
  },
  {
    key: 'tls-resumption',
    field: 'tlsSessionResumption',
    label: 'TLS session resumption',
    kind: 'boolean'
  },
  {
    key: 'idle-timeout',
    field: 'connectionIdleTimeoutMs',
    label: 'Connection idle timeout',
    unit: 'ms',
    kind: 'number'
  },
  { key: 'max-connections', field: 'maxConnections', label: 'Max connections', kind: 'number' },
  {
    key: 'streams-per-connection',
    field: 'maxStreamsPerConnection',
    label: 'Streams per connection',
    kind: 'number'
  },
  {
    key: 'batch-linger',
    field: 'batchLingerMs',
    label: 'Batch linger (Kafka)',
    unit: 'ms',
    kind: 'number'
  },
  {
    key: 'batch-size',
    field: 'batchMaxBytes',
    label: 'Batch size (Kafka)',
    unit: 'bytes',
    kind: 'number'
  },
  { key: 'condition', field: 'condition', label: 'Condition', kind: 'text' }
]

function edgeFields(edgeId: string): EdgeFieldView[] {
  const edge = useStore.getState().edges.find((candidate) => candidate.id === edgeId)
  const data = (edge?.data ?? {}) as EdgeSimulationData
  return EDGE_FIELDS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    options: spec.options,
    authored: data[spec.field]
  }))
}

function writeEdgeField(
  edgeId: string,
  key: string,
  value: unknown,
  describe: string
): ConfigWriteResult {
  const state = useStore.getState()
  const edge = state.edges.find((candidate) => candidate.id === edgeId)
  const spec = EDGE_FIELDS.find((candidate) => candidate.key === key)
  if (!edge) return { ok: false, reason: `Connection '${edgeId}' is not on the canvas.` }
  if (!spec) return { ok: false, reason: `No connection setting '${key}'.` }
  if (connectorMode(state)) {
    return {
      ok: false,
      reason:
        'Connections are plain wires in this environment (connector mode): edge physics are not simulated, so there is nothing to set.'
    }
  }
  if (!canEditEdgesForQuestion(state.environmentProfile, state.activeQuestion)) {
    return {
      ok: false,
      reason:
        'Connection settings are locked in this environment (the edge inspector is read-only too).'
    }
  }
  const connector = connectorMode(state)
  const before = currentTopology().topology
  const patch = { [spec.field]: value } as Partial<EdgeSimulationData>
  const nextEdges = state.edges.map((candidate) =>
    candidate.id === edgeId
      ? { ...candidate, data: { ...(candidate.data ?? {}), ...patch } }
      : candidate
  )
  const after = serialize(state.nodes, nextEdges, state.scenario, connector).topology
  if (sameEngineTopology(before, after)) {
    return {
      ok: false,
      reason: `${spec.label} = ${describe} does not change the simulated topology (already in effect, or not read by the engine with the current settings).`
    }
  }
  state.updateEdgeData(edgeId, { data: patch })
  const written = useStore.getState().edges.find((candidate) => candidate.id === edgeId)
  if (written?.data === edge.data)
    return { ok: false, reason: 'This connection is locked in this environment.' }
  return { ok: true, undoable: true }
}

function parseEdgeValue(
  spec: EdgeFieldSpec,
  raw: string
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const text = raw.trim()
  if (spec.kind === 'enum') {
    const match = spec.options?.find((option) => option.toLowerCase() === text.toLowerCase())
    if (!match)
      return {
        ok: false,
        reason: `'${text}' is not an option. Choose one of: ${spec.options?.join(', ')}.`
      }
    return { ok: true, value: match === spec.autoValue ? undefined : match }
  }
  if (spec.kind === 'text') return { ok: true, value: text === '' ? undefined : text }
  if (spec.kind === 'boolean') {
    const lowered = text.toLowerCase()
    if (['on', 'true', 'yes'].includes(lowered)) return { ok: true, value: true }
    if (['off', 'false', 'no', ''].includes(lowered)) return { ok: true, value: undefined }
    return { ok: false, reason: `Expected on or off, got '${text}'.` }
  }
  const value = Number(text.replace(/%$/, ''))
  if (!Number.isFinite(value) || value < 0)
    return { ok: false, reason: `Expected a non-negative number, got '${text}'.` }
  if (spec.unit === '%' && value > 100)
    return { ok: false, reason: 'Percentages go from 0 to 100.' }
  return { ok: true, value }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export function createAppTerminalDeps(
  sim: SimulationAccess,
  options: { color?: boolean } = {}
): CommandDeps {
  return {
    palette: palette(options.color ?? true),
    host: 'app',
    topology: currentTopology,
    validate,
    savedTopology: getSavedTopologyBaseline,
    sim,
    config: {
      fields: (nodeId) => resolveNodeFields(nodeId).map((field) => field.view),
      set: (nodeId, key, raw) => {
        const state = useStore.getState()
        const node = state.nodes.find((candidate) => candidate.id === nodeId)
        const field = resolveNodeFields(nodeId).find((candidate) => candidate.view.key === key)
        if (!node || !field) return { ok: false, reason: `No setting '${key}' on ${nodeId}.` }
        const parsed = coerceFieldInput(field.definition, raw, node.data as AnyNodeData)
        if (parsed.ok === false) return { ok: false, reason: parsed.reason }
        return writeNodeField(nodeId, key, parsed.value, raw)
      },
      reset: (nodeId, key) => writeNodeField(nodeId, key, undefined, 'the default')
    },
    edges: {
      fields: edgeFields,
      set: (edgeId, key, raw) => {
        const spec = EDGE_FIELDS.find((candidate) => candidate.key === key)
        if (!spec) return { ok: false, reason: `No connection setting '${key}'.` }
        const parsed = parseEdgeValue(spec, raw)
        if (parsed.ok === false) return { ok: false, reason: parsed.reason }
        return writeEdgeField(edgeId, key, parsed.value, raw)
      },
      reset: (edgeId, key) => writeEdgeField(edgeId, key, undefined, 'the default')
    },
    undo: () => {
      const before = useStore.getState().graphHistory.past.length
      useStore.getState().undoGraph()
      return useStore.getState().graphHistory.past.length < before
    },
    redo: () => {
      const before = useStore.getState().graphHistory.future.length
      useStore.getState().redoGraph()
      return useStore.getState().graphHistory.future.length < before
    },
    focusNode: (nodeId) => {
      useStore.getState().selectGraphElements({ nodeId })
      useStore.getState().requestViewportFocus([nodeId])
    }
  }
}
