import useStore from '@renderer/store/useStore'
import {
  resolveEnvironmentProfile,
  type EnvironmentProfileMode
} from '../../../../../engine/analysis/environmentProfile'
import { OptionalNumber, Segmented, SettingRow, Toggle } from './SettingsControls'
import { patchCapabilities, patchVisibility } from './settingsTypes'

/**
 * Environments tab — the instructor-facing control surface for the deployed
 * environment. Reads/writes the live `environmentProfile` in the store. Every
 * control here maps to a capability the engine already honors (edge model, edit
 * locks, budgets, test-run limits, rubric visibility) — this tab just gives them
 * a UI instead of a host-supplied launch payload. Switching the mode preset
 * resets everything to that preset's defaults; individual toggles then override.
 */
const MODE_OPTIONS: Array<{ value: EnvironmentProfileMode; label: string }> = [
  { value: 'AUTHOR', label: 'Author' },
  { value: 'ASSIGNMENT', label: 'Assignment' },
  { value: 'PRACTICE', label: 'Practice' }
]

export function EnvironmentsTab(): React.JSX.Element {
  const profile = useStore((s) => s.environmentProfile)
  const setProfile = useStore((s) => s.setEnvironmentProfile)
  const caps = profile.capabilities
  const isConnector = caps.edgeModel === 'connector'

  return (
    <div className="space-y-1">
      <SettingRow
        label="Mode preset"
        hint="Author = full control · Assignment = graded/locked · Practice = free sandbox. Picking a preset resets the options below to that preset's defaults."
      >
        <Segmented
          value={profile.mode}
          options={MODE_OPTIONS}
          onChange={(mode) => setProfile(resolveEnvironmentProfile(mode))}
        />
      </SettingRow>

      <SectionLabel>Edges</SectionLabel>

      <SettingRow
        label="Edge model"
        hint="Network = edges carry latency/bandwidth and can be inspected. Connector = dumb wires that only show how components connect (no physics, no cost, no properties) so students focus on the high-level design."
      >
        <Segmented
          value={caps.edgeModel}
          options={[
            { value: 'network', label: 'Network' },
            { value: 'connector', label: 'Connector' }
          ]}
          onChange={(edgeModel) => setProfile(patchCapabilities(profile, { edgeModel }))}
        />
      </SettingRow>

      <SettingRow
        label="Students can edit edge properties"
        hint={
          isConnector
            ? 'Only applies in Network mode — connector edges have nothing to edit.'
            : 'When off, edges still affect the simulation but their bandwidth/latency are locked.'
        }
        disabled={isConnector}
      >
        <Toggle
          checked={caps.canEditEdges}
          disabled={isConnector}
          onChange={(canEditEdges) => setProfile(patchCapabilities(profile, { canEditEdges }))}
        />
      </SettingRow>

      <SectionLabel>Resources & budget</SectionLabel>

      <SettingRow
        label="Students can change resource allocation"
        hint="Instance type, count, and workload kind. Off in graded assignments unless the lesson is allocation itself."
      >
        <Toggle
          checked={caps.canEditResources}
          onChange={(canEditResources) =>
            setProfile(patchCapabilities(profile, { canEditResources }))
          }
        />
      </SettingRow>

      <SettingRow
        label="Cost cap"
        hint="Max provisioned spend for the whole topology. Empty = unbounded."
      >
        <OptionalNumber
          value={caps.costBudget?.maxPerHour}
          suffix="$/hr"
          step={0.01}
          onChange={(maxPerHour) =>
            setProfile(
              patchCapabilities(profile, {
                costBudget: maxPerHour === undefined ? undefined : { maxPerHour }
              })
            )
          }
        />
      </SettingRow>

      <SettingRow
        label="vCPU quota"
        hint="Total vCPU the topology may provision. Empty = unbounded."
      >
        <OptionalNumber
          value={caps.resourceBudget?.totalVcpu}
          suffix="vCPU"
          onChange={(totalVcpu) =>
            setProfile(
              patchCapabilities(profile, {
                resourceBudget:
                  totalVcpu === undefined
                    ? undefined
                    : { totalVcpu, totalRamGb: caps.resourceBudget?.totalRamGb ?? 0 }
              })
            )
          }
        />
      </SettingRow>

      <SettingRow label="RAM quota" hint="Total RAM the topology may provision. Empty = unbounded.">
        <OptionalNumber
          value={caps.resourceBudget?.totalRamGb}
          suffix="GB"
          onChange={(totalRamGb) =>
            setProfile(
              patchCapabilities(profile, {
                resourceBudget:
                  totalRamGb === undefined
                    ? undefined
                    : { totalVcpu: caps.resourceBudget?.totalVcpu ?? 0, totalRamGb }
              })
            )
          }
        />
      </SettingRow>

      <SectionLabel>Grading flow</SectionLabel>

      <SettingRow
        label="Test-run limit"
        hint="Max dry runs a student may trigger. Empty = unlimited."
      >
        <OptionalNumber
          value={caps.maxTestRuns}
          suffix="runs"
          min={1}
          onChange={(maxTestRuns) => setProfile(patchCapabilities(profile, { maxTestRuns }))}
        />
      </SettingRow>

      <SettingRow label="Rubric check visibility" hint="When students see grading-check results.">
        <div className="flex items-center gap-1.5">
          <select
            value={profile.visibility.rubricChecks}
            onChange={(e) =>
              setProfile(
                patchVisibility(profile, {
                  rubricChecks: e.target.value as typeof profile.visibility.rubricChecks
                })
              )
            }
            className="rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-[11px] text-nss-text focus:border-nss-info focus:outline-none focus:ring-1 focus:ring-nss-info"
          >
            <option value="LIVE_DURING_BUILD">Live while building</option>
            <option value="POST_SUBMIT_ONLY">After submit only</option>
            <option value="HIDDEN">Hidden</option>
          </select>
          {/* Empty unit spacer so the select's right edge lines up with the number inputs. */}
          <span className="w-10 shrink-0" />
        </div>
      </SettingRow>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-4 mb-1 border-t border-nss-border/60 pt-3 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
      {children}
    </div>
  )
}
