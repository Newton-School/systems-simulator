# User Flows Catalogue — Simulator and Question Studio

Status: proposed layout, for review before any test is written.

Purpose: one list of every flow a user can take, each with the result and numbers it must produce. When a
flow breaks later, its ID says which feature broke and which number moved. Origin of this list: the
"node down via chaos injection was not shown in the UI or results" bug, fixed later. Every flow below
asserts what the **user sees**, not only what the engine computes.

## 0. How to read this

**Tiers**

| Tier | Code | Meaning |
|---|---|---|
| Healthy | `H` | Used as intended; correct result, no warnings. |
| Moderate | `M` | Works but degraded: warnings, near-miss, partial failure, stale or partial data. |
| Unhealthy | `U` | Bad input, broken state or injected failure. App must say so clearly, not crash, not lose work, not show healthy numbers. |

**ID format:** `<AREA>-<NN>-<tier>`, for example `CHS-03-U`. Area codes are in section 1.

**Where the expected value comes from (column "Expect")**

| Mark | Source | Example |
|---|---|---|
| `A` | Analytic: derived from theory or arithmetic, written down in advance | utilization = arrival rate / (workers x service rate); 13 servers at 1M rps = 76.9% |
| `I` | Invariant: must hold for every run | arrived = processed + rejected + in flight |
| `G` | Intended behaviour that has no closed formula yet (a trend, a bound, or a range). Written as a **rule** first ("hit ratio returns to the declared rate after the flush", "p99 is within 10% of timeout"), never as a number copied from the engine | cache stampede recovery |
| `UI` | UI behaviour with no number: text, badge, enabled/disabled, navigation | "Down" badge appears on the node |

