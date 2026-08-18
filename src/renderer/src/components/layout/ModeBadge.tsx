import { PencilRuler, GraduationCap, FlaskConical } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import type { EnvironmentProfileMode } from '../../../../engine/analysis/environmentProfile'

/**
 * Header pill showing the active environment mode — the "you are in X mode"
 * affordance (like Google Docs' Editing / Suggesting / Viewing chip). Read-only
 * indicator; the mode is changed from Settings → Environments.
 */
const MODE_META: Record<
  EnvironmentProfileMode,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }
> = {
  AUTHOR: {
    label: 'Authoring',
    icon: PencilRuler,
    tone: 'border-nss-primary/40 text-nss-primary bg-nss-primary/10'
  },
  ASSIGNMENT: {
    label: 'Assignment',
    icon: GraduationCap,
    tone: 'border-nss-warning/40 text-nss-warning bg-nss-warning/10'
  },
  PRACTICE: {
    label: 'Practice',
    icon: FlaskConical,
    tone: 'border-nss-success/40 text-nss-success bg-nss-success/10'
  }
}

export function ModeBadge(): React.JSX.Element {
  const mode = useStore((s) => s.environmentProfile.mode)
  const meta = MODE_META[mode]
  const Icon = meta.icon
  return (
    <span
      title={`Environment: ${meta.label} · change in Settings → Environments`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  )
}
