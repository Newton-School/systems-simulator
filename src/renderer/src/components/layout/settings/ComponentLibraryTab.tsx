import { useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { CATALOG_CONFIG } from '@renderer/config/catalogConfig'
import {
  isComponentLibraryItemVisible,
  isInDefaultComponentLibrary
} from '@renderer/config/componentLibraryVisibility'
import useStore from '@renderer/store/useStore'
import { SectionLabel, Segmented, Toggle } from './SettingsControls'

function replaceHiddenIds(
  currentHiddenIds: readonly string[],
  templateIds: readonly string[],
  visible: boolean
): string[] {
  const next = new Set(currentHiddenIds)
  for (const id of templateIds) {
    if (visible) next.delete(id)
    else next.add(id)
  }
  return [...next]
}

export function ComponentLibraryTab(): React.JSX.Element {
  const displaySettings = useStore((state) => state.displaySettings)
  const updateDisplaySettings = useStore((state) => state.updateDisplaySettings)
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(
    () => new Set(CATALOG_CONFIG.map((category) => category.id))
  )
  const defaultCount = CATALOG_CONFIG.flatMap((category) => category.items).filter((item) =>
    isInDefaultComponentLibrary(item.id)
  ).length

  const toggleCategory = (categoryId: string): void => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const resetToCurrentDefaults = (): void => {
    updateDisplaySettings((current) => ({
      ...current,
      componentLibraryMode: 'default',
      hiddenComponentLibraryTemplateIds: []
    }))
  }

  const isUsingCurrentDefaults =
    displaySettings.componentLibraryMode === 'default' &&
    displaySettings.hiddenComponentLibraryTemplateIds.length === 0

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-nss-border bg-nss-surface p-3">
        <div className="text-[12px] font-medium text-nss-text">Palette visibility</div>
        <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
          Choose the starting library, then hide individual components or complete categories.
          Environment and question restrictions still take precedence.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-medium text-nss-text">Starting library</div>
          <button
            type="button"
            onClick={resetToCurrentDefaults}
            disabled={isUsingCurrentDefaults}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-nss-muted transition-colors hover:bg-nss-surface hover:text-nss-text disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RotateCcw size={12} aria-hidden="true" />
            Reset to V1 defaults
          </button>
        </div>
        <Segmented
          value={displaySettings.componentLibraryMode}
          options={[
            { value: 'default', label: `Current defaults (${defaultCount})` },
            { value: 'all', label: 'All components' }
          ]}
          onChange={(componentLibraryMode) =>
            updateDisplaySettings((current) => ({ ...current, componentLibraryMode }))
          }
        />
        <p className="text-[11px] leading-relaxed text-nss-muted">
          Current defaults preserves the existing V1 palette. All components exposes every
          catalogued template that has not been hidden below.
        </p>
      </div>

      <SectionLabel>Categories</SectionLabel>

      <div className="overflow-hidden rounded-md border border-nss-border">
        {CATALOG_CONFIG.map((category) => {
          const templateIds = category.items.map((item) => item.id)
          const visibleItems = category.items.filter((item) =>
            isComponentLibraryItemVisible({
              templateId: item.id,
              mode: displaySettings.componentLibraryMode,
              hiddenTemplateIds: displaySettings.hiddenComponentLibraryTemplateIds
            })
          )
          const categoryVisible = visibleItems.length > 0
          const expanded = expandedCategoryIds.has(category.id)

          return (
            <section key={category.id} className="border-b border-nss-border last:border-b-0">
              <div className="flex items-center gap-2 bg-nss-surface px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={`shrink-0 text-nss-muted transition-transform ${expanded ? '' : '-rotate-90'}`}
                  />
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-nss-text">{category.title}</div>
                    <div className="text-[10px] text-nss-muted">
                      {visibleItems.length} of {category.items.length} shown
                    </div>
                  </div>
                </button>
                <Toggle
                  checked={categoryVisible}
                  onChange={(visible) =>
                    updateDisplaySettings((current) => ({
                      ...current,
                      hiddenComponentLibraryTemplateIds: replaceHiddenIds(
                        current.hiddenComponentLibraryTemplateIds,
                        templateIds,
                        visible
                      )
                    }))
                  }
                />
              </div>

              {expanded && (
                <div className="ml-4 border-l-2 border-nss-primary/20 bg-nss-panel/45 py-1">
                  {category.items.map((item) => {
                    const visible = isComponentLibraryItemVisible({
                      templateId: item.id,
                      mode: displaySettings.componentLibraryMode,
                      hiddenTemplateIds: displaySettings.hiddenComponentLibraryTemplateIds
                    })
                    const availableInMode =
                      displaySettings.componentLibraryMode === 'all' ||
                      isInDefaultComponentLibrary(item.id)

                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 border-b border-nss-border/60 px-4 py-2 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11px] font-medium text-nss-text">
                            {item.label}
                          </div>
                          <div className="truncate text-[10px] text-nss-muted">{item.subLabel}</div>
                        </div>
                        <Toggle
                          checked={visible}
                          disabled={!availableInMode}
                          onChange={(nextVisible) =>
                            updateDisplaySettings((current) => ({
                              ...current,
                              hiddenComponentLibraryTemplateIds: replaceHiddenIds(
                                current.hiddenComponentLibraryTemplateIds,
                                [item.id],
                                nextVisible
                              )
                            }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
