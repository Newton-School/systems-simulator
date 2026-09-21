# QuickCart Flash Sale — Builder Walkthrough (horizontal scaling + 80% headroom)

A step-by-step runbook for building the backend for a **1,000,000 req/s flash sale**
in the simulator. The whole lesson is capacity planning: how many stateless servers
do you put behind the load balancer so every server stays within an **80% capacity
headroom** budget? Ends in a fully honest model where the run is **computed
analytically** (you cannot draw a million dots) and the canvas animation is labelled
as representative.

> This is the interactive-builder walkthrough. To recreate the same scenario with
> the visual authoring flow, use the
> [Question Studio walkthrough](question-studio-walkthrough.md).

## The problem

> **Design the backend for a flash sale (QuickCart).** During the sale the site
> receives **up to 1,000,000 requests per second**. Each backend server handles a
> maximum of **100,000 req/s**, and to stay stable you must use **at most 80% of a
> server's capacity**. The load balancer is already configured and distributes
> requests evenly across every server you add.
>
> **Components available:** Users · Load Balancer · Servers.
>
> **The one calculation**
>
> - Usable capacity per server = 80% × 100,000 = **80,000 req/s**.
> - Servers needed = 1,000,000 ÷ 80,000 = 12.5 → **round up to 13**.
> - 12 servers → each carries 83,333 req/s = **83.3%** (over budget).
> - 13 servers → each carries 76,923 req/s = **76.9%** (within budget). ✅

## Final topology

```
Users (Traffic Source)  →  Load Balancer  →  13 × Server   (each ≤ 80% of 100K req/s)
```

- The load balancer splits 1,000,000 req/s evenly: 1,000,000 ÷ 13 ≈ 76,923 req/s each.
- Every server sits at 76.9% utilization — inside the 80% headroom budget, nothing dropped.

---

## Part 1 — Place the nodes

Drag onto the canvas from the library:

- **Traffic Source** (Templates) — this is _Users_.
- **Load Balancer** (Network) — a plain L4 balancer is fine here; even split is all we need.
- **Server** ×13 (Compute → **microservice**, or the Service Builder "Long-running service").
  Start with a few and add more once you see the utilization.

## Part 2 — Configure the Users traffic source

1. Select **Traffic Source** → **CONFIG** → **Workload**.
2. **Pattern** = `Constant`, **Base RPS** = `1000000` (one million).
3. Request mix can stay a single `GET` at 100% — this scenario is about volume, not routing.

## Part 3 — Set each server's capacity (100,000 req/s)

Each server must saturate at 100,000 req/s. Two ways:

- **Simplest (matches the question wording):** give the server a **capacity of
  `100000` req/s** directly. In the authored question this is the `capacityRps`
  field; in the builder it is the server's throughput ceiling.
- **Derived (more realistic):** use the **Service Builder → Workload profile →
  Service time** plus **Capacity → instances**, chosen so `concurrency ÷ service
time = 100,000 req/s`. The engine derives the same ceiling either way.

Give **every** server the same 100,000 req/s ceiling so the even split is fair.

## Part 4 — Wire the edges

```
Users          → Load Balancer
Load Balancer  → Server 1
Load Balancer  → Server 2
…
Load Balancer  → Server 13
```

One edge from the load balancer to **each** server. Equal (default) edge weights =
even split, which is exactly what "the load balancer distributes evenly" means.

## Part 5 — Run

Click **Run**. Because 1,000,000 req/s over any real window is tens of millions of
requests, the simulator does **not** try to emit them one by one — it flips to the
**analytic (fluid) engine** and computes the steady state. You will see:

- an amber **"1 dot ≈ N req/s"** badge on the canvas — the animation is
  representative, each dot standing for many thousands of requests;
- per-server utilization and the headroom verdict, computed exactly.

### Expected result (what "correct" looks like)

| Servers | Per-server load  | Utilization | Verdict                                              |
| ------- | ---------------- | ----------- | ---------------------------------------------------- |
| 8       | 125,000 req/s    | 125%        | **Fail** — over capacity, ~200K req/s dropped        |
| 12      | 83,333 req/s     | 83.3%       | **No headroom** — stable but over the 80% budget     |
| **13**  | **76,923 req/s** | **76.9%**   | **Pass** — within the 80% headroom budget, 0 dropped |
| 14      | 71,429 req/s     | 71.4%       | Pass (extra safety margin, higher cost)              |

The tell-tale of a correct build: **max server utilization ≤ 80% and zero dropped
requests** at the full 1,000,000 req/s.

---

## Instance sizing — the trade space

The "100,000 req/s server" isn't magic — it's a specific instance choice. Capacity is
**derived**, not typed: `capacity = concurrency ÷ service time`, and for an **IO-bound**
tier `concurrency = vCPU × 32 × instanceCount`. Fixing a realistic **~1.3 ms** service
time (a cache-backed read) makes capacity land at a clean **≈ vCPU × 25,000 req/s**.

### Per-instance capacity (IO-bound, ~1.3 ms service time)

| Instance                | vCPU | Workers (×32) | Capacity / box | 80% usable |
| ----------------------- | ---- | ------------- | -------------- | ---------- |
| t3.medium _(burstable)_ | 2    | 64            | ~50,000        | 40,000     |
| m5.large                | 2    | 64            | ~50,000        | 40,000     |
| **m5.xlarge**           | 4    | 128           | **~100,000**   | **80,000** |
| m5.2xlarge              | 8    | 256           | ~200,000       | 160,000    |

