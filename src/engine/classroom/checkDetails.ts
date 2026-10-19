/**
 * Plain-language failure details for Classroom checks. The rubric reports a
 * failed check in engine terms ("actual 1 does not satisfy
 * invariantViolations.count == 0"); a student needs the component and the
 * number: "Server ×12: 83.3% (target 80%)".
 */
import type { SimulationVerdict } from '../analysis/verdict'
import type { TopologyJSON } from '../core/types'
import { componentTypeSatisfies } from '../catalog/componentFamilies'
import { formatPercent } from './givensTable'
import { classroomCopies, type ClassroomCheck, type ClassroomSettings } from './types'

const DEFAULT_MAX_ERROR_RATE = 0.01

export function classroomFailureDetail(
  check: ClassroomCheck,
  verdict: SimulationVerdict,
  topology: TopologyJSON,
  settings: ClassroomSettings | undefined
): string | undefined {
  switch (check.template) {
    case 'within-target-utilization': {
      const target = settings?.targets?.maxUtilization ?? 1
      const over = topology.nodes
        .filter((node) => check.component && componentTypeSatisfies(node.type, check.component))
        .map((node) => ({ node, utilization: verdict.perNode[node.id]?.utilization ?? 0 }))
        .filter(({ utilization }) => utilization > target + 1e-9)
      if (over.length === 0) return undefined
      const shown = over.slice(0, 3).map(({ node, utilization }) => {
        const copies = classroomCopies(node)
        return `${node.label}${copies > 1 ? ` ×${copies}` : ''}: ${formatPercent(utilization)}`
      })
      const more = over.length > 3 ? ` and ${over.length - 3} more` : ''
      return `${shown.join(', ')}${more} (target ${formatPercent(target)}).`
    }
    case 'serves-all-traffic': {
      const limit = settings?.targets?.maxErrorRate ?? DEFAULT_MAX_ERROR_RATE
      return `${formatPercent(verdict.summary.errorRate)} of requests were dropped (limit ${formatPercent(limit)}).`
    }
    default:
      return undefined
  }
}
