import { CornerDownRight, Network, Plus, Trash2 } from 'lucide-react'
import { AUTHORING_COMPONENT_CAPABILITIES } from '../../../../engine/analysis/authoringCapabilities'
import {
  AUTHORING_SEMANTIC_RULE_KIND_META,
  AUTHORING_STORAGE_FIT_ACCESS_PATTERNS,
  compileAuthoringSemanticRule,
  createAuthoringSemanticRule,
  getAuthoringSemanticRuleCapability,
  type AuthoringSemanticRuleAction,
  type AuthoringSemanticRuleDraft,
  type AuthoringSemanticRuleKind
} from '../../../../engine/analysis/questionAuthoringSemanticRules'
import {
  BROKER_TIMELINE_STATES,
  COMMIT_OUTCOME_TIMELINE_STATES,
  DELIVERY_TIMELINE_STATES,
  IDEMPOTENCY_TIMELINE_STATES,
  LOCK_TIMELINE_STATES,
  PROTOCOL_TIMELINE_STATES,
  REPLICATION_TIMELINE_STATES,
  REQUEST_TIMELINE_STATES,
  RESERVATION_TIMELINE_STATES
} from '../../../../engine/core/simulationSemantics'
import { REQUEST_OUTCOME_STATUSES } from '../../../../engine/core/event-stream'
import {
  componentPropertyDefinitionsFor,
  getComponentPropertyDefinition
} from '../../../../engine/analysis/componentPropertyCatalog'
import { RequiredIndicator } from './RequiredIndicator'

interface SemanticGradingEditorProps {
  rules: readonly AuthoringSemanticRuleDraft[]
  onAction: (action: AuthoringSemanticRuleAction) => void
  compact?: boolean
}

const ACCESS_PATTERN_LABELS: Readonly<Record<string, string>> = {
  'point-lookup': 'Point lookup (key → value)',
  'time-series': 'Time series (append + range)',
  'append-only-ledger': 'Append-only ledger',
  'transactional-relational': 'Transactional / relational',
  'search-index': 'Search index (full-text)',
  blob: 'Blob (large objects)'
}

const RUNTIME_STATES: Readonly<Record<string, readonly string[]>> = {
  request: REQUEST_TIMELINE_STATES,
  delivery: DELIVERY_TIMELINE_STATES,
  broker: BROKER_TIMELINE_STATES,
  replication: REPLICATION_TIMELINE_STATES,
  protocol: PROTOCOL_TIMELINE_STATES,
  idempotency: IDEMPOTENCY_TIMELINE_STATES,
  'commit-outcome': COMMIT_OUTCOME_TIMELINE_STATES,
  lock: LOCK_TIMELINE_STATES,
  reservation: RESERVATION_TIMELINE_STATES
}

function componentLabel(id: string | undefined): string {
  if (!id) return 'unset'
  return AUTHORING_COMPONENT_CAPABILITIES.find((capability) => capability.id === id)?.label ?? id
}

