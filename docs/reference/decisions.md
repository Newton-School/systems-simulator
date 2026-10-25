# Decision sheet

Every open `[?]` item in the reference chapters and every simulator-versus-reality finding that needs a product call,
grouped, with a recommendation. Effort: **S** a day or less, **M** a few days, **L** a week or more.

**Status: all 56 recommendations accepted.** Items are closed as they are implemented or documented; the tracker at the end of this file says which are done.

**How to answer (used):** reply with `accept all`, or `accept all except D3, D7` and say what you want for those. Anything you
mark **no** gets deleted from the chapters (so the PDF stops saying it is open); anything you mark **yes** becomes a
change with a unit test and a flow, like the thirteen in `42ffa23`. Items marked **doc** need only a sentence in the
chapter, no code.

## A. Testing and numerical policy

| ID  | Question                                                                        | Recommendation                                                                                                               | Effort |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| A1  | Tolerance for comparing a seeded run with a closed form (ch01, ch04)            | 10% for runs of 60 s or more at rho <= 0.8, widening to 20% above 0.9; record replications and half-width beside each oracle | doc    |
| A2  | Which workload patterns count as Poisson for the P-K formula (ch01)             | Only `poisson`; the others use Kingman with their measured arrival CV                                                        | doc    |
| A3  | Event tie-break order at equal timestamps (ch04)                                | Document the existing priority order (system, arrival, processing, departure, timeout)                                       | doc    |
| A4  | Independent random streams per node, so common random numbers work (ch04, E-13) | Yes: one stream per node and purpose. Fixes finding 6 and makes design comparisons much less noisy                           | M      |
| A5  | Report a confidence interval to the user (ch04)                                 | No for now; keep it in the test tooling                                                                                      | -      |

## B. Distributions and workload

| ID  | Question                                                             | Recommendation                                                                                             | Effort |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| B1  | Negative normal draws as service time (ch03)                         | Keep clamping to 0, and warn at import when mean < 3 x sd                                                  | S      |
| B2  | Poisson and Beta used as durations (ch03)                            | Warn at import when they are the service-time distribution; document Beta as a proportion                  | S      |
| B3  | Mixture weights that do not sum to 1 (ch03)                          | Keep normalising, and warn                                                                                 | S      |
| B4  | Closed-population source (N users with think time) (ch05, finding 8) | Yes, as a new source pattern; it makes the interactive response-time law testable                          | M      |
| B5  | A replay trace field (ch05, finding 8)                               | Yes: `trace: [{atMs, type}]` on the workload                                                               | S      |
| B6  | Diurnal time mapping (ch05)                                          | Keep "the curve spans the run" as the default; add an optional start-hour so a run can be a real afternoon | S      |
| B7  | Heavy-tailed burst durations (ch05)                                  | No; document the fixed burst length as a lower bound                                                       | doc    |

## C. Network and routing

| ID  | Question                                                                                  | Recommendation                                                                                                                         | Effort |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1  | Path-type latency is one-way or round trip, and whether to recalibrate (ch08, finding 13) | Define it as one-way; recalibrate `same-dc` to 0.25 ms and `cross-zone` to 0.5 ms (half the measured round trips); keep `cross-region` | S      |
| C2  | Charge response transfer on the way back (ch08)                                           | No; document that responses do not traverse edges                                                                                      | doc    |
| C3  | When every target is unhealthy: reject or serve anyway (ch02, ch07, finding 9)            | Serve anyway when ALL are unhealthy (Envoy-style panic), reject only when the set is empty. Removes the 85% outage in `N-16`           | M      |
| C4  | Least-connections counts connections or in-flight requests (ch07)                         | In-flight requests                                                                                                                     | doc    |
| C5  | A balancer's own health-check delay (interval x threshold) (finding 4)                    | Yes, optional: `healthCheckIntervalMs` and `healthCheckFailureThreshold`; unset keeps today's instant behaviour                        | M      |
| C6  | Connection reuse without client identity (finding 15)                                     | Document only                                                                                                                          | doc    |

## D. Reliability, caching and storage

