# 27. Metrics and output glossary

Marks: **[P]** primary, **[S]** secondary, **[K]** established knowledge, **[?]** needs an owner decision,
**[repo]** read from the output types (`src/engine/metrics.ts`, `src/engine/analysis/output.ts`,
`src/engine/analysis/verdict.ts`). See [README](README.md).

Every number a run reports, its exact definition and unit, and the real-world quantity it stands for. The
mathematics behind them is chapter 01 (queueing) and chapter 16 (observability). Section 8 lists the known
differences between a metric's name and what it computes, found while building the flows in `e2e/`.

## 1. Conventions

- Times are **milliseconds** unless a field says otherwise; rates are per second; fractions are 0 to 1.
- **Post-warmup:** metrics keyed `postWarmup*` count only what happened after `global.warmupDuration` (chapter 04). Totals include warmup.
- **Success vs failure:** a request ends as success or as a failure of one cause: `rejected` (refused at a node or edge), `timed_out`, `connection_reset`. `failedRequests` includes the rejected, timed-out and reset ones. [repo]
- **In flight:** requests not yet terminal at the cutoff are in none of the outcome counts; `totalRequests` counts requests that reached an outcome. [repo]

## 2. Run summary (`summary`)

| Field                                                             | Definition                                                                                                                  | Unit         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `totalRequests`                                                   | requests that reached an outcome (success or failure), whole run                                                            | count        |
| `postWarmupTotalRequests`                                         | requests created after warmup                                                                                               | count        |
| `successfulRequests`, `failedRequests`                            | outcomes; `failed = rejected + timed out + reset`                                                                           | count        |
| `rejectedRequests`, `timedOutRequests`, `connectionResetRequests` | failure causes                                                                                                              | count        |
| `throughput`                                                      | successful requests / post-warmup duration (**goodput**, not offered load)                                                  | req/s        |
| `errorRate`                                                       | post-warmup failed / post-warmup total                                                                                      | fraction     |
| `latency`                                                         | p50, p90, p95, p99, min, max, mean of **successful** requests, end to end                                                   | ms           |
| `latencyWindows`                                                  | per-second windows (by termination time): counts, error rate, p50/p95/p99, dominant error cause                             |              |
| `latencyDecomposition`                                            | mean end-to-end latency split per component (edge transit, queue, service), bottleneck first, with `shareOfEndToEnd`        | ms, fraction |
| `failuresByLocus`                                                 | failures grouped by the node or edge that ended them, with cause and `shareOfFailures` (the "who killed my request" Pareto) |              |
| `timeToErrorByCause`                                              | latency of failed requests by cause (a fast refusal and a timeout wall differ)                                              | ms           |
| `offeredArrivalCV`                                                | coefficient of variation of the source's inter-arrival gaps: ~0 constant, ~1 Poisson                                        |              |
| `duration`, `postWarmupDurationSec`                               | run length, and the post-warmup window used as the rate basis                                                               | ms, s        |

Real-world reading: latency is the golden-signal latency of successes (failed requests are tracked separately, chapter 16); throughput is the golden-signal traffic that succeeded; `errorRate` is the SLI complement. [K]

## 3. Per node (`perNode[id]`)

| Field                                                                      | Definition                                                                                                            |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `totalArrived` / `postWarmupArrived`                                       | requests that reached the node                                                                                        |
| `totalProcessed` / `postWarmupProcessed`                                   | requests that completed service (success)                                                                             |
| `totalRejected`, `totalTimedOut`, `totalConnectionReset` (and post-warmup) | failures at this node                                                                                                 |
| `totalFailedAfterService`                                                  | finished service then failed (for example a node error rate); never counted as processed                              |
| `avgQueueLength`, `peakQueueLength`                                        | mean and maximum waiting (not in service)                                                                             |
| `avgQueueWait`, `avgServiceTime`, `avgTimeInSystem`                        | W_q, S and their sum, mean per processed request (ms)                                                                 |
| `avgInSystem`, `peakInSystem`, `finalInSystem`                             | requests present (waiting + in service): sampled mean, peak, and at the end                                           |
| `utilization`                                                              | occupancy of the **binding resource**: CPU for instance-backed nodes (two-tier model), worker pool for legacy nodes   |
| `workerUtilization`                                                        | worker-pool occupancy (integral of active workers / integral of capacity); equals `utilization` for cpu-bound nodes   |
| `throughput`                                                               | post-warmup processed / post-warmup duration                                                                          |
| `errorRate`, `availability`                                                | node-level failure fraction and 1 minus it                                                                            |
| `arrivalCV`                                                                | variation of arrival gaps at this node; above the offered CV means the network bunched requests                       |
| `latencyP50/P95/P99`, `latencyWindows`                                     | node-local latency of successful requests                                                                             |
| `cacheHits`, `cacheMisses`, `cacheHitRatio`                                | cache lookups (chapter 10)                                                                                            |
| `rejectionsByReason`                                                       | counts keyed by reason code (`queue_full`, `node_failed`, `storage_full`, `bulkhead_full`, `no_healthy_targets`, ...) |
| `traitCounters`                                                            | per-feature counters (cache, replication, stream, telemetry, fan-out, windowing, ...)                                 |

Real-world readings: `utilization` is rho (chapter 01), `avgInSystem` is L, `avgQueueWait` is W_q, `avgTimeInSystem` is W; the Little's-law check relates them. [K]

## 4. Per edge (`perEdge[id]`)

