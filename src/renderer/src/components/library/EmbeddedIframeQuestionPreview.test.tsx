// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GAME_PLAYGROUND_PAYLOAD_VERSION } from '../../../../engine/analysis/gamePlayground'
import type { AttemptGrade } from '../../../../engine/analysis/question'
import { EmbeddedIframeQuestionPreview } from './EmbeddedIframeQuestion'
import type { EmbeddedIframeQuestion } from './embeddedIframeQuestionSchema'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function buildQuestionPackage() {
  return {
    version: '1.0' as const,
    id: 'q1',
    title: 'Assignment',
    difficulty: 'intermediate' as const,
    type: 'open-build' as const,
    prompt: {
      text: 'Build the system.',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' as const },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: {
      name: 'suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline' }]
    },
    rubric: {
      checks: [
        {
          id: 'err',
          description: 'error rate < 10%',
          metric: 'summary.errorRate',
          op: '<' as const,
          value: 0.1
        }
      ]
    }
  }
}

function buildGrade(): AttemptGrade {
  return {
    structural: { version: '1.0', checks: [], passed: true },
    graded: {
      version: '1.0',
      cases: [
        {
          id: 'baseline',
          ran: true,
          rubric: {
            version: '1.0',
            checks: [
              {
                id: 'err',
                description: 'error rate < 10%',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1,
                actual: 0.01,
                passed: true,
                points: 1,
                awarded: 1
              }
            ],
            score: { earned: 1, possible: 1, fraction: 1 },
            passed: true
          }
        }
      ],
      summary: { total: 1, ran: 1, errored: 0, passed: 1, failed: 0 }
    },
    contract: {
      tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
      totalTests: 1,
      passedTests: 1,
      allPassed: true
    }
  }
}

function buildAttemptState() {
  return {
    version: '1.0' as const,
    attemptId: 'attempt-1',
    questionId: 'q1',
    topology: {
      id: 'topology-under-test',
      name: 'Topology Under Test',
      version: '2.0.0',
      global: {
        seed: 'seed',
        simulationDuration: 1000,
        warmupDuration: 0,
        timeResolution: 'millisecond' as const,
        defaultTimeout: 1000
      },
      nodes: [
        {
          id: 'client',
          type: 'api-endpoint' as const,
          category: 'compute' as const,
          role: 'source' as const,
          label: 'client',
          position: { x: 0, y: 0 }
        },
        {
          id: 'api',
          type: 'microservice' as const,
          category: 'compute' as const,
          role: 'processor' as const,
          label: 'api',
          position: { x: 100, y: 0 },
          queue: { workers: 1, capacity: 10, discipline: 'fifo' as const },
          processing: {
            distribution: { type: 'constant' as const, value: 5 },
            timeout: 1000
          }
        }
      ],
      edges: [
        {
          id: 'client-api',
          source: 'client',
          target: 'api',
          mode: 'synchronous' as const,
          protocol: 'https' as const,
          latency: {
            distribution: { type: 'constant' as const, value: 1 },
            pathType: 'same-dc' as const
          },
          bandwidth: 1000,
          maxConcurrentRequests: 100,
          packetLossRate: 0,
          errorRate: 0
        }
      ],
      workload: {
        sourceNodeId: 'client',
        pattern: 'constant' as const,
        baseRps: 100,
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
      }
    },
    status: 'GRADED' as const,
    startedAt: '2026-08-01T00:00:00.000Z',
    lastSavedAt: '2026-08-01T00:01:00.000Z',
    submittedAt: '2026-08-01T00:01:00.000Z',
    testRunCount: 1,
    grade: {
      gradedAt: '2026-08-01T00:01:00.000Z',
      result: buildGrade()
    }
  }
}

describe('EmbeddedIframeQuestionPreview', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
  })

  it('posts real launch context after ready and renders submit results from the iframe', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const question: EmbeddedIframeQuestion = {
      type: 'embedded-iframe',
      url: 'https://example.com/embed',
      title: 'Embedded assignment',
      allowedOrigins: ['https://example.com'],
      questionPackage: buildQuestionPackage()
    }

    act(() => {
      root?.render(<EmbeddedIframeQuestionPreview question={question} />)
    })

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()

    const postMessage = vi.fn()
    Object.defineProperty(iframe as HTMLIFrameElement, 'contentWindow', {
      value: { postMessage },
      configurable: true
    })

    act(() => {
      iframe?.dispatchEvent(new Event('load'))
    })
    expect(container.textContent).toContain('Iframe loaded. Waiting for handshake')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://example.com',
          data: { type: 'ns-simulator:ready' }
        })
      )
    })

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'ns-simulator:launch-context',
        payload: {
          version: GAME_PLAYGROUND_PAYLOAD_VERSION,
          questionPackage: question.questionPackage
        }
      },
      'https://example.com'
    )
    expect(container.textContent).toContain('Launch context sent to the embedded simulator')

    const attemptState = buildAttemptState()
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://example.com',
          data: {
            type: 'ns-simulator:submit',
            payload: {
              version: GAME_PLAYGROUND_PAYLOAD_VERSION,
              questionId: 'q1',
              questionVersion: '1.0',
              attemptId: 'attempt-1',
              result: {
                version: GAME_PLAYGROUND_PAYLOAD_VERSION,
                status: 'passed',
                tests: attemptState.grade?.result.contract.tests ?? [],
                totalTests: attemptState.grade?.result.contract.totalTests ?? 0,
                passedTests: attemptState.grade?.result.contract.passedTests ?? 0,
                allPassed: attemptState.grade?.result.contract.allPassed ?? false
              },
              attemptState
            }
          }
        })
      )
    })

    expect(container.textContent).toContain('Submission received. 1/1 checks passed.')
    expect(container.textContent).toContain('error rate < 10%')
    expect(container.textContent).toContain('1 passed')
  })

  it('ignores malformed submit payloads from allowed origins', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const question: EmbeddedIframeQuestion = {
      type: 'embedded-iframe',
      url: 'https://example.com/embed',
      title: 'Embedded assignment',
      allowedOrigins: ['https://example.com'],
      questionPackage: buildQuestionPackage()
    }

    act(() => {
      root?.render(<EmbeddedIframeQuestionPreview question={question} />)
    })

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()

    Object.defineProperty(iframe as HTMLIFrameElement, 'contentWindow', {
      value: { postMessage: vi.fn() },
      configurable: true
    })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://example.com',
          data: { type: 'ns-simulator:ready' }
        })
      )
    })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://example.com',
          data: {
            type: 'ns-simulator:submit',
            payload: {
              contract: { totalTests: 1 }
            }
          }
        })
      )
    })

    expect(container.textContent).toContain('Launch context sent to the embedded simulator')
    expect(container.textContent).not.toContain('Submission received.')
  })
})
