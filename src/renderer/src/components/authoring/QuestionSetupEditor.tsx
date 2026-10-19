import { Plus, Settings2, X } from 'lucide-react'
import { useState } from 'react'
import type { QuestionAuthoringSetupDraft } from '../../../../engine/analysis/questionAuthoringProject'
import { applyAdaptiveAuthoringRecipe } from '../../../../engine/classroom/adaptiveAuthoring'
import {
  getSystemDesignAuthoringRecipe,
  getSystemDesignConcept,
  SYSTEM_DESIGN_CONCEPTS
} from '../../../../engine/classroom/systemDesignConceptRegistry'
import type { Abstraction } from '../../../../engine/classroom/types'
import { RequiredIndicator } from './RequiredIndicator'
import { ClassroomAuthoringEditor } from './ClassroomAuthoringEditor'

interface QuestionSetupEditorProps {
  setup: QuestionAuthoringSetupDraft
  peakRps?: number
  hasScaffold: boolean
  authoringAbstraction: Abstraction
  onRecommendAbstraction: (abstraction: Abstraction) => void
  onChange: (setup: QuestionAuthoringSetupDraft) => void
}

const QUESTION_TYPES: Array<[QuestionAuthoringSetupDraft['type'], string]> = [
  ['open-build', 'Open build'],
  ['scaling', 'Scaling'],
  ['fix', 'Fix a broken design'],
  ['build-budget', 'Build within budget'],
  ['optimize', 'Optimize a baseline'],
  ['ha-chaos', 'High availability / chaos'],
  ['tradeoff', 'Trade-off analysis']
]

const DOMAINS: Array<[QuestionAuthoringSetupDraft['domains'][number], string]> = [
  ['compute', 'Compute'],
  ['storage', 'Storage'],
  ['network', 'Network'],
  ['resilience', 'Resilience'],
  ['correctness', 'Correctness'],
  ['cost', 'Cost']
]

/** Set or clear `classroom.designChecks`, dropping an emptied classroom block. */
function withDesignChecks(
  classroom: QuestionAuthoringSetupDraft['classroom'],
  enabled: boolean
): QuestionAuthoringSetupDraft['classroom'] {
  const { designChecks: _previous, ...rest } = classroom ?? {}
  void _previous
  const next = enabled ? { ...rest, designChecks: true } : rest
  return Object.keys(next).length > 0 ? next : undefined
}

