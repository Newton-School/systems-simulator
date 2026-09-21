import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import { validateTopology } from '../validation/validator'
import type { SimulationOutput } from './output'
import type { JustificationAnswer } from './justification'
import {
  compileQuestionPackageToNewtonRows,
  parseNewtonRowsToQuestionPackage,
  toNewtonRowsSeed
} from './newtonQuestionRows'
import { gradeAttemptWithArtifacts, parseQuestionPackage } from './question'

interface QuestionFixture {
  id: string
  question: ReturnType<typeof parseQuestionPackage>
  reference: TopologyJSON
  gamed: TopologyJSON
  referenceAnswers: JustificationAnswer[]
  gamedAnswers: JustificationAnswer[]
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function topology(path: string): TopologyJSON {
  const result = validateTopology(json(path))
  if (!result.valid || !result.data) {
    throw new Error(`Invalid topology fixture: ${path}`)
  }
  return result.data
}

function answers(path: string): JustificationAnswer[] {
  return existsSync(path) ? (json(path) as JustificationAnswer[]) : []
}

function fixtures(): QuestionFixture[] {
  const root = resolve(process.cwd(), 'ns-simulator-docs/examples/question-bank')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const directory = join(root, entry.name)
      const referenceAnswers = answers(join(directory, 'answers.json'))
      const gamedAnswersPath = join(directory, 'gamed-answers.json')
      return {
        id: entry.name,
        question: parseQuestionPackage(json(join(directory, 'question.json'))),
        reference: topology(join(directory, 'reference-topology.json')),
        gamed: topology(join(directory, 'gamed-topology.json')),
        referenceAnswers,
        gamedAnswers: existsSync(gamedAnswersPath) ? answers(gamedAnswersPath) : referenceAnswers
      }
    })
}

describe('canonical Newton row grading parity', () => {
  it('keeps reference and gamed grading contracts unchanged after package → rows → package', () => {
    // The parity obligation is that identical topology + runtime evidence yields
    // an identical contract on either side of the codec. The existing bank
    // validator separately proves the live reference-pass / gamed-fail outcomes.
    const output = {
      summary: {
        totalRequests: 100,
        postWarmupTotalRequests: 100,
        successfulRequests: 99,
        postWarmupSuccessfulRequests: 99,
        failedRequests: 1,
        postWarmupFailedRequests: 1,
        rejectedRequests: 0,
        timedOutRequests: 1,
        connectionResetRequests: 0,
        throughput: 1000,
        errorRate: 0.01,
        latency: { p50: 20, p90: 40, p95: 50, p99: 80, min: 10, max: 100, mean: 25 }
      },
      perNode: {},
      sloTargetCount: 0,
      sloBreaches: [],
      invariantViolations: [],
      conservationCheck: [],
      littlesLawCheck: [],
      seed: 'row-parity',
      simulationDuration: 1000,
      warmupDuration: 0,
      eventsProcessed: 100,
      reproducible: true,
      eventStream: [],
      requestOutcomes: []
    } as unknown as SimulationOutput
    const run = (): SimulationOutput => output

    const bank = fixtures()
    expect(bank).toHaveLength(14)
    for (const fixture of bank) {
      const decoded = parseNewtonRowsToQuestionPackage(
        toNewtonRowsSeed(compileQuestionPackageToNewtonRows(fixture.question))
      ).questionPackage

      for (const [name, candidate, candidateAnswers] of [
        ['reference', fixture.reference, fixture.referenceAnswers],
        ['gamed', fixture.gamed, fixture.gamedAnswers]
      ] as const) {
        const original = gradeAttemptWithArtifacts(
          fixture.question,
          candidate,
          run,
          candidateAnswers
        ).grade.contract
        const roundTripped = gradeAttemptWithArtifacts(decoded, candidate, run, candidateAnswers)
          .grade.contract
        expect(roundTripped, `${fixture.id}/${name}`).toEqual(original)
      }
    }
  })
})
