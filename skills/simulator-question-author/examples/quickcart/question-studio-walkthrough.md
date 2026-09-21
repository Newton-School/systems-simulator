# QuickCart Flash Sale — Question Studio Walkthrough

Use this walkthrough to author the **QuickCart Flash Sale** question in Question
Studio. This is the teacher/author workflow: it creates the learner brief, the
blank-canvas contract, the 1,000,000 req/s grading scenario, and the checks that
make **13 × 100,000 req/s servers** the smallest passing design at 80% maximum
utilization.

For the learner-side build and capacity calculation, see
[Builder Walkthrough](builder-walkthrough.md).

## What the finished question teaches

The learner must build:

```text
Traffic Source -> Load Balancer -> backend server pool
```

At peak load:

- offered traffic = **1,000,000 req/s**;
- capacity per server = **100,000 req/s**;
- allowed utilization = **80%**;
- usable capacity per server = 80,000 req/s;
- minimum passing server count = `ceil(1,000,000 / 80,000)` = **13**.

Twelve servers can carry the traffic, but each reaches 83.3% utilization and
fails the headroom rule. Eight servers overload and drop traffic. Thirteen
servers carry about 76,923 req/s each (76.9%) and pass.

## Before you start

1. Open the app's Question Studio surface. For the web app, append
   `/question-studio` to the app URL; `?studio=question` also works.
2. Click **New** in the header.
3. Work through the seven stages in the left rail: **Frame**, **Brief**,
   **Start**, **Scenarios**, **Grading**, **Preview**, and **Export**.
4. Click **Save draft** regularly. Confirm that the saved project's filename uses
   the `quickcart-flash-sale` title-derived ID.

> Do not begin from a legacy question-package fixture. Older packages may contain
> an ID that does not match the title-derived slug or topology rubric metrics that
> the current visual selector does not expose. The steps below use supported Studio
> controls.

---

## Stage 1 — Frame

### Question identity

Enter:

| Field                 | Value                              |
| --------------------- | ---------------------------------- |
| Question title        | `QuickCart Flash Sale`             |
| Generated question ID | `quickcart-flash-sale` (automatic) |

The title is deliberately **QuickCart Flash Sale** so the generated ID remains
the stable package ID used by the existing example.

### Runtime question setup

| Field                              | Value                                                       |
| ---------------------------------- | ----------------------------------------------------------- |
| Question type                      | **Scaling**                                                 |
| Difficulty                         | **Beginner**                                                |
| Learner entry                      | **Blank canvas**                                            |
| Workload category                  | **Read heavy**                                              |
| Estimated time                     | `10` min                                                    |
| Pass threshold                     | `1`                                                         |
| Teaching domains                   | **Compute**                                                 |
| Concepts taught                    | `horizontal-scaling`, `capacity-headroom`, `load-balancing` |
| Grade a budget                     | Off                                                         |
| Let learners see grading scenarios | Off                                                         |

`Pass threshold = 1` means every scored runtime check must pass.

### Catalogue metadata

| Field             | Value                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short description | `Scale a stateless request tier behind a load balancer to carry a 1,000,000 req/s flash sale while keeping every server within an 80% capacity headroom budget.` |
| Author            | Your name or team                                                                                                                                                |
| Created date      | Today's date                                                                                                                                                     |
| Tags              | `scaling`, `load-balancing`, `capacity-planning`, `headroom`                                                                                                     |

Click **Continue to Brief**.

---

## Stage 2 — Brief

### Problem statement

Paste this into **Problem statement**:

```text
You are the backend architect for an e-commerce website called QuickCart.

QuickCart is running a major flash sale. During the sale, the website is expected to receive up to 1,000,000 requests per second.

Each backend server can handle a maximum of 100,000 requests per second. To keep the servers stable, use no more than 80% of each server's capacity.

The load balancer distributes incoming requests evenly across every backend server you add.

Build the backend architecture for QuickCart from the available components.
```

Keep the capacity and 80% limit in the prompt. The scenario supplies the offered
traffic, while the learner configures the server capacity in their design.

### Functional requirements

Click **Add requirement** three times and enter, in this order:

