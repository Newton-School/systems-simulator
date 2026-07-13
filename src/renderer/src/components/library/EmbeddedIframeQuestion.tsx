import { useEffect, useMemo, useRef, useState } from 'react'

export interface EmbeddedIframeQuestion {
  type: 'embedded-iframe'
  title?: string
  prompt?: string
  url: string
  height?: number
  allowFullscreen?: boolean
  launchParameters?: Record<string, unknown>
  allowedOrigins?: string[]
}

type FrameStatus = 'idle' | 'loading' | 'ready' | 'error'

export function parseEmbeddedIframeQuestion(input: string): {
  question: EmbeddedIframeQuestion | null
  error: string | null
} {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { question: null, error: null }
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<EmbeddedIframeQuestion>
    if (parsed.type !== 'embedded-iframe') {
      return { question: null, error: null }
    }

    if (typeof parsed.url !== 'string' || parsed.url.trim().length === 0) {
      return { question: null, error: 'Embedded iframe questions require a non-empty url.' }
    }

    let origin: URL
    try {
      origin = new URL(parsed.url)
    } catch {
      return { question: null, error: 'Embedded iframe question url must be a valid absolute URL.' }
    }

    if (!['http:', 'https:'].includes(origin.protocol)) {
      return { question: null, error: 'Embedded iframe question url must use http or https.' }
    }

    return {
      question: {
        type: 'embedded-iframe',
        url: parsed.url,
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        prompt: typeof parsed.prompt === 'string' ? parsed.prompt : undefined,
        height:
          typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 200
            ? parsed.height
            : 420,
        allowFullscreen: parsed.allowFullscreen !== false,
        launchParameters:
          parsed.launchParameters && typeof parsed.launchParameters === 'object'
            ? parsed.launchParameters
            : {},
        allowedOrigins:
          Array.isArray(parsed.allowedOrigins) && parsed.allowedOrigins.every((item) => typeof item === 'string')
            ? parsed.allowedOrigins
            : [origin.origin]
      },
      error: null
    }
  } catch {
    return { question: null, error: null }
  }
}

export function EmbeddedIframeQuestionPreview({ question }: { question: EmbeddedIframeQuestion }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<FrameStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('Waiting for the embedded app to load.')

  const allowedOrigins = useMemo(() => {
    const unique = new Set<string>()
    for (const origin of question.allowedOrigins ?? []) {
      unique.add(origin)
    }
    return unique
  }, [question.allowedOrigins])

  useEffect(() => {
    setStatus('loading')
    setStatusMessage('Loading embedded assignment…')

    const timeout = window.setTimeout(() => {
      setStatus((current) => (current === 'ready' ? current : 'error'))
      setStatusMessage(
        'The iframe loaded but never completed the postMessage handshake. Check allowedOrigins and that the embedded app responds with "ns-simulator:ready".'
      )
    }, 4_000)

    const onMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) {
        return
      }

      if (!event.data || typeof event.data !== 'object') {
        return
      }

      const type = (event.data as { type?: unknown }).type
      if (type === 'ns-simulator:ready') {
        window.clearTimeout(timeout)
        setStatus('ready')
        setStatusMessage('Handshake complete. The embedded app is ready.')
      } else if (type === 'ns-simulator:error') {
        window.clearTimeout(timeout)
        setStatus('error')
        const detail = (event.data as { message?: unknown }).message
        setStatusMessage(
          typeof detail === 'string' && detail.length > 0
            ? detail
            : 'The embedded app reported an error.'
        )
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('message', onMessage)
    }
  }, [allowedOrigins, question])

  const handleLoad = () => {
    setStatus('loading')
    setStatusMessage('Iframe loaded. Waiting for handshake…')
    const targetOrigin = new URL(question.url).origin
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'ns-simulator:launch-context',
        payload: {
          source: 'question-panel',
          launchParameters: question.launchParameters ?? {}
        }
      },
      targetOrigin
    )
  }

  const handleError = () => {
    setStatus('error')
    setStatusMessage(
      'Could not load the embedded simulation. Check that the URL is reachable and allows iframe embedding.'
    )
  }

  const openFullscreen = async () => {
    if (!containerRef.current || !question.allowFullscreen) {
      return
    }
    try {
      await containerRef.current.requestFullscreen()
    } catch {
      setStatus('error')
      setStatusMessage('Fullscreen failed. The browser blocked the request or the iframe disallows it.')
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-nss-border bg-nss-surface p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-xs font-semibold text-nss-text">
            {question.title ?? 'Embedded Assignment'}
          </h3>
          {question.prompt && (
            <p className="text-[11px] leading-relaxed text-nss-muted">{question.prompt}</p>
          )}
        </div>
        {question.allowFullscreen && (
          <button
            type="button"
            onClick={openFullscreen}
            className="shrink-0 rounded border border-nss-border px-2 py-1 text-[11px] font-semibold text-nss-text hover:border-nss-primary"
          >
            Fullscreen
          </button>
        )}
      </div>

      <div
        className={[
          'rounded border px-2.5 py-2 text-[11px]',
          status === 'ready'
            ? 'border-nss-success/30 bg-nss-success/10 text-nss-success'
            : status === 'error'
              ? 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger'
              : 'border-nss-warning/20 bg-nss-warning/10 text-nss-warning'
        ].join(' ')}
      >
        {statusMessage}
      </div>

      <div ref={containerRef} className="overflow-hidden rounded-lg border border-nss-border bg-black/5">
        <iframe
          ref={iframeRef}
          src={question.url}
          title={question.title ?? 'Embedded assignment'}
          onLoad={handleLoad}
          onError={handleError}
          className="w-full bg-white"
          style={{ height: question.height ?? 420 }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          allow="fullscreen; clipboard-write"
        />
      </div>

      <p className="text-[10px] leading-relaxed text-nss-muted">
        Allowed origins: {Array.from(allowedOrigins).join(', ')}
      </p>
    </div>
  )
}