`m5.xlarge` is the instance that reproduces the question's "100,000 req/s server". A
2-vCPU box only gets you to ~50k; an 8-vCPU box doubles it to ~200k. (`c5` is ~30%
faster per core, `t3` is burstable and **not** appropriate for sustained flash-sale
load — it throttles once credits run out.)

### Fleet needed for 1,000,000 req/s at ≤ 80%

`servers = ⌈ 1,000,000 ÷ (80% × capacity) ⌉`

| Instance               | 80% usable/box | Servers needed | Fleet capacity | Max util  | ≈ $/hr              |
| ---------------------- | -------------- | -------------- | -------------- | --------- | ------------------- |
| m5.large (2 vCPU)      | 40,000         | **25**         | 1.25M          | 80.0%     | 25 × $0.096 ≈ $2.40 |
| **m5.xlarge (4 vCPU)** | 80,000         | **13**         | 1.30M          | **76.9%** | 13 × $0.192 ≈ $2.50 |
| m5.2xlarge (8 vCPU)    | 160,000        | **7**          | 1.40M          | 71.4%     | 7 × $0.384 ≈ $2.69  |

Two lessons fall out of this table:

- **Bigger boxes ⇒ fewer servers, ~the same cost.** You pay roughly per vCPU, so 25
  small / 13 medium / 7 large all land near ~$2.5/hr. Instance _size_ is not where you
  save money here.
- **The real trade is blast radius, not price.** 7 large boxes means losing one drops
  ~14% of capacity; 25 small boxes means one failure is ~4%. Fewer, bigger servers is a
  worse HA story for the same spend — which is why a horizontally-scaled fleet of
  mid-size boxes (the 13 × m5.xlarge row) is the sweet spot for a flash sale.

### Modelling instance count on the canvas

`instanceCount` multiplies a single node's capacity, so you have two equivalent builds:

| Approach          | Nodes       | Per-node config                             |
| ----------------- | ----------- | ------------------------------------------- |
| Discrete servers  | 13 × Server | m5.xlarge · IO-bound · **instanceCount 1**  |
| Autoscaling group | 1 × Server  | m5.xlarge · IO-bound · **instanceCount 13** |

Same capacity math, same 76.9% utilization — pick whichever reads better on the canvas.

---

## Choosing how the run stops (Workload panel → Stop condition)

Open the **Workload** panel (click **Run**) and scroll to **STOP CONDITION**:

- **Stop when → "Duration elapses"** (default): the sale runs for the configured
  duration at the offered rate.
- **Stop when → "Request budget reached"**: a **Max requests** field appears. The run
  generates _exactly_ that many requests and then drains — this is how you model
  "the sale is N requests" rather than "N req/s for X seconds". The duration is
  ignored in this mode.
- **"Halt early if a node is saturated (≥100%)"**: an optional guard usable with
  either mode. If any server hits 100% with a growing queue, the run stops the moment
  the design breaks instead of grinding out the rest of the window — the results
  report `stopReason: 'saturation'` and _when_ it broke.

> The control is disabled until there is a traffic source on the canvas.

---

## Why it's built this way (gotchas we hit)

- **You can't draw a million dots — and you don't need to.** At this scale the run is
  computed with the analytic/fluid model: traffic is treated as a _rate_,
  each node's utilization is `offered ÷ capacity`, and the answer is exact and
  instant. The canvas dots are cosmetic and labelled "1 dot ≈ N req/s"; never read a
  metric off the dot count — the real numbers are in the results.
- **The 80% rule is a headroom budget, not a hard limit.** A server at 83% is still
  _stable_ (it isn't dropping), but it has no burst headroom — which is why 12 servers
  grades as "no headroom" rather than a hard fail, and 8 servers (over 100%) is a true
  fail that drops requests.
- **Round up, always.** 12.5 servers is not an option; 12 is over budget, so the
  answer is 13. Capacity planning rounds up.
- **Even split depends on equal edge weights.** If you give the load-balancer→server
  edges different weights, the busiest server exceeds 76.9% and can breach 80% even
  with 13 servers. Keep the weights equal for a plain even split.
- **Utilization is scale-invariant.** Whether you run 1,000,000 req/s or a scaled-down
  1,000 req/s against proportionally smaller servers, the utilization percentage is
  identical — which is why the analytic answer at flash-sale scale is trustworthy.

## Simpler / harder variants

- **Smaller sale, real simulation:** drop Base RPS to e.g. 10,000 and set a
  **request budget** of 100,000. That's small enough that the simulator runs the
  _discrete_ per-request engine (real retries, queue jitter) instead of the analytic
  one — useful for seeing individual request behaviour.
- **Headroom sweep:** change the target from 80% and watch the required server count
  move — 70% needs 15 servers, 90% needs 12.
- **Break it on purpose:** enable **Halt on saturation**, set 8 servers, and watch the
  run abort early with a saturation verdict.

---

## How it grades (authored question)

The authored question (`quickcart-flash-sale.question.json`) checks:

| Check               | Kind       | Rule                                         |
| ------------------- | ---------- | -------------------------------------------- |
| One traffic source  | topology   | `topology.sourceCount == 1`                  |
| Has a load balancer | topology   | `topology.componentCounts.load-balancer ≥ 1` |
| Has a server pool   | topology   | `topology.componentCounts.microservice ≥ 1`  |
| Serves peak load    | simulation | `summary.errorRate < 1%` (nothing dropped)   |
| Within 80% headroom | invariant  | `perNode.maxUtilization ≤ 0.8`               |

The headroom rule is injected as an **invariant** on the grading case
(`perNode.maxUtilization <= 0.8`), so a submission with 12 servers trips it and 13
passes — the same arithmetic this walkthrough is built around.
