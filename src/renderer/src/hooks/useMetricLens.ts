import useStore from '@renderer/store/useStore'
import { isPreRunMetricLens } from '@renderer/components/nodes/nodePresentation'
import { useClassroomActive } from './useClassroom'

export function useMetricLens() {
  const lens = useStore((s) => s.metricLens)
  // Classroom mode has no engine knobs to show, so the pre-run lenses (instance,
  // workers, queue, timeout, cost) fall back to the traffic view.
  const classroom = useClassroomActive()
  return classroom && isPreRunMetricLens(lens) ? 'traffic' : lens
}
