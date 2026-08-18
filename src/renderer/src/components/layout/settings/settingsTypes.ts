import type { EnvironmentProfile } from '../../../../../engine/analysis/environmentProfile'

export type SettingsTabId = 'environments' | 'simulation' | 'display'

export interface SettingsTabDef {
  id: SettingsTabId
  label: string
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'environments', label: 'Environments' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'display', label: 'Display' }
]

/** Immutably merge a capability patch onto a profile (nested `capabilities`). */
export function patchCapabilities(
  profile: EnvironmentProfile,
  patch: Partial<EnvironmentProfile['capabilities']>
): EnvironmentProfile {
  return { ...profile, capabilities: { ...profile.capabilities, ...patch } }
}

/** Immutably merge a visibility patch onto a profile. */
export function patchVisibility(
  profile: EnvironmentProfile,
  patch: Partial<EnvironmentProfile['visibility']>
): EnvironmentProfile {
  return { ...profile, visibility: { ...profile.visibility, ...patch } }
}
