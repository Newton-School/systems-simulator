import { useState } from 'react'
import type { Node } from 'reactflow'
import { Plus, Sparkles, X } from 'lucide-react'
import {
  RUNTIME_TEMPLATES,
  serviceRecipe,
  type CustomDefinitionKind,
  type CustomNodeDefinition,
  type RuntimeTemplateId
} from '../../../../engine/catalog/customDefinitions'
import { instantiateTemplate } from '../../../../engine/catalog/paletteTemplates'
import { getId } from '../canvas/utils/canvasUtils'
import useStore from '../../store/useStore'

type ServiceRecipe = 'blank' | 'auth' | 'url-shortener'

const runtimeIds = Object.keys(RUNTIME_TEMPLATES) as RuntimeTemplateId[]

function defaultName(kind: CustomDefinitionKind, recipe: ServiceRecipe): string {
  if (kind === 'service') {
    if (recipe === 'auth') return 'Auth Service'
    if (recipe === 'url-shortener') return 'URL Shortener'
    return 'New Service'
  }
  return 'Custom Node'
}

export function CustomDefinitionCreator(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<CustomDefinitionKind>('service')
  const [recipe, setRecipe] = useState<ServiceRecipe>('blank')
  const [name, setName] = useState('New Service')
  const [description, setDescription] = useState('')
  const [runtimeTemplate, setRuntimeTemplate] = useState<RuntimeTemplateId>('serverless-function')
  const addNode = useStore((state) => state.addNode)
  const selectGraphElements = useStore((state) => state.selectGraphElements)
  const nodeCount = useStore((state) => state.nodes.length)

  const close = () => setOpen(false)
  const switchKind = (next: CustomDefinitionKind) => {
    setKind(next)
    setName(defaultName(next, recipe))
  }
  const switchRecipe = (next: ServiceRecipe) => {
    setRecipe(next)
    if (kind === 'service') setName(defaultName(kind, next))
  }

  const create = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const selectedRuntime = kind === 'service' ? 'long-running-service' : runtimeTemplate
    const template = RUNTIME_TEMPLATES[selectedRuntime]
    const id = getId()
    const definition: CustomNodeDefinition = {
      kind,
      runtimeTemplate: selectedRuntime,
      ...(description.trim() ? { description: description.trim() } : {}),
      operations:
        kind === 'service'
          ? serviceRecipe(recipe)
          : serviceRecipe('blank').map((operation) => ({
              ...operation,
              id: 'handle-event',
              requestType: 'event',
              responseType: 'completed'
            }))
    }
    const data = instantiateTemplate(template.paletteTemplateId)
    data.label = trimmedName
    data.customDefinition = definition
    const node: Node = {
      id,
      type: data.rendererType,
      position: { x: 280 + (nodeCount % 3) * 36, y: 180 + (nodeCount % 4) * 32 },
      data,
      selected: true
    }
    addNode(node)
    selectGraphElements({ nodeId: id })
    close()
  }

  return (
    <section className="border-b border-nss-border p-4 pb-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">Create</h2>
        <Sparkles size={13} className="text-nss-primary" aria-hidden="true" />
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-nss-primary/40 bg-nss-primary/10 px-3 py-2 text-xs font-semibold text-nss-text transition-colors hover:bg-nss-primary/20"
      >
        <Plus size={14} aria-hidden="true" />
        Define service or node
      </button>

      {open ? (
        <div
          className="mt-3 space-y-3 rounded-md border border-nss-border bg-nss-surface p-3"
          role="dialog"
          aria-label="Define service or custom node"
        >
          <div className="flex gap-1 rounded bg-nss-bg p-1">
            {(['service', 'custom-node'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => switchKind(option)}
                className={`flex-1 rounded px-2 py-1.5 text-[11px] font-semibold ${kind === option ? 'bg-nss-panel text-nss-text shadow-sm' : 'text-nss-muted'}`}
              >
                {option === 'service' ? 'Service' : 'Custom node'}
              </button>
            ))}
          </div>

          {kind === 'service' ? (
            <label className="block text-[11px] text-nss-muted">
              Recipe
              <select
                value={recipe}
                onChange={(event) => switchRecipe(event.target.value as ServiceRecipe)}
                className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              >
                <option value="blank">Blank service</option>
                <option value="auth">Authentication service</option>
                <option value="url-shortener">URL shortener</option>
              </select>
            </label>
          ) : (
            <label className="block text-[11px] text-nss-muted">
              Runtime template
              <select
                value={runtimeTemplate}
                onChange={(event) => setRuntimeTemplate(event.target.value as RuntimeTemplateId)}
                className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              >
                {runtimeIds
                  .filter((id) => id !== 'long-running-service')
                  .map((id) => (
                    <option key={id} value={id}>
                      {RUNTIME_TEMPLATES[id].label}
                    </option>
                  ))}
              </select>
              <span className="mt-1 block text-[10px] leading-snug text-nss-muted">
                Simulates: {RUNTIME_TEMPLATES[runtimeTemplate].simulates.join(', ')}.
              </span>
            </label>
          )}

          <label className="block text-[11px] text-nss-muted">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              autoFocus
            />
          </label>
          <label className="block text-[11px] text-nss-muted">
            Description <span className="text-nss-muted/70">(optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              className="mt-1 w-full resize-y rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-nss-muted hover:text-nss-text"
            >
              <X size={12} /> Cancel
            </button>
            <button
              type="button"
              onClick={create}
              disabled={!name.trim()}
              className="rounded bg-nss-primary px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              Create node
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
