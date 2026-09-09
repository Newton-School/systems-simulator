import { useEffect, useMemo, useState } from 'react'
import type { Node } from 'reactflow'
import { Box, Check, CopyPlus, ListChecks, Plus, Save, Server, Trash2, X } from 'lucide-react'
import {
  applyDefinitionTraits,
  createDefaultTraits,
  defaultCustomNodeOperations,
  defaultServiceOperations,
  DEPENDENCY_ACTIONS,
  DEPENDENCY_CONDITIONS,
  DEPENDENCY_TARGET_ROLES,
  RUNTIME_TEMPLATES,
  isCustomNodeDefinition,
  templateForDefinition,
  type CapabilityId,
  type ContractField,
  type CustomDefinitionKind,
  type CustomDependencyIntent,
  type CustomNodeClass,
  type CustomNodeDefinition,
  type CustomOperationDefinition,
  type CustomTraitSelection,
  type DependencyTargetRole,
  type RuntimeTemplateId,
  type TraitPackId
} from '../../../../engine/catalog/customDefinitions'
import { instantiateTemplate } from '../../../../engine/catalog/paletteTemplates'
import type { CanvasNodeDataV2 } from '../../../../engine/catalog/nodeSpecTypes'
import { getId } from '../canvas/utils/canvasUtils'
import useStore from '../../store/useStore'

export type DefinitionBuilderMode = 'service' | 'custom-node' | 'my-service'

const SAVED_SERVICES_KEY = 'nss-saved-service-definitions-v1'

const SERVICE_RUNTIME_IDS = Object.values(RUNTIME_TEMPLATES)
  .filter((template) => template.allowedDefinitionKinds.includes('service'))
  .map((template) => template.id)

const CUSTOM_RUNTIME_IDS = Object.values(RUNTIME_TEMPLATES)
  .filter((template) => template.allowedDefinitionKinds.includes('custom-node'))
  .map((template) => template.id)

const NODE_CLASS_OPTIONS: Array<{ id: CustomNodeClass; label: string }> = [
  ...new Map(
    CUSTOM_RUNTIME_IDS.map((id) => RUNTIME_TEMPLATES[id].nodeClass).map((nodeClass) => [
      nodeClass,
      {
        id: nodeClass,
        label: nodeClass.replace(
          /(^|-)([a-z])/g,
          (_, prefix, char: string) => `${prefix ? ' ' : ''}${char.toUpperCase()}`
        )
      }
    ])
  ).values()
]

const FIELD_TYPE_OPTIONS: ContractField['type'][] = [
  'string',
  'number',
  'boolean',
  'object',
  'array'
]

const TRAIT_LABELS: Record<TraitPackId, string> = {
  capacity: 'Capacity',
  'workload-profile': 'Workload profile',
  'serverless-lifecycle': 'Serverless lifecycle',
  'retry-timeout': 'Retry and timeout',
  'rate-limiting': 'Rate limiting',
  'external-dependency': 'External dependency'
}

const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  'accept-requests': 'Accept requests',
  'process-requests': 'Process requests',
  'route-requests': 'Route requests',
  'read-data': 'Read data',
  'write-data': 'Write data',
  'cache-data': 'Cache data',
  'enqueue-messages': 'Enqueue messages',
  'publish-events': 'Publish events',
  'subscribe-events': 'Subscribe events',
  'invoke-external-api': 'Invoke external API',
  'rate-limit': 'Rate limit',
  authenticate: 'Authenticate',
  observe: 'Observe',
  coordinate: 'Coordinate'
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function readSavedServices(): CustomNodeDefinition[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_SERVICES_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (definition): definition is CustomNodeDefinition =>
        isCustomNodeDefinition(definition) && definition.kind === 'service'
    )
  } catch {
    return []
  }
}

function writeSavedServices(definitions: CustomNodeDefinition[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SAVED_SERVICES_KEY, JSON.stringify(definitions))
}

function createNodeFromDefinition(
  definition: CustomNodeDefinition,
  nodeCount: number,
  forkDefinition = true
): Node {
  const template = templateForDefinition(definition)
  const data = instantiateTemplate(template.paletteTemplateId)
  const name =
    definition.name?.trim() || (definition.kind === 'service' ? 'New Service' : 'Custom Node')

  data.label = name
  data.subLabel =
    definition.kind === 'service'
      ? `${template.label} service`
      : `${definition.nodeClass ?? template.nodeClass} custom node`
  data.customDefinition = forkDefinition ? structuredClone(definition) : definition
  data.customDefinition.name = name
  applyDefinitionTraits(data, data.customDefinition)

  return {
    id: getId(),
    type: data.rendererType,
    position: { x: 280 + (nodeCount % 4) * 44, y: 180 + (nodeCount % 5) * 36 },
    data,
    selected: true
  }
}

