# Question Archetype Patterns

Use an archetype to establish the evidence model, not to predetermine the answer.
The JSON templates remain the source of truth for field shape.

| Archetype           | Execution        | Typical private evidence                                                            | Required near miss                                                  |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Analytic capacity   | Analytic/fluid   | throughput, error rate, utilization/headroom, topology paths                        | one fewer replica or lower capacity fails the intended limit        |
| Discrete resilience | Discrete         | fixed-seed fault/experiment verdict, retry/timeout/breaker metrics, availability    | remove redundancy or a resilience control                           |
| Storage path        | Usually discrete | structural path, placement, consistency/durability proxy, storage latency           | bypass the required store or weaken the supported consistency proxy |
| Async messaging     | Discrete         | producer→broker→consumer path, queue/backlog/drain metrics, delivery trait counters | remove the broker/consumer or exceed a bounded backlog              |
| Bounded correctness | Discrete only    | every operation checked, zero violations, explicit verified/unchecked counter       | introduce a reproducible violating path                             |

## Analytic capacity

- Keep the workload steady and high enough to justify analytic execution.
- Author capacity directly only when it is a stated problem given. Otherwise
  serialize resources and service time and use the engine-derived capacity.
- Grade topology reachability plus throughput/error and a headroom invariant.
- Treat routing weights as part of the contract when even fan-out matters.

## Discrete resilience

- Use a deterministic seed and explicit fault start/duration or a supported chaos
  preset with a named target.
- Bind every metric check to the case that creates the fault evidence.
- Gate on the experiment verdict when the experiment is the lesson; a generic
  availability number alone does not prove recovery behavior.

## Storage path

- Require the intended source→service→storage path structurally.
- Do not claim vendor durability, multi-key transactions, or global ordering from
  generic latency/error metrics.
- Use only consistency metrics listed in the capability snapshot and document the
  exact proxy being tested.

## Async messaging

- Require the broker/queue and a reachable consumer, not merely the right icons.
- Use discrete execution for delivery, retries, deduplication, and backlog state.
- Specify whether the acceptance condition is bounded backlog, eventual drain,
  duplicate suppression, or another supported trait.

## Builder-policy variants

- **Baseline/optimize:** provide a valid scaffold and allow changes to a limited
  set of resource, topology, or service-definition knobs. Grade improvement and
  constraint preservation.
- **Locked lab:** lock scaffold nodes and definitions, expose only the component
  family or trait needed for the lesson, and ensure a valid solution remains
  constructible under the allowlist and builder policy.
- **Open build:** keep the scaffold empty, use the smallest useful palette, and
  close icon-placement loopholes with path and connected-design rules.

For every archetype, keep the private suite hidden, author a separate harmless
public dry run if learners may test, and validate one passing reference, one
plausible near miss, and one anti-gaming design.
