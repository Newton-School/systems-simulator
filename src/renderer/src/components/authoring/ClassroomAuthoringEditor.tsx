import type { QuestionAuthoringSetupDraft } from '../../../../engine/analysis/questionAuthoringProject'
import type {
  ClassroomCheck,
  ClassroomCheckTemplate,
  ClassroomSettings
} from '../../../../engine/classroom/types'
import { classroomCardsForQuestion } from '../../../../engine/classroom/givensTable'
import { buildClassroomAnswerKey } from '../../../../engine/classroom/answerKey'

interface Props {
  setup: QuestionAuthoringSetupDraft
  peakRps?: number
  onChange: (setup: QuestionAuthoringSetupDraft) => void
}

const CHECKS: Array<{ template: ClassroomCheckTemplate; label: string }> = [
  { template: 'traffic-flows-through', label: 'Traffic follows the required path' },
  { template: 'serves-all-traffic', label: 'Serve the offered traffic' },
  { template: 'within-target-utilization', label: 'Stay within the utilization target' },
  { template: 'right-sized', label: 'Avoid obvious overprovisioning' }
]

function optionalNumber(value: string): number | undefined {
  const number = Number(value)
  return value !== '' && Number.isFinite(number) && number >= 0 ? number : undefined
}

export function ClassroomAuthoringEditor({ setup, peakRps, onChange }: Props): React.JSX.Element {
  const classroom = setup.classroom
  const enabled = classroom?.abstractions?.includes('classroom') ?? false
  const cards = classroomCardsForQuestion({ constraints: setup.constraints })
  const capacityCards = cards.filter((card) => card.role === 'compute')
  const primaryCapacityCard = capacityCards[0]
  const primaryType = primaryCapacityCard?.covers[0]
  const primaryPassthroughType = cards.find((card) => card.role === 'passthrough')?.covers[0]
  const primarySourceType = cards.find((card) => card.role === 'source')?.covers[0]
  const primaryChoiceType = primaryPassthroughType ?? primaryType

  const setClassroom = (next: ClassroomSettings): void => onChange({ ...setup, classroom: next })
  const addObjective = (): void => {
    const objectives = classroom?.objectives ?? []
    const id = `objective-${objectives.length + 1}`
    setClassroom({
      ...(classroom ?? {}),
      objectives: [...objectives, { id, statement: 'The student can …', concept: 'system-design' }]
    })
  }
  const addMisconception = (): void => {
    const misconceptions = classroom?.misconceptions ?? []
    const fallbackCheck = classroom?.checks?.find((check) => check.severity !== 'feedback')?.id
    setClassroom({
      ...(classroom ?? {}),
      misconceptions: [
        ...misconceptions,
        {
          id: `misconception-${misconceptions.length + 1}`,
          title: 'Expected wrong turn',
          message: 'Explain the idea the learner should reconsider.',
          detect: { kind: 'check-failed', checkId: fallbackCheck ?? 'classroom-serves-all-traffic' }
        }
      ]
    })
  }
  const addPrediction = (): void => {
    const predictions = classroom?.predictions ?? []
    setClassroom({
      ...(classroom ?? {}),
      predictions: [
        ...predictions,
        {
          id: `prediction-${predictions.length + 1}`,
          question: 'Before you build: what do you expect?',
          answer: { kind: 'number' },
          ...(primaryType ? { reveal: { copiesOf: primaryType } } : {})
        }
      ]
    })
  }
  const addGuidedKnob = (): void => {
    const guidedKnobs = classroom?.guidedKnobs ?? []
    const objectiveId = classroom?.objectives?.[0]?.id ?? 'objective-1'
    setClassroom({
      ...(classroom ?? {}),
      abstractions: Array.from(
        new Set([...(classroom?.abstractions ?? ['architect']), 'guided', 'architect'] as const)
      ),
      objectives: classroom?.objectives?.length
        ? classroom.objectives
        : [
            {
              id: objectiveId,
              statement: 'The student can tune one declared system-design control.',
              concept: 'guided-tuning'
            }
          ],
      guidedKnobs: [
        ...guidedKnobs,
        { path: 'queue.workers', label: 'Worker concurrency', objectiveId }
      ]
    })
  }
  const addLectureDial = (): void => {
    const dials = classroom?.lecture?.dials ?? []
    setClassroom({
      ...(classroom ?? {}),
      lecture: {
        ...(classroom?.lecture ?? {}),
        dials: [
          ...dials,
          {
            id: `dial-${dials.length + 1}`,
            label: 'Peak traffic',
            target: 'traffic.peak',
            values: [100_000, 500_000, 1_000_000]
          }
        ]
      }
    })
  }
  const addLectureStep = (): void => {
    if (!primarySourceType || !primaryType) return
    const steps = classroom?.lecture?.steps ?? []
    const nodes = [
      { ref: 'users', component: primarySourceType },
      ...(primaryPassthroughType ? [{ ref: 'middle', component: primaryPassthroughType }] : []),
      { ref: 'service', component: primaryType, copies: 1 }
    ]
    const edges: Array<[string, string]> = primaryPassthroughType
      ? [
          ['users', 'middle'],
          ['middle', 'service']
        ]
      : [['users', 'service']]
    setClassroom({
      ...(classroom ?? {}),
      lecture: {
        ...(classroom?.lecture ?? {}),
        steps: [
          ...steps,
          {
            id: `step-${steps.length + 1}`,
            title: `Lecture step ${steps.length + 1}`,
            talkingPoint: 'Explain what changes and why.',
            design: { nodes, edges },
            autoRun: true
          }
        ]
      }
    })
  }
  const addNamedChoice = (): void => {
    if (!primaryChoiceType) return
    const choices = classroom?.choices?.[primaryChoiceType] ?? []
    const objectiveId = classroom?.objectives?.[0]?.id ?? 'objective-1'
    setClassroom({
      ...(classroom ?? {}),
      objectives: classroom?.objectives?.length
        ? classroom.objectives
        : [
            {
              id: objectiveId,
              statement: 'The student can explain and select a controlled design trade-off.',
              concept: 'design-choice'
            }
          ],
      choices: {
        ...(classroom?.choices ?? {}),
        [primaryChoiceType]: [
          ...choices,
          {
            id: `choice-${choices.length + 1}`,
            label: 'Design choice',
            explanation: 'Choose the option that serves the lesson objective.',
            objectiveId,
            target: 'routing-strategy',
            options: [
              {
                id: 'round-robin',
                label: 'Even rotation',
                explanation: 'Spread requests evenly in turn.',
                value: 'round-robin'
              },
              {
                id: 'least-conn',
                label: 'Least busy',
                explanation: 'Prefer the backend with fewer requests in flight.',
                value: 'least-conn'
              }
            ]
          }
        ]
      }
    })
  }
  const setGiven = (
    type: string,
    field: 'label' | 'capacityRps' | 'costPerHour' | 'latencyMs',
    value: string
  ): void => {
    const previous = classroom?.givens?.[type] ?? {}
    const parsed = field === 'label' ? value || undefined : optionalNumber(value)
    const nextGiven = { ...previous, [field]: parsed }
    const cleaned = Object.fromEntries(
      Object.entries(nextGiven).filter(([, entry]) => entry !== undefined)
    )
    const givens = { ...(classroom?.givens ?? {}) }
    if (Object.keys(cleaned).length > 0) givens[type] = cleaned
    else delete givens[type]
    setClassroom({ ...(classroom ?? {}), givens })
  }

  const toggleCheck = (template: ClassroomCheckTemplate, checked: boolean): void => {
    const existing = classroom?.checks ?? []
    if (!checked) {
      setClassroom({
        ...(classroom ?? {}),
        checks: existing.filter((row) => row.template !== template)
      })
      return
    }
    const check: ClassroomCheck = {
      id: `classroom-${template}`,
      template,
      label: CHECKS.find((entry) => entry.template === template)?.label ?? template,
      ...(template === 'traffic-flows-through'
        ? {
            via: primaryPassthroughType ?? 'load-balancer',
            component: primaryType ?? 'microservice'
          }
        : {}),
      ...(template === 'within-target-utilization' || template === 'right-sized'
        ? { component: primaryType ?? 'microservice' }
        : {}),
      ...(template === 'right-sized' ? { severity: 'feedback' as const, factor: 1.5 } : {})
    }
    setClassroom({ ...(classroom ?? {}), checks: [...existing, check] })
  }

  const capacity = primaryType ? classroom?.givens?.[primaryType]?.capacityRps : undefined
  const target = classroom?.targets?.maxUtilization ?? 1
  const answerKey = buildClassroomAnswerKey({
    peakRps: peakRps ?? 0,
    capacityRps: capacity ?? 0,
    maxUtilization: target,
    maxCopies: 50
  })
  const minimum = answerKey.smallestPassingCopies
  const answerRows = minimum
    ? answerKey.rows.filter(
        (row) => row.copies >= Math.max(1, minimum - 3) && row.copies <= minimum + 1
      )
    : []

  return (
    <section className="mt-5 rounded-lg border border-nss-border bg-nss-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold text-nss-text">Classroom authoring</h4>
          <p className="mt-1 text-[11px] text-nss-muted">
            Preview the question using concept cards, locked givens, and lesson-language checks.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              setClassroom({
                ...(classroom ?? {}),
                abstractions: event.currentTarget.checked
                  ? Array.from(
                      new Set([
                        ...(classroom?.abstractions ?? ['architect']),
                        'classroom',
                        'architect'
                      ] as const)
                    )
                  : (classroom?.abstractions ?? ['architect']).filter(
                      (abstraction) => abstraction !== 'classroom'
                    )
              })
            }
          />
          Allow Classroom launches
        </label>
      </div>

      {enabled && (
        <div className="mt-4 space-y-4">
          {setup.constraints.allowedNodeTypes?.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {cards
                .filter((card) => card.role !== 'source')
                .map((card) => {
                  const type = card.covers[0]
                  const given = classroom?.givens?.[type]
                  return (
                    <fieldset key={card.id} className="rounded-md border border-nss-border p-3">
                      <legend className="px-1 text-[11px] font-semibold text-nss-text">
                        {card.label}
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input
                          aria-label={`${card.label} classroom label`}
                          value={given?.label ?? ''}
                          placeholder="Lecture label"
                          onChange={(event) => setGiven(type, 'label', event.currentTarget.value)}
                          className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                        />
                        {card.role === 'compute' && (
                          <>
                            <input
                              aria-label={`${card.label} capacity`}
                              type="number"
                              min="1"
                              value={given?.capacityRps ?? ''}
                              placeholder="Capacity req/s"
                              onChange={(event) =>
                                setGiven(type, 'capacityRps', event.currentTarget.value)
                              }
                              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                            />
                            <input
                              aria-label={`${card.label} cost`}
                              type="number"
                              min="0"
                              step="0.001"
                              value={given?.costPerHour ?? ''}
                              placeholder="Cost / hr"
                              onChange={(event) =>
                                setGiven(type, 'costPerHour', event.currentTarget.value)
                              }
                              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                            />
                          </>
                        )}
                        <input
                          aria-label={`${card.label} fixed latency`}
                          type="number"
                          min="0"
                          value={given?.latencyMs ?? ''}
                          placeholder="Fixed latency ms"
                          onChange={(event) =>
                            setGiven(type, 'latencyMs', event.currentTarget.value)
                          }
                          className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                        />
                      </div>
                    </fieldset>
                  )
                })}
            </div>
          ) : (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-700">
              Choose allowed component types first. Classroom questions use an explicit component
              kit.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-nss-text">
              Maximum utilization
              <input
                type="number"
                min="0"
                max="100"
                value={(classroom?.targets?.maxUtilization ?? 0.8) * 100}
                onChange={(event) =>
                  setClassroom({
                    ...(classroom ?? {}),
                    targets: {
                      ...(classroom?.targets ?? {}),
                      maxUtilization: event.currentTarget.valueAsNumber / 100
                    }
                  })
                }
                className="mt-1 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              />
            </label>
            <label className="text-[11px] font-semibold text-nss-text">
              Maximum dropped requests
              <input
                type="number"
                min="0"
                max="100"
                value={(classroom?.targets?.maxErrorRate ?? 0.01) * 100}
                onChange={(event) =>
                  setClassroom({
                    ...(classroom ?? {}),
                    targets: {
                      ...(classroom?.targets ?? {}),
                      maxErrorRate: event.currentTarget.valueAsNumber / 100
                    }
                  })
                }
                className="mt-1 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              />
            </label>
          </div>

          <fieldset>
            <legend className="text-[11px] font-semibold text-nss-text">Classroom checks</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {CHECKS.map((entry) => (
                <label
                  key={entry.template}
                  className="flex items-center gap-2 text-[11px] text-nss-text"
                >
                  <input
                    type="checkbox"
                    disabled={entry.template === 'traffic-flows-through' && !primaryPassthroughType}
                    checked={(classroom?.checks ?? []).some(
                      (check) => check.template === entry.template
                    )}
                    onChange={(event) => toggleCheck(entry.template, event.currentTarget.checked)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-[11px] font-semibold text-nss-text">
                Learning objectives
              </legend>
              <button
                type="button"
                onClick={addObjective}
                className="text-[11px] font-semibold text-nss-primary"
              >
                + Add objective
              </button>
            </div>
            {(classroom?.objectives ?? []).map((objective, index) => (
              <div
                key={objective.id}
                className="grid gap-2 rounded-md border border-nss-border p-2 sm:grid-cols-[1fr_10rem_auto]"
              >
                <input
                  aria-label={`${objective.id} statement`}
                  value={objective.statement}
                  onChange={(event) => {
                    const objectives = [...(classroom?.objectives ?? [])]
                    objectives[index] = { ...objective, statement: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), objectives })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                />
                <input
                  aria-label={`${objective.id} concept`}
                  value={objective.concept}
                  onChange={(event) => {
                    const objectives = [...(classroom?.objectives ?? [])]
                    objectives[index] = { ...objective, concept: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), objectives })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                />
                <button
                  type="button"
                  aria-label={`Remove ${objective.id}`}
                  onClick={() =>
                    setClassroom({
                      ...(classroom ?? {}),
                      objectives: (classroom?.objectives ?? []).filter(
                        (row) => row.id !== objective.id
                      )
                    })
                  }
                  className="px-2 text-[11px] text-rose-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-[11px] font-semibold text-nss-text">
                Wrong-answer messages
              </legend>
              <button
                type="button"
                onClick={addMisconception}
                className="text-[11px] font-semibold text-nss-primary"
              >
                + Add message
              </button>
            </div>
            {(classroom?.misconceptions ?? []).map((misconception, index) => (
              <div
                key={misconception.id}
                className="grid gap-2 rounded-md border border-nss-border p-2 sm:grid-cols-2"
              >
                <input
                  value={misconception.title}
                  aria-label={`${misconception.id} title`}
                  onChange={(event) => {
                    const misconceptions = [...(classroom?.misconceptions ?? [])]
                    misconceptions[index] = { ...misconception, title: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), misconceptions })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                />
                <select
                  aria-label={`${misconception.id} failed check`}
                  value={
                    misconception.detect.kind === 'check-failed' ? misconception.detect.checkId : ''
                  }
                  onChange={(event) => {
                    const misconceptions = [...(classroom?.misconceptions ?? [])]
                    misconceptions[index] = {
                      ...misconception,
                      detect: { kind: 'check-failed', checkId: event.currentTarget.value }
                    }
                    setClassroom({ ...(classroom ?? {}), misconceptions })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                >
                  {(classroom?.checks ?? [])
                    .filter((check) => check.severity !== 'feedback')
                    .map((check) => (
                      <option key={check.id} value={check.id}>
                        {check.label}
                      </option>
                    ))}
                </select>
                <textarea
                  value={misconception.message}
                  aria-label={`${misconception.id} message`}
                  onChange={(event) => {
                    const misconceptions = [...(classroom?.misconceptions ?? [])]
                    misconceptions[index] = { ...misconception, message: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), misconceptions })
                  }}
                  className="sm:col-span-2 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                />
              </div>
            ))}
            <p className="text-[10px] text-nss-muted">
              Attach a gamed design in the Discrimination Lab to prove each detector catches its
              intended wrong turn.
            </p>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-nss-border p-3">
            <legend className="px-1 text-[11px] font-semibold text-nss-text">
              Lecture and advanced Classroom features
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addPrediction}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary"
              >
                + Prediction
              </button>
              <button
                type="button"
                onClick={addLectureDial}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary"
              >
                + Presenter dial
              </button>
              <button
                type="button"
                onClick={addLectureStep}
                disabled={!primarySourceType || !primaryType}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary disabled:opacity-40"
              >
                + Presenter step
              </button>
              <button
                type="button"
                onClick={addNamedChoice}
                disabled={!primaryChoiceType}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary disabled:opacity-40"
              >
                + Named choice
              </button>
              <button
                type="button"
                onClick={addGuidedKnob}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary"
              >
                + Guided knob
              </button>
            </div>
            {(classroom?.predictions ?? []).map((prediction, index) => (
              <label key={prediction.id} className="block text-[11px] font-semibold text-nss-text">
                Prediction prompt
                <input
                  value={prediction.question}
                  onChange={(event) => {
                    const predictions = [...(classroom?.predictions ?? [])]
                    predictions[index] = { ...prediction, question: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), predictions })
                  }}
                  className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-normal"
                />
              </label>
            ))}
            {(classroom?.lecture?.dials ?? []).map((dial) => (
              <div
                key={dial.id}
                className="rounded border border-nss-border bg-nss-surface px-2 py-1.5 text-[11px]"
              >
                <strong>{dial.label}</strong> · {dial.target} · {dial.values.join(', ')}
              </div>
            ))}
            {(classroom?.lecture?.steps ?? []).map((step) => (
              <div
                key={step.id}
                className="rounded border border-nss-border bg-nss-surface px-2 py-1.5 text-[11px]"
              >
                <strong>{step.title}</strong> · {step.talkingPoint}
              </div>
            ))}
            {primaryChoiceType &&
              (classroom?.choices?.[primaryChoiceType] ?? []).map((choice) => (
                <div
                  key={choice.id}
                  className="rounded border border-nss-border bg-nss-surface px-2 py-1.5 text-[11px]"
                >
                  <strong>{choice.label}</strong> ·{' '}
                  {choice.options.map((option) => option.label).join(' / ')}
                </div>
              ))}
            {(classroom?.guidedKnobs ?? []).map((knob) => (
              <div
                key={knob.path}
                className="rounded border border-nss-border bg-nss-surface px-2 py-1.5 text-[11px]"
              >
                <strong>{knob.label}</strong> · <code>{knob.path}</code> · objective{' '}
                {knob.objectiveId}
              </div>
            ))}
            {primaryType && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  aria-label="Representative instance type"
                  value={classroom?.hardware?.[primaryType]?.instanceType ?? ''}
                  placeholder="Representative instance type"
                  onChange={(event) =>
                    setClassroom({
                      ...(classroom ?? {}),
                      hardware: {
                        ...(classroom?.hardware ?? {}),
                        [primaryType]: {
                          instanceType: event.currentTarget.value,
                          description:
                            classroom?.hardware?.[primaryType]?.description ??
                            'A representative setup that reproduces the Classroom given.'
                        }
                      }
                    })
                  }
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                />
                <input
                  aria-label="Hardware bridge explanation"
                  value={classroom?.hardware?.[primaryType]?.description ?? ''}
                  placeholder="Hardware bridge explanation"
                  onChange={(event) =>
                    setClassroom({
                      ...(classroom ?? {}),
                      hardware: {
                        ...(classroom?.hardware ?? {}),
                        [primaryType]: {
                          instanceType:
                            classroom?.hardware?.[primaryType]?.instanceType ?? 'm5.large',
                          description: event.currentTarget.value
                        }
                      }
                    })
                  }
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                />
              </div>
            )}
          </fieldset>

          <div>
            <h5 className="text-[11px] font-semibold text-nss-text">Capacity answer key</h5>
            {minimum && primaryCapacityCard && capacity && peakRps ? (
              <div className="mt-2 overflow-hidden rounded-md border border-nss-border">
                {answerRows.map((row) => {
                  const { copies, utilization } = row
                  return (
                    <div
                      key={copies}
                      className="grid grid-cols-3 border-b border-nss-border px-3 py-1.5 text-[11px] last:border-b-0"
                    >
                      <span>
                        {primaryCapacityCard.label} ×{copies}
                      </span>
                      <span>{(utilization * 100).toFixed(1)}%</span>
                      <span
                        className={utilization <= target ? 'text-emerald-600' : 'text-rose-600'}
                      >
                        {utilization <= target ? 'Pass' : 'Fail'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-1 text-[11px] text-nss-muted">
                Add peak traffic and a capacity given to generate the copy-count table.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
