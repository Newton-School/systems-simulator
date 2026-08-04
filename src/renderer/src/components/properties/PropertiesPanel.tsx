import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Activity, ArrowLeft, GitBranch, ListTree, Settings, Server, Type, X } from 'lucide-react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  REQUEST_OUTCOME_FAMILIES,
  type RequestOutcomeFamily
} from '../../../../engine/core/requestOutcomeSemantics'
import { describeRequestOperation } from '../../../../engine/core/requestSemantics'
import type { WorkloadProfile } from '../../../../engine/core/types'
import type { FieldPath } from '@renderer/config/fieldConfig'
import type { AnyNodeData, EdgeSimulationData, NodeSimulationMetrics } from '@renderer/types/ui'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import type { CanvasNodeDataV2 } from '../../../../engine/catalog/nodeSpecTypes'
import useStore, { type EdgeFlowState } from '../../store/useStore'
import { PropertiesHeader } from './PropertiesHeader'
import { PropertiesForm } from './PropertiesForm'
import { NodeMetricsDetail, SourceNodeMetricsDetail } from './NodeMetricsDetail'
import { MetricItem } from './MetricItem'
import { EdgePropertiesPanel, type EdgePropertiesPanelValue } from '../ui/EdgePropertiesPanel'
import { TooltipInfo } from '../ui/Tooltip'
import { LocationRollupsPanel } from '@renderer/components/location/LocationRollupsPanel'
import {
  buildEdgeLocalityRollups,
  buildLocationTopology,
  buildNodeLocationRollups,
  describeEdgeLocality,
  formatNodeLocation,
  pathTypeFromContainers,
  type LocationLevel
} from '@renderer/utils/locationTopology'
import { inferEdgeDefaults } from '../../../../engine/defaults/edgeDefaults'
import {
  TEXT_LABEL_NODE_TYPE,
  type CanvasTextLabelData
} from '../../../../engine/catalog/canvasAnnotations'

const EmptyState = () => (
  <div className="h-full bg-nss-panel border-l border-nss-border flex flex-col items-center justify-center text-nss-muted gap-2">
    <Settings size={24} className="opacity-20" />
    <p className="text-xs font-medium uppercase tracking-wide">No Selection</p>
  </div>
)

const CanvasLabelInspector = ({
  data,
  onUpdate,
  onClose
}: {
  data: CanvasTextLabelData
  onUpdate: (text: string) => void
  onClose: () => void
}) => {
  const [value, setValue] = useState(data.text || 'Label')

  useEffect(() => {
    setValue(data.text || 'Label')
  }, [data.text])

  const save = () => {
    const next = value.trim() || 'Label'
    setValue(next)
    onUpdate(next)
  }

  return (
    <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans shadow-xl">
      <div className="p-5 border-b border-nss-border bg-nss-panel">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
            <Type size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold leading-tight text-nss-text">
              Canvas Label
            </h2>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-nss-muted">Annotation</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-nss-border text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <label className="block text-[10px] font-bold uppercase tracking-widest text-nss-muted">
          Text
        </label>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
          className="mt-2 w-full rounded-md border border-nss-border bg-nss-surface px-3 py-2 text-sm font-medium text-nss-text outline-none transition-colors focus:border-nss-primary"
        />
      </div>
    </div>
  )
}

const RUN_INSPECTOR_TOOLTIP = (
  <div className="space-y-1 text-[11px] leading-relaxed">
    <p className="font-semibold text-nss-text">Run Inspector</p>
    <p className="text-nss-text/80">
      A compact summary of the latest run. Use it to spot the slowest node or busiest link, then
      open a node or link card for the detailed view.
    </p>
    <p className="text-nss-muted">
      Deployment summaries below group runtime results by composite containers without treating
      those containers as simulated hops.
    </p>
  </div>
)

function setPathValue(target: AnyNodeData, path: FieldPath, value: unknown): Partial<AnyNodeData> {
  const segments = path.split('.')
  const [root, ...rest] = segments

  if (rest.length === 0) {
    return { [root]: value } as Partial<AnyNodeData>
  }

  const currentRootValue = (target as unknown as Record<string, unknown>)[root]
  const clonedRoot = Array.isArray(currentRootValue)
    ? [...currentRootValue]
    : currentRootValue && typeof currentRootValue === 'object'
      ? { ...(currentRootValue as Record<string, unknown>) }
      : {}

  let cursor: unknown = clonedRoot
  let sourceCursor: unknown = currentRootValue

  for (let index = 0; index < rest.length - 1; index++) {
    const segment = rest[index]
    const nextSegment = rest[index + 1]
    const sourceValue =
      Array.isArray(sourceCursor) && Number.isInteger(Number(segment))
        ? sourceCursor[Number(segment)]
        : sourceCursor && typeof sourceCursor === 'object'
          ? (sourceCursor as Record<string, unknown>)[segment]
          : undefined

    const nextValue = Array.isArray(sourceValue)
      ? [...sourceValue]
      : sourceValue && typeof sourceValue === 'object'
        ? { ...(sourceValue as Record<string, unknown>) }
        : Number.isInteger(Number(nextSegment))
          ? []
          : {}

    if (Array.isArray(cursor)) {
      cursor[Number(segment)] = nextValue
    } else {
      ;(cursor as Record<string, unknown>)[segment] = nextValue
    }

    cursor = nextValue
    sourceCursor = sourceValue
  }

  const lastSegment = rest[rest.length - 1]
  if (Array.isArray(cursor) && Number.isInteger(Number(lastSegment))) {
    cursor[Number(lastSegment)] = value
  } else {
    ;(cursor as Record<string, unknown>)[lastSegment] = value
  }

  return { [root]: clonedRoot } as Partial<AnyNodeData>
}

type PanelTab = 'metrics' | 'config'
type RunInspectorTab = 'nodes' | 'links' | 'locality'

const EDGE_FAILURE_LABELS = {
  connection_refused: 'Connection Refused',
  edge_error_rate: 'Edge Error',
  packet_loss: 'Packet Loss',
  deadline_exceeded: 'Deadline Exceeded'
} as const

const RUN_INSPECTOR_LOCATION_LEVELS: readonly LocationLevel[] = ['region', 'az', 'subnet']