1. `Accept incoming user traffic through a load balancer.`
2. `Distribute traffic evenly across a pool of backend servers.`
3. `Serve the full offered load without dropping requests.`

### Non-functional requirements

Add two requirements:

| Metric     | Operator |     Value | Unit              |
| ---------- | -------- | --------: | ----------------- |
| Throughput | `>=`     | `1000000` | requests / second |
| Error rate | `<`      |       `1` | percent           |

These cards communicate the targets to the learner. Runtime enforcement is added
separately in the **Grading** stage.

### Scale and additional context

| Field        |           Value |
| ------------ | --------------: |
| Peak traffic | `1000000` req/s |
| Read share   |          `100`% |

Leave the other scale fields blank. Additional learner context is optional; the
problem statement already contains the capacity assumptions.

Click **Continue to Start**.

---

## Stage 3 — Start

This is a blank-canvas question.

1. Leave **Scaffold canvas** as **Blank**. Do not click **Create starting
   topology**.
2. Under **Learner constraints**, select only these **Allowed component types**:
   - **Client App** (`api-endpoint`) — used as the traffic source;
   - **Load Balancer** (`load-balancer`);
   - **API Server** (`microservice`).

3. Leave **Forbidden component types**, **Maximum nodes**, **Maximum total
   workers**, and **Maximum runtime cost** empty.
4. The two scaffold-edit checkboxes do not affect an empty scaffold; their
   defaults may remain unchanged.

Do not set a maximum node count. The canonical answer uses 15 visible nodes
(one source, one load balancer, and 13 servers), while an equivalent learner
design may model the backend fleet with one server node and 13 instances.

Click **Continue to Scenarios**.

---

## Stage 4 — Scenarios

Click **Add baseline**, then configure the baseline card:

| Field                    | Value                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| What this scenario tests | `Sustain the 1,000,000 req/s flash-sale peak within the 80% server headroom budget.` |
| Fixed seed               | `quickcart-flash-sale-v1`                                                            |
| Traffic pattern          | **Constant**                                                                         |
| Run duration             | `5` sec                                                                              |
| Warmup                   | `0` sec                                                                              |
| Base traffic             | `1000000` req/s                                                                      |
| Read traffic             | `100`%                                                                               |
| Request size             | `100` bytes                                                                          |

Five seconds is enough because this workload runs through the analytic engine at
flash-sale scale. The result is calculated from rates rather than by creating
five million individual request events.

Leave the contended keyspace, traffic origins, faults, and advanced stop
conditions empty. Also leave **Source node ID** blank so the evaluator resolves
the source from each learner's topology rather than depending on an author-chosen
node ID.

### Add the 80% invariant

Under **Scenario invariants**, click **Add invariant** and enter:

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| ID          | `headroom-80`                                               |
| Description | `No server may exceed 80% of its capacity during the sale.` |
| Condition   | `perNode.maxUtilization <= 0.8`                             |

### Learner-visible dry run

Select **baseline** as the learner-visible dry run. The learner can then test the
same representative peak before submitting, while **Let learners see grading
scenarios** remains off.

The card footer should say **Normalized runtime case**. If it says **Scenario
incomplete**, fix the highlighted value before continuing.

Click **Continue to Grading**.

---

## Stage 5 — Grading

Question Studio separates topology shape, human-unit metric checks, and raw
verdict metrics. Use all three here.

### Structural grading

Add these structural tests:

|   # | Rule                               | Configuration                                                                                         |
| --: | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
|   1 | Require exactly one traffic source | No additional fields                                                                                  |
|   2 | Require a component                | Component = **Load Balancer** (`load-balancer`), Minimum = `1`                                        |
|   3 | Require a component                | Component = **API Server** (`microservice`), Minimum = `1`                                            |
|   4 | Require a direct connection        | From = **Client App** (`api-endpoint`), To = **Load Balancer** (`load-balancer`), Edge = **Any edge** |
|   5 | Require a direct connection        | From = **Load Balancer** (`load-balancer`), To = **API Server** (`microservice`), Edge = **Any edge** |
|   6 | Require a connected design         | No additional fields                                                                                  |

