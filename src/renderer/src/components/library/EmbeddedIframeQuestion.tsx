import { useEffect, useMemo, useRef, useState } from 'react'
import type { EmbeddedIframeQuestion } from './embeddedIframeQuestionSchema'
import { buildQuestionTestRows, type AttemptState } from '../../../../engine/analysis/question'
import { parseQuestionHostOutboundMessage } from '@renderer/utils/questionHostMessaging'

type FrameStatus = 'idle' | 'loading' | 'ready' | 'error'

export function EmbeddedIframeQuestionPreview({ question }: { question: EmbeddedIframeQuestion }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<FrameStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('Waiting for the embedded app to load.')
  const [latestAttempt, setLatestAttempt] = useState<AttemptState | null>(
    question.priorAttempt ?? null
  )
  const latestAttemptRef = useRef<AttemptState | null>(question.priorAttempt ?? null)

  useEffect(() => {
    setLatestAttempt(question.priorAttempt ?? null)
  }, [question.priorAttempt])

  useEffect(() => {
    latestAttemptRef.current = latestAttempt
  }, [latestAttempt])

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

      const message = parseQuestionHostOutboundMessage(event.data, question.questionPackage?.id)
      if (!message) {
        return
      }

      const type = message.type
      if (type === 'ns-simulator:ready') {
        window.clearTimeout(timeout)
        setStatus('ready')
        if (question.questionPackage) {
          iframeRef.current?.contentWindow?.postMessage(
            {
              type: 'ns-simulator:launch-context',
              payload: {
                questionPackage: question.questionPackage,
                ...(latestAttemptRef.current ? { priorAttempt: latestAttemptRef.current } : {})
              }
            },
            event.origin
          )
          setStatusMessage('Handshake complete. Launch context sent to the embedded simulator.')
        } else {
          setStatusMessage('Handshake complete. No question package was provided by the host.')
        }
      } else if (type === 'ns-simulator:submit') {
        window.clearTimeout(timeout)
        setStatus('ready')
        setLatestAttempt(message.payload.attemptState)
        setStatusMessage(
          `Submission received. ${message.payload.contract.passedTests}/${message.payload.contract.totalTests} checks passed.`
        )
      } else if (type === 'ns-simulator:error') {
        window.clearTimeout(timeout)
        setStatus('error')
        const detail = message.message
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
      setStatusMessage(
        'Fullscreen failed. The browser blocked the request or the iframe disallows it.'
      )
    }
  }

  const testRows = question.questionPackage
    ? buildQuestionTestRows(question.questionPackage, latestAttempt?.grade?.result ?? null)
    : []
  const passedCount = testRows.filter((row) => row.status === 'passed').length
  const failedCount = testRows.filter((row) => row.status === 'failed').length
  const pendingCount = testRows.filter((row) => row.status === 'pending').length

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

      {question.questionPackage ? (
        <div className="rounded-md border border-nss-border bg-nss-panel px-3 py-2 text-[11px] text-nss-muted">
          <div className="flex items-center justify-between gap-2">
            <span>Question</span>
            <span className="font-semibold text-nss-text">{question.questionPackage.id}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>Attempt status</span>
            <span className="font-semibold text-nss-text">
              {latestAttempt?.status ?? 'Not launched'}
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-nss-border px-3 py-2 text-[11px] leading-relaxed text-nss-muted">
          This preview is in handshake-only mode. Provide a `questionPackage` to exercise the real
          embedded question flow.
        </div>
      )}

      <div
        ref={containerRef}
        className="overflow-hidden rounded-lg border border-nss-border bg-black/5"
      >
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

      {testRows.length > 0 && (
        <div className="space-y-2 rounded-lg border border-nss-border bg-nss-panel p-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-nss-text">Tests</h4>
            <span className="text-[10px] uppercase tracking-wide text-nss-muted">
              {passedCount} passed · {failedCount} failed · {pendingCount} pending
            </span>
          </div>
          <div className="space-y-1">
            {testRows.map((row) => (
              <div
                key={row.id}
                className="rounded border border-nss-border bg-nss-surface/50 px-2.5 py-2"
              >
                <div className="flex items-start gap-2 text-[11px]">
                  <span
                    className={
                      row.status === 'passed'
                        ? 'text-nss-success'
                        : row.status === 'failed'
                          ? 'text-nss-danger'
                          : 'text-nss-warning'
                    }
                  >
                    {row.status === 'passed' ? '✓' : row.status === 'failed' ? '✗' : '•'}
                  </span>
                  <span className="min-w-0 flex-1 text-nss-text">{row.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-nss-muted">
                    {row.scope}
                  </span>
                </div>
                {row.detail && (
                  <p className="mt-1 pl-4 text-[10px] leading-relaxed text-nss-muted">
                    {row.detail}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
