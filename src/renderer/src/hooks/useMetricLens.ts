import useStore from '@renderer/store/useStore'

export function useMetricLens() {
  return useStore((s) => s.metricLens)
}
