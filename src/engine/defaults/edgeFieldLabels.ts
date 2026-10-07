/**
 * Edge field labels shared by the edge properties panel, its help tooltips, the
 * edge-constraint warnings and validation messages, so every surface names an edge
 * field the same way. `unit` is shown next to the label in the panel only.
 */
export const EDGE_FIELD_LABELS = {
  label: { label: 'Label' },
  protocol: { label: 'Protocol' },
  mode: { label: 'Mode' },
  connectorMode: { label: 'Interaction' },
  pathType: { label: 'Path type' },
  condition: { label: 'Condition' },
  latency: { label: 'Latency' },
  latencyModel: { label: 'Latency model' },
  latencyValue: { label: 'Latency', unit: 'ms' },
  latencyMu: { label: 'Latency mu', unit: 'log-space' },
  latencySigma: { label: 'Jitter sigma' },
  bandwidth: { label: 'Bandwidth', unit: 'Mbps' },
  maxConcurrentRequests: { label: 'Max concurrent requests' },
  weight: { label: 'Weight' },
  packetLossRate: { label: 'Packet loss', unit: '%' },
  errorRate: { label: 'Edge error', unit: '%' },
  fanoutFactor: { label: 'Fan-out factor' }
} as const satisfies Record<string, { label: string; unit?: string }>

export type EdgeFieldKey = keyof typeof EDGE_FIELD_LABELS

/** Panel title for an edge field: the label plus its unit, e.g. `Bandwidth (Mbps)`. */
export function edgeFieldTitle(key: EdgeFieldKey): string {
  const entry: { label: string; unit?: string } = EDGE_FIELD_LABELS[key]
  return entry.unit ? `${entry.label} (${entry.unit})` : entry.label
}
