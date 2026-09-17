import { lazy, Suspense, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import useStore from '@renderer/store/useStore'

const SettingsModal = lazy(async () => {
  const module = await import('./SettingsModal')
  return { default: module.SettingsModal }
})

/**
 * Header entry point for the settings modal. The button owns the modal state,
 * while an incrementing request lets the workspace open it from Cmd/Ctrl+,.
 * Hidden in ASSIGNMENT mode: that surface is for author/sandbox configuration,
 * not graded student attempts.
 */
export function SettingsButton({
  openRequestVersion = 0
}: {
  openRequestVersion?: number
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const mode = useStore((s) => s.environmentProfile.mode)

  useEffect(() => {
    if (mode === 'ASSIGNMENT') {
      setOpen(false)
      return
    }

    if (openRequestVersion > 0) {
      setOpen(true)
    }
  }, [mode, openRequestVersion])

  if (mode === 'ASSIGNMENT') {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Settings (Cmd/Ctrl+,)"
        aria-label="Settings"
        aria-haspopup="dialog"
        className="nss-touch-target h-10 w-10 rounded-md flex items-center justify-center text-nss-muted transition-colors hover:text-nss-text hover:bg-nss-surface"
      >
        <Settings size={18} />
      </button>
      {open ? (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
