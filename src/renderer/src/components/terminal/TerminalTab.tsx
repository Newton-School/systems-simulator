import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SimulationOutput, TimeSeriesSnapshot } from '../../../../engine/analysis/output'
import type { TopologyJSON } from '../../../../engine/core/types'
import { validateTopology } from '../../../../engine/validation/validator'
import { palette } from '../../../../shared/ansi'
import {
  enterRuntime,
  isInMode,
  leaveRuntime,
  promptFor
} from '../../../../shared/commands/context'
import { runSummaryLines } from '../../../../shared/commands/commands/topology'
import { TerminalSession } from '../../../../shared/commands/session'
import type { SimulationAccess, SimulationRunStatus } from '../../../../shared/commands/types'
import useStore from '@renderer/store/useStore'
import { resolveEdgeModel } from '../../../../engine/analysis/environmentProfile'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import { parseAnsi, type AnsiColor } from './ansiSegments'
import { createAppTerminalDeps } from './appTerminalDeps'
import { useTerminalStore } from './terminalStore'

/** What the terminal needs from `useSimulation` (passed down from the workspace). */
export interface TerminalSimulationProps {
  status: SimulationRunStatus
  progress: number
  eventsProcessed: number
  playbackSpeed: number | 'max'
  stopped: boolean
  error: string | null
  snapshot: TimeSeriesSnapshot | null
  results: SimulationOutput | null
  topology: TopologyJSON | null
  pause: () => void
  resume: () => void
  stop: () => void
  step: (count?: number) => void
  setPlaybackSpeed: (speed: number | 'max') => void
}

interface TerminalTabProps {
  sim: TerminalSimulationProps
  /** Starts a run exactly like the Run button. */
  onRun: () => void
}

const COLOR_CLASS: Record<AnsiColor, string> = {
  red: 'text-nss-danger',
  green: 'text-nss-success',
  yellow: 'text-nss-warning',
  magenta: 'text-nss-primary',
  cyan: 'text-nss-info'
}

const TerminalLine = memo(function TerminalLine({ text }: { text: string }) {
  const segments = parseAnsi(text)
  return (
    <div className="min-h-[1.25em] whitespace-pre">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={[
            segment.color ? COLOR_CLASS[segment.color] : '',
            segment.bold ? 'font-bold' : '',
            segment.dim ? 'text-nss-muted' : ''
          ].join(' ')}
        >
          {segment.text}
        </span>
      ))}
    </div>
  )
})

/** Pre-check what `startSimulation` would refuse, so the terminal can say why. */
function runPrecheck(): string | null {
  const state = useStore.getState()
  const edgeModel = resolveEdgeModel(state.environmentProfile, state.activeQuestion)
  const { topology, errors } = serializeCanvasToTopology(
    { nodes: state.nodes, edges: state.edges, scenario: state.scenario },
    { connectorMode: edgeModel === 'connector' }
  )
  if (!topology || errors.length > 0) {
    return `Cannot run: ${errors.length > 0 ? errors.join('; ') : 'the canvas has no topology.'}`
  }
  const validation = validateTopology(topology, { edgeModel })
  if (!validation.valid) {
    return `Cannot run: ${(validation.errors ?? []).map((error) => error.message).join('; ')}`
  }
  return null
}