**Rule: expected results come from how the simulator is meant to work, not from what the code outputs today.**
Sources, in order of trust: (1) queueing theory and arithmetic, (2) the written specs and walkthroughs
(`ns-simulator-docs/specs`, `canonical-catalogue` "Failure modes & propagation semantics" and "Simulation
outputs", `builder-walkthrough.md`), (3) your decision as the product owner. The engine is only
consulted afterwards, to find out whether it agrees. A mismatch is a **finding to triage** (engine bug,
wrong expectation, or unclear spec), never an automatic update of the expected value.

Where no source gives a number, a `G` flow stays a rule (range or direction). A pinned exact number is
allowed only as a regression lock, after you approve it, and is marked "locked, not verified".
Numbers already documented in the repo are written out above.

**Two assertions on every run-based flow** (this is what catches the original bug):
1. Engine truth: `runSimulation` on the same topology and seed gives the expected number.
2. UI parity: the number or state on screen (node badge, Overview, Node metrics, Failures, Event log) equals the engine's.

## 1. Areas

| Code | Area | Section |
|---|---|---|
| `SHL` | App shell, surfaces, header, settings, command palette | 2 |
| `LIB` | Component library and palette | 3 |
| `CNV` | Canvas editing | 3 |
| `NOD` | Node configuration | 4 |
| `EDG` | Edge configuration | 4 |
| `WRK` | Workload and run controls | 5 |
| `CHS` | Chaos and fault injection | 6 |
| `TRT` | Component behaviours (traits), by sample topology | 7 |
| `RES` | Results and analysis | 8 |
| `IOF` | Persistence, import, export, JSON, terminal | 9 |
| `VAL` | Topology validation | 9 |
| `LRN` | Learner question mode and grading | 10 |
| `STU` | Question Studio | 11 |
| `CLI` | `sim` command line | 11 |

## 2. SHL — App shell

| ID | Flow | Expect |
|---|---|---|
| SHL-01-H | Open app: simulator surface loads with empty canvas, header, library, no console errors | UI |
| SHL-02-H | Open `?studio=question`, `?surface=question-studio`, `/question-studio`: Studio loads; plain URL loads simulator | UI |
| SHL-03-H | Command palette (open, search, run a command, close with Esc) | UI |
| SHL-04-H | Shortcuts modal lists shortcuts; each documented shortcut works | UI |
| SHL-05-H | Theme toggle light/dark persists across reload | UI |
| SHL-06-H | Settings modal: every tab opens (Display, Simulation, Component Library, Environments, LLM Grading) and settings search finds items | UI |
| SHL-07-H | Display settings: node display style (symbol/card), edge routing style, SPOF badges toggle, default results tab, simple layout; each changes the canvas as stated and persists | UI |
| SHL-08-H | Header menu "More actions": every item reachable and working | UI |
| SHL-09-M | Simple-shell layout: results groups (Summary, Components, Requests, Timeline) show all seven tabs; "Back to Run Inspector" keeps the panel open (past bug) | UI |
| SHL-10-M | Small viewport (tablet/phone width): layout stays usable, no horizontal page scroll | UI |
| SHL-11-U | Unknown URL surface param falls back to simulator, no crash | UI |
| SHL-12-U | Corrupted saved settings in storage: app starts with defaults, shows no crash | UI |
| SHL-13-U | Storage blocked/full: app works, tells the user that autosave is off | UI |

## 3. LIB and CNV — Building a design

### 3.1 Library (palette)

Every palette template is a node the user can add. The matrix test adds each one and checks it appears,
has the right type, default config and icon.

| ID | Flow | Expect |
|---|---|---|
| LIB-01-H | Add each template once. Families to cover: compute (API Server, ID Generator, Serverless Function, Job Worker, Cron Job, Auth Service, Search Service, Sidecar Proxy), network (Load Balancer / L4 / L7, Ingress, Reverse Proxy, Service Mesh, NAT, VPN, Routing Rule/Policy, Edge Router, Network Interface, DNS Server, Service Registry, DNS Resolver, Global Traffic Manager, CDN, API Gateway, Connection Server), storage (SQL DB, NoSQL DB, Distributed Cache, Read Replica, Object Storage, Search Index, Time-series, Graph, Vector, Data Warehouse, Data Lake), messaging (Message Queue, Event Broker, Pub/Sub, Event Stream, Notification Service, Streaming Analytics), security (WAF, Firewall, Security Group), infra (Region, Availability Zone, Subnet, Kubernetes Cluster), AI (LLM Gateway, Tool Registry, Memory Fabric, Agent Orchestrator, Safety & Observability), data infra (Sharding, Hashing, Shard Node, Partition Node), config (Config Store, Secrets Manager, Feature Flag Service), reliability (Rate Limiter, Circuit Breaker, Distributed Lock, Idempotency Service, Reservation Store), observability (Metrics, Log, Centralized Logging, Tracing, Alerting, Health Check Manager), generic (Service, My Service, Custom Node, Traffic Source, Output Sink, External Service, Client App) | UI: one node per template, correct type and label |
| LIB-02-H | Library search filters; clear restores | UI |
| LIB-03-H | Component library mode `default` vs `all`; hide/show single templates in Settings changes the palette | UI |
| LIB-04-H | Add via drag-and-drop and via the Add Component popover and the contextual add picker (same result) | UI |
| LIB-05-H | Blueprint, Lab and Scenario sidebar panels open and load an item; scenario search works | UI |
| LIB-06-H | Sample scenario picker loads each engine sample (section 7) onto the canvas | UI: node and edge counts equal the sample JSON |
| LIB-07-M | Custom definition creator: create a custom component; it appears in the palette and behaves like its base | UI |
| LIB-08-U | Custom definition with empty or duplicate name / invalid capacity: blocked with a message | UI |
| LIB-09-U | Learner question restricts the palette (allowed/forbidden types): forbidden items missing or flagged | UI |

### 3.2 Canvas

| ID | Flow | Expect |
|---|---|---|
| CNV-01-H | Add node, move it, rename inline, delete it | UI |
| CNV-02-H | Connect two nodes by dragging handle to handle (magnetic snap); edge appears with direction cue | UI |
| CNV-03-H | Select node opens Properties; select edge opens edge Properties; click empty canvas clears | UI |
| CNV-04-H | Multi-select, move, delete, copy/paste, duplicate (if supported) | UI |
| CNV-05-H | Undo/redo (if supported); zoom, fit view, pan | UI |
| CNV-06-H | Auto layout (ELK) arranges nodes and does not mark results stale | UI |
| CNV-07-H | Container nodes (Region, AZ, Subnet): drop nodes inside, they group; move container moves children | UI |
| CNV-08-H | Text label and canvas annotations: add, edit, delete | UI |
| CNV-09-H | Node display style symbol vs card; metric lens switcher changes what the node shows | UI |
| CNV-10-H | Legend opens and matches what is drawn | UI |
| CNV-11-M | Connect incompatible nodes (for example Source to Source): app warns or blocks, says why | UI |
| CNV-12-M | Edit design after a run: results are marked stale; auto layout alone does not | UI (see EDG-07, RES-12) |
| CNV-13-U | Self-loop, duplicate edge, edge to a container: blocked or warned | UI |
| CNV-14-U | Delete a node that has edges: edges removed too, no orphan edge, Properties closes | UI |
| CNV-15-U | Very large design (200+ nodes): canvas stays responsive, no crash | UI |
| CNV-16-U | Delete everything: empty-state shown, Run disabled with reason | UI |

## 4. NOD and EDG — Configuring parts

### 4.1 Node properties

| ID | Flow | Expect |
|---|---|---|
| NOD-01-H | Compute resources: pick instance type and count; workers and admission are derived (`workersPerInstance`/`queueSlots` shown read-only) | A: workers = vCPU x workers-per-vCPU for the workload kind |
| NOD-02-H | Workload kind cpu-bound vs io-bound changes derived concurrency | A |
| NOD-03-H | Service time distribution editor: constant, deterministic, normal, log-normal, exponential, uniform, weibull, poisson, binomial, gamma, beta, pareto, empirical, mixture. For each: set, run, check mean service time near the distribution mean | A: mean of distribution; I: seeded run repeats exactly |
| NOD-04-H | Capacity and queue: workers, capacity K, timeout | A: see TRT-01 queue cases |
| NOD-05-H | Purchasing model on-demand/reserved/spot changes cost only | A: reserved ~40% off, spot ~70% off |
| NOD-06-H | Routing rules editor (content routing): add/remove/reorder rules | UI + traffic split A |
| NOD-07-H | Request distribution, traffic origins (source nodes), queue weights, bulkhead partitions editors | UI + A |
| NOD-08-H | Security form (WAF, firewall, auth) and ID allocation section | UI |
| NOD-09-H | Connection capacity section | A |
| NOD-10-H | Location (region/AZ) assignment and location rollups panel | UI |
| NOD-11-H | Node health summary on Properties matches node state after run | UI parity |
| NOD-12-M | Legacy `workersPerInstance` / `queueSlots` set: validator warns they are ignored | UI |
| NOD-13-M | Instance count above `maxInstances`: warning, still editable | UI |
| NOD-14-U | Negative, zero, NaN, empty, huge values in every numeric field: rejected or clamped, message shown, no crash, last good value kept | UI |
| NOD-15-U | Distribution with invalid params (sigma < 0, mixture weights not summing to 1, empty empirical): validation error, Run blocked | UI |
| NOD-16-U | Learner edits a locked/authored field in a question: control disabled, hint shown | UI |

### 4.2 Edge properties

Edge fields that **change a run**: latency, error rate, packet loss, mode (sync/async), weights, fan-out,
concurrency, bandwidth. **Presentation only**: label, protocol display, interaction display, route appearance.

| ID | Flow | Expect |
|---|---|---|
| EDG-01-H | Set latency (constant 1 ms) on a two-node path, run | A: end-to-end latency = sum of service + edge latency |
| EDG-02-H | Edge error rate 10% | A: error rate ~0.10 (G for exact seeded value) |
| EDG-03-H | Packet loss | G |
| EDG-04-H | Synchronous vs asynchronous mode | G; async does not add to caller latency |
| EDG-05-H | Weighted edges split traffic (70/30) | A: per-target arrivals ~70%/30% |
| EDG-06-H | Fan-out / broadcast edge | A: arrivals at each target = source rate |
| EDG-07-H | Edit a behavioural edge field after a run: results marked stale | UI |
| EDG-08-H | Edit a presentation-only edge field after a run: results stay current, panel says presentation-only | UI |
| EDG-09-H | Cross-region / multi-AZ edge picks automatic geographic latency | G, `cross-region-auto-latency`, `multi-az-auto-latency` |
| EDG-10-M | Bandwidth-limited edge saturates under load: transmission delay visible in edge latency breakdown | A: size / bandwidth |
| EDG-11-M | Connector edge (question model) adds no latency, bandwidth, loss | A: zero added |
| EDG-12-U | Edge latency negative, error rate > 1, loss > 1, weights not summing to 1: validation message | UI |
| EDG-13-U | Edge error rate 100%: all requests fail, Overview shows error rate 1.0, health not "healthy" | A: 1.0 |

## 5. WRK — Workload and run controls

| ID | Flow | Expect |
|---|---|---|
| WRK-01-H | Source picker lists every Traffic Source/Client; choose one | UI |
| WRK-02-H | **Constant** pattern, base 100 rps, 10 s | A: ~1000 requests arrived |
| WRK-03-H | **Poisson** | A: mean rate ~ base; I: seeded repeat identical |
| WRK-04-H | **Bursty** (burst rps/ms, normal ms) | A: average = time-weighted mix |
| WRK-05-H | **Diurnal** | G |
| WRK-06-H | **Spike** (spike at ms, spike rps, duration) | A: arrivals in spike window ~ spike rps x duration |
| WRK-07-H | **Sawtooth** (peak rps, ramp ms) | A: average = peak/2 over a ramp |
| WRK-08-H | **Replay** | G |
| WRK-09-H | Duration and warmup: warmup requests excluded from metrics | A: measured window = duration - warmup |
| WRK-10-H | Stop conditions: duration, max requests, early abort on saturation (utilization threshold) | A: stops at N requests; stops when node reaches threshold |
| WRK-11-H | Same seed = identical results; different seed = different latencies, same trend | I |
| WRK-12-H | Pause, resume, step one batch, stop, reset; playback speed changes animation speed not results | I: final numbers identical to an uninterrupted run |
| WRK-13-H | Run again after change; Reset returns to setup and clears results | UI |
| WRK-14-H | Run via Web Worker shows progress, then final output | UI |
| WRK-15-M | Short run with no warmup: warmup-adequacy check warns | UI (bottlenecks tab) |
| WRK-16-M | Very high rps (1M) uses fluid/analytic path, labelled as such | A: QuickCart numbers, section 10 |
| WRK-17-M | Change workload mid-pause and resume | UI: documented behaviour |
| WRK-18-U | Run with no source node: Run disabled or blocked with explanation | UI |
| WRK-19-U | Source not connected to anything: blocked or warned | UI |
| WRK-20-U | Rps 0, negative, NaN; duration 0; warmup >= duration: rejected with message | UI |
| WRK-21-U | Stop run mid-flight, then Run again: no leftover state, no duplicate results | UI |
| WRK-22-U | Close tab/refresh during a run: reopening shows no phantom running state | UI |
| WRK-23-U | Worker error (engine throws): user sees an error message, controls recover | UI |

## 6. CHS — Chaos and fault injection

This is the area where the original bug lived. Each flow must show the failure in **all** of: node badge
on canvas, node metrics, Overview error rate, Failures tab, Event log, and Run summary strip.

### 6.1 Node failure modes (Run dialog > fault list: Target, Mode, Fail at, Duration)

Modes: `reject` (instant `node_failed`), `blackhole` (client waits to timeout; default chaos), `hang`
(backlog fills to K, then blackhole), `degraded` (still serves, slower).
In-flight policy `reset|hang`; recovery policy `resume|reset`. Duration 0 = never recovers.

| ID | Flow | Expect |
|---|---|---|
| CHS-01-H | Source > API Server > DB. Fail the API Server with `reject` at 5 s of a 20 s run, no recovery | A: error rate before 5 s ~0, after 5 s = 1.0; failures reason `node_failed`; latency of failures ~ one edge hop |
| CHS-02-H | Same with `blackhole` | A: failed requests wall at client timeout; p99 ~ timeout; node shows Down |
| CHS-03-H | Same with `hang` | A: backlog fills to K then overflow; latency wall at timeout |
| CHS-04-H | `degraded` fraction f, multiplier m | A: service time of affected share x m; error rate unchanged; node shows Degraded not Down |
| CHS-05-H | Fail then recover after 5 s (duration) with recovery `resume` | I: requests held at failure complete after recovery |
| CHS-06-H | Same with recovery `reset` | I: held requests fail as resets |
| CHS-07-H | In-flight policy `reset` vs `hang` at onset | I: reset fails queued work at once; hang keeps it waiting |
| CHS-08-H | Fault shown on canvas: Down/Degraded badge appears at onset time during playback and clears on recovery | UI parity (regression of original bug) |
| CHS-09-H | Node-down is visible in Results: Overview error rate, Node metrics for that node (failures column), Failures tab lists reason, Event log has the `node-failure` and recovery events | UI parity |
| CHS-10-H | Failing a node in the middle of a chain: upstream nodes show errors/timeouts, downstream shows no arrivals after onset | A: downstream arrivals stop; I: conservation holds |
| CHS-11-H | Failure cascade panel names the failed node as root cause and lists affected nodes | UI |
| CHS-12-H | Fail one of N load-balanced servers | A: with N servers, surviving share = 1/(N-1) each; error rate depends on LB health checks (G) |
| CHS-13-H | Fail the same node twice (two faults) and fault on two different nodes | I: both appear in timeline |
| CHS-14-M | `degraded` plus high load pushes the slow node to saturation | A: utilization = arrival rate x (service x m) / workers |
| CHS-15-M | Fault ends before warmup finishes: not counted in measured window; Run summary notes it | UI |
| CHS-16-M | Fault on a node with a retry/circuit-breaker upstream: retries amplify arrivals; breaker opens | G; amplification A: arrivals <= (1 + retries) x base |
| CHS-17-U | Fault target removed from canvas after being configured: fault row flagged invalid, Run blocked or fault ignored with message | UI |
| CHS-18-U | Fail at time beyond run duration: warning that the fault will never fire | UI |
| CHS-19-U | Negative time, empty target, duration negative: rejected | UI |
| CHS-20-U | Fail the only server of the design: error rate 1.0 after onset; Simulation Health not "healthy" | A |
| CHS-21-U | Fail the source node itself: no new arrivals, message explains | UI |
| CHS-22-U | **Down cache**: cache down or faulted must not serve hits | I: hit counter 0 after onset; `cacheDown` fixed behaviour; misses fail (no fallback by default) |
| CHS-23-U | Partly failing cache (error rate e): trait-answered requests also fail at rate e | A: ~e |
| CHS-24-U | Down node with arrival traits (queue ack): refuses at the door, no ack | I |

### 6.2 Cache flush and preset experiments

| ID | Flow | Expect |
|---|---|---|
| CHS-30-H | Cache flush on declared-rate cache for D ms | A: hit ratio 0 for D ms then returns to declared rate; origin load spike |
| CHS-31-H | Derived-LRU cache flush re-warms from traffic | G: hit ratio climbs back |
| CHS-32-H | Preset **Cache stampede** on a topology with a cache and DB | G; assertions steady-state: error rate < 0.01, p99 < 500 ms |
| CHS-33-H | Preset **Database failover** | G |
| CHS-34-H | Preset **Traffic spike** (multiplier x, duration) | A: arrivals in window = multiplier x base |
| CHS-35-H | Preset **AZ outage** on a multi-AZ design | A: all members of the AZ fault; G rest |
| CHS-36-H | Compose several presets with offsets | UI: timeline shows each at its offset |
| CHS-37-H | Experiment timeline lists warmup, baseline, steps, final; each assertion shows pass/fail/no-data/observed with actual value | UI + A |
| CHS-38-M | Preset on a design that survives only barely: some assertions pass, some fail | G |
| CHS-39-M | Assertion with too few samples reports `no-data`, not pass | UI |
| CHS-40-U | Preset needs a part the design lacks (no cache, no DB, no AZ): plain "unavailable" explanation, run refused | UI (`PresetUnavailableError`) |
| CHS-41-U | Steady state fails before any fault: experiment fails at baseline and says so | UI |
| CHS-42-U | Invalid experiment (bad offset, empty steps): refused with reason | UI |

## 7. TRT — Component behaviours (one flow per trait/sample)

Each engine sample topology is loaded in the UI, run with its stored seed, and checked. `H` = baseline
as designed, `M` = stressed to the edge of its limit, `U` = failed or misconfigured. Samples are in
`src/engine/__samples__`.

| ID | Behaviour and sample | H expect | M / U expect |
|---|---|---|---|
| TRT-01 | **Queue / G/G/c/K node**: workers, K, timeout | H: M/D/1 at rho 0.8: utilization 0.80 (observed ~0.808), mean wait ~20 ms (observed 16-19 ms across seeds). M: 1 worker, 10 ms, K=5, 300 rps: node full, observed L = 5, no Little's Law warning (bug fixed). U: K=1 at 150 rps: rejects, no Little's Law warning | A / I |
| TRT-02 | **Conservation** (all flows) | I: arrived = processed + rejected + in flight | I |
| TRT-03 | **Little's Law** check in Bottlenecks | H: consistent node passes. M: overloaded finite buffer shows no false warning. U: genuinely inconsistent data warns | I |
| TRT-04 | **Cache** `basic-cache-stack` | H: hit ratio equals declared rate; origin load = (1 - hit) x arrivals. M: low hit ratio, DB saturates. U: cache down, no hits (CHS-22) | A / G |
| TRT-05 | **Cache stampede request collapsing** (`topology/`) | H: collapse keeps origin load low | G |
| TRT-06 | **Load balancer** `horizontal-compute-scaling-l7`, `proxy-edge` | H: even split, per-server share = rate / N. M: uneven weights, hot server. U: all backends down | A |
| TRT-07 | **Circuit breaker** `circuit-breaker-fail-fast` | H: closed, passes all. M: opens after threshold, sheds load. U: stays open on dead backend, fail-fast latency low | G |
| TRT-08 | **Rate limiter** | H: under limit, no rejects. M: over limit, rejects = rate - limit. U: limit 0 | A |
| TRT-09 | **Retry / backoff** | H: no retries needed. M: retries amplify load. U: retry storm into a dead node | A: arrivals <= (1 + max retries) x base |
| TRT-10 | **Autoscaler** | H: scales out under load. M: slow scale-up, temporary saturation. U: max instances reached | G |
| TRT-11 | **Serverless cold start** `serverless-cold-start` | H: warm path latency. M: cold start adds latency on first requests. U: concurrency cap rejects | G |
| TRT-12 | **Bulkhead** | H: partitions isolate classes. M: one class saturates, others unaffected. U: partition missing | G |
| TRT-13 | **Load shedding** | H/M/U as above | G |
| TRT-14 | **Idempotency dedup** `payment-idempotency-dedup` | H: duplicates detected once. U: dedup store down | G |
| TRT-15 | **Key-based sharding** `key-based-sharding` | H: same key always same shard. M: hot key skews load. U: shard node down | A / G |
| TRT-16 | **DNS weighted routing** `dns-weighted-routing` | H: split follows weights | A |
| TRT-17 | **Endpoint routing / request mix** `endpoint-routing-request-mix` | H: each request type to its target | A |
| TRT-18 | **Message broker fan-out** `message-broker-fanout` | H: every subscriber gets each message. U: subscriber down | A |
| TRT-19 | **Message queue** | H: ack to producer then deliver. M: counters read about 2x arrivals and half service time (documented; to confirm labelling). U: queue down, producer sees no ack | G |
| TRT-20 | **Stream consumer lag** `stream-consumer-lag` | H: 200 produced = 99 committed + 101 lag in the documented probe | A: produced = committed + lag |
| TRT-21 | **Primary / read replica** `primary-read-replica`, `read-consistency-replica` | H: reads served by replica. M: stale read shown. U: primary down | G |
| TRT-22 | **Storage profile** `storage-profile-read-vs-scan` | H: read vs scan service times differ as profiled | G |
| TRT-23 | **Direct client-server** `direct-client-server`, `-clean`, `-jitter` | H: clean = constant latency; jitter = variance but same mean | A |
| TRT-24 | **Traditional single-instance stack** | H: baseline numbers. M: single DB saturates. U: SPOF flagged | G, SPOF badge UI |
| TRT-25 | **Edge connections and batching** | H: batching reduces per-request edge cost | G |
| TRT-26 | **CDC change ordering**, **telemetry fire-and-forget**, **websocket push fan-out** | H: as described in sample | G |
| TRT-27 | **Cluster bin packing** (Kubernetes) | H: pods placed; U: unschedulable pods reported | G |
| TRT-28 | **Consistency / linearizability** | H: linearizable passes; U: violation reported in consistency health | I |
| TRT-29 | **Health-aware routing**, **health prober** | H: unhealthy target removed; U: all unhealthy | G |
| TRT-30 | **Lock/lease**, **reservation store**, **token cost** (LLM), **crypto cost**, **inspection cost** (WAF), **memory pressure**, **coldStart**, **geo latency**, **tiered retrieval**, **windowing**, **log replay**, **fan-out query**, **delivery partner pool**, **change stream**, **consumer group membership** | each: H baseline and one U | G |

TRT-30 expands to one H and one U flow per trait during the build; the full trait list is the 47 files in
`src/engine/traits`.

## 8. RES — Results and analysis

Seven tabs: Overview, Bottlenecks, Node metrics, Event log, Failures, Traces, Traffic.

| ID | Flow | Expect |
|---|---|---|
| RES-01-H | Run finishes: results tray opens on the default results tab | UI |
| RES-02-H | Overview: latency p50/p95/p99, throughput, error rate, timeouts, run context | UI parity: equals engine summary |
| RES-03-H | Run summary strip shows rate, duration, seed, verdict | UI parity |
| RES-04-H | Bottlenecks tab: SLO breaches, Little's Law, conservation, warmup adequacy | I |
| RES-05-H | Node metrics: per node throughput, utilization, queue depth, latency; click focuses node on canvas | UI parity; A utilization |
| RES-06-H | Canvas node metrics (lens) equal Node metrics tab | UI parity |
| RES-07-H | Event log: filter by type, node, time; windowed list scrolls | UI |
| RES-08-H | Failures tab groups by reason and node; counts add up to Overview errors | I: sum(failures) = errors |
| RES-09-H | Traces tab and trace waterfall for a sampled request | UI |
| RES-10-H | Request debugger: path map, lifecycle rail, filmstrip, sequence diagram, state machine | UI |
| RES-11-H | Traffic tab: replay preview | UI |
| RES-12-H | Edit design after run: "results are stale" shown; re-run clears it | UI |
| RES-13-H | Cost chip and cost breakdown match instance price x count (x purchase discount) | A |
| RES-14-H | Design checks chip: anti-patterns and SPOF detected on known-bad sample | UI |
| RES-15-H | Edge latency breakdown view | A: parts sum to edge latency |
| RES-16-H | Location rollups panel | G |
| RES-17-H | Consistency health panel | UI |
| RES-18-M | Overloaded system: Overview shows rising latency, rejects, utilization near/over 1.0; Simulation Health shows warning | A |
| RES-19-M | Partial failure: error rate between 0 and 1 and matches fault share | A |
| RES-20-M | Low sample count: percentiles flagged or "not enough data" | UI |
| RES-21-U | Zero completed requests: results show explicit empty/zero state, no NaN, no division errors | UI |
| RES-22-U | 100% errors: all numbers consistent (throughput 0, error rate 1.0) | A |
| RES-23-U | Open results for a run whose design was deleted: nothing crashes, node links show "removed" | UI |
| RES-24-U | Event log with 1M events: stays responsive | UI |

## 9. IOF and VAL — Files, JSON, validation

| ID | Flow | Expect |
|---|---|---|
| IOF-01-H | Save design to file, reload page, open the file: identical nodes, edges, config | I: round trip equal |
| IOF-02-H | Autosave/flow persistence restores the last design after reload | UI |
| IOF-03-H | Topology JSON viewer shows the design; tree view; copy | UI |
| IOF-04-H | Edit behavioural field in JSON viewer: results marked stale | UI |
| IOF-05-H | Import topology dialog: valid JSON loads; every engine sample imports | UI |
| IOF-06-H | Export topology and results JSON | I: re-import equal |
| IOF-07-H | In-app terminal dock: `help`, run, validate commands work | UI |
| IOF-08-M | Import an older (legacy) canvas: migrated, with a notice | UI |
| IOF-09-M | Import topology with unknown fields: kept or dropped with a note | UI |
| IOF-10-U | Import invalid JSON, wrong schema, empty file, binary file, huge file: clear error, current design untouched | UI |
| IOF-11-U | Open file picker cancelled: nothing changes | UI |
| IOF-12-U | Unsaved changes then open/new: confirm dialog; Cancel keeps work | UI |
| VAL-01-H | Valid design: no issues, Run enabled | UI |
| VAL-02-H | Each validator issue type is reachable and its message is plain language (see `validationCopy`, `issueMessages`) | UI: one flow per issue code |
| VAL-03-M | Warnings (not errors) do not block Run, but show | UI |
| VAL-04-U | Errors block Run and list each with a jump-to-node link | UI |
| VAL-05-U | Disconnected graph, cycle, missing source, missing sink where required, duplicate IDs, unknown node type | UI |
| VAL-06-U | Trait config invalid (see `traitConfigValidation`): field-level message | UI |

## 10. LRN — Learner question mode and grading

Reference question: **QuickCart Flash Sale** (1,000,000 req/s, `m5.xlarge`, 1.28 ms service time, 100,000 req/s
per server unit, 5 s run, pass threshold 1, runtime invariant utilization <= 0.8).

| ID | Flow | Expect |
|---|---|---|
| LRN-01-H | Open question: card shows title, brief, requirements, budget meter | UI |
| LRN-02-H | **13 servers** + LB, one source: submit | A: capacity 1.3M, per-server 76,923 rps, utilization 76.9%, error ~0, throughput ~1M; verdict **Pass**, all checks pass |
| LRN-03-H | 14 servers | A: 71.4%; Pass |
| LRN-04-H | Compact variant: LB to one Server Pool with 13 instances | A: same as LRN-02; Pass |
| LRN-05-M | **12 servers** | A: 1.2M capacity, 83.3% utilization, error ~0, throughput ~1M; **Fail only `within-headroom`** |
| LRN-06-M | **8 servers** | A: 800K capacity, 125% utilization, ~20% error, ~800K throughput; Fail `no-dropped-requests`, `sustain-peak-throughput`, `within-headroom` |
| LRN-07-M | Unequal LB weights with 13 servers | A: busiest server > 80%; Fail `within-headroom` |
| LRN-08-M | Free-response/justification checks (if the question has them) | UI |
| LRN-09-U | Disconnected server icon | Fail connected-graph rule; contributes no capacity |
| LRN-10-U | Two sources / no LB / no microservice / wrong edge direction | Fail the matching structural rule with its message |
| LRN-11-U | Typed raw capacity override (learner) | ignored; capacity still derived |
| LRN-12-U | Lower the workload to dodge the check | grading injects original 1M rps; result unchanged |
| LRN-13-U | Round 12.5 down to 12 | Fail as LRN-05 |
| LRN-14-U | Submit empty canvas | `invalid_submission`, clear message |
| LRN-15-U | Builder policy violations (forbidden type, budget exceeded): listed, submit blocked or flagged | UI |
| LRN-16-H | Budget meter updates as nodes are added; over budget turns warning | A: sum of node costs |
| LRN-17-H | Classroom: brief, lecture panel, results card, concept cards, misconceptions shown for the matching wrong design | UI |
| LRN-18-H | LLM grading tab (dev only): setting persists; grading is mocked in tests | UI |
| LRN-19-H | Embedded iframe question loads and exchanges messages | UI |
| LRN-20-U | LLM grader unavailable/errors: falls back, user told | UI |

## 11. STU — Question Studio, and CLI

### 11.1 Stages

Standard order: **Frame, Brief, Start, Scenarios, Grading, Preview, Export**. Classroom order: **Lesson,
Preview, Export**. Discrimination Lab ("Prove") is hidden; engine kept.

| ID | Flow | Expect |
|---|---|---|
| STU-01-H | Create a new project; stage rail shows all stages with progress | UI |
| STU-02-H | **Frame**: metadata (title, slug, type, entry), lesson frame, dominant lesson | UI; slug stable |
| STU-03-H | **Brief**: prompt details, functional and non-functional requirements, constraints editors | UI |
| STU-04-H | **Start**: learner start (blank canvas / scaffold / given design), scaffold contract, learner palette | UI |
| STU-05-H | **Scenarios**: add scenario, workload, scenario suite, faults editor (authoring faults), chaos experiment case | UI + A |
| STU-06-H | **Grading**: structural rules, metric grading, semantic grading, rubric checks, builder policy, justification | UI |
| STU-07-H | **Preview**: learner experience preview runs the question as a learner would | matches LRN flows |
| STU-08-H | **Export**: readiness panel all green; generated output preview; export bundle downloads | I: bundle passes `sim evaluate` and `validate:question-bank` |
| STU-09-H | Full QuickCart authoring walkthrough end to end | A: preview of 12 fails headroom, 13 passes |
| STU-10-H | Classroom authoring (objective-first): Lesson, Preview, Export; compiler derives scaffold, scenarios, grading | UI + I |
| STU-11-H | Project persistence: reload restores project; import existing project; duplicate | I: round trip equal |
| STU-12-H | Authoring readiness: each missing item links to the stage that fixes it | UI |
| STU-13-H | Authoring coverage and capability checks report what the question can and cannot grade | UI |
| STU-14-H | Question text HTML editing/preview sanitised | UI |
| STU-15-M | Question with warnings only (for example weak discrimination, missing optional hint): export allowed, warnings shown | UI |
| STU-16-M | Metric rule that passes both good and bad designs (cannot discriminate): readiness warns | UI |
| STU-17-M | Change an upstream stage after later stages are done: dependent stages marked needs-review | UI |
| STU-18-U | Export with missing required fields (title, source, rule, pass threshold): blocked with the exact list | UI |
| STU-19-U | Contradictory rules (require and forbid the same type): validator error | UI |
| STU-20-U | Scenario references a node that does not exist; fault on removed node | UI |
| STU-21-U | Import corrupt/old/wrong-version project file: clear error, current project untouched | UI |
| STU-22-U | Grading references a metric that cannot be produced | UI |
| STU-23-U | Unsaved project then navigate away: warning | UI |
| STU-24-U | Required-field indicators appear and clear as fields are filled | UI |

### 11.2 CLI (`sim`)

| ID | Flow | Expect |
|---|---|---|
| CLI-01-H | `sim run <topology>` prints summary, exit 0 | G + exit code |
| CLI-02-H | `sim validate`, `lint`, `cost`, `compare`, `shell`, `evaluate`, `grade` each on a good input | exit 0; outputs equal UI numbers for the same topology and seed (UI/CLI parity) |
| CLI-03-H | `--json` output parses | I |
| CLI-04-M | `lint` on a design with warnings | warnings listed; exit code per `lintExitCode` |
| CLI-05-M | `compare` two designs | diff shows the changed numbers |
| CLI-06-U | Unknown command, missing file, invalid JSON, bad flags | message plus `--help` hint; non-zero exit |
| CLI-07-U | `evaluate` on failing submission | exit code reflects `failed` / `invalid_submission` / `evaluation_error` |

## 12. How the tests will be built

1. **Review this list** (now). Mark flows to cut, add or re-tier.
2. **Write oracles from intent, before running anything.** For each `A` flow, write the formula and inputs. For
   each `G` flow, write the rule (direction, bound or range) and its source (spec section or your decision).
   You review and correct these. Only then do I run the engine and report agreements and mismatches. Oracles
   live in `e2e/oracles/*.json`, one file per area, each value tagged `A`, `I` or `G` with its source.
3. **Playwright** drives the browser for every flow. Each flow reads its oracle, runs `runSimulation` for engine truth,
   then checks the UI shows the same value. Helpers: page objects for Canvas, Library, Properties, RunDialog,
   ResultsTray, Studio.
4. **Tags** `@healthy @moderate @unhealthy @area-chs ...` so `--grep @unhealthy` or `--grep @area-chs` works.
5. **Failure report** names the flow ID, the number expected, the number seen, and where (engine vs UI).
6. **Order of build:** CHS and LRN (the money areas) first, then RES, WRK, TRT, then the rest, then STU and CLI.
7. **Unrelated app bugs the flows uncover** are listed for you and not silently changed.

## 13. Known regression guards (history turned into flows)

| Past bug | Guarded by |
|---|---|
| Node down via chaos injection not shown in UI or results | CHS-01 to CHS-09, CHS-20 |
| Down or faulted cache still served hits | CHS-22, CHS-23, CHS-24, TRT-04 |
| Little's Law falsely warned on a consistent overloaded node; L mis-measured at constant arrival | TRT-01, TRT-03 |
| Edits to behavioural link settings left results looking current | EDG-07, EDG-08, IOF-04, RES-12 |
| "Back to Run Inspector" closed the panel in simple layout | SHL-09 |
| QuickCart 12 vs 13 server pass/fail separation | LRN-02, LRN-05, LRN-06, STU-09 |

## 14. Open questions

- Tool: Playwright (recommended) or Cypress.
- Who writes the expected behaviour for the `G` flows: you directly, or I draft from the specs and you correct. Either way, nothing is taken from engine output.
- Is hosted CI (GitHub Actions) wanted, or local scripts only.
- LLM grading: mock only (recommended), or a live key in a separate manual suite.
- Message queue and stream counters (TRT-19, TRT-20): should the UI say "produced / delivered" instead of arrivals? The test will pin whatever you decide.
