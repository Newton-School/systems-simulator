import { describe, expect, it } from 'vitest'
import {
  ROOT_CONTEXT,
  canEnter,
  endMode,
  enterMode,
  enterRuntime,
  exitMode,
  leaveRuntime,
  promptFor,
  pruneMissingNode
} from '../context'

describe('terminal mode state machine', () => {
  it('walks sim > node > config > port and back one level per exit', () => {
    const node = enterMode(ROOT_CONTEXT, { mode: 'node', nodeId: 'api' })
    const config = enterMode(node, { mode: 'node-config', nodeId: 'api' })
    const port = enterMode(config, {
      mode: 'port-config',
      nodeId: 'api',
      portIndex: 2,
      edgeId: 'e2'
    })
    expect([ROOT_CONTEXT, node, config, port].map(promptFor)).toEqual([
      'sim>',
      'node(api)>',
      'node(api)(config)#',
      'node(api)(config-port:2)#'
    ])
    expect(promptFor(exitMode(port))).toBe('node(api)(config)#')
    expect(promptFor(exitMode(exitMode(port)))).toBe('node(api)>')
    expect(exitMode(exitMode(exitMode(port)))).toEqual(ROOT_CONTEXT)
    expect(exitMode(ROOT_CONTEXT)).toBe(ROOT_CONTEXT)
    expect(endMode()).toEqual(ROOT_CONTEXT)
  })

  it('rejects illegal transitions', () => {
    expect(canEnter(ROOT_CONTEXT, 'node-config')).toBe(false)
    expect(() => enterMode(ROOT_CONTEXT, { mode: 'node-config', nodeId: 'api' })).toThrow()
    expect(() => enterMode(ROOT_CONTEXT, { mode: 'node' })).toThrow(/needs a node/)
    const config = enterMode(enterMode(ROOT_CONTEXT, { mode: 'node', nodeId: 'a' }), {
      mode: 'node-config',
      nodeId: 'a'
    })
    expect(() => enterMode(config, { mode: 'port-config', nodeId: 'a' })).toThrow(/needs a port/)
  })

  it('selecting another node from node mode replaces it instead of stacking', () => {
    const a = enterMode(ROOT_CONTEXT, { mode: 'node', nodeId: 'a' })
    const b = enterMode(a, { mode: 'node', nodeId: 'b' })
    expect(promptFor(b)).toBe('node(b)>')
    expect(exitMode(b)).toEqual(ROOT_CONTEXT)
  })

  it('enters runtime on run start and leaves it when the run ends', () => {
    const runtime = enterRuntime(ROOT_CONTEXT)
    expect(promptFor(runtime)).toBe('sim(runtime)#')
    expect(enterRuntime(runtime)).toBe(runtime)
    expect(leaveRuntime(runtime)).toEqual(ROOT_CONTEXT)

    // From a config context: runtime goes on top; ending returns to config.
    const config = enterMode(enterMode(ROOT_CONTEXT, { mode: 'node', nodeId: 'a' }), {
      mode: 'node-config',
      nodeId: 'a'
    })
    const fromConfig = enterRuntime(config)
    expect(fromConfig.mode).toBe('runtime')
    expect(promptFor(leaveRuntime(fromConfig))).toBe('node(a)(config)#')

    // A node selected from runtime keeps its place but no longer exits into runtime.
    const nodeFromRuntime = enterMode(runtime, { mode: 'node', nodeId: 'a' })
    const after = leaveRuntime(nodeFromRuntime)
    expect(promptFor(after)).toBe('node(a)>')
    expect(exitMode(after)).toEqual(ROOT_CONTEXT)
  })

  it('falls back when the selected node is deleted', () => {
    const config = enterMode(enterMode(ROOT_CONTEXT, { mode: 'node', nodeId: 'gone' }), {
      mode: 'node-config',
      nodeId: 'gone'
    })
    expect(pruneMissingNode(config, () => false)).toEqual(ROOT_CONTEXT)
    expect(pruneMissingNode(config, () => true)).toBe(config)
  })
})
