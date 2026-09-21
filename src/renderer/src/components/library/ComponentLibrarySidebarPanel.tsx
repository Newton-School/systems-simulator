import { useEffect, useMemo, useRef, useState } from 'react'
import useStore from '../../store/useStore'
import { CATALOG_CONFIG } from '../../config/catalogConfig'
import { PALETTE_TEMPLATES } from '../../../../engine/catalog/paletteTemplates'
import { CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE } from '../../../../engine/analysis/authoringCapabilities'
import { isComponentLibraryItemVisible } from '../../config/componentLibraryVisibility'
import { LibraryItem } from './LibraryItem'
import { CustomDefinitionCreator, type DefinitionBuilderMode } from './CustomDefinitionCreator'
import type { CatalogItem } from '@renderer/types/ui'

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
  'message-queue'
])

const FILTERS: readonly ComponentLibraryFilter[] = ['common', 'all']
const BUILDER_TEMPLATE_MODES: Readonly<Record<string, DefinitionBuilderMode>> = {
  'generic-service': 'service',
  'my-service': 'my-service',
  'custom-node-builder': 'custom-node'
}

export function ComponentLibrarySidebarPanel({
  query,
  filter,
  onQueryChange,
  onFilterChange,
  focusSearchVersion = 0
}: {
  query: string
  filter: ComponentLibraryFilter
  onQueryChange: (value: string) => void
  onFilterChange: (value: ComponentLibraryFilter) => void
  focusSearchVersion?: number
}): React.JSX.Element {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [builderMode, setBuilderMode] = useState<DefinitionBuilderMode | null>(null)
  const editPaletteList = useStore((state) => state.environmentProfile.capabilities.editPaletteList)
  const activeQuestion = useStore((state) => state.activeQuestion)
  const componentLibraryMode = useStore((state) => state.displaySettings.componentLibraryMode)
  const hiddenComponentLibraryTemplateIds = useStore(
    (state) => state.displaySettings.hiddenComponentLibraryTemplateIds
  )
  const pendingNodePlacement = useStore((state) => state.pendingNodePlacement)
  const setPendingNodePlacement = useStore((state) => state.setPendingNodePlacement)

  // Focus the search box as soon as the library mounts, so opening the app
  // lands the caret in the component search — type a node name and drag away
  // without a click. Deferred a frame so the sidebar layout has settled.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (focusSearchVersion <= 0) return
    searchInputRef.current?.focus()
    searchInputRef.current?.select()
  }, [focusSearchVersion])
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

  // A question allow-list turns the palette into a strict, curated set: only the
  // author's chosen types, one canonical item each, and no Common/All scoping.
  const hasQuestionAllowlist = questionAllowedNodeTypes !== null

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()

    return CATALOG_CONFIG.map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const componentType = PALETTE_TEMPLATES[item.id]?.componentType
        // With an allow-list, ignore the Common/All tab entirely — the curated
        // set is the whole palette. Otherwise an active search spans the whole
        // catalog so you never have to switch tabs to find a node by name.
        const matchesFilter =
          hasQuestionAllowlist || filter === 'all' || trimmed.length > 0 || COMMON_IDS.has(item.id)
        const matchesSearch =
          !trimmed ||
          item.label.toLowerCase().includes(trimmed) ||
          item.subLabel.toLowerCase().includes(trimmed)
        const matchesPalette =
          allowedPalette === null || allowedPalette.has(item.type) || allowedPalette.has(item.id)
        const matchesLibraryVisibility = isComponentLibraryItemVisible({
          templateId: item.id,
          mode: componentLibraryMode,
          hiddenTemplateIds: hiddenComponentLibraryTemplateIds
        })
        // Show exactly the author's picks: the one canonical template per allowed
        // type (so allowing `microservice` shows "API Server" only, not every
        // same-type template or placeholder/builder helper).
        const matchesQuestionAllowlist =
          questionAllowedNodeTypes === null ||
          (componentType !== undefined &&
            questionAllowedNodeTypes.has(componentType) &&
            CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE[componentType] === item.id)
        const matchesQuestionDenylist =
          questionForbiddenNodeTypes === null ||
          componentType === undefined ||
          !questionForbiddenNodeTypes.has(componentType)

        return (
          matchesFilter &&
          matchesSearch &&
          matchesPalette &&
          matchesLibraryVisibility &&
          matchesQuestionAllowlist &&
          matchesQuestionDenylist
        )
      })
    })).filter((category) => category.items.length > 0)
  }, [
    allowedPalette,
    componentLibraryMode,
    filter,
    hasQuestionAllowlist,
    hiddenComponentLibraryTemplateIds,
    query,
    questionAllowedNodeTypes,
    questionForbiddenNodeTypes
  ])

  const handleItemActivate = (item: CatalogItem): void => {
    const mode = BUILDER_TEMPLATE_MODES[item.templateId]
    if (mode) {
      setBuilderMode(mode)
      return
    }

    setPendingNodePlacement({
      type: item.type,
      templateId: item.templateId,
      label: item.label
    })
  }

  return (
    <>
      {builderMode ? (
        <CustomDefinitionCreator mode={builderMode} onClose={() => setBuilderMode(null)} />
      ) : null}
      <div className="shrink-0 space-y-3 border-b border-nss-border p-4 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-nss-muted">
          Component Library
        </h2>

        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search components…"
            title="Search components (/ or Cmd/Ctrl+K)"
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

        {!hasQuestionAllowlist && (
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
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-2">
        {filtered.length > 0 ? (
          filtered.map((category) => (
            <div key={category.id}>
              <h3 className="mb-2 px-2 text-[10px] font-bold uppercase opacity-80 text-nss-muted">
                {category.title}
              </h3>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {category.items.map((item) => {
                  const builderModeForItem = BUILDER_TEMPLATE_MODES[item.templateId]
                  return (
                    <LibraryItem
                      key={item.id}
                      item={item}
                      draggableItem={!builderModeForItem}
                      onActivate={handleItemActivate}
                      selected={pendingNodePlacement?.templateId === item.templateId}
                    />
                  )
                })}
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
