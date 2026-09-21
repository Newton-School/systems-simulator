import { Network, Plus, Trash2 } from 'lucide-react'
import { AUTHORING_COMPONENT_CAPABILITIES } from '../../../../engine/analysis/authoringCapabilities'
import {
  AUTHORING_STRUCTURAL_CATEGORIES,
  AUTHORING_STRUCTURAL_EDGE_MODES,
  AUTHORING_STRUCTURAL_RULE_KIND_META,
  compileAuthoringStructuralRule,
  createAuthoringStructuralRule,
  getAuthoringStructuralRuleCapability,
  type AuthoringStructuralRuleAction,
  type AuthoringStructuralRuleDraft,
  type AuthoringStructuralRuleKind
} from '../../../../engine/analysis/questionAuthoringStructuralRules'
import { RequiredIndicator } from './RequiredIndicator'

interface StructuralGradingEditorProps {
  rules: readonly AuthoringStructuralRuleDraft[]
  onAction: (action: AuthoringStructuralRuleAction) => void
  compact?: boolean
}

function ComponentSelect({
  label,
  value,
  onChange
}: {
  label: string
  value: string | undefined
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
        {label} <RequiredIndicator />
      </span>
      <select
        aria-label={label}
        value={value ?? ''}
        required
        onChange={(event) => onChange(event.currentTarget.value)}
        className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
      >
        <option value="">Select a component…</option>
        {AUTHORING_COMPONENT_CAPABILITIES.map((capability) => (
          <option key={capability.id} value={capability.id}>
            {capability.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  onChange
}: {
  label: string
  value: number | null | undefined
  min: number
  onChange: (value: number | null) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
        {label} <RequiredIndicator />
      </span>
      <input
        aria-label={label}
        type="number"
        min={min}
        step="1"
        value={value ?? ''}
        required
        onChange={(event) =>
          onChange(event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)
        }
        className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
      />
    </label>
  )
}

function RuleFields({
  rule,
  onAction
}: {
  rule: AuthoringStructuralRuleDraft
  onAction: (action: AuthoringStructuralRuleAction) => void
}): React.JSX.Element {
  const patch = (changes: Partial<Omit<AuthoringStructuralRuleDraft, 'id'>>): void =>
    onAction({ type: 'update', id: rule.id, changes })

  switch (rule.kind) {
    case 'requires_component':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            label="Component"
            value={rule.componentType}
            onChange={(v) => patch({ componentType: v })}
          />
          <NumberField
            label="Minimum count"
            value={rule.minCount}
            min={1}
            onChange={(v) => patch({ minCount: v })}
          />
        </div>
      )
    case 'requires_category':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Category <RequiredIndicator />
            </span>
            <select
              aria-label="Category"
              value={rule.category ?? ''}
              required
              onChange={(event) =>
                patch({
                  category: (event.currentTarget.value ||
                    undefined) as AuthoringStructuralRuleDraft['category']
                })
              }
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            >
              <option value="">Select a category…</option>
              {AUTHORING_STRUCTURAL_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="Minimum count"
            value={rule.minCount}
            min={1}
            onChange={(v) => patch({ minCount: v })}
          />
        </div>
      )
    case 'requires_edge':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <ComponentSelect
            label="From"
            value={rule.fromType}
            onChange={(v) => patch({ fromType: v })}
          />
          <ComponentSelect label="To" value={rule.toType} onChange={(v) => patch({ toType: v })} />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Edge mode (optional)
            </span>
            <select
              aria-label="Edge mode"
              value={rule.mode ?? ''}
              onChange={(event) =>
                patch({
                  mode: (event.currentTarget.value ||
                    undefined) as AuthoringStructuralRuleDraft['mode']
                })
              }
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            >
              <option value="">Any edge</option>
              {AUTHORING_STRUCTURAL_EDGE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
        </div>
      )
    case 'requires_path':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            label="From"
            value={rule.fromType}
            onChange={(v) => patch({ fromType: v })}
          />
          <ComponentSelect label="To" value={rule.toType} onChange={(v) => patch({ toType: v })} />
        </div>
      )
    case 'max_component_count':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            label="Component"
            value={rule.componentType}
            onChange={(v) => patch({ componentType: v })}
          />
          <NumberField
            label="Maximum count"
            value={rule.maxCount}
            min={0}
            onChange={(v) => patch({ maxCount: v })}
          />
        </div>
      )
    case 'requires_redundancy':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            label="Component"
            value={rule.componentType}
            onChange={(v) => patch({ componentType: v })}
          />
          <NumberField
            label="Minimum replicas"
            value={rule.minReplicas}
            min={1}
            onChange={(v) => patch({ minReplicas: v })}
          />
        </div>
      )
    case 'forbids_component':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            label="Component"
            value={rule.componentType}
            onChange={(v) => patch({ componentType: v })}
          />
        </div>
      )
    case 'min_node_count':
    case 'max_node_count':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Node count"
            value={rule.count}
            min={0}
            onChange={(v) => patch({ count: v })}
          />
        </div>
      )
    case 'requires_connected_graph':
    case 'requires_single_source':
      return (
        <p className="text-[11px] text-nss-muted">
          This rule inspects the whole graph and needs no further configuration.
        </p>
      )
    default:
      return <></>
  }
}

