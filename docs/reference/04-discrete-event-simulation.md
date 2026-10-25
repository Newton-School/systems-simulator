# 04. Discrete-event simulation

Marks: **[P]** primary, **[S]** secondary (encyclopedia, course notes, fetched or searched), **[K]** established knowledge,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

How the simulator produces its numbers, and how much to trust one run. Chapter 01 gives the answers a queue should
converge to; this chapter says when a finite run is entitled to be close to them.

## 1. What a discrete-event simulation is

**Definition [S: Wikipedia].** The state of the system changes only at discrete instants called events. Between events nothing
happens, so the simulation clock jumps from one event time to the next instead of ticking.

| Component                | Role                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| State                    | Variables that describe the system: queue lengths, busy servers, in-flight requests. A step function of time. |
| Clock                    | Current simulated time. It only moves forward, to the time of the next event.                                 |
| Event list               | The pending-events set, a priority queue ordered by time. Each entry has a time and a type.                   |
| Random-number generators | Supply the stochastic inputs: inter-arrival times, service times, routing choices, failures.                  |
| Statistics               | Counters and integrals updated at every event (counts, sums, time-weighted areas).                            |

**The loop (next-event time advance) [S].**

1. Remove the earliest event from the list.
2. Advance the clock to its time.
3. Run its handler: update state and statistics.
4. Schedule follow-up events, usually after a sampled delay.
5. Repeat until the stop condition is met.

The alternative, **fixed-increment** time advance, splits time into small slices and processes each. It costs work for slices in which nothing
happens, so next-event is faster for queueing systems. [S]

Example of events for one request through a server: `request-arrival` (join queue or start service) then `service-complete` (free the worker,
start the next waiter, forward the response). A failure injects `node-failure` and `node-recovery` events at configured times. [K]

**Testable expectations**

- Time never goes backward: every recorded event timestamp is >= the previous one.
- Between two events the state does not change: queue length and busy-worker count are constant over the gap.
- Event count grows with load: roughly proportional to arrivals x (hops x events per hop).

## 2. Time, units and ties

- The unit of time must be fixed once. The simulator stores time as integer **microseconds**, so no floating-point drift accumulates over long runs. [K]
- Two events can have the same timestamp. The order in which they run must be defined and repeatable (for example by a priority class and then insertion order),
  otherwise runs with the same seed can diverge. **[?]** Owner to document the tie-break order.
- A service time of 0 ms is legal (a pass-through). It must still be processed as a separate event at the same instant, never skipped.

## 3. Randomness, seeds and reproducibility

- Every random choice comes from a pseudo-random stream, so a run is a deterministic function of (topology, seed). Same inputs give identical output. [K]
- **Independent streams.** If arrivals, service times and routing all draw from one stream, changing one decision (adding a node) shifts every later draw
  and changes unrelated outcomes. Separate streams per purpose keep comparisons clean. **Observed:** the simulator draws service times from one shared stream at the moment service starts, so a design with more workers starts services earlier and pairs different draws with different requests. Pairing seeds then does not shrink the noise in a comparison (tracked as `E-13`).
- **Common random numbers (CRN) [S].** To compare two designs, drive both with the same random inputs so a difference in output comes from the design, not from sampling
  noise. It needs the streams to be synchronised: the same draw must be used for the same purpose in both runs. It is often effective but its benefit is
  not guaranteed (Glasserman and Yao 1992), and there is no way to know the variance reduction without running both ways. [S]
- A single seeded run is **one sample**, not the truth. Different seeds give different samples whose spread is the sampling error (section 6).

**Testable expectations**

- Same seed, same topology: byte-identical summary. Different seed: different summary, same expectation.
- Replaying with the same seed after adding an unrelated, disconnected node should not change results if streams are independent; if it does, the generator is a single shared stream. **[?]**

## 4. Terminating versus steady-state questions

Two different questions, with different ways to answer [K]:

| Question                                                              | Example                                     | What to do                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| **Terminating**: how does the system behave over this specific window | "a 5-minute flash sale starting from empty" | Run the real window from its real starting state. No warmup. Report that window. |
| **Steady-state**: long-run average behaviour                          | "what is mean latency at 80% load"          | Discard the start-up transient (warmup), then average.                           |

