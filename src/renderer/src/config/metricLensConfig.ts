import type { MetricLens, PreRunMetricLens, RuntimeMetricLens } from '@renderer/types/ui'

export type MetricLensOption<T extends MetricLens = MetricLens> = {
  id: T
  label: string
}

export const PRE_RUN_LENSES: Array<MetricLensOption<PreRunMetricLens>> = [
  { id: 'concurrency', label: 'Concurrency' },
  { id: 'queueCapacity', label: 'Queue Capacity' },
  { id: 'timeout', label: 'Timeout' }
]

export const RUNTIME_LENSES: Array<MetricLensOption<RuntimeMetricLens>> = [
  { id: 'traffic', label: 'Traffic' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'latency', label: 'Latency' },
  { id: 'errors', label: 'Errors' },
  { id: 'throughput', label: 'Throughput' }
]

const METRIC_LENS_LABELS: Record<MetricLens, string> = {
  concurrency: 'Concurrency',
  queueCapacity: 'Queue Capacity',
  timeout: 'Timeout',
  traffic: 'Traffic',
  saturation: 'Saturation',
  latency: 'Latency',
  errors: 'Errors',
  throughput: 'Throughput'
}

export function getMetricLensLabel(lens: MetricLens): string {
  return METRIC_LENS_LABELS[lens]
}
