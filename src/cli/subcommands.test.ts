import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EdgeDefinition, TopologyJSON } from '../engine/core/types'
import { CLI_EXIT_CHECK_FAILED, CLI_EXIT_SUCCESS, CLI_EXIT_USAGE_ERROR } from './exitCodes'
import { CLI_COMMANDS } from './help'

// End-to-end tests for the sim cli command surface: every case spawns the real
// entry point and asserts on stdout/stderr and the process exit code.

const CLI_ENTRY_PATH = resolve(__dirname, 'index.ts')
const BIN_PATH = resolve(__dirname, '..', '..', 'bin', 'sim.mjs')
const REPO_ROOT = resolve(__dirname, '..', '..')
const TEMP_DIRS: string[] = []
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '' }

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: ENV
  })
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ns-sim-cli-sub-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeTopology(dir: string, name: string, value: unknown): string {
  const filePath = resolve(dir, name)
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
  return filePath
}

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(
  id: string,
  options: { serviceMs?: number; workers?: number; timeoutMs?: number } = {}
): TopologyJSON {
  const timeout = options.timeoutMs ?? 1_000
  return {
    id,
    name: id,
    version: '2.0.0',
    global: {
      simulationDuration: 2_000,
      seed: `${id}-seed`,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: timeout
    },
    nodes: [
      {
        id: 'client',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'client',
        position: { x: 0, y: 0 }
      },
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'api',
        position: { x: 120, y: 0 },
        resources: { instanceType: 'c5.large', replicas: 1 },
        queue: { workers: options.workers ?? 1, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: options.serviceMs ?? 5 },
          timeout
        }
      }
    ],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 50,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1_024 }]
    }
  } as TopologyJSON
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    rmSync(TEMP_DIRS.pop() as string, { recursive: true, force: true })
  }
})

describe('sim cli: help and dispatch', () => {
  it('prints the command list for --help and exits 0', () => {
    const result = runCli(['--help'])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    for (const command of CLI_COMMANDS) {
      expect(result.stdout).toContain(command)
    }
    expect(result.stdout).toContain('Exit codes')
  })

  it.each(CLI_COMMANDS.map((command) => [command]))(
    'prints dedicated help for `sim %s --help`',
    (command) => {
      const result = runCli([command, '--help'])
      expect(result.status).toBe(CLI_EXIT_SUCCESS)
      expect(result.stdout).toContain(`sim ${command}`)
      // `help <command>` is the same text.
      expect(runCli(['help', command]).stdout).toBe(result.stdout)
    }
  )

  it('rejects unknown commands and unknown flags with exit 1', () => {
    const unknownCommand = runCli(['frobnicate'])
    expect(unknownCommand.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(unknownCommand.stderr).toContain("Unknown command 'frobnicate'")

    const unknownFlag = runCli(['lint', 'x.json', '--bogus'])
    expect(unknownFlag.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(unknownFlag.stderr).toContain("Unknown option '--bogus'")
    expect(unknownFlag.stderr).toContain('sim lint --help')
  })

  it('reports missing positional arguments with exit 1', () => {
    const result = runCli(['compare', 'only-one.json'])
    expect(result.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(result.stderr).toContain('Missing <b.json>')
  })

  it('reports a missing file as file-not-found with exit 1', () => {
    for (const command of ['lint', 'cost', 'validate', 'run']) {
      const result = runCli([command, 'does-not-exist.json'])
      expect(result.status).toBe(CLI_EXIT_USAGE_ERROR)
      expect(result.stderr).toContain('File not found: does-not-exist.json')
    }
  })

  it('keeps the legacy `sim <topology.json>` shorthand for run', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'legacy.json', topology('legacy'))
    const result = runCli([file, '--verdict'])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    expect(JSON.parse(result.stdout).meta.seed).toBe('legacy-seed')
  })

  it('runs through the bin entry point from outside the repository', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'bin.json', topology('bin'))
    const result = spawnSync(process.execPath, [BIN_PATH, 'lint', file, '--json'], {
      cwd: dir,
      encoding: 'utf-8',
      env: ENV
    })
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    expect(JSON.parse(result.stdout).topologyId).toBe('bin')
  })
})

describe('sim run options', () => {
  it('applies --seed and --duration-ms overrides', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'run.json', topology('run'))
    const result = runCli(['run', file, '--json', '--seed', 'override', '--duration-ms', '1000'])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    const output = JSON.parse(result.stdout)
    expect(output.seed).toBe('override')
    expect(output.summary.duration).toBe(1000)
  })

  it('rejects a non-integer --duration-ms', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'run.json', topology('run'))
    const result = runCli(['run', file, '--duration-ms', 'soon'])
    expect(result.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(result.stderr).toContain('--duration-ms must be a positive integer')
  })

  it('--live degrades to plain progress lines without a terminal and keeps --json clean', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'live.json', topology('live'))
    const live = runCli(['run', file, '--live', '--json'])
    const plain = runCli(['run', file, '--json'])
    expect(live.status).toBe(CLI_EXIT_SUCCESS)
    expect(live.stderr).toContain('stderr is not a terminal')
    expect(live.stderr).toMatch(/\[live\] t=2\.0s\/2\.0s 100%/)
    expect(live.stderr).not.toContain('\u001b[')
    // The chunked live run produces the same output as engine.run().
    expect(JSON.parse(live.stdout)).toEqual(JSON.parse(plain.stdout))
  })
})

