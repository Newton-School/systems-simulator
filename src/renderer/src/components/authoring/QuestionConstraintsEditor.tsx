import { Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AUTHORING_COMPONENT_CAPABILITIES } from '../../../../engine/analysis/authoringCapabilities'
import type { QuestionAuthoringSetupDraft } from '../../../../engine/analysis/questionAuthoringProject'
import { TooltipInfo } from '../ui/Tooltip'

interface QuestionConstraintsEditorProps {
  setup: QuestionAuthoringSetupDraft
  onChange: (setup: QuestionAuthoringSetupDraft) => void
}

function optionalPositive(value: string, integer = false): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return integer ? Math.floor(parsed) : parsed
}

function orderedTypeIds(values: Set<string>): string[] {
  return AUTHORING_COMPONENT_CAPABILITIES.filter((component) => values.has(component.id)).map(
    (component) => component.id
  )
}

function ComponentTypeChecklist({
  label,
  selected,
  query,
  onQueryChange,
  onToggle,
  help
}: {
  label: string
  selected: readonly string[]
  query: string
  onQueryChange: (query: string) => void
  onToggle: (componentType: string, checked: boolean) => void
  help: string
}): React.JSX.Element {
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return AUTHORING_COMPONENT_CAPABILITIES
    return AUTHORING_COMPONENT_CAPABILITIES.filter(
      (component) =>
        component.label.toLowerCase().includes(normalized) ||
        component.id.toLowerCase().includes(normalized)
    )
  }, [query])

  return (
    <fieldset className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-[11px] font-semibold text-nss-text">{label}</legend>
        <span className="text-[10px] tabular-nums text-nss-muted">
          {selected.length > 0 ? `${selected.length} selected` : 'None selected'}
        </span>
      </div>
      <div className="relative mt-1.5">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search component types…"
          aria-label={`Search ${label.toLowerCase()}`}
          className="block w-full rounded-t-md border border-nss-border bg-nss-input-bg py-2 pl-8 pr-3 text-xs font-normal text-nss-text outline-none placeholder:text-nss-muted focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
        />
      </div>
      <div className="h-56 overflow-y-auto rounded-b-md border border-t-0 border-nss-border bg-nss-input-bg p-1.5">
        {filtered.length > 0 ? (
          filtered.map((component) => {
            const checked = selectedSet.has(component.id)
            return (
              <label
                key={component.id}
                className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                  checked
                    ? 'bg-nss-primary/10 text-nss-text'
                    : 'text-nss-muted hover:bg-nss-surface'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => onToggle(component.id, event.currentTarget.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-nss-border text-nss-primary focus:ring-nss-primary/40"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-nss-text">{component.label}</span>
                  <span className="block truncate text-[10px] text-nss-muted">{component.id}</span>
                </span>
              </label>
            )
          })
        ) : (
          <p className="px-3 py-8 text-center text-[11px] text-nss-muted">
            No component types match “{query}”.
          </p>
        )}
      </div>
      <p className="mt-1 text-[10px] font-normal leading-4 text-nss-muted">{help}</p>
    </fieldset>
  )
}

