# 06. Compute nodes

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 12 `ComputeType`s: `api-endpoint`, `microservice`, `sidecar`, `batch-worker`, `serverless-function`,
`faas-background`, `container`, `vm-instance`, `edge-compute`, `gpu-node`, `auth-service`, `search-service`.
This chapter covers what a compute node is in a real system, how its capacity is sized, and the math that
connects hardware, concurrency and throughput. Queueing results are in chapter 01.

## 1. What a compute node is

A node that takes a request, spends CPU time and usually waits on something else (a database, a cache, a
downstream service), then replies. Capacity is set by **how many requests it can hold in flight** (concurrency)
and **how long each holds a slot** (service time). [D: Little's law, chapter 01]

| Real thing                                | Typical shape                                                       | Simulator type                             |
| ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| Stateless HTTP/gRPC service               | many cheap threads or an event loop, mostly waiting on I/O          | `microservice`, `container`, `vm-instance` |
| Entry point that generates traffic        | not capacity-bound; the source of a workload                        | `api-endpoint`                             |
| Proxy attached to a service (Envoy-style) | small, per-request tax on every call                                | `sidecar`                                  |
| Queue consumer, cron, ETL step            | pulls work, usually CPU-bound, throughput matters more than latency | `batch-worker`, `faas-background`          |
| Function-as-a-service                     | one request per environment, scales out to many, cold starts        | `serverless-function`                      |
| Code at the CDN edge                      | tiny, close to users, short CPU budget                              | `edge-compute`                             |
| Accelerator for model inference           | few, expensive, batch-friendly                                      | `gpu-node`                                 |
| Authentication and search                 | CPU-heavy per request                                               | `auth-service`, `search-service`           |

## 2. Hardware: vCPU, memory and instance families

- A **vCPU is a hardware thread**, not a core: vCPUs = cores x threads per core. An `m5.large` is 1 core x 2 threads = **2 vCPU**, 8 GiB. [P: AWS EC2 instance types]
- M5 sizes: `m5.large` 2 vCPU / 8 GiB, `m5.xlarge` 4 / 16, `m5.2xlarge` 8 / 32 (4 GiB per vCPU, "general purpose"). [P]
- **Burstable (T3):** a baseline CPU level that can burst above it using CPU credits; once credits run out the instance is throttled to baseline. [P: AWS; credit accounting not modelled, see the open items]
- Families trade CPU, memory and price: compute-optimised (c5) has faster cores and 2 GiB per vCPU; memory-optimised (r5) 8 GiB per vCPU; general purpose (m5) 4 GiB per vCPU. [P: AWS instance-type pages for m5, c5 and r5]
- Price is roughly linear in vCPU within a family, so doubling size doubles price. [repo: the catalog prices each family per vCPU-hour]
- Purchase model changes price, not performance: on-demand (full), reserved or savings plan (Savings Plans: up to 72% off on-demand), spot (up to 90% off, can be reclaimed). [P: AWS EC2 pricing page; "up to" figures, not typical ones]

**Simulator instance table** (these are the config facts; the formulas below are the oracle):

| Family            | Example     | vCPU | RAM  | Relative core speed (`perfFactor`) | Price/h |
| ----------------- | ----------- | ---- | ---- | ---------------------------------- | ------- |
| burstable         | `t3.medium` | 2    | 4 GB | 0.8                                | 0.042   |
| general           | `m5.large`  | 2    | 8 GB | 1.0                                | 0.096   |
| compute-optimised | `c5.large`  | 2    | 4 GB | 1.3                                | 0.085   |

## 3. Concurrency: the one formula that sizes everything

**Little's Law applied to a service (chapter 01 section 3):** concurrency = arrival rate x time in system.

- AWS Lambda states it directly: **Concurrency = (average requests per second) x (average request duration in seconds)**. [P: AWS Lambda docs]
  - 100 req/s at 1 s each = 100. At 500 ms each = 50. 200 req/s at 250 ms = 50. 5,000 req/s at 200 ms = **1,000**. [P]
- Servers needed = concurrency / concurrency per server. **QuickCart check:** 100,000 req/s x 1.28 ms = **128** concurrent requests,
  exactly the 128 workers of one server unit. [computed, from the repo's authored contract]
- A node saturates when concurrency demand reaches its workers: capacity = workers / service time. [D: Little's law]

### 3.1 How many workers per vCPU?

The question is how many requests one core can juggle. It depends on how much of each request is CPU and how much is waiting.

**Sizing formula [S: attributed to Goetz, *Java Concurrency in Practice*; secondary sources only]:**

threads = cores x (1 + wait time / service time) (service time here means CPU time)

- Pure compute (wait about 0): threads = cores: **one worker per core**. [S]
- Mostly waiting: many threads per core. Example: 4 cores, 90 ms waiting, 10 ms CPU: 4 x (1 + 9) = **40** threads; with a 0.8 target CPU utilisation, 32. [computed]
- The simulator's two profiles are the two ends of this formula: **cpu-bound = 1 worker per vCPU**; **io-bound = 32 workers per vCPU**, which corresponds to wait/CPU = 31, a request that is
  about 3% CPU and 97% waiting. [computed from the repo constants] The formula is a starting point: sources caution that there are no ideal numbers and the answer must be measured. [S]
- Events (Node.js, async runtimes) reach high concurrency on few threads because waiting costs no thread. [D]

**Testable expectations**

- A cpu-bound node on an `m5.large` has 2 workers; an io-bound node has 2 x 32 = 64; with `instanceCount` n multiply by n.
- Max throughput = workers / mean service time: cpu-bound 2 workers at 10 ms = 200 req/s (chapter 01 test Q-04 style).
- Doubling instance count doubles capacity (with perfect scaling; section 5 says when that fails).

### 3.2 Admission limit K and memory

A node can also run out of **memory** before it runs out of workers: every in-flight request holds memory. Max in-flight K = RAM / memory per request. [D]

- 8 GB at 16 MB per request = 512 in flight; at 2,048 MB per request = 4. A small K forces rejections under overload (chapter 01 section 5.3, flow Q-05).

## 4. Service time on different hardware

- A faster core serves each request in less time: service time = base time / performance factor. A `c5` core (1.3) turns 10 ms into 7.7 ms for CPU-bound work. [repo: catalog performance factor 1.3 for c5; the division is definitional]
- I/O-bound work barely benefits from a faster core because most of its time is spent waiting. The simulator damps the speed-up for I/O-bound nodes to 25% of the advantage: effective factor = 1 + (perf − 1) x 0.25. [repo constant; physics K]
  - Worked: c5 (1.3) io-bound: 1 + 0.3 x 0.25 = 1.075, so a 10 ms request becomes 9.30 ms. This is exactly the 9.28 ms the UI showed in the finding behind chapter-01's capacity fix.
- **Contention:** if the number of runnable workers exceeds physical cores, CPU-bound work slows because workers time-share cores. Running 64 io-bound workers on 2 vCPUs is fine only because most are waiting. [D]

## 5. Scaling out and its limits

### 5.1 Amdahl's law [P: Wikipedia]

If a fraction p of the work can run in parallel on N processors: **speedup = 1 / ((1 − p) + p / N)**; the ceiling is 1 / (1 − p) however large N gets. [S]

- p = 0.95: N = 8 gives 5.93x, N = 32 gives 12.55x, N = 96 gives 16.7x, and the limit is **20x**. [computed]
- It assumes a fixed workload and ignores other bottlenecks (memory, I/O). [S]

### 5.2 Universal Scalability Law [S: Gunther, arXiv 0808.1431 and the R usl package documentation; reduces to Amdahl's law when beta = 0]

capacity(N) = N / (1 + alpha (N − 1) + beta N (N − 1)); alpha is contention (serial queueing), beta is coherency (crosstalk cost that grows with N²). With beta > 0 throughput **peaks and then falls**, at N\* = sqrt((1 − alpha) / beta).

- alpha = 0.05, beta = 0.0005: N\* = 43.6; relative capacity 5.8 at N = 8, 10.5 at 32, 10.7 at the peak (43.6), 9.3 at 96, 6.5 at 200. [computed]
- Lesson: more machines past the peak make things **worse**, not just no better. Shared locks, a single database, or all-to-all coordination are the usual sources of beta.

### 5.3 Horizontal vs vertical

- **Scale up** (bigger instance): simple, no coordination, bounded by the largest instance. **Scale out** (more instances): near-linear for stateless work, needs a load balancer (chapter 07), limited by Amdahl and USL terms above. [D]
- Failure: n identical servers each carry n / (n − 1) of the load after one fails (chapter 01 section 8). Capacity plans need N + 1. **Observed (`C-08`):** four servers at 60 req/s each become three at 80 req/s each after one fails, within 3% of the arithmetic.
- **A measurement trap (observed, `C-02` and `C-07`):** throughput measured over a run with a deep queue and a timeout is not the capacity. If the queue can hold more work than the timeout allows, the server spends its capacity on requests that have already expired and successes per second collapse (chapter 02 section 6, goodput versus throughput). Measure capacity with a short queue or read steady-state completions per second.

**Testable expectations**

- instanceCount 1 to 4 on a stateless cpu-bound node: capacity 4x (no shared bottleneck in the simulator unless one is modelled).
- Adding instances behind a single-worker database stops helping once the database saturates (the shared downstream is the alpha term).

## 6. Serverless

- A function runs in an **execution environment**, one request at a time; a new environment is created when none is free. [P: AWS Lambda docs]
- **Cold start:** creating an environment runs an Init phase (load code, start runtime, run initialisation) before the first request, so that request is slower. Warm requests reuse the environment. [P]
- Mitigations: **provisioned concurrency** keeps environments pre-initialised (no cold starts for that many concurrent requests, extra cost); **SnapStart** restores from a snapshot (startup "as low as sub-second", supported for some runtimes). [P]
- **Limits [P]:** default account concurrency 1,000 per region; request rate capped at **10 x** the concurrency quota (10,000 req/s by default), so a 20 ms function at 30,000 req/s needs 600 concurrency but is throttled by the request-rate cap; new environments are added at most **1,000 per 10 seconds** per function (or 10,000 req/s per 10 s).
- **Simulator behaviour (observed, flows `C-09` to `C-12`):** the first request pays the cold start (about 850 ms for an 800 ms init plus 50 ms of work), later requests do not, and after an idle gap longer than `idleTimeoutMs` the next burst is cold again. The cold-start state belongs to the **node**, not to each concurrent environment: a burst of 16 simultaneous requests during init records **one** cold start and the rest queue behind it, whereas real Lambda would create about 16 environments that each pay init. So the simulator understates cold-start cost for bursty traffic (`C-12`, tracked as an expected failure). The default concurrency cap is the node's derived worker count.
- Cost is per request and per duration, so low or spiky traffic is cheap and sustained high traffic is expensive compared with a fixed fleet. [P: AWS Lambda pricing bills per request and per GB-second of duration, including initialisation outside the handler; free tier 1 million requests and 400,000 GB-seconds a month]

**Testable expectations**

- Concurrency = rate x duration: 5,000 req/s at 200 ms needs 1,000 environments; at the 1,000 cap, 5,001 req/s is throttled. [P]
- The first request after idle pays init time; later requests do not. With provisioned concurrency n, the first n concurrent requests do not.
- When offered concurrency exceeds the cap, the surplus is rejected (`max_concurrency_exceeded` in the simulator), not queued.
- The cap gives an **upper bound** of cap / duration admitted per second, not an exact rate. With random arrivals a cap of 2 slots, 500 ms requests and 20 req/s (10 Erlangs) blocks the Erlang B fraction 50/61 = **82%**, so about 3.6 req/s are served against the bound of 4. [computed, chapter 01 section 5.2]

## 7. Sidecar, gateway-attached and other small nodes

- A **sidecar proxy** sits beside every service instance and handles its inbound and outbound calls. It adds latency and CPU to every call. Istio's published figures for the Envoy sidecar in release 1.24: about **0.20 vCPU and 60 MB per 1,000 req/s** (1 KB payloads, mutual TLS, 2 worker threads); earlier releases published 0.35 vCPU and 40 MB (1.8.3) and 0.5 vCPU (1.19 and 1.21), so the figure is version-dependent. That is about 0.2 ms of CPU per request per proxy; a service-to-service call crosses two proxies. [P: Istio performance docs; derivation computed]
- Latency added is reported only in charts on that page, so take it from your own measurement. [P, numbers not extractable]
- Because the cost applies to every hop, a chain of k services each with a sidecar adds k x (two proxy traversals) to the path. [D]

## 8. Batch workers and background functions

- Pull work from a queue; throughput = workers / service time; latency matters little. Scale by queue depth. [D]
- Backlog arithmetic from chapter 05 applies: if arrivals exceed capacity, queue grows at (arrivals − capacity) per second.

## 9. GPU nodes

- Few, expensive, high throughput when requests are **batched**: one GPU processes a batch for nearly the cost of one request, so waiting to form a batch trades latency for throughput (chapter 18 section 4 gives the arithmetic). [D]
- Capacity planning: tokens per second (LLM) or images per second, not requests. See chapter 18. **[?]** to confirm the simulator models batching.

## 10. Simulator parameter map

| Setting                               | Meaning                                                                     | Real counterpart            |
| ------------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| `resources.instanceType`              | catalog SKU: vCPU, RAM, price, `perfFactor`                                 | EC2 instance type           |
| `resources.instanceCount`             | number of instances                                                         | fleet size                  |
| `resources.workloadKind`              | `cpu-bound` (1 worker per vCPU) or `io-bound` (32 per vCPU)                 | thread/worker model         |
| `resources.perRequestMemMb`           | memory per in-flight request; K = RAM / this                                | per-request footprint       |
| `resources.pricingModel`              | on-demand, reserved, spot                                                   | purchase model (price only) |
| `queue.workers`, `queue.capacity`     | raw concurrency and admission, used only when no instance model is authored | hand-set pool and buffer    |
| `processing.distribution`, `.timeout` | service time and per-request timeout                                        | latency and client timeout  |

Default profiles per type (the instance and kind a fresh palette node gets): microservice, container, auth, search on `c5.large`; serverless, API gateway, load balancers, CDN, NAT, VPN, reverse proxy, service mesh on `m5.large`; sidecar `t3.medium`; batch worker, auth service, search service, edge compute `c5.large` cpu-bound; GPU node `c5.2xlarge` cpu-bound. Default mean service times by type are in the component spec table (for example relational DB 8 ms, cache 0.1 ms, API gateway 1 ms).

## 11. Testable expectations (summary)

- Derived workers = vCPU x (1 for cpu-bound, 32 for io-bound) x instanceCount; admission K = RAM / perRequestMem x instanceCount, never below workers.
- Capacity = workers / (service time / effective perf factor); io-bound effective perf factor = 1 + (perf − 1) x 0.25.
- Little: in-flight at steady state = admitted rate x time in system.
- Serverless: concurrency = rate x duration; cold start only on a new environment.
- Cost per hour = instanceCount x price per hour (x purchase multiplier).

## 12. Open items

- Not read directly: Goetz's book (the workers-per-core guidance is stated as Little's-law arithmetic instead) and the T3 credit-accounting rules.
- Decide `[?]`: whether the simulator should model CPU contention when workers exceed physical cores, and GPU batching.

## Sources

- [AWS EC2 general purpose instance types (m5)](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html) [P]
- [AWS EC2 compute optimized instance types (c5)](https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html) [P]
- [AWS EC2 memory optimized instance types (r5)](https://docs.aws.amazon.com/ec2/latest/instancetypes/mo.html) [P]
- [AWS EC2 pricing](https://aws.amazon.com/ec2/pricing/) [P]
- [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) [P]
- [Gunther, A general theory of computational scalability based on rational functions](https://ar5iv.arxiv.org/html/0808.1431) [S]

- [AWS EC2 general purpose instance types](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html) [P]
- [AWS Lambda concurrency and scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html) [P]
- [AWS Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) [P]
- [Amdahl's law, Wikipedia](https://en.wikipedia.org/wiki/Amdahl%27s_law) [S]
- [Zalando: how to set an ideal thread pool size (Goetz formula)](https://engineering.zalando.com/posts/2019/04/how-to-set-an-ideal-thread-pool-size.html) [S]
- [Istio performance and scalability](https://istio.io/latest/docs/ops/deployment/performance-and-scalability/) [P]
