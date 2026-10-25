# 22. Failure semantics and chaos

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established knowledge or derived here,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

How components fail, how failure spreads, and how to inject it. Builds on chapter 02 (timeouts, retries, breakers,
load shedding), chapter 07 (health checks), chapter 11 (failover) and chapter 14 (node and machine loss).

## 1. How a component fails

| Failure                                           | What the caller sees                                        | Latency shape                                              |
| ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| **Fail-stop (clean crash, connection refused)**   | immediate error                                             | fast: one round trip                                       |
| **Crash-restart**                                 | errors, then success after restart; in-flight requests lost | fast errors, then a cold start (caches empty)              |
| **Blackhole (packets vanish, host or path dead)** | nothing; the client waits                                   | **the full client timeout**                                |
| **Hang (accepts, never answers)**                 | connection opens, no response; backlog fills then overflows | timeout wall; capacity also lost as workers are held       |
| **Degraded (slow, partial)**                      | success but slower, or some requests fail                   | service time multiplied for a fraction of requests         |
| **Gray failure**                                  | works for some observers, fails for others                  | looks healthy to the checker, unhealthy to the application |

- A real server failure is usually **silence**: clients keep the connection open and burn their whole timeout, so latency during an outage **walls at the timeout** rather than dropping. A fast refusal models only a TCP reset or a failure hidden by a load balancer. [K, consistent with chapter 02]
- **Gray failure** (Huang et al., HotOS 2017) is defined by **differential observability**: the system's failure detectors report healthy while an application is experiencing failure. Subtle faults like severe slowness, random packet loss, flaky I/O and memory thrashing cause most major availability incidents in cloud systems, more than fail-stop failures. [S: abstract and summaries]
- **Crash-restart** loses in-flight state; whether requests held at the moment of failure are reset or resume at recovery depends on the system (a hung connection may resume, a restarted process cannot). [K]

## 2. How failure spreads

A **cascading failure** grows over time through positive feedback: a partial failure raises the chance that other parts fail. [P: Google SRE book, Addressing Cascading Failures]

- **Overload on the survivors.** Losing one of N equal servers moves load to the rest: survivor utilization = rho x N / (N - 1). Cluster B lost, cluster A goes from 1,000 to 1,200 QPS and its frontends start failing; a service healthy at 10,000 QPS that fails at 11,000 may need load cut to about 1,000 QPS to recover when only 10% of servers are healthy. [P, computed]
- **Retry amplification.** Retries at several layers multiply: four attempts per layer across three layers is 4^3 = **64** attempts on the database. [P] A backend limit of 10,000 QPS with a steady 10,100 QPS of demand gets pushed over by its own retries. [P]
- **Bimodal latency.** With 1,000 threads, if 5% of requests hang for a 100 s deadline, 5,000 threads would be needed; only about 19.6% of requests are served, roughly 80% see errors, though just 5% actually failed. [P]
- **Resource exhaustion:** CPU, memory, threads and file descriptors run out, so in-flight requests, missed deadlines and failed health checks feed on each other (a garbage-collection death spiral). [P]
- **Cold caches:** a restarted node or cluster comes back with empty caches and overloads its backends (chapter 10). [P]

**Metastable failure** (Bronson et al., HotOS 2021): a system is in a vulnerable state, a **trigger** causes temporary overload, and a **sustaining effect** (work amplification from a common-case optimisation such as retries or caching) keeps it failed **after the trigger is gone**. The sustaining loop, not the trigger, is the root cause; retries are the leading example. Practitioners have used other names: retry storm, death spiral, persistent congestion. [S: abstract and summaries]

**Mitigations** (SRE book): [P]

- Load test to failure; plan **N+2** capacity.
- **Load shedding:** reject early (HTTP 503 above an in-flight threshold); use LIFO or CoDel queueing so stale requests are dropped.
- Keep queues short relative to the thread pool (about 50% or less); a queue 10x the thread count can turn a 100 ms request into 1.1 s.
- **Retry discipline:** randomized exponential backoff with jitter, a per-request cap, a per-process retry budget, retry at one layer only.
- **Deadline propagation** and **fail fast** when a backend is known to be down.
- Separate **liveness** (restart me) from **readiness** (send me traffic) so health checks do not restart a service that is merely overloaded.
- Recovery: add capacity, pause batch work, drop traffic hard (to 1%) and ramp up, fix the trigger.