Using steady-state formulas (chapter 01) to judge a short terminating run is the most common error. A 5-second run starting empty has not reached steady state at high load.

## 5. Warmup, transient bias and run length

- **Initialisation bias.** A run that starts empty under-counts queue length and waiting time early on, so the averages are biased low. Two fixes: start in a representative
  state, or run a **warmup** period and delete its data. [S: output-analysis lecture notes]
- **How big is the bias?** At rho 0.9 (M/M/1, mu = 100 per second) requests arriving in the first 5 s from empty wait 71.9 ms on average, against 90 ms in steady state: about 20% low. A separate Monte-Carlo of 20,000 replications gives this; a single 5 s run has a spread of about 40 ms, so hundreds of replications are needed to see it. [computed]
- **How long to warm up.** Pick the warmup from pilot runs: Welch's method averages several replications position by position and the analyst chooses the point where the curve flattens.
  MSER-5 is an automatic rule that picks the truncation point minimising the confidence-interval width on batch means of size 5. The literature notes many rules have not been
  thoroughly tested, so check the choice case by case. [S]
- **Rule of thumb.** The transient dies out over a few **relaxation times**. For an M/M/1 queue the relaxation time is about 1 / (mu (1 − sqrt(rho))²). [K, to verify in Kleinrock or
  Harchol-Balter] At mu = 100 per second this gives 0.12 s at rho 0.5, 0.90 s at rho 0.8, and 15.6 s at rho 0.95. Warmup must grow sharply with utilisation; a fixed 5 s warmup is
  fine at 80% load and nowhere near enough at 95%. [computed]
- **Run length.** After warmup the measured window must hold enough completed requests that the estimate is stable. At rho 0.6 with 20 ms service, 600 s gives about 18,000 requests.
  Heavy-tailed service or rho near 1 needs far more.
- **Autocorrelation.** Consecutive waits are positively correlated (a busy period raises many in a row), so N completed requests carry much less information than N independent
  samples. This is why raw standard errors from one run are too optimistic. [K]

**Testable expectations**

- A short run from empty reads low versus theory; lengthening the run or adding warmup moves the result toward the closed form (chapter 01 test Q-01 uses 600 s and 30 s warmup).
- The reported "measured window" excludes warmup: measured seconds = duration − warmup.
- A warmup-adequacy check warns when the first part of the window still trends.

## 6. Output analysis: how sure am I?

For a mean of an output such as average wait [S: lecture notes; formulas K]:

**Independent replications.** Run n times with different seeds (independent streams). Let xbar be the mean of the n results and s their sample standard deviation.
A (1 − a) confidence interval is xbar ± t(n−1, 1−a/2) x s / sqrt(n). Each replication discards its own warmup.

- Illustrative: n = 10, s = 1.3 ms, t(9, 0.975) = 2.262: half-width = 2.262 x 1.3 / sqrt(10) = **0.93 ms**.
- To reach a half-width h, n is about (t s / h)². For h = 0.5 ms with the same s, n is about 30. [computed]

**Batch means (one long run).** After warmup, split the output into k contiguous, non-overlapping batches of equal length, average each, treat batch means as roughly independent, and
apply the same t-interval with k − 1 degrees of freedom. Batches must be long enough that adjacent batch means are nearly uncorrelated. [S]

**Rules for comparisons.** To decide whether design A beats B, either use CRN and a paired interval on the differences, or use enough independent replications that the
intervals separate. Never compare two single runs and call the smaller number "better". [K]

**Testable expectations**

- Across 10 seeds of the Q-01 scenario the measured mean waits scatter around the closed form, and the 95% interval contains it in about 95% of repeated experiments.
- Standard error falls as 1 / sqrt(replications).
- A test oracle with a tolerance should be set from this spread, not guessed. Record the replication count and the half-width next to every tolerance. **[?]** Owner to fix the policy.

## 7. Verification and validation

