import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseQuestionPackage, type QuestionPackage } from './question'
import type { TopologyJSON } from '../core/types'
import {
  computeVerificationSignature,
  runQuestionAuthoringVerification,
  type QuestionAuthoringVerificationReport
} from './questionAuthoringVerification'

const BANK = fileURLToPath(
  new URL('../../../ns-simulator-docs/examples/question-bank/cache-placement/', import.meta.url)
)

function load<T>(name: string): T {
  return JSON.parse(readFileSync(`${BANK}${name}`, 'utf8')) as T
}

const pkg: QuestionPackage = parseQuestionPackage(load('question.json'))
const referenceTopology = load<TopologyJSON>('reference-topology.json')
const gamedTopology = load<TopologyJSON>('gamed-topology.json')
const expectedObligationId = (pkg.semanticCriteria ?? [])[0]?.id

// The production grader runs the full discrete engine per design (~6s each), so the
// reports are computed once and shared across assertions.
let readyReport: QuestionAuthoringVerificationReport
let passingGamedReport: QuestionAuthoringVerificationReport
let noGamedReport: QuestionAuthoringVerificationReport

beforeAll(() => {
  readyReport = runQuestionAuthoringVerification(pkg, {
    reference: { id: 'ref', label: 'Reference', topology: referenceTopology },
    gamed: [
      {
        id: 'g1',
        label: 'Cache beside API',
        topology: gamedTopology,
        misconception: 'cache is not on the read path',
        expectedObligationId
      }
    ]
  })
  passingGamedReport = runQuestionAuthoringVerification(pkg, {
    reference: { id: 'ref', label: 'Reference', topology: referenceTopology },
    gamed: [{ id: 'g1', label: 'Actually correct', topology: referenceTopology }]
  })
  noGamedReport = runQuestionAuthoringVerification(pkg, {
    reference: { id: 'ref', label: 'Reference', topology: referenceTopology },
    gamed: []
  })
}, 120000)

describe('Question Studio discrimination verification', () => {
  it('reuses the production grader and auto-router: reference passes on a resolved mode', () => {
    expect(readyReport.reference.overallPassed).toBe(true)
    expect(readyReport.reference.resolvedModes).toContain('discrete')
    expect(readyReport.reference.evidenceBlockers).toEqual([])
  })

  it('catches the gamed design on its intended obligation and is publish-ready', () => {
    expect(readyReport.gamed[0].overallPassed).toBe(false)
    expect(readyReport.gamed[0].expectedDiscriminator).toBe('caught')
    expect(readyReport.gamed[0].accidentalFailure).toBe(false)
    expect(readyReport.ready).toBe(true)
    expect(readyReport.blockers).toEqual([])
  })

  it('is not ready when a gamed design still passes', () => {
    expect(passingGamedReport.gamed[0].overallPassed).toBe(true)
    expect(passingGamedReport.ready).toBe(false)
    expect(passingGamedReport.blockers.some((blocker) => blocker.includes('still passes'))).toBe(
      true
    )
  })

  it('is not ready with no gamed design', () => {
    expect(noGamedReport.ready).toBe(false)
    expect(noGamedReport.blockers).toContain(
      'Add at least one gamed design that the contract must reject.'
    )
  })

  it('produces a stable signature that changes when a design topology changes (pure)', () => {
    const input = {
      reference: { id: 'ref', label: 'Reference', topology: referenceTopology },
      gamed: [{ id: 'g1', label: 'Gamed', topology: gamedTopology }]
    }
    const signature = computeVerificationSignature(pkg, input)
    const swapped = computeVerificationSignature(pkg, {
      ...input,
      gamed: [{ id: 'g1', label: 'Gamed', topology: referenceTopology }]
    })
    expect(signature).toBe(computeVerificationSignature(pkg, input))
    expect(signature).not.toBe(swapped)
  })
})
