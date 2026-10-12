import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  AUTHORING_CACHE_FLUSH_FAULT_TYPE,
  authoringFaultTargetStatus,
  type AuthoringFaultDraft
} from '../../../../engine/analysis/questionAuthoringScenario'
import type { FaultTargetOption } from '@renderer/types/ui'
import { RequiredIndicator } from './RequiredIndicator'
import { AUTHORING_SELECT_CLASS, DraftNumberInput } from './authoringInputs'

const CUSTOM_TARGET = '__custom__'

const MODE_OPTIONS: Array<{ value: string; label: string; help: string }> = [
  {
    value: '',
    label: 'Default - silent dead server',
    help: 'New requests get no answer and time out; requests already inside hang, then fail when it comes back.'
  },
  {
    value: 'reject',
    label: 'Refuses connections',
    help: 'Every request is turned away at once with an error (like a closed port).'
  },
  {
    value: 'blackhole',
    label: 'Silent dead server',
    help: 'New requests get no answer and time out on the caller.'
  },
  {
    value: 'hang',
    label: 'Hangs',
    help: 'Accepts requests until its queue is full, then stops answering; everything waits for the timeout.'
  },
  {
    value: 'degraded',
    label: 'Slows down',
    help: 'Keeps serving, but part of the requests take longer.'
  }
]

interface AuthoringFaultEditorProps {
  fault: AuthoringFaultDraft
  /** Targets from the question's reference (or scaffold) design. */
  targets: readonly FaultTargetOption[]
  /** Which design the target list came from, for the help text. */
  targetSource: string | null
  onChange: (next: AuthoringFaultDraft) => void
  onRemove: () => void
}

