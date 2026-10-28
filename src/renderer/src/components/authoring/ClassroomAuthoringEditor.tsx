import type { QuestionAuthoringSetupDraft } from '../../../../engine/analysis/questionAuthoringProject'
import type {
  ClassroomCheck,
  ClassroomCheckTemplate,
  ClassroomStudentControl,
  ClassroomSettings
} from '../../../../engine/classroom/types'
import { classroomCardsForQuestion } from '../../../../engine/classroom/givensTable'
import { buildClassroomAnswerKey } from '../../../../engine/classroom/answerKey'
import {
  getSystemDesignAuthoringRecipe,
  getSystemDesignConcept
} from '../../../../engine/classroom/systemDesignConceptRegistry'
import { inferClassroomQuestionIntent } from '../../../../engine/classroom/questionIntent'
import { CONCEPT_CARDS } from '../../../../engine/classroom/conceptCards'

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
  const selectedRecipes = setup.concepts.flatMap((conceptId) => {
    const recipe = getSystemDesignAuthoringRecipe(conceptId)
    return recipe ? [recipe] : []
  })
  const allowedDecisionKinds = new Set<ClassroomStudentControl['kind']>(
    selectedRecipes.flatMap((recipe) => [
      ...recipe.allowedDecisionKinds
    ]) as ClassroomStudentControl['kind'][]
  )
  const compatibleChecks = new Set<ClassroomCheckTemplate>(
    selectedRecipes.flatMap((recipe) => [...recipe.compatibleChecks]) as ClassroomCheckTemplate[]
  )
  const inferredIntent = inferClassroomQuestionIntent({
    conceptIds: setup.concepts,
    peakRps,
    allowedNodeTypes: setup.constraints.allowedNodeTypes,
    settings: classroom
  })

  const setClassroom = (next: ClassroomSettings): void => {
    const objectiveConcepts = (next.objectives ?? []).flatMap((objective) => {
      const concept = getSystemDesignConcept(objective.concept)
      return concept ? [concept.id] : []
    })
    onChange({
      ...setup,
      concepts: Array.from(new Set([...setup.concepts, ...objectiveConcepts])),
      classroom: next
    })
  }
  const ensureObjective = (): { id: string; settings: ClassroomSettings } => {
    const existing = classroom?.objectives?.[0]
    if (existing) return { id: existing.id, settings: classroom ?? {} }
    const objective = {
      id: 'objective-1',
      statement: 'The student can explain and apply the lesson concept.',
      concept: setup.concepts[0] ?? 'PF-02'
    }
    return {
      id: objective.id,
      settings: { ...(classroom ?? {}), objectives: [objective] }
    }
  }
  const addObjective = (): void => {
    const objectives = classroom?.objectives ?? []
    const id = `objective-${objectives.length + 1}`
    setClassroom({
      ...(classroom ?? {}),
      objectives: [
        ...objectives,
        { id, statement: 'The student can …', concept: setup.concepts[0] ?? 'PF-02' }
      ],
      checks: (classroom?.checks ?? []).map((check) =>
        check.severity !== 'feedback' && !check.objectiveId ? { ...check, objectiveId: id } : check
      )
    })
  }
  const addMisconception = (): void => {
    const misconceptions = classroom?.misconceptions ?? []
    const { id: objectiveId, settings } = ensureObjective()
    const fallbackCheck = settings.checks?.find((check) => check.severity !== 'feedback')?.id
    setClassroom({
      ...settings,
      misconceptions: [
        ...(settings.misconceptions ?? misconceptions),
        {
          id: `misconception-${misconceptions.length + 1}`,
          title: 'Expected wrong turn',
          message: 'Explain the idea the learner should reconsider.',
          objectiveId,
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
    const { id: objectiveId, settings } = ensureObjective()
    const path = 'queue.workers'
    setClassroom({
      ...settings,
      abstractions: Array.from(
        new Set([...(classroom?.abstractions ?? ['architect']), 'guided', 'architect'] as const)
      ),
      guidedKnobs: [...guidedKnobs, { path, label: 'Worker concurrency', objectiveId }],
      controls: [
        ...(settings.controls ?? []),
        {
          id: `guided-knob-${guidedKnobs.length + 1}`,
          kind: 'guided-knob',
          label: 'Worker concurrency',
          path,
          objectiveId
        }
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
    const { id: objectiveId, settings } = ensureObjective()
    const choiceId = `choice-${choices.length + 1}`
    setClassroom({
      ...settings,
      choices: {
        ...(classroom?.choices ?? {}),
        [primaryChoiceType]: [
          ...choices,
          {
            id: choiceId,
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
      },
      controls: [
        ...(settings.controls ?? []),
        {
          id: `named-choice-${choices.length + 1}`,
          kind: 'named-choice',
          label: 'Design choice',
          component: primaryChoiceType,
          choiceId,
          objectiveId
        }
      ]
    })
  }

  const addStudentControl = (
    kind: Extract<
      ClassroomStudentControl['kind'],
      'place-component' | 'connect-components' | 'copies'
    >
  ): void => {
    if (!allowedDecisionKinds.has(kind)) return
    const { id: objectiveId, settings } = ensureObjective()
    const controls = settings.controls ?? []
    const number = controls.length + 1
    const control: ClassroomStudentControl =
      kind === 'connect-components'
        ? {
            id: `control-${number}`,
            kind,
            label: 'Connect the system cards',
            objectiveId
          }
        : kind === 'copies'
          ? {
              id: `control-${number}`,
              kind,
              label: 'Choose the number of instances',
              component: primaryType ?? 'microservice',
              objectiveId
            }
          : {
              id: `control-${number}`,
              kind,
              label: 'Choose whether to place this component',
              component: primaryChoiceType ?? primaryType ?? 'microservice',
              objectiveId
            }
    setClassroom({ ...settings, controls: [...controls, control] })
  }
  const toggleComponentCard = (component: string, checked: boolean): void => {
    const allowed = new Set(setup.constraints.allowedNodeTypes ?? [])
    if (checked) allowed.add(component)
    else allowed.delete(component)
    const ordered = CONCEPT_CARDS.map((card) => card.covers[0]).filter((type) => allowed.has(type))
    const forbidden = (setup.constraints.forbiddenNodeTypes ?? []).filter(
      (type) => !allowed.has(type)
    )
    onChange({
      ...setup,
      constraints: {
        ...setup.constraints,
        allowedNodeTypes: ordered.length > 0 ? ordered : undefined,
        forbiddenNodeTypes: forbidden.length > 0 ? forbidden : undefined
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
    if (checked && !compatibleChecks.has(template)) return
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
      ...(template === 'right-sized' ? { severity: 'feedback' as const, factor: 1.5 } : {}),
      ...(template !== 'right-sized' && classroom?.objectives?.[0]
        ? { objectiveId: classroom.objectives[0].id }
        : {})
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
          <div
            className={`rounded-md border p-3 text-[11px] ${
              inferredIntent
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700'
            }`}
          >
            {inferredIntent
              ? 'Objective contract complete. Studio will generate the baseline scenario and Classroom grading; you do not need duplicate low-level rows.'
              : 'Complete the concept, peak traffic, component kit, objective, student decision, scored check, and compute capacity. Studio will then generate the scenario and grading automatically.'}
          </div>
          <fieldset className="rounded-md border border-nss-border p-3">
            <legend className="px-1 text-[11px] font-semibold text-nss-text">Component kit</legend>
            <p className="mb-2 text-[10px] text-nss-muted">
              Choose only the cards learners need for this objective. This becomes the complete
              learner palette.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CONCEPT_CARDS.map((card) => {
                const component = card.covers[0]
                const checked = setup.constraints.allowedNodeTypes?.includes(component) ?? false
                return (
                  <label
                    key={card.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-[11px] ${
                      checked
                        ? 'border-nss-primary/40 bg-nss-primary/10 text-nss-text'
                        : 'border-nss-border text-nss-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        toggleComponentCard(component, event.currentTarget.checked)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="block text-nss-text">{card.label}</strong>
                      <span className="block text-[10px] leading-4">{card.summary}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
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

          <fieldset className="space-y-3 rounded-md border border-nss-border p-3">
            <div>
              <legend className="text-[11px] font-semibold text-nss-text">
                Student-configurable decisions
              </legend>
              <p className="mt-1 text-[10px] text-nss-muted">
                Only these controls are editable. Every one must point to a teaching objective.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!allowedDecisionKinds.has('connect-components')}
                onClick={() => addStudentControl('connect-components')}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary disabled:opacity-40"
              >
                + Connections
              </button>
              <button
                type="button"
                disabled={!primaryChoiceType || !allowedDecisionKinds.has('place-component')}
                onClick={() => addStudentControl('place-component')}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary disabled:opacity-40"
              >
                + Component placement
              </button>
              <button
                type="button"
                disabled={!primaryType || !allowedDecisionKinds.has('copies')}
                onClick={() => addStudentControl('copies')}
                className="rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-primary disabled:opacity-40"
              >
                + Instance count
              </button>
            </div>
            {(classroom?.controls ?? []).map((control, index) => (
              <div
                key={control.id}
                className="grid gap-2 rounded border border-nss-border p-2 sm:grid-cols-[1fr_12rem_auto]"
              >
                <input
                  aria-label={`${control.id} label`}
                  value={control.label}
                  onChange={(event) => {
                    const controls = [...(classroom?.controls ?? [])]
                    controls[index] = { ...control, label: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), controls })
                  }}
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                />
                <select
                  aria-label={`${control.id} objective`}
                  value={control.objectiveId}
                  onChange={(event) => {
                    const controls = [...(classroom?.controls ?? [])]
                    controls[index] = { ...control, objectiveId: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), controls })
                  }}
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                >
                  {(classroom?.objectives ?? []).map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.statement}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setClassroom({
                      ...(classroom ?? {}),
                      controls: (classroom?.controls ?? []).filter((row) => row.id !== control.id)
                    })
                  }
                  className="px-2 text-[11px] text-rose-600"
                >
                  Remove
                </button>
              </div>
            ))}
          </fieldset>

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
                    disabled={
                      !compatibleChecks.has(entry.template) ||
                      (entry.template === 'traffic-flows-through' && !primaryPassthroughType)
                    }
                    checked={(classroom?.checks ?? []).some(
                      (check) => check.template === entry.template
                    )}
                    onChange={(event) => toggleCheck(entry.template, event.currentTarget.checked)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
            {(classroom?.checks ?? [])
              .filter((check) => check.severity !== 'feedback')
              .map((check) => (
                <label
                  key={`${check.id}-objective`}
                  className="mt-2 grid gap-1 text-[10px] font-semibold text-nss-muted sm:grid-cols-[1fr_12rem] sm:items-center"
                >
                  <span>{check.label} proves</span>
                  <select
                    value={check.objectiveId ?? ''}
                    onChange={(event) => {
                      const checks = [...(classroom?.checks ?? [])]
                      const checkIndex = checks.findIndex((row) => row.id === check.id)
                      if (checkIndex >= 0) {
                        checks[checkIndex] = {
                          ...checks[checkIndex],
                          objectiveId: event.currentTarget.value
                        }
                        setClassroom({ ...(classroom ?? {}), checks })
                      }
                    }}
                    className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                  >
                    <option value="" disabled>
                      Choose objective
                    </option>
                    {(classroom?.objectives ?? []).map((objective) => (
                      <option key={objective.id} value={objective.id}>
                        {objective.statement}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
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
                <select
                  aria-label={`${objective.id} concept`}
                  value={objective.concept}
                  onChange={(event) => {
                    const objectives = [...(classroom?.objectives ?? [])]
                    objectives[index] = { ...objective, concept: event.currentTarget.value }
                    setClassroom({ ...(classroom ?? {}), objectives })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                >
                  {!setup.concepts.includes(objective.concept) && (
                    <option value={objective.concept}>{objective.concept}</option>
                  )}
                  {setup.concepts.map((conceptId) => (
                    <option key={conceptId} value={conceptId}>
                      {conceptId} · {getSystemDesignConcept(conceptId)?.title ?? conceptId}
                    </option>
                  ))}
                </select>
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
                className="grid gap-2 rounded-md border border-nss-border p-2 sm:grid-cols-3"
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
                <select
                  aria-label={`${misconception.id} objective`}
                  value={misconception.objectiveId ?? ''}
                  onChange={(event) => {
                    const misconceptions = [...(classroom?.misconceptions ?? [])]
                    misconceptions[index] = {
                      ...misconception,
                      objectiveId: event.currentTarget.value
                    }
                    setClassroom({ ...(classroom ?? {}), misconceptions })
                  }}
                  className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
                >
                  <option value="" disabled>
                    Choose objective
                  </option>
                  {(classroom?.objectives ?? []).map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.statement}
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
                  className="sm:col-span-3 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px] text-nss-text"
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
                Add peak traffic and a capacity given to generate the instance-count table.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