const RUN_INSPECTOR_LOCATION_LEVEL_LABELS: Record<LocationLevel, string> = {
  region: 'Regions',
  az: 'Availability Zones',
  subnet: 'Subnets'
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

function formatRate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0'
}

function formatPercentFromRatio(value: number): string {
  return `${((Number.isFinite(value) ? value : 0) * 100).toFixed(1)}%`
}

function formatPercentValue(value?: number): string {
  return `${(Number.isFinite(value) ? (value ?? 0) : 0).toFixed(1)}%`
}

function formatMs(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'N/A'
}

function formatWeight(value: number): string {
  return `${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`
}

function formatPathTypeLabel(pathType: NonNullable<EdgeSimulationData['pathType']>): string {
  return pathType.replace(/-/g, ' ')
}

function outcomeFamilyLabel(family: RequestOutcomeFamily): string {
  switch (family) {
    case 'success_2xx':
      return '2xx success'
    case 'client_error_4xx':
      return '4xx reject'
    case 'server_error_5xx':
      return '5xx failure'
    case 'network_timeout':
      return 'Timeout'
    case 'network_drop':
      return 'Network drop'
    case 'connection_reset':
      return 'Reset'
    case 'in_flight':
      return 'In flight'
  }
}

function outcomeFamilyTone(family: RequestOutcomeFamily): string {
  switch (family) {
    case 'success_2xx':
      return 'text-nss-success'
    case 'client_error_4xx':
      return 'text-nss-primary'
    case 'network_timeout':
    case 'in_flight':
      return 'text-nss-warning'
    case 'server_error_5xx':
    case 'network_drop':
    case 'connection_reset':
      return 'text-nss-danger'
  }
}

function requestMixPreviewEntries(workload: WorkloadProfile) {
  return [...workload.requestDistribution]
    .map((entry) => ({
      ...describeRequestOperation({ type: entry.type, metadata: entry.metadata }),
      weight: entry.weight
    }))
    .sort((a, b) => b.weight - a.weight)
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index] ?? null
}

function EdgeResultsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">{title}</h3>
      <div className="rounded-lg border border-nss-border bg-nss-surface px-4 py-3">{children}</div>
    </section>
  )
}

function CompactRunSummary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-nss-border bg-nss-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
        {title}
      </div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  )
}

function InspectorTabs({
  active,
  onChange
}: {
  active: PanelTab
  onChange: (tab: PanelTab) => void
}) {
  return (
    <div className="flex gap-1 border-b border-nss-border px-3 pt-3">
      {(['metrics', 'config'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={clsx(
            'rounded-t px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
            active === option
              ? 'bg-nss-surface text-nss-text border border-b-0 border-nss-border'
              : 'text-nss-muted hover:text-nss-text'
          )}
        >
          {option === 'metrics' ? 'Results' : 'Config'}
        </button>
      ))}
    </div>
  )
}

function getNodeLabel(node: { id: string; data: unknown }): string {
  const data = node.data as Partial<CanvasNodeDataV2>
  return data.label?.trim() || node.id
}

function getNodeSubtitle(node: { data: unknown }): string {
  // A source is a traffic generator; its componentType ("api-endpoint") mislabels
  // it, so describe it by role. Every other node shows its real component type
  // from the catalog taxonomy (microservice, database, cache, load-balancer, …).
  if (isSourceNode(node)) return 'source'
  const data = node.data as Partial<CanvasNodeDataV2>
  return data.componentType || data.profile || 'node'
}

function isSourceNode(node: { data: unknown }): boolean {
  const data = node.data as Partial<CanvasNodeDataV2>
  return data.structuralRole === 'source' || data.profile === 'source'
}

// A source doesn't process requests, it emits them. Its real output is the
// number of requests it pushed onto its outgoing edges.
function sourceEmittedCount(
  nodeId: string,
  edges: ReturnType<typeof useStore.getState>['edges'],
  edgeFlowById: Record<string, EdgeFlowState>
): number {
  return edges
    .filter((edge) => edge.source === nodeId)
    .reduce((sum, edge) => sum + (edgeFlowById[edge.id]?.totalAttempted ?? 0), 0)
}

// Neutral, non-health tint so a source is never mistaken for an "Idle" processor.
const SOURCE_BADGE = {
  label: 'Source',
  className: 'border-nss-primary/30 bg-nss-primary/10 text-nss-primary'
}

function getEdgeLabel(
  edge: { source: string; target: string },
  nodeLabelsById: Map<string, string>
): string {
  return `${nodeLabelsById.get(edge.source) ?? edge.source} → ${
    nodeLabelsById.get(edge.target) ?? edge.target
  }`
}

function nodeHealth(metrics: NodeSimulationMetrics): {
  label: string
  className: string
} {
  if ((metrics.errorRate ?? 0) > 0.01 || (metrics.postWarmupTimedOut ?? 0) > 0) {
    return {
      label: 'Errors',
      className: 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger'
    }
  }

  if ((metrics.utilization ?? 0) >= 80 || (metrics.queueDepth ?? 0) > 0) {
    return {
      label: 'Pressure',
      className: 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
    }
  }

  if ((metrics.postWarmupArrived ?? 0) === 0 && (metrics.throughput ?? 0) === 0) {
    return {
      label: 'Idle',
      className: 'border-nss-border bg-nss-surface text-nss-muted'
    }
  }

  return {
    label: 'Not bottleneck',
    className: 'border-nss-success/30 bg-nss-success/10 text-nss-success'
  }
}

function edgeHealth(flow: EdgeFlowState): {
  label: string
  className: string
} {
  if (flow.totalFailed > 0 || flow.failureRatio > 0) {
    return {
      label: 'Errors',
      className: 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger'
    }
  }

  if (flow.totalAttempted === 0) {
    return {
      label: 'Idle',
      className: 'border-nss-border bg-nss-surface text-nss-muted'
    }
  }

  return {
    label: 'Healthy',
    className: 'border-nss-success/30 bg-nss-success/10 text-nss-success'
  }
}

function MiniMetric({
  label,
  value,
  tone = 'text-nss-text'
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-nss-muted">{label}</div>
      <div className={clsx('truncate text-xs font-semibold tabular-nums', tone)}>{value}</div>
    </div>
  )
}

