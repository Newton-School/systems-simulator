import type { ReactNode } from 'react'
import { Waypoints } from 'lucide-react'
import { EdgeSimulationData } from '@renderer/types/ui'
import { TooltipInfo } from '@renderer/components/ui/Tooltip'
import {
  EDGE_PROPERTY_HELP,
  type EdgeHelpEntry,
  inferCanvasEdgeMode
} from '@renderer/config/edgeSemantics'
import type { CanvasNodeDataV2 } from '../../../../engine/catalog/nodeSpecTypes'
import { getEdgeConstraints } from '../../../../engine/defaults/edgeConstraints'
import {
  getPathTypeLatencyProfile,
  inferEdgeDefaults
} from '../../../../engine/defaults/edgeDefaults'

export interface EdgePropertiesPanelValue extends EdgeSimulationData {
  label?: string
}

export interface EdgePropertiesPanelProps {
  value: EdgePropertiesPanelValue
  sourceNodeData?: CanvasNodeDataV2
  targetNodeData?: CanvasNodeDataV2
  sourceLocationLabel?: string | null
  targetLocationLabel?: string | null
  containerDerivedPathType?: EdgeSimulationData['pathType']
  title?: string
  leadingAction?: ReactNode
  tabs?: ReactNode
  children?: ReactNode
  onChange: (patch: Partial<EdgePropertiesPanelValue>) => void
  onClose: () => void
  /** Lock the config form (edge results stay interactive). V1 assignment mode. */
  readOnly?: boolean
}

const CONTROL_CLASS =
  'w-full px-2 py-1 text-xs rounded border bg-nss-input-bg border-nss-border text-nss-text placeholder-nss-placeholder focus:outline-none focus:border-nss-info focus:ring-1 focus:ring-nss-info transition-all'

const EDGE_PROTOCOL_OPTIONS: NonNullable<EdgeSimulationData['protocol']>[] = [
  'https',
  'grpc',
  'tcp',
  'udp',
  'websocket',
  'amqp',
  'kafka'
]

const EDGE_MODE_OPTIONS: NonNullable<EdgeSimulationData['mode']>[] = [
  'synchronous',
  'asynchronous',
  'streaming',
  'conditional'
]

const FIELD_LABEL_CLASS = 'text-[11px] text-nss-muted font-medium'
function logNormalJitterCv(sigma: number): number {
  return Math.sqrt(Math.max(0, Math.exp(sigma * sigma) - 1))
}

function formatPathTypeLabel(pathType: NonNullable<EdgeSimulationData['pathType']>): string {
  return pathType.replace(/-/g, ' ')
}

function EdgeTooltipContent({ entry }: { entry: EdgeHelpEntry }) {
  return (
    <div className="space-y-1 text-[11px] leading-relaxed">
      <p className="font-semibold text-nss-text">{entry.title}</p>
      <p className="text-nss-text/80">{entry.summary}</p>
      <p className="text-nss-muted">{entry.simulationEffect}</p>
      {entry.note ? <p className="text-nss-muted">{entry.note}</p> : null}
    </div>
  )
}

function FieldLabel({ label, help }: { label: string; help: EdgeHelpEntry }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className={FIELD_LABEL_CLASS}>{label}</label>
      <TooltipInfo
        label={`${label} help`}
        width={320}
        content={<EdgeTooltipContent entry={help} />}
      />
    </div>
  )
}