describe('sim validate', () => {
  it('exits 0 for a valid topology and 2 for an invalid one', () => {
    const dir = tempDir()
    const good = writeTopology(dir, 'good.json', topology('good'))
    const bad = writeTopology(dir, 'bad.json', { ...topology('bad'), nodes: [] })

    const ok = runCli(['validate', good, '--json'])
    expect(ok.status).toBe(CLI_EXIT_SUCCESS)
    expect(JSON.parse(ok.stdout)).toMatchObject({ valid: true, topologyId: 'good', errors: [] })

    const invalid = runCli(['validate', bad, '--json'])
    expect(invalid.status).toBe(CLI_EXIT_CHECK_FAILED)
    const report = JSON.parse(invalid.stdout)
    expect(report.valid).toBe(false)
    expect(report.errors.length).toBeGreaterThan(0)

    const human = runCli(['validate', bad])
    expect(human.status).toBe(CLI_EXIT_CHECK_FAILED)
    expect(human.stdout).toContain('Invalid')
  })
})

describe('sim lint', () => {
  it('passes (exit 0) with only warnings', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'warn.json', topology('warn'))
    const result = runCli(['lint', file])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    expect(result.stdout).toContain('Single point of failure')
    expect(result.stdout).toContain('PASS 0 critical')
  })

  it('fails (exit 2) on a critical anti-pattern, in both output modes', () => {
    const dir = tempDir()
    const file = writeTopology(
      dir,
      'slow.json',
      topology('slow', { serviceMs: 10_000, workers: 4, timeoutMs: 30_000 })
    )
    const human = runCli(['lint', file])
    expect(human.status).toBe(CLI_EXIT_CHECK_FAILED)
    expect(human.stdout).toContain('[CRITICAL] Synchronous call to a slow dependency')
    expect(human.stdout).toContain('FAIL 1 critical')

    const json = runCli(['lint', file, '--json'])
    expect(json.status).toBe(CLI_EXIT_CHECK_FAILED)
    const report = JSON.parse(json.stdout)
    expect(report.passed).toBe(false)
    expect(report.summary.critical).toBe(1)
    expect(report.antiPatterns[0].rule).toBe('sync-call-to-slow-dependency')
  })

  it('exits 1 (cannot lint) for an invalid topology', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'bad.json', { ...topology('bad'), nodes: [] })
    const result = runCli(['lint', file])
    expect(result.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(result.stderr).toContain('Topology validation failed')
  })
})

describe('sim cost', () => {
  it('prices a topology pre-run without simulating', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'cost.json', topology('cost'))
    const result = runCli(['cost', file, '--json'])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    const report = JSON.parse(result.stdout)
    expect(report.basis).toBe('pre-run')
    expect(report.run).toBeUndefined()
    expect(report.totalPerHour).toBeCloseTo(0.085, 6)
    expect(report.totalPerMonth).toBeCloseTo(0.085 * 730, 6)

    const human = runCli(['cost', file])
    expect(human.stdout).toContain('1 × c5.large @ $0.085')
    expect(human.stdout).toContain('Total  $0.0850/hr')
  })

  it('--run prices from a measured run', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'cost.json', topology('cost'))
    const result = runCli(['cost', file, '--run', '--json'])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    const report = JSON.parse(result.stdout)
    expect(report.basis).toBe('post-run')
    expect(report.run).toMatchObject({ evaluationMode: 'discrete', seed: 'cost-seed' })
  })

  it('rejects --mode without --run and invalid --mode values', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'cost.json', topology('cost'))
    expect(runCli(['cost', file, '--mode', 'discrete']).status).toBe(CLI_EXIT_USAGE_ERROR)
    const bad = runCli(['cost', file, '--run', '--mode', 'fast'])
    expect(bad.status).toBe(CLI_EXIT_USAGE_ERROR)
    expect(bad.stderr).toContain('--mode must be one of: auto, discrete, analytic')
  })
})

describe('sim compare', () => {
  it('runs both designs with one seed and prints a diff', () => {
    const dir = tempDir()
    const a = writeTopology(dir, 'a.json', topology('design-a', { workers: 1 }))
    const b = writeTopology(dir, 'b.json', topology('design-b', { workers: 4 }))

    const json = runCli(['compare', a, b, '--json', '--seed', 's1'])
    expect(json.status).toBe(CLI_EXIT_SUCCESS)
    const report = JSON.parse(json.stdout)
    expect(report.seed).toBe('s1')
    expect(report.designs.map((d: { name: string }) => d.name)).toEqual(['design-a', 'design-b'])
    const metrics = report.comparison.metrics.map((m: { metric: string }) => m.metric)
    expect(metrics).toEqual(expect.arrayContaining(['latency.p99', 'throughput', 'costPerHour']))
    expect(typeof report.comparison.summary).toBe('string')

    const human = runCli(['compare', a, b])
    expect(human.status).toBe(CLI_EXIT_SUCCESS)
    expect(human.stdout).toContain('Metric')
    expect(human.stdout).toContain('P99 latency')
    expect(human.stdout).toContain(report.comparison.summary)
    // Default seed is design A's own.
    expect(human.stdout).toContain('seed design-a-seed')
  })
})

describe('sim shell', () => {
  it('runs the shared terminal commands over a topology file with --exec', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'shell.json', topology('shell-topology'))
    const result = runCli([
      'shell',
      file,
      '--exec',
      'show nodes; select api; show queue; exit; run; show bottleneck'
    ])
    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    expect(result.stdout).toContain('sim> show nodes')
    expect(result.stdout).toContain('node(api)> show queue')
    expect(result.stdout).toContain('Run complete')
    expect(result.stdout).toContain('Bottleneck')
  })

  it('exits 2 when a command fails', () => {
    const dir = tempDir()
    const file = writeTopology(dir, 'shell.json', topology('shell-topology'))
    const result = runCli(['shell', file, '--exec', 'select nowhere'])
    expect(result.status).toBe(CLI_EXIT_CHECK_FAILED)
    expect(result.stdout).toContain("No node 'nowhere'")
  })
})