function optionalPositiveNumber(value: string): number | undefined {
  const parsed = Number(value)
  return value !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function QuestionSetupEditor({
  setup,
  peakRps,
  hasScaffold,
  authoringAbstraction,
  onRecommendAbstraction,
  onChange
}: QuestionSetupEditorProps): React.JSX.Element {
  const [conceptInput, setConceptInput] = useState('')
  const selectedConcept = getSystemDesignConcept(conceptInput)
  const activeConcept = selectedConcept ?? getSystemDesignConcept(setup.concepts.at(-1) ?? '')
  const activeRecipe = activeConcept ? getSystemDesignAuthoringRecipe(activeConcept.id) : undefined

  const addConcept = (): void => {
    const concept = selectedConcept?.id
    if (!concept || setup.concepts.includes(concept)) return
    const next = { ...setup, concepts: [...setup.concepts, concept] }
    const adapted =
      authoringAbstraction === 'classroom' ? applyAdaptiveAuthoringRecipe(next, concept) : null
    onChange(adapted?.setup ?? next)
    if (adapted && !adapted.applied) {
      if (selectedConcept.authoring.outcome === 'guided') onRecommendAbstraction('guided')
      if (selectedConcept.authoring.outcome === 'architect-handoff') {
        onRecommendAbstraction('architect')
      }
    }
    setConceptInput('')
  }

  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
          <Settings2 size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-nss-text">Runtime question setup</h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            These fields compile directly into SIMULATOR_CONFIG. They control catalog metadata,
            learner entry behavior, grading threshold, and visibility.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-[11px] font-semibold text-nss-text">
          Question type <RequiredIndicator />
          <select
            required
            value={setup.type}
            onChange={(event) =>
              onChange({
                ...setup,
                type: event.currentTarget.value as QuestionAuthoringSetupDraft['type']
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          >
            {QUESTION_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[11px] font-semibold text-nss-text">
          Difficulty <RequiredIndicator />
          <select
            required
            value={setup.difficulty}
            onChange={(event) =>
              onChange({
                ...setup,
                difficulty: event.currentTarget.value as QuestionAuthoringSetupDraft['difficulty']
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            <option value="expert">Expert</option>
          </select>
        </label>

        <label className="text-[11px] font-semibold text-nss-text">
          Learner entry
          <select
            value={setup.entryFormat ?? ''}
            onChange={(event) => {
              const entryFormat = (event.currentTarget.value || undefined) as
                | QuestionAuthoringSetupDraft['entryFormat']
                | undefined
              onChange({
                ...setup,
                entryFormat,
                ...(entryFormat === 'broken-scaffold' ? { type: 'fix' as const } : {}),
                ...(entryFormat === 'baseline-optimize' ? { type: 'optimize' as const } : {}),
                ...(entryFormat === 'locked-lab'
                  ? {
                      constraints: {
                        ...setup.constraints,
                        allowedNodeTypes: undefined,
                        canModifyScaffold: false,
                        canRemoveScaffoldNodes: false
                      }
                    }
                  : {})
              })
            }}
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          >
            <option value="">Automatic from scaffold</option>
            <option value="blank-canvas" disabled={hasScaffold}>
              Blank canvas
            </option>
            <option value="requirements-first">Requirements first</option>
            <option value="partial-scaffold" disabled={!hasScaffold}>
              Partial scaffold
            </option>
            <option value="broken-scaffold" disabled={!hasScaffold}>
              Broken scaffold
            </option>
            <option value="baseline-optimize" disabled={!hasScaffold}>
              Baseline optimization
            </option>
            <option value="locked-lab" disabled={!hasScaffold}>
              Complete / locked lab
            </option>
          </select>
        </label>

        <label className="text-[11px] font-semibold text-nss-text">
          Workload category
          <select
            value={setup.workloadCategory ?? ''}
            onChange={(event) =>
              onChange({
                ...setup,
                workloadCategory: (event.currentTarget.value || undefined) as
                  | QuestionAuthoringSetupDraft['workloadCategory']
                  | undefined
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          >
            <option value="">Not specified</option>
            <option value="read-heavy">Read heavy</option>
            <option value="write-heavy">Write heavy</option>
            <option value="connection-heavy">Connection heavy</option>
            <option value="correctness-heavy">Correctness heavy</option>
            <option value="batch-heavy">Batch heavy</option>
          </select>
        </label>

        <label className="text-[11px] font-semibold text-nss-text">
          Estimated time
          <div className="relative mt-1.5">
            <input
              type="number"
              min="1"
              value={setup.estimatedTimeMinutes ?? ''}
              onChange={(event) =>
                onChange({
                  ...setup,
                  estimatedTimeMinutes: optionalPositiveNumber(event.currentTarget.value)
                })
              }
              className="block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 pr-12 text-xs font-normal text-nss-text"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] text-nss-muted">
              min
            </span>
          </div>
        </label>

        <label className="text-[11px] font-semibold text-nss-text">
          Pass threshold <RequiredIndicator />
          <input
            required
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={setup.passThreshold}
            onChange={(event) =>
              onChange({
                ...setup,
                passThreshold: Math.min(1, Math.max(0, event.currentTarget.valueAsNumber || 0))
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
          <span className="mt-1 block text-[10px] font-normal text-nss-muted">
            Fraction of available points required (0–1).
          </span>
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="text-[11px] font-semibold text-nss-text">Teaching domains</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DOMAINS.map(([domain, label]) => {
            const checked = setup.domains.includes(domain)
            return (
              // `relative` keeps the visually hidden checkbox inside the chip. Without
              // it the absolutely positioned input lands far down the page, and
              // focusing it on click scrolls the whole window past the Studio.
              <label
                key={domain}
                className={`relative cursor-pointer rounded-full border px-3 py-1.5 text-[11px] font-semibold focus-within:ring-2 focus-within:ring-nss-primary/30 ${
                  checked
                    ? 'border-nss-primary/40 bg-nss-primary/10 text-nss-primary'
                    : 'border-nss-border text-nss-muted hover:text-nss-text'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...setup,
                      domains: checked
                        ? setup.domains.filter((item) => item !== domain)
                        : [...setup.domains, domain]
                    })
                  }
                />
                {label}
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-5">
        <label className="text-[11px] font-semibold text-nss-text" htmlFor="question-concept">
          Concepts taught
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="question-concept"
            type="text"
            list="system-design-concepts"
            value={conceptInput}
            onChange={(event) => setConceptInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addConcept()
              }
            }}
            placeholder="Search or enter a concept ID, e.g. NET-05"
            className="min-w-0 flex-1 rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs text-nss-text"
          />
          <datalist id="system-design-concepts">
            {SYSTEM_DESIGN_CONCEPTS.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.title} · {concept.domain}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            disabled={!selectedConcept || setup.concepts.includes(selectedConcept.id)}
            onClick={addConcept}
            className="flex items-center gap-1.5 rounded-md border border-nss-border px-3 py-2 text-xs font-semibold text-nss-text hover:border-nss-primary/40 hover:text-nss-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={13} aria-hidden="true" /> Add
          </button>
        </div>
        {setup.concepts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {setup.concepts.map((concept) => (
              <span
                key={concept}
                className="inline-flex items-center gap-1 rounded-full bg-nss-surface px-2.5 py-1 text-[10px] text-nss-text"
              >
                {concept}
                {getSystemDesignConcept(concept)?.title
                  ? ` · ${getSystemDesignConcept(concept)?.title}`
                  : ''}
                <button
                  type="button"
                  aria-label={`Remove ${concept}`}
                  onClick={() =>
                    onChange({
                      ...setup,
                      concepts: setup.concepts.filter((item) => item !== concept)
                    })
                  }
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {activeConcept && activeRecipe && (
          <div className="mt-3 rounded-md border border-nss-primary/25 bg-nss-primary/5 p-3 text-[11px]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-nss-text">
                  Adaptive recipe · {activeRecipe.activity} ·{' '}
                  {activeRecipe.outcome.replaceAll('-', ' ')}
                </p>
                <p className="mt-1 leading-4 text-nss-muted">{activeRecipe.boundary}</p>
              </div>
              {authoringAbstraction === 'classroom' &&
                (activeRecipe.outcome === 'classroom-direct' ||
                  activeRecipe.outcome === 'classroom-structural') && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange(applyAdaptiveAuthoringRecipe(setup, activeConcept.id).setup)
                    }
                    className="rounded-md border border-nss-primary/30 px-2.5 py-1.5 font-semibold text-nss-primary"
                  >
                    Apply recommended setup
                  </button>
                )}
            </div>
            {activeRecipe.requiredGivens.length > 0 && (
              <p className="mt-2 text-nss-muted">
                Author must supply: {activeRecipe.requiredGivens.join(', ')}. The Studio will not
                invent these values.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-3 rounded-lg border border-nss-border bg-nss-surface p-4 md:grid-cols-[auto_1fr_1fr]">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={Boolean(setup.budget)}
            onChange={(event) =>
              onChange({
                ...setup,
                budget: event.currentTarget.checked ? { unit: 'cost', cap: 100 } : undefined
              })
            }
          />
          Grade a budget
        </label>
        <select
          aria-label="Budget unit"
          disabled={!setup.budget}
          value={setup.budget?.unit ?? 'cost'}
          onChange={(event) =>
            setup.budget &&
            onChange({
              ...setup,
              budget: {
                ...setup.budget,
                unit: event.currentTarget.value as 'cost' | 'nodes' | 'edges'
              }
            })
          }
          className="rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs text-nss-text disabled:opacity-50"
        >
          <option value="cost">Cost</option>
          <option value="nodes">Node count</option>
          <option value="edges">Edge count</option>
        </select>
        <input
          aria-label="Budget cap"
          type="number"
          min="0.0001"
          disabled={!setup.budget}
          value={setup.budget?.cap ?? ''}
          onChange={(event) =>
            setup.budget &&
            onChange({
              ...setup,
              budget: {
                ...setup.budget,
                cap: optionalPositiveNumber(event.currentTarget.value) ?? setup.budget.cap
              }
            })
          }
          className="rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs text-nss-text disabled:opacity-50"
          placeholder="Cap"
        />
      </div>

      <label className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-nss-text">
        <input
          type="checkbox"
          checked={setup.suiteVisibleToStudent}
          onChange={(event) =>
            onChange({ ...setup, suiteVisibleToStudent: event.currentTarget.checked })
          }
        />
        Let learners see grading scenarios
      </label>

      <label className="mt-3 flex items-start gap-2 text-[11px] font-semibold text-nss-text">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={setup.classroom?.designChecks === true}
          onChange={(event) =>
            onChange({
              ...setup,
              classroom: withDesignChecks(setup.classroom, event.currentTarget.checked)
            })
          }
        />
        <span>
          Show design checks in Classroom mode
          <span className="mt-0.5 block font-normal text-nss-muted">
            Warnings such as &quot;single point of failure&quot;. Hidden by default in Classroom
            mode; turn on for a question that teaches redundancy.
          </span>
        </span>
      </label>

      <ClassroomAuthoringEditor setup={setup} peakRps={peakRps} onChange={onChange} />
    </section>
  )
}
