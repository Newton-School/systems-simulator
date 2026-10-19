import {
  resolveQuestionAuthoringSetup,
  type QuestionAuthoringProject
} from '../analysis/questionAuthoringProject'
import { classroomSketchToTopology } from './designSketch'
import {
  ClassroomQuestionIntentSchema,
  compileClassroomQuestionIntent,
  type ClassroomQuestionIntent
} from './questionIntent'

function now(): string {
  return new Date().toISOString()
}

/**
 * Apply one complete objective-first intent to a Studio project. The compiler can
 * synthesize its baseline scenario and Classroom grading, while answer material
 * remains only in project assets.
 */
export function applyClassroomQuestionIntentToProject(
  project: QuestionAuthoringProject,
  input: ClassroomQuestionIntent,
  updatedAt = now()
): QuestionAuthoringProject {
  const intent = ClassroomQuestionIntentSchema.parse(input)
  const compiled = compileClassroomQuestionIntent(intent)
  const currentSetup = resolveQuestionAuthoringSetup(project.question.setup)
  const concepts = Array.from(new Set([...currentSetup.concepts, ...compiled.conceptIds]))
  const setup = {
    ...currentSetup,
    concepts,
    classroomIntent: structuredClone(intent),
    ...(compiled.status === 'ready'
      ? {
          constraints: {
            ...currentSetup.constraints,
            allowedNodeTypes: [...compiled.allowedNodeTypes]
          }
        }
      : {})
  }

  if (compiled.status === 'handoff') {
    return {
      ...project,
      updatedAt,
      question: { ...project.question, setup },
      verification: undefined
    }
  }

  const referenceTopology = intent.solution
    ? classroomSketchToTopology(
        intent.solution,
        compiled.peakRps,
        `${project.question.id}-solution`
      )
    : project.assets.referenceTopology
  const misconceptionTopologies = (intent.settings.misconceptions ?? []).flatMap((misconception) =>
    misconception.probe
      ? [
          {
            id: misconception.id,
            label: misconception.title,
            misconception: misconception.message,
            topology: classroomSketchToTopology(
              misconception.probe,
              compiled.peakRps,
              `${project.question.id}-${misconception.id}`
            )
          }
        ]
      : []
  )

  return {
    ...project,
    updatedAt,
    question: {
      ...project.question,
      setup,
      prompt: {
        ...project.question.prompt,
        scale: { ...project.question.prompt.scale, peakRps: compiled.peakRps }
      }
    },
    assets: {
      ...project.assets,
      ...(referenceTopology ? { referenceTopology } : {}),
      gamedTopologies:
        misconceptionTopologies.length > 0
          ? misconceptionTopologies
          : project.assets.gamedTopologies
    },
    verification: undefined
  }
}
