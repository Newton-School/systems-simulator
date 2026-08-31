import { useMemo } from 'react'
import useStore from '../../store/useStore'
import { CATALOG_CONFIG } from '../../config/catalogConfig'
import { PALETTE_TEMPLATES } from '../../../../engine/catalog/paletteTemplates'
import { LibraryItem } from './LibraryItem'

export type ComponentLibraryFilter = 'all' | 'common'

const COMMON_IDS = new Set([
  'client-user',
  'api-gateway',
  'load-balancer-l7',
  'cdn',
  'backend-server',
  'auth-service',
  'primary-db',
  'redis-cache',
  'message-queue',
  'read-replica'
])

/**
 * V1 palette allowlist. We ship only the node types the V1 question bank actually
 * exercises - ones with real, simulatable behavior whose config nuances are
 * covered. Every other catalog node is HIDDEN from the library (not deleted) until
 * its behavior is fleshed out in a later version. Set to `null` to reveal the full
 * catalog again.
 *
 * NOTE: these are engine `componentType` values, resolved per catalog item via
 * `PALETTE_TEMPLATES[item.id].componentType`. Do NOT match against `item.type` -
 * that is the renderer node type (serviceNode/computeNode/...), not the component
 * type, and matching it here empties the whole library.
 * This only hides nodes from the drag-in library; loading a topology JSON that
 * references any node type still works.
 */
const V1_PALETTE_NODE_TYPES: ReadonlySet<string> | null = new Set([
  'api-endpoint',
  'load-balancer',
  'cdn',
  'microservice',
  'batch-worker',
  'queue',
  'message-broker',
  'in-memory-cache',
  'kv-store',
  'nosql-db',
  'relational-db',
  'time-series-db',
  'object-storage'
])

const FILTERS: readonly ComponentLibraryFilter[] = ['common', 'all']

export function ComponentLibrarySidebarPanel({
  query,
  filter,
  onQueryChange,
  onFilterChange
}: {
  query: string
  filter: ComponentLibraryFilter
  onQueryChange: (value: string) => void
  onFilterChange: (value: ComponentLibraryFilter) => void
}): React.JSX.Element {
  const editPaletteList = useStore((state) => state.environmentProfile.capabilities.editPaletteList)
  const activeQuestion = useStore((state) => state.activeQuestion)
  const allowedPalette = useMemo(
    () => (editPaletteList === null ? null : new Set(editPaletteList)),
    [editPaletteList]
  )
  const questionAllowedNodeTypes = useMemo(
    () =>
      activeQuestion?.constraints.allowedNodeTypes
        ? new Set(activeQuestion.constraints.allowedNodeTypes)
        : null,
    [activeQuestion]
  )
  const questionForbiddenNodeTypes = useMemo(
    () =>
      activeQuestion?.constraints.forbiddenNodeTypes
        ? new Set(activeQuestion.constraints.forbiddenNodeTypes)
        : null,
    [activeQuestion]
  )

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()

    return CATALOG_CONFIG.map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const matchesFilter = filter === 'all' || COMMON_IDS.has(item.id)
        const matchesSearch =
          !trimmed ||
          item.label.toLowerCase().includes(trimmed) ||
          item.subLabel.toLowerCase().includes(trimmed)
        const matchesPalette =
          allowedPalette === null || allowedPalette.has(item.type) || allowedPalette.has(item.id)
        const componentType = PALETTE_TEMPLATES[item.id]?.componentType
        const matchesV1 =
          V1_PALETTE_NODE_TYPES === null ||
          (componentType !== undefined && V1_PALETTE_NODE_TYPES.has(componentType))
        const matchesQuestionAllowlist =
          questionAllowedNodeTypes === null ||
          (componentType !== undefined && questionAllowedNodeTypes.has(componentType))
        const matchesQuestionDenylist =
          questionForbiddenNodeTypes === null ||
          componentType === undefined ||
          !questionForbiddenNodeTypes.has(componentType)

        return (
          matchesFilter &&
          matchesSearch &&
          matchesPalette &&
          matchesV1 &&
          matchesQuestionAllowlist &&
          matchesQuestionDenylist
        )
      })
    })).filter((category) => category.items.length > 0)
  }, [allowedPalette, filter, query, questionAllowedNodeTypes, questionForbiddenNodeTypes])

  return (
    <>
      <div className="shrink-0 space-y-3 border-b border-nss-border p-4 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">
          Component Library
        </h2>

        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search components…"
            className="
              h-7 w-full rounded-md border border-nss-border bg-nss-input-bg
              pl-7 pr-3 text-xs font-sans text-nss-text outline-none
              placeholder:text-nss-muted focus:border-nss-primary transition-colors
            "
          />
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted">
            ⌕
          </span>
        </div>

        <div className="flex gap-1 rounded-md bg-nss-bg p-0.5">
          {FILTERS.map((currentFilter) => (
            <button
              key={currentFilter}
              type="button"
              onClick={() => onFilterChange(currentFilter)}
              className={`
                h-6 flex-1 rounded text-[11px] font-semibold capitalize transition-colors
                ${
                  filter === currentFilter
                    ? 'bg-nss-surface text-nss-text shadow-sm'
                    : 'text-nss-muted hover:text-nss-text'
                }
              `}
            >
              {currentFilter === 'common' ? 'Common' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        {filtered.length > 0 ? (
          filtered.map((category) => (
            <div key={category.id}>
              <h3 className="mb-2 px-2 text-[10px] font-bold uppercase opacity-80 text-nss-muted">
                {category.title}
              </h3>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {category.items.map((item) => (
                  <LibraryItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="px-2 pt-4 text-center text-xs text-nss-muted">
            {activeQuestion?.constraints.allowedNodeTypes?.length === 0
              ? 'This experience locks the topology, so the component palette is hidden.'
              : `No components match "${query}"`}
          </p>
        )}
      </div>
    </>
  )
}
