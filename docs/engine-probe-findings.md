# Probe findings: edge settings, queue and stream nodes

Round three of the exploratory test pass (after the cache investigation in
`docs/cache-fallback-proposal.md`). Probes ran against the engine directly with known inputs and
theory to compare, plus the dev app. No engine behavior was changed.

## Summary

| Area                                                      | Result                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Edge settings after a run                                 | Passes by design; one gap closed (see 1)                                                         |
| Compute queue, M/D/1 at rho 0.8                           | Correct: mean wait 16 to 19 ms across seeds vs 20 ms theory; utilization 0.808 vs 0.8            |
| Conservation (arrived = processed + rejected + in flight) | Balanced in every probe                                                                          |
| Little's Law check                                        | Two bugs (see 2): false failures under rejection, and L is mis-measured for non-Poisson arrivals |
| Stream node with a slow consumer                          | Consistent: 200 produced = 99 committed + 101 lag                                                |
| Message `queue` and `stream` node counters                | Counts look doubled (see 3), probably a labelling question                                       |

## 1. Edge settings

The edge fields the inspector exposes (label, protocol, interaction, route appearance) are
**presentation-only** (`displayProtocol`, `displayMode`, `routingStyle`), and the panel says so, so
editing them after a run correctly does not change results. Link data that does affect a run
(latency, error rate, packet loss, mode, weights, fan-out) can still be changed through the JSON
viewer or the terminal, and those edits used to leave old results looking current. The stale-results
check now includes that data and excludes the visual keys, so re-running auto layout never flags
results. Shipped with tests in `resultsTopologyRelation.test.ts`.

## 2. Little's Law check (engine, not fixed)

Both bugs are pinned by `src/engine/analysis/littlesLawKnownIssues.test.ts` with `it.fails`: the
file passes today, and each test turns red when its bug is fixed (remove the marker then).

**2a. Rejected arrivals are counted in lambda.** `calculateLittlesLaw` (`analysis/output.ts`) uses
`lambda = postWarmupArrived / window`, but `W` is the time in system of _admitted_ requests.
Little's Law holds for the admitted flow, so a node that rejects is reported as a violation while
being consistent. Probe: 1 worker, 10 ms service, capacity 5, 300 rps: observed L = 5 (the node is
full), admitted rate x W is about 4.7, but the check expects 14.1 and fails. A K=1 server at 150 rps
fails the same way (observed 0.58, expected 1.54, while admitted rate x W is 0.6).

User impact: `ResultsTray` turns a failed check into a **warning in Simulation Health**, so
overloading a finite buffer, the thing students do to learn about queues, shows a warning for a
system that is behaving correctly.

**2b. L is point-sampled, not a time average.** `MetricsCollector.recordNodeSnapshot` averages the
snapshots it happens to take. With constant arrivals every snapshot lands between jobs and sees an
empty system: a server at 50 rps with 10 ms service (utilization 0.5) reports observed L = 0 where
the true time average is 0.5. The check still passes only because of the
`absoluteError <= 0.5` guard in `calculateLittlesLaw`, which hides it. Poisson arrivals are fine
(PASTA), which is why the standard M/D/1 case looks right. The code already knows this: utilization
was moved off point sampling to a time-weighted integral for the same reason (comment in
`recordNodeSnapshot`).

Suggested fixes (engine change, needs a decision):

- 2a: take `lambda` from admitted requests, or avoid lambda and compare L with
  `sum(time in system of admitted requests) / window`, which is the identity Little's Law states.
- 2b: accumulate the time integral of the number in system between events, as the busy-area
  integral does for utilization; then drop the absolute-error guard.

## 3. Message `queue` and `stream` counters (to confirm)

A `queue`-type node (a message queue that acks the producer, then delivers to a consumer) reports
about **twice** the arrivals the source sent (2,102 for 1,051 sent) and **half** the configured
service time (5 ms for 10 ms): the producer-side ack and the consumer-side delivery are counted as
separate arrivals, one with no service. A `stream` node likewise shows 400 arrived for 200
produced. This looks intentional (async-ack semantics) but is easy to misread in the node metrics
and the results table. Question for the owner: should the metrics label these as "produced" and
"delivered", or report producer-side arrivals only?

## 4. A Simple-layout bug found along the way (fixed)

"Back to Run Inspector" cleared the selection, and the simple layout closes the inspector when
nothing is selected, so the button closed the panel instead of showing the Run Inspector. It now
keeps the panel open in the simple layout.

## Not covered yet

Stream brokers with several consumer groups or partitions, queue discipline other than FIFO,
dead-letter behavior, and Classroom mode with a real assignment question.
