import { FilePenLine, GraduationCap, LibraryBig } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import type { EnvironmentProfileMode } from '../../../../engine/analysis/environmentProfile'

/**
 * Header pill showing the active shell-level experience mode. The simulator's
 * environment profile still exists underneath, but the badge is intentionally
 * product-facing: it tells the learner whether they are in the free sandbox,
 * an assignment wrapper, an interview wrapper, or a locked lab.
 */
const MODE_META: Record<
  EnvironmentProfileMode,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }
> = {
  AUTHOR: {
    label: 'Author',
    icon: FilePenLine,
    tone: 'border-nss-success/40 text-nss-success bg-nss-success/10'
  },
  ASSIGNMENT: {
    label: 'Assignment',
    icon: GraduationCap,
    tone: 'border-nss-warning/40 text-nss-warning bg-nss-warning/10'
  },
  PRACTICE: {
    label: 'Practice',
    icon: LibraryBig,
    tone: 'border-nss-primary/40 text-nss-primary bg-nss-primary/10'
  }
}

export function ModeBadge(): React.JSX.Element {
  const environmentProfile = useStore((s) => s.environmentProfile)
  const meta = MODE_META[environmentProfile.mode]
  const Icon = meta.icon
  return (
    <span
      title={`Mode: ${meta.label}`}
      className={`nss-mode-badge flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  )
}
