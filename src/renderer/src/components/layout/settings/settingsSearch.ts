import { CATALOG_CONFIG } from '@renderer/config/catalogConfig'
import type { SettingsTabId } from './settingsTypes'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTabId
  title: string
  description: string
  keywords?: string
  targetId: string
}

const STATIC_SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    id: 'environment-mode',
    tab: 'environments',
    title: 'Mode preset',
    description: 'Choose Author, Assignment, or Practice mode.',
    keywords: 'environment profile graded locked sandbox',
    targetId: 'settings-environment-mode'
  },
  {
    id: 'environment-edge-model',
    tab: 'environments',
    title: 'Edge model',
    description: 'Choose simulated network edges or simple connector wires.',
    keywords: 'connector network physics cost properties',
    targetId: 'settings-environment-edge-model'
  },
  {
    id: 'environment-edit-edges',
    tab: 'environments',
    title: 'Edit edge properties',
    description: 'Allow or lock changes to edge bandwidth and latency.',
    keywords: 'network bandwidth latency lock',
    targetId: 'settings-environment-edit-edges'
  },
  {
    id: 'environment-resources',
    tab: 'environments',
    title: 'Change resource allocation',
    description: 'Allow changes to instance type and count.',
    keywords: 'instance workers replicas allocation',
    targetId: 'settings-environment-resources'
  },
  {
    id: 'environment-execution-profile',
    tab: 'environments',
    title: 'Change execution profile',
    description: 'Expose CPU-bound and IO-bound component behavior.',
    keywords: 'cpu io concurrency advanced',
    targetId: 'settings-environment-execution-profile'
  },
  {
    id: 'environment-cost-cap',
    tab: 'environments',
    title: 'Cost cap',
    description: 'Limit provisioned spend for the topology.',
    keywords: 'budget price dollars per hour',
    targetId: 'settings-environment-cost-cap'
  },
  {
    id: 'environment-vcpu',
    tab: 'environments',
    title: 'vCPU quota',
    description: 'Limit the total virtual CPUs the topology may provision.',
    keywords: 'resource budget processor cpu',
    targetId: 'settings-environment-vcpu'
  },
  {
    id: 'environment-ram',
    tab: 'environments',
    title: 'RAM quota',
    description: 'Limit the total memory the topology may provision.',
    keywords: 'resource budget memory gb',
    targetId: 'settings-environment-ram'
  },
  {
    id: 'environment-test-runs',
    tab: 'environments',
    title: 'Test-run limit',
    description: 'Set the maximum number of dry runs.',
    keywords: 'grading assignment attempts maximum',
    targetId: 'settings-environment-test-runs'
  },
  {
    id: 'environment-rubric',
    tab: 'environments',
    title: 'Rubric check visibility',
    description: 'Control when grading-check results are shown.',
    keywords: 'live build submit hidden assignment',
    targetId: 'settings-environment-rubric'
  },
  {
    id: 'simulation-duration',
    tab: 'simulation',
    title: 'Run duration',
    description: 'Set how long the simulated clock runs.',
    keywords: 'simulation time seconds',
    targetId: 'settings-simulation-duration'
  },
  {
    id: 'simulation-warmup',
    tab: 'simulation',
    title: 'Warmup duration',
    description: 'Exclude initial warmup traffic from final metrics.',
    keywords: 'simulation time seconds metrics',
    targetId: 'settings-simulation-warmup'
  },
  {
    id: 'simulation-seed',
    tab: 'simulation',
    title: 'Seed and deterministic replay',
    description: 'Set the seed or generate a new seed for every run.',
    keywords: 'randomize reproducibility deterministic',
    targetId: 'settings-simulation-seed'
  },
  {
    id: 'simulation-source',
    tab: 'simulation',
    title: 'Source node',
    description: 'Choose which component generates the workload.',
    keywords: 'traffic client workload auto',
    targetId: 'settings-simulation-source'
  },
  {
    id: 'simulation-pattern',
    tab: 'simulation',
    title: 'Workload pattern',
    description: 'Choose the default traffic arrival shape.',
    keywords: 'constant burst spike sawtooth poisson traffic',
    targetId: 'settings-simulation-pattern'
  },
  {
    id: 'simulation-rps',
    tab: 'simulation',
    title: 'Base RPS',
    description: 'Set the steady-state offered request rate.',
    keywords: 'requests per second traffic workload rate',
    targetId: 'settings-simulation-rps'
  },
  {
    id: 'simulation-fault',
    tab: 'simulation',
    title: 'Fault and chaos defaults',
    description: 'Configure fault injection, target, mode, timing, degradation, and recovery.',
    keywords: 'inject failure blackhole degraded slowdown fail at recover after duration target',
    targetId: 'settings-simulation-fault'
  },
  {
    id: 'library-palette',
    tab: 'library',
    title: 'Palette visibility',
    description: 'Choose which component catalogue is available in the sidebar.',
    keywords: 'component library hide show defaults all',
    targetId: 'settings-library-palette'
  },
  {
    id: 'display-theme',
    tab: 'display',
    title: 'Theme',
    description: 'Switch between the light and dark appearance.',
    keywords: 'color mode appearance',
    targetId: 'settings-display-theme'
  },
  {
    id: 'display-density',
    tab: 'display',
    title: 'Chrome density',
    description: 'Choose how much of the surrounding application shell is visible.',
    keywords: 'full minimal interface ui',
    targetId: 'settings-display-density'
  },
  {
    id: 'display-edge-path',
    tab: 'display',
    title: 'Edge path',
    description: 'Set the default routing style for edges and request traces.',
    keywords: 'straight rounded smoothstep connector route canvas',
    targetId: 'settings-display-edge-path'
  },
  {
    id: 'display-lens',
    tab: 'display',
    title: 'Default build lens',
    description: 'Choose the metric lens shown before a run.',
    keywords:
      'traffic saturation latency errors throughput instance concurrency queue timeout cost',
    targetId: 'settings-display-lens'
  },
  {
    id: 'display-percentile',
    tab: 'display',
    title: 'Latency lens percentile',
    description: 'Choose p50, p95, or p99 for node latency cards.',
    keywords: 'metric lens response time',
    targetId: 'settings-display-percentile'
  },
  {
    id: 'display-spof',
    tab: 'display',
    title: 'Single point of failure badges',
    description: 'Show SPOF badges and warning rings on affected nodes.',
    keywords: 'spof resilience warning canvas',
    targetId: 'settings-display-spof'
  },
  {
    id: 'display-request-dots',
    tab: 'display',
    title: 'Color request dots by key',
    description: 'Color animated edge traffic using affinity or partition keys.',
    keywords: 'shard sticky routing animation traffic',
    targetId: 'settings-display-request-dots'
  },
  {
    id: 'display-results-open',
    tab: 'display',
    title: 'Auto-open simulation tray',
    description: 'Open the results tray automatically when a run starts.',
    keywords: 'results run panel bottom',
    targetId: 'settings-display-results-open'
  },
  {
    id: 'display-results-tab',
    tab: 'display',
    title: 'Default results tab',
    description: 'Choose the first results section shown after a run.',
    keywords: 'overview bottlenecks node metrics traffic',
    targetId: 'settings-display-results-tab'
  },
  {
    id: 'llm-grading',
    tab: 'llm-grading',
    title: 'Justification grading',
    description: 'Configure semantic LLM grading for written explanations.',
    keywords: 'ai key provider openai anthropic claude google gemini deterministic',
    targetId: 'settings-llm-grading'
  },
  {
    id: 'llm-provider',
    tab: 'llm-grading',
    title: 'LLM provider and API key',
    description: 'Choose a provider and use a key for this app session.',
    keywords: 'openai anthropic claude google gemini secret clear session',
    targetId: 'settings-llm-provider'
  }
]

