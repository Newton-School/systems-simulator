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
import { inferEdgeDefaults } from '../../../../engine/defaults/edgeDefaults'

export interface EdgePropertiesPanelValue extends EdgeSimulationData {
  label?: string
}

export interface EdgePropertiesPanelProps {
  value: EdgePropertiesPanelValue
  sourceNodeData?: CanvasNodeDataV2
  targetNodeData?: CanvasNodeDataV2
  onChange: (patch: Partial<EdgePropertiesPanelValue>) => void
  onClose: () => void
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
  onChange,
  onClose
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
  const selectedPathType = value.pathType ?? defaults.pathType
  const sourceLabel = sourceNodeData?.label
  const targetLabel = targetNodeData?.label

  return (
    <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans">
      <div className="p-5 border-b border-nss-border bg-nss-panel">
        <div className="flex items-center gap-4">
          <div className="shrink-0 flex items-center justify-center rounded-lg p-2 shadow-sm bg-nss-primary/10 text-nss-primary">
            <Waypoints size={24} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 font-semibold text-sm leading-tight truncate text-nss-text">
                Edge Properties
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

      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
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
              value={selectedPathType}
              onChange={(e) =>
                onChange({ pathType: e.target.value as EdgeSimulationData['pathType'] })
              }
              className={CONTROL_CLASS}
            >
              {['same-rack', 'same-dc', 'cross-zone', 'cross-region', 'internet'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
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
              <FieldLabel label="Latency Mu (log-space)" help={EDGE_PROPERTY_HELP.latencyMu} />
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
            <FieldLabel label="Max Concurrent" help={EDGE_PROPERTY_HELP.maxConcurrentRequests} />
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

        <div className="rounded border border-nss-border bg-nss-surface px-2 py-2 text-[10px] leading-relaxed text-nss-muted">
          {latencySummary}
        </div>
      </div>
    </div>
  )
}
