import { memo, useMemo, useState } from 'react'
import {
  FileText,
  FlaskConical,
  Library as LibraryIcon,
  Search,
  type LucideIcon
} from 'lucide-react'
import { CATALOG_CONFIG } from '../../config/catalogConfig'
import { CURATED_SCENARIOS } from '../../../../scenarios/curatedScenarios'
import { EmbeddedIframeQuestionPreview } from './EmbeddedIframeQuestion'
import { parseEmbeddedIframeQuestion } from './embeddedIframeQuestionSchema'
import { LibraryItem } from './LibraryItem'

type Filter = 'all' | 'common'
export type LibrarySidebarTab = 'question' | 'library' | 'scenarios'

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
  { id: 'library', label: 'Component Library', icon: LibraryIcon },
  { id: 'scenarios', label: 'Scenarios', icon: FlaskConical }
]

interface LibraryActivityRailProps {
  activeTab: LibrarySidebarTab
  onSelect: (tab: LibrarySidebarTab) => void
}

interface LibrarySidebarContentProps {
  activeTab: LibrarySidebarTab
  onLoadScenario: (scenarioId: string) => Promise<void>
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

interface ScenarioPanelProps {
  selectedScenarioId: string
  onSelectScenario: (value: string) => void
  onLoadScenario: (scenarioId: string) => Promise<void>
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
  const embeddedQuestion = parseEmbeddedIframeQuestion(questionText)

  return (
    <>
      <div className="p-4 pb-3 border-b border-nss-border shrink-0 space-y-1">
        <h2 className="text-xs font-bold text-nss-muted uppercase tracking-widest">
          Question Text
        </h2>
      </div>

      <div className="flex-1 min-h-0 p-3">
        <div className="h-full overflow-y-auto space-y-3">
          <textarea
            value={questionText}
            onChange={(event) => onQuestionTextChange(event.target.value)}
            placeholder="Paste or type the system design question here..."
            className="min-h-[220px] w-full resize-y rounded-md border border-nss-border bg-nss-input-bg p-3 text-xs leading-relaxed text-nss-text placeholder:text-nss-muted outline-none focus:border-nss-primary"
          />
          {embeddedQuestion.error && (
            <div className="rounded-md border border-nss-danger/30 bg-nss-danger/10 px-3 py-2 text-[11px] leading-relaxed text-nss-danger">
              {embeddedQuestion.error}
            </div>
          )}
          {embeddedQuestion.question && (
            <EmbeddedIframeQuestionPreview question={embeddedQuestion.question} />
          )}
        </div>
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

function ScenarioPanel({
  selectedScenarioId,
  onSelectScenario,
  onLoadScenario
}: ScenarioPanelProps) {
  const selectedScenario =
    CURATED_SCENARIOS.find((scenario) => scenario.id === selectedScenarioId) ?? CURATED_SCENARIOS[0]

  return (
    <>
      <div className="p-4 pb-3 border-b border-nss-border shrink-0 space-y-1">
        <h2 className="text-xs font-bold text-nss-muted uppercase tracking-widest">Scenarios</h2>
        <p className="text-[11px] leading-relaxed text-nss-muted">
          Curated topologies that demonstrate one simulator behaviour clearly.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div className="space-y-2">
          {CURATED_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => onSelectScenario(scenario.id)}
              className={[
                'w-full rounded-lg border p-3 text-left transition-colors',
                selectedScenario.id === scenario.id
                  ? 'border-nss-primary bg-nss-surface'
                  : 'border-nss-border bg-nss-panel hover:border-nss-primary/50'
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-nss-text">{scenario.title}</h3>
                <span className="text-[10px] uppercase tracking-wide text-nss-muted">
                  {scenario.difficulty}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">
                {scenario.description}
              </p>
            </button>
          ))}
        </div>

        {selectedScenario && (
          <div className="rounded-lg border border-nss-border bg-nss-surface p-3 space-y-3">
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-nss-text">{selectedScenario.title}</h3>
              <p className="text-[11px] leading-relaxed text-nss-muted">
                {selectedScenario.description}
              </p>
            </div>

            <div className="flex flex-wrap gap-1">
              {selectedScenario.concepts.map((concept) => (
                <span
                  key={concept}
                  className="rounded bg-nss-bg px-2 py-1 text-[10px] font-medium text-nss-muted"
                >
                  {concept}
                </span>
              ))}
            </div>

            <div className="rounded-md border border-nss-primary/20 bg-nss-primary/10 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-primary">
                What To Look At
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-nss-text">
                {selectedScenario.whatToLookAt}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void onLoadScenario(selectedScenario.id)}
              className="w-full rounded-md bg-nss-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90"
            >
              Load Scenario
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export function LibrarySidebarContent({ activeTab, onLoadScenario }: LibrarySidebarContentProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [questionText, setQuestionText] = useState('')
  const [selectedScenarioId, setSelectedScenarioId] = useState(CURATED_SCENARIOS[0]?.id ?? '')

  return (
    <aside className="h-full w-full min-w-0 bg-nss-panel border-r border-nss-border flex flex-col transition-colors duration-200">
      {activeTab === 'question' ? (
        <QuestionTextPanel questionText={questionText} onQuestionTextChange={setQuestionText} />
      ) : activeTab === 'scenarios' ? (
        <ScenarioPanel
          selectedScenarioId={selectedScenarioId}
          onSelectScenario={setSelectedScenarioId}
          onLoadScenario={onLoadScenario}
        />
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
