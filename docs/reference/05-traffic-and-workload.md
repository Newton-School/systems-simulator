# 05. Traffic and workload patterns

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established knowledge, not yet source-checked,
**[?]** needs an owner decision. See [README](README.md).

What the traffic into a design looks like, how to describe it with numbers, and how each of the simulator's seven patterns
should behave. Queueing results (chapter 01) are only as good as the arrival process they are fed.

## 1. Describing an arrival process

| Term                               | Meaning                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Arrival rate lambda                | average requests per second over a window                                                                               |
| Inter-arrival time                 | gap between consecutive requests; mean 1 / lambda                                                                       |
| Inter-arrival CV (c_a)             | sd / mean of the gaps. 0 = perfectly even, 1 = Poisson, > 1 = bursty. The simulator reports it as "Offered Arrival CV". |
| Peak-to-mean ratio                 | peak rate / average rate; sizes capacity for bursts                                                                     |
| Burstiness / index of dispersion   | variance of counts per window divided by the mean count; 1 for Poisson, > 1 for bursty                                  |
| Arrival process vs service process | independent inputs of a queue; Kingman's formula uses c_a² and c_s² (chapter 01 section 4.3)                            |

Total arrivals over a window = integral of the rate. For a piecewise-constant rate that is the sum of rate x duration. [K]

## 2. The seven patterns

### 2.1 Constant

- Evenly spaced requests: gap = 1 / lambda exactly. c_a = 0, no randomness.
- Total in T seconds = lambda T. Example 100 req/s for 30 s = 3,000 requests.
- Use: idealised baseline, deterministic debugging, isolating service-time variability.
- Real traffic is almost never this smooth; results will read **better** than reality (lower waits at the same load).

### 2.2 Poisson

- Independent exponential gaps with mean 1 / lambda. Counts in any window are Poisson with mean lambda x window; c_a = 1; variance of counts = mean. [S: Wikipedia]
- Memoryless: the chance of an arrival in the next instant does not depend on the past. Superposition of independent Poisson streams is Poisson with summed rate; random thinning keeps it Poisson. [S]
- The standard model for many independent users acting at random (many small sources). It is the arrival assumption behind M/M/c and M/G/1 formulas.
- Test: count per 1 s window has mean lambda and variance about lambda (index of dispersion near 1); gaps have mean 1/lambda and CV near 1.

### 2.3 Bursty (on/off)

- Alternates between a **burst** phase at `burstRps` for `burstDuration` and a **normal** phase at base rate for `normalDuration`, repeating. [K, config fields below]
- Mean rate = (burstRps x burstDuration + baseRps x normalDuration) / (burstDuration + normalDuration).
  Worked: burst 400 rps for 1 s, normal 50 rps for 3 s: mean = (400 + 150) / 4 = **137.5 rps**; peak-to-mean 2.91. [computed]
