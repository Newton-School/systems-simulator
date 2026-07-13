import { EdgeSimulationData } from '@renderer/types/ui'
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
  const selectedMode = value.mode ?? 'synchronous'
  const selectedCondition = value.condition ?? ''
  const protocolWarning = !constraints.allowedProtocols.includes(selectedProtocol)
    ? constraints.reasons.protocol[selectedProtocol]
    : null
  const modeWarning = !constraints.allowedModes.includes(selectedMode)
    ? constraints.reasons.mode[selectedMode]
    : null

  return (
    <div className="absolute top-4 right-4 z-10 w-72 p-4 rounded shadow-xl border border-nss-border bg-nss-panel transition-colors duration-200">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-nss-text uppercase tracking-wider">
          Edge Properties
        </h3>
        <button
          onClick={onClose}
          className="text-nss-muted hover:text-nss-text transition-colors"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] text-nss-muted font-medium">Label</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Protocol</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Mode</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Path Type</label>
            <select
              value={value.pathType ?? defaults.pathType}
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
            <label className="text-[11px] text-nss-muted font-medium">Condition</label>
            <input
              type="text"
              value={selectedCondition}
              onChange={(e) => onChange({ condition: e.target.value })}
              placeholder='request.metadata.origin == "eu-west"'
              disabled={selectedMode !== 'conditional'}
              className={`${CONTROL_CLASS} disabled:opacity-50`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] text-nss-muted font-medium">Latency Mu</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={value.latencyMu ?? defaults.latencyDistribution.mu}
              onChange={(e) => onChange({ latencyMu: Number(e.target.value) })}
              className={CONTROL_CLASS}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-nss-muted font-medium">Latency Sigma</label>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={value.latencySigma ?? defaults.latencyDistribution.sigma}
              onChange={(e) => onChange({ latencySigma: Number(e.target.value) })}
              className={CONTROL_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] text-nss-muted font-medium">Bandwidth (Mbps)</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Max Concurrent</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Packet Loss (%)</label>
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
            <label className="text-[11px] text-nss-muted font-medium">Edge Error (%)</label>
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
          {constraints.reliabilityText}
        </div>
      </div>
    </div>
  )
}
