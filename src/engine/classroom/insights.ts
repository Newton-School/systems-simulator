import type { GamePlaygroundSubmitPayload } from '../analysis/gamePlayground'

export interface ClassroomCohortInsights {
  attempts: number
  misconceptionCounts: Record<string, number>
  predictionCounts: Record<string, Record<string, number>>
}

/** Host-side/reference reducer for the per-attempt teaching signals in submit payloads. */
export function aggregateClassroomInsights(
  submissions: readonly GamePlaygroundSubmitPayload[]
): ClassroomCohortInsights {
  const misconceptionCounts: Record<string, number> = {}
  const predictionCounts: Record<string, Record<string, number>> = {}
  for (const submission of submissions) {
    const insight = submission.classroomInsights
    if (!insight) continue
    for (const id of new Set(insight.misconceptionIds)) {
      misconceptionCounts[id] = (misconceptionCounts[id] ?? 0) + 1
    }
    for (const [id, answer] of Object.entries(insight.predictions)) {
      const key = String(answer)
      predictionCounts[id] ??= {}
      predictionCounts[id]![key] = (predictionCounts[id]![key] ?? 0) + 1
    }
  }
  return { attempts: submissions.length, misconceptionCounts, predictionCounts }
}