function ComponentSelect({
  id,
  label,
  value,
  optional,
  onChange
}: {
  id: string
  label: string
  value: string | undefined
  optional?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
        {label}
        {optional ? ' (optional)' : ''}
        {!optional && <RequiredIndicator />}
      </span>
      <select
        id={id}
        aria-label={label}
        value={value ?? ''}
        required={!optional}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
      >
        <option value="">{optional ? 'None' : 'Select a component…'}</option>
        {AUTHORING_COMPONENT_CAPABILITIES.map((capability) => (
          <option key={capability.id} value={capability.id}>
            {capability.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ComponentMultiSelect({
  label,
  values,
  onChange
}: {
  label: string
  values: string[] | undefined
  onChange: (values: string[]) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
        {label} <RequiredIndicator />
      </span>
      <select
        multiple
        value={values ?? []}
        required
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
        }
        className="min-h-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
      >
        {AUTHORING_COMPONENT_CAPABILITIES.map((capability) => (
          <option key={capability.id} value={capability.id}>
            {capability.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function describeCompiled(
  compiled: NonNullable<ReturnType<typeof compileAuthoringSemanticRule>>
): string {
  switch (compiled.kind) {
    case 'componentPresence':
      return `Include at least ${compiled.minCount ?? 1} ${componentLabel(compiled.componentType)} component${(compiled.minCount ?? 1) === 1 ? '' : 's'}.`
    case 'componentProperty': {
      const definition = getComponentPropertyDefinition(compiled.property)
      return `${definition?.label ?? compiled.property} must ${compiled.operator} ${String(compiled.expected)} on the required component.`
    }
    case 'placement':
      return compiled.between
        ? `${componentLabel(compiled.componentType)} must sit on the path between ${componentLabel(compiled.between[0])} and ${componentLabel(compiled.between[1])}.`
        : `${componentLabel(compiled.componentType)} must be placed correctly in the topology.`
    case 'guardedPath':
      return `Every ${componentLabel(compiled.from)} → ${compiled.to ? componentLabel(compiled.to) : 'downstream'} path must pass through ${componentLabel(compiled.guard)}.`
    case 'fanout':
      return `${componentLabel(compiled.broker)} must fan out to at least ${compiled.minConsumers} independent consumers.`
    case 'storageFit':
      return `A ${compiled.accessPattern} store must be one of: ${compiled.accept.map(componentLabel).join(', ')}.`
    case 'forbidUnjustified':
      return `${componentLabel(compiled.componentType)} must be absent unless justified.`
    case 'stateTransition':
      return `Runtime must record ${compiled.match.scope}:${compiled.match.state}.`
    case 'stateSequence':
      return `Runtime must record ${compiled.sequence.length} ordered states.`
    default:
      return 'Compiled semantic criterion.'
  }
}

function RuntimeTransitionFields({
  rule,
  patch
}: {
  rule: AuthoringSemanticRuleDraft
  patch: (changes: Partial<Omit<AuthoringSemanticRuleDraft, 'id'>>) => void
}): React.JSX.Element {
  const scope = rule.runtimeScope ?? 'request'
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Timeline scope
          </span>
          <select
            value={scope}
            onChange={(event) =>
              patch({
                runtimeScope: event.currentTarget
                  .value as AuthoringSemanticRuleDraft['runtimeScope'],
                runtimeState: RUNTIME_STATES[event.currentTarget.value][0]
              })
            }
            className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
          >
            {Object.keys(RUNTIME_STATES).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Required state
          </span>
          <select
            value={rule.runtimeState ?? ''}
            onChange={(event) => patch({ runtimeState: event.currentTarget.value })}
            className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
          >
            {RUNTIME_STATES[scope].map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Source
          </span>
          <select
            value={rule.runtimeSource ?? ''}
            onChange={(event) =>
              patch({
                runtimeSource: (event.currentTarget.value ||
                  undefined) as AuthoringSemanticRuleDraft['runtimeSource']
              })
            }
            className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
          >
            <option value="">Any</option>
            <option value="event">Event</option>
            <option value="trait">Trait</option>
            <option value="engine">Engine</option>
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Node ID
          </span>
          <input
            value={rule.runtimeNodeId ?? ''}
            onChange={(event) => patch({ runtimeNodeId: event.currentTarget.value })}
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <ComponentSelect
          id={`runtime-node-${rule.id}`}
          label="Node type"
          optional
          value={rule.runtimeNodeType}
          onChange={(value) => patch({ runtimeNodeType: value || undefined })}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Minimum
          </span>
          <input
            type="number"
            min="0"
            value={rule.minCount ?? ''}
            onChange={(event) =>
              patch({
                minCount:
                  event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Maximum
          </span>
          <input
            type="number"
            min="0"
            value={rule.maxCount ?? ''}
            onChange={(event) =>
              patch({
                maxCount:
                  event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Case filter
          </span>
          <input
            value={rule.whereCaseId ?? ''}
            onChange={(event) => patch({ whereCaseId: event.currentTarget.value })}
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Outcome filter
          </span>
          <select
            value={rule.whereOutcomeStatus ?? ''}
            onChange={(event) =>
              patch({
                whereOutcomeStatus: (event.currentTarget.value ||
                  undefined) as AuthoringSemanticRuleDraft['whereOutcomeStatus']
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          >
            <option value="">Any outcome</option>
            {REQUEST_OUTCOME_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Reason code
          </span>
          <input
            value={rule.runtimeReasonCode ?? ''}
            onChange={(event) => patch({ runtimeReasonCode: event.currentTarget.value })}
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
      </div>
    </div>
  )
}

function RuntimeSequenceFields({
  rule,
  patch
}: {
  rule: AuthoringSemanticRuleDraft
  patch: (changes: Partial<Omit<AuthoringSemanticRuleDraft, 'id'>>) => void
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      {(rule.sequence ?? []).map((matcher, index) => (
        <div
          key={index}
          className="grid gap-2 rounded border border-nss-border bg-nss-panel p-2 sm:grid-cols-2 xl:grid-cols-[0.8fr_1fr_0.8fr_1fr_1fr_1fr_auto]"
        >
          <select
            aria-label={`Sequence ${index + 1} scope`}
            value={matcher.scope}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index
                    ? {
                        ...item,
                        scope: event.currentTarget.value as typeof item.scope,
                        state: RUNTIME_STATES[event.currentTarget.value][0]
                      }
                    : item
                )
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          >
            {Object.keys(RUNTIME_STATES).map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
          <select
            aria-label={`Sequence ${index + 1} state`}
            value={matcher.state}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index ? { ...item, state: event.currentTarget.value } : item
                )
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          >
            {RUNTIME_STATES[matcher.scope].map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <input
            aria-label={`Sequence ${index + 1} node ID`}
            value={matcher.nodeId ?? ''}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index ? { ...item, nodeId: event.currentTarget.value } : item
                )
              })
            }
            placeholder="Node ID (optional)"
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
          <input
            aria-label={`Sequence ${index + 1} node type`}
            value={matcher.nodeType ?? ''}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index ? { ...item, nodeType: event.currentTarget.value } : item
                )
              })
            }
            placeholder="Node type"
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
          <select
            aria-label={`Sequence ${index + 1} source`}
            value={matcher.source ?? ''}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index
                    ? {
                        ...item,
                        source: (event.currentTarget.value || undefined) as typeof item.source
                      }
                    : item
                )
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          >
            <option value="">Any source</option>
            <option value="event">Event</option>
            <option value="trait">Trait</option>
            <option value="engine">Engine</option>
          </select>
          <input
            aria-label={`Sequence ${index + 1} reason code`}
            value={matcher.reasonCode ?? ''}
            onChange={(event) =>
              patch({
                sequence: rule.sequence!.map((item, current) =>
                  current === index ? { ...item, reasonCode: event.currentTarget.value } : item
                )
              })
            }
            placeholder="Reason code"
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={(rule.sequence?.length ?? 0) <= 2}
            onClick={() =>
              patch({ sequence: rule.sequence!.filter((_, current) => current !== index) })
            }
            className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted disabled:opacity-30"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={() =>
            patch({
              sequence: [...(rule.sequence ?? []), { scope: 'request', state: 'completed' }]
            })
          }
          className="rounded border border-nss-border px-2.5 py-1.5 text-[10px] font-semibold text-nss-text"
        >
          <Plus size={11} className="mr-1 inline" />
          Add step
        </button>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Minimum matches
          </span>
          <input
            type="number"
            min="1"
            value={rule.minMatches ?? ''}
            onChange={(event) =>
              patch({
                minMatches:
                  event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
              })
            }
            className="w-28 rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <div className="grid gap-3 rounded border border-nss-border bg-nss-panel p-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Case filter
          </span>
          <input
            value={rule.whereCaseId ?? ''}
            onChange={(event) => patch({ whereCaseId: event.currentTarget.value })}
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Outcome filter
          </span>
          <select
            value={rule.whereOutcomeStatus ?? ''}
            onChange={(event) =>
              patch({
                whereOutcomeStatus: (event.currentTarget.value ||
                  undefined) as AuthoringSemanticRuleDraft['whereOutcomeStatus']
              })
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs"
          >
            <option value="">Any outcome</option>
            {REQUEST_OUTCOME_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
            Terminal node ID
          </span>
          <input
            value={rule.whereTerminalNodeId ?? ''}
            onChange={(event) => patch({ whereTerminalNodeId: event.currentTarget.value })}
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <ComponentSelect
          id={`sequence-terminal-${rule.id}`}
          label="Terminal node type"
          optional
          value={rule.whereTerminalNodeType}
          onChange={(value) => patch({ whereTerminalNodeType: value || undefined })}
        />
      </div>
    </div>
  )
}

function RuleFields({
  rule,
  onAction,
  parentComponentType
}: {
  rule: AuthoringSemanticRuleDraft
  onAction: (action: AuthoringSemanticRuleAction) => void
  parentComponentType?: string
}): React.JSX.Element {
  const prefix = `semantic-rule-${rule.id}`
  const patch = (changes: Partial<Omit<AuthoringSemanticRuleDraft, 'id'>>): void =>
    onAction({ type: 'update', id: rule.id, changes })

  switch (rule.kind) {
    case 'componentPresence':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            id={`${prefix}-component`}
            label="Component"
            value={rule.componentType}
            onChange={(value) => patch({ componentType: value })}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Minimum count <RequiredIndicator />
            </span>
            <input
              type="number"
              min="1"
              step="1"
              value={rule.minCount ?? 1}
              required
              onChange={(event) => patch({ minCount: event.currentTarget.valueAsNumber })}
              className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            />
          </label>
        </div>
      )
    case 'componentProperty': {
      const definitions = componentPropertyDefinitionsFor(parentComponentType)
      const definition = getComponentPropertyDefinition(rule.property ?? '')
      const operators = definition?.operators ?? ['equals', 'notEquals']
      const updateProperty = (property: string): void => {
        const nextDefinition = getComponentPropertyDefinition(property)
        patch({
          property,
          propertyOperator: nextDefinition?.operators[0] ?? 'equals',
          expected: nextDefinition?.options?.[0]
        })
      }
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Property <RequiredIndicator />
            </span>
            <select
              value={rule.property ?? ''}
              required
              onChange={(event) => updateProperty(event.currentTarget.value)}
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
            >
              <option value="">Select a property…</option>
              {definitions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Condition <RequiredIndicator />
            </span>
            <select
              value={rule.propertyOperator ?? 'equals'}
              required
              onChange={(event) =>
                patch({
                  propertyOperator: event.currentTarget
                    .value as AuthoringSemanticRuleDraft['propertyOperator']
                })
              }
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {operator === 'equals'
                    ? 'Equals'
                    : operator === 'notEquals'
                      ? 'Does not equal'
                      : operator === 'atLeast'
                        ? 'At least'
                        : 'At most'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Value <RequiredIndicator />
            </span>
            {definition?.options ? (
              <select
                value={String(rule.expected ?? '')}
                required
                onChange={(event) => {
                  const raw = event.currentTarget.value
                  patch({
                    expected:
                      definition.valueType === 'boolean'
                        ? raw === 'true'
                        : definition.valueType === 'number'
                          ? Number(raw)
                          : raw
                  })
                }}
                className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              >
                <option value="">Select a value…</option>
                {definition.options.map((option) => (
                  <option key={String(option)} value={String(option)}>
                    {String(option)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={definition?.valueType === 'number' ? 'number' : 'text'}
                value={rule.expected === undefined ? '' : String(rule.expected)}
                required
                onChange={(event) =>
                  patch({
                    expected:
                      definition?.valueType === 'number'
                        ? event.currentTarget.value === ''
                          ? undefined
                          : event.currentTarget.valueAsNumber
                        : event.currentTarget.value
                  })
                }
                className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              />
            )}
          </label>
        </div>
      )
    }
    case 'placement':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <ComponentSelect
            id={`${prefix}-component`}
            label="Component"
            value={rule.componentType}
            onChange={(value) => patch({ componentType: value })}
          />
          <ComponentSelect
            id={`${prefix}-between-from`}
            label="Between (from)"
            optional
            value={rule.betweenFrom}
            onChange={(value) => patch({ betweenFrom: value })}
          />
          <ComponentSelect
            id={`${prefix}-between-to`}
            label="Between (to)"
            optional
            value={rule.betweenTo}
            onChange={(value) => patch({ betweenTo: value })}
          />
          <ComponentSelect
            id={`${prefix}-not-before`}
            label="Must not appear before"
            optional
            value={rule.notBefore}
            onChange={(value) => patch({ notBefore: value || undefined })}
          />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Ordered pipeline (component type IDs)
            </span>
            <input
              value={(rule.orderedPipeline ?? []).join(', ')}
              onChange={(event) =>
                patch({
                  orderedPipeline: event.currentTarget.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                })
              }
              placeholder="api-gateway, microservice, relational-db"
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs text-nss-text"
            />
          </label>
        </div>
      )
    case 'guardedPath':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <ComponentSelect
            id={`${prefix}-from`}
            label="Traffic from"
            value={rule.from}
            onChange={(value) => patch({ from: value })}
          />
          <ComponentSelect
            id={`${prefix}-guard`}
            label="Must pass through"
            value={rule.guard}
            onChange={(value) => patch({ guard: value })}
          />
          <ComponentSelect
            id={`${prefix}-to`}
            label="Before reaching"
            optional
            value={rule.to}
            onChange={(value) => patch({ to: value })}
          />
        </div>
      )
    case 'fanout':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            id={`${prefix}-broker`}
            label="Broker"
            value={rule.broker}
            onChange={(value) => patch({ broker: value })}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Minimum consumers
            </span>
            <input
              id={`${prefix}-consumers`}
              aria-label="Minimum consumers"
              type="number"
              min="2"
              step="1"
              value={rule.minConsumers ?? ''}
              onChange={(event) =>
                patch({
                  minConsumers:
                    event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
                })
              }
              className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            />
          </label>
          <ComponentSelect
            id={`${prefix}-forbidden-broker`}
            label="Wrong broker (optional)"
            optional
            value={rule.forbiddenBroker}
            onChange={(value) => patch({ forbiddenBroker: value || undefined })}
          />
        </div>
      )
    case 'storageFit':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Access pattern
            </span>
            <select
              id={`${prefix}-access`}
              aria-label="Access pattern"
              value={rule.accessPattern ?? ''}
              onChange={(event) =>
                patch({
                  accessPattern: (event.currentTarget.value ||
                    undefined) as AuthoringSemanticRuleDraft['accessPattern']
                })
              }
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
            >
              <option value="">Select an access pattern…</option>
              {AUTHORING_STORAGE_FIT_ACCESS_PATTERNS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {ACCESS_PATTERN_LABELS[pattern] ?? pattern}
                </option>
              ))}
            </select>
          </label>
          <ComponentMultiSelect
            label="Accepted stores (full credit)"
            values={rule.accept}
            onChange={(values) => patch({ accept: values })}
          />
          <ComponentMultiSelect
            label="Partial-credit stores"
            values={rule.partial}
            onChange={(values) => patch({ partial: values })}
          />
          <ComponentMultiSelect
            label="Anti-pattern stores"
            values={rule.antiPattern}
            onChange={(values) => patch({ antiPattern: values })}
          />
        </div>
      )
    case 'forbidUnjustified':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <ComponentSelect
            id={`${prefix}-component`}
            label="Component"
            value={rule.componentType}
            onChange={(value) => patch({ componentType: value })}
          />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Justification prompt ID (optional)
            </span>
            <input
              value={rule.justifyId ?? ''}
              onChange={(event) => patch({ justifyId: event.currentTarget.value || undefined })}
              className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-xs text-nss-text"
            />
          </label>
        </div>
      )
    case 'stateTransition':
      return <RuntimeTransitionFields rule={rule} patch={patch} />
    case 'stateSequence':
      return <RuntimeSequenceFields rule={rule} patch={patch} />
    default:
      return <></>
  }
}

export function SemanticGradingEditor({
  rules,
  onAction,
  compact = false
}: SemanticGradingEditorProps): React.JSX.Element {
  return (
    <section
      className={
        compact
          ? 'bg-transparent'
          : 'rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm'
      }
      aria-labelledby="semantic-grading-title"
    >
      {!compact && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-nss-primary">
              Design-meaning obligation
            </p>
            <h3 id="semantic-grading-title" className="mt-1 text-base font-semibold text-nss-text">
              Topology semantics grading
            </h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-nss-muted">
              Grade how components are used, not just whether they exist. Each sentence compiles to
              an engine semantic criterion evaluated against the student topology.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onAction({
                type: 'add',
                rule: createAuthoringSemanticRule(
                  'componentPresence',
                  `semantic-rule-${rules.length + 1}`
                )
              })
            }
            className="flex shrink-0 items-center gap-2 rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white hover:bg-nss-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/60"
          >
            <Plus size={14} aria-hidden="true" />
            Add grading test
          </button>
        </div>
      )}

      {rules.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-nss-borderHigh bg-nss-surface px-5 py-8 text-center">
          <Network size={23} className="mx-auto text-nss-muted" aria-hidden="true" />
          <p className="mt-2 text-xs font-semibold text-nss-text">No semantic tests yet</p>
          <p className="mt-1 text-[11px] leading-5 text-nss-muted">
            Require a component, then optionally score its configuration in nested checks.
          </p>
        </div>
      ) : (
        <ol className={compact ? 'space-y-2' : 'mt-5 space-y-4'}>
          {rules
            .filter((rule) => !rule.parentId)
            .map((rule) => {
              const capability = getAuthoringSemanticRuleCapability(rule.kind)
              const compiled = compileAuthoringSemanticRule(rule)
              const fieldPrefix = `semantic-rule-${rule.id}`
              const childRules = rules.filter((candidate) => candidate.parentId === rule.id)

              return (
                <li
                  key={rule.id}
                  data-semantic-rule-id={rule.id}
                  className={`rounded-lg border border-nss-border bg-nss-surface ${compact ? 'p-3' : 'p-4'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label>
                        <span className="sr-only">Semantic rule kind</span>
                        <select
                          id={`${fieldPrefix}-kind`}
                          aria-label="Semantic rule kind"
                          value={rule.kind}
                          onChange={(event) =>
                            onAction({
                              type: 'update-kind',
                              id: rule.id,
                              kind: event.currentTarget.value as AuthoringSemanticRuleKind
                            })
                          }
                          className="rounded-md border border-nss-primary/25 bg-nss-primary/10 px-2 py-1.5 text-xs font-semibold text-nss-primary outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                        >
                          {AUTHORING_SEMANTIC_RULE_KIND_META.filter(
                            (meta) => meta.kind !== 'componentProperty'
                          ).map((meta) => (
                            <option key={meta.kind} value={meta.kind}>
                              {meta.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {!compact && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                            capability.supportTier === 'first-class'
                              ? 'border-nss-success/25 bg-nss-success/10 text-nss-success'
                              : 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
                          }`}
                        >
                          {capability.supportTier}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onAction({ type: 'remove', id: rule.id })}
                      aria-label="Remove semantic test"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>

                  <div
                    className={`${compact ? 'mt-3 px-1 pb-1' : 'mt-4 rounded-lg border border-nss-borderHigh bg-nss-panel px-4 py-4'}`}
                  >
                    <RuleFields rule={rule} onAction={onAction} />
                    {!compact && (
                      <div className="mt-3 space-y-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                            Learner-facing description (optional)
                          </span>
                          <input
                            aria-label={`Learner-facing description for ${rule.id}`}
                            value={rule.description ?? ''}
                            placeholder="Leave blank to use the generated description"
                            onChange={(event) =>
                              onAction({
                                type: 'update',
                                id: rule.id,
                                changes: { description: event.currentTarget.value }
                              })
                            }
                            className="rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text outline-none placeholder:text-nss-muted/70 focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                          />
                        </label>
                        <div className="flex flex-wrap items-end gap-5">
                          <label className="flex w-28 flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                              Points <RequiredIndicator />
                            </span>
                            <input
                              id={`${fieldPrefix}-points`}
                              aria-label="Points"
                              type="number"
                              min="1"
                              step="1"
                              value={rule.points ?? ''}
                              required
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: rule.id,
                                  changes: {
                                    points:
                                      event.currentTarget.value === ''
                                        ? null
                                        : event.currentTarget.valueAsNumber
                                  }
                                })
                              }
                              className="w-24 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
                            />
                          </label>
                          <label className="flex items-center gap-2 pb-1.5 text-[11px] font-semibold text-nss-text">
                            <input
                              id={`${fieldPrefix}-hardfail`}
                              aria-label="Hard fail"
                              type="checkbox"
                              checked={rule.hardFail ?? false}
                              onChange={(event) =>
                                onAction({
                                  type: 'update',
                                  id: rule.id,
                                  changes: { hardFail: event.currentTarget.checked }
                                })
                              }
                              className="h-3.5 w-3.5 rounded border-nss-border text-nss-danger focus:ring-nss-danger/40"
                            />
                            Hard fail (zeroes the question when violated)
                          </label>
                        </div>
                      </div>
                    )}
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
                        {compiled ? 'Compiled design meaning' : 'Rule incomplete'}
                      </p>
                      <output className="mt-1 block text-xs leading-5 text-nss-text">
                        {compiled
                          ? describeCompiled(compiled)
                          : 'Complete the highlighted fields before this rule can grade a topology.'}
                      </output>
                    </div>
                  )}

                  {rule.kind === 'componentPresence' && !compact && (
                    <div className="mt-4 border-l-2 border-nss-primary/20 pl-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                            Nested configuration scoring
                          </p>
                          <p className="mt-0.5 text-[11px] text-nss-muted">
                            Each requirement earns its own points on this component type.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            let nextIndex = childRules.length + 1
                            while (
                              rules.some(
                                (candidate) => candidate.id === `${rule.id}-property-${nextIndex}`
                              )
                            ) {
                              nextIndex += 1
                            }
                            const child = createAuthoringSemanticRule(
                              'componentProperty',
                              `${rule.id}-property-${nextIndex}`
                            )
                            onAction({
                              type: 'add',
                              rule: { ...child, parentId: rule.id }
                            })
                          }}
                          disabled={!rule.componentType}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-nss-primary/30 bg-nss-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-nss-primary hover:bg-nss-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus size={12} aria-hidden="true" />
                          Add configuration requirement
                        </button>
                      </div>

                      {childRules.length === 0 ? (
                        <div className="rounded-md border border-dashed border-nss-borderHigh px-3 py-4 text-center text-[11px] text-nss-muted">
                          Component presence is scored now. Add a requirement to score a specific
                          configuration too.
                        </div>
                      ) : (
                        <ol className="space-y-3">
                          {childRules.map((child) => {
                            const childCompiled = compileAuthoringSemanticRule(child)
                            return (
                              <li
                                key={child.id}
                                className="rounded-lg border border-nss-borderHigh bg-nss-panel p-3"
                              >
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 text-[11px] font-semibold text-nss-text">
                                    <CornerDownRight
                                      size={13}
                                      className="text-nss-primary"
                                      aria-hidden="true"
                                    />
                                    Configuration requirement
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onAction({ type: 'remove', id: child.id })}
                                    aria-label="Remove configuration requirement"
                                    className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:bg-nss-danger/10 hover:text-nss-danger"
                                  >
                                    <Trash2 size={12} aria-hidden="true" />
                                  </button>
                                </div>
                                <RuleFields
                                  rule={child}
                                  onAction={onAction}
                                  parentComponentType={rule.componentType}
                                />
                                <div className="mt-3 flex items-end justify-between gap-3">
                                  <label className="flex w-24 flex-col gap-1">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                                      Points <RequiredIndicator />
                                    </span>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={child.points ?? ''}
                                      required
                                      onChange={(event) =>
                                        onAction({
                                          type: 'update',
                                          id: child.id,
                                          changes: {
                                            points:
                                              event.currentTarget.value === ''
                                                ? null
                                                : event.currentTarget.valueAsNumber
                                          }
                                        })
                                      }
                                      className="w-20 rounded-md border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs tabular-nums text-nss-text"
                                    />
                                  </label>
                                  <span
                                    className={`text-[10px] ${childCompiled ? 'text-nss-success' : 'text-nss-warning'}`}
                                  >
                                    {childCompiled ? 'Ready to grade' : 'Complete this requirement'}
                                  </span>
                                </div>
                              </li>
                            )
                          })}
                        </ol>
                      )}
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