export const EdgePropertiesPanel = ({
  value,
  sourceNodeData,
  targetNodeData,
  sourceLocationLabel,
  targetLocationLabel,
  containerDerivedPathType,
  title = 'Edge Properties',
  leadingAction,
  tabs,
  children,
  onChange,
  onClose,
  readOnly = false
}: EdgePropertiesPanelProps) => {
  const defaults = inferEdgeDefaults(sourceNodeData, targetNodeData)
  const constraints = getEdgeConstraints(
    sourceNodeData?.componentType,
    targetNodeData?.componentType
  )
  const selectedProtocol = value.protocol ?? defaults.protocol
  const selectedMode = inferCanvasEdgeMode(
    { mode: value.mode, protocol: selectedProtocol },
    targetNodeData
  )
  const selectedCondition = value.condition ?? ''
  const selectedLatencyDistributionType =
    value.latencyDistributionType ?? (value.latencyValue !== undefined ? 'constant' : 'log-normal')
  const selectedLatencyMu = value.latencyMu ?? defaults.latencyDistribution.mu
  const selectedLatencySigma = value.latencySigma ?? defaults.latencyDistribution.sigma
  const defaultConstantLatencyMs = Number(Math.exp(defaults.latencyDistribution.mu).toFixed(2))
  const selectedLatencyValue = value.latencyValue ?? defaultConstantLatencyMs
  const jitterCv = logNormalJitterCv(selectedLatencySigma)
  const sourceLabel = sourceNodeData?.label
  const targetLabel = targetNodeData?.label
  const protocolWarning = !constraints.allowedProtocols.includes(selectedProtocol)
    ? constraints.reasons.protocol[selectedProtocol]
    : null
  const modeWarning = !constraints.allowedModes.includes(selectedMode)
    ? constraints.reasons.mode[selectedMode]
    : null
  const latencySummary =
    selectedLatencyDistributionType === 'constant'
      ? `Constant transit: ${selectedLatencyValue.toFixed(2)}ms on every hop. Use this for a clean, no-jitter edge.`
      : `Log-normal transit: median hop ≈ ${Math.exp(selectedLatencyMu).toFixed(2)}ms, jitter CV ≈ ${jitterCv.toFixed(2)}. Mu is log-space; sigma controls spread.`
  const autoPathType = (containerDerivedPathType ?? defaults.pathType) as NonNullable<
    EdgeSimulationData['pathType']
  >
  const selectedPathType = (value.pathType ?? autoPathType) as NonNullable<
    EdgeSimulationData['pathType']
  >
  const autoPathSource = containerDerivedPathType ? 'placement' : 'defaults'
  const autoPathOptionLabel =
    autoPathSource === 'placement' ? 'Auto (from placement)' : 'Auto (from defaults)'
  const locationSentence =
    sourceLocationLabel && targetLocationLabel
      ? `${sourceLabel || 'Source'} is in ${sourceLocationLabel}; ${targetLabel || 'Target'} is in ${targetLocationLabel}.`
      : null
  const pathTypeHelpText =
    value.pathType === undefined
      ? autoPathSource === 'placement'
        ? `Auto selected ${formatPathTypeLabel(selectedPathType)} from composite placement. ${locationSentence ?? ''}`.trim()
        : `Auto is using the generic ${formatPathTypeLabel(selectedPathType)} default because both endpoints are not fully placed inside region / AZ / subnet containers.`
      : autoPathSource === 'placement'
        ? `Manual override. Composite placement would resolve this edge as ${formatPathTypeLabel(containerDerivedPathType!)}. ${locationSentence ?? ''} Switch back to Auto to follow placement again.`
        : `Manual override. Auto would fall back to the generic ${formatPathTypeLabel(defaults.pathType)} default because placement does not fully resolve this hop.`
  // "Auto" latency = no explicit latency fields at all, so the serializer derives
  // it from the (possibly location-derived) path type. This is always reachable
  // from the toggle below, which is what makes a manual override reversible.
  const isLatencyAuto =
    value.latencyMu === undefined &&
    value.latencySigma === undefined &&
    value.latencyValue === undefined &&
    value.latencyDistributionType === undefined
  const derivedLatencyMedianMs = Math.exp(getPathTypeLatencyProfile(selectedPathType).mu)
  const autoLatencyText = (() => {
    if (!isLatencyAuto) return null
    if (value.pathType !== undefined) {
      return `Auto latency is using the ${formatPathTypeLabel(selectedPathType)} profile from the edge path type. Median transit ≈ ${derivedLatencyMedianMs.toFixed(2)}ms.`
    }
    if (autoPathSource === 'placement') {
      return `Auto latency is using the ${formatPathTypeLabel(selectedPathType)} profile derived from composite placement. ${locationSentence ?? ''} Median transit ≈ ${derivedLatencyMedianMs.toFixed(2)}ms.`
    }
    return `Auto latency is using the ${formatPathTypeLabel(selectedPathType)} profile from the generic edge default because placement does not resolve this hop. Median transit ≈ ${derivedLatencyMedianMs.toFixed(2)}ms.`
  })()

  return (
    <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans">
      <div className="p-5 border-b border-nss-border bg-nss-panel">
        <div className="flex items-center gap-4">
          {leadingAction}
          <div className="shrink-0 flex items-center justify-center rounded-lg p-2 shadow-sm bg-nss-primary/10 text-nss-primary">
            <Waypoints size={24} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 font-semibold text-sm leading-tight truncate text-nss-text">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="shrink-0 text-nss-muted hover:text-nss-text transition-colors"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
            {(sourceLabel || targetLabel) && (
              <p className="mt-1 truncate text-[10px] uppercase tracking-wide text-nss-muted">
                {sourceLabel || 'Source'} → {targetLabel || 'Target'}
              </p>
            )}
          </div>
        </div>
      </div>

      {tabs}

      {children ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 bg-nss-panel">{children}</div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
          {readOnly && (
            <div className="rounded border border-nss-border bg-nss-surface px-3 py-2 text-[11px] leading-relaxed text-nss-muted">
              🔒 Edge configuration is locked for this assignment. Edit nodes, storage types, and
              worker/replica counts instead — you can still inspect edge results after a run.
            </div>
          )}
          <fieldset disabled={readOnly} className="m-0 space-y-3 border-0 p-0 disabled:opacity-70">
            <div className="space-y-1">
              <FieldLabel label="Label" help={EDGE_PROPERTY_HELP.label} />
              <input
                type="text"
                value={value.label ?? ''}
                onChange={(e) => onChange({ label: e.target.value })}
                placeholder="e.g. HTTP, gRPC"
                className={CONTROL_CLASS}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Protocol" help={EDGE_PROPERTY_HELP.protocol} />
                <select
                  value={selectedProtocol}
                  onChange={(e) =>
                    onChange({ protocol: e.target.value as EdgeSimulationData['protocol'] })
                  }
                  className={CONTROL_CLASS}
                >
                  {EDGE_PROTOCOL_OPTIONS.map((option) => (
                    <option
                      key={option}
                      value={option}
                      disabled={!constraints.allowedProtocols.includes(option)}
                    >
                      {option}
                      {!constraints.allowedProtocols.includes(option)
                        ? ` - ${constraints.reasons.protocol[option]}`
                        : ''}
                    </option>
                  ))}
                </select>
                {protocolWarning && (
                  <p className="text-[10px] leading-relaxed text-nss-warning">{protocolWarning}</p>
                )}
              </div>

              <div className="space-y-1">
                <FieldLabel label="Mode" help={EDGE_PROPERTY_HELP.mode} />
                <select
                  value={selectedMode}
                  onChange={(e) => onChange({ mode: e.target.value as EdgeSimulationData['mode'] })}
                  className={CONTROL_CLASS}
                >
                  {EDGE_MODE_OPTIONS.map((option) => (
                    <option
                      key={option}
                      value={option}
                      disabled={!constraints.allowedModes.includes(option)}
                    >
                      {option}
                      {!constraints.allowedModes.includes(option)
                        ? ` - ${constraints.reasons.mode[option]}`
                        : ''}
                    </option>
                  ))}
                </select>
                {modeWarning && (
                  <p className="text-[10px] leading-relaxed text-nss-warning">{modeWarning}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Path Type" help={EDGE_PROPERTY_HELP.pathType} />
                <select
                  value={value.pathType ?? 'auto'}
                  onChange={(e) =>
                    onChange({
                      pathType:
                        e.target.value === 'auto'
                          ? undefined
                          : (e.target.value as EdgeSimulationData['pathType'])
                    })
                  }
                  className={CONTROL_CLASS}
                >
                  <option value="auto">{autoPathOptionLabel}</option>
                  {['same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'].map(
                    (option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    )
                  )}
                </select>
                <p className="text-[10px] leading-relaxed text-nss-muted">{pathTypeHelpText}</p>
              </div>
              <div className="space-y-1">
                <FieldLabel label="Condition" help={EDGE_PROPERTY_HELP.condition} />
                <input
                  type="text"
                  value={selectedCondition}
                  onChange={(e) => onChange({ condition: e.target.value })}
                  placeholder='request.metadata.origin == "eu-west"'
                  className={CONTROL_CLASS}
                />
              </div>
            </div>

            <div className="space-y-1">
              <FieldLabel label="Latency" help={EDGE_PROPERTY_HELP.latencyModel} />
              <select
                value={isLatencyAuto ? 'auto' : 'manual'}
                onChange={(e) =>
                  onChange(
                    e.target.value === 'auto'
                      ? {
                          latencyDistributionType: undefined,
                          latencyValue: undefined,
                          latencyMu: undefined,
                          latencySigma: undefined
                        }
                      : {
                          latencyDistributionType: 'log-normal',
                          latencyMu: selectedLatencyMu,
                          latencySigma: selectedLatencySigma
                        }
                  )
                }
                className={CONTROL_CLASS}
              >
                <option value="auto">Auto (from path type)</option>
                <option value="manual">Manual</option>
              </select>
            </div>

            {isLatencyAuto ? (
              <p className="text-[10px] leading-relaxed text-nss-muted">
                {autoLatencyText} Switch to Manual to set an explicit latency; you can switch back
                to Auto at any time.
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  <FieldLabel label="Latency Model" help={EDGE_PROPERTY_HELP.latencyModel} />
                  <select
                    value={selectedLatencyDistributionType}
                    onChange={(e) =>
                      onChange({
                        latencyDistributionType: e.target
                          .value as EdgeSimulationData['latencyDistributionType'],
                        ...(e.target.value === 'constant' && value.latencyValue === undefined
                          ? { latencyValue: defaultConstantLatencyMs }
                          : {})
                      })
                    }
                    className={CONTROL_CLASS}
                  >
                    <option value="log-normal">Log-normal (jittered)</option>
                    <option value="constant">Constant (no jitter)</option>
                  </select>
                </div>

                {selectedLatencyDistributionType === 'constant' ? (
                  <div className="space-y-1">
                    <FieldLabel label="Latency (ms)" help={EDGE_PROPERTY_HELP.latencyValue} />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={selectedLatencyValue}
                      onChange={(e) => onChange({ latencyValue: Number(e.target.value) })}
                      className={CONTROL_CLASS}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <FieldLabel
                        label="Latency Mu (log-space)"
                        help={EDGE_PROPERTY_HELP.latencyMu}
                      />
                      <input
                        type="number"
                        step={0.01}
                        value={selectedLatencyMu}
                        onChange={(e) => onChange({ latencyMu: Number(e.target.value) })}
                        className={CONTROL_CLASS}
                      />
                    </div>
                    <div className="space-y-1">
                      <FieldLabel label="Jitter Sigma" help={EDGE_PROPERTY_HELP.latencySigma} />
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={selectedLatencySigma}
                        onChange={(e) => onChange({ latencySigma: Number(e.target.value) })}
                        className={CONTROL_CLASS}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Bandwidth (Mbps)" help={EDGE_PROPERTY_HELP.bandwidth} />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={value.bandwidth ?? defaults.bandwidth}
                  onChange={(e) => onChange({ bandwidth: Number(e.target.value) })}
                  className={CONTROL_CLASS}
                />
              </div>
              <div className="space-y-1">
                <FieldLabel
                  label="Max Concurrent"
                  help={EDGE_PROPERTY_HELP.maxConcurrentRequests}
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={value.maxConcurrentRequests ?? defaults.maxConcurrentRequests}
                  onChange={(e) => onChange({ maxConcurrentRequests: Number(e.target.value) })}
                  className={CONTROL_CLASS}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <FieldLabel label="Packet Loss (%)" help={EDGE_PROPERTY_HELP.packetLossRate} />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={value.packetLossRate ?? defaults.packetLossRatePercent}
                  onChange={(e) => onChange({ packetLossRate: Number(e.target.value) })}
                  className={CONTROL_CLASS}
                />
              </div>
              <div className="space-y-1">
                <FieldLabel label="Edge Error (%)" help={EDGE_PROPERTY_HELP.errorRate} />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={value.errorRate ?? defaults.errorRatePercent}
                  onChange={(e) => onChange({ errorRate: Number(e.target.value) })}
                  className={CONTROL_CLASS}
                />
              </div>
            </div>

            {!isLatencyAuto && (
              <div className="rounded border border-nss-border bg-nss-surface px-2 py-2 text-[10px] leading-relaxed text-nss-muted">
                {latencySummary}
              </div>
            )}
          </fieldset>
        </div>
      )}
    </div>
  )
}