`totalSuccessfulTransits`, `totalFailedTerminals`, `bytesTransferred` (post-warmup, for egress cost), `transitLatency` percentiles, `latencyBreakdown` (propagation, transmission, protocol, handshake, ... summing to the mean), `linkUtilization` (time the serialising link was busy / window; 1 means running at bandwidth), `connections` (opened, resumed, reused, waited, closed idle), `slots` (in-flight cap waits and refusals) and `batching`. Meaning: chapter 08. [repo]

## 5. Checks the run performs on itself

| Field                                     | Definition                                                                                                                                             | Pass rule                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `littlesLawCheck[]`                       | per node: observed L (time-averaged) vs lambda x W, with lambda from admitted arrivals                                                                 | within 10% relative or 0.05 absolute            |
| `conservationCheck[]`                     | per node: arrived = processed + rejected + timed out + reset + in flight                                                                               | balanced when in flight is under 5% of arrivals |
| `warmupAdequacy`                          | warmup should be at least 10 x the largest node p99                                                                                                    | adequate or a recommended warmup                |
| `sloBreaches[]`                           | node `slo` targets (`latencyP99` and `availabilityTarget`) exceeded; severity critical at 1.25x the target; `errorBudget` is validated but not checked |                                                 |
| `invariantViolations[]`                   | authored `invariants` conditions that failed                                                                                                           |                                                 |
| `singlePointsOfFailure[]`                 | nodes whose loss disconnects the source from the rest                                                                                                  |                                                 |
| `acceptedWorkConservation`                | accepted = delivered + lost for asynchronous hand-offs                                                                                                 |                                                 |
| `reproducible`, `seed`, `eventsProcessed` | same seed gives the same run                                                                                                                           |                                                 |

## 6. Feature outputs

`streamProjection` (partitions, offsets, group lag; chapter 13), `replicationProjection` and `consistency` (stale reads, read-your-writes and monotonic-read violations, catch-up waits, linearizability; chapter 11), `clusterProjection` (machines, pending pods, recovery times; chapter 14), `perOrigin` (requests, errors, latency, cache hit by client population), `requestOutcomes[]` (one record per request with status, reason code, latency, type, cache outcome and a state timeline), `traces` (sampled spans), `timeSeries` (per-second per-node queue length, active workers, workers, utilization), `statusTimeline`, `causalGraph`, `eventStream`. [repo]

## 7. The verdict (for grading)

`SimulationVerdict` is the grading-facing projection of the output: `meta`, `summary`, `perNode`, `sloBreaches`, `invariantViolations`, `conservation`, `littlesLaw`, and the feature sections. Rubric metrics address it by dotted path (`summary.errorRate`, `summary.latency.p99`, `perNode.<id>.utilization`) or by derived aggregate (`perNode.maxUtilization`, `sloBreaches.count`, `invariantViolations.count`). A metric that cannot be measured is **null and fails its check** rather than passing silently. See chapter 29. [repo]

## 8. Where a name and a computation differ (known)

These come from the flows in `e2e/README.md` (findings), kept here so a reader of the output is not misled.

| Metric                                                       | Caveat                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latency.p50/p95/p99/max`                                    | the histogram tops out at 1 s (1,003.5 ms): any latency above 1 s is reported as 1,003.5 ms while the mean is exact (finding 29)                                                                                                                                                                                                                                                                                        |
| latency of a leaf asynchronous branch                        | when the only edge out of a service is asynchronous, the request is reported as ending at the target, with that target's latency (finding 27)                                                                                                                                                                                                                                                                           |
| `avgInSystem`                                                | a 1 Hz sampled mean whose first sample (t = 0) is always an empty system, so it reads low by about 1 / duration in seconds; the Little's-law check uses the exact time average (finding 16)                                                                                                                                                                                                                             |
| `totalRequests`                                              | counts requests that reached an outcome, not requests generated; in-flight requests at the cutoff are separate (finding 7)                                                                                                                                                                                                                                                                                              |
| `summary.latency` blended with branches                      | an asynchronous branch beside a synchronous path is a separate record in `requestOutcomes` and in the blended percentiles (finding 11)                                                                                                                                                                                                                                                                                  |
| a latency penalty (inspection, crypto, tokens, fan-out tail) | charged again at every node after the one that set it (finding 22)                                                                                                                                                                                                                                                                                                                                                      |
| `failuresByLocus`, `perOrigin`, `requestOutcomes`            | the locus table counts a failure when it ends and `postWarmupFailedRequests` when its request began (a few differ at the warmup edge); `perOrigin` counts requests generated after warmup including those still in flight; `requestOutcomes` has a record with status `in-flight` for every request not yet terminal, so it is longer than `totalRequests`; a timed-out request has status `timeout` and no reason code |
| random-dependent numbers (block rates, hit rates)            | the page and the engine draw different random numbers for the same seed, so they agree within sampling error (finding 30)                                                                                                                                                                                                                                                                                               |

## 9. Testable expectations (summary)

- Reported throughput = successes / post-warmup duration; error rate = failures / total; they add up with the outcome counts.
- A reported percentile is the percentile of the underlying successful latencies (within the histogram's 1% resolution below 1 s).
- Utilization stays within 0 to 1; Little's law and conservation checks hold for a healthy run.
- Each failure appears under exactly one cause and one locus; `failuresByLocus` shares sum to 1.
- The same document and seed give identical output.

## 10. Open items

- Decisions `[?]`: raise the histogram ceiling to the longest configured timeout; report asynchronous branches separately from user-facing requests; make `avgInSystem` the exact time average.
- Fetch and cite: the Prometheus and OpenTelemetry metric naming conventions for the equivalent real-world signals.
