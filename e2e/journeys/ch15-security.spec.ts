/**
 * Chapter 15: security and identity (docs/reference/15-security-and-identity.md).
 * Expected values come from the chapter: no credential means no entry, an expired, invalid or under-scoped one is refused with its
 * own reason, a scanning hop blocks its block rate and delays what it passes, an encryption call costs its CPU time, costs
 * on one path add up, a remote validation dependency is Little's law. The WAF, firewall, KMS and identity-provider
 * types should do what the chapter says; where the engine does not, the test is tracked. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { relErr } from '../support/oracles'
import { chain, queueNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 30_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]

/** source -> guard -> backend, the guard a security-category node with 1 ms of its own service time. */
function guarded(
  seed: string,
  type: string,
  category: string,
  config: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
  over: Partial<RunSpec> = {}
) {
  return chain({
    run: run(seed, over),
    nodes: [
      queueNode('guard', type, { category, serviceMs: 1, workers: 64, config }),
      queueNode('backend', 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })
    ],
    edges: [tcp('source', 'guard'), tcp('guard', 'backend')],
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100, metadata }]
  })
}

const reasons = (out: Out) => [...new Set(out.requestOutcomes.map((o) => o.reasonCode ?? 'ok'))]
const SEC = 'security-and-identity'

// ───────────────────────── 1. Authentication and authorization ─────────────────────────

test.describe('SEC-01 a request is refused with the reason it fails for (ch15 section 2)', () => {
  const auth = { authenticationEnabled: true, authRequiredScopes: 'read,write' }
  const call = (metadata: Record<string, unknown>) =>
    runEngine(
      guarded('sec01', 'api-gateway', 'network-and-edge', auth, metadata, { durationMs: 5000 })
    )

  const cases: [string, Record<string, unknown>, string][] = [
    ['no credential at all', {}, 'auth_missing_credentials'],
    [
      'an invalid credential',
      { authToken: 't', authStatus: 'invalid' },
      'auth_invalid_credentials'
    ],
    [
      'an expired credential',
      { authToken: 't', authStatus: 'expired' },
      'auth_expired_credentials'
    ],
    [
      'a valid credential with one of two scopes',
      { authToken: 't', authScopes: 'read' },
      'auth_forbidden'
    ],
    ['a valid credential with no scopes', { authToken: 't' }, 'auth_forbidden']
  ]
  for (const [name, metadata, reason] of cases) {
    test(`${name}: every request refused as ${reason}`, () => {
      const out = call(metadata)
      expect(out.summary.successfulRequests).toBe(0)
      expect(reasons(out)).toEqual([reason])
    })
  }

  test('a valid credential with every required scope is admitted', () => {
    const out = call({ authToken: 't', authScopes: 'read,write' })
    expect(out.summary.failedRequests).toBe(0)
    expect(out.perNode.backend.totalArrived).toBeGreaterThan(400)
  })

  test('refusal happens at the gate: the backend sees none of the refused traffic', () => {
    expect(call({}).perNode.backend.totalArrived).toBe(0)
  })

  test('authentication off lets everything through', () => {
    const out = runEngine(
      guarded('sec01b', 'api-gateway', 'network-and-edge', {}, {}, { durationMs: 5000 })
    )
    expect(out.summary.failedRequests).toBe(0)
  })
})

// ───────────────────────── 2. Inspection ─────────────────────────

test.describe('SEC-02 a scanning hop blocks its block rate and delays what it passes (ch15 section 3)', () => {
  for (const blockRate of [0.05, 0.2, 0.5]) {
    test(`block rate ${blockRate}: blocked share within 4 standard errors, backend load falls by the same share`, () => {
      const out = runEngine(
        guarded(
          'sec02',
          'network-policy',
          SEC,
          { inspectionMs: 10, blockRate },
          {},
          { durationMs: 60_000 }
        )
      )
      const n = out.perNode.guard.totalArrived
      const se = Math.sqrt((blockRate * (1 - blockRate)) / n)
      const blocked = out.requestOutcomes.filter(
        (o) => o.reasonCode === 'inspection_blocked'
      ).length
      expect(Math.abs(blocked / n - blockRate)).toBeLessThan(4 * se)
      // the last request or two can still be in the guard when the run ends
      expect(Math.abs(out.perNode.backend.totalArrived - (n - blocked))).toBeLessThanOrEqual(2)
    })
  }

  test('a request that passes pays the inspection time: 1 ms of service + 10 ms scanning', () => {
    const out = runEngine(
      chain({
        run: run('sec02b'),
        nodes: [
          queueNode('guard', 'network-policy', {
            category: SEC,
            serviceMs: 1,
            workers: 64,
            config: { inspectionMs: 10 }
          })
        ],
        edges: [tcp('source', 'guard')]
      })
    )
    expect(Math.abs(out.summary.latency.mean - 11)).toBeLessThan(0.15)
  })

  test('with block rate 1 nothing passes', () => {
    const out = runEngine(
      guarded('sec02c', 'policy-engine', 'auxiliary', { blockRate: 1 }, {}, { durationMs: 5000 })
    )
    expect(out.summary.successfulRequests).toBe(0)
  })
})

