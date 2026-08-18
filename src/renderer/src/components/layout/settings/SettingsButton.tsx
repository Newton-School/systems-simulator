import { useState } from 'react'
import { Settings } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { IconButton } from '../../ui/IconButton'
import { SettingsModal } from './SettingsModal'

/**
 * Header entry point for the settings modal — a gear button that owns the open
 * state, so the Header stays prop-free (same self-contained pattern as CostChip
 * and ThemeToggle). Hidden in ASSIGNMENT mode: that surface is for author/
 * sandbox configuration, not graded student attempts.
 */
export function SettingsButton(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const mode = useStore((s) => s.environmentProfile.mode)

  if (mode === 'ASSIGNMENT') {
    return null
  }

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        icon={<Settings size={18} />}
        label="Settings"
        aria-haspopup="dialog"
      />
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  )
}
