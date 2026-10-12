import { beforeEach, describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import sample from '../../../../engine/__samples__/basic-cache-stack.json'
import { migrateCanvasNodes } from '../../../../engine/catalog/legacyCanvasMigration'
import {
  AUTHOR_ENVIRONMENT_PROFILE,
  PRACTICE_ENVIRONMENT_PROFILE
} from '../../../../engine/analysis/environmentProfile'
import { TerminalSession } from '../../../../shared/commands/session'
import type { SimulationAccess } from '../../../../shared/commands/types'
import useStore from '@renderer/store/useStore'
import { normalizeScenarioState } from '@renderer/types/ui'
import { convertNestedToFlat, type NestedFileData } from '@renderer/utils/nodeTransformers'
import { stripAnsi } from '../../../../shared/ansi'
import { createAppTerminalDeps, currentTopology } from './appTerminalDeps'

const idleSim: SimulationAccess = {
  state: () => ({
    status: 'idle',
    progress: 0,
    eventsProcessed: 0,
    playbackSpeed: 'max',
    stopped: false,
    error: null,
    snapshot: null,
    results: null,
    runTopology: null
  }),
  run: () => null
}

function loadSample(): void {
  const canvas = structuredClone(sample) as unknown as NestedFileData
  useStore
    .getState()
    .setGraph(
      migrateCanvasNodes(convertNestedToFlat(canvas.nodes)),
      (canvas.edges ?? []) as Edge[],
      { history: 'skip', resetHistory: true }
    )
  useStore.getState().setScenario(normalizeScenarioState(canvas.scenario))
}

function apiData() {
  return useStore.getState().nodes.find((node) => node.id === 'api')!.data as {
    sim: { processing: { timeout: number }; queue: { discipline: string } }
  }
}

function run(session: TerminalSession, line: string): string {
  return stripAnsi(session.run(line).lines.join('\n'))
}

describe('app terminal deps (store-backed)', () => {
  beforeEach(() => {
    useStore.setState({
      environmentProfile: AUTHOR_ENVIRONMENT_PROFILE,
      activeQuestion: null,
      attemptState: null
    })
    loadSample()
  })

  it('lists the properties-panel fields with terminal keys', () => {
    const deps = createAppTerminalDeps(idleSim, { color: false })
    const keys = deps.config!.fields('api').map((field) => field.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'instance-type',
        'instance-count',
        'timeout',
        'discipline',
        'distribution-type',
        'distribution-value'
      ])
    )
    expect(keys).not.toContain('workers')
  })

  it('set writes through updateNodeData (canvas + topology change) and undo reverts it', () => {
    const session = new TerminalSession(createAppTerminalDeps(idleSim, { color: false }))
    session.run('select api')
    session.run('configure terminal')
    expect(run(session, 'set timeout 250')).toContain('timeout = 250 ms')
    expect(apiData().sim.processing.timeout).toBe(250)
    expect(
      currentTopology().topology!.nodes.find((node) => node.id === 'api')!.processing!.timeout
    ).toBe(250)
    expect(run(session, 'set queue-discipline lifo')).toContain('discipline = lifo')
    expect(apiData().sim.queue.discipline).toBe('lifo')
    expect(run(session, 'set discipline bogus')).toContain("'bogus' is not an option")
    expect(run(session, 'set timeout 250')).toContain('already')

    expect(run(session, 'undo')).toBe('Undone.')
    expect(apiData().sim.queue.discipline).toBe('fifo')
    expect(run(session, 'undo')).toBe('Undone.')
    expect(apiData().sim.processing.timeout).toBe(300)
  })

  it('port config edits the edge in network mode and refuses honestly in connector mode', () => {
    const session = new TerminalSession(createAppTerminalDeps(idleSim, { color: false }))
    session.run('select api')
    session.run('configure terminal')
    session.run('interface port 1')
    expect(session.prompt()).toMatch(/^node\(api\)\(config-port:1\)#$/)
    const edgeId = session.state.ctx.edgeId!
    expect(run(session, 'set max-connections 7')).toContain('max-concurrent = 7')
    expect(
      currentTopology().topology!.edges.find((edge) => edge.id === edgeId)!.maxConcurrentRequests
    ).toBe(7)

    useStore.setState({ environmentProfile: PRACTICE_ENVIRONMENT_PROFILE })
    expect(run(session, 'set protocol grpc')).toContain('connector mode')
  })

  it('show config diff reports edits against the loaded baseline', async () => {
    const { trackSavedTopologyBaseline } = await import('./terminalStore')
    const stop = trackSavedTopologyBaseline()
    loadSample()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const session = new TerminalSession(createAppTerminalDeps(idleSim, { color: false }))
    expect(run(session, 'show config diff')).toContain('No changes')
    session.run('select api')
    session.run('configure terminal')
    session.run('set timeout 123')
    session.run('end')
    expect(run(session, 'show config diff')).toContain('~ node[api].processing.timeout 300 -> 123')
    stop()
  })
})
