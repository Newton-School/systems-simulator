import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { useLibraryCatalog } from '@renderer/hooks/useLibraryCatalog'
import { buildAddPopoverModel } from '@renderer/config/addPopoverModel'
import type { CatalogItem } from '@renderer/types/ui'
import { LibraryItem } from './LibraryItem'

const SECTION_LABEL = 'px-1 text-[10px] font-bold uppercase tracking-widest text-nss-muted'

/**
 * Simple shell's replacement for the sidebar component library: a suggested row up top, the
 * rest of the catalog behind collapsed categories, and search that spans everything.
 * Picking a tile arms the same click-to-place flow the sidebar uses.
 */
export function AddComponentPopover({
  onClose,
  focusSearchVersion = 0
}: {
  onClose: () => void
  focusSearchVersion?: number
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const pendingNodePlacement = useStore((state) => state.pendingNodePlacement)
  const setPendingNodePlacement = useStore((state) => state.setPendingNodePlacement)

  const { categories: common } = useLibraryCatalog('', 'common')
  const { categories: all, curated } = useLibraryCatalog(query, 'all')
  const model = buildAddPopoverModel({ common, all, curated, query })

  useEffect(() => {
    searchRef.current?.focus()
  }, [focusSearchVersion])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const pick = (item: CatalogItem): void => {
    setPendingNodePlacement({ type: item.type, templateId: item.templateId, label: item.label })
    onClose()
  }

  const renderItems = (items: readonly CatalogItem[]) => (
    <div className="grid grid-cols-4 gap-1">
      {items.map((item) => (
        <LibraryItem
          key={item.id}
          item={item}
          onActivate={pick}
          selected={pendingNodePlacement?.templateId === item.templateId}
        />
      ))}
    </div>
  )

  const nothing = model.suggested.length === 0 && model.categories.length === 0

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Add component"
      data-testid="add-component-popover"
      className="nss-add-popover absolute bottom-36 left-14 z-40 flex max-h-[min(30rem,calc(100%-10rem))] w-80 max-w-[calc(100%-4rem)] flex-col gap-2 overflow-hidden rounded-lg border border-nss-border bg-nss-panel p-2 shadow-xl"
    >
      <div className="relative shrink-0">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted"
        />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search components…"
          aria-label="Search components"
          className="h-8 w-full rounded-md border border-nss-border bg-nss-input-bg pl-8 pr-3 text-xs text-nss-text outline-none placeholder:text-nss-muted focus:border-nss-primary"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {model.suggested.length > 0 && (
          <section className="space-y-1">
            <h3 className={SECTION_LABEL}>
              {curated ? 'Components for this question' : 'Suggested'}
            </h3>
            {renderItems(model.suggested)}
          </section>
        )}

        {model.categories.length > 0 && (
          <section className="space-y-0.5">
            {!model.searching && <h3 className={SECTION_LABEL}>Browse</h3>}
            {model.categories.map((category) => {
              const expanded = model.searching || openCategoryId === category.id
              return (
                <div key={category.id}>
                  {model.searching ? (
                    <h4 className={`${SECTION_LABEL} py-1`}>{category.title}</h4>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpenCategoryId(expanded ? null : category.id)}
                      className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-xs text-nss-text transition-colors hover:bg-nss-surface"
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="flex-1">{category.title}</span>
                      <span className="text-[10px] text-nss-muted">{category.items.length}</span>
                    </button>
                  )}
                  {expanded && renderItems(category.items)}
                </div>
              )
            })}
          </section>
        )}

        {nothing && (
          <p className="px-2 py-4 text-center text-xs text-nss-muted">
            {query.trim() ? `No components match "${query.trim()}"` : 'No components available.'}
          </p>
        )}
      </div>
    </div>
  )
}
