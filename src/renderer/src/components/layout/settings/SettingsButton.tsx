import { useState } from 'react'
import { Settings } from 'lucide-react'
import { IconButton } from '../../ui/IconButton'
import { SettingsModal } from './SettingsModal'

/**
 * Header entry point for the settings modal — a gear button that owns the open
 * state, so the Header stays prop-free (same self-contained pattern as CostChip
 * and ThemeToggle).
 */
export function SettingsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
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
