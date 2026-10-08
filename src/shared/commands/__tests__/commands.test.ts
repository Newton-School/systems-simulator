import { describe, expect, it, vi } from 'vitest'
import { stripAnsi } from '../../ansi'
import { TerminalSession } from '../session'
import type { CommandDeps, ConfigFieldView, SimulationAccess, SimulationStateView } from '../types'
import {
  NO_COLOR,
  fixtureRun,
  fixtureTopology,
  runLines,
  staticDeps,
  validateView
} from './fixtures'

function session(deps: CommandDeps = staticDeps()): TerminalSession {
  return new TerminalSession(deps)
}

describe('sim> topology commands', () => {
  it('show topology / nodes / edges describe the fixture', () => {
    const s = session()
    const topology = runLines(s, 'show topology')
    expect(topology).toContain('Terminal fixture')
    expect(topology).toContain('sources   client')
    expect(topology).toMatch(/api\s+API\s+microservice\s+processor\s+1\/2/)
    expect(runLines(s, 'show edges')).toMatch(
      /gw-api\s+gw -> api\s+https\/synchronous\s+same-dc\s+~1\.0ms/
    )
  })

  it('select enters node context, exit / end leave it', () => {
    const s = session()
    s.run('select API')
    expect(s.prompt()).toBe('node(api)>')
    s.run('configure terminal')
    // sim shell deps have no config access: stays in node mode and says why.
    expect(s.prompt()).toBe('node(api)>')
    s.run('exit')
    expect(s.prompt()).toBe('sim>')
    expect(runLines(s, 'select nope')).toContain("No node 'nope'")
  })

  it('ping and traceroute follow the directed edges with configured latency', () => {
    const s = session()
    const ping = runLines(s, 'ping client db')
    expect(ping).toContain('client -> gw -> api -> db')
    expect(ping).toContain('3 hops, configured one-way network latency ~4.0ms')
    const trace = runLines(s, 'traceroute client db')
    expect(trace).toMatch(/1\s+Client -> Gateway\s+client-gw\s+https\s+same-dc\s+~2\.0ms/)
    expect(runLines(s, 'ping db client')).toContain('client is unreachable from db')
  })

  it('validate, lint and cost reuse the sim cli reports', () => {
    const s = session()
    expect(runLines(s, 'validate')).toContain('Valid Terminal fixture')
    expect(runLines(s, 'lint')).toMatch(/^Lint Terminal fixture/)
    expect(runLines(s, 'cost')).toContain('pre-run')
  })

  it('show config diff compares against the saved baseline', () => {
    const saved = fixtureTopology()
    const current = fixtureTopology()
    current.nodes[2].processing!.timeout = 250
    current.edges = current.edges.filter((edge) => edge.id !== 'api-cache')
    const deps: CommandDeps = {
      ...staticDeps(),
      topology: () => ({ topology: current, errors: [] }),
      savedTopology: () => saved
    }
    const diff = runLines(session(deps), 'show config diff')
    expect(diff).toContain('~ node[api].processing.timeout 1000 -> 250')
    expect(diff).toContain('- edge[api-cache].bandwidth 1000')
    expect(
      runLines(
        session({ ...deps, topology: () => ({ topology: saved, errors: [] }) }),
        'show config diff'
      )
    ).toContain('No changes')
  })

  it('help lists mode commands; unknown commands point to the right mode', () => {
    const s = session()
    const help = runLines(s, 'help')
    expect(help).toContain('show topology')
    expect(help).not.toContain('show interfaces')
    expect(runLines(s, 'show interfaces')).toContain(
      "belongs to node(<id>)> ('select <nodeId>' enters it)"
    )
    expect(runLines(s, 'show ?')).toContain('show edges')
    expect(runLines(s, 'show edges | grep gw-api | count')).toBe('1')
  })
})