- Counts per 1 s window alternate 400, 50, 50, 50 (plus noise), so variance between windows is about 22,969 against a Poisson variance of 137.5: the index of dispersion is about 168. This is far burstier than Poisson. [computed]
- Related models: the **on/off source** and the **Markov-modulated Poisson process (MMPP)**, a Poisson process whose rate switches according to a Markov chain; the on/off case is a special case with the off rate often zero. [S: network-traffic-model surveys]
- **Why it matters.** Real network and request traffic is usually burstier than Poisson, at every time scale: Leland, Taqqu, Willinger and Wilson showed Ethernet traffic is self-similar, with no natural burst length, and that aggregating sources does not smooth it. [S: Leland et al., IEEE/ACM ToN 1994]
  A queue fed by bursty traffic has higher waits than Poisson at the same mean rate (large c_a² in Kingman's formula).
- The on/off model has a **fixed** burst length; real burstiness has heavy-tailed durations. Treat results as a lower bound on real burstiness. **[?]**
- **Simulator behaviour (observed):** arrivals inside each phase are **evenly spaced**, not Poisson: per-second counts are exactly 400, 50, 50, 50, 400, ... So a burst only builds a queue when the burst rate exceeds the node's capacity. A 160 req/s burst against 200 req/s of capacity never waits at all; a 400 req/s burst does.

### 2.4 Diurnal

- Rate varies by hour of day: rate(h) = baseRps x multiplier(h), with 24 hourly multipliers and a `peakMultiplier`. [K, config]
- **Simulator behaviour (observed):** the 24 hourly values are stretched across the whole run, so one simulated day = the run duration. A 60 s run covers all 24 hours at 2.5 s per hour; the first hour's rate applies for the first 2.5 s.
- Daily mean = baseRps x average of the 24 multipliers. Example: multipliers 1 + 0.5 sin(2 pi (h − 9) / 24): mean 1.0, peak 1.5, peak-to-mean 1.5.
- Real daily cycles span roughly 2x to 10x between trough and peak for consumer services, and have weekly and event-driven (campaign, holiday) layers. [K]
- Test: arrivals in hour h are proportional to multiplier(h); the total over the run = baseRps x duration x mean multiplier. Because the day is stretched over the run, results for diurnal runs describe the shape of a day, not real-time seconds.

### 2.5 Spike

- Base rate with a window starting at `spikeTime` lasting `spikeDuration` at `spikeRps`. [K, config]
- Total = base x T + (spikeRps − base) x spikeDuration. Worked: base 100 rps, spike to 500 for 5 s in a 60 s run = 6,000 + 400 x 5 = **8,000** requests, average 133.3 rps. [computed]
- Real analogues: a flash sale, a viral link, a retry storm after an outage, a cache expiry herd. The chaos "traffic spike" preset multiplies the rate for a window.
- What to watch: queue depth builds during the spike at (spike rate − capacity) per second, and drains afterwards at (capacity − base rate) per second. Recovery time after the spike
  = backlog / (capacity − base) where backlog = (spike − capacity) x duration. Example: capacity 300, base 100, spike 500 for 5 s: backlog = 200 x 5 = 1,000 requests, drain time = 1,000 / 200 = **5 s**. [computed; K]
- If the buffer K is smaller than the backlog, the excess is rejected instead of queued.

### 2.6 Sawtooth

- Rate ramps linearly from the **base rate** (`baseRps`) up to `peakRps` over `rampDuration`, then resets to the base, repeating. [observed]
- Mean over whole ramps = (base + peak) / 2. Example: base 10, peak 200, ramp 10 s: mean 105 rps, 6,300 requests over 60 s. (A ramp from 0 would average peak / 2 = 100.) [computed]
- Use: find the load at which a design breaks (the knee). Record the time at which error rate or latency first exceeds a threshold, then read the rate at that time: rate(t) = peak x t / ramp. [K]
- Also models a slow ramp-up of traffic, such as a launch.

### 2.7 Replay

- Re-issue a recorded arrival trace (timestamps and types). The only pattern with real burstiness and correlation structure built in. [K]
- Mean rate and request mix equal the trace's. Reproducible for a fixed trace. Limit: cannot extrapolate to a rate or length the trace does not cover.

## 3. Open, closed and partly open workloads

This is the most common silent error in load testing and simulation. [S: Schroeder, Wierman and Harchol-Balter, NSDI 2006]

| Model           | Rule                                                                                     | Behaviour under overload                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**        | New requests arrive independently of completions, at rate lambda                         | Offered load stays at lambda; queues grow without bound if lambda > capacity. Realistic for the public internet with many independent users. |
| **Closed**      | A fixed population of N users; each waits for a response, thinks for Z, then sends again | Self-limiting: slower service means fewer requests. Never overloads. Realistic for a fixed pool of workers or terminals.                     |
| **Partly open** | Users arrive openly, then make several dependent requests in a session                   | Between the two.                                                                                                                             |

The paper reports that the choice changes results a lot (scheduling policies, response times), and gives eight principles; the choice must match how the real system is used. [S: abstract only fetched]

- **Interactive response time law (closed systems) [S: Jain; Denning and Buzen].** R = N / X − Z, where N users, X throughput, Z think time. It follows from Little's Law applied to the whole loop.
  Worked: 12 terminals, Z = 20 s, X = 0.5 per second: R = 12 / 0.5 − 20 = **4 s**. With Z = 0 it reduces to Little's Law.
  Throughput of a closed system is capped: X <= N / (Z + R_min).
- **Coordinated omission [S: Gil Tene].** A load generator that waits for each response before sending the next hides the worst latencies, because the requests that would have been sent during a stall are never sent. The fix is to score each
  request against when it **should** have been sent. A simulator source with independent arrivals (an open model) avoids it by construction.
- **Test.** In an open source, offered rate equals the configured rate however slow the server is. In a closed source, offered rate falls as response time rises.

## 4. Request mix, size and key popularity

- `requestDistribution`: a list of request types with weights summing to 1 and a size in bytes; each request gets a type by weighted choice. Expected share of type i = w_i. [K]
- **Zipf popularity (hot keys).** When a keyspace has skew s, the key of rank r is drawn with probability proportional to r^(−s); the chance of the rank-r key is r^(−s) / H(N, s) where H is the sum of r^(−s) over the N ranks. [K]
  For N = 1,000 keys: with s = 1.0, H = 7.485, so the top key gets **13.4%** of requests, the top 10 get **39.1%**, the top 100 get **69.3%** (uniform would give 0.1%, 1%, 10%). With s = 0.8: top key 6.5%, top 10 23.1%, top 100 52.6%. [computed]
  Consequence: a cache holding the top 100 keys serves about 69% of requests with s = 1.0. This is why a small cache earns a high hit rate and why one hot partition saturates first (chapter 10, chapter 12).
- Size matters for bandwidth and transfer time: transmission delay = size / bandwidth (chapter 08).
- Sessions: a session id groups one client's requests so reads see their own writes and sticky routing works (chapter 11).

## 5. How workload shape drives queueing (link to chapter 01)

- At the same mean rate, higher inter-arrival CV gives longer waits: Wq ~ (c_a² + c_s²) / 2 x rho / (1 − rho) x S (Kingman). Constant arrivals (c_a = 0) wait less than Poisson (c_a = 1); bursty (c_a > 1) waits more. [S]
- A capacity plan must cover the **peak** window, not the mean. A design at 70% of capacity on average that sees a 2.9x burst is over capacity for the burst's duration, and builds a backlog it needs time to drain (section 2.5).
- Headroom for variability is the reason for the 60% to 80% target utilisation in chapter 01 section 8.

## 6. Simulator parameter map

| Field                                                  | Meaning                                                                                              | Unit                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------- |
| `pattern`                                              | `constant`, `poisson`, `bursty`, `diurnal`, `spike`, `sawtooth`, `replay`                            | n/a                  |
| `baseRps`                                              | base rate                                                                                            | req/s                |
| `bursty.burstRps`, `.burstDuration`, `.normalDuration` | burst rate and the two phase lengths                                                                 | req/s, ms            |
| `diurnal.peakMultiplier`, `.hourlyMultipliers[24]`     | daily curve                                                                                          | multiplier, per hour |
| `spike.spikeTime`, `.spikeRps`, `.spikeDuration`       | spike start, rate, length                                                                            | ms, req/s, ms        |
| `sawtooth.peakRps`, `.rampDuration`                    | ramp top and length                                                                                  | req/s, ms            |
| `requestDistribution[]`                                | `type`, `weight` (sums to 1), `sizeBytes`, optional `metadata`, optional `keyspace{field,size,skew}` | n/a                  |
| `stopCondition`                                        | `duration` or `requestBudget` (`maxRequests`), optional `haltOnSaturation`                           | n/a                  |
| `origins`, `sessions.count`                            | client populations and sessions                                                                      | n/a                  |

## 7. Testable expectations

Over a 60 s run at seed S, with tolerance about 3 sd / sqrt(N) on counts:

- **Constant** 100 rps: exactly 6,000 arrivals; inter-arrival CV = 0.
- **Poisson** 100 rps: arrivals 6,000 +/- 3 x sqrt(6,000) = +/- 232; per-second counts have variance about 100; inter-arrival CV about 1 (the app shows 0.99 for 80 rps).
- **Bursty** 400 rps for 1 s then 50 rps for 3 s: mean 137.5 rps; per-second counts alternate high and low; index of dispersion far above 1.
- **Spike** base 100, 500 for 5 s: total 8,000; the rate in the spike window is 5x base.
- **Sawtooth** base 10, peak 200, ramp 10 s: mean 105 rps; the rate at the middle of a ramp is about 105 and it resets to the base every 10 s.
- **Diurnal:** arrivals per hour proportional to the multipliers.
- **Request mix:** observed type shares within sampling error of the weights.
- **Zipf (s = 1, N = 1,000):** top-10 keys receive about 39% of requests.
- **Open versus closed:** offered rate is constant in an open source whatever the server speed.
- **Request budget stop:** exactly N source requests generated.
- Warmup excluded: measured arrivals = rate x (duration − warmup).

## 8. Simulator scope

Seven patterns, weighted request types, Zipf keyspaces, sessions and a request-budget stop. Sources are **open** (arrivals independent of completions). A closed or partly open source is not modelled. **[?]**
How simulated time maps to the hours of the diurnal curve, and whether replay accepts a user trace, are open decisions **[?]**.

## 9. Findings from the tests

- The backlog arithmetic of section 2.5 holds: base 100, spike 500 for 5 s into a 200 req/s node queues about 1,500 requests (peak queue within 10%) and recovers about 15 s after the spike ends.
- Zipf shares match 1/H, H(10)/H and H(100)/H to within 1 percentage point for s = 1.0 and s = 0.8.

## 10. Open items

- Fetch and cite: the full Schroeder et al. paper (the eight principles); Fischer and Meier-Hellstern on the MMPP; a source for the real daily-peak ratios (section 2.4).
- Add a closed-population source (N users, think time Z) if teaching closed-loop behaviour matters; then the interactive response time law is directly testable.
- Owner decisions `[?]`: diurnal time mapping; whether to model heavy-tailed burst durations.

## Sources

- [Poisson distribution, Wikipedia](https://en.wikipedia.org/wiki/Poisson_distribution) [S]
- [Exponential distribution, Wikipedia](https://en.wikipedia.org/wiki/Exponential_distribution) [S]
- [Schroeder, Wierman, Harchol-Balter: Open versus closed: a cautionary tale, NSDI 2006](https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale) [P, abstract]
- [Leland, Taqqu, Willinger, Wilson: On the self-similar nature of Ethernet traffic, IEEE/ACM ToN 1994](https://web.stanford.edu/class/cs244/papers/selfsimilar.pdf) [P]
- [Survey of network traffic models, Jain](https://www.cs.wustl.edu/~jain/cse567-06/traffic_models3.htm) [S]
- [Operational laws and the interactive response time law, Jain](https://classes.engineering.wustl.edu/~jain/queue/ftp/q_33ol.pdf) [S]
- [Denning, The science of computing: operational analysis](https://cs.unibg.it/arrigoni/impianti/articoli/Denning_2008.pdf) [S]
- [Gil Tene, Coordinated omission, Mechanical Sympathy thread](https://groups.google.com/g/mechanical-sympathy/c/icNZJejUHfE/m/BfDekfBEs_sJ) [P]
- [Dean and Barroso, The Tail at Scale, CACM 2013](https://research.google/pubs/pub40801/) [P, abstract]
