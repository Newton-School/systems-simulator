import { describe, expect, it } from 'vitest'
import {
  AUTHORING_METRIC_RULE_CAPABILITIES,
  authoringMetricRuleReducer,
  compileAuthoringMetricRule,
  createAuthoringMetricRule
} from './questionAuthoringMetricRules'

describe('Question Studio metric grading rules', () => {
  it('offers the checkpoint metrics through engine-owned rubric selectors', () => {
    expect(
      AUTHORING_METRIC_RULE_CAPABILITIES.map((capability) => ({
        metric: capability.metric,
        selector: capability.metricSelector,
        kind: capability.rubricCapability.kind,
        evidence: capability.rubricCapability.evidenceModes
      }))
    ).toEqual([
      {
        metric: 'latency_p99',
        selector: 'summary.latency.p99',
        kind: 'simulation',
        evidence: ['discrete', 'analytic']
      },
      {
        metric: 'error_rate',
        selector: 'summary.errorRate',
        kind: 'simulation',
        evidence: ['discrete', 'analytic']
      },
      {
        metric: 'throughput',
        selector: 'summary.throughput',
        kind: 'simulation',
        evidence: ['discrete', 'analytic']
      }
    ])
  })

  it('compiles p99, percentage error rate, and throughput into runtime rubric checks', () => {
    expect(compileAuthoringMetricRule(createAuthoringMetricRule())).toEqual({
      id: 'metric-target',
      description: 'P99 latency must be below 100 ms.',
      kind: 'simulation',
      metric: 'summary.latency.p99',
      op: '<',
      value: 100
    })

    expect(
      compileAuthoringMetricRule({
        ...createAuthoringMetricRule('error_rate', 'error-target'),
        value: 1
      })
    ).toEqual({
      id: 'error-target',
      description: 'Error rate must be below 1%.',
      kind: 'simulation',
      metric: 'summary.errorRate',
      op: '<',
      value: 0.01
    })

    expect(
      compileAuthoringMetricRule({
        ...createAuthoringMetricRule('throughput', 'throughput-target'),
        value: 2500
      })
    ).toEqual({
      id: 'throughput-target',
      description: 'Throughput must be at least 2,500 req/s.',
      kind: 'simulation',
      metric: 'summary.throughput',
      op: '>=',
      value: 2500
    })
  })

  it('keeps incomplete values saveable but refuses to compile them', () => {
    expect(compileAuthoringMetricRule({ ...createAuthoringMetricRule(), value: null })).toBeNull()
  })

  it('normalizes dependent fields on metric changes and preserves stable IDs', () => {
    const original = createAuthoringMetricRule('latency_p99', 'metric-stable')
    const duplicate = authoringMetricRuleReducer([original], {
      type: 'add',
      rule: { ...original, value: 200 }
    })
    const [throughput] = authoringMetricRuleReducer(duplicate, {
      type: 'update-metric',
      id: 'metric-stable',
      metric: 'throughput'
    })

    expect(duplicate).toEqual([original])
    expect(throughput).toEqual({
      id: 'metric-stable',
      metric: 'throughput',
      operator: '>=',
      value: 1000,
      unit: 'req_per_sec'
    })
  })
})
