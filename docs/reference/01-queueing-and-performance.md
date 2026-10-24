# 01. Queueing and performance math

Marks: **[P]** primary, **[S]** secondary, **[K]** from established knowledge, not yet source-checked,
**[?]** needs an owner decision. See [README](README.md).

Every server-like node in the simulator is a queue with `c` servers (workers), finite room `K`, a service
time distribution and a timeout. This chapter is the theory behind the numbers that node reports.

## 1. Vocabulary and symbols

| Symbol     | Meaning                                                                                  | Unit                          |
| ---------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| λ (lambda) | arrival rate: requests offered per second                                                | req/s                         |
| μ (mu)     | service rate of one server = 1 / mean service time                                       | req/s per server              |
| S or τ     | mean service time = 1/μ                                                                  | s                             |
| c          | number of parallel servers (workers)                                                     | count                         |
| K          | total capacity of the node: servers plus waiting room                                    | count                         |
| ρ (rho)    | utilization of the node = λ / (c·μ)                                                      | 0 to 1 (can exceed 1 offered) |
| A          | offered load = λ/μ, in "Erlangs" (average servers' worth of work)                        | Erlang                        |
| L          | average number in the system (waiting plus in service)                                   | count                         |
| Lq         | average number waiting (not in service)                                                  | count                         |
| W          | average time in the system (response time) = Wq + S                                      | s                             |
| Wq         | average time waiting before service                                                      | s                             |
| cₐ², cₛ²   | squared coefficient of variation (variance / mean²) of inter-arrival and of service time | dimensionless                 |
| P_K        | blocking probability: chance an arrival finds the node full                              | 0 to 1                        |
| X          | throughput: completions per second                                                       | req/s                         |

Kendall notation `A/S/c/K`: arrival process / service distribution / servers / capacity. `M` = Markovian
(Poisson arrivals or exponential service), `D` = deterministic, `G` = general. So `M/D/1` is Poisson
arrivals, constant service time, one server; `G/G/c/K` is the general model the simulator implements. [K]

## 2. Operational laws (hold for any run, any distribution)

These are bookkeeping identities over a measured interval. They are the best oracles because they need no
assumptions about the distributions. [K] (Denning and Buzen, 1978, "operational analysis"). Sources to fetch:
Harchol-Balter, _Performance Modeling and Design of Computer Systems_, chapters on operational laws.

| Law               | Statement                                                                                 | Use as a test                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Utilization law   | U = X · S (busy fraction = throughput x mean service time), per server group: U = X·S / c | Reported utilization must equal completions/s x mean service time / workers   |
| Throughput bound  | X ≤ c / S                                                                                 | Throughput can never exceed c·μ, however high λ is                            |
| Flow conservation | arrived = completed + rejected + failed + still in system                                 | Must balance exactly at the end of a run (the simulator's conservation check) |
| Forced flow law   | X_i = V_i · X, where V_i = visits per request to node i                                   | A node visited twice per request sees twice the system throughput             |

## 3. Little's Law

**What it is.** L = λ·W: the long-run average number in a system equals the long-run average arrival rate
times the long-run average time each customer spends in it. [S] Wikipedia article on Little's law; original
proof is J. D. C. Little, _Operations Research_ 9(3), 1961, doi 10.1287/opre.9.3.383 [P, cited, not fetched].

**Conditions.**

- The system is stationary and ergodic (long-run averages exist and are finite). [S]
- `λ` must be the **effective** arrival rate: the rate at which customers actually **enter**. Where customers
  are turned away because the system is full, the effective rate is smaller than the offered rate. [S]
- Over a finite window the law holds only approximately; customers present at the start or still present at
  the end must be accounted for. [S]
- No assumption about the arrival process, service distribution, service order or number of servers. [S]
  (Rigorous conditions are more technical: finite means and stationarity in Little's original statement;
  see Wolff and Yao 2014, _Queueing Systems_, for cases with infinite waiting-time mean. [S])

**Applied to the parts of a node.**

- Whole node: L = λ_eff · W.
- Waiting room only: Lq = λ_eff · Wq.
- Servers only: (average busy servers) = λ_eff · S, which is the utilization law with ρ = that / c.

**Pitfalls to test** (real bugs found in this repository's history are listed in `docs/engine-probe-findings.md`):

- Using offered λ instead of admitted λ in a node that rejects makes a correct system look inconsistent.
  Admitted rate = λ·(1 − P_K).
- L must be a **time average** of the number in system, not an average of a few sampled snapshots. Snapshots
  taken between regular arrivals can all see an empty system. Poisson arrivals are safe because of PASTA
  (Poisson Arrivals See Time Averages). [K]
- Warmup transient: a short run that starts empty biases L and W low.

**Worked example** [S]: 9 jobs waiting plus 1 in service = 10 in the system, throughput 50 /s, so
W = L/λ = 10/50 = 0.2 s. Store: 10 customers/hour, 0.5 hour each, so L = 5.

**Testable expectations**

- For any node over a long window: |L − λ_eff·W| / L within a small tolerance (state the tolerance per run length).
- A node that rejects: the check uses admitted arrivals; consistent overload must not raise a warning.
- Constant-rate arrivals into an under-loaded server (50 req/s, 10 ms service, ρ = 0.5): true time-average L is
  0.5 (λ·S = 50 x 0.01), not 0.

## 4. Single-server queues

### 4.1 M/M/1 [K, standard result; verify in Harchol-Balter ch. 14 or Kleinrock vol. 1]

Poisson arrivals rate λ, exponential service rate μ, ρ = λ/μ < 1.

- P(n in system) = (1 − ρ)ρⁿ
- L = ρ / (1 − ρ), Lq = ρ² / (1 − ρ)
- W = 1 / (μ − λ) = S / (1 − ρ), Wq = ρ / (μ − λ) = ρ·S / (1 − ρ)
- Response time is exponential with mean W, so the p-th percentile is −W·ln(1 − p). Example p99 = 4.605·W.

The 1/(1 − ρ) factor is the "hockey stick": at ρ = 0.5 W = 2·S; at 0.8 W = 5·S; at 0.9 W = 10·S; at 0.95 W = 20·S;
as ρ → 1 it diverges. This is why saturation matters long before 100% utilization (also stated in the SRE book [P]).

### 4.2 M/D/1 and M/G/1: Pollaczek-Khinchine [S for the form; K for the arithmetic]

For Poisson arrivals and general service with mean S and squared CV cₛ²:

Wq = ρ / (1 − ρ) · (1 + cₛ²) / 2 · S

- Exponential service: cₛ² = 1, so Wq = ρ·S / (1 − ρ) (equals M/M/1).
- **Deterministic service (M/D/1): cₛ² = 0, so Wq = ρ·S / (2(1 − ρ))**, exactly half the M/M/1 wait. [S, derived from the form]

**Worked example used in this project's probes.** One server, S = 10 ms, ρ = 0.8:
M/D/1 Wq = 0.8 x 10 ms / (2 x 0.2) = **20 ms**. M/M/1 Wq would be 40 ms. Mean time in system W = Wq + S = 30 ms.
Average number waiting Lq = λ·Wq = 80 x 0.020 = 1.6; in service 0.8; L = 2.4. (Little's Law check.)

**Testable expectations**

- Single server, constant service 10 ms, Poisson 80 req/s, long run: utilization → 0.80, Wq → 20 ms, W → 30 ms,
  L → 2.4. A finite run starting empty will read slightly low (transient); the oracle must carry a tolerance
  that shrinks with run length and say which seeds were used. [?] Owner to set the tolerance. The repository's
  own probe saw mean wait of 16 to 19 ms across seeds, which suggests the tolerance must be about 10 to 20% on
  a short run.
- Doubling cₛ² from 0 to 1 (constant to exponential service at the same mean) doubles the mean wait.

### 4.3 Kingman's approximation, G/G/1 [S: Wikipedia "Kingman's formula"]

E(Wq) ≈ [ρ / (1 − ρ)] · [(cₐ² + cₛ²) / 2] · τ (the "VUT" equation: Variability x Utilization x Time)

- Reduces to Pollaczek-Khinchine when cₐ² = 1 (Poisson arrivals).
- Described as accurate near saturation. Treat it as an approximation: do not use it as an exact oracle. [S]
- Lesson used by tests: **variability, not just utilization, drives waiting.** Same ρ and mean service, higher
  cₛ² (heavy-tailed service) gives proportionally longer waits.

## 5. Multi-server queues

### 5.1 M/M/c and Erlang C [S: TU Berlin queueing text; Wolfram reference]

Offered load A = λ/μ, utilization ρ = A/c < 1.

- Probability an arrival has to wait (all c servers busy), Erlang C:
  C(c, A) = [ (A^c / c!) · 1/(1 − ρ) ] / [ Σ_{k=0}^{c−1} A^k/k! + (A^c / c!) · 1/(1 − ρ) ]
- Mean wait in queue: Wq = C(c, A) / (c·μ − λ) [S]
- Mean time in system: W = 1/μ + C / (c·μ − λ) [S]
- Mean number waiting: Lq = C·ρ / (1 − ρ) [S]
- Given that a customer waits, the wait is exponential with mean 1/(c·μ − λ). [S]
- Relation to Erlang B: C = c·B / (c − A·(1 − B)). [S]

Why this matters: **pooling**. One pool of c servers with a shared queue waits far less than c separate
single-server queues with the same total load. This is the case for a load balancer plus shared queue versus
random assignment. [K]

### 5.2 Erlang B (loss system, M/M/c/c) [S/K]

No waiting room. B(c, A) = (A^c / c!) / Σ\_{k=0}^{c} A^k / k!. Stable recursion: B(0) = 1,
B(n) = A·B(n − 1) / (n + A·B(n − 1)). [K]

### 5.3 M/M/c/K, finite capacity [S for the properties; K for the formula]

Capacity K ≥ c (servers plus waiting slots). Unnormalised state weights:

- p_n = Aⁿ / n! for 0 ≤ n ≤ c
- p_n = (A^c / c!) · (A/c)^(n−c) for c < n ≤ K
- P*K = p_K / Σ*{n=0}^{K} p_n (blocking probability)

Properties [S]:

- Always stable: the finite buffer caps the population, so a steady state exists even if ρ > 1.
- Effective (admitted) arrival rate λ_eff = λ·(1 − P_K); throughput X = λ_eff; offered load beyond capacity is rejected.
- M/M/1/K closed form: P_K = (1 − ρ)·ρ^K / (1 − ρ^(K+1)) for ρ ≠ 1, and 1/(K + 1) for ρ = 1, with ρ = λ/μ. [S, from a
  user-uploaded document; recheck against a textbook before use as an oracle]
- c = K reduces to Erlang B. [S]

**Overloaded finite node, worked example from the project's probe** (this is arithmetic you can check by hand):
c = 1, S = 10 ms (μ = 100/s), K = 5, offered λ = 300/s, so ρ = 3.
A = 3. p_n = 3ⁿ for n = 0..5 gives 1, 3, 9, 27, 81, 243. Sum = 364. P_K = 243/364 = **0.668**.
Admitted rate λ_eff = 300 x (1 − 0.668) = **99.7 /s**, almost exactly the server's maximum μ = 100/s. Utilization ≈ 0.997.
Average number in system L = Σ n·pₙ / 364 = (0 + 3 + 18 + 81 + 324 + 1215) / 364 = 1641 / 364 = **4.51**.
Mean time in system W = L / λ_eff = 4.51 / 99.7 = **45 ms**. (This is the M/M/1/K version with exponential service. The
project's probe used deterministic service, so its exact numbers differ; the shape, a nearly full node and
rejecting about two thirds of arrivals, holds.) [K, hand-computed from the formula above]

**Testable expectations**

- Throughput never exceeds c·μ. Rejections ≈ λ − c·μ when λ ≫ c·μ and K is small.
- λ_eff x W = L must hold with λ_eff (admitted), not λ (offered).
- Conservation: offered = admitted + rejected, at every node.
- Timeouts: a request whose wait plus service exceeds the timeout is counted as a timeout, not a success; throughput
  then falls below c·μ. [K]

## 6. Latency distributions, percentiles and what to report

- Report percentiles (p50, p95, p99, p99.9), not just the mean. A 100 ms mean at 1,000 req/s can hide 1% of
  requests taking about 5 s. [P: Google SRE book, "Monitoring Distributed Systems"]
- Record latency as a histogram with exponentially spaced buckets. [P: same]
- Track latency of successful and failed requests **separately**; a fast error lowers the mean while hurting users. [P]
- **Do not average percentiles** across nodes or windows; merge the histograms and compute the percentile from the merge. [K]
- The tail comes from queueing and variability. Parallel fan-out makes it worse: if one request waits on n
  backends in parallel and each is slow with probability q, the request is slow with probability 1 − (1 − q)ⁿ.
  With q = 1% and n = 100 that is 63%. [K, Dean and Barroso, "The Tail at Scale", CACM 2013, to fetch]
- End-to-end latency along a chain = sum over hops of (queue wait + service + network). Means add; percentiles do not. [K]
- Coordinated omission: a closed-loop load generator that waits for each response before sending the next hides the
  worst latencies. An open-loop generator (arrivals independent of responses) is what the simulator's sources should be. [K, Gil Tene]

## 7. The four golden signals [P: Google SRE book]

| Signal     | Definition                                                                                                | Simulator output it maps to          |
| ---------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Latency    | Time to service a request, tracked separately for success and failure                                     | latency percentiles, failure latency |
| Traffic    | Demand on the system, e.g. requests per second                                                            | arrival rate, throughput             |
| Errors     | Explicit (HTTP 500), implicit (200 with wrong content), or by policy (slower than a committed limit)      | error rate, timeouts, rejections     |
| Saturation | How full the service is, measured on its most constrained resource; many systems degrade well before 100% | utilization, queue depth, drops      |

Further SRE guidance [P]: page on symptoms (what users feel), use causes to debug; monitor the whole distribution.

## 8. Utilization, headroom and capacity arithmetic

- Capacity of a node = c · μ = c / S. Maximum safe load = target utilization x capacity. [K]
- Why headroom (typically 60 to 80%): wait grows as 1/(1 − ρ) (section 4.1), variability amplifies it (section 4.3),
  and you need spare for failures (N+1) and spikes. [K]
- N+1: with n servers sharing load evenly, after one failure each survivor carries n/(n − 1) of its previous load.
  4 servers at 75% become 100% when one dies. [K]
- **QuickCart worked example** (from this repository's `builder-walkthrough.md`; a stated modelling contract, not an external source):
  per-server capacity = workers / service time = 128 / 0.00128 s = 100,000 req/s. Peak 1,000,000 req/s with a hard
  utilization limit of 0.8 needs at least 1,000,000 / (0.8 x 100,000) = 12.5, round **up** to **13** servers.
  13 servers: load per server 76,923 req/s, utilization 76.9%. 12 servers: 83,333 req/s, 83.3%, over the limit. 8 servers:
  125,000 req/s, 125%, capacity 800,000, so about 200,000 req/s (20%) is dropped.
  Rule: **always round up; never round down.**

## 9. Discrete-event simulation and statistical honesty [K, to expand in chapter 04]

- A single seeded run is one sample, not the truth. Compare to theory only with a tolerance, or average several seeds.
- Discard a warmup period so the empty-start transient does not bias averages. State the warmup used.
- Same seed, same inputs must give identical output (determinism). A different seed must give a different sample with the same expected value.
- Confidence interval for a mean from n independent replications: mean ± t(n−1, 0.975)·s/√n. [K]

## 10. Open items for this chapter

- Fetch and cite: Little (1961); Harchol-Balter textbook chapters (operational laws, M/M/1, M/G/1); Kleinrock vol. 1; Dean and
  Barroso, _The Tail at Scale_; Gil Tene on coordinated omission. Upgrade the `[K]` marks above to `[P]`.
- Owner decision [?]: numeric tolerance policy for comparing a finite seeded run with a closed-form value.
- Owner decision [?]: which node service-time distributions the simulator treats as "Poisson arrival" versus constant-rate arrivals
  when applying the P-K formula, so the oracle matches the intended arrival process of each workload pattern.

## Sources

- [Little's law, Wikipedia](https://en.wikipedia.org/wiki/Little%27s_law) [S]
- [Kingman's formula, Wikipedia](https://en.wikipedia.org/wiki/Kingman%27s_formula) [S]
- [M/M/c, M/M/1/K and Erlang models, TU Berlin course text](https://platform.commit.tu-berlin.de/en/book/fsp/chapter/ch18/section/s05) [S]
- [Google SRE book: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) [P]
- [Wolff and Yao 2014, Little's Law with infinite waiting times](https://staff.stat.sinica.edu.tw/yao/file/art_253A10.1007_252Fs11134-013-9364-8.pdf) [S]
- [Little 1961, A proof for the queuing formula L = λW](https://www.citedrive.com/en/discovery/a-proof-for-the-queuing-formula-ili-%CE%BBiwi) [P, cited only]
- [Technion lecture notes on G/G queues](https://serveng.technion.ac.il/files/Lectures/Lecture_GGQ's_FULL_Marked.pdf) [S]
