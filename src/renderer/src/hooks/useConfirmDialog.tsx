import { useCallback, useEffect, useRef, useState } from 'react'

type ConfirmDialogOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}

type ConfirmDialogState = Required<ConfirmDialogOptions>

interface ConfirmDialogProps extends ConfirmDialogState {
  onConfirm: () => void
  onCancel: () => void
}

const defaultOptions = {
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel'
} satisfies Pick<ConfirmDialogState, 'confirmLabel' | 'cancelLabel'>

const ConfirmDialog = ({
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}: ConfirmDialogProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="w-full max-w-md rounded-2xl border border-nss-border bg-nss-panel p-6 shadow-2xl shadow-slate-950/20"
      >
        <div className="space-y-2">
          <p
            id="confirm-dialog-title"
            className="text-sm font-semibold uppercase tracking-[0.2em] text-nss-warning"
          >
            {title}
          </p>
          <p id="confirm-dialog-description" className="text-sm leading-6 text-nss-text/80">
            {description}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-nss-border bg-nss-surface px-4 py-2 text-sm font-medium text-nss-text transition-colors hover:border-nss-border-high hover:bg-nss-bg focus:outline-none focus:ring-2 focus:ring-nss-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export const useConfirmDialog = () => {
  const [dialogState, setDialogState] = useState<ConfirmDialogState | null>(null)
  const resolverRef = useRef<((result: boolean) => void) | null>(null)

  const settle = useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setDialogState(null)
  }, [])

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    resolverRef.current?.(false)

    setDialogState({
      ...defaultOptions,
      ...options
    })

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  useEffect(() => {
    return () => {
      resolverRef.current?.(false)
      resolverRef.current = null
    }
  }, [])

  return {
    confirm,
    dialog: dialogState ? (
      <ConfirmDialog {...dialogState} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
    ) : null
  }
}
