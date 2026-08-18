import useStore from '@renderer/store/useStore'
import { PRE_RUN_LENSES } from '@renderer/config/metricLensConfig'
import { SectionLabel, Segmented, SelectField, SettingRow, Toggle } from './SettingsControls'

const LATENCY_PERCENTILE_OPTIONS = [
  { value: 'p50', label: 'p50' },
  { value: 'p95', label: 'p95' },
  { value: 'p99', label: 'p99' }
] as const

const RESULTS_TAB_OPTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'bottlenecks', label: 'Bottlenecks' },
  { value: 'nodes', label: 'Node metrics' },
  { value: 'traffic', label: 'Traffic' }
] as const

export function DisplayTab(): React.JSX.Element {
  const profile = useStore((s) => s.environmentProfile)
  const setProfile = useStore((s) => s.setEnvironmentProfile)
  const displaySettings = useStore((s) => s.displaySettings)
  const updateDisplaySettings = useStore((s) => s.updateDisplaySettings)

  return (
    <div className="space-y-1">
      <SettingRow
        label="Theme"
        hint="The same light/dark appearance control that is also available in the header."
      >
        <Segmented
          value={displaySettings.theme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          onChange={(theme) => updateDisplaySettings((current) => ({ ...current, theme }))}
        />
      </SettingRow>

      <SettingRow
        label="Chrome density"
        hint="Controls how much of the surrounding shell stays visible while you work."
      >
        <Segmented
          value={profile.chromeDensity}
          options={[
            { value: 'full', label: 'Full' },
            { value: 'minimal', label: 'Minimal' }
          ]}
          onChange={(chromeDensity) => setProfile({ ...profile, chromeDensity })}
        />
      </SettingRow>

      <SectionLabel>Canvas</SectionLabel>

      <SettingRow
        label="Default build lens"
        hint="Which pre-run lens the canvas returns to after you clear a run or open the app."
      >
        <SelectField
          value={displaySettings.defaultMetricLens}
          options={PRE_RUN_LENSES.map((lens) => ({ value: lens.id, label: lens.label }))}
          onChange={(defaultMetricLens) =>
            updateDisplaySettings((current) => ({ ...current, defaultMetricLens }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Latency lens percentile"
        hint="Which percentile the node cards show as the headline value when the Latency lens is active."
      >
        <Segmented
          value={displaySettings.latencyLensPercentile}
          options={[...LATENCY_PERCENTILE_OPTIONS]}
          onChange={(latencyLensPercentile) =>
            updateDisplaySettings((current) => ({ ...current, latencyLensPercentile }))
          }
        />
      </SettingRow>

      <SectionLabel>Results</SectionLabel>

      <SettingRow
        label="Auto-open simulation tray"
        hint="When on, the bottom simulation tray opens automatically during a run and stays open for the final results."
      >
        <Toggle
          checked={displaySettings.autoOpenSimulationTray}
          onChange={(autoOpenSimulationTray) =>
            updateDisplaySettings((current) => ({ ...current, autoOpenSimulationTray }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Default results tab"
        hint="Which section the results tray lands on when a completed run first opens."
      >
        <SelectField
          value={displaySettings.defaultResultsTab}
          options={[...RESULTS_TAB_OPTIONS]}
          onChange={(defaultResultsTab) =>
            updateDisplaySettings((current) => ({ ...current, defaultResultsTab }))
          }
        />
      </SettingRow>
    </div>
  )
}