function makeDependency(): CustomDependencyIntent {
  return {
    target: 'Dependency',
    targetRole: 'service',
    action: 'invoke',
    required: true,
    callMode: 'sync',
    condition: 'always'
  }
}

function makeField(): ContractField {
  return { name: 'field', type: 'string', required: true }
}

function updateTraitValue(
  traits: CustomTraitSelection[],
  traitId: TraitPackId,
  key: string,
  value: unknown
): CustomTraitSelection[] {
  return traits.map((trait) =>
    trait.traitId === traitId
      ? { ...trait, values: { ...(trait.values ?? {}), [key]: value } }
      : trait
  )
}

function toggleTrait(traits: CustomTraitSelection[], traitId: TraitPackId): CustomTraitSelection[] {
  return traits.map((trait) =>
    trait.traitId === traitId ? { ...trait, enabled: !trait.enabled } : trait
  )
}

function hydrateTraits(runtimeTemplate: RuntimeTemplateId, existing?: CustomTraitSelection[]) {
  const existingById = new Map((existing ?? []).map((trait) => [trait.traitId, trait]))
  return createDefaultTraits(runtimeTemplate).map(
    (trait) => existingById.get(trait.traitId) ?? trait
  )
}

function BuilderPill({
  children,
  tone
}: {
  children: string
  tone: 'info' | 'contract' | 'runtime'
}) {
  const color =
    tone === 'runtime'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : tone === 'contract'
        ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-200'
        : 'border-nss-border bg-nss-surface text-nss-muted'

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      {children}
    </span>
  )
}

