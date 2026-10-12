import { Blocks } from 'lucide-react'
import type { QuestionAuthoringSetupDraft } from '../../../../engine/analysis/questionAuthoringProject'
import {
  BUILDER_NODE_CLASS_IDS,
  describeBuilderPolicy,
  isBuilderPolicyRestrictive,
  normalizeBuilderPolicy,
  RUNTIME_TEMPLATE_IDS,
  TRAIT_PACK_IDS,
  TRAIT_PACK_LABELS,
  type BuilderPolicy
} from '../../../../engine/analysis/builderPolicy'
import { RUNTIME_TEMPLATES } from '../../../../engine/catalog/customDefinitions'

interface BuilderPolicyEditorProps {
  setup: QuestionAuthoringSetupDraft
  onChange: (setup: QuestionAuthoringSetupDraft) => void
}

function optionalCount(value: string, min: number): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min) return undefined
  return Math.floor(parsed)
}

function RestrictList<T extends string>({
  label,
  help,
  options,
  selected,
  optionLabel,
  optionHint,
  onChange
}: {
  label: string
  help: string
  options: readonly T[]
  /** undefined = unrestricted (every option allowed). */
  selected: readonly T[] | undefined
  optionLabel: (option: T) => string
  optionHint?: (option: T) => string
  onChange: (next: T[] | undefined) => void
}): React.JSX.Element {
  const restricted = selected !== undefined
  const selectedSet = new Set(selected ?? [])
  return (
    <fieldset className="min-w-0 rounded-lg border border-nss-border bg-nss-surface p-3">
      <legend className="sr-only">{label}</legend>
      <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
        <input
          type="checkbox"
          checked={restricted}
          onChange={(event) => onChange(event.currentTarget.checked ? [...options] : undefined)}
        />
        {label}
      </label>
      <p className="mt-1 text-[10px] leading-4 text-nss-muted">{help}</p>
      {restricted ? (
        <div className="mt-2 grid gap-1">
          {options.map((option) => (
            <label
              key={option}
              className="flex items-start gap-2 rounded px-1.5 py-1 text-[11px] text-nss-text hover:bg-nss-panel"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(option)}
                aria-label={`Allow ${optionLabel(option)}`}
                onChange={(event) => {
                  const next = new Set(selectedSet)
                  if (event.currentTarget.checked) next.add(option)
                  else next.delete(option)
                  onChange(options.filter((candidate) => next.has(candidate)))
                }}
                className="mt-0.5"
              />
              <span>
                {optionLabel(option)}
                {optionHint ? (
                  <span className="block text-[10px] text-nss-muted">{optionHint(option)}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  )
}

/**
 * Question Studio editor for the builder policy (custom-node spec §15): whether
 * learners may use the Service builder / Custom Node builder, and which runtimes,
 * node classes and trait packs a created definition may use. Leaving every
 * control at its default stores no policy, which is today's behaviour.
 */
export function BuilderPolicyEditor({
  setup,
  onChange
}: BuilderPolicyEditorProps): React.JSX.Element {
  const policy: BuilderPolicy = setup.builderPolicy ?? {}
  const update = (changes: Partial<BuilderPolicy>): void => {
    onChange({ ...setup, builderPolicy: normalizeBuilderPolicy({ ...policy, ...changes }) })
  }
  const allowServiceBuilder = policy.allowServiceBuilder ?? true
  const restrictive = isBuilderPolicyRestrictive(setup.builderPolicy)

  return (
    <section
      className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm"
      aria-label="Builder policy"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
          <Blocks size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-nss-text">Builder policy</h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Control the Service builder and Custom Node builder. Created nodes still grade as their
            backing component type; this policy adds a separate graded check on how they were built.
            Defaults allow everything.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-5 rounded-lg border border-nss-border bg-nss-surface p-4">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={allowServiceBuilder}
            onChange={(event) =>
              update({ allowServiceBuilder: event.currentTarget.checked ? undefined : false })
            }
          />
          Allow Service builder
        </label>
        <label
          className={`flex items-center gap-2 text-[11px] font-semibold ${
            allowServiceBuilder ? 'text-nss-text' : 'text-nss-muted'
          }`}
        >
          <input
            type="checkbox"
            disabled={!allowServiceBuilder}
            checked={allowServiceBuilder && (policy.allowMyServices ?? true)}
            onChange={(event) =>
              update({ allowMyServices: event.currentTarget.checked ? undefined : false })
            }
          />
          Allow My Services
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={policy.allowCustomNodeBuilder ?? true}
            onChange={(event) =>
              update({ allowCustomNodeBuilder: event.currentTarget.checked ? undefined : false })
            }
          />
          Allow Custom Node builder
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={policy.lockDefinitionsAfterFirstRun ?? false}
            onChange={(event) =>
              update({ lockDefinitionsAfterFirstRun: event.currentTarget.checked || undefined })
            }
          />
          Lock definitions after the first run
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-[11px] font-semibold text-nss-text">
          Maximum created definitions
          <input
            type="number"
            min="0"
            aria-label="Maximum created definitions"
            value={policy.maxDefinitions ?? ''}
            placeholder="No limit"
            onChange={(event) =>
              update({ maxDefinitions: optionalCount(event.currentTarget.value, 0) })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
        </label>
        <label className="text-[11px] font-semibold text-nss-text">
          Maximum operations per service
          <input
            type="number"
            min="1"
            aria-label="Maximum operations per service"
            value={policy.maxOperationsPerService ?? ''}
            placeholder="No limit"
            onChange={(event) =>
              update({ maxOperationsPerService: optionalCount(event.currentTarget.value, 1) })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <RestrictList
          label="Restrict runtimes"
          help="Only the checked runtimes are offered in the builders."
          options={RUNTIME_TEMPLATE_IDS}
          selected={policy.allowedRuntimeTemplates}
          optionLabel={(id) => RUNTIME_TEMPLATES[id].label}
          optionHint={(id) =>
            `${RUNTIME_TEMPLATES[id].allowedDefinitionKinds.join(' / ')} - runs as ${RUNTIME_TEMPLATES[id].componentType}`
          }
          onChange={(next) => update({ allowedRuntimeTemplates: next })}
        />
        <RestrictList
          label="Restrict node classes"
          help="Created definitions must have one of the checked classes."
          options={BUILDER_NODE_CLASS_IDS}
          selected={policy.allowedNodeClasses}
          optionLabel={(id) => id}
          onChange={(next) => update({ allowedNodeClasses: next })}
        />
        <RestrictList
          label="Restrict trait packs"
          help="Unchecked traits cannot be enabled on created nodes, in the builder or the panel."
          options={TRAIT_PACK_IDS}
          selected={policy.allowedTraitPacks}
          optionLabel={(id) => TRAIT_PACK_LABELS[id]}
          onChange={(next) => update({ allowedTraitPacks: next })}
        />
      </div>

      <p className="mt-4 text-[11px] text-nss-muted" aria-live="polite">
        {restrictive
          ? `Learners see: ${describeBuilderPolicy(setup.builderPolicy)}.`
          : 'No builder policy: both builders are available, as in open build.'}
      </p>
    </section>
  )
}