const COMPONENT_LIBRARY_SEARCH_ENTRIES: SettingsSearchEntry[] = CATALOG_CONFIG.flatMap(
  (category) => [
    {
      id: `library-category-${category.id}`,
      tab: 'library' as const,
      title: category.title,
      description: `Show or hide the ${category.title} component category.`,
      keywords: category.items.map((item) => `${item.label} ${item.subLabel}`).join(' '),
      targetId: `settings-library-category-${category.id}`
    },
    ...category.items.map((item) => ({
      id: `library-component-${item.id}`,
      tab: 'library' as const,
      title: item.label,
      description: item.subLabel || `Configure ${item.label} visibility in the component library.`,
      keywords: `${category.title} component palette ${item.id}`,
      targetId: `settings-library-category-${category.id}`
    }))
  ]
)

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  ...STATIC_SETTINGS_SEARCH_ENTRIES,
  ...COMPONENT_LIBRARY_SEARCH_ENTRIES
]

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function searchSettings(query: string): SettingsSearchEntry[] {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  return SETTINGS_SEARCH_ENTRIES.filter((entry) => {
    const haystack = normalizeSearchText(
      `${entry.title} ${entry.description} ${entry.keywords ?? ''}`
    )
    return terms.every((term) => haystack.includes(term))
  }).sort((left, right) => {
    const normalizedQuery = normalizeSearchText(query)
    const leftStarts = normalizeSearchText(left.title).startsWith(normalizedQuery)
    const rightStarts = normalizeSearchText(right.title).startsWith(normalizedQuery)
    if (leftStarts !== rightStarts) return leftStarts ? -1 : 1
    return left.title.localeCompare(right.title)
  })
}
