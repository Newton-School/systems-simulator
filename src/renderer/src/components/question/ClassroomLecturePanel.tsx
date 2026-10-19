import type { QuestionPackage } from '../../../../engine/analysis/question'
import { classroomSketchToTopology } from '../../../../engine/classroom/designSketch'
import { convertNestedToFlat } from '../../utils/nodeTransformers'
import { topologyToCanvasFileData } from '../../utils/topologyCanvasAdapter'
import useStore from '../../store/useStore'

export function ClassroomLecturePanel({
  question
}: {
  question: QuestionPackage
}): React.JSX.Element | null {
  const script = question.classroom?.lecture
  const setQuestion = useStore((state) => state.setActiveQuestion)
  if (!script || ((script.dials?.length ?? 0) === 0 && (script.steps?.length ?? 0) === 0))
    return null

  const applyDial = (target: string, value: number): void => {
    const next = structuredClone(question)
    if (target === 'traffic.peak') {
      next.prompt.scale.peakRps = value
      for (const testCase of [
        ...next.suite.cases,
        ...(next.suite.dryRunCase ? [next.suite.dryRunCase] : [])
      ]) {
        if (testCase.workload?.baseRps !== undefined) testCase.workload.baseRps = value
      }
    } else if (target.startsWith('target:')) {
      const field = target.slice('target:'.length)
      if (field === 'maxUtilization' || field === 'maxErrorRate') {
        next.classroom = {
          ...next.classroom,
          targets: { ...next.classroom?.targets, [field]: value }
        }
      }
    } else if (target.startsWith('given:')) {
      const [component, field] = target.slice('given:'.length).split('.')
      if (component && field && next.classroom) {
        next.classroom.givens = {
          ...next.classroom.givens,
          [component]: { ...next.classroom.givens?.[component], [field]: value }
        }
      }
    }
    setQuestion(next)
  }

  const applyStep = (step: NonNullable<typeof script.steps>[number]): void => {
    const peak = question.prompt.scale.peakRps ?? 1
    const canvas = topologyToCanvasFileData(classroomSketchToTopology(step.design, peak, step.id))
    const store = useStore.getState()
    store.setGraph(convertNestedToFlat(canvas.nodes), canvas.edges, { resetHistory: true })
    if (canvas.scenario) store.setScenario(canvas.scenario)
  }

  return (
    <section className="space-y-3 rounded-md border-2 border-nss-primary/30 bg-nss-primary/5 p-3">
      <h3 className="text-sm font-semibold text-nss-text">Presenter controls</h3>
      {script.dials?.map((dial) => (
        <label key={dial.id} className="block text-xs font-semibold text-nss-text">
          {dial.label}
          <select
            onChange={(event) => applyDial(dial.target, Number(event.currentTarget.value))}
            className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5"
          >
            {dial.values.map((value) => (
              <option key={value} value={value}>
                {value.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="grid gap-2">
        {script.steps?.map((step, index) => (
          <button
            key={step.id}
            type="button"
            onClick={() => applyStep(step)}
            className="rounded border border-nss-border bg-nss-surface p-2 text-left text-xs hover:border-nss-primary"
          >
            <strong>
              {index + 1}. {step.title}
            </strong>
            <span className="mt-1 block text-nss-muted">{step.talkingPoint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
