import { useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import { isClassroomActive } from '../../../engine/analysis/environmentProfile'
import type { QuestionPackage } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import {
  classroomRunConditions,
  compileClassroomQuestion,
  compileClassroomTopology,
  resolveClassroomGivens,
  type ClassroomCompileResult
} from '../../../engine/classroom/compileClassroom'
import { conceptCardForType } from '../../../engine/classroom/conceptCards'
import { formatRps, givensChips } from '../../../engine/classroom/givensTable'
import { getPaletteTemplate } from '../../../engine/catalog/paletteTemplates'
import type { AnyNodeData } from '@renderer/types/ui'
import type { IdentityChip } from '@renderer/components/nodes/nodePresentation'

/** Whether Classroom mode is in effect for the loaded question. */
export function useClassroomActive(): boolean {
  return useStore((state) => isClassroomActive(state.environmentProfile, state.activeQuestion))
}

/**
 * Whether design checks (anti-patterns, single points of failure) are hidden: in
 * Classroom mode unless the question turns them on with `classroom.designChecks`.
 */
export function useDesignChecksHidden(): boolean {
  const classroom = useClassroomActive()
  const enabled = useStore((state) => state.activeQuestion?.classroom?.designChecks === true)
  return classroom && !enabled
}

/**
 * The question as it is graded right now: the compiled Classroom grading set in
 * Classroom mode, the authored package otherwise. Test rows must be built from
 * this so they match the grade.
 */
export function useGradingQuestion(): QuestionPackage | null {
  const activeQuestion = useStore((state) => state.activeQuestion)
  const classroom = useClassroomActive()
  return useMemo(
    () => (activeQuestion && classroom ? compileClassroomQuestion(activeQuestion) : activeQuestion),
    [activeQuestion, classroom]
  )
}

export interface ClassroomNodeView {
  /** Lecture label, unless the student renamed the node. */
  label: string
  /** Replaces the node's identity chip with its givens. */
  identityChip: IdentityChip | null
}

/**
 * How a canvas node reads in Classroom mode: its lecture label and its givens
 * (with a ×N badge for copies). Null outside Classroom mode or for a node with
 * no concept card.
 */
export function useClassroomNodeView(data: AnyNodeData): ClassroomNodeView | null {
  const activeQuestion = useStore((state) => state.activeQuestion)
  const classroom = useClassroomActive()
  const { templateId, componentType, label } = data
  const instanceCount = data.sim?.resources?.instanceCount
  return useMemo(() => {
    if (!classroom || !activeQuestion || !componentType) return null
    const card = conceptCardForType(componentType)
    if (!card) return null
    const settings = activeQuestion.classroom
    const defaultLabel = getPaletteTemplate(templateId)?.label
    const classroomLabel = resolveClassroomGivens(card, componentType, settings).label
    const shownLabel = !label || label === defaultLabel ? classroomLabel : label
    if (card.role === 'source') {
      const peak = classroomRunConditions(activeQuestion).workload?.baseRps
      return {
        label: shownLabel,
        identityChip: peak ? { label: 'Traffic', value: `${formatRps(peak)} at peak` } : null
      }
    }
    const copies = instanceCount && instanceCount > 1 ? [`×${instanceCount}`] : []
    const chips = [...givensChips(card, componentType, settings).slice(0, 1), ...copies]
    return {
      label: shownLabel,
      identityChip: chips.length > 0 ? { label: 'Given', value: chips.join(' · ') } : null
    }
  }, [activeQuestion, classroom, componentType, instanceCount, label, templateId])
}

/**
 * Classroom compile for a run, or null outside Classroom mode. The raw canvas
 * design is rebuilt from the question's givens and run against the question's
 * public traffic; `issues` lists components Classroom mode can't model.
 */
export function compileClassroomRun(topology: TopologyJSON): ClassroomCompileResult | null {
  const { environmentProfile, activeQuestion } = useStore.getState()
  if (!activeQuestion || !isClassroomActive(environmentProfile, activeQuestion)) {
    return null
  }
  return compileClassroomTopology(topology, {
    settings: activeQuestion.classroom,
    abstraction: environmentProfile.abstraction === 'guided' ? 'guided' : 'classroom',
    ...classroomRunConditions(activeQuestion)
  })
}

/** The topology a run actually simulates (compile is idempotent, so a second pass is safe). */
export function prepareRunTopology(topology: TopologyJSON): TopologyJSON {
  return compileClassroomRun(topology)?.topology ?? topology
}