The legacy QuickCart fixture represented the first three as topology rubric
metrics. In the current Studio they belong here as structural rules. The edge and
connected-design rules close the loophole where a learner places the right icons
without routing traffic through them.

### Semantic grading

Leave this section empty. QuickCart is testing topology and capacity behavior,
not a component-property or placement-specific semantic contract.

### Runtime metric grading

Click **Add metric test** and set:

| Metric     | Comparison        | Value |
| ---------- | ----------------- | ----: |
| Error rate | **must be below** |  `1`% |

The Studio compiles this human-unit rule to
`summary.errorRate < 0.01`.

### Verdict-metric grading

Add these two verdict checks:

| Metric                                                     | Comparison |     Value | Points |
| ---------------------------------------------------------- | ---------- | --------: | -----: |
| `Summary throughput` (`summary.throughput`)                | `>=`       | `1000000` |    `1` |
| `Invariant violations count` (`invariantViolations.count`) | `==`       |       `0` |    `2` |

The throughput check proves the full offered load is served. The invariant check
makes the scenario's 80% rule gradeable, with extra weight because it is the
lesson's main capacity-planning decision.

### Justification prompts

Leave this section empty for the beginner version. A harder variant can ask the
learner to explain why capacity planning rounds 12.5 servers up to 13.

Click **Continue to Preview**.

---

## Stage 6 — Preview

Verify the learner view shows:

- the title **QuickCart Flash Sale**;
- a blank-canvas entry;
- only Client App, Load Balancer, and API Server as allowed component types;
- peak traffic of 1,000,000 req/s;
- the three functional requirements and two NFRs;
- the baseline dry-run option.

The expected learner topology is:

```text
Client App -> Load Balancer -> 13 × API Server
```

Each API Server must expose 100,000 req/s capacity. Equal load-balancer routing
gives 76,923 req/s per server, or 76.9% utilization.

Click **Continue to Export**.

---

## Stage 7 — Export

The Export stage must show **Generated output is current**. Review all three
tabs:

1. **Question package** — confirm the ID is `quickcart-flash-sale`, the suite
   contains a 1,000,000 req/s constant workload, and the invariant condition is
   `perNode.maxUtilization <= 0.8`.
2. **Newton rows** — confirm structural rules and rubric rows were generated.
3. **Django handoff** — confirm the assignment fields and ordered rows are
   present.

Then:

1. Click **Save draft** to keep the editable Question Studio project.
2. Click **Download Django bundle** to generate the deployable handoff artifact.

If export is disabled, use the diagnostic link in the Export stage to return to
the incomplete field.

---

## Acceptance check

Use these designs to confirm the question discriminates correctly:

| Candidate             |  Per-server load | Maximum utilization | Expected result                    |
| --------------------- | ---------------: | ------------------: | ---------------------------------- |
| 8 × 100K servers      |    125,000 req/s |                125% | Fail throughput/error and headroom |
| 12 × 100K servers     |     83,333 req/s |               83.3% | Fail headroom                      |
| **13 × 100K servers** | **76,923 req/s** |           **76.9%** | **Pass all checks**                |
| 14 × 100K servers     |     71,429 req/s |               71.4% | Pass with extra capacity           |

Also try these anti-gaming cases:

- correct components but no edges — structural connection checks must fail;
- two traffic sources — the single-source rule must fail;
- a disconnected extra server — connected-design grading must fail;
- 13 servers with uneven load-balancer weights — the busiest server should fail
  the 80% invariant if its utilization crosses the limit.

## Troubleshooting

- **The generated ID is wrong:** return to Frame and use the exact title
  `QuickCart Flash Sale`.
- **The export says a scenario is missing:** confirm every required scenario
  number is filled and warmup is shorter than duration.
- **The headroom check never fails:** confirm the scenario contains the invariant
  and Grading contains `invariantViolations.count == 0`.
- **An eight-server design passes:** confirm Base traffic is `1000000`, the server
  capacity is 100,000 req/s in the learner design, and the throughput/error checks
  are present.
- **A twelve-server design passes:** confirm the invariant uses `0.8`, not `80`.
- **The learner cannot build the answer:** confirm all three component types are
  selected under Allowed component types and no maximum-node limit was set.
