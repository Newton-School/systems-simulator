# QuickCart Flash Sale — Builder Walkthrough (horizontal scaling + 80% headroom)

Build and verify a backend fleet that serves a **1,000,000 req/s** flash-sale peak
while keeping every server at or below **80% utilization**.

> This is the learner and canonical-design guide. To author the question itself,
> see the [Question Studio Walkthrough](question-studio-walkthrough.md).

## The problem

> You are the backend architect for **QuickCart**, an e-commerce website running a
> major flash sale. The site expects up to **1,000,000 requests per second**. Each
> backend server can handle at most **100,000 requests per second**, and stable
> operation requires using no more than **80%** of that capacity. The configured
> load balancer distributes traffic evenly across the servers you add.
>
> Build the backend from **Users**, a **Load Balancer**, and **Servers**.

### What this lesson tests

- Horizontal capacity planning with a mandatory headroom margin.
- Even distribution from a load balancer to a stateless backend fleet.

### Governing calculation

```text
usable capacity per server = 100,000 req/s × 0.80 = 80,000 req/s
required servers = ceil(1,000,000 req/s ÷ 80,000 req/s) = ceil(12.5) = 13

12 servers: 1,000,000 ÷ 12 = 83,333 req/s each = 83.3% utilization → fail
13 servers: 1,000,000 ÷ 13 = 76,923 req/s each = 76.9% utilization → pass
```

The boundary is inclusive: **at most 80%** means `utilization <= 0.8`.

### Assumptions

- All backend server units are identical and stateless.
- One server unit has a derived full-load capacity of exactly `100000` req/s.
- The load balancer uses an even round-robin split and is a passthrough rather
  than a capacity bottleneck in this lesson.
- The authored grading scenario, not the learner's local workload edits, supplies
  the `1000000` req/s peak.
- A fleet may be drawn as 13 separate API Server nodes with one instance each, or
  as one API Server pool with `13` service instances. Both represent 13 identical
  server units and produce the same capacity result.

## Final topology

```text
Users (Client App) -> Load Balancer -> 13 server units
                                      |- API Server 1
                                      |- API Server 2
                                      |- ...
                                      `- API Server 13
