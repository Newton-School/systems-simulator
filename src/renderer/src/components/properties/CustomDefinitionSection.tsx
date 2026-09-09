import { Plus, Trash2 } from 'lucide-react'
import type {
  CustomDependencyIntent,
  CustomNodeDefinition
} from '../../../../engine/catalog/customDefinitions'
import {
  DEPENDENCY_ACTIONS,
  DEPENDENCY_CONDITIONS,
  DEPENDENCY_TARGET_ROLES,
  RUNTIME_TEMPLATES
} from '../../../../engine/catalog/customDefinitions'

export function CustomDefinitionSection({
  definition,
  onChange
}: {
  definition: CustomNodeDefinition
  onChange: (definition: CustomNodeDefinition) => void
}): React.JSX.Element {
  const template = RUNTIME_TEMPLATES[definition.runtimeTemplate]
  const updateOperation = (
    index: number,
    patch: Partial<CustomNodeDefinition['operations'][number]>
  ) => {
    onChange({
      ...definition,
      operations: definition.operations.map((operation, current) =>
        current === index ? { ...operation, ...patch } : operation
      )
    })
  }
  const updateDependency = (
    operationIndex: number,
    dependencyIndex: number,
    patch: Partial<CustomDependencyIntent>
  ) => {
    const operation = definition.operations[operationIndex]
    if (!operation) return
    updateOperation(operationIndex, {
      dependencies: operation.dependencies.map((dependency, current) =>
        current === dependencyIndex ? { ...dependency, ...patch } : dependency
      )
    })
  }

  return (
    <section className="mb-5 rounded-md border border-nss-border bg-nss-surface/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-nss-text">
            {definition.kind === 'service' ? 'Service contract' : 'Custom node contract'}
          </h3>
          <p className="mt-0.5 text-[10px] leading-snug text-nss-muted">
            Runtime: {template.label}. Operations and dependencies below are documentation for the
            HLD contract — they do not change the simulation. Runtime behavior is tuned in the
            Resources, Processing, and other sections below.
          </p>
        </div>
        <span className="shrink-0 rounded border border-nss-border px-1.5 py-0.5 text-[10px] text-nss-muted">
          {definition.kind === 'service' ? 'Service' : 'Custom'}
        </span>
      </div>
      <label className="mb-3 block text-[11px] text-nss-muted">
        Description
        <textarea
          value={definition.description ?? ''}
          onChange={(event) => onChange({ ...definition, description: event.target.value })}
          rows={2}
          className="mt-1 w-full resize-y rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
        />
      </label>
      <div className="space-y-2">
        {definition.operations.map((operation, index) => (
          <div key={index} className="rounded border border-nss-border bg-nss-panel p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                Operation {index + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove operation ${operation.id}`}
                onClick={() =>
                  onChange({
                    ...definition,
                    operations: definition.operations.filter((_, current) => current !== index)
                  })
                }
                disabled={definition.operations.length === 1}
                className="text-nss-muted hover:text-nss-danger disabled:opacity-30"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-nss-muted">
                Request name
                <input
                  value={operation.requestType}
                  onChange={(event) => updateOperation(index, { requestType: event.target.value })}
                  placeholder="e.g. resolve-short-url"
                  className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                />
              </label>
              <label className="text-[10px] text-nss-muted">
                Response name
                <input
                  value={operation.responseType}
                  onChange={(event) => updateOperation(index, { responseType: event.target.value })}
                  placeholder="e.g. redirect"
                  className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                />
              </label>
            </div>
            <div className="mt-2 border-t border-nss-border pt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Dependencies
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateOperation(index, {
                      dependencies: [
                        ...operation.dependencies,
                        {
                          target: 'Dependency',
                          targetRole: 'service',
                          action: 'invoke',
                          callMode: 'sync',
                          required: true,
                          condition: 'always'
                        }
                      ]
                    })
                  }
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-nss-primary hover:text-nss-text"
                >
                  <Plus size={11} /> Add
                </button>
              </div>
              <div className="space-y-1.5">
                {operation.dependencies.map((dependency, dependencyIndex) => (
                  <div
                    key={dependencyIndex}
                    className="rounded border border-nss-border bg-nss-surface/40 p-1.5"
                  >
                    <div className="flex gap-1">
                      <input
                        aria-label={`Dependency target for ${operation.id}`}
                        value={dependency.target}
                        onChange={(event) =>
                          updateDependency(index, dependencyIndex, { target: event.target.value })
                        }
                        placeholder="Target node"
                        className="min-w-0 flex-1 rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-[10px] text-nss-text"
                      />
                      <button
                        type="button"
                        aria-label={`Remove dependency ${dependency.target}`}
                        onClick={() =>
                          updateOperation(index, {
                            dependencies: operation.dependencies.filter(
                              (_, current) => current !== dependencyIndex
                            )
                          })
                        }
                        className="px-1 text-nss-muted hover:text-nss-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <select
                        aria-label={`Dependency role for ${operation.id}`}
                        value={dependency.targetRole ?? 'service'}
                        onChange={(event) =>
                          updateDependency(index, dependencyIndex, {
                            targetRole: event.target.value as CustomDependencyIntent['targetRole']
                          })
                        }
                        className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                      >
                        {DEPENDENCY_TARGET_ROLES.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Dependency action for ${operation.id}`}
                        value={dependency.action}
                        onChange={(event) =>
                          updateDependency(index, dependencyIndex, {
                            action: event.target.value as CustomDependencyIntent['action']
                          })
                        }
                        className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                      >
                        {DEPENDENCY_ACTIONS.map((action) => (
                          <option key={action.id} value={action.id}>
                            {action.label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Dependency call mode for ${operation.id}`}
                        value={dependency.callMode ?? 'sync'}
                        onChange={(event) =>
                          updateDependency(index, dependencyIndex, {
                            callMode: event.target.value as CustomDependencyIntent['callMode']
                          })
                        }
                        className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                      >
                        <option value="sync">Sync</option>
                        <option value="async">Async</option>
                      </select>
                      <select
                        aria-label={`Dependency condition for ${operation.id}`}
                        value={dependency.condition ?? 'always'}
                        onChange={(event) =>
                          updateDependency(index, dependencyIndex, {
                            condition: event.target.value as CustomDependencyIntent['condition']
                          })
                        }
                        className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                      >
                        {DEPENDENCY_CONDITIONS.map((condition) => (
                          <option key={condition.id} value={condition.id}>
                            {condition.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...definition,
            operations: [
              ...definition.operations,
              {
                id: 'new-operation',
                requestType: 'request',
                responseType: 'response',
                dependencies: []
              }
            ]
          })
        }
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-nss-primary hover:text-nss-text"
      >
        <Plus size={13} /> Add operation
      </button>
    </section>
  )
}