describe('node> show commands', () => {
  it('queue, interfaces and ports are projections of what the engine models', () => {
    const s = session()
    s.run('select api')
    const queue = runLines(s, 'show queue')
    expect(queue).toMatch(/workers \(c\)\s+1/)
    expect(queue).toMatch(/capacity \(K\)\s+2/)
    const interfaces = runLines(s, 'show interfaces')
    expect(interfaces).toContain('Interface 1 (out) -> Cache [cache] [api-cache]')
    expect(interfaces).toContain('Interface 2 (out) -> Orders DB [db] [api-db]')
    expect(interfaces).toContain('Interface 3 (in) <- Gateway [gw] [gw-api]')
    const ports = runLines(s, 'show ports')
    expect(ports).toContain('not simulated')
    expect(runLines(s, 'show config')).toContain('processing.timeout 1000')
  })

  it('per-type idioms only appear on matching nodes', () => {
    const s = session()
    s.run('select db')
    expect(runLines(s, '\\conninfo')).toContain('max_connections  10')
    expect(runLines(s, '\\dt')).toContain('Tables are not simulated')
    expect(runLines(s, 'select * from users')).toContain('SQL is not simulated')
    expect(runLines(s, 'help')).toContain('psql')
    s.run('select cache')
    expect(runLines(s, '\\dt')).toContain("Unknown command '\\dt'")
    expect(runLines(s, 'dbsize')).toContain('Key count is not simulated')
    expect(runLines(s, 'ping')).toBe('PONG')
    s.run('select gw')
    expect(runLines(s, 'show ip route')).toMatch(/S\s+api\s+via gw-api\s+Interface 1/)
    expect(runLines(s, 'info')).toContain('Unknown command')
  })
})

describe('after a run', () => {
  it('run in sim shell completes synchronously and prints the summary', () => {
    const s = session()
    const out = runLines(s, 'run')
    expect(out).toContain('Run complete')
    expect(s.prompt()).toBe('sim>')
    expect(runLines(s, 'status')).toMatch(/state\s+complete/)
  })

  it('show status / bottleneck / throughput read the output', () => {
    const s = session(staticDeps({ withResults: true }))
    expect(runLines(s, 'show status')).toMatch(/api\s+/)
    expect(runLines(s, 'show bottleneck')).toContain('api')
    expect(runLines(s, 'show throughput')).toContain('system')
  })

  it('show rejected / events / trace / why-rejected / diagnose / cascade', () => {
    const results = fixtureRun()
    const s = session(staticDeps({ withResults: true }))
    const rejected = runLines(s, 'show rejected --last 3')
    expect(rejected).toContain(`last 3 of ${results.summary.rejectedRequests}`)
    expect(rejected).toContain('no_healthy_targets')
    expect(runLines(s, 'show events --last 4 --node api')).toMatch(/last 4 of \d+, node api/)
    const rejectedEvents = results.eventStream.filter(
      (record) => record.type === 'request-rejected' && record.nodeId === 'api'
    ).length
    expect(runLines(s, 'show events --last 500 --where "node:api AND status:rejected"')).toContain(
      `of ${rejectedEvents}, where node:api AND status:rejected`
    )
    expect(runLines(s, 'show events --where "status:nope"')).toContain(
      "--where: Unknown status 'nope'"
    )

    const traced = results.traces.find((trace) => trace.status === 'success')!
    const waterfall = runLines(s, `show trace ${traced.requestId}`)
    expect(waterfall).toContain(`Trace ${traced.requestId}`)
    expect(waterfall).toMatch(/api\s+\S+ms/)

    const capacityReject = results.eventStream.find(
      (record) => record.type === 'request-rejected' && record.reasonCode === 'capacity_exceeded'
    )!
    const why = runLines(s, `why-rejected ${capacityReject.requestId}`)
    expect(why).toContain('reason capacity_exceeded')
    expect(why).toMatch(/rule: admit while in system < K\s+->\s+2 >= 2\s+->\s+reject/)

    const policyReject = results.eventStream.find(
      (record) => record.reasonCode === 'no_healthy_targets'
    )!
    expect(runLines(s, `why-rejected ${policyReject.requestId}`)).toContain(
      'comes from a trait or policy'
    )

    const diagnosis = runLines(s, 'diagnose api')
    expect(diagnosis).toContain('Diagnosis API [api]')
    expect(diagnosis).toMatch(/offered .* vs service capacity ~33\.3\/s/)
    expect(runLines(s, 'explain capacity api')).toContain('set directly (no instance model')
    expect(runLines(s, 'compare api db')).toMatch(/c \/ K\s+1 \/ 2\s+10 \/ 100/)
    expect(runLines(s, 'show cascade')).toMatch(/Failure cascade|No failure cascade/)
  })

  it('why-rejected uses the traced admission record when the event stream was cut off', () => {
    const results = fixtureRun()
    const traced = results.traces.find((trace) =>
      trace.admissions?.some((record) => record.outcome === 'rejected' && record.state)
    )!
    expect(traced).toBeDefined()
    // Long runs keep only the first events; drop this request's rejection event.
    const truncated = {
      ...results,
      eventStream: results.eventStream.filter((record) => record.requestId !== traced.requestId)
    }
    const s = session(staticDeps({ results: truncated }))
    const why = runLines(s, `why-rejected ${traced.requestId}`)
    expect(why).toContain('(traced)')
    expect(why).toContain('decided by')
    expect(why).not.toMatch(/approximate/i)
  })

  it('commands that need data say so when nothing ran', () => {
    const s = session()
    expect(runLines(s, 'show events')).toContain("needs a completed run. Type 'run' first.")
    expect(runLines(s, 'diagnose api')).toContain('needs a completed run')
  })
})