export function QuestionConstraintsEditor({
  setup,
  onChange
}: QuestionConstraintsEditorProps): React.JSX.Element {
  const [allowedQuery, setAllowedQuery] = useState('')
  const [forbiddenQuery, setForbiddenQuery] = useState('')
  const constraints = setup.constraints
  const updateConstraints = (changes: Partial<typeof constraints>): void => {
    onChange({ ...setup, constraints: { ...constraints, ...changes } })
  }
  const toggleAllowed = (componentType: string, checked: boolean): void => {
    const allowed = new Set(constraints.allowedNodeTypes ?? [])
    if (checked) allowed.add(componentType)
    else allowed.delete(componentType)
    const forbidden = new Set(constraints.forbiddenNodeTypes ?? [])
    if (checked) forbidden.delete(componentType)
    const allowedNodeTypes = orderedTypeIds(allowed)
    const forbiddenNodeTypes = orderedTypeIds(forbidden)
    updateConstraints({
      allowedNodeTypes: allowedNodeTypes.length > 0 ? allowedNodeTypes : undefined,
      forbiddenNodeTypes: forbiddenNodeTypes.length > 0 ? forbiddenNodeTypes : undefined
    })
  }
  const toggleForbidden = (componentType: string, checked: boolean): void => {
    const forbidden = new Set(constraints.forbiddenNodeTypes ?? [])
    if (checked) forbidden.add(componentType)
    else forbidden.delete(componentType)
    const allowed = new Set(constraints.allowedNodeTypes ?? [])
    if (checked) allowed.delete(componentType)
    const forbiddenNodeTypes = orderedTypeIds(forbidden)
    const allowedNodeTypes = orderedTypeIds(allowed)
    updateConstraints({
      forbiddenNodeTypes: forbiddenNodeTypes.length > 0 ? forbiddenNodeTypes : undefined,
      allowedNodeTypes: allowedNodeTypes.length > 0 ? allowedNodeTypes : undefined
    })
  }

  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nss-primary/10 text-nss-primary">
          <ShieldCheck size={17} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-nss-text">Learner constraints</h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Restrict the component palette and enforce hard design limits. Empty component lists
            mean unrestricted.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ComponentTypeChecklist
          label="Allowed component types"
          selected={constraints.allowedNodeTypes ?? []}
          query={allowedQuery}
          onQueryChange={setAllowedQuery}
          onToggle={toggleAllowed}
          help="Leave empty to allow the full palette. Selecting a type here removes it from Forbidden."
        />

        <ComponentTypeChecklist
          label="Forbidden component types"
          selected={constraints.forbiddenNodeTypes ?? []}
          query={forbiddenQuery}
          onQueryChange={setForbiddenQuery}
          onToggle={toggleForbidden}
          help="Selected types are hidden from learners and fail validation if imported."
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-[11px] font-semibold text-nss-text">
          <span className="flex items-center gap-1.5">
            Maximum nodes
            <TooltipInfo
              label="Explain maximum nodes"
              content={
                <p className="text-xs leading-5 text-nss-muted">
                  The maximum number of nodes allowed in the learner’s submitted topology. A design
                  with more nodes fails this constraint.
                </p>
              }
            />
          </span>
          <input
            type="number"
            min="1"
            value={constraints.maxNodeCount ?? ''}
            onChange={(event) =>
              updateConstraints({ maxNodeCount: optionalPositive(event.currentTarget.value, true) })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
        </label>
        <label className="text-[11px] font-semibold text-nss-text">
          <span className="flex items-center gap-1.5">
            Maximum total workers
            <TooltipInfo
              label="Explain maximum total workers"
              content={
                <p className="text-xs leading-5 text-nss-muted">
                  Caps derived effective concurrency across worker-capable nodes. It accounts for
                  configured instances and each node’s effective workload concurrency.
                </p>
              }
              width={300}
            />
          </span>
          <input
            type="number"
            min="1"
            value={constraints.maxTotalWorkers ?? ''}
            onChange={(event) =>
              updateConstraints({
                maxTotalWorkers: optionalPositive(event.currentTarget.value, true)
              })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
        </label>
        <label className="text-[11px] font-semibold text-nss-text">
          <span className="flex items-center gap-1.5">
            Maximum runtime cost
            <TooltipInfo
              label="Explain maximum runtime cost"
              content={
                <p className="text-xs leading-5 text-nss-muted">
                  The maximum estimated hourly cost in USD for the learner’s topology. The estimate
                  includes priced node capacity and applicable traffic or edge costs.
                </p>
              }
              width={300}
            />
          </span>
          <input
            type="number"
            min="0.0001"
            step="any"
            value={constraints.maxBudget ?? ''}
            onChange={(event) =>
              updateConstraints({ maxBudget: optionalPositive(event.currentTarget.value) })
            }
            className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text"
          />
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-5 rounded-lg border border-nss-border bg-nss-surface p-4">
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={constraints.canModifyScaffold}
            onChange={(event) =>
              updateConstraints({ canModifyScaffold: event.currentTarget.checked })
            }
          />
          Learner may edit scaffold nodes
        </label>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
          <input
            type="checkbox"
            checked={constraints.canRemoveScaffoldNodes}
            onChange={(event) =>
              updateConstraints({ canRemoveScaffoldNodes: event.currentTarget.checked })
            }
          />
          Learner may remove scaffold nodes
        </label>
      </div>
    </section>
  )
}