| ID  | Question                                                                                | Recommendation                                                                                              | Effort |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| D1  | Retries on timeouts (ch02, finding 3)                                                   | Yes: a timeout is the most common retried failure                                                           | M      |
| D2  | Deadline propagation (ch02)                                                             | Yes later; document as not modelled now                                                                     | doc    |
| D3  | Circuit breaker half-open probe count and close rule (ch02)                             | One probe call, close on its success; a `halfOpenProbes` setting for more                                   | S      |
| D4  | Token bucket or leaky bucket for the simulated limiter (ch02)                           | Token bucket (the chapter's model)                                                                          | doc    |
| D5  | Default behaviour when a cache is down (ch10, `C-08`)                                   | Fall back to the store by default, with `onCacheFailure: fail` available; the real failure is the load jump | M      |
| D6  | Write-back with data loss (ch10)                                                        | No                                                                                                          | -      |
| D7  | An authored processing time on a data store is replaced by the storage profile (`S-07`) | The authored time wins; the profile is only the default                                                     | S      |
| D8  | Default object-storage latency (finding 39)                                             | Raise to about 100 ms read, 150 ms write (S3's documented first byte), keep the others                      | S      |
| D9  | Index depth and compaction stalls (ch09)                                                | No                                                                                                          | -      |
| D10 | How a split shard divides its keys, and whether it is instant (ch12)                    | Halve the key range, instant; document                                                                      | doc    |

## E. Messaging, batching and reporting

| ID  | Question                                                                                    | Recommendation                                                                                                                                        | Effort |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| E1  | Rename queue and stream counters to "produced" and "delivered" (ch13)                       | Yes                                                                                                                                                   | S      |
| E2  | Batching model (finding 28, ch06, ch18)                                                     | Real batch formation: wait is min(window, (batch - 1) / arrival rate), not charged to a worker; a saturated batch of 8 at 40 ms then serves 200 req/s | L      |
| E3  | Report asynchronous side branches separately from the user-facing request (findings 11, 27) | Yes: the user's latency ends when the user-facing path ends; background work gets its own series. Fixes the log-collector case                        | L      |
| E4  | Compute: CPU contention when workers exceed cores (ch06)                                    | Already modelled for cpu-bound nodes; document                                                                                                        | doc    |

## F. Orchestration, observability and SLOs

| ID  | Question                                                                                           | Recommendation                                                                                                               | Effort |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | Autoscaler follows the HPA ratio formula with tolerance and a scale-down window (finding 23, ch14) | Yes as an opt-in `autoscalePolicy: hpa` (15 s sync, 10% tolerance, 300 s down window); the step autoscaler stays the default | M      |
| F2  | Node-failure detection default 340 s vs Kubernetes 350 s (finding 39)                              | Change to 350 s                                                                                                              | S      |
| F3  | Compute burn rate and SLO status in the output (ch16)                                              | Yes                                                                                                                          | S      |
| F4  | `errorBudget` as a rubric selector (ch29, finding 37)                                              | Yes, with F3                                                                                                                 | S      |
| F5  | Measure question discrimination automatically (ch29)                                               | Yes: extend `validate:question-bank` to report which checks each gamed design fails                                          | S      |

## G. Failure, security and platform

| ID  | Question                                                                    | Recommendation                                                                      | Effort |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| G1  | `failureModes` (MTBF, MTTR) as random failure injection (finding 37, ch26)  | Yes: it is documented and validated, so it should work                              | M      |
| G2  | The unread `scaling` block (finding 37)                                     | Remove it from the schema and warn at import if present                             | S      |
| G3  | Health checks able to see a gray failure (ch22)                             | Yes: a `gray` fault mode where probes pass and a share of real requests fail        | M      |
| G4  | Metastable-failure scenario as a built-in template (ch22)                   | Yes, one template with a retry loop                                                 | S      |
| G5  | Election and leader unavailability for quorum stores (ch11)                 | Yes: `electionTimeoutMs`; sloppy quorums no                                         | M      |
| G6  | A KMS request quota (ch15)                                                  | Yes: a per-second quota that throttles                                              | S      |
| G7  | A remote identity-provider call with caching (ch15)                         | No                                                                                  | -      |
| G8  | IAM policy evaluation rules (default deny, explicit deny wins) (finding 26) | No; out of scope for a performance simulator                                        | -      |
| G9  | Certificate expiry and rollout (ch21, `DNS-08`)                             | Yes: an `expiresAtMs` on `certificate-distro` that fails new connections after it   | M      |
| G10 | DNS TTL granularity (finding 32)                                            | A `dnsResolvers` count (default 1): each resolver caches its own answer for the TTL | M      |
| G11 | An unmapped geolocation origin (ch21)                                       | Route to the first target, and warn at import                                       | S      |

## H. Integration, real-time, patterns and cost

| ID  | Question                                                                       | Recommendation                                                            | Effort |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| H1  | Provider rate limits on third-party nodes (ch20, `INT-04`)                     | Yes: `rateLimitRps`, answering 429 with a retry-after                     | S      |
| H2  | Per-participant bandwidth on SFU and MCU, and reconnect storms (ch19, `RT-04`) | Yes: bandwidth in and out per participant; storms via the existing jitter | M      |
| H3  | Saga and outbox as first-class components (ch24)                               | No; keep them as compositions                                             | -      |
| H4  | Deployment-controller and feature-flag behaviour beyond routing (ch17)         | A staged-rollout helper that changes a route weight on a schedule         | M      |
| H5  | Pricing multipliers follow real discounts (ch23)                               | Keep the conservative values and label them as such                       | doc    |
| H6  | Egress and cross-zone transfer cost (ch23)                                     | Yes later; not now                                                        | -      |
| H7  | Event-time windows, late data, first-token versus per-token latency (ch18)     | Per-token split yes (S); event-time windows no                            | S      |
| H8  | Grading accepts a written justification as evidence (ch25)                     | Already does (`justify`); document                                        | doc    |

## Totals at the recommendations

**56 decisions.** At the recommendations: 20 small (a day or less), 14 medium (a few days), 2 large (a week or more), 13 doc-only (a sentence in a chapter), 7 no.
The two large ones, E2 (batching) and E3 (async branch reporting), change reported numbers for many designs and
should be reviewed against the question bank first.

## Tracker

All 56 decisions are implemented or documented. One differs from the sheet:

- **D7** (a data store's typed processing time wins): not applied as accepted. Every raw JSON node carries a
  `processing` block as boilerplate, so a placeholder 1 ms on a database would silently bypass its storage profile
  (three existing tests broke). The storage profile stays in charge and the import now warns when a typed time is
  ignored. Say if you want the other behaviour.
- **G2** (remove the `scaling` block): `scaling.coldStartPenalty` is read by serverless functions, so the block stays
  and the import warns that its policy fields are not applied.
- **H2** (reconnect storms): documented as the retry and jitter behaviour of chapter 02, not a separate mechanism.