function liveSim(overrides: Partial<SimulationStateView> = {}) {
  const state: SimulationStateView = {
    status: 'running',
    progress: 42,
    eventsProcessed: 1234,
    playbackSpeed: 1,
    stopped: false,
    error: null,
    snapshot: {
      timestamp: 800,
      node: {
        api: {
          queueLength: 1,
          activeWorkers: 1,
          totalInSystem: 2,
          utilization: 1,
          status: 'saturated',
          workers: 1,
          capacity: 2
        }
      }
    },
    results: null,
    runTopology: fixtureTopology(),
    ...overrides
  }
  const access: SimulationAccess & { state: () => SimulationStateView } = {
    state: () => state,
    run: vi.fn(() => null),
    pause: vi.fn(() => {
      state.status = 'paused'
    }),
    resume: vi.fn(() => {
      state.status = 'running'
    }),
    step: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn()
  }
  return { state, access }
}

describe('sim(runtime)# controls', () => {
  it('send the same controls the playback buttons use, with state checks', () => {
    const { access } = liveSim()
    const deps: CommandDeps = { ...staticDeps(), host: 'app', sim: access }
    const s = session(deps)
    s.run('runtime')
    expect(s.prompt()).toBe('sim(runtime)#')
    expect(runLines(s, 'step')).toContain("Step works while paused - 'pause' first.")
    s.run('pause')
    expect(access.pause).toHaveBeenCalledTimes(1)
    s.run('step 25')
    expect(access.step).toHaveBeenCalledWith(25)
    expect(runLines(s, 'step 0')).toContain('expected a whole number')
    s.run('speed 10')
    expect(access.setSpeed).toHaveBeenCalledWith(10)
    s.run('speed max')
    expect(access.setSpeed).toHaveBeenLastCalledWith('max')
    expect(runLines(s, 'speed fast')).toContain("expected a positive number or 'max'")
    s.run('resume')
    expect(access.resume).toHaveBeenCalledTimes(1)
    const status = runLines(s, 'status')
    expect(status).toMatch(/progress\s+42\.0%/)
    expect(status).toMatch(/sim time\s+0\.8s of 2s/)
    expect(runLines(s, 'show status')).toMatch(/api\s+◉ saturated\s+100\.0%\s+1/)
    expect(runLines(s, 'show bottleneck')).toContain('instantaneous occupancy')
    s.run('stop')
    expect(access.stop).toHaveBeenCalledTimes(1)
  })

  it('live controls are absent in sim shell', () => {
    const s = session()
    s.run('runtime')
    expect(runLines(s, 'pause')).toContain('No run in progress')
    expect(runLines(s, 'speed 2')).toContain('sim shell runs complete at full speed')
  })
})

