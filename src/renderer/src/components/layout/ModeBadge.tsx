import { Beaker, FlaskConical, GraduationCap, MessageSquare } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { resolveExperienceEnvelope, type ExperienceKind } from '@renderer/utils/experienceEnvelope'

/**
 * Header pill showing the active shell-level experience mode. The simulator's
 * environment profile still exists underneath, but the badge is intentionally
 * product-facing: it tells the learner whether they are in the free sandbox,
 * an assignment wrapper, an interview wrapper, or a locked lab.
 */
const MODE_META: Record<
  ExperienceKind,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }
> = {
  SANDBOX: {
    label: 'Sandbox',
    icon: FlaskConical,
    tone: 'border-nss-success/40 text-nss-success bg-nss-success/10'
  },
  ASSIGNMENT: {
    label: 'Assignment',
    icon: GraduationCap,
    tone: 'border-nss-warning/40 text-nss-warning bg-nss-warning/10'
  },
  INTERVIEW: {
    label: 'Interview',
    icon: MessageSquare,
    tone: 'border-nss-primary/40 text-nss-primary bg-nss-primary/10'
  },
  LAB: {
    label: 'Lab',
    icon: Beaker,
    tone: 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10'
  }
}

export function ModeBadge(): React.JSX.Element {
  const environmentProfile = useStore((s) => s.environmentProfile)
  const activeQuestion = useStore((s) => s.activeQuestion)
  const experience = resolveExperienceEnvelope(environmentProfile, activeQuestion)
  const meta = MODE_META[experience.kind]
  const Icon = meta.icon
  return (
    <span
      title={`Experience: ${meta.label} · Environment preset: ${environmentProfile.mode}`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  )
}