```

| Canvas label                                       | Resolved type   | Count | Role in this lesson                              |
| -------------------------------------------------- | --------------- | ----: | ------------------------------------------------ |
| Client App / Input Source, labeled `Users`         | `api-endpoint`  |     1 | Emits the flash-sale workload.                   |
| Load Balancer                                      | `load-balancer` |     1 | Splits traffic evenly across the backend pool.   |
| API Server, labeled `Server 1` through `Server 13` | `microservice`  |    13 | Provides the stateless request-serving capacity. |

The compact accepted variant uses one `microservice` node with **Service
instances** = `13`. The visible-node variant is clearer for this drag-and-drop
exercise and is the canonical walkthrough.

---

## Part 1 — Place the nodes

From the component library, place:

1. One **Client App / Input Source** and rename it `Users`.
2. One **Load Balancer**.
3. Thirteen **API Server** nodes and rename them `Server 1` through `Server 13`.

Place `Users` on the left, the load balancer in the center, and the servers in a
vertical or two-column pool on the right. The physical positions are cosmetic;
the directed connections determine behavior.

For the compact pool variant, place one **API Server** named `Server Pool` and set
its instance count to `13` in Part 3.

## Part 2 — Confirm the injected workload

The authored question owns the graded workload. The learner-visible dry run uses
the same values:

| Field          | Value                     |
| -------------- | ------------------------- |
| Scenario       | `flash-sale-peak`         |
| Pattern        | `Constant`                |
| Base traffic   | `1000000` req/s           |
| Request mix    | `GET` = `100%`            |
| Request size   | `100` bytes               |
| Duration       | `5` sec                   |
| Warmup         | `0` sec                   |
| Seed           | `quickcart-flash-sale-v1` |
| Stop condition | **Duration elapses**      |

Leave **Source node ID** blank in the authored scenario. The evaluator resolves
the single `api-endpoint` source from each learner topology.

Do not try to make a failing design pass by lowering local traffic. Submission
reapplies the question-owned `1000000` req/s workload.

## Part 3 — Configure each server unit

Select every API Server and enter the same values. These settings derive the
question's stated `100000` req/s ceiling; capacity is a read-only consequence,
not a free-typed learner value.

### Resources

| Field                 | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| **Instance type**     | `m5.xlarge`                                            |
| **Service instances** | `1` for each visible server; `13` for the compact pool |
| **Execution profile** | `io-bound`                                             |
| **Purchase model**    | `on-demand`                                            |

### Performance and queueing

| Field                  | Value      |
| ---------------------- | ---------- |
| **Distribution model** | `constant` |
| **Mean service time**  | `1.28` ms  |
| **Timeout**            | `1000` ms  |
| **Queue discipline**   | `fifo`     |

The capacity readout should resolve as follows for one server unit:

```text
m5.xlarge vCPU = 4
io-bound concurrency = 4 vCPU × 32 = 128 concurrent workers
capacity = 128 ÷ 0.00128 seconds = 100,000 req/s
```

For the compact pool, `13` instances derive `13 × 100000 = 1300000` req/s total
capacity. Do not type a raw `capacityRps`; learner-authored raw capacity overrides
are ignored unless they carry an author-only flag.

If **Execution profile** is hidden or resources are locked, stop and report an
authoring mismatch. This question requires the assignment environment to expose
resource and execution-profile controls.

## Part 4 — Wire and route the edges

Create these directed connector edges:

```text
Users -> Load Balancer
Load Balancer -> Server 1
Load Balancer -> Server 2
...
Load Balancer -> Server 13
```

Use the following routing contract:

| Setting                | Value                                  |
| ---------------------- | -------------------------------------- |
| Edge model             | `connector`                            |
| Edge mode              | `synchronous`                          |
| Load-balancer strategy | `round-robin` / even split             |
| Edge weights           | Equal; do not create weighted routes   |
| Conditions             | None                                   |
| Fan-out                | One request goes to one backend server |

Connector edges express dependency and flow but add no network latency,
bandwidth, packet loss, or egress physics. With the compact pool variant, create
one connector from the load balancer to `Server Pool`; the pool's instance count
provides the even internal capacity.

## Part 5 — Run the scenario

1. Open **Run** and choose the learner-visible `flash-sale-peak` dry run.
2. Confirm the normalized workload still shows `1000000` req/s and the
   `headroom-80` invariant.
3. Run the scenario, then inspect **Summary**, **Per node**, and **Invariants**.
4. Confirm `summary.throughput`, `summary.errorRate`, the busiest server's
   utilization, and `invariantViolations.count`.
5. Submit only when every required structural rule and runtime check passes.

This run resolves to **analytic/fluid evaluation** because the lesson concerns
high-rate steady-state throughput, utilization, saturation, and drops. It does
not create five million individual request events. `summary`, `perNode`, and
invariant results are authoritative; any request dots are representative visual
aids.

## Expected results

| Design variant      |  Aggregate capacity |  Per-server load | Expected evidence                                | Verdict  | Failing or passing check                                            |
| ------------------- | ------------------: | ---------------: | ------------------------------------------------ | -------- | ------------------------------------------------------------------- |
| 8 server units      |       800,000 req/s |    125,000 req/s | ~800K throughput, ~20% error, 125% utilization   | Fail     | `no-dropped-requests`, `sustain-peak-throughput`, `within-headroom` |
| 12 server units     |     1,200,000 req/s |     83,333 req/s | ~1M throughput, ~0% error, 83.3% utilization     | Fail     | `within-headroom`                                                   |
| **13 server units** | **1,300,000 req/s** | **76,923 req/s** | **~1M throughput, ~0% error, 76.9% utilization** | **Pass** | All required checks                                                 |
| 14 server units     |     1,400,000 req/s |     71,429 req/s | ~1M throughput, ~0% error, 71.4% utilization     | Pass     | All required checks; extra capacity                                 |

The numeric values above are analytic predictions from the stated rate and
capacity. The target engine's QuickCart behavioral tests confirm the pass/fail
separation for 8, 12, and 13 server units; the exact metric display must still be
checked in the target Question Studio before export.

## Why the design works

The load balancer turns one `1000000` req/s stream into equal backend shares. At
12 server units, capacity is sufficient to avoid drops, but the share is
`83333` req/s, which exceeds the allowed `80000` req/s usable budget. Adding the
thirteenth unit reduces every share to about `76923` req/s. That keeps the fleet
below the headroom boundary while preserving the full throughput.

## Simulator physics and boundaries

- **Modeled directly:** question-owned offered RPS, even rate splitting, derived
  server capacity, aggregate throughput, error rate, per-node utilization,
  saturation, dropped rate, and the `<= 0.8` invariant.
- **Inferred from topology/configuration:** one source, presence and placement of
  the load balancer and backend pool, directed connectivity, and use of identical
  server units.
- **Simplified proxy:** each server is a homogeneous stateless unit; the load
  balancer is an infinite-capacity passthrough; connector edges have no network
  physics; the five-second run represents steady state rather than startup.
- **Not modeled or graded:** product browsing logic, inventory consistency,
  checkout, databases, cache behavior, autoscaling delay, health checks, server
  failure, multi-zone placement, provider limits, or real cloud pricing.

## Gotchas and anti-gaming checks

- **Do not round down.** `12.5` server units means `13`, not `12`.
- **Use raw utilization units correctly.** The invariant threshold is `0.8`, not
  `80`.
- **Keep routes even.** Unequal routing can push the busiest server over 80% even
  when aggregate capacity looks sufficient.
- **Connect every visible server.** Disconnected icons fail the connected-design
  rule and contribute no capacity.
- **Do not lower the workload.** Grading injects the original `1000000` req/s.
- **Do not type a fake capacity.** The simulator derives capacity from resources,
  execution profile, instance count, and service time; an untrusted raw override
  is ignored.
- **One node is not one machine.** A single Server Pool with `13` service
  instances is an accepted compact representation of the same fleet.

## What the authored question grades

| Learner obligation                         | Evidence           | Rule/check                                                           |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------- |
| Use exactly one traffic source             | Static topology    | `STRUCTURAL_RULE requires_single_source`                             |
| Include the configured load-balancing tier | Static topology    | `STRUCTURAL_RULE requires_component(load-balancer)`                  |
| Include a backend server pool              | Static topology    | `STRUCTURAL_RULE requires_component(microservice)`                   |
| Route Users to the load balancer           | Static topology    | `STRUCTURAL_RULE requires_edge(api-endpoint -> load-balancer)`       |
| Route the load balancer to the server pool | Static topology    | `STRUCTURAL_RULE requires_edge(load-balancer -> microservice)`       |
| Avoid disconnected icons                   | Static topology    | `STRUCTURAL_RULE requires_connected_graph`                           |
| Serve the peak without material drops      | Analytic summary   | `summary.errorRate < 0.01`                                           |
| Sustain the full offered rate              | Analytic summary   | `summary.throughput >= 1000000`                                      |
| Keep every server at or below 80%          | Scenario invariant | `invariantViolations.count == 0` for `perNode.maxUtilization <= 0.8` |

Server instance type, service time, and the capacity arithmetic are modeled
configuration, but they are not duplicated as topology-count rubric checks. The
runtime outcomes decide whether the chosen fleet actually meets the lesson.

## Simpler and harder variants

- **Simpler:** preconfigure each server unit's resources and ask only for the
  server count and edges.
- **Harder:** add a deterministic server failure and require enough N+1 capacity
  to remain at or below 80%, or compare the cost and blast radius of smaller and
  larger instance sizes.
