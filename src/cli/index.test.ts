import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  parseQuestionEvaluationBatch,
  parseQuestionEvaluationContract
} from '../engine/analysis/evaluationContract'
import {
  CLI_EXIT_EVALUATION_ERROR,
  CLI_EXIT_EVALUATION_FAILED,
  CLI_EXIT_INVALID_SUBMISSION,
  CLI_EXIT_SUCCESS
} from './exitCodes'
import type { QuestionPackage } from '../engine/analysis/question'
import type { EdgeDefinition, TopologyJSON } from '../engine/core/types'

const CLI_ENTRY_PATH = resolve(__dirname, 'index.ts')
const REPO_ROOT = resolve(__dirname, '..', '..')
const TEMP_DIRS: string[] = []

function stripAnsi(text: string): string {
  let output = ''

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\u001b' && text[index + 1] === '[') {
      index += 2
      while (index < text.length && /[0-9;]/.test(text[index])) {
        index += 1
      }
      if (text[index] === 'm') {
        continue
      }
    }

    output += text[index] ?? ''
  }

  return output
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ns-sim-cli-'))
  TEMP_DIRS.push(dir)
  return dir
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8'
  })
}

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: {
      distribution: { type: 'constant', value: 1 },
      pathType: 'same-dc'
    },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(id: string): TopologyJSON {
  return {
    id,
    name: id,
    version: '2.0.0',
    global: {
      simulationDuration: 1_000,
      seed: `${id}-seed`,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1_000
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
        queue: { workers: 1, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: 5 },
          timeout: 1_000
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
  }
}

function question(
  id: string,
  options: {
    rubricValue?: number
    structuralRules?: QuestionPackage['structuralRules']
  } = {}
): QuestionPackage {
  return {
    version: '1.0',
    id,
    title: id,
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Design it',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    ...(options.structuralRules ? { structuralRules: options.structuralRules } : {}),
    suite: {
      name: 'suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline' }]
    },
    rubric: {
      checks: [
        {
          id: 'err',
          description: 'error rate below threshold',
          metric: 'summary.errorRate',
          op: '<',
          value: options.rubricValue ?? 1
        }
      ]
    }
  }
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    rmSync(TEMP_DIRS.pop() as string, { recursive: true, force: true })
  }
})

describe('sim evaluate question CLI', () => {
  it('prints a passed contract to stdout and exits 0', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const topologyPath = resolve(dir, 'topology.json')
    writeJson(questionPath, question('q-pass'))
    writeJson(topologyPath, topology('topology-pass'))

    const result = runCli([
      'evaluate',
      'question',
      questionPath,
      topologyPath,
      '--attempt-id',
      'attempt-1',
      '--submission-id',
      'sub-1',
      '--evaluated-at',
      '2026-08-01T00:00:00.000Z'
    ])

    expect(result.status).toBe(CLI_EXIT_SUCCESS)
    expect(stripAnsi(result.stderr)).toContain('Question q-pass:')

    const parsed = parseQuestionEvaluationContract(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      version: '1.0',
      mode: 'question',
      questionId: 'q-pass',
      topologyId: 'topology-pass',
      attemptId: 'attempt-1',
      submissionId: 'sub-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
      status: 'passed'
    })
  })

  it('prints a failed contract for valid submissions that miss grading checks and exits 2', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const topologyPath = resolve(dir, 'topology.json')
    writeJson(
      questionPath,
      question('q-fail', {
        structuralRules: [
          {
            id: 'need-lb',
            description: 'Needs a load balancer',
            kind: 'requires_component',
            componentType: 'load-balancer'
          }
        ]
      })
    )
    writeJson(topologyPath, topology('topology-fail'))

    const result = runCli(['evaluate', 'question', questionPath, topologyPath])

    expect(result.status).toBe(CLI_EXIT_EVALUATION_FAILED)

    const parsed = parseQuestionEvaluationContract(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      questionId: 'q-fail',
      topologyId: 'topology-fail',
      status: 'failed',
      summary: {
        failedTests: 2
      }
    })
  })

  it('normalizes invalid student topologies into an invalid_submission contract and exits 3', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const topologyPath = resolve(dir, 'topology.json')
    writeJson(questionPath, question('q-invalid-topology'))
    writeJson(topologyPath, { id: 'bad-topology', version: '2.0.0' })

    const result = runCli(['evaluate', 'question', questionPath, topologyPath])

    expect(result.status).toBe(CLI_EXIT_INVALID_SUBMISSION)

    const parsed = parseQuestionEvaluationContract(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      questionId: 'q-invalid-topology',
      topologyId: 'bad-topology',
      topologySchemaVersion: '2.0.0',
      status: 'invalid_submission',
      error: {
        code: 'INVALID_SUBMISSION'
      }
    })
    if (!('error' in parsed)) {
      throw new Error('Expected an invalid_submission contract to include an error payload.')
    }
    expect(parsed.error.message).toContain('Student topology validation failed:')
  })

  it('normalizes invalid question packages into an evaluation_error contract and exits 4', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const topologyPath = resolve(dir, 'topology.json')
    writeJson(questionPath, { id: 'broken-question', version: '1.0' })
    writeJson(topologyPath, topology('topology-pass'))

    const result = runCli(['evaluate', 'question', questionPath, topologyPath])

    expect(result.status).toBe(CLI_EXIT_EVALUATION_ERROR)

    const parsed = parseQuestionEvaluationContract(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      questionId: 'broken-question',
      topologyId: 'topology-pass',
      status: 'evaluation_error',
      error: {
        code: 'EVALUATION_ERROR'
      }
    })
  })
})

describe('sim evaluate question-batch CLI', () => {
  it('exits 2 with --require-pass when at least one valid attempt fails grading', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const topologyPath = resolve(dir, 'topology.json')
    const batchPath = resolve(dir, 'batch.json')

    writeJson(
      questionPath,
      question('q-batch-fail', {
        structuralRules: [
          {
            id: 'need-lb',
            description: 'Needs a load balancer',
            kind: 'requires_component',
            componentType: 'load-balancer'
          }
        ]
      })
    )
    writeJson(topologyPath, topology('topology-batch-fail'))
    writeJson(batchPath, {
      attempts: [{ attemptId: 'attempt-1', question: questionPath, topology: topologyPath }]
    })

    const result = runCli(['evaluate', 'question-batch', batchPath, '--require-pass'])

    expect(result.status).toBe(CLI_EXIT_EVALUATION_FAILED)

    const parsed = parseQuestionEvaluationBatch(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      mode: 'question-batch',
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        invalidSubmissions: 0,
        evaluationErrors: 0
      }
    })
  })

  it('exits 3 when a batch contains invalid submissions', () => {
    const dir = tempDir()
    const questionPath = resolve(dir, 'question.json')
    const batchPath = resolve(dir, 'batch.json')

    writeJson(questionPath, question('q-batch-invalid'))
    writeJson(batchPath, {
      attempts: [
        {
          attemptId: 'attempt-1',
          question: questionPath,
          topology: { id: 'bad-topology', version: '2.0.0' }
        }
      ]
    })

    const result = runCli(['evaluate', 'question-batch', batchPath])

    expect(result.status).toBe(CLI_EXIT_INVALID_SUBMISSION)

    const parsed = parseQuestionEvaluationBatch(JSON.parse(result.stdout))
    expect(parsed).toMatchObject({
      mode: 'question-batch',
      summary: {
        total: 1,
        passed: 0,
        failed: 0,
        invalidSubmissions: 1,
        evaluationErrors: 0
      }
    })
  })
})