## 3. Correlated failure and blast radius

- **Fault domains:** a region, availability zone or subnet failing takes every component placed in it; a component stays down until **every** domain containing it has recovered. [repo]
- **Blast radius** is the share of users or capacity one fault can affect: cells, shards and zones shrink it. Losing one of 3 zones removes 1/3 of capacity and raises survivor load to 1.5x. [computed]
- **Shared dependencies** (a DNS server, a certificate, a database) turn independent components into one failure. [K]
- **Common-mode failure:** the same bad deployment or configuration reaches every replica (chapter 17). [K]

## 4. Chaos experiments

Define a steady-state metric, hypothesise that it holds under a realistic fault, inject the fault with a limited blast radius and an abort condition, compare (chapter 17). A useful experiment names the fault type, the target, the start, the duration and what recovery looks like. [K]

## 5. Simulator parameter map

| Setting                                             | Meaning                                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-failure` fault, `mode`                        | `reject` (instant `node_failed`), `blackhole` (client waits its timeout), `hang` (backlog fills to capacity then overflows), `degraded` (serving, with a service-time change) |
| `inFlightPolicy`                                    | `reset` or `hang`: what happens to queued and in-service requests at failure                                                                                                  |
| `recoveryPolicy`                                    | `resume` or `reset`: what happens to held requests at recovery (hang only)                                                                                                    |
| `degradation { fraction, serviceTimeMultiplier }`   | share of requests affected and how much slower                                                                                                                                |
| `atMs`, `durationMs`, `duration: permanent / fixed` | when the fault starts and for how long                                                                                                                                        |
| fault `targetId` = location                         | fails every component in a region, availability zone or subnet                                                                                                                |
| `cache-flush` fault                                 | empties a cache (chapter 10)                                                                                                                                                  |
| cluster `machineFailureAtMs`                        | scripted machine loss (chapter 14)                                                                                                                                            |

[repo] The default for chaos injection is a **silent dead server**: new arrivals are blackholed, in-flight requests hang, and recovery resets any still-held requests. The legacy path is an instant rejection.

## 6. Testable expectations (summary)

- `reject` returns fast (about one edge hop); `blackhole` and `hang` wall at the client timeout.
- `degraded` raises latency by the multiplier for the stated fraction of requests and loses none.
- Removing 1 of N equal servers raises survivor utilization to rho x N / (N - 1).
- A fault on an availability zone fails exactly the components placed in it, and a component in two domains stays down until both recover.
- Retries at k layers multiply load by the product of attempts; with retries off the same fault does not cause collapse.
- A recovered node starts with cold state (empty cache, no warm connections).
- Fault duration bounds the outage; a permanent fault never recovers.

## 7. Open items

- Fetch and cite: the full metastable-failure paper and the OSDI 2022 follow-up ("Metastable Failures in the Wild"); the gray-failure paper's own definition; AWS Builders' Library on avoiding fallback and on static stability.
- Decisions `[?]`: whether health checks should be able to see a gray failure (a check that passes while requests fail) and whether a metastable-failure scenario should be a built-in template.

## Sources

- [Addressing Cascading Failures, Google SRE book](https://sre.google/sre-book/addressing-cascading-failures/) [P]
- [Metastable Failures in Distributed Systems, HotOS 2021 (summary by Marc Brooker)](https://brooker.co.za/blog/2021/05/24/metastable/) [S]
- [Metastable Failures in the Wild, OSDI 2022](https://www.usenix.org/conference/osdi22/presentation/huang-lexiang) [S]
- [Gray Failure: The Achilles' Heel of Cloud-Scale Systems, Microsoft Research](https://www.microsoft.com/en-us/research/publication/gray-failure-achilles-heel-cloud-scale-systems/) [S]
