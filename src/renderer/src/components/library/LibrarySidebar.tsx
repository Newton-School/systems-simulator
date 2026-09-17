import { lazy, memo, Suspense, useState } from 'react'
import {
  Beaker,
  FileText,
  FlaskConical,
  ClipboardList,
  Keyboard,
  Library as LibraryIcon,
  type LucideIcon
} from 'lucide-react'
import type { ExperienceEnvelope, ExperienceSidebarTab } from '@renderer/utils/experienceEnvelope'
import { SettingsButton } from '../layout/settings/SettingsButton'
import type { ComponentLibraryFilter } from './ComponentLibrarySidebarPanel'

export type LibrarySidebarTab = ExperienceSidebarTab

interface ActivityTab {
  id: LibrarySidebarTab
  label: string
  icon: LucideIcon
  shortcutIndex: number
}

const TAB_META: Record<LibrarySidebarTab, Omit<ActivityTab, 'id' | 'shortcutIndex'>> = {
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
  onShowShortcuts: () => void
  settingsOpenRequestVersion?: number
}

interface LibrarySidebarContentProps {
  activeTab: LibrarySidebarTab
  onLoadScenario: (scenarioId: string) => Promise<void>
  focusSearchVersion?: number
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
      title={`${tab.label} (Cmd/Ctrl+${tab.shortcutIndex})`}
      aria-label={`${tab.label}, shortcut Cmd or Ctrl plus ${tab.shortcutIndex}`}
      aria-pressed={isActive}
      className={`nss-touch-target group relative h-10 w-10 rounded-md flex items-center justify-center transition-colors ${
        isActive
          ? 'bg-nss-surface text-nss-text'
          : 'text-nss-muted hover:text-nss-text hover:bg-nss-surface'
      }`}
    >
      {isActive && (
        <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-nss-primary" />
      )}
      <Icon size={18} />
      <span className="absolute bottom-0.5 right-1 font-mono text-[7px] font-medium leading-none text-nss-muted opacity-25 transition-opacity group-hover:opacity-60">
        {tab.shortcutIndex}
      </span>
    </button>
  )
})

export const LibraryActivityRail = memo(function LibraryActivityRail({
  activeTab,
  experience,
  onSelect,
  onShowShortcuts,
  settingsOpenRequestVersion = 0
}: LibraryActivityRailProps) {
  const tabs = experience.allowedTabs.map((id, index) => ({
    id,
    label: id === 'question' ? experience.questionTabLabel : TAB_META[id].label,
    icon: TAB_META[id].icon,
    shortcutIndex: index + 1
  }))

  return (
    <nav
      aria-label="Library views"
      className="nss-activity-rail h-full min-h-0 w-12 shrink-0 bg-nss-bg border-r border-nss-border flex flex-col items-center py-2 gap-1 overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden">
        {tabs.map((tab) => (
          <ActivityButton key={tab.id} tab={tab} activeTab={activeTab} onSelect={onSelect} />
        ))}
      </div>

      {/* Utility actions — pinned to the bottom of the rail, below the tabs. */}
      <div className="mt-auto flex shrink-0 flex-col items-center gap-1">
        <button
          type="button"
          onClick={onShowShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          aria-haspopup="dialog"
          className="nss-touch-target h-10 w-10 rounded-md flex items-center justify-center text-nss-muted transition-colors hover:text-nss-text hover:bg-nss-surface"
        >
          <Keyboard size={18} />
        </button>
        <SettingsButton openRequestVersion={settingsOpenRequestVersion} />
      </div>
    </nav>
  )
})

export function LibrarySidebarContent({
  activeTab,
  onLoadScenario,
  focusSearchVersion = 0
}: LibrarySidebarContentProps) {
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
              focusSearchVersion={focusSearchVersion}
            />
          </div>
        </Suspense>
      ) : null}
    </aside>
  )
}
