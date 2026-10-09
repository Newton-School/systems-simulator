import { createInterface } from 'node:readline'
import type { TopologyJSON } from '../../engine/core/types'
import { runSimulation } from '../../engine/runSimulation'
import { validateTopology } from '../../engine/validation/validator'
import type { Palette } from '../../shared/ansi'
import { TerminalSession, createStaticDeps } from '../../shared/commands'

/**
 * `sim shell`: the in-app terminal's command set over a topology file. The
 * commands, parser and formatters are the shared ones (src/shared/commands);
 * only the deps differ - read-only model, and `run` completes synchronously.
 */
export function createShellSession(topology: TopologyJSON, c: Palette): TerminalSession {
  return new TerminalSession(
    createStaticDeps(topology, {
      palette: c,
      validate: (candidate) => {
        const result = validateTopology(candidate)
        return { valid: result.valid, errors: result.errors ?? [], warnings: result.warnings ?? [] }
      },
      runner: (candidate) => runSimulation(candidate, { mode: 'auto' })
    })
  )
}

/** Run `;`-separated lines and return the transcript plus whether any failed. */
export function execShellLines(
  session: TerminalSession,
  script: string,
  c: Palette
): { output: string; failed: boolean } {
  const out: string[] = []
  let failed = false
  for (const line of script
    .split(/;|\n/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    out.push(`${c.bold}${session.prompt()}${c.reset} ${line}`)
    const outcome = session.run(line)
    failed = failed || outcome.failed
    out.push(...outcome.lines)
  }
  return { output: out.join('\n') + '\n', failed }
}

/** Interactive loop with history and Tab completion (node:readline). */
export function runInteractiveShell(
  session: TerminalSession,
  c: Palette,
  banner: string
): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 500,
      completer: (line: string): [string[], string] => {
        const result = session.complete(line)
        const partial = /\S*$/.exec(line)?.[0] ?? ''
        return [result.candidates, partial]
      }
    })
    const prompt = (): void => {
      rl.setPrompt(`${c.bold}${session.prompt()}${c.reset} `)
      rl.prompt()
    }
    process.stdout.write(banner)
    prompt()
    rl.on('line', (line) => {
      if (line.trim() === 'quit') {
        rl.close()
        return
      }
      const outcome = session.run(line)
      if (outcome.clear) process.stdout.write('\x1b[2J\x1b[H')
      if (outcome.lines.length > 0) process.stdout.write(outcome.lines.join('\n') + '\n')
      prompt()
    })
    rl.on('close', () => {
      process.stdout.write('\n')
      resolve()
    })
  })
}
