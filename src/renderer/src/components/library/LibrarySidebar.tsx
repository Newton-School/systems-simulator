import { memo, useMemo, useState } from 'react'
import { FileText, Library as LibraryIcon, Search, type LucideIcon } from 'lucide-react'
import { CATALOG_CONFIG } from '../../config/catalogConfig'
import { LibraryItem } from './LibraryItem'

type Filter = 'all' | 'common'
export type LibrarySidebarTab = 'question' | 'library'

interface ActivityTab {
  id: LibrarySidebarTab
  label: string
  icon: LucideIcon
}

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

const FILTERS: Filter[] = ['common', 'all']
const ACTIVITY_TABS: ActivityTab[] = [
  { id: 'question', label: 'Question Text', icon: FileText },
  { id: 'library', label: 'Component Library', icon: LibraryIcon }
]

interface LibraryActivityRailProps {
  activeTab: LibrarySidebarTab
  onSelect: (tab: LibrarySidebarTab) => void
}

interface LibrarySidebarContentProps {
  activeTab: LibrarySidebarTab
}

interface QuestionTextPanelProps {
  questionText: string
  onQuestionTextChange: (value: string) => void
}

interface ComponentLibraryPanelProps {
  query: string
  filter: Filter
  onQueryChange: (value: string) => void
  onFilterChange: (value: Filter) => void
}

const ActivityButton = memo(function ActivityButton({
  tab,
  activeTab,
  onSelect
}: {
  tab: ActivityTab
  activeTab: LibrarySidebarTab
  onSelect: (tab: LibrarySidebarTab) => void
}) {
  const Icon = tab.icon
  const isActive = activeTab === tab.id

  return (
    <button
      type="button"
      onClick={() => onSelect(tab.id)}
      title={tab.label}
      aria-label={tab.label}
      aria-pressed={isActive}
      className={`relative h-10 w-10 rounded-md flex items-center justify-center transition-colors ${
        isActive
          ? 'bg-nss-surface text-nss-text'
          : 'text-nss-muted hover:text-nss-text hover:bg-nss-surface'
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-nss-primary" />
      )}
      <Icon size={18} />
    </button>
  )
})

export const LibraryActivityRail = memo(function LibraryActivityRail({
  activeTab,
  onSelect
}: LibraryActivityRailProps) {
  return (
    <nav
      aria-label="Library views"
      className="h-full w-12 shrink-0 bg-nss-bg border-r border-nss-border flex flex-col items-center py-2 gap-1"
    >
      {ACTIVITY_TABS.map((tab) => (
        <ActivityButton key={tab.id} tab={tab} activeTab={activeTab} onSelect={onSelect} />
      ))}
    </nav>
  )
})

function QuestionTextPanel({ questionText, onQuestionTextChange }: QuestionTextPanelProps) {
  return (
    <>
      <div className="p-4 pb-3 border-b border-nss-border shrink-0 space-y-1">
        <h2 className="text-xs font-bold text-nss-muted uppercase tracking-widest">
          Question Text
        </h2>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <textarea
          value={questionText}
          onChange={(event) => onQuestionTextChange(event.target.value)}
          placeholder="Paste or type the system design question here..."
          className="h-full w-full resize-none rounded-md border border-nss-border bg-nss-input-bg p-3 text-xs leading-relaxed text-nss-text placeholder:text-nss-muted outline-none focus:border-nss-primary"
        />
      </div>
    </>
  )
}

function ComponentLibraryPanel({
  query,
  filter,
  onQueryChange,
  onFilterChange
}: ComponentLibraryPanelProps) {
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
        return matchesFilter && matchesSearch
      })
    })).filter((category) => category.items.length > 0)
  }, [filter, query])

  return (
    <>
      <div className="p-4 pb-3 border-b border-nss-border shrink-0 space-y-3">
        <h2 className="text-xs font-bold text-nss-muted uppercase tracking-widest">
          Component Library
        </h2>

        <div className="relative">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nss-muted pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search components…"
            className="
              w-full h-7 pl-7 pr-3 rounded-md text-xs font-sans
              bg-nss-input-bg border border-nss-border text-nss-text
              placeholder:text-nss-muted outline-none
              focus:border-nss-primary transition-colors
            "
          />
        </div>

        <div className="flex gap-1 bg-nss-bg rounded-md p-0.5">
          {FILTERS.map((currentFilter) => (
            <button
              key={currentFilter}
              onClick={() => onFilterChange(currentFilter)}
              className={`
                flex-1 h-6 rounded text-[11px] font-semibold capitalize transition-colors
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

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {filtered.length > 0 ? (
          filtered.map((category) => (
            <div key={category.id}>
              <h3 className="px-2 mb-2 text-[10px] font-bold text-nss-muted uppercase opacity-80">
                {category.title}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {category.items.map((item) => (
                  <LibraryItem key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="px-2 pt-4 text-xs text-nss-muted text-center">
            No components match &quot;{query}&quot;
          </p>
        )}
      </div>
    </>
  )
}

export function LibrarySidebarContent({ activeTab }: LibrarySidebarContentProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [questionText, setQuestionText] = useState('')

  return (
    <aside className="h-full w-full min-w-0 bg-nss-panel border-r border-nss-border flex flex-col transition-colors duration-200">
      {activeTab === 'question' ? (
        <QuestionTextPanel questionText={questionText} onQuestionTextChange={setQuestionText} />
      ) : (
        <ComponentLibraryPanel
          query={query}
          filter={filter}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
        />
      )}
    </aside>
  )
}
