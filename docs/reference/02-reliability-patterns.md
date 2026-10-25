# 02. Reliability and resilience patterns

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

Patterns that decide what a node does when it is slow, failing or overloaded. In the simulator they are the
behaviours carried by `timeout`, `retryBackoff`, `circuitBreaker`, `rateLimiter`, `bulkhead`, `loadShedding`,
`healthAwareRouting` and `healthProber`.

## 1. Timeouts

**What it is.** A limit on how long a caller waits for a response. [P: AWS Builders' Library, "Timeouts, retries and
backoff with jitter"]

**How it works in real systems [P]**

- Set one on **every** remote call, covering connection and request time, even for calls on the same host.
- Choose it from the downstream latency distribution: pick an acceptable false-timeout rate (example 0.1%) and use
  the matching percentile (p99.9). Add worst-case network latency for internet clients.
- A too-tight timeout causes failures after deploys (example: a 20 ms timeout included new TLS setup).
- A dead server usually produces **silence**, not an error: the caller burns its whole timeout. This is why latency during
  an outage walls at the timeout instead of dropping. [D: a caller that receives no reply waits its whole timeout]

**Math.** If a downstream's latency has CDF F(t), timeout T gives false-timeout rate 1 − F(T). Timeout at p99 means 1%
of healthy requests are abandoned. [D]

- Client availability when median latency equals the timeout is about 50%. [P: AWS load-shedding article]

**Testable expectations**

- A request that outlives its timeout is counted as a timeout and its client-observed latency equals the timeout.
- Blackholed/hung node: failed-request latency clusters at the timeout (p50 of failures ≈ T). A `reject` failure returns
  fast (about one network hop).
- Timeout raised above the downstream p99.9: false timeouts → about 0.

**Simulator scope.** Per-node and global `defaultTimeout`. Deadline propagation is not modelled (decided: documented as out of scope for now).

## 2. Retries, backoff and jitter

**What it is.** Re-sending a failed call, usually after a delay, to ride out transient faults. [P: Microsoft Retry pattern; AWS]

**Strategies [P: Microsoft]:** cancel (non-transient), retry immediately (rare fault), retry after delay (busy or
connectivity). Delays can be fixed, incremental or exponential. Log early failures as info and only the last as an error.

**When not to retry [P]:** long-lasting faults, business-logic errors, and as a substitute for scaling. Retry only
**idempotent** operations; otherwise a retry can execute the side effect twice (service processed the request but the
response was lost). Client 4xx errors should generally not be retried unchanged; 5xx may succeed later.

**Delay formulas** (base b, cap C, attempt n starting at 0). The blog text does not state the formulas (they are images); these are read from the
blog's own simulator source. [P: github.com/aws-samples/aws-arch-backoff-simulator, `backoff_simulator.py`]

- No jitter: sleep = min(C, b·2ⁿ)
- Full jitter: sleep = random(0, min(C, b·2ⁿ))
- Equal jitter: t = min(C, b·2ⁿ); sleep = t/2 + random(0, t/2)
- Decorrelated jitter: sleep = min(C, random(b, 3·previous_sleep))

Finding [P: AWS blog text]: with 100 contending clients, jitter cut total calls by more than half versus un-jittered
exponential backoff and improved completion time; un-jittered was worst on both; Full and Equal used about the same calls;
Decorrelated used more calls. Jitter does not change the N² growth of total work but reduces it substantially.

**Retry amplification (the dangerous part)**

- Retries are "selfish": they spend more server capacity to raise one caller's success chance. [P: AWS]
- **Per layer:** with up to r retries, worst-case attempts per call = 1 + r.
- **Across layers multiplies:** 3 attempts per layer over 5 layers = 3⁵ = **243x** load on the database. Retry at one
  point in the stack. [P: AWS]
- Expected attempts per call when each attempt fails independently with probability p and up to r retries are allowed:
  E[attempts] = `p^0 + p^1 + ... + p^r` = (1 − p^(r+1)) / (1 − p). Example p = 0.5, r = 3: 1.875x load. If p → 1 it tends to 1 + r. [D]
- **Retry budget:** allow retries from a token bucket (spend a token per retry, refill slowly); when empty, retry at a fixed
  low rate. This caps amplification. [P: AWS, the AWS SDK added it in 2016]

**Failure modes:** retry storm (synchronized retries into a recovering service keep it down), thundering herd, metastable
failure (load stays high after the trigger is gone because retries sustain it). [S: chapter 22 section 2, Bronson et al.]

**Testable expectations**

- Arrivals at a failing downstream ≤ (1 + r) x calls from upstream, and equal that when the downstream is fully down.
- With jitter, retry times of N clients are spread; without, they cluster at b·2ⁿ.
- Non-idempotent operation behind a retry with a lost response produces duplicates unless an idempotency key is used.
- A circuit breaker above a retrying client reduces downstream arrivals after it opens.

## 3. Circuit breaker

**What it is.** A wrapper that stops calling a failing dependency so it can recover and the caller fails fast. [P: Martin Fowler]

**States and transitions [P: Fowler]**

- **Closed:** calls pass; failures are counted. A success resets the count (in the simple version).
- **Open:** calls fail immediately; the protected operation is not invoked.
- **Half-open:** after a reset timeout, a trial call is allowed. Success closes the breaker; failure reopens it and restarts the timeout.

**Trip conditions [P]:** a failure **count** threshold, or a failure **rate** (for example 50%); different thresholds for
different error types; not every error should count. For async work it can trip when a request queue fills; for sync work
when a thread pool is exhausted.

**Variants [S]:** some implementations reopen on any single failed probe; others require N probe successes before closing;
the number of trial calls allowed in half-open varies. Decided: the simulator's `halfOpenRequests` (default 1) is both the number of probe calls allowed and the number of consecutive successes needed to close; any failed probe reopens it. [repo]

**Operational advice [P: Fowler]:** log every state change, expose state, alert on trips and resets, treat frequent trips
as a deeper problem, allow manual trip/reset, and design clients for the failure (fallbacks: queue work, show stale data).

**Caveat [P: AWS]:** breakers add modal behaviour that is hard to test and can lengthen recovery.

**Math.** Fail-fast latency while open ≈ near zero (no call is made), versus a timeout T for each call without a breaker.
Load on the dependency while open ≈ 0 plus probe calls. With rate-based tripping over a window of n calls and threshold θ,
it opens when failures/n ≥ θ. [D]

**Reference defaults (Resilience4j)** [P: resilience4j.readme.io]: failure-rate threshold 50%, count-based window of 100 calls, minimum 100 calls before the rate is evaluated, 60 s open, 10 permitted calls in the half-open state; the half-open breaker closes if both failure and slow-call rates fall below their thresholds and reopens otherwise. Treat these as one library's defaults, not a standard.

**Testable expectations**

- Backend fully down: after threshold failures the breaker opens; subsequent client latency is far below the timeout and
  arrivals at the backend drop to about the probe rate.
- After the reset timeout one probe goes through; the backend recovered → closed and traffic resumes; still down → open again.
- Breaker never opens on errors below the threshold (steady 5% error vs 50% threshold stays closed).

## 4. Rate limiting and throttling

**What it is.** Controlling how fast requests are sent or accepted so a service stays within capacity. Rate limiting
(client or gateway, smoothing outgoing traffic) and throttling (server rejecting excess) are related. [P: Microsoft Rate
Limiting pattern]

**Algorithms** [P: RFC 2697 for the token-bucket form; formulas derived [D]]

- **Token bucket:** bucket capacity C tokens, refill rate R tokens/s. tokens(t) = min(C, tokens(t₀) + R·Δt). A request of
  cost n is admitted only if tokens ≥ n. Allows bursts up to C, long-run rate R.
  Maximum burst length at peak rate M > R from a full bucket: S = C / (M − R). Total sent in the burst = M·S.
- **Leaky bucket:** output fixed at rate R; queue depth Q(t) = max(0, Q(t₀) + arrivals − R·Δt), capped at the bucket size;
  overflow is dropped. Smooths traffic, no bursts out.
- **Fixed window:** count per window, reset at boundaries. Weakness: up to 2x the limit across a boundary.
- **Sliding window (log / counter):** counts over a moving window; avoids the boundary burst at higher memory cost.
- Worked check [S: a GATE exam example]: C = 1 MB, R = 10 MB/s, M = 20 MB/s, burst 12 MB: S = 1/(20 − 10) = 0.1 s sends 2 MB
  at full rate, the remaining 10 MB at 10 MB/s takes 1 s, total 1.1 s.

**Behaviour [P: Microsoft]**

- Naive retry-on-error against a throttled service wastes capacity. Example: 10,000 records, service accepts 2,000 per
  pass: passes of 10,000, 8,000, 6,000, 4,000, 2,000 = **30,000 sends** for 10,000 records (3x) plus 20,000 errors to log.
- Limit by operation count, data volume, or cost units; release in small frequent slices (for example 20 ops every 200 ms
  for a limit of 100/s) rather than one big batch per second.
- Respond with HTTP 429 and `Retry-After`; coordinate retries with the limiter to avoid retry storms.
- Not suitable when the bottleneck is concurrency or CPU rather than request rate.

**Testable expectations**

- Offered rate λ below limit R: no rejects. Above: admitted ≈ R (plus the initial burst of C), rejected ≈ λ − R over the long run.
- Token bucket with C tokens, full at start, offered a burst: first C requests admitted at once.
- Leaky bucket: output rate never exceeds R regardless of input.
- Limit of 0: everything rejected (and flagged as a misconfiguration).

## 5. Bulkhead

**What it is.** Isolate resources into pools so one failing or hungry consumer or dependency cannot take the rest down.
Named after ship hull compartments. Also called cell-based architecture. [P: Microsoft Bulkhead pattern]

**How it works [P]**

- Partition by consumer load or availability requirement; give each downstream its own connection or thread pool;
  separate queues per workload; separate instances per tenant.
- Benefits: contains cascading failure, keeps partial function, allows different quality of service per consumer.
- Costs: less efficient resource use (spare capacity in one pool can't help another), more complexity, partition design.
- Combine with retry, circuit breaker and throttling. Use platform limits (Kubernetes CPU/memory limits) rather than
  re-implementing them.
- Not suitable when lower resource efficiency is unacceptable.

**Math.** Total capacity c split into partitions c₁…c_k (Σ cᵢ = c). A class with offered load Aᵢ saturates when
Aᵢ ≥ cᵢ·(target ρ), without taking capacity from others. Cost of isolation: statistical multiplexing lost, so the
waiting probability at the same total c is higher than a shared pool (Erlang C, chapter 01 section 5). [K]

**Testable expectations**

- Overload one class: its latency rises and rejections appear in its partition only; other classes' latency stays flat.
- With no bulkhead the same overload degrades all classes.
- Idle capacity in one partition is **not** used by another (that's the trade-off).

## 6. Load shedding and goodput

**What it is.** Rejecting excess requests early, near overload, so accepted requests are served fast. [P: AWS Builders' Library,
"Using load shedding to avoid overload"]

**Key ideas [P]**

- **Throughput** = total request rate sent. **Goodput** = the part handled correctly and quickly enough for the client to use.
- Without shedding, past an inflection point latency rises above client timeouts, requests fail, and the work already done
  on them is wasted, so **goodput falls as throughput rises**. With shedding, goodput stays roughly flat (shedding has its own cost).
- Choose what to shed by priority: health-check pings first kept, humans over crawlers, later steps of a flow over first
  steps, within-quota over burst.
- Deadlines: clients send timeout hints; servers drop requests already past their deadline.
- Queues: bound size and max wait; discard stale work; consider LIFO; prefer fast-fail spillover to deep surge queues.
- Proxy max-connection limits are a last resort, set high and below listener threads or file descriptors so health checks pass.
- Keep fast-failed requests out of latency metrics, or they will hide the real latency; shedding can also stop CPU-based autoscaling.
- In deep call graphs retries multiply offered load exponentially.

**Backpressure [D]:** the downstream signals upstream to slow (429/503, a full queue, TCP window, reactive streams
`request(n)`), moving the queue to where it can be bounded.

**Testable expectations**

- Offered load far above capacity: with shedding, accepted-request p99 stays near unloaded p99 and goodput ≈ capacity;
  without shedding, p99 → timeout and goodput collapses toward 0.
- Shed requests are counted as rejections, not as latency samples.
- Conservation: offered = served + shed + failed + in flight.

## 7. Health checks, outlier detection and health-aware routing

**What it is.** Probing instances so routers and orchestrators stop sending traffic to unhealthy ones. [P: Microsoft Health
Endpoint Monitoring pattern]

**How it works [P]**

- **Shallow (liveness):** process responds, no dependency calls; failing it restarts the process.
- **Deep (readiness):** verifies required dependencies; failing it removes the instance from traffic without restart.
  Exclude optional dependencies from the decision. Allow for startup before counting failures.
- Evaluate status code, body and latency. Use thresholds (consecutive failures) so transient blips don't trigger action.
- **Detection delay** ≈ probe interval x consecutive failures needed (+ one timeout). With a 1-minute interval and 3
  failures, a dead instance keeps receiving traffic for about 2 to 3 minutes. [D; matches the Microsoft example of
  one-minute probes]
- Cached probe results add a staleness window up to the cache TTL.
- **Danger:** deep checks against a slow shared dependency can mark every instance unhealthy at once and remove all of them
  (a cascading failure caused by monitoring). Mitigate with dependency timeouts, circuit breakers, or "degraded" status.
  The platform may refuse to remove all instances. [P]
- Failover needs redundant capacity sized to absorb rerouted traffic. [P]

**Testable expectations**

- A failed backend keeps receiving a share of traffic until the detection delay passes; those requests fail or time out.
  After removal, the survivors carry n/(n − 1) of their previous load (chapter 01 section 8).
- Recovery: the backend rejoins after the configured number of consecutive successes. Decided: the backend rejoins after the configured number of consecutive successful probes (the Health Check Manager's `healthyThreshold`).
- All backends unhealthy: the simulator's router serves anyway (panic mode, chapter 07 section 4); it rejects only when it has no targets.

## 8. How the patterns combine (expected interactions)

| Combination                         | Expected behaviour                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Retry above a breaker               | After the breaker opens, retries stop reaching the backend; the caller sees fast failures.          |
| Retry above a limiter               | Retries consume limiter budget; honour `Retry-After` or the storm continues.                        |
| Retry at every layer                | Load multiplies (1 + r)^layers.                                                                     |
| Timeout shorter than downstream p99 | Self-inflicted errors plus wasted downstream work.                                                  |
| Breaker + health checks             | Two removal mechanisms; the faster one (breaker, per caller) acts before the slower probe (shared). |
| Bulkhead + shedding                 | Shed within each partition by priority; one partition's overload stays local.                       |
| Autoscaling + shedding              | Shedding can hide CPU load and block scale-out unless the scale signal includes rejects. [P: AWS]   |

## 9. Where the simulator differs from this chapter

The chapter describes real systems. These are the known places the simulator is simpler. Each has a
tracked test in `e2e/journeys/ch02-reliability.spec.ts`; delete the note when its test starts passing. Rows are removed as they are fixed.

| #   | Chapter says                                                                 | Simulator does today                                                                                                                                              | Tracked by                |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | A configured circuit breaker stops calls to a failing dependency (section 3) | It gates only on `sidecar`, `service-mesh` and `circuit-breaker-controller`. On other nodes the setting is accepted but inert. The validator now warns at import. | `R-03d` (warning is live) |

Rows are removed as the simulator closes them: retries cover a node's own timeout and compound across layers (flows `R-02c`, `F-05`), and a balancer's health check takes an interval and a failure threshold (`healthCheckIntervalMs`, `healthCheckFailureThreshold`, flow `R-07c`; unset keeps instant removal).

## 10. Open items

- Remaining `[K]`: none that carry a number; the Nygard stability patterns (_Release It!_) are cited indirectly through Fowler and Microsoft.
- Owner decisions [?]: half-open probe count and close criterion (Resilience4j reference: 10 probes, close when both rates are below threshold); decided: deadline propagation is not modelled, and the simulated limiter is a token bucket.

## Sources

- [Martin Fowler, CircuitBreaker](https://martinfowler.com/bliki/CircuitBreaker.html) [P]
- [AWS Builders' Library, Timeouts, retries and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter) [P]
- [AWS Builders' Library, Using load shedding to avoid overload](https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload) [P]
- [AWS Architecture Blog, Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) [P, text only; formulas were images]
- [Microsoft, Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry) [P]
- [Microsoft, Bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead) [P]
- [Microsoft, Rate Limiting pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern) [P]
- [Microsoft, Health Endpoint Monitoring pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/health-endpoint-monitoring) [P]
- [Google SRE book, Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) [P]
- [Token bucket, Loyola University networking text](https://intronetworks.cs.luc.edu/current/html/tokenbucket.html) [S]
- [Resilience4j CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker) [P]
- [RFC 2697: single rate three color marker](https://datatracker.ietf.org/doc/html/rfc2697) [P]
- [aws-arch-backoff-simulator](https://github.com/aws-samples/aws-arch-backoff-simulator) [P]