function FieldList({
  title,
  fields,
  onChange
}: {
  title: string
  fields: ContractField[]
  onChange: (fields: ContractField[]) => void
}) {
  return (
    <div className="rounded-md border border-nss-border bg-nss-panel p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-nss-muted">
          {title}
        </span>
        <button
          type="button"
          onClick={() => onChange([...fields, makeField()])}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-nss-primary hover:text-nss-text"
        >
          <Plus size={11} /> Field
        </button>
      </div>
      <div className="space-y-1.5">
        {fields.map((field, index) => (
          <div key={index} className="grid grid-cols-[1fr_82px_24px] gap-1">
            <input
              value={field.name}
              onChange={(event) =>
                onChange(
                  fields.map((candidate, current) =>
                    current === index ? { ...candidate, name: event.target.value } : candidate
                  )
                )
              }
              aria-label={`${title} field name`}
              className="min-w-0 rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-[10px] text-nss-text"
            />
            <select
              value={field.type}
              onChange={(event) =>
                onChange(
                  fields.map((candidate, current) =>
                    current === index
                      ? { ...candidate, type: event.target.value as ContractField['type'] }
                      : candidate
                  )
                )
              }
              aria-label={`${title} field type`}
              className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
            >
              {FIELD_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove ${field.name}`}
              onClick={() => onChange(fields.filter((_, current) => current !== index))}
              className="flex items-center justify-center rounded text-nss-muted hover:text-nss-danger"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MyServicesModal({
  savedServices,
  canvasServices,
  onUse,
  onDelete,
  onClose
}: {
  savedServices: CustomNodeDefinition[]
  canvasServices: CustomNodeDefinition[]
  onUse: (definition: CustomNodeDefinition) => void
  onDelete: (index: number) => void
  onClose: () => void
}) {
  const services = savedServices.length > 0 ? savedServices : canvasServices
  const usingCanvasServices = savedServices.length === 0 && canvasServices.length > 0

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="My Services"
        className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-lg border border-nss-border bg-nss-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-nss-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-nss-text">My Services</h2>
            <p className="mt-1 text-xs text-nss-muted">
              Reuse service definitions saved from the builder.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close My Services"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-nss-muted hover:bg-nss-surface hover:text-nss-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {services.length === 0 ? (
            <div className="rounded-md border border-dashed border-nss-border p-8 text-center">
              <Server size={24} className="mx-auto mb-3 text-nss-muted" />
              <p className="text-sm font-semibold text-nss-text">No saved services yet</p>
              <p className="mt-1 text-xs text-nss-muted">
                Create a service from the Service tile and keep Save to My Services enabled.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((definition, index) => {
                const template = templateForDefinition(definition)
                return (
                  <article
                    key={index}
                    className="rounded-md border border-nss-border bg-nss-surface p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-nss-text">
                          {definition.name ?? 'Saved Service'}
                        </h3>
                        <p className="mt-1 text-[11px] text-nss-muted">{template.label}</p>
                      </div>
                      <BuilderPill tone="contract">service</BuilderPill>
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-nss-muted">
                      {definition.description || 'No description added.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {definition.operations.slice(0, 3).map((operation) => (
                        <span
                          key={operation.id}
                          className="rounded border border-nss-border px-1.5 py-0.5 text-[10px] text-nss-muted"
                        >
                          {operation.requestType}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      {!usingCanvasServices ? (
                        <button
                          type="button"
                          onClick={() => onDelete(index)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-nss-muted hover:text-nss-danger"
                        >
                          <Trash2 size={12} /> Delete
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onUse(definition)}
                        className="inline-flex items-center gap-1 rounded bg-nss-primary px-3 py-1.5 text-[11px] font-semibold text-white"
                      >
                        <CopyPlus size={13} /> Place
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DefinitionBuilderModal({
  mode,
  savedServices,
  onSaveService,
  onCreate,
  onClose
}: {
  mode: Exclude<DefinitionBuilderMode, 'my-service'>
  savedServices: CustomNodeDefinition[]
  onSaveService: (definition: CustomNodeDefinition) => void
  onCreate: (definition: CustomNodeDefinition) => void
  onClose: () => void
}) {
  const kind: CustomDefinitionKind = mode === 'service' ? 'service' : 'custom-node'
  const runtimeIds = mode === 'service' ? SERVICE_RUNTIME_IDS : CUSTOM_RUNTIME_IDS
  const initialRuntimeTemplate: RuntimeTemplateId =
    mode === 'service' ? 'long-running-service' : 'serverless-function'
  const [name, setName] = useState(mode === 'service' ? 'New Service' : 'Custom Node')
  const [description, setDescription] = useState('')
  const [runtimeTemplate, setRuntimeTemplate] = useState<RuntimeTemplateId>(initialRuntimeTemplate)
  const [nodeClass, setNodeClass] = useState<CustomNodeClass>(
    RUNTIME_TEMPLATES[initialRuntimeTemplate].nodeClass
  )
  const [capabilities, setCapabilities] = useState<CapabilityId[]>([
    ...RUNTIME_TEMPLATES[initialRuntimeTemplate].capabilities
  ])
  const [operations, setOperations] = useState<CustomOperationDefinition[]>(
    mode === 'service' ? defaultServiceOperations() : defaultCustomNodeOperations()
  )
  const [traits, setTraits] = useState<CustomTraitSelection[]>(
    createDefaultTraits(initialRuntimeTemplate)
  )
  const [saveToLibrary, setSaveToLibrary] = useState(mode === 'service')

  const template = RUNTIME_TEMPLATES[runtimeTemplate]
  const validationMessages = useMemo(() => {
    const messages: string[] = []
    if (!name.trim()) messages.push('Name is required.')
    if (operations.length === 0) messages.push('At least one operation is required.')
    for (const operation of operations) {
      if (!operation.requestType.trim()) messages.push('Every operation needs a request type.')
      if (!operation.responseType.trim()) messages.push('Every operation needs a response type.')
    }
    return [...new Set(messages)]
  }, [name, operations])

  const setRuntime = (next: RuntimeTemplateId) => {
    const nextTemplate = RUNTIME_TEMPLATES[next]
    setRuntimeTemplate(next)
    setNodeClass(nextTemplate.nodeClass)
    // Preserve the user's capability choices that the new template still supports,
    // and add any capabilities the new template offers by default. Avoids silently
    // discarding edits on a runtime switch (review issue C2).
    setCapabilities((current) => {
      const allowed = new Set(nextTemplate.capabilities)
      const kept = current.filter((capability) => allowed.has(capability))
      const added = nextTemplate.capabilities.filter((capability) => !kept.includes(capability))
      return [...kept, ...added]
    })
    setTraits(hydrateTraits(next, traits))
  }

  const setCustomNodeClass = (next: CustomNodeClass): void => {
    setNodeClass(next)
    const firstRuntimeForClass = CUSTOM_RUNTIME_IDS.find(
      (id) => RUNTIME_TEMPLATES[id].nodeClass === next
    )
    if (firstRuntimeForClass && RUNTIME_TEMPLATES[runtimeTemplate].nodeClass !== next) {
      setRuntime(firstRuntimeForClass)
    }
  }

  const updateOperation = (index: number, patch: Partial<CustomOperationDefinition>): void => {
    setOperations((current) =>
      current.map((operation, candidate) =>
        candidate === index ? { ...operation, ...patch } : operation
      )
    )
  }

  const updateDependency = (
    operationIndex: number,
    dependencyIndex: number,
    patch: Partial<CustomDependencyIntent>
  ): void => {
    const operation = operations[operationIndex]
    if (!operation) return
    updateOperation(operationIndex, {
      dependencies: operation.dependencies.map((dependency, candidate) =>
        candidate === dependencyIndex ? { ...dependency, ...patch } : dependency
      )
    })
  }

  const toggleCapability = (capability: CapabilityId): void => {
    setCapabilities((current) =>
      current.includes(capability)
        ? current.filter((candidate) => candidate !== capability)
        : [...current, capability]
    )
  }

  const definition = (): CustomNodeDefinition => ({
    kind,
    name: name.trim(),
    runtimeTemplate,
    description: description.trim() || undefined,
    nodeClass: kind === 'custom-node' ? nodeClass : undefined,
    capabilities,
    traits: traits.map((trait) => ({
      ...trait,
      values: trait.enabled ? (trait.values ?? {}) : {}
    })),
    operations: operations.map((operation) => ({
      ...operation,
      id: slugify(operation.id || operation.requestType, 'operation'),
      requestType: operation.requestType.trim(),
      responseType: operation.responseType.trim(),
      label: operation.label?.trim() || operation.requestType.trim() || 'Operation'
    }))
  })

  const create = (): void => {
    if (validationMessages.length > 0) return
    const nextDefinition = definition()
    if (saveToLibrary && nextDefinition.kind === 'service') {
      onSaveService(nextDefinition)
    }
    onCreate(nextDefinition)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'service' ? 'Service Builder' : 'Custom Node Builder'}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-nss-border bg-nss-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-nss-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              {mode === 'service' ? (
                <Server size={18} className="text-nss-primary" />
              ) : (
                <Box size={18} className="text-nss-primary" />
              )}
              <h2 className="text-sm font-semibold text-nss-text">
                {mode === 'service' ? 'Service Builder' : 'Custom Node Builder'}
              </h2>
            </div>
            <p className="mt-1 text-xs text-nss-muted">
              Compose a definition from reusable contract and runtime blocks.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close builder"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-nss-muted hover:bg-nss-surface hover:text-nss-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr_240px] overflow-hidden">
          <aside className="border-r border-nss-border bg-nss-surface/40 p-4">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-nss-muted">
              Sections
            </p>
            <nav className="space-y-2 text-xs">
              {(
                [
                  ['basics', 'Basics', 'info'],
                  ['runtime', 'Runtime', 'runtime'],
                  ...(mode === 'custom-node'
                    ? [['capabilities', 'Capabilities', 'contract'] as const]
                    : []),
                  ['interface', 'Interface & operations', 'contract'],
                  ['traits', 'Traits', 'runtime']
                ] as ReadonlyArray<readonly [string, string, 'info' | 'contract' | 'runtime']>
              ).map(([anchor, label, tone]) => (
                <button
                  key={anchor}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(`builder-section-${anchor}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className="flex w-full items-center justify-between rounded-md border border-nss-border bg-nss-panel px-2 py-2 text-left hover:border-nss-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nss-primary/50"
                >
                  <span className="font-semibold text-nss-text">{label}</span>
                  <BuilderPill tone={tone}>{tone}</BuilderPill>
                </button>
              ))}
            </nav>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-5">
              <section
                id="builder-section-basics"
                className="scroll-mt-4 rounded-md border border-nss-border bg-nss-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                    Basics
                  </h3>
                  <BuilderPill tone="info">info</BuilderPill>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-[11px] font-semibold text-nss-muted">
                    Name
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoFocus
                      className="mt-1 w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-sm text-nss-text outline-none focus:border-nss-primary"
                    />
                  </label>
                  {mode === 'custom-node' ? (
                    <label className="text-[11px] font-semibold text-nss-muted">
                      Node class
                      <select
                        value={nodeClass}
                        onChange={(event) =>
                          setCustomNodeClass(event.target.value as CustomNodeClass)
                        }
                        className="mt-1 w-full rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-sm text-nss-text"
                      >
                        {NODE_CLASS_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="sm:col-span-2 text-[11px] font-semibold text-nss-muted">
                    Description
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-y rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-sm text-nss-text outline-none focus:border-nss-primary"
                    />
                  </label>
                </div>
              </section>

              <section
                id="builder-section-runtime"
                className="scroll-mt-4 rounded-md border border-nss-border bg-nss-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                    Runtime
                  </h3>
                  <BuilderPill tone="runtime">runtime</BuilderPill>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {runtimeIds
                    .filter(
                      (id) => mode === 'service' || RUNTIME_TEMPLATES[id].nodeClass === nodeClass
                    )
                    .map((id) => {
                      const candidate = RUNTIME_TEMPLATES[id]
                      const selected = id === runtimeTemplate
                      return (
                        <button
                          type="button"
                          key={id}
                          onClick={() => setRuntime(id)}
                          className={`rounded-md border p-3 text-left transition-colors ${
                            selected
                              ? 'border-nss-primary bg-nss-primary/10'
                              : 'border-nss-border bg-nss-panel hover:border-nss-primary/60'
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-nss-text">
                              {candidate.label}
                            </span>
                            {selected ? <Check size={14} className="text-nss-primary" /> : null}
                          </div>
                          <p className="text-[10px] leading-relaxed text-nss-muted">
                            Executes as {candidate.componentType}.
                          </p>
                        </button>
                      )
                    })}
                </div>
              </section>

              {mode === 'custom-node' ? (
                <section
                  id="builder-section-capabilities"
                  className="scroll-mt-4 rounded-md border border-nss-border bg-nss-surface p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                      Capabilities
                    </h3>
                    <BuilderPill tone="contract">contract</BuilderPill>
                  </div>
                  <p className="mb-3 text-[10px] leading-relaxed text-nss-muted">
                    Documentation and validation only — capabilities describe intent for grading and
                    edge checks. They do not change the simulation. Runtime behavior comes from the
                    Traits below.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {template.capabilities.map((capability) => {
                      const selected = capabilities.includes(capability)
                      return (
                        <button
                          key={capability}
                          type="button"
                          onClick={() => toggleCapability(capability)}
                          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                            selected
                              ? 'border-nss-primary bg-nss-primary/10 text-nss-text'
                              : 'border-nss-border text-nss-muted hover:text-nss-text'
                          }`}
                        >
                          {CAPABILITY_LABELS[capability]}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              <section
                id="builder-section-interface"
                className="scroll-mt-4 rounded-md border border-nss-border bg-nss-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                    Interface and operations
                  </h3>
                  <BuilderPill tone="contract">contract</BuilderPill>
                </div>
                <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
                  {template.componentType === 'api-endpoint'
                    ? 'Simulated: each operation’s request name and traffic weight become the emitted request mix. Fields and dependencies remain documentation only.'
                    : 'Documentation only — operations, fields, and their dependencies record the HLD contract for validation and grading. They are not turned into canvas edges and do not change the simulation; connect the actual edges on the canvas after placement.'}
                </p>
                <p className="mb-3 rounded border border-nss-border bg-nss-panel px-2 py-1.5 text-[10px] leading-relaxed text-nss-muted">
                  Request and response names are your own operation identifiers — write them
                  endpoint-style, e.g.{' '}
                  <span className="font-semibold text-nss-text">resolve-short-url</span> →{' '}
                  <span className="font-semibold text-nss-text">redirect</span>. There is no fixed
                  list; name them to match your API.
                </p>
                <div className="space-y-3">
                  {operations.map((operation, index) => (
                    <div
                      key={index}
                      className="rounded-md border border-nss-border bg-nss-panel p-3"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-nss-text">
                          Operation {index + 1}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove operation ${index + 1}`}
                          disabled={operations.length === 1}
                          onClick={() =>
                            setOperations((current) =>
                              current.filter((_, candidate) => candidate !== index)
                            )
                          }
                          className="text-nss-muted hover:text-nss-danger disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-4">
                        <label className="text-[10px] font-semibold text-nss-muted">
                          Label
                          <input
                            value={operation.label ?? ''}
                            onChange={(event) =>
                              updateOperation(index, { label: event.target.value })
                            }
                            placeholder="Display name, e.g. Resolve URL"
                            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-nss-muted">
                          Method
                          <select
                            value={operation.method ?? ''}
                            onChange={(event) =>
                              updateOperation(index, {
                                method:
                                  (event.target.value as CustomOperationDefinition['method']) ||
                                  undefined
                              })
                            }
                            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                          >
                            <option value="">—</option>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                        </label>
                        <label className="text-[10px] font-semibold text-nss-muted">
                          Request name
                          <input
                            value={operation.requestType}
                            onChange={(event) =>
                              updateOperation(index, { requestType: event.target.value })
                            }
                            placeholder="e.g. resolve-short-url"
                            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-nss-muted">
                          Response name
                          <input
                            value={operation.responseType}
                            onChange={(event) =>
                              updateOperation(index, { responseType: event.target.value })
                            }
                            placeholder="e.g. redirect"
                            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                          />
                        </label>
                        <label className="text-[10px] font-semibold text-nss-muted">
                          Intent
                          <select
                            value={operation.intent ?? 'compute'}
                            onChange={(event) =>
                              updateOperation(index, {
                                intent: event.target.value as CustomOperationDefinition['intent']
                              })
                            }
                            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                          >
                            <option value="read">Read</option>
                            <option value="write">Write</option>
                            <option value="read-write">Read-write</option>
                            <option value="compute">Compute</option>
                            <option value="side-effect">Side effect</option>
                          </select>
                        </label>
                        {template.componentType === 'api-endpoint' ? (
                          <label className="text-[10px] font-semibold text-nss-muted">
                            Traffic weight
                            <input
                              type="number"
                              min={0}
                              step={0.1}
                              value={operation.weight ?? 1}
                              onChange={(event) =>
                                updateOperation(index, { weight: Number(event.target.value) })
                              }
                              className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
                            />
                          </label>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <FieldList
                          title="Input fields"
                          fields={operation.inputFields ?? []}
                          onChange={(inputFields) => updateOperation(index, { inputFields })}
                        />
                        <FieldList
                          title="Output fields"
                          fields={operation.outputFields ?? []}
                          onChange={(outputFields) => updateOperation(index, { outputFields })}
                        />
                      </div>
                      <div className="mt-3 rounded-md border border-nss-border bg-nss-surface/50 p-2">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-nss-muted">
                            Dependencies
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              updateOperation(index, {
                                dependencies: [...operation.dependencies, makeDependency()]
                              })
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-semibold text-nss-primary hover:text-nss-text"
                          >
                            <Plus size={11} /> Dependency
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {operation.dependencies.map((dependency, dependencyIndex) => (
                            <div
                              key={dependencyIndex}
                              className="grid grid-cols-[minmax(0,1fr)_92px_78px_60px_100px_22px] items-center gap-1"
                            >
                              <input
                                aria-label={`Dependency target for ${operation.id}`}
                                value={dependency.target}
                                onChange={(event) =>
                                  updateDependency(index, dependencyIndex, {
                                    target: event.target.value
                                  })
                                }
                                placeholder="Target node"
                                className="min-w-0 rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-[10px] text-nss-text"
                              />
                              <select
                                aria-label={`Dependency role for ${operation.id}`}
                                value={dependency.targetRole ?? 'service'}
                                onChange={(event) =>
                                  updateDependency(index, dependencyIndex, {
                                    targetRole: event.target.value as DependencyTargetRole
                                  })
                                }
                                className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                              >
                                {DEPENDENCY_TARGET_ROLES.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
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
                                {DEPENDENCY_ACTIONS.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`Dependency mode for ${operation.id}`}
                                value={dependency.callMode ?? 'sync'}
                                onChange={(event) =>
                                  updateDependency(index, dependencyIndex, {
                                    callMode: event.target
                                      .value as CustomDependencyIntent['callMode']
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
                                    condition: event.target
                                      .value as CustomDependencyIntent['condition']
                                  })
                                }
                                className="rounded border border-nss-border bg-nss-input-bg px-1 py-1 text-[10px] text-nss-text"
                              >
                                {DEPENDENCY_CONDITIONS.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
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
                                className="flex items-center justify-center rounded text-nss-muted hover:text-nss-danger"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setOperations((current) => [
                        ...current,
                        {
                          id: 'new-operation',
                          label: 'New operation',
                          requestType: 'request',
                          responseType: 'response',
                          intent: 'compute',
                          dependencies: []
                        }
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded border border-nss-border px-3 py-1.5 text-xs font-semibold text-nss-primary hover:bg-nss-panel"
                  >
                    <Plus size={13} /> Add operation
                  </button>
                </div>
              </section>

              <section
                id="builder-section-traits"
                className="scroll-mt-4 rounded-md border border-nss-border bg-nss-surface p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                    Traits
                  </h3>
                  <BuilderPill tone="runtime">runtime</BuilderPill>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {traits.map((trait) => {
                    const values = trait.values ?? {}
                    return (
                      <div
                        key={trait.traitId}
                        className="rounded-md border border-nss-border bg-nss-panel p-3"
                      >
                        <label className="flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-nss-text">
                            {TRAIT_LABELS[trait.traitId]}
                          </span>
                          <input
                            type="checkbox"
                            checked={trait.enabled}
                            onChange={() =>
                              setTraits((current) => toggleTrait(current, trait.traitId))
                            }
                            className="h-4 w-4 accent-nss-primary"
                          />
                        </label>
                        {trait.enabled ? (
                          <div className="mt-3 grid gap-2">
                            {trait.traitId === 'capacity' ? (
                              <>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Workload kind
                                  <select
                                    value={
                                      (values.workloadKind as string | undefined) ?? 'io-bound'
                                    }
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'workloadKind',
                                          event.target.value
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  >
                                    <option value="io-bound">IO-bound</option>
                                    <option value="cpu-bound">CPU-bound</option>
                                  </select>
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Workers per instance
                                  <input
                                    type="number"
                                    min={1}
                                    value={(values.workersPerInstance as number | undefined) ?? 32}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'workersPerInstance',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Instance count
                                  <input
                                    type="number"
                                    min={1}
                                    value={(values.instanceCount as number | undefined) ?? 1}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'instanceCount',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Queue slots
                                  <input
                                    type="number"
                                    min={1}
                                    value={(values.queueSlots as number | undefined) ?? 64}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'queueSlots',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                              </>
                            ) : null}
                            {trait.traitId === 'workload-profile' ? (
                              <label className="text-[10px] font-semibold text-nss-muted">
                                Service time ms
                                <input
                                  type="number"
                                  min={1}
                                  value={(values.serviceTimeMs as number | undefined) ?? 25}
                                  onChange={(event) =>
                                    setTraits((current) =>
                                      updateTraitValue(
                                        current,
                                        trait.traitId,
                                        'serviceTimeMs',
                                        Number(event.target.value)
                                      )
                                    )
                                  }
                                  className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                />
                              </label>
                            ) : null}
                            {trait.traitId === 'serverless-lifecycle' ? (
                              <>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Cold start latency ms
                                  <input
                                    type="number"
                                    min={0}
                                    value={(values.coldStartLatencyMs as number | undefined) ?? 150}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'coldStartLatencyMs',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Idle timeout ms
                                  <input
                                    type="number"
                                    min={0}
                                    value={(values.idleTimeoutMs as number | undefined) ?? 300000}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'idleTimeoutMs',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Max concurrency
                                  <input
                                    type="number"
                                    min={1}
                                    value={(values.maxConcurrency as number | undefined) ?? 100}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'maxConcurrency',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                              </>
                            ) : null}
                            {trait.traitId === 'retry-timeout' ? (
                              <>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Timeout ms
                                  <input
                                    type="number"
                                    min={1}
                                    value={(values.timeoutMs as number | undefined) ?? 1000}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'timeoutMs',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                                <label className="text-[10px] font-semibold text-nss-muted">
                                  Max retries
                                  <input
                                    type="number"
                                    min={0}
                                    value={(values.maxRetries as number | undefined) ?? 0}
                                    onChange={(event) =>
                                      setTraits((current) =>
                                        updateTraitValue(
                                          current,
                                          trait.traitId,
                                          'maxRetries',
                                          Number(event.target.value)
                                        )
                                      )
                                    }
                                    className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                  />
                                </label>
                              </>
                            ) : null}
                            {trait.traitId === 'rate-limiting' ? (
                              <label className="text-[10px] font-semibold text-nss-muted">
                                Limit per second
                                <input
                                  type="number"
                                  min={1}
                                  value={(values.limitPerSecond as number | undefined) ?? 1000}
                                  onChange={(event) =>
                                    setTraits((current) =>
                                      updateTraitValue(
                                        current,
                                        trait.traitId,
                                        'limitPerSecond',
                                        Number(event.target.value)
                                      )
                                    )
                                  }
                                  className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                />
                              </label>
                            ) : null}
                            {trait.traitId === 'external-dependency' ? (
                              <label className="text-[10px] font-semibold text-nss-muted">
                                Error rate percent
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={(values.errorRate as number | undefined) ?? 1}
                                  onChange={(event) =>
                                    setTraits((current) =>
                                      updateTraitValue(
                                        current,
                                        trait.traitId,
                                        'errorRate',
                                        Number(event.target.value)
                                      )
                                    )
                                  }
                                  className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
                                />
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </main>

          <aside className="border-l border-nss-border bg-nss-surface/40 p-4">
            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-nss-muted">
                  <ListChecks size={13} /> Review
                </h3>
                <div className="mt-3 space-y-2 rounded-md border border-nss-border bg-nss-panel p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-nss-muted">Will create</span>
                    <span className="max-w-[120px] truncate font-semibold text-nss-text">
                      {name || 'Unnamed'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-nss-muted">Engine type</span>
                    <span className="font-semibold text-nss-text">{template.componentType}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-nss-muted">Runtime</span>
                    <span className="font-semibold text-nss-text">{template.label}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-nss-muted">Operations</span>
                    <span className="font-semibold text-nss-text">{operations.length}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                  Simulates
                </h3>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-nss-muted">
                  {template.simulates.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                  Does not simulate
                </h3>
                <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-nss-muted">
                  {template.notModeled.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-nss-border bg-nss-panel p-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-nss-muted">
                  Your selections
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-nss-muted">
                  {template.componentType === 'api-endpoint' ? (
                    <>
                      Simulated: the enabled runtime traits below, plus {operations.length}{' '}
                      operation
                      {operations.length === 1 ? '' : 's'} as the emitted request mix. Documentation
                      only:{' '}
                      {mode === 'custom-node' ? `${capabilities.length} capabilities and ` : ''}
                      operation fields and dependencies.
                    </>
                  ) : (
                    <>
                      Simulated: the enabled runtime traits below. Documentation only (not
                      simulated):{' '}
                      {mode === 'custom-node' ? `${capabilities.length} capabilities, ` : ''}
                      {operations.length} operation{operations.length === 1 ? '' : 's'} and their
                      declared dependencies.
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {traits.filter((trait) => trait.enabled).length === 0 ? (
                    <span className="text-[10px] text-nss-muted">No runtime traits enabled.</span>
                  ) : (
                    traits
                      .filter((trait) => trait.enabled)
                      .map((trait) => (
                        <span
                          key={trait.traitId}
                          className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200"
                        >
                          {TRAIT_LABELS[trait.traitId]}
                        </span>
                      ))
                  )}
                </div>
              </div>

              {mode === 'service' ? (
                <label className="flex items-center gap-2 rounded-md border border-nss-border bg-nss-panel p-3 text-xs text-nss-text">
                  <input
                    type="checkbox"
                    checked={saveToLibrary}
                    onChange={(event) => setSaveToLibrary(event.target.checked)}
                    className="h-4 w-4 accent-nss-primary"
                  />
                  <Save size={13} className="text-nss-muted" />
                  Save to My Services
                </label>
              ) : null}

              {savedServices.length > 0 && mode === 'service' ? (
                <p className="text-[11px] text-nss-muted">
                  Saved services available: {savedServices.length}
                </p>
              ) : null}

              {validationMessages.length > 0 ? (
                <div className="rounded-md border border-nss-danger/40 bg-nss-danger/10 p-3">
                  <h3 className="text-xs font-semibold text-nss-danger">Fix before create</h3>
                  <ul className="mt-2 space-y-1 text-[11px] text-nss-danger">
                    {validationMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-200">
                  Ready to create. Enabled traits drive the simulation; connect the declared
                  dependencies as canvas edges after placement.
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-nss-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-nss-border px-3 py-2 text-xs font-semibold text-nss-muted hover:bg-nss-surface hover:text-nss-text"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={validationMessages.length > 0}
            onClick={create}
            className="inline-flex items-center gap-2 rounded-md bg-nss-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus size={14} /> Create node
          </button>
        </div>
      </div>
    </div>
  )
}

export function CustomDefinitionCreator({
  mode,
  onClose
}: {
  mode: DefinitionBuilderMode
  onClose: () => void
}): React.JSX.Element {
  const addNode = useStore((state) => state.addNode)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const nodes = useStore((state) => state.nodes)
  const [savedServices, setSavedServices] = useState<CustomNodeDefinition[]>(() =>
    readSavedServices()
  )

  useEffect(() => {
    setSavedServices(readSavedServices())
  }, [mode])

  const canvasServices = useMemo(
    () =>
      nodes
        .map((node) => (node.data as Partial<CanvasNodeDataV2>).customDefinition)
        .filter(
          (definition): definition is CustomNodeDefinition =>
            isCustomNodeDefinition(definition) && definition.kind === 'service'
        ),
    [nodes]
  )

  const placeDefinition = (definition: CustomNodeDefinition): void => {
    const node = createNodeFromDefinition(definition, nodes.length)
    addNode(node)
    selectGraphElements({ nodeId: node.id })
    onClose()
  }

  const saveService = (definition: CustomNodeDefinition): void => {
    const next = [
      definition,
      ...savedServices.filter(
        (candidate) =>
          candidate.name?.trim().toLowerCase() !== definition.name?.trim().toLowerCase()
      )
    ]
    setSavedServices(next)
    writeSavedServices(next)
  }

  const deleteSavedService = (index: number): void => {
    const next = savedServices.filter((_, current) => current !== index)
    setSavedServices(next)
    writeSavedServices(next)
  }

  if (mode === 'my-service') {
    return (
      <MyServicesModal
        savedServices={savedServices}
        canvasServices={canvasServices}
        onUse={placeDefinition}
        onDelete={deleteSavedService}
        onClose={onClose}
      />
    )
  }

  return (
    <DefinitionBuilderModal
      mode={mode}
      savedServices={savedServices}
      onSaveService={saveService}
      onCreate={placeDefinition}
      onClose={onClose}
    />
  )
}