export function AuthoringFaultEditor({
  fault,
  targets,
  targetSource,
  onChange,
  onRemove
}: AuthoringFaultEditorProps): React.JSX.Element {
  const status = authoringFaultTargetStatus(fault, targets)
  const [customMode, setCustomMode] = useState(
    targets.length === 0 || (fault.targetId.trim() !== '' && status.kind === 'unknown')
  )
  const isFlush = fault.faultType === AUTHORING_CACHE_FLUSH_FAULT_TYPE
  const components = targets.filter((target) => target.group !== 'location')
  const locations = targets.filter((target) => target.group === 'location')
  const cacheFlushOffered = isFlush || status.kind === 'cache' || status.kind === 'unknown'
  const modeHelp = MODE_OPTIONS.find((option) => option.value === fault.mode)?.help
  const set = (changes: Partial<AuthoringFaultDraft>) => onChange({ ...fault, ...changes })
  const recovers = fault.duration === 'fixed'
  const showPolicies = !isFlush && fault.mode !== '' && fault.mode !== 'degraded'

  return (
    <div
      className="space-y-3 rounded-md border border-nss-border bg-nss-surface p-3"
      data-fault-id={fault.id}
    >
      <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_auto]">
        <div className="text-[11px] font-semibold text-nss-text">
          <label htmlFor={`fault-${fault.id}-target`}>
            What fails <RequiredIndicator />
          </label>
          {targets.length > 0 && (
            <select
              id={`fault-${fault.id}-target`}
              aria-label="Fault target"
              value={customMode ? CUSTOM_TARGET : fault.targetId}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === CUSTOM_TARGET) {
                  setCustomMode(true)
                  return
                }
                setCustomMode(false)
                const picked = targets.find((target) => target.id === value)
                set({
                  targetId: value,
                  // A cache flush only makes sense on a cache.
                  ...(isFlush && picked && !picked.isCache ? { faultType: 'crash' } : {})
                })
              }}
              className={AUTHORING_SELECT_CLASS}
            >
              <option value="">Choose a target</option>
              {components.length > 0 && (
                <optgroup label="Components">
                  {components.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {locations.length > 0 && (
                <optgroup label="Fault domains (fails every component inside)">
                  {locations.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={CUSTOM_TARGET}>Another id (only in learner designs)...</option>
            </select>
          )}
          {(customMode || targets.length === 0) && (
            <input
              id={targets.length === 0 ? `fault-${fault.id}-target` : undefined}
              aria-label="Fault target id"
              type="text"
              value={fault.targetId}
              placeholder="api-1"
              onChange={(event) => set({ targetId: event.currentTarget.value })}
              className="mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 font-mono text-xs font-normal text-nss-text outline-none focus:border-nss-primary"
            />
          )}
          <span className="mt-1 block text-[10px] font-normal leading-4 text-nss-muted">
            {targets.length === 0
              ? 'Add a reference or scaffold design to pick from its components and zones. Until then, type the id learner designs will use.'
              : customMode
                ? 'Free text: use this only for an id that exists in learner designs but not in the reference design.'
                : `From the ${targetSource ?? 'reference'} design.`}
          </span>
          {status.warning && (
            <span
              role="status"
              className="mt-1 block rounded border border-nss-warning/30 bg-nss-warning/10 px-2 py-1 text-[10px] font-normal leading-4 text-nss-warning"
            >
              {status.warning}
            </span>
          )}
        </div>

        <label className="text-[11px] font-semibold text-nss-text">
          Fault <RequiredIndicator />
          <select
            aria-label="Fault type"
            value={isFlush ? AUTHORING_CACHE_FLUSH_FAULT_TYPE : 'failure'}
            onChange={(event) =>
              set(
                event.currentTarget.value === AUTHORING_CACHE_FLUSH_FAULT_TYPE
                  ? { faultType: AUTHORING_CACHE_FLUSH_FAULT_TYPE, mode: '' }
                  : {
                      faultType:
                        fault.faultType === AUTHORING_CACHE_FLUSH_FAULT_TYPE
                          ? 'crash'
                          : fault.faultType
                    }
              )
            }
            className={AUTHORING_SELECT_CLASS}
          >
            <option value="failure">The component fails</option>
            {cacheFlushOffered && (
              <option value={AUTHORING_CACHE_FLUSH_FAULT_TYPE}>The cache is emptied (flush)</option>
            )}
          </select>
          <span className="mt-1 block text-[10px] font-normal leading-4 text-nss-muted">
            {isFlush
              ? 'The cache keeps serving but loses its contents, so requests miss and go to the origin.'
              : status.kind === 'location'
                ? 'Every component inside this domain fails together.'
                : 'Cache flush is offered for cache components (CDN, in-memory cache, reverse proxy).'}
          </span>
        </label>

        <button
          type="button"
          aria-label="Remove fault"
          onClick={onRemove}
          className="mt-5 flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:border-nss-danger/40 hover:text-nss-danger"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <DraftNumberInput
          label="Starts at"
          required
          suffix="sec"
          value={fault.atSeconds}
          onChange={(value) => set({ atSeconds: value })}
        />
        {isFlush ? (
          <DraftNumberInput
            label="Misses for (declared-rate caches)"
            suffix="sec"
            min={0.001}
            value={fault.durationSeconds}
            onChange={(value) =>
              set({ durationSeconds: value, duration: value === null ? 'permanent' : 'fixed' })
            }
            placeholder="engine default"
          />
        ) : (
          <>
            <label className="text-[11px] font-semibold text-nss-text">
              Recovery <RequiredIndicator />
              <select
                aria-label="Fault recovery"
                value={fault.duration}
                onChange={(event) =>
                  set({ duration: event.currentTarget.value as AuthoringFaultDraft['duration'] })
                }
                className={AUTHORING_SELECT_CLASS}
              >
                <option value="fixed">Recovers after a while</option>
                <option value="permanent">Never recovers</option>
                {fault.duration === 'until' && (
                  <option value="until">Until a condition (not modelled - never recovers)</option>
                )}
              </select>
            </label>
            {recovers ? (
              <DraftNumberInput
                label="Down for"
                required
                suffix="sec"
                min={0.001}
                value={fault.durationSeconds}
                onChange={(value) => set({ durationSeconds: value })}
              />
            ) : (
              <p className="self-end pb-2 text-[10px] leading-4 text-nss-muted">
                Stays down until the end of the run.
              </p>
            )}
          </>
        )}
      </div>

      {!isFlush && (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-[11px] font-semibold text-nss-text md:col-span-1">
            How it fails
            <select
              aria-label="Failure mode"
              value={fault.mode}
              onChange={(event) => set({ mode: event.currentTarget.value })}
              className={AUTHORING_SELECT_CLASS}
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {!MODE_OPTIONS.some((option) => option.value === fault.mode) && (
                <option value={fault.mode}>{fault.mode} (not a known mode)</option>
              )}
            </select>
            {modeHelp && (
              <span className="mt-1 block text-[10px] font-normal leading-4 text-nss-muted">
                {modeHelp}
              </span>
            )}
          </label>
          {showPolicies && (
            <label className="text-[11px] font-semibold text-nss-text">
              Requests already inside
              <select
                aria-label="In-flight requests"
                value={fault.inFlightPolicy === 'hang' ? 'hang' : ''}
                onChange={(event) =>
                  set({
                    inFlightPolicy:
                      (event.currentTarget.value as AuthoringFaultDraft['inFlightPolicy']) ||
                      undefined
                  })
                }
                className={AUTHORING_SELECT_CLASS}
              >
                <option value="">Fail at once (connection reset)</option>
                <option value="hang">Wait until their timeout</option>
              </select>
            </label>
          )}
          {showPolicies && fault.inFlightPolicy === 'hang' && recovers && (
            <label className="text-[11px] font-semibold text-nss-text">
              When it comes back, the waiting requests
              <select
                aria-label="Recovery policy"
                value={fault.recoveryPolicy === 'resume' ? 'resume' : ''}
                onChange={(event) =>
                  set({
                    recoveryPolicy:
                      (event.currentTarget.value as AuthoringFaultDraft['recoveryPolicy']) ||
                      undefined
                  })
                }
                className={AUTHORING_SELECT_CLASS}
              >
                <option value="">Fail (a restart loses them)</option>
                <option value="resume">Carry on and finish</option>
              </select>
            </label>
          )}
          {fault.mode === 'degraded' && (
            <>
              <DraftNumberInput
                label="Share of requests slowed"
                required
                suffix="%"
                max={100}
                value={fault.degradedPercent}
                onChange={(value) => set({ degradedPercent: value })}
              />
              <DraftNumberInput
                label="Slowed requests take"
                required
                suffix="x longer"
                value={fault.degradedMultiplier}
                onChange={(value) => set({ degradedMultiplier: value })}
              />
            </>
          )}
        </div>
      )}

      {fault.timing !== 'deterministic' && (
        <p className="text-[10px] leading-4 text-nss-warning">
          This fault was saved with {fault.timing} timing. The engine schedules every fault at its
          start time, so it runs as a fixed-time fault.
        </p>
      )}

      <details className="rounded border border-nss-border bg-nss-panel p-2">
        <summary className="cursor-pointer text-[10px] font-semibold text-nss-text">
          Custom fault parameters ({fault.extraParams.length})
        </summary>
        <div className="mt-2 space-y-2">
          {fault.extraParams.map((param) => {
            const setParam = (changes: Partial<typeof param>) =>
              set({
                extraParams: fault.extraParams.map((entry) =>
                  entry.id === param.id ? { ...entry, ...changes } : entry
                )
              })
            return (
              <div key={param.id} className="grid gap-2 sm:grid-cols-[1fr_0.7fr_1.5fr_auto]">
                <input
                  aria-label="Fault parameter name"
                  value={param.key}
                  placeholder="probability"
                  onChange={(event) => setParam({ key: event.currentTarget.value })}
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                />
                <select
                  aria-label={`${param.key || 'Fault parameter'} type`}
                  value={param.valueType}
                  onChange={(event) =>
                    setParam({
                      valueType: event.currentTarget.value as typeof param.valueType
                    })
                  }
                  className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                >
                  <option value="string">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="json">Structured</option>
                </select>
                {param.valueType === 'boolean' ? (
                  <select
                    aria-label={`${param.key || 'Fault parameter'} value`}
                    value={param.value}
                    onChange={(event) => setParam({ value: event.currentTarget.value })}
                    className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-[11px]"
                  >
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <input
                    aria-label={`${param.key || 'Fault parameter'} value`}
                    value={param.value}
                    onChange={(event) => setParam({ value: event.currentTarget.value })}
                    className="rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 font-mono text-[11px]"
                  />
                )}
                <button
                  type="button"
                  aria-label={`Remove fault parameter ${param.key}`}
                  onClick={() =>
                    set({
                      extraParams: fault.extraParams.filter((entry) => entry.id !== param.id)
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded border border-nss-border text-nss-muted hover:text-nss-danger"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() =>
              set({
                extraParams: [
                  ...fault.extraParams,
                  {
                    id: `param-${fault.extraParams.length + 1}`,
                    key: '',
                    valueType: 'string',
                    value: ''
                  }
                ]
              })
            }
            className="flex items-center gap-1 rounded border border-nss-border px-2 py-1 text-[10px] font-semibold"
          >
            <Plus size={11} /> Add parameter
          </button>
        </div>
      </details>
    </div>
  )
}
