# Engine realism update (October 2026)

Read this when authoring or re-checking questions against a simulator that includes
PR #308 ("engine realism"). The capability snapshot (`capability-snapshot.json`,
version `2026-10-26`) already lists the new rubric selectors, workload patterns and
fault types; this page explains what they mean and which old assumptions to drop.

## What authors can now express

### Workloads

| Pattern / field                                      | Use it for                                                                                                                                      | Notes                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pattern: "closed"` + `closed: {users, thinkTimeMs}` | A fixed population that waits for each response (interactive systems, response-time law `R = N/X - Z`). Offered load falls as the design slows. | `baseRps` is not used for arrivals but must stay a positive number (Studio keeps its default). |
| `pattern: "replay"` + `trace: [{atMs, type?}]`       | Exact recorded arrivals. `type` must be one of `requestDistribution`. The run ends after the last arrival.                                      | Studio keeps a trace through edits; enter or paste it in the project JSON.                     |
| `diurnal.startHour` (0 to 24)                        | Start a daily curve at a real hour (a 2 h run from 14 sees hours 14 and 15). Omit it to stretch the 24 hours over the whole run.                | Studio: "Starts at hour of day".                                                               |

Closed traffic is the only pattern where a slow design _reduces_ the load it is
graded on, so do not pair it with a throughput floor expressed in req/s unless that
is the point of the question.

### Faults

- `faultType: "gray-failure"` with `params.errorRate` (0 to 1, default 0.3): the node
  keeps passing health checks while that share of real requests fail. Use it for
  "health checks said it was fine" questions. Studio: Fault → "Looks healthy but
  fails some requests", then the failing share in percent. A balancer does not route
  around it; a retry, hedge or circuit breaker is what saves the learner.
- `faultType: "cache-flush"` and node faults with `mode` are unchanged. A **cache that
  crashes now returns empty** and warms again, and a failed cache no longer fails the
  request: the caller reaches the database, which takes the full load (set
  `onCacheFailure: "fail"` on the cache for the old behaviour). Re-check any
  cache-failure scenario: the database, not the cache, is now the likely bottleneck.

### Rubric selectors

Add these as `RUBRIC_CHECK` metrics (kind `invariant`) when the question is about SLOs
and error budgets:

- `slo.maxBurnRate` - the highest error-budget burn rate over SLO nodes.
- `slo.budgetsExceeded.count` - how many SLO budgets ran out.

They read `sloStatus` in the run output, which exists only for nodes that state an SLO
target. When no node does, `slo.maxBurnRate` has no value and the check fails, so do not
add them to a question whose reference design states no SLO.

### Node settings that matter for questions

All optional; unset keeps the old behaviour. `autoscalePolicy: "hpa"` (300 s scale-down
window; the step autoscaler stays default), `kmsQuotaRps`, `rateLimitRps` (provider
answers a retryable 429), `electionTimeoutMs` (quorum store is unavailable until a
leader is elected, needs a majority), `certificateValidUntilMs` /
`certificateRenewedAtMs`, `dnsResolvers` (each caches the answer for the TTL, so
failover reaches it late), a balancer's `healthCheckIntervalMs` and
`healthCheckFailureThreshold`, `participants` / `bitrateMbps` / `bandwidthLimitMbps` on
`sfu-mcu` and `webrtc-mesh`, `msFirstToken`, an edge `weightSchedule` for staged
rollouts, and `failureModes` with `mtbf` and `mttr` for random failures.

## Behaviour changes to re-check in existing questions

Every bundled example (QuickCart, the food-delivery series, the Classroom QuickCart)
was re-run on the new engine: references still pass, near misses and wrong designs
still fail. Re-run your own questions and look at numeric thresholds first.

1. **Seeded runs use independent random streams.** Same seed, same result every time,
   but not the same numbers as before. Tolerances tighter than normal sampling error
   (about four standard errors) can flip. Prefer margins, not exact counts.
2. **Hops inside a data centre are faster** (one-way: same rack 0.1 ms, same DC
   0.25 ms, cross-zone 0.5 ms; was 1 and 2 ms). Latency ceilings with a few ms of
   headroom may now be too loose, and "multi-AZ costs latency" questions shrink.
   Cross-region and internet are unchanged.
3. **Retries cover node timeouts and compound** (three layers of four attempts send 64
   calls). Retry-storm and metastable questions behave harder; a retry-amplification
   check set for the old behaviour may need a larger margin.
4. **Defaults changed:** object storage 100 ms read / 150 ms write (was 24 / 36);
   failed-node detection 350 s (was 340 s).
5. **Background work is reported separately.** Asynchronous side branches are in
   `summary.backgroundBranches`, not in user latency, error rate or
   `summary.totalRequests`. A fire-and-forget design no longer inflates user latency.
6. **Load balancers** with every backend unhealthy now serve from all of them (panic
   mode) instead of rejecting everything.
7. **Batching** no longer holds a worker while an item waits for its batch.
8. **Percentiles above 1 s** read their true value (up to about 18 minutes).
9. **Importing a design warns** about settings that are ignored: a data store's typed
   processing time (the storage profile decides), a `scaling` block that does not
   scale, an origin with no geolocation target, negative normal service times, odd
   mixture weights. Treat a warning in the reference topology as a bug to fix.

## Checklist when updating a question

1. `npm run audit:simulator-question -- <dir> <slug>` and confirm the reference passes
   and the near miss still fails for the intended reason.
2. Look at thresholds that sit within a few percent or a few ms of the reference's
   measured value; widen them or choose a more robust selector.
3. If a scenario uses a cache fault, retries, a balancer outage or batching, read the
   behaviour change above and confirm the failing design still fails for the right
   reason.
4. Regenerate nothing by hand: `capability-snapshot.json` is generated
   (`npm run check:simulator-question-author-snapshot`).
