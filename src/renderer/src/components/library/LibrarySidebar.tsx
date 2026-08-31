import { lazy, memo, Suspense, useState } from 'react'
import {
  Beaker,
  FileText,
  FlaskConical,
  ClipboardList,
  Library as LibraryIcon,
  type LucideIcon
} from 'lucide-react'
import type { ExperienceEnvelope, ExperienceSidebarTab } from '@renderer/utils/experienceEnvelope'
import type { ComponentLibraryFilter } from './ComponentLibrarySidebarPanel'

export type LibrarySidebarTab = ExperienceSidebarTab

interface ActivityTab {
  id: LibrarySidebarTab
  label: string
  icon: LucideIcon
}

const TAB_META: Record<LibrarySidebarTab, Omit<ActivityTab, 'id'>> = {
  question: { label: 'Question Text', icon: FileText },
  blueprints: { label: 'Blueprints', icon: ClipboardList },
  labs: { label: 'Labs', icon: Beaker },
  library: { label: 'Component Library', icon: LibraryIcon },
  scenarios: { label: 'Scenarios', icon: FlaskConical }
}

interface LibraryActivityRailProps {
  activeTab: LibrarySidebarTab
  experience: ExperienceEnvelope
  onSelect: (tab: LibrarySidebarTab) => void
}

interface LibrarySidebarContentProps {
  activeTab: LibrarySidebarTab
  onLoadScenario: (scenarioId: string) => Promise<void>
}

const QuestionPanel = lazy(async () => {
  const module = await import('../question/QuestionPanel')
  return { default: module.QuestionPanel }
})

const ComponentLibrarySidebarPanel = lazy(async () => {
  const module = await import('./ComponentLibrarySidebarPanel')
  return { default: module.ComponentLibrarySidebarPanel }
})

const BlueprintSidebarPanel = lazy(async () => {
  const module = await import('./BlueprintSidebarPanel')
  return { default: module.BlueprintSidebarPanel }
})

const LabSidebarPanel = lazy(async () => {
  const module = await import('./LabSidebarPanel')
  return { default: module.LabSidebarPanel }
})

const ScenarioSidebarPanel = lazy(async () => {
  const module = await import('./ScenarioSidebarPanel')
  return { default: module.ScenarioSidebarPanel }
})

function SidebarPanelFallback(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-4 text-xs text-nss-muted">
      Loading panel…
    </div>
  )
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
  experience,
  onSelect
}: LibraryActivityRailProps) {
  const tabs = experience.allowedTabs.map((id) => ({
    id,
    label: id === 'question' ? experience.questionTabLabel : TAB_META[id].label,
    icon: TAB_META[id].icon
  }))

  return (
    <nav
      aria-label="Library views"
      className="h-full w-12 shrink-0 bg-nss-bg border-r border-nss-border flex flex-col items-center py-2 gap-1"
    >
      {tabs.map((tab) => (
        <ActivityButton key={tab.id} tab={tab} activeTab={activeTab} onSelect={onSelect} />
      ))}
    </nav>
  )
})

export function LibrarySidebarContent({ activeTab, onLoadScenario }: LibrarySidebarContentProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ComponentLibraryFilter>('all')

  return (
    <aside className="h-full w-full min-w-0 bg-nss-panel border-r border-nss-border flex flex-col transition-colors duration-200">
      {activeTab === 'question' ? (
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <QuestionPanel />
          </div>
        </Suspense>
      ) : null}

      {activeTab === 'blueprints' ? (
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <BlueprintSidebarPanel />
          </div>
        </Suspense>
      ) : null}

      {activeTab === 'labs' ? (
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <LabSidebarPanel />
          </div>
        </Suspense>
      ) : null}

      {activeTab === 'scenarios' ? (
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <ScenarioSidebarPanel onLoadScenario={onLoadScenario} />
          </div>
        </Suspense>
      ) : null}

      {activeTab === 'library' ? (
        <Suspense fallback={<SidebarPanelFallback />}>
          <div className="flex h-full min-h-0 flex-col">
            <ComponentLibrarySidebarPanel
              query={query}
              filter={filter}
              onQueryChange={setQuery}
              onFilterChange={setFilter}
            />
          </div>
        </Suspense>
      ) : null}
    </aside>
  )
}
