import { Minus, Plus } from 'lucide-react'
import type { ConceptCard } from '../../../../engine/classroom/conceptCards'
import { classroomControlAllows, type ClassroomSettings } from '../../../../engine/classroom/types'
import { resolveClassroomGivens } from '../../../../engine/classroom/compileClassroom'
import { formatCostPerHour, formatRps } from '../../../../engine/classroom/givensTable'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

interface ClassroomInspectorProps {
  card: ConceptCard
  componentType: string
  settings: ClassroomSettings | undefined
  /** Peak traffic the question states (shown on the Users card). */
  peakRps?: number
  copies: number
  /** Null when copies can't be changed (locked node, or a card without copies). */
  onCopiesChange: ((copies: number) => void) | null
  choices: Record<string, string>
  onChoiceChange: ((choiceId: string, optionId: string) => void) | null
  canOpenArchitect: boolean
  onOpenArchitect: (() => void) | null
  guidedKnobs: Array<{ path: string; label: string; value: number | string | undefined }>
  onGuidedKnobChange: ((path: string, value: number | string) => void) | null
}

/**
 * The whole inspector for a Classroom node: the givens (read-only), the copy
 * count, and nothing else. Every engine knob is compiled from the givens.
 */
export function ClassroomInspector({
  card,
  componentType,
  settings,
  peakRps,
  copies,
  onCopiesChange,
  choices,
  onChoiceChange,
  canOpenArchitect,
  onOpenArchitect,
  guidedKnobs,
  onGuidedKnobChange
}: ClassroomInspectorProps): React.JSX.Element {
  const givens = resolveClassroomGivens(card, componentType, settings)
  const rows: { label: string; value: string }[] = []
  if (card.role === 'source' && peakRps !== undefined) {
    rows.push({ label: 'Peak traffic', value: formatRps(peakRps) })
  }
  if (card.role === 'passthrough') {
    if (card.classroomFact) rows.push({ label: 'Behaviour', value: card.classroomFact })
  }
  if (givens.capacityRps !== undefined) {
    rows.push({ label: 'Capacity per copy', value: formatRps(givens.capacityRps) })
  }
  if (givens.costPerHour !== undefined) {
    rows.push({ label: 'Cost per copy', value: formatCostPerHour(givens.costPerHour) })
  }
  const range = card.copies
  const namedChoices = (settings?.choices?.[componentType] ?? []).filter(
    (choice) =>
      !settings?.controls ||
      settings.controls.some(
        (control) =>
          control.kind === 'named-choice' &&
          control.component === componentType &&
          control.choiceId === choice.id
      )
  )
  const hardware = settings?.hardware?.[componentType]
  const copiesServeObjective = classroomControlAllows(settings, 'copies', componentType)
  const canStep = onCopiesChange !== null && range !== undefined && copiesServeObjective
  const visibleGuidedKnobs = guidedKnobs.filter((knob) =>
    classroomControlAllows(settings, 'guided-knob', knob.path)
  )

  return (
    <div className="space-y-5" data-testid="classroom-inspector">
      <p className="text-[11px] leading-relaxed text-nss-muted">{card.summary}</p>

      {rows.length > 0 && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE}>Givens</h3>
          <dl className="space-y-1.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="text-nss-muted">{row.label}</dt>
                <dd className="font-semibold tabular-nums text-nss-text">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10px] leading-snug text-nss-muted">
            These are the facts of the problem, so they can&apos;t be changed here.
          </p>
        </section>
      )}

      {range && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE}>Copies</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Remove a copy"
              disabled={!canStep || copies <= range.min}
              onClick={() => onCopiesChange?.(copies - 1)}
              className="rounded-md border border-nss-border bg-nss-surface p-1.5 text-nss-text hover:border-nss-primary disabled:opacity-40"
            >
              <Minus size={12} />
            </button>
            <input
              type="number"
              aria-label="Copies"
              min={range.min}
              max={range.max}
              value={copies}
              disabled={!canStep}
              onChange={(event) => {
                const next = Math.round(Number(event.currentTarget.value))
                if (Number.isFinite(next)) {
                  onCopiesChange?.(Math.min(range.max, Math.max(range.min, next)))
                }
              }}
              className="w-16 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1 text-center text-sm font-semibold tabular-nums text-nss-text outline-none focus:border-nss-primary disabled:opacity-60"
            />
            <button
              type="button"
              aria-label="Add a copy"
              disabled={!canStep || copies >= range.max}
              onClick={() => onCopiesChange?.(copies + 1)}
              className="rounded-md border border-nss-border bg-nss-surface p-1.5 text-nss-text hover:border-nss-primary disabled:opacity-40"
            >
              <Plus size={12} />
            </button>
          </div>
          {givens.capacityRps !== undefined && (
            <p className="text-[11px] leading-relaxed text-nss-muted">
              {copies} × {formatRps(givens.capacityRps)} = {formatRps(copies * givens.capacityRps)}{' '}
              in total.
            </p>
          )}
          {!copiesServeObjective && (
            <p className="text-[10px] leading-snug text-nss-muted">
              Copy count is locked because it is not part of this lesson&apos;s objectives.
            </p>
          )}
        </section>
      )}

      {namedChoices.length > 0 && (
        <section className="space-y-3">
          <h3 className={SECTION_TITLE}>Choices</h3>
          {namedChoices.map((choice) => (
            <fieldset key={choice.id} className="space-y-1.5">
              <legend className="text-xs font-semibold text-nss-text">{choice.label}</legend>
              <p className="text-[10px] text-nss-muted">{choice.explanation}</p>
              {choice.options.map((option) => (
                <label
                  key={option.id}
                  className="flex items-start gap-2 rounded border border-nss-border p-2 text-[11px]"
                >
                  <input
                    type="radio"
                    name={`classroom-choice-${choice.id}`}
                    checked={(choices[choice.id] ?? choice.options[0]?.id) === option.id}
                    disabled={!onChoiceChange}
                    onChange={() => onChoiceChange?.(choice.id, option.id)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <span className="block text-nss-muted">{option.explanation}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ))}
        </section>
      )}

      {visibleGuidedKnobs.length > 0 && (
        <section className="space-y-2">
          <h3 className={SECTION_TITLE}>Guided controls</h3>
          {visibleGuidedKnobs.map((knob) => (
            <label key={knob.path} className="block text-[11px] font-semibold text-nss-text">
              {knob.label}
              <input
                type={typeof knob.value === 'number' ? 'number' : 'text'}
                value={knob.value ?? ''}
                disabled={!onGuidedKnobChange}
                onChange={(event) =>
                  onGuidedKnobChange?.(
                    knob.path,
                    typeof knob.value === 'number'
                      ? event.currentTarget.valueAsNumber
                      : event.currentTarget.value
                  )
                }
                className="mt-1 block w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5"
              />
            </label>
          ))}
          <p className="text-[10px] text-nss-muted">
            Each unlocked control is tied to a learning objective by the question author.
          </p>
        </section>
      )}

      {canOpenArchitect && (
        <section className="space-y-2 border-t border-nss-border pt-4">
          <h3 className={SECTION_TITLE}>One level deeper</h3>
          {hardware && (
            <details className="rounded border border-nss-border p-2 text-[11px]">
              <summary className="cursor-pointer font-semibold text-nss-text">
                How would this look on real hardware?
              </summary>
              <p className="mt-2 text-nss-muted">{hardware.description}</p>
              <p className="mt-1 font-mono text-nss-text">
                {hardware.instanceType}
                {hardware.executionProfile ? ` · ${hardware.executionProfile}` : ''}
              </p>
            </details>
          )}
          <button
            type="button"
            onClick={onOpenArchitect ?? undefined}
            className="w-full rounded-md border border-nss-primary px-3 py-2 text-xs font-semibold text-nss-primary hover:bg-nss-primary/10"
          >
            Open this design in Architect mode
          </button>
        </section>
      )}
    </div>
  )
}
