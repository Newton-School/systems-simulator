# Release notes: the simulator behaves more like real systems

Covers PR #308. Every change below is covered by a unit test and a browser flow, and each is traced to a source in the
reference chapters (`docs/reference/`, with a study copy at `docs/reference/pdf/ns-simulator-reference.pdf`).

## Read this first: results will differ from earlier runs

If you have saved designs or questions, rerun them. Four things move numbers:

- **Seeded runs draw from independent random streams.** The same seed still gives the same result every time, but not the
  same result as before. Expect changes within normal sampling error. Comparing two designs with the same seed is now more
  accurate.
- **Hops inside a data centre are faster.** Network latency between nodes is now one-way and recalibrated: same-DC 0.25 ms,
  cross-zone 0.5 ms (was 1 ms and 2 ms). Cross-region and internet are unchanged.
- **Retries now cover more, and add up.** A caller retries when the node it calls times out (as long as the request still
  has time left), and retries at several layers multiply: three layers of four attempts send 64 calls, not 4.
- **Defaults changed:** object storage 100 ms read and 150 ms write (was 24 and 36), and a failed node is detected after
  350 s (was 340 s).

## What students will notice

| Before                                                                                                          | Now                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cache that crashed kept serving its old contents when it came back.                                           | It comes back empty and warms up again.                                                                                                                                                                                             |
| A failed cache failed every request that used it.                                                               | Its caller reaches the database instead, and the database takes the full load. Set `onCacheFailure: 'fail'` on the cache to keep the old behaviour.                                                                                 |
| A load balancer with every backend unhealthy rejected everything, and a 10% overload could turn into an outage. | It serves from all backends, and the failed ones refuse on their own.                                                                                                                                                               |
| Background work (logging, async calls) was mixed into user latency and error rate.                              | Asynchronous side branches are reported on their own in `summary.backgroundBranches`. A service whose only outgoing edges are asynchronous completes the user's request there.                                                      |
| Batching charged a worker for the time an item waited for its batch.                                            | The wait adds latency but holds no worker. A busy batch node is limited by its amortised cost, so it serves more.                                                                                                                   |
| Percentiles above 1 s read 1 s.                                                                                 | They read the real value, up to about 18 minutes.                                                                                                                                                                                   |
| `avgInSystem` read slightly low.                                                                                | It is the true time average.                                                                                                                                                                                                        |
| A latency penalty (inspection, token cost, replica wait) was charged again at every later node.                 | It is charged once.                                                                                                                                                                                                                 |
| Importing a design silently ignored some settings.                                                              | The import warns: a data store's typed processing time (the storage profile decides), a `scaling` block that does not scale, an origin with no geolocation target, a normal service time that can go negative, odd mixture weights. |

## New settings and features

All are optional. Leaving them unset keeps today's behaviour unless noted above.

- **Workloads:** `pattern: closed` with `closed: { users, thinkTimeMs }` (a fixed population that waits for each response,
  so the interactive response time law holds); a replay `trace` of `{atMs, type}` arrivals; a diurnal `startHour` for
  real time of day.
- **Failures:** `failureModes` with an `mtbf` and `mttr` now injects random failures; a `gray-failure` fault (health checks
  pass while a share of real requests fail); `electionTimeoutMs` on a quorum store (unavailable until a leader is elected,
  needs a majority); certificate expiry on `certificate-distro` (`certificateValidUntilMs`, `certificateRenewedAtMs`).
- **Capacity and limits:** `autoscalePolicy: 'hpa'` (the Kubernetes rule with a 300 s scale-down window; the step
  autoscaler is still the default); `kmsQuotaRps` on a key service; `rateLimitRps` on a third-party provider (answers a
  retryable 429); a balancer's `healthCheckIntervalMs` and `healthCheckFailureThreshold` (a failed backend keeps
  receiving traffic for interval times threshold); `dnsResolvers` (each resolver caches its answer for the TTL, so a
  failover reaches it late); a `weightSchedule` on an edge for staged rollouts.
- **Components that now do what they say:** `waf` and `firewall` take a block rate and scan time; `kms-security` takes
  crypto time; `identity-provider` and `iam-rbac` enforce authentication; `regionLatencyMs` works on a CDN, traffic
  manager or edge router; cache TTL expires entries (`ttlSeconds`); a queue's visibility timeout redelivers a message that
  is still being processed; a serverless function cold-starts once per concurrent environment (give it a worker pool as
  large as the concurrency you want); `sfu-mcu` and `webrtc-mesh` report room bandwidth from `participants` and
  `bitrateMbps`; `msFirstToken` splits first-token latency from per-token latency.
- **Results:** `sloStatus` (error-budget burn per SLO node) and the rubric selectors `slo.maxBurnRate` and
  `slo.budgetsExceeded.count`; a queue reports `messagesProduced` and `messagesDelivered`; the single-point-of-failure
  check now flags two services of one type in series.
- **New sample:** `metastable-retry-storm`, a 3 s spike that retries keep going long after it ends.

## For question authors and teachers

- Re-run your questions and check numeric targets, especially latency thresholds, retry scenarios and cache-failure
  scenarios. The built-in question bank still passes (every reference solution passes, every deliberately wrong design
  fails).
- The scenario and fault editors do not offer the new options yet. `closed`, `trace`, `startHour` and the `gray-failure`
  fault can be set in JSON, not in the editors. Questions can still use the new rubric selectors in JSON.
- `npm run validate:question-bank` now also reports how many checks separate the reference from the wrong design, so thin
  questions are easy to spot.
- Classroom mode compiles designs without faults, so the fault changes do not touch it. The latency recalibration and the
  random streams apply to it like everywhere else.

## For developers

- New output field: `summary.backgroundBranches { completed, failed, meanLatencyMs }`. Asynchronous branches are no longer
  in `summary.totalRequests`, the error rate or `summary.latency`; node counters still include their work.
- `Request.retryCountByNode` tracks retries per caller, and a new internal event, `queue-visibility-expire`, drives
  redelivery.
- Rejection reasons added: `kms_throttled`, `provider_rate_limited`, `certificate_expired`, `bandwidth_exceeded`,
  `node_timeout` (retryable). `no_healthy_targets` now means the balancer had no targets at all.
- Tests that pinned an exact seeded count were changed to statistical bounds (four standard errors). One expected value
  was corrected: a bulkhead capped at 4 slots against 8 Erlangs rejects 57.5% (Erlang B), not 50%.

## Known limits

- Not built: webhook redelivery over days, IAM policy evaluation (default deny, explicit deny), a remote identity-provider
  call with caching, event-time windows, sloppy quorums, egress and cross-zone transfer cost, write-back cache loss.
- A data store's typed processing time still does not override its storage profile (the import now warns). Set
  `storageReadMs`, `storageWriteMs` and the others to change it.