test.describe('SEC-03 an encryption call costs its CPU time (ch15 section 4)', () => {
  const kms = (seed: string, extra: Record<string, unknown>[] = []) =>
    runEngine(
      chain({
        run: run(seed),
        nodes: [
          queueNode('guard', 'kms-storage', {
            category: 'storage-and-data',
            serviceMs: 1,
            workers: 64,
            config: { cryptoMs: 8 }
          }),
          ...extra
        ],
        edges: [tcp('source', 'guard'), ...extra.map((e) => tcp('guard', e.id as string))]
      })
    )

  test('8 ms of crypto on a storage KMS adds 8 ms to every request', () => {
    const out = kms('sec03')
    expect(Math.abs(out.summary.latency.mean - (1 + 8))).toBeLessThan(0.15)
    expect(out.perNode.guard.traitCounters.cryptoOps).toBe(out.perNode.guard.totalArrived)
  })

  // Tracked gap (finding 22): a latency penalty set by a node is charged again at every node after it, because the
  // request keeps it in its metadata. 8 ms of crypto in front of one 1 ms service should cost 8 ms once.
  test.fail('the crypto time is paid once, not again at each service after the KMS', () => {
    const out = kms('sec03b', [
      queueNode('backend', 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })
    ])
    expect(Math.abs(out.summary.latency.mean - (1 + 8 + 1))).toBeLessThan(0.3)
  })

  test.fail('an inspection hop in front of four services costs its 10 ms once', () => {
    const ids = ['b0', 'b1', 'b2', 'b3']
    const out = runEngine(
      chain({
        run: run('sec03c'),
        nodes: [
          queueNode('gate', 'network-policy', {
            category: SEC,
            serviceMs: 1,
            workers: 64,
            config: { inspectionMs: 10 }
          }),
          ...ids.map((id) =>
            queueNode(id, 'microservice', { category: 'compute', serviceMs: 1, workers: 64 })
          )
        ],
        edges: [
          tcp('source', 'gate'),
          tcp('gate', 'b0'),
          tcp('b0', 'b1'),
          tcp('b1', 'b2'),
          tcp('b2', 'b3')
        ]
      })
    )
    expect(Math.abs(out.summary.latency.mean - (1 + 10 + 4))).toBeLessThan(0.4)
  })
})

test.describe("SEC-04 a remote validation dependency is Little's law (ch15 section 2)", () => {
  test('2,000 req/s each calling a 5 ms identity provider keeps 10 calls in flight', () => {
    const idp = queueNode('idp', 'auth-service', {
      category: SEC,
      serviceMs: 5,
      workers: 200,
      capacity: 10_000
    })
    const out = runEngine(
      chain({
        run: run('sec04', { rps: 2000, durationMs: 20_000 }),
        nodes: [idp],
        edges: [tcp('source', 'idp')]
      })
    )
    const check = out.littlesLawCheck.find((c) => c.nodeId === 'idp')!
    expect(relErr(check.observedL, 2000 * 0.005)).toBeLessThan(0.02)
  })
})

// ───────────────────────── 3. The chapter's other controls (tracked gaps) ─────────────────────────

test.describe('SEC-05 the WAF, firewall, KMS and identity types do what the chapter says (ch15 sections 1, 3 and 4)', () => {
  // Tracked gap (finding 24): the inspection trait applies to network-policy and policy-engine only. A node typed
  // `waf` or `firewall` accepts no block rate or inspection time, so the WAF of a design blocks nothing and scans for free.
  test.fail('a WAF with a 20% block rate blocks about 20% of requests', () => {
    const out = runEngine(
      guarded(
        'sec05a',
        'waf',
        SEC,
        { inspectionMs: 10, blockRate: 0.2 },
        {},
        { durationMs: 30_000 }
      )
    )
    expect(Math.abs(out.summary.errorRate - 0.2)).toBeLessThan(0.03)
  })

  test.fail('a firewall with a 20% block rate blocks about 20% of requests', () => {
    const out = runEngine(
      guarded('sec05b', 'firewall', SEC, { blockRate: 0.2 }, {}, { durationMs: 30_000 })
    )
    expect(Math.abs(out.summary.errorRate - 0.2)).toBeLessThan(0.03)
  })

  // Tracked gap (finding 25): the crypto-cost trait applies to `kms-storage` only; the security category's
  // `kms-security` accepts no crypto time.
  test.fail('a security KMS with 8 ms of crypto adds 8 ms per request', () => {
    const out = runEngine(guarded('sec05c', 'kms-security', SEC, { cryptoMs: 8 }))
    expect(Math.abs(out.summary.latency.mean - 10)).toBeLessThan(0.3)
  })

  // Tracked gap (finding 26): authentication is enforced on `api-gateway` and `auth-service` only; an
  // `identity-provider` or `iam-rbac` node in front of a service lets every unauthenticated request through.
  for (const type of ['identity-provider', 'iam-rbac']) {
    test.fail(`${type} refuses a request with no credential`, () => {
      const out = runEngine(
        guarded('sec05d', type, SEC, { authenticationEnabled: true }, {}, { durationMs: 5000 })
      )
      expect(out.summary.successfulRequests).toBe(0)
    })
  }
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('SEC-06 the browser shows the refusals the engine computed', () => {
  test('a gateway that refuses an expired token shows 100% errors', async ({ page }) => {
    const t = guarded(
      'sec06',
      'api-gateway',
      'network-and-edge',
      { authenticationEnabled: true },
      { authToken: 't', authStatus: 'expired' },
      { durationMs: 10_000 }
    )
    const out = runEngine(t)
    expect(out.summary.errorRate).toBe(1)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'guard')
    expect(ui.errorRatePct).toBeCloseTo(100, 0)
  })

  test('a 20% inspection hop shows the engine error rate', async ({ page }) => {
    const t = guarded(
      'sec06b',
      'network-policy',
      SEC,
      { inspectionMs: 5, blockRate: 0.2 },
      {},
      { durationMs: 20_000 }
    )
    const out = runEngine(t)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'guard')
    // A random block draw: the page and the engine use different random streams for the same document, so they agree
    // within sampling error (3 standard errors of 2,000 draws is 2.7 points), not exactly.
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(2.7 * 1.5)
    expect(Math.abs(ui.errorRatePct - 20)).toBeLessThan(3)
  })
})
