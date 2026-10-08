import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import { ArrowRightFromLine, SquarePlus, X } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { CATALOG_CONFIG } from '@renderer/config/catalogConfig'
import { BUILDER_TEMPLATE_IDS, filterCatalogCategories } from '@renderer/config/catalogFilter'
import type { CatalogItem } from '@renderer/types/ui'
import { isTemplateOfferedFor, type ContextualAddRequest } from './utils/contextualAdd'
import { nodeDisplayLabel } from './utils/connectionRules'

export const CONTEXTUAL_ADD_PICKER_WIDTH = 288
const PICKER_MAX_LIST_HEIGHT = 300

interface ContextualAddPickerProps {
  request: ContextualAddRequest
  anchor: Node | undefined
  /** Top-left of the picker in the canvas wrapper's coordinates. */
  position: { left: number; top: number }
  onPick: (item: CatalogItem) => void
  onClose: () => void
}

/**
 * Compact component picker for "Add inside" and "Add connected". It uses the
 * component library's catalog and filters (palette, question allow/deny lists,
 * library visibility), then keeps only components valid for the anchor.
 */
export function ContextualAddPicker({
  request,
  anchor,
  position,
  onPick,
  onClose
}: ContextualAddPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const editPaletteList = useStore((state) => state.environmentProfile.capabilities.editPaletteList)
  const activeQuestion = useStore((state) => state.activeQuestion)
  const componentLibraryMode = useStore((state) => state.displaySettings.componentLibraryMode)
  const hiddenTemplateIds = useStore(
    (state) => state.displaySettings.hiddenComponentLibraryTemplateIds
  )

  const categories = useMemo(
    () =>
      filterCatalogCategories(CATALOG_CONFIG, {
        query,
        filter: 'all',
        editPaletteList,
        allowedNodeTypes: activeQuestion?.constraints.allowedNodeTypes ?? null,
        forbiddenNodeTypes: activeQuestion?.constraints.forbiddenNodeTypes ?? null,
        componentLibraryMode,
        hiddenTemplateIds,
        include: (item) =>
          !BUILDER_TEMPLATE_IDS.has(item.templateId) &&
          isTemplateOfferedFor(request.mode, anchor, item.templateId),
        // Nesting is the point of "Add inside": offer the valid Region / Zone /
        // Subnet children even when the curated library leaves them out.
        ignoreLibraryModeFor: (item) => request.mode === 'child' && item.type === 'vpcNode'
      }),
    [
      activeQuestion,
      anchor,
      componentLibraryMode,
      editPaletteList,
      hiddenTemplateIds,
      query,
      request.mode
    ]
  )
  const flatItems = useMemo(() => categories.flatMap((category) => category.items), [categories])
  const clampedIndex = Math.min(activeIndex, Math.max(0, flatItems.length - 1))

  // Focus before paint so typing straight after the shortcut lands in the search.
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as globalThis.Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handlePointerDown, { capture: true })
    return () => document.removeEventListener('mousedown', handlePointerDown, { capture: true })
  }, [onClose])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (flatItems.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((clampedIndex + step + flatItems.length) % flatItems.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = flatItems[clampedIndex]
      if (item) onPick(item)
    }
  }

  const anchorLabel = nodeDisplayLabel(anchor)
  const title = request.mode === 'child' ? `Add inside ${anchorLabel}` : `Add after ${anchorLabel}`
  const TitleIcon = request.mode === 'child' ? SquarePlus : ArrowRightFromLine
  let runningIndex = -1

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      onKeyDown={handleKeyDown}
      className="nodrag nopan nowheel pointer-events-auto absolute z-40 flex flex-col overflow-hidden rounded-lg border border-nss-border bg-nss-panel shadow-xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: position.left, top: position.top, width: CONTEXTUAL_ADD_PICKER_WIDTH }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-nss-border bg-nss-surface/50 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-nss-text">
          <TitleIcon size={13} className="shrink-0 text-nss-primary" />
          <span className="truncate">{title}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-nss-muted transition-colors hover:bg-nss-border/50 hover:text-nss-text"
          title="Close"
          aria-label="Close"
        >
          <X size={12} />
        </button>
      </div>
      <div className="border-b border-nss-border p-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          placeholder="Search components…"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            flatItems[clampedIndex] ? `${listId}-${flatItems[clampedIndex].id}` : undefined
          }
          className="h-7 w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 text-xs text-nss-text outline-none transition-colors placeholder:text-nss-muted focus:border-nss-primary"
        />
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className="overflow-y-auto p-1"
        style={{ maxHeight: PICKER_MAX_LIST_HEIGHT }}
      >
        {categories.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-nss-muted">
            {query.trim()
              ? `No components match "${query.trim()}" here`
              : 'No components can be added here'}
          </p>
        ) : (
          categories.map((category) => (
            <div key={category.id} className="pb-1">
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-nss-muted">
                {category.title}
              </div>
              {category.items.map((item) => {
                runningIndex += 1
                const index = runningIndex
                const isActive = index === clampedIndex
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onPick(item)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                      isActive ? 'bg-nss-surface text-nss-primary' : 'text-nss-text'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${item.color.bg} bg-opacity-30`}
                    >
                      <Icon size={12} className={item.color.text} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.label}</span>
                      <span className="block truncate text-[10px] text-nss-muted">
                        {item.subLabel}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
      <div className="border-t border-nss-border px-3 py-1.5 text-[10px] text-nss-muted">
        Arrow keys to choose, Enter to add, Esc to close
      </div>
    </div>
  )
}
