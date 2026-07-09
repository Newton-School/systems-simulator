import { X } from 'lucide-react'

interface RunToastProps {
  messages: string[]
  tone: 'error' | 'warning'
  onClose: () => void
}

export function RunToast({ messages, tone, onClose }: RunToastProps) {
  const isError = tone === 'error'

  return (
    <div
      role="alert"
      className={`
        fixed top-14 right-4 z-50 w-[28rem] max-w-[calc(100vw-2rem)] rounded-lg border shadow-2xl font-sans text-sm
        ${
          isError
            ? 'bg-nss-panel border-nss-danger/40 text-nss-text'
            : 'bg-nss-panel border-nss-warning/40 text-nss-text'
        }
      `}
    >
      {/* Header bar */}
      <div
        className={`
          flex items-center justify-between px-3 py-2 rounded-t-lg border-b
          ${
            isError
              ? 'bg-nss-danger/10 border-nss-danger/20 text-nss-danger'
              : 'bg-nss-warning/10 border-nss-warning/20 text-nss-warning'
          }
        `}
      >
        <span className="font-semibold uppercase tracking-[0.2em] text-[11px]">
          {isError ? 'Run blocked' : 'Run warning'}
        </span>
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
        >
          <X size={13} />
        </button>
      </div>

      {/* Message list */}
      <ul className="max-h-[60vh] overflow-y-auto px-4 py-3 space-y-2 text-nss-text/95">
        {messages.map((msg, i) => (
          <li key={i} className="flex gap-2.5 leading-6">
            <span
              className={`mt-0.5 shrink-0 text-base ${isError ? 'text-nss-danger' : 'text-nss-warning'}`}
            >
              •
            </span>
            {msg}
          </li>
        ))}
      </ul>
    </div>
  )
}
