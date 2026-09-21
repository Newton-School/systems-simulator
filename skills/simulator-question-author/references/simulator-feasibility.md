# Simulator Feasibility and Physics

Use this reference before committing to the topology, scenario, or grading plan.
Its purpose is to prevent a walkthrough from promising behavior the simulator
does not implement.

## 1. Support tiers

This package embeds the support snapshot verified on **2026-09-21**. Treat it as
the authoring contract when no newer target-environment documentation is
available.

| Tier                  | Authoring meaning                                                            |
| --------------------- | ---------------------------------------------------------------------------- |
| `first-class`         | Runtime, grading, authoring, and tests are strong enough for direct claims.  |
| `guided`              | Real modeled behavior exists, but the guide must state its boundary.         |
| `structural-only`     | Teach and grade topology/semantic proxies, not runtime proof.                |
| `presentational-only` | The component may appear in a diagram but should not carry a runtime lesson. |
| `deferred`            | Do not author it as a supported requirement.                                 |

Check domain, component-category, trait, and concept entries. A strong domain does
not make every named technology or guarantee first-class.

## 2. Feasibility matrix

For every source requirement, record one row:

| Requirement                     | Support tier                    | Evidence mode                                | Modeling decision | Walkthrough wording                                         |
| ------------------------------- | ------------------------------- | -------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| Example: keep servers below 80% | first-class                     | analytic metric/invariant                    | model directly    | “Measured from per-node utilization.”                       |
| Example: exactly-once delivery  | structural-only/guided boundary | topology + runtime markers, not formal proof | narrow claim      | “Models dedup/journal states; does not prove exactly-once.” |

Allowed evidence modes:

- static topology;
- static configuration/property;
- discrete runtime;
- analytic runtime;
- budget;
- learner explanation;
- deferred.

If no implemented evidence mode fits, do not create a grading check.

## 3. Two execution paths

The simulator chooses between discrete-event and analytic/fluid evaluation.

### Discrete-event evaluation

Use when the lesson depends on individual requests or time-ordered behavior:

- queues and timeouts;
- retry/backoff attempts;
- circuit-breaker state;
- deterministic fault windows;
- redelivery/DLQ behavior;
- lock, reservation, idempotency, broker, replication, protocol, or
  commit-outcome state timelines;
- trace-specific semantic criteria.

Keep the workload small enough to run deterministically. Use a fixed seed.

### Analytic/fluid evaluation

Use for high-scale steady-state questions:

- offered and served RPS;
- per-node utilization;
- capacity saturation and dropped rate;
- throughput and error rate;
- headroom invariants;
- rate-derived latency approximations exposed by the current fluid output.

The fluid model propagates rates and does not execute every request. It does not
model retries, breakers, queue jitter, or per-request trait state machines.
Representative request dots/outcomes are visual aids; `summary`, `perNode`, and
invariant results are authoritative.

Never attach a runtime semantic state criterion to a scenario that will evaluate
analytically.

## 4. Capacity truth

The verified analytic capacity order is:

1. `config.capacityRps` only when `config.capacityAuthored === true`;
2. otherwise derived effective concurrency divided by mean service time;
3. known passthrough components use infinite forwarding capacity.

Important consequences:

- An authored capacity is a question/scaffold given, not a value the learner can
  use to bypass resource derivation in normal build mode.
- A blank-canvas walkthrough must explain how the learner reaches the intended
  capacity through actual resource, instance, concurrency, and service-time
  controls.
- If the question states “each server handles X RPS,” confirm the learner can
  reproduce X. Otherwise use a prepared scaffold, express the problem through
  derived capacity, or change the wording.
- Load balancers, gateways, sources, and similar passthrough nodes may not be
  modeled as bottlenecks in the same way as capacity-bound processors.

Always show the capacity arithmetic in the builder guide and verify it matches
the serialized topology.

## 5. Workload truth

A prompt scale field is not automatically a runtime workload. The scenario must
carry the actual evaluation conditions:

- `baseRps` and pattern;
- duration and warmup;
- request distribution weights and sizes;
- optional keyspace/metadata for contention;
- optional source override;
- deterministic faults;
- invariants and stop condition.

Rules:

- Request weights must total 1 (100% in Studio).
- Leave source ID blank when learner node IDs are not fixed.
- Do not print a read/write ratio and run a different mix.
- Do not print a spike or failure requirement and grade only a constant healthy
  baseline.
- A scenario-owned workload overrides learner attempts to lower the load.

## 6. Edge and routing truth

Choose the edge model deliberately:

- connector edges represent logical dependency/flow;
- network edges carry modeled latency, loss, protocol, and other edge physics.

Do not ask bandwidth, TLS, TCP handshake, HTTP/2 multiplexing, or low-level
transport questions unless the current implementation explicitly models the
required evidence. Network support is guided, not a blanket promise of packet
simulation.

Routing assumptions such as even split, conditional paths, health-aware routing,
or fan-out must be configured, not merely described.

## 7. Strong current teaching surfaces

Within the embedded snapshot, these are reliable starting points:

- compute queueing, latency, throughput, utilization, saturation, and timeouts;
- cache behavior, store fit, and read/write paths;
- async decoupling and backlog;
- deterministic routing and placement;
- retry and breaker behavior at discrete scale;
- rate limiting and reservation counters;
- deterministic stream, replication, protocol, idempotency, lock, reservation,
  and commit-outcome states within their declared boundaries;
- topology cost totals and budget caps.

## 8. Claims that require narrowing

Common unsafe claims:

- formal exactly-once;
- linearizability proof;
- real Raft election timing or packet-level replication;
- physical multi-broker replication guarantees;
- strict global ordering;
- provider-specific managed-service semantics or complete pricing;
- low-level transport physics;
- application business logic correctness;
- presentational observability/security/CI components behaving as real products.

Translate these into supported proxies, explanation prompts, or explicit
boundaries. Never label a proxy as proof of the original guarantee.

## 9. Feasibility decision

Choose one outcome before authoring:

- **Direct:** the lesson is fully modeled and gradeable.
- **Guided:** the lesson is modelable with stated simplifications.
- **Structural:** topology/semantic evidence teaches the lesson; runtime is not
  claimed.
- **Reframed:** a narrower supported lesson replaces the original.
- **Blocked:** no honest mapping exists; do not produce misleading guides.

Both walkthroughs must state the same decision.