- **Verification:** does the code do what the model says? Check against closed forms (chapter 01), conservation (arrived = completed + rejected + in flight),
  determinism, and limiting cases (very low load means no queueing; one server means M/M/1). [K]
- **Validation:** does the model resemble reality? Compare against measured production data and against known real-world behaviour (chapter 22 failure semantics). [K]
- **Invariants worth checking on every run** [K]: time never decreases; no negative queue; busy workers <= c; sum of per-node arrivals respects the topology; utilization in [0, 1];
  Little's Law on admitted traffic (chapter 01 section 3).

## 8. Discrete-event versus fluid (analytic) evaluation

|              | Discrete-event                                           | Fluid / analytic                                        |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------- |
| Unit of work | one request                                              | a continuous rate                                       |
| Cost         | proportional to the number of events                     | proportional to nodes + edges                           |
| Captures     | queues, jitter, timeouts, retries, breakers, every trait | steady-state throughput, utilisation, saturation, drops |
| Fails at     | very high rates (millions of events)                     | anything per-request: tails, retries, bursts            |

- A fluid model gives, for a node with capacity C and offered rate lambda: carried = min(lambda, C), dropped = max(0, lambda − C), utilisation = lambda / C (may exceed 1 as an offered ratio). [K]
- **The two paths must agree where both apply.** At moderate rates where both are affordable, utilisation and throughput from the fluid model must equal the discrete-event
  result within noise. This is a strong self-check. The classroom parity tests already do this for utilisation.
- QuickCart at 1,000,000 req/s is evaluated analytically: 8 servers give utilisation 1.25 and 20% loss; 13 servers give 76.9% (chapter 01 section 8).

**Testable expectations**

- Discrete and analytic agree on utilisation (within a few percent) and on throughput for a stable system at a rate both can run.
- Above the switch threshold the run reports it was analytic, and per-request outputs (traces, tails) are absent or marked unavailable.

## 9. Stop conditions

- **Duration:** stop at simulated time T. Requests still in flight at the cutoff are neither completed nor failed; they must be reported separately (not silently dropped). [K]
- **Request budget:** generate exactly N source requests, then drain in-flight work. Used for "the sale is N requests".
- **Early halt on saturation:** stop when utilisation or error rate crosses a threshold, so a doomed design reports its verdict at the moment it breaks.

**Testable expectations**

- Request-budget run generates exactly N requests.
- The in-flight count at the cutoff plus completed plus failed plus rejected equals arrived.
- Early halt: the run ends no later than the first moment the threshold is crossed.

## 10. Simulator scope

Modelled: next-event loop in integer microseconds, a seeded generator, per-node queues (c servers, finite capacity K), warmup, request-budget and saturation stop conditions,
an analytic fall-back above an event-count ceiling. Open **[?]**: tie-break order, independent streams, how warmup length is validated, whether a confidence interval is ever reported to the user.

## 11. Open items

- Fetch and cite: Law and Kelton, _Simulation Modeling and Analysis_ (output analysis, CRN); Kleinrock volume 1 (M/M/1 transient and relaxation time); Welch (1983) on the warmup method.
- Owner decisions: tolerance policy for comparing a seeded run with a closed form (section 6); stream independence (section 3); tie-break order (section 2).

## Sources

- [Discrete-event simulation, Wikipedia](https://en.wikipedia.org/wiki/Discrete-event_simulation) [S]
- [Simulation output analysis lecture notes (initialisation bias, Welch, batch means)](https://www.uni-due.de/imperia/md/content/tul/download/ews2014_2015_sl02_im_output_analysis.pdf) [S]
- [Warm-up methods survey, Warwick](https://warwick.ac.uk/fac/soc/wbs/projects/autosimoa/current_work/website_warmup_methods_total_doc.pdf) [S]
- [Variance reduction, Wikipedia (common random numbers)](https://en.wikipedia.org/wiki/Variance_reduction) [S]
- [Glasserman and Yao, Some guidelines and guarantees for common random numbers, Management Science 1992](https://pubsonline.informs.org/doi/fpi/10.1287/mnsc.38.6.884) [S, cited]