describe('node(config)# and port config', () => {
  function configDeps() {
    const values: Record<string, unknown> = {
      timeout: 1000,
      discipline: 'fifo',
      'distribution-type': 'constant',
      'distribution-value': 30
    }
    const field = (key: string, extra: Partial<ConfigFieldView> = {}): ConfigFieldView => ({
      path: `sim.${key}`,
      key,
      label: key,
      section: 'Performance',
      type: 'input',
      displayValue: values[key],
      editable: true,
      optional: false,
      ...extra
    })
    const set = vi.fn((_node: string, key: string, raw: string) => {
      values[key] = raw
      return { ok: true as const, undoable: true }
    })
    const reset = vi.fn(() => ({ ok: true as const, undoable: true }))
    const edgeSet = vi.fn(() => ({
      ok: false as const,
      reason: 'Connections are plain wires in this environment (connector mode).'
    }))
    const deps: CommandDeps = {
      ...staticDeps(),
      host: 'app',
      config: {
        fields: () => [
          field('timeout', { unit: 'ms' }),
          field('discipline', { type: 'select', options: ['fifo', 'lifo', 'priority', 'wfq'] }),
          field('distribution-type', { type: 'select', options: ['constant', 'log-normal'] }),
          field('distribution-value', { path: 'sim.processing.distribution.value' }),
          field('routing-rules', { editable: false })
        ],
        set,
        reset
      },
      edges: {
        fields: () => [
          { key: 'protocol', label: 'Protocol', authored: undefined, options: ['https', 'grpc'] }
        ],
        set: edgeSet,
        reset: vi.fn(() => ({ ok: true as const, undoable: true }))
      },
      undo: vi.fn(() => true)
    }
    return { deps, set, reset, edgeSet }
  }

  it('set / no / distribution write through the config access; derived keys explain themselves', () => {
    const { deps, set, reset } = configDeps()
    const s = session(deps)
    s.run('select api')
    s.run('conf t')
    expect(s.prompt()).toBe('node(api)(config)#')
    expect(runLines(s, 'set timeout 250')).toContain('timeout = 250 ms')
    expect(set).toHaveBeenLastCalledWith('api', 'timeout', '250')
    s.run('set queue-discipline lifo')
    expect(set).toHaveBeenLastCalledWith('api', 'discipline', 'lifo')
    s.run('set distribution constant 12')
    expect(set).toHaveBeenCalledWith('api', 'distribution-type', 'constant')
    expect(set).toHaveBeenLastCalledWith('api', 'distribution-value', '12')
    expect(runLines(s, 'set workers 8')).toContain('Workers (c) are derived from the instance')
    expect(runLines(s, 'set routing-rules x')).toContain('list editor')
    expect(runLines(s, 'set bogus 1')).toContain('Only settings the simulation reads are offered')
    s.run('no timeout')
    expect(reset).toHaveBeenCalledWith('api', 'timeout')
    expect(runLines(s, 'undo')).toBe('Undone.')
  })

  it('interface port enters port-config; unsimulated port features say so', () => {
    const { deps, edgeSet } = configDeps()
    const s = session(deps)
    s.run('select api')
    s.run('configure terminal')
    s.run('interface port 3')
    expect(s.prompt()).toBe('node(api)(config-port:3)#')
    expect(runLines(s, 'show')).toContain('Port 3 gw-api')
    expect(runLines(s, 'set protocol grpc')).toContain('connector mode')
    expect(edgeSet).toHaveBeenCalledWith('gw-api', 'protocol', 'grpc')
    expect(runLines(s, 'shutdown')).toContain('Port shutdown is not simulated')
    expect(runLines(s, 'set rate-limit 100 burst 10')).toContain(
      'Per-port rate limiting is not simulated'
    )
    expect(runLines(s, 'health-check path /hz interval 500')).toContain(
      'not simulated per port'.slice(0, 0) + 'Per-port health checks are not simulated'
    )
    expect(runLines(s, 'interface port 9')).toContain('not available')
    s.run('exit')
    expect(runLines(s, 'interface port 9')).toContain('Ports are 1-3')
    s.run('end')
    expect(s.prompt()).toBe('sim>')
  })

  it('tab completion offers field keys in config mode', () => {
    const { deps } = configDeps()
    const s = session(deps)
    s.run('select api')
    s.run('configure terminal')
    expect(s.complete('set dis').candidates).toEqual([
      'discipline',
      'distribution-type',
      'distribution-value'
    ])
    expect(s.complete('set ti').candidates).toEqual(['timeout'])
  })
})

it('outputs are plain when the palette is off', () => {
  const s = new TerminalSession({ ...staticDeps(), palette: NO_COLOR, validate: validateView })
  const out = runLines(s, 'show nodes')
  expect(out).toBe(stripAnsi(out))
})
