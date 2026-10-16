/**
 * The Classroom results card's numbers: per-component utilization against the
 * target line, traffic served vs offered, and cost from the givens. Read from a
 * run of a compiled Classroom topology (nodes carry their `config.classroom`).
 */
import type { SimulationOutput } from '../analysis/output'
import type { TopologyJSON } from '../core/types'
import { classroomNodeInfo } from './compileClassroom'
import { classroomCopies, type ClassroomSettings } from './types'

export interface ClassroomComponentResult {
  nodeId: string
  label: string
  copies: number
  /** 0..1 (or above 1 when the analytic model reports overload). */
  utilization: number
  overTarget: boolean
}

export interface ClassroomRunSummary {
  /** Compute components only: passthroughs and Users have no capacity to fill. */
  components: ClassroomComponentResult[]
  targetUtilization?: number
  offeredRps?: number
  servedRps: number
  /** Fraction of requests not served, 0..1. */
  droppedShare: number
  /** Sum over components of cost per copy × copies; undefined when no cost given. */
  costPerHour?: number
}

export function summarizeClassroomRun(
  topology: TopologyJSON,
  output: SimulationOutput,
  settings: ClassroomSettings | undefined
): ClassroomRunSummary {
  const target = settings?.targets?.maxUtilization
  const components: ClassroomComponentResult[] = []
  let cost = 0
  let hasCost = false
  for (const node of topology.nodes) {
    const info = classroomNodeInfo(node)
    if (!info || info.capacityRps === undefined) continue
    const copies = classroomCopies(node)
    const utilization = output.perNode[node.id]?.utilization ?? 0
    components.push({
      nodeId: node.id,
      label: node.label,
      copies,
      utilization,
      overTarget: target !== undefined && utilization > target + 1e-9
    })
    if (info.costPerHour !== undefined) {
      hasCost = true
      cost += info.costPerHour * copies
    }
  }
  return {
    components,
    ...(target !== undefined ? { targetUtilization: target } : {}),
    ...(topology.workload ? { offeredRps: topology.workload.baseRps } : {}),
    servedRps: output.summary.throughput,
    droppedShare: output.summary.errorRate,
    ...(hasCost ? { costPerHour: cost } : {})
  }
}