function MiniUtilizationMetric({ value }: { value?: number }) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? clampPercent(value) : 0
  const tone =
    safeValue >= 90 ? 'bg-nss-danger' : safeValue >= 70 ? 'bg-nss-warning' : 'bg-nss-success'
  const textTone =
    safeValue >= 90 ? 'text-nss-danger' : safeValue >= 70 ? 'text-nss-warning' : 'text-nss-text'

  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-nss-muted">Util</div>
      <div className={clsx('truncate text-xs font-semibold tabular-nums', textTone)}>
        {formatPercentValue(value)}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-nss-border/60">
        <div className={clsx('h-full rounded-full', tone)} style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  )
}

function CardBadge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={clsx(
        'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide',
        className
      )}
    >
      {label}
    </span>
  )
}

function InspectorSection({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 rounded-xl border border-nss-border bg-nss-surface p-4">
      <div className="space-y-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted">
          {title}
        </h3>
        {description ? (
          <p className="text-[11px] leading-relaxed text-nss-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

type ConfiguredLocationGroup = {
  level: LocationLevel
  containerId: string
  label: string
  parentLabel?: string
  memberCount: number
  runtimeNodeCount: number
  sourceCount: number
}

type ConfiguredEdgeLocality = {
  edgeId: string
  label: string
  protocol: string
  mode: string
  pathType: NonNullable<EdgeSimulationData['pathType']>
  pathSource: 'Manual' | 'Auto from placement' | 'Auto from defaults'
  localityDetail: string
}

function localityPathSourceBadgeClass(source: ConfiguredEdgeLocality['pathSource']): string {
  switch (source) {
    case 'Manual':
      return 'border-nss-primary/30 bg-nss-primary/10 text-nss-primary'
    case 'Auto from placement':
      return 'border-nss-success/30 bg-nss-success/10 text-nss-success'
    case 'Auto from defaults':
      return 'border-nss-border bg-nss-panel text-nss-muted'
  }
}

function RunInspectorHeaderAction({
  mode,
  onClick
}: {
  mode: 'back' | 'open'
  onClick: () => void
}) {
  const Icon = mode === 'back' ? ArrowLeft : ListTree
  const label = mode === 'back' ? 'Back to Run Inspector' : 'Open Run Inspector'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-lg border border-nss-border bg-nss-surface p-2 text-nss-muted transition-colors hover:border-nss-primary/40 hover:text-nss-primary"
    >
      <Icon size={16} />
    </button>
  )
}

function RunInspector({
  nodes,
  edges,
  metricsByNode,
  edgeFlowById,
  runConfig,
  results,
  activeTab,
  onTabChange,
  onSelectNode,
  onSelectEdge
}: {
  nodes: ReturnType<typeof useStore.getState>['nodes']
  edges: ReturnType<typeof useStore.getState>['edges']
  metricsByNode: Record<string, NodeSimulationMetrics>
  edgeFlowById: Record<string, EdgeFlowState>
  runConfig: ReturnType<typeof useStore.getState>['edgeFlowRunConfig']
  results?: SimulationOutput | null
  activeTab: RunInspectorTab
  onTabChange: (tab: RunInspectorTab) => void
  onSelectNode: (id: string) => void
  onSelectEdge: (id: string) => void
}) {
  const nodeLabelsById = useMemo(
    () => new Map(nodes.map((node) => [node.id, getNodeLabel(node)])),
    [nodes]
  )
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const sourceNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of nodes) {
      const data = node.data as { structuralRole?: unknown; profile?: unknown } | undefined
      if (data?.structuralRole === 'source' || data?.profile === 'source') {
        ids.add(node.id)
      }
    }
    return ids
  }, [nodes])
  const locationTopology = useMemo(() => buildLocationTopology(nodes), [nodes])
  const runtimeNodes = nodes
    .map((node) => ({ node, metrics: metricsByNode[node.id] }))
    .filter((entry): entry is { node: (typeof nodes)[number]; metrics: NodeSimulationMetrics } =>
      Boolean(entry.metrics)
    )
    .sort((a, b) => (b.metrics.throughput ?? 0) - (a.metrics.throughput ?? 0))
  const runtimeEdges = edges
    .map((edge) => ({ edge, flow: edgeFlowById[edge.id] }))
    .filter((entry): entry is { edge: (typeof edges)[number]; flow: EdgeFlowState } =>
      Boolean(entry.flow && entry.flow.totalAttempted > 0)
    )
    .sort((a, b) => b.flow.totalAttempted - a.flow.totalAttempted)
  const totalThroughput = Object.values(metricsByNode).reduce(
    (sum, metric) => sum + (metric.throughput ?? 0),
    0
  )
  const worstNode = runtimeNodes.reduce<(typeof runtimeNodes)[number] | null>((worst, entry) => {
    if (!worst) return entry
    return (entry.metrics.errorRate ?? 0) > (worst.metrics.errorRate ?? 0) ? entry : worst
  }, null)
  const bottleneckSummary = worstNode
    ? [
        `${getNodeLabel(worstNode.node)} needs attention`,
        `${formatPercentValue(worstNode.metrics.utilization)} util`,
        `${formatPercentValue(worstNode.metrics.errorRate)} errors`,
        (worstNode.metrics.queueDepth ?? 0) > 0
          ? `queue ${formatNumber(worstNode.metrics.queueDepth ?? 0)}`
          : null
      ]
        .filter(Boolean)
        .join(' · ')
    : null
  const p95Values = runtimeNodes
    .map((entry) => entry.metrics.latencyNodeLocal?.p95 ?? entry.metrics.latencyP95)
    .filter((value): value is number => value !== undefined && value !== null)
  const worstP95 = p95Values.length > 0 ? Math.max(...p95Values) : null
  const nodeLocationRollups = useMemo(
    () =>
      buildNodeLocationRollups(
        locationTopology,
        runtimeNodes.map(({ node, metrics }) => ({
          nodeId: node.id,
          postWarmupArrived: metrics.postWarmupArrived ?? 0,
          postWarmupProcessed: metrics.postWarmupProcessed ?? 0,
          totalFailures:
            (metrics.postWarmupRejected ?? 0) +
            (metrics.postWarmupTimedOut ?? 0) +
            (metrics.postWarmupConnectionReset ?? 0),
          throughput: metrics.throughput ?? 0,
          utilization:
            typeof metrics.utilization === 'number' && Number.isFinite(metrics.utilization)
              ? metrics.utilization / 100
              : null,
          p95: metrics.latencyNodeLocal?.p95 ?? metrics.latencyP95 ?? null,
          active:
            (metrics.postWarmupArrived ?? 0) > 0 ||
            (metrics.successLatencySamples ?? 0) > 0 ||
            (metrics.timeToErrorSamples ?? 0) > 0,
          isSource: sourceNodeIds.has(node.id)
        }))
      ),
    [locationTopology, runtimeNodes, sourceNodeIds]
  )
  const edgeLocalityRollups = useMemo(
    () =>
      buildEdgeLocalityRollups(
        locationTopology,
        runtimeEdges.map(({ edge, flow }) => ({
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
          data: edge.data,
          attempts: flow.totalAttempted,
          failures: flow.totalFailed,
          p95: percentile(
            flow.recent
              .filter((event) => event.status === 'success')
              .map((event) => event.latencyMs),
            0.95
          )
        }))
      ),
    [locationTopology, runtimeEdges]
  )
  const configuredLocationGroups = useMemo(() => {
    const empty = {
      region: [] as ConfiguredLocationGroup[],
      az: [] as ConfiguredLocationGroup[],
      subnet: [] as ConfiguredLocationGroup[]
    }
    const grouped = new Map<string, ConfiguredLocationGroup>()

    for (const [containerId, level] of locationTopology.containerLevelById.entries()) {
      const parentLocation = locationTopology.containerLocations.get(containerId)
      const parentId =
        level === 'subnet'
          ? parentLocation?.az
          : level === 'az'
            ? parentLocation?.region
            : undefined
      grouped.set(`${level}:${containerId}`, {
        level,
        containerId,
        label: locationTopology.containerLabelById.get(containerId) ?? containerId,
        parentLabel: parentId ? locationTopology.containerLabelById.get(parentId) : undefined,
        memberCount: 0,
        runtimeNodeCount: 0,
        sourceCount: 0
      })
    }

    for (const node of nodes) {
      if (locationTopology.containerLevelById.has(node.id)) continue
      const location = locationTopology.nodeLocations.get(node.id)
      if (!location) continue
      const source = isSourceNode(node)

      for (const level of RUN_INSPECTOR_LOCATION_LEVELS) {
        const containerId =
          level === 'region'
            ? location.regionId
            : level === 'az'
              ? location.azId
              : location.subnetId
        if (!containerId) continue
        const key = `${level}:${containerId}`
        const current = grouped.get(key)
        if (!current) continue
        current.memberCount += 1
        if (source) current.sourceCount += 1
        else current.runtimeNodeCount += 1
      }
    }

    for (const group of grouped.values()) {
      empty[group.level].push(group)
    }

    for (const level of RUN_INSPECTOR_LOCATION_LEVELS) {
      empty[level].sort((a, b) => b.memberCount - a.memberCount || a.label.localeCompare(b.label))
    }

    return empty
  }, [locationTopology, nodes])
  const configuredEdgeLocality = useMemo<ConfiguredEdgeLocality[]>(() => {
    return edges
      .map((edge) => {
        const data = (edge.data as EdgeSimulationData | undefined) ?? {}
        const sourceNodeData = nodeById.get(edge.source)?.data as CanvasNodeDataV2 | undefined
        const targetNodeData = nodeById.get(edge.target)?.data as CanvasNodeDataV2 | undefined
        const defaultPathType = inferEdgeDefaults(sourceNodeData, targetNodeData).pathType
        const placementPathType = pathTypeFromContainers(
          locationTopology.containerLocations,
          edge.source,
          edge.target
        )?.pathType
        const pathType = (data.pathType ?? placementPathType ?? defaultPathType) as NonNullable<
          EdgeSimulationData['pathType']
        >
        const pathSource: ConfiguredEdgeLocality['pathSource'] = data.pathType
          ? 'Manual'
          : placementPathType
            ? 'Auto from placement'
            : 'Auto from defaults'
        const sourceLocation = formatNodeLocation(locationTopology.nodeLocations.get(edge.source))
        const targetLocation = formatNodeLocation(locationTopology.nodeLocations.get(edge.target))
        const locality = describeEdgeLocality(locationTopology, edge)
        const localityDetail =
          sourceLocation && targetLocation
            ? `${sourceLocation} -> ${targetLocation}`
            : locality.detailLabel
              ? locality.detailLabel
              : pathSource === 'Auto from defaults'
                ? 'Placement is incomplete, so this edge falls back to the generic default path class.'
                : 'Placement is configured by composite ancestry.'

        return {
          edgeId: edge.id,
          label: getEdgeLabel(edge, nodeLabelsById),
          protocol: data.protocol ?? 'https',
          mode: data.mode ?? 'synchronous',
          pathType,
          pathSource,
          localityDetail
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [edges, locationTopology, nodeById, nodeLabelsById])
  const requestMix = useMemo(
    () => (runConfig ? requestMixPreviewEntries(runConfig.workload).slice(0, 3) : []),
    [runConfig]
  )
  const outcomeSplit = useMemo(
    () =>
      results
        ? REQUEST_OUTCOME_FAMILIES.map((family) => ({
            family,
            count: results.requestOutcomeBreakdown[family] ?? 0
          }))
            .filter((entry) => entry.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 4)
        : [],
    [results]
  )
  const outcomeTotal = results?.requestOutcomeTotal ?? 0

  return (
    <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans shadow-xl">
      <div className="border-b border-nss-border bg-nss-panel p-5">
        <div className="flex items-center gap-4">
          <div className="shrink-0 rounded-lg bg-nss-primary/10 p-2 text-nss-primary shadow-sm">
            <Activity size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold leading-tight text-nss-text">
                Run Inspector
              </h2>
              <TooltipInfo
                label="Explain run inspector"
                content={RUN_INSPECTOR_TOOLTIP}
                width={320}
              />
            </div>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-nss-muted">
              Live and post-run results
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-nss-border bg-nss-surface px-3 py-2">
            <MiniMetric label="Runtime Throughput" value={`${formatRate(totalThroughput)} rps`} />
          </div>
          <div className="rounded-lg border border-nss-border bg-nss-surface px-3 py-2">
            <MiniMetric
              label="Slowest p95"
              value={worstP95 === null ? 'N/A' : `${worstP95.toFixed(1)}ms`}
            />
          </div>
          <div className="rounded-lg border border-nss-border bg-nss-surface px-3 py-2">
            <MiniMetric label="Nodes in Run" value={runtimeNodes.length.toLocaleString()} />
          </div>
          <div className="rounded-lg border border-nss-border bg-nss-surface px-3 py-2">
            <MiniMetric label="Traffic Links" value={runtimeEdges.length.toLocaleString()} />
          </div>
        </div>

        {worstNode && (
          <div className="mt-3 rounded-lg border border-nss-border bg-nss-surface px-3 py-2 text-xs">
            <div>
              <span className="text-nss-muted">Watch first: </span>
              <button
                type="button"
                onClick={() => onSelectNode(worstNode.node.id)}
                className="font-semibold text-nss-primary hover:underline"
              >
                {getNodeLabel(worstNode.node)}
              </button>
            </div>
            {bottleneckSummary && (
              <div className="mt-1 text-[11px] leading-snug text-nss-muted">
                {bottleneckSummary}
              </div>
            )}
          </div>
        )}

        {(requestMix.length > 0 || outcomeSplit.length > 0) && (
          <div className="mt-3 grid gap-2">
            {requestMix.length > 0 && (
              <CompactRunSummary title="Request Mix">
                {requestMix.map((entry, index) => (
                  <div
                    key={`${entry.operationLabel}-${index}`}
                    className="flex items-start justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-nss-text">{entry.operationLabel}</span>
                    <span className="shrink-0 text-nss-muted">{formatWeight(entry.weight)}</span>
                  </div>
                ))}
              </CompactRunSummary>
            )}

            {outcomeSplit.length > 0 && (
              <CompactRunSummary title="Outcome Split">
                {outcomeSplit.map((entry) => (
                  <div
                    key={entry.family}
                    className="flex items-start justify-between gap-2 text-[11px]"
                  >
                    <span className={clsx('min-w-0 truncate', outcomeFamilyTone(entry.family))}>
                      {outcomeFamilyLabel(entry.family)}
                    </span>
                    <span className="shrink-0 text-nss-muted">
                      {entry.count.toLocaleString()}
                      {outcomeTotal > 0
                        ? ` · ${((entry.count / outcomeTotal) * 100).toFixed(0)}%`
                        : ''}
                    </span>
                  </div>
                ))}
              </CompactRunSummary>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-nss-border px-3 pt-3">
        {(['nodes', 'links', 'locality'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onTabChange(option)}
            className={clsx(
              'rounded-t px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
              activeTab === option
                ? 'bg-nss-surface text-nss-text border border-b-0 border-nss-border'
                : 'text-nss-muted hover:text-nss-text'
            )}
          >
            {option === 'nodes' ? 'Nodes' : option === 'links' ? 'Links' : 'Locality'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {activeTab === 'nodes' ? (
          <div className="space-y-2">
            {runtimeNodes.map(({ node, metrics }) => {
              const source = isSourceNode(node)
              const health = source ? SOURCE_BADGE : nodeHealth(metrics)
              const errorRate = metrics.errorRate ?? 0
              // Offered load + pattern must reflect the ACTUAL run (the workload
              // the user configured in the Run dialog), not the node's static
              // template default. edgeFlowRunConfig.workload is that source of
              // truth; fall back to the node's configured default only for a
              // source that did not drive this run.
              const staticWorkload = (node.data as Partial<CanvasNodeDataV2>).source
                ?.defaultWorkload
              const isRunSource = runConfig?.workload.sourceNodeId === node.id
              const offeredRps = isRunSource ? runConfig?.workload.baseRps : staticWorkload?.baseRps
              const pattern = isRunSource ? runConfig?.workload.pattern : staticWorkload?.pattern
              const emitted = source ? sourceEmittedCount(node.id, edges, edgeFlowById) : 0

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className="w-full rounded-xl border border-nss-border bg-nss-surface p-3 text-left transition-colors hover:border-nss-primary/50 hover:bg-nss-primary/5"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 rounded-lg bg-nss-panel p-2 text-nss-primary">
                      <Server size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-nss-text">
                            {getNodeLabel(node)}
                          </div>
                          <div className="truncate text-[10px] uppercase tracking-wide text-nss-muted">
                            {getNodeSubtitle(node)}
                          </div>
                          {formatNodeLocation(locationTopology.nodeLocations.get(node.id)) && (
                            <div className="truncate text-[10px] text-nss-muted">
                              {formatNodeLocation(locationTopology.nodeLocations.get(node.id))}
                            </div>
                          )}
                        </div>
                        <CardBadge label={health.label} className={health.className} />
                      </div>
                      <div
                        className={clsx('mt-3 grid gap-3', source ? 'grid-cols-3' : 'grid-cols-4')}
                      >
                        {source ? (
                          <>
                            <MiniMetric
                              label="Offered"
                              value={
                                offeredRps === undefined ? 'N/A' : `${formatRate(offeredRps)} rps`
                              }
                            />
                            <MiniMetric label="Pattern" value={pattern ?? 'N/A'} />
                            <MiniMetric label="Emitted" value={formatNumber(emitted)} />
                          </>
                        ) : (
                          <>
                            <MiniMetric
                              label="Throughput"
                              value={`${formatRate(metrics.throughput ?? 0)} rps`}
                            />
                            <MiniMetric
                              label="p95"
                              value={formatMs(metrics.latencyNodeLocal?.p95 ?? metrics.latencyP95)}
                            />
                            <MiniMetric
                              label="Terminated Here"
                              value={formatPercentValue(errorRate)}
                              tone={errorRate > 0 ? 'text-nss-danger' : 'text-nss-text'}
                            />
                            <MiniUtilizationMetric value={metrics.utilization} />
                          </>
                        )}
                      </div>
                      {!source && errorRate > 0 && (
                        <p className="mt-2 text-[10px] leading-snug text-nss-muted">
                          Errors are scoped to requests that terminate at this node; utilization can
                          remain low when requests are rejected or timed out before much work runs.
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : activeTab === 'links' ? (
          <div className="space-y-2">
            {runtimeEdges.map(({ edge, flow }) => {
              const health = edgeHealth(flow)
              const data = (edge.data as EdgeSimulationData | undefined) ?? {}
              const locality = describeEdgeLocality(locationTopology, edge)
              const p95 = percentile(
                flow.recent
                  .filter((event) => event.status === 'success')
                  .map((event) => event.latencyMs),
                0.95
              )

              return (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => onSelectEdge(edge.id)}
                  className="w-full rounded-xl border border-nss-border bg-nss-surface p-3 text-left transition-colors hover:border-nss-primary/50 hover:bg-nss-primary/5"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 rounded-lg bg-nss-panel p-2 text-nss-primary">
                      <GitBranch size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-nss-text">
                            {getEdgeLabel(edge, nodeLabelsById)}
                          </div>
                          <div className="truncate text-[10px] uppercase tracking-wide text-nss-muted">
                            {data.protocol ?? 'edge'} · {data.mode ?? 'synchronous'}
                          </div>
                          {locality.pathType && (
                            <div className="truncate text-[10px] text-nss-muted">
                              {locality.pathType}
                              {locality.detailLabel ? ` · ${locality.detailLabel}` : ''}
                            </div>
                          )}
                        </div>
                        <CardBadge label={health.label} className={health.className} />
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <MiniMetric label="Attempts" value={formatNumber(flow.totalAttempted)} />
                        <MiniMetric
                          label="Success"
                          value={`${formatRate(flow.avgPostWarmupSuccessPerSecond)} rps`}
                        />
                        <MiniMetric
                          label="p95"
                          value={p95 === null ? 'N/A' : `${p95.toFixed(1)}ms`}
                        />
                        <MiniMetric
                          label="Errors"
                          value={formatPercentFromRatio(flow.failureRatio)}
                          tone={flow.failureRatio > 0 ? 'text-nss-danger' : 'text-nss-text'}
                        />
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="space-y-4">
            <InspectorSection
              title="Runtime Deployment & Locality"
              description="Actual run results grouped by composite placement and traffic path class. This is where region, AZ, subnet, and cross-location behavior show up after simulation."
            >
              <LocationRollupsPanel
                nodeRollups={nodeLocationRollups}
                edgeRollups={edgeLocalityRollups}
                title="Deployment & Locality"
              />
            </InspectorSection>

            <InspectorSection
              title="Configured Placement"
              description="Composite containers define locality. These groups show the configured deployment hierarchy, not just the parts that happened to carry traffic in the last run."
            >
              <div className="space-y-3">
                {RUN_INSPECTOR_LOCATION_LEVELS.map((level) => {
                  const groups = configuredLocationGroups[level]
                  return (
                    <div
                      key={level}
                      className="rounded-lg border border-nss-border bg-nss-panel p-3"
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted">
                          {RUN_INSPECTOR_LOCATION_LEVEL_LABELS[level]}
                        </div>
                        <div className="text-[10px] text-nss-muted">{groups.length} configured</div>
                      </div>
                      {groups.length === 0 ? (
                        <div className="text-[11px] text-nss-muted">
                          No composite containers are configured at this level.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {groups.map((group) => (
                            <div
                              key={`${group.level}:${group.containerId}`}
                              className="rounded border border-nss-border bg-nss-surface px-3 py-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-nss-text">
                                    {group.label}
                                  </div>
                                  {group.parentLabel ? (
                                    <div className="truncate text-[10px] text-nss-muted">
                                      under {group.parentLabel}
                                    </div>
                                  ) : null}
                                </div>
                                {group.memberCount === 0 ? (
                                  <CardBadge
                                    label="Empty"
                                    className="border-nss-border bg-nss-panel text-nss-muted"
                                  />
                                ) : null}
                              </div>
                              <div className="mt-2 grid grid-cols-3 gap-3">
                                <MiniMetric
                                  label="Runtime Nodes"
                                  value={group.runtimeNodeCount.toLocaleString()}
                                />
                                <MiniMetric
                                  label="Sources"
                                  value={group.sourceCount.toLocaleString()}
                                />
                                <MiniMetric
                                  label="Members"
                                  value={group.memberCount.toLocaleString()}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </InspectorSection>

            <InspectorSection
              title="Configured Traffic Paths"
              description="Each link resolves to a path class either from an explicit edge override, from composite placement, or from the generic default when placement is incomplete."
            >
              <div className="space-y-2">
                {configuredEdgeLocality.map((entry) => (
                  <div
                    key={entry.edgeId}
                    className="rounded-xl border border-nss-border bg-nss-panel p-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0 rounded-lg bg-nss-surface p-2 text-nss-primary">
                        <GitBranch size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-nss-text">
                              {entry.label}
                            </div>
                            <div className="truncate text-[10px] uppercase tracking-wide text-nss-muted">
                              {entry.protocol} · {entry.mode}
                            </div>
                          </div>
                          <CardBadge
                            label={entry.pathSource}
                            className={localityPathSourceBadgeClass(entry.pathSource)}
                          />
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs font-semibold text-nss-text">
                            {formatPathTypeLabel(entry.pathType)}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] leading-relaxed text-nss-muted">
                          {entry.localityDetail}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </InspectorSection>
          </div>
        )}
      </div>
    </div>
  )
}

function EdgeMetricsDetail({ flow }: { flow: EdgeFlowState }) {
  const successfulRecent = flow.recent.filter((event) => event.status === 'success')
  const p50 = percentile(
    successfulRecent.map((event) => event.latencyMs),
    0.5
  )
  const p95 = percentile(
    successfulRecent.map((event) => event.latencyMs),
    0.95
  )
  const p99 = percentile(
    successfulRecent.map((event) => event.latencyMs),
    0.99
  )
  const failureEntries = Object.entries(flow.totalFailedByCause).sort((a, b) => b[1] - a[1])
  const hasFailures = failureEntries.length > 0

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-nss-primary/20 bg-nss-primary/5 px-4 py-3 text-xs leading-relaxed text-nss-muted">
        <div className="mb-1 flex items-center gap-2 font-semibold text-nss-text">
          <Activity size={14} className="text-nss-primary" />
          Runtime edge inspection
        </div>
        This is post-run traffic behavior for the selected edge. Use Config only when you want to
        edit the topology for the next run.
      </div>

      <EdgeResultsSection title="Traffic">
        <div className="grid grid-cols-2 gap-4">
          <MetricItem label="Attempts" value={formatNumber(flow.totalAttempted)} />
          <MetricItem label="Success" value={formatNumber(flow.totalSuccess)} />
          <MetricItem
            label="Failed"
            value={formatNumber(flow.totalFailed)}
            textColor={flow.totalFailed > 0 ? 'text-nss-danger' : 'text-nss-text'}
          />
          <MetricItem
            label="Error Rate"
            value={formatPercentFromRatio(flow.failureRatio)}
            textColor={flow.failureRatio > 0 ? 'text-nss-danger' : 'text-nss-text'}
          />
        </div>
      </EdgeResultsSection>

      <EdgeResultsSection title="Throughput">
        <div className="grid grid-cols-2 gap-4">
          <MetricItem
            label="Avg Attempted"
            value={formatRate(flow.avgAttemptedPerSecond)}
            unit="rps"
          />
          <MetricItem label="Avg Success" value={formatRate(flow.avgSuccessPerSecond)} unit="rps" />
          <MetricItem
            label="Post-Warmup Success"
            value={formatRate(flow.avgPostWarmupSuccessPerSecond)}
            unit="rps"
          />
          <MetricItem label="Live Window" value={formatRate(flow.successPerSecond)} unit="rps" />
        </div>
      </EdgeResultsSection>

      <EdgeResultsSection title="Sampled Edge Latency">
        <div className="grid grid-cols-3 gap-4">
          <MetricItem
            label="p50"
            value={p50?.toFixed(2) ?? 'N/A'}
            unit={p50 === null ? undefined : 'ms'}
          />
          <MetricItem
            label="p95"
            value={p95?.toFixed(2) ?? 'N/A'}
            unit={p95 === null ? undefined : 'ms'}
          />
          <MetricItem
            label="p99"
            value={p99?.toFixed(2) ?? 'N/A'}
            unit={p99 === null ? undefined : 'ms'}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-nss-muted">
          Latency percentiles use the retained sampled packet stream. Counts and rates above are
          exact for all edge attempts.
        </p>
      </EdgeResultsSection>

      {hasFailures && (
        <EdgeResultsSection title="Failures by Cause">
          <div className="space-y-1.5">
            {failureEntries.map(([cause, count]) => (
              <div key={cause} className="flex items-center justify-between text-xs">
                <span className="text-nss-muted">
                  {EDGE_FAILURE_LABELS[cause as keyof typeof EDGE_FAILURE_LABELS] ?? cause}
                </span>
                <span className="font-semibold tabular-nums text-nss-danger">{count}</span>
              </div>
            ))}
          </div>
        </EdgeResultsSection>
      )}
    </div>
  )
}

export const PropertiesPanel = ({ results = null }: { results?: SimulationOutput | null }) => {
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
  const metricsByNode = useStore((state) => state.simulationMetricsByNode)
  const edgeFlowById = useStore((state) => state.edgeFlowById)
  const edgeFlowRunConfig = useStore((state) => state.edgeFlowRunConfig)
  const runInspectorPinned = useStore((state) => state.runInspectorPinned)
  const runInspectorDrilldownActive = useStore((state) => state.runInspectorDrilldownActive)
  const updateNodeData = useStore((state) => state.updateNodeData)
  const updateEdgeData = useStore((state) => state.updateEdgeData)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const setRunInspectorPinned = useStore((state) => state.setRunInspectorPinned)
  const setRunInspectorDrilldownActive = useStore((state) => state.setRunInspectorDrilldownActive)

  const selectedNode = nodes.find((node) => node.selected)
  const selectedEdge = edges.find((edge) => edge.selected)
  const selectedNodeId = selectedNode?.id
  const selectedEdgeId = selectedEdge?.id
  const selectedEdgeFlow = selectedEdge ? edgeFlowById[selectedEdge.id] : undefined
  const selectedEdgeHasRuntime = Boolean(selectedEdgeFlow && selectedEdgeFlow.totalAttempted > 0)
  const hasRunData =
    Object.keys(metricsByNode).length > 0 ||
    Object.values(edgeFlowById).some((flow) => flow.totalAttempted > 0)
  const metrics = useNodeMetrics(selectedNode?.id ?? '')
  const [tab, setTab] = useState<PanelTab>('metrics')
  const [runInspectorTab, setRunInspectorTab] = useState<RunInspectorTab>('nodes')
  const locationTopology = useMemo(() => buildLocationTopology(nodes), [nodes])
  const returnToRunInspector = () => {
    setRunInspectorPinned(true)
    selectGraphElements({})
  }
  const openRunInspectorDetail = (selection: { nodeId?: string; edgeId?: string }) => {
    selectGraphElements(selection)
    setRunInspectorDrilldownActive(true)
  }
  const inspectorActionMode = runInspectorDrilldownActive ? 'back' : 'open'

  // Selecting a node fresh after a run should open on its results, not
  // whatever tab was left over from the last node - config is where you go
  // on purpose, not by default, once there's something to show.
  useEffect(() => {
    if (runInspectorPinned) {
      return
    }

    if (selectedNodeId) {
      setTab(metrics.hasRuntime ? 'metrics' : 'config')
      return
    }

    if (selectedEdgeId) {
      setTab(selectedEdgeHasRuntime ? 'metrics' : 'config')
    }
  }, [
    runInspectorPinned,
    selectedNodeId,
    selectedEdgeId,
    metrics.hasRuntime,
    selectedEdgeHasRuntime
  ])

  if (hasRunData && runInspectorPinned) {
    return (
      <RunInspector
        nodes={nodes}
        edges={edges}
        metricsByNode={metricsByNode}
        edgeFlowById={edgeFlowById}
        runConfig={edgeFlowRunConfig}
        results={results}
        activeTab={runInspectorTab}
        onTabChange={setRunInspectorTab}
        onSelectNode={(id) => openRunInspectorDetail({ nodeId: id })}
        onSelectEdge={(id) => openRunInspectorDetail({ edgeId: id })}
      />
    )
  }

  if (selectedNode?.type === TEXT_LABEL_NODE_TYPE) {
    return (
      <CanvasLabelInspector
        data={selectedNode.data as CanvasTextLabelData}
        onUpdate={(text) => updateNodeData(selectedNode.id, { text })}
        onClose={() => selectGraphElements({})}
      />
    )
  }

  // A selected node takes precedence over an edge in the shared inspector.
  if (selectedNode) {
    const data = selectedNode.data as AnyNodeData

    const handleUpdate = (path: FieldPath, value: unknown) => {
      updateNodeData(selectedNode.id, setPathValue(data, path, value))
    }

    // A source generates traffic; its runtime detail is offered load + pattern +
    // emitted, read from the actual run (edgeFlowRunConfig) rather than the
    // node's static default — the same source of truth the Run Inspector uses.
    const selectedIsSource = isSourceNode(selectedNode)
    const selectedStaticWorkload = (selectedNode.data as Partial<CanvasNodeDataV2>).source
      ?.defaultWorkload
    const selectedIsRunSource = edgeFlowRunConfig?.workload.sourceNodeId === selectedNode.id
    const selectedOfferedRps = selectedIsRunSource
      ? edgeFlowRunConfig?.workload.baseRps
      : selectedStaticWorkload?.baseRps
    const selectedPattern = selectedIsRunSource
      ? edgeFlowRunConfig?.workload.pattern
      : selectedStaticWorkload?.pattern
    const selectedEmitted = selectedIsSource
      ? sourceEmittedCount(selectedNode.id, edges, edgeFlowById)
      : 0

    // When a node fans out to more than one downstream target, the share of its
    // traffic reaching each target *is* the routing outcome — the honest source of
    // truth for cache-aside hit/miss, DNS weighting, sharding, etc. Surface it so
    // the split is visible instead of being inferred from a misleading node panel.
    const selectedOutboundEdges = edges.filter((edge) => edge.source === selectedNode.id)
    const downstreamSplit =
      selectedOutboundEdges.length > 1
        ? (() => {
            const rows = selectedOutboundEdges.map((edge) => ({
              targetLabel:
                (nodes.find((n) => n.id === edge.target)?.data as { label?: string } | undefined)
                  ?.label ?? edge.target,
              count: edgeFlowById[edge.id]?.totalAttempted ?? 0
            }))
            const total = rows.reduce((sum, row) => sum + row.count, 0)
            return total > 0
              ? rows
                  .map((row) => ({ ...row, share: row.count / total }))
                  .sort((a, b) => b.share - a.share)
              : undefined
          })()
        : undefined

    return (
      <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans shadow-xl">
        <PropertiesHeader
          data={data}
          leadingAction={
            metrics.hasRuntime ? (
              <RunInspectorHeaderAction mode={inspectorActionMode} onClick={returnToRunInspector} />
            ) : null
          }
        />

        {metrics.hasRuntime && <InspectorTabs active={tab} onChange={setTab} />}

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 bg-nss-panel">
          {metrics.hasRuntime && tab === 'metrics' ? (
            selectedIsSource ? (
              <SourceNodeMetricsDetail
                offeredRps={selectedOfferedRps}
                pattern={selectedPattern}
                emitted={selectedEmitted}
              />
            ) : (
              <NodeMetricsDetail
                metrics={metrics}
                configuredCacheHitRate={data.sim?.cacheHitRate}
                downstreamSplit={downstreamSplit}
              />
            )
          ) : (
            <PropertiesForm nodeId={selectedNode.id} data={data} onUpdate={handleUpdate} />
          )}
        </div>
      </div>
    )
  }

  if (selectedEdge) {
    const sourceNodeData = nodes.find((node) => node.id === selectedEdge.source)?.data as
      | CanvasNodeDataV2
      | undefined
    const targetNodeData = nodes.find((node) => node.id === selectedEdge.target)?.data as
      | CanvasNodeDataV2
      | undefined
    const containerDerivedPath = pathTypeFromContainers(
      locationTopology.containerLocations,
      selectedEdge.source,
      selectedEdge.target
    )?.pathType

    const handleEdgeChange = (patch: Partial<EdgePropertiesPanelValue>) => {
      const { label, ...dataPatch } = patch
      const hasDataPatch = Object.keys(dataPatch).length > 0

      updateEdgeData(selectedEdge.id, {
        ...(label !== undefined ? { label } : {}),
        ...(hasDataPatch ? { data: dataPatch as Partial<EdgeSimulationData> } : {})
      })
    }

    return (
      <EdgePropertiesPanel
        title={selectedEdgeHasRuntime && tab === 'metrics' ? 'Edge Results' : 'Edge Properties'}
        leadingAction={
          selectedEdgeHasRuntime ? (
            <RunInspectorHeaderAction mode={inspectorActionMode} onClick={returnToRunInspector} />
          ) : null
        }
        sourceNodeData={sourceNodeData}
        targetNodeData={targetNodeData}
        sourceLocationLabel={formatNodeLocation(
          locationTopology.nodeLocations.get(selectedEdge.source)
        )}
        targetLocationLabel={formatNodeLocation(
          locationTopology.nodeLocations.get(selectedEdge.target)
        )}
        containerDerivedPathType={containerDerivedPath}
        value={{
          label: (selectedEdge.label as string) || '',
          ...(((selectedEdge.data as EdgeSimulationData | undefined) ?? {}) as EdgeSimulationData)
        }}
        onChange={handleEdgeChange}
        onClose={() => selectGraphElements({})}
        tabs={selectedEdgeHasRuntime ? <InspectorTabs active={tab} onChange={setTab} /> : undefined}
      >
        {selectedEdgeHasRuntime && tab === 'metrics' ? (
          selectedEdgeFlow ? (
            <EdgeMetricsDetail flow={selectedEdgeFlow} />
          ) : undefined
        ) : undefined}
      </EdgePropertiesPanel>
    )
  }

  if (hasRunData) {
    return (
      <RunInspector
        nodes={nodes}
        edges={edges}
        metricsByNode={metricsByNode}
        edgeFlowById={edgeFlowById}
        runConfig={edgeFlowRunConfig}
        results={results}
        activeTab={runInspectorTab}
        onTabChange={setRunInspectorTab}
        onSelectNode={(id) => openRunInspectorDetail({ nodeId: id })}
        onSelectEdge={(id) => openRunInspectorDetail({ edgeId: id })}
      />
    )
  }

  return <EmptyState />
}