export function StructuralGradingEditor({
  rules,
  onAction,
  compact = false
}: StructuralGradingEditorProps): React.JSX.Element {
  return (
    <section
      className={
        compact
          ? 'bg-transparent'
          : 'rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm'
      }
      aria-labelledby="structural-grading-title"
    >
      {!compact && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
              Topology-shape obligation
            </p>
            <h3
              id="structural-grading-title"
              className="mt-1 text-base font-semibold text-nss-text"
            >
              Structural grading
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
              Assert the shape of the submitted graph — components, counts, edges, paths,
              redundancy, connectivity. Every catalog structural kind is available; the learner
              never writes JSON.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onAction({
                type: 'add',
                rule: createAuthoringStructuralRule(
                  'requires_single_source',
                  `structural-rule-${rules.length + 1}`
                )
              })
            }
            className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
          >
            <Plus size={14} aria-hidden="true" />
            Add structural test
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <Network size={23} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No structural tests yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Add the first rule that inspects the learner’s submitted topology.
          </p>
        </div>
      ) : (
        <ol className={compact ? 'space-y-2' : 'mt-5 space-y-4'}>
          {rules.map((rule) => {
            const capability = getAuthoringStructuralRuleCapability(rule.kind)
            const compiled = compileAuthoringStructuralRule(rule)

            return (
              <li
                key={rule.id}
                data-structural-rule-id={rule.id}
                className={`rounded-lg border border-nss-border bg-nss-surface ${compact ? 'p-3' : 'p-4'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label>
                      <span className="sr-only">Structural rule kind</span>
                      <select
                        aria-label="Structural rule kind"
                        value={rule.kind}
                        onChange={(event) =>
                          onAction({
                            type: 'update-kind',
                            id: rule.id,
                            kind: event.currentTarget.value as AuthoringStructuralRuleKind
                          })
                        }
                        className="rounded-md border border-nss-primary/25 bg-nss-primary/10 px-2 py-1.5 text-xs font-semibold text-nss-primary outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                      >
                        {AUTHORING_STRUCTURAL_RULE_KIND_META.map((meta) => (
                          <option key={meta.kind} value={meta.kind}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!compact && (
                      <span className="rounded-full border border-nss-success/25 bg-nss-success/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-success">
                        {capability.supportTier}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onAction({ type: 'remove', id: rule.id })}
                    aria-label="Remove structural test"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>

                <div
                  className={`${compact ? 'mt-3 px-1 pb-1' : 'mt-4 rounded-lg border border-nss-borderHigh bg-nss-panel px-4 py-4'}`}
                >
                  <RuleFields rule={rule} onAction={onAction} />
                </div>

                {!compact && (
                  <div
                    className={`mt-4 rounded-md border px-3 py-2.5 ${
                      compiled
                        ? 'border-nss-primary/20 bg-nss-primary/5'
                        : 'border-nss-warning/30 bg-nss-warning/10'
                    }`}
                  >
                    <p
                      className={`text-[10px] font-semibold uppercase tracking-wide ${
                        compiled ? 'text-nss-primary' : 'text-nss-warning'
                      }`}
                    >
                      {compiled ? 'Compiled structural meaning' : 'Rule incomplete'}
                    </p>
                    <output
                      data-testid="structural-rule-compiled-meaning"
                      className="mt-1 block text-xs leading-5 text-nss-text"
                    >
                      {compiled
                        ? compiled.description
                        : 'Complete the highlighted fields before this rule can grade a topology.'}
                    </output>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