export function TerminalTab({ sim, onRun }: TerminalTabProps) {
  const entries = useTerminalStore((state) => state.entries)
  const watch = useTerminalStore((state) => state.watch)
  const sessionState = useTerminalStore((state) => state.session)
  const [input, setInput] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const simRef = useRef(sim)
  simRef.current = sim
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun

  const session = useMemo(() => {
    const access: SimulationAccess = {
      state: () => {
        const current = simRef.current
        return {
          status: current.status,
          progress: current.progress,
          eventsProcessed: current.eventsProcessed,
          playbackSpeed: current.playbackSpeed,
          stopped: current.stopped,
          error: current.error,
          snapshot: current.snapshot,
          results: current.results,
          runTopology: current.topology
        }
      },
      run: () => {
        const problem = runPrecheck()
        if (problem) return problem
        onRunRef.current()
        return null
      },
      pause: () => simRef.current.pause(),
      resume: () => simRef.current.resume(),
      stop: () => simRef.current.stop(),
      step: (count) => simRef.current.step(count),
      setSpeed: (speed) => simRef.current.setPlaybackSpeed(speed)
    }
    return new TerminalSession(createAppTerminalDeps(access), {
      state: useTerminalStore.getState().session
    })
  }, [])

  const c = useMemo(() => palette(true), [])

  const execute = useCallback(
    (line: string, options: { echo?: boolean } = {}) => {
      const store = useTerminalStore.getState()
      if (options.echo !== false)
        store.append([`${c.bold}${session.prompt()}${c.reset} ${line}`], 'input')
      const outcome = session.run(line)
      store.setSession(session.state)
      if (outcome.clear) store.clear()
      if (outcome.watch) {
        const first = session.run(outcome.watch.line, { record: false })
        const blockId = store.append([
          `${c.dim}Every ${outcome.watch.intervalMs / 1000}s: ${outcome.watch.line} (Ctrl+C to stop)${c.reset}`,
          ...first.lines
        ])
        store.setWatch({ ...outcome.watch, blockId })
        return
      }
      if (outcome.lines.length > 0) store.append(outcome.lines)
    },
    [c, session]
  )

  // Watch: re-run the command in place.
  useEffect(() => {
    if (!watch) return
    const timer = window.setInterval(() => {
      const outcome = session.run(watch.line, { record: false })
      useTerminalStore
        .getState()
        .replaceFrom(watch.blockId, [
          `${c.dim}Every ${watch.intervalMs / 1000}s: ${watch.line} (Ctrl+C to stop) - ${new Date().toLocaleTimeString()}${c.reset}`,
          ...outcome.lines
        ])
      if (outcome.failed) useTerminalStore.getState().setWatch(null)
    }, watch.intervalMs)
    return () => window.clearInterval(timer)
  }, [c, session, watch])

  // Runtime mode follows the run: auto-enter when it starts, leave when it ends.
  const previousStatus = useRef(sim.status)
  useEffect(() => {
    const before = previousStatus.current
    previousStatus.current = sim.status
    if (before === sim.status) return
    const store = useTerminalStore.getState()
    const wasActive = before === 'running' || before === 'paused'
    if (sim.status === 'running' && !wasActive) {
      if (!isInMode(session.state.ctx, 'runtime')) {
        session.setContext(enterRuntime(session.state.ctx))
        store.append([
          `${c.green}Simulation started${c.reset} ${c.dim}- now in ${promptFor(session.state.ctx)}${c.reset}`
        ])
      }
      store.setSession(session.state)
      return
    }
    if (
      wasActive &&
      (sim.status === 'complete' || sim.status === 'error' || sim.status === 'idle')
    ) {
      session.setContext(leaveRuntime(session.state.ctx))
      store.setSession(session.state)
      if (sim.status === 'complete' && sim.results) {
        store.append([
          ...(sim.stopped ? [`${c.yellow}Run stopped early - partial results.${c.reset}`] : []),
          ...runSummaryLines(sim.results, c),
          `${c.dim}Back in ${promptFor(session.state.ctx)} 'show status', 'diagnose <node>', 'show rejected' read this run.${c.reset}`
        ])
      } else if (sim.status === 'error') {
        store.append([`${c.red}Run failed: ${sim.error ?? 'unknown error'}${c.reset}`])
      }
    }
  }, [c, session, sim.error, sim.results, sim.status, sim.stopped])

  // Greeting on first mount.
  useEffect(() => {
    if (useTerminalStore.getState().entries.length === 0) {
      useTerminalStore
        .getState()
        .append([
          `${c.bold}System Design Simulator terminal${c.reset} ${c.dim}- same commands as 'sim shell'. 'help' lists them, Tab completes, Ctrl+\` toggles this panel.${c.reset}`
        ])
    }
    inputRef.current?.focus()
  }, [c])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [entries])

  const history = sessionState.history

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      const line = input
      setInput('')
      setHistoryIndex(null)
      if (watch) useTerminalStore.getState().setWatch(null)
      execute(line)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (history.length === 0) return
      if (historyIndex === null) draftRef.current = input
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(next)
      setInput(history[next])
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (historyIndex === null) return
      const next = historyIndex + 1
      if (next >= history.length) {
        setHistoryIndex(null)
        setInput(draftRef.current)
      } else {
        setHistoryIndex(next)
        setInput(history[next])
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const result = session.complete(input)
      if (result.candidates.length === 0) return
      const head = input.replace(/\S*$/, '')
      if (result.candidates.length === 1) {
        setInput(`${head}${result.candidates[0]} `)
        return
      }
      const partial = input.slice(head.length)
      if (result.commonPrefix.length > partial.length) {
        setInput(`${head}${result.commonPrefix}`)
        return
      }
      useTerminalStore
        .getState()
        .append(
          [`${c.bold}${session.prompt()}${c.reset} ${input}`, result.candidates.join('  ')],
          'output'
        )
      return
    }
    if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) {
      if (watch) {
        event.preventDefault()
        useTerminalStore.getState().setWatch(null)
        useTerminalStore.getState().append([`${c.dim}watch stopped${c.reset}`])
        return
      }
      if (input.length > 0 && window.getSelection()?.toString() === '') {
        event.preventDefault()
        useTerminalStore
          .getState()
          .append([`${c.bold}${session.prompt()}${c.reset} ${input}^C`], 'input')
        setInput('')
      }
      return
    }
    if (event.ctrlKey && (event.key === 'l' || event.key === 'L')) {
      event.preventDefault()
      useTerminalStore.getState().clear()
    }
  }

  return (
    <div
      className="nss-terminal flex h-full min-h-0 flex-col bg-nss-bg font-mono text-[12px] leading-5 text-nss-text"
      onClick={() => {
        if (window.getSelection()?.toString() === '') inputRef.current?.focus()
      }}
    >
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Terminal output"
        className="min-h-0 flex-1 overflow-auto px-3 pt-2"
      >
        {entries.map((entry) => (
          <TerminalLine key={entry.id} text={entry.text} />
        ))}
      </div>
      <label className="flex shrink-0 items-center gap-2 border-t border-nss-border px-3 py-1.5">
        <span className="shrink-0 font-bold text-nss-primary">{promptFor(sessionState.ctx)}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
            setHistoryIndex(null)
          }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label="Terminal command"
          data-testid="terminal-input"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-nss-text outline-none placeholder:text-nss-muted"
          placeholder={entries.length <= 1 ? "Type 'help' and press Enter" : ''}
        />
      </label>
    </div>
  )
}
