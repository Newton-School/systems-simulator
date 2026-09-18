# Django Admin Setup: Design the Backend for a Flash Sale

This authoring shape is for Newton assignment mode only.
Use it when the simulator is embedded through the generic GAME iframe with `?host=newton`.
Do not use this shape for standalone/local authoring at `https://systems-simulator.newtonschool.co/`; standalone/local must keep topology open/save available.

Justification prompts are currently hidden in the Newton assignment UI and are not graded, so do not include `justify` in the test-case rows for this flow.

> Source of truth: `src/engine/analysis/fixtures/quickcart-flash-sale.question.json`. The rows below are that package re-expressed as Django admin rows.

## Frontend contract

- GAME iframe URL: `https://systems-simulator.newtonschool.co/?host=newton`
- Newton-hosted assignment mode must render `question_text` as raw Django HTML.
- The frontend translator must rebuild immutable simulator config from the test-case rows below, not from `initial_game_state`.
- `initial_game_state` stays mutable-only learner state. Do not paste the full `question.json` there.
- Newton-hosted assignment mode must hide topology `Open` / `Save` actions and disable `Ctrl/Cmd+O` and `Ctrl/Cmd+S`.
- Newton-hosted assignment mode must hide the header settings entry point.
- The authored assignment environment should stay explicit in `SIMULATOR_CONFIG`.
- This is a **blank-canvas** build: there are no scaffold nodes. The learner drags Users, a Load Balancer, and Servers from the palette.
- Edges stay in `connector` mode, so there is no edge properties panel. The load balancer splits traffic **evenly** across every server edge — no per-edge weighting is needed or allowed.
- **DEVIATION from the standard assignment posture — node resource editing is UNLOCKED here** (`canEditResources: true`). Sizing the server fleet (instance type, IO-bound vs CPU-bound, instance count) is the graded skill: capacity is derived from those choices, so the learner must be able to set them. The per-node **throughput-capacity readout is read-only** — capacity is a consequence of the instance, never typed directly.
- Execution-profile editing stays locked.
- Grading depends on topology and node **sizing** choices, not on edge-property tuning.
- Domain overlays still apply when a lesson needs them.
- `network` domains upgrade edges to `network` and unlock edge editing.
- `cost` domains unlock resource editing.

## Django fields

- `question_type`: `GAME`
- `question_title`: `Design the Backend for a Flash Sale`
- `question_text`:

```html
<p>You are the backend architect for an e-commerce website called <strong>QuickCart</strong>. You are designing the system architecture — placing, connecting, and sizing infrastructure components, not writing application code.</p>
<p>QuickCart is running a major flash sale. During the sale, the website is expected to receive up to <strong>1,000,000 requests per second</strong>.</p>
<p>Each backend server can handle a maximum of <strong>100,000 requests per second</strong>. To keep the servers stable, you should use a maximum of <strong>80% of their capacity</strong>.</p>
<p>The Load Balancer distributes incoming requests evenly across all the servers you add. Drag and drop the required components — Users, a Load Balancer, and Servers — and size the server fleet so every server stays within its 80% budget while carrying the full load.</p>
<h3>Functional Requirements</h3>
<ul>
  <li>Accept incoming user traffic at the load balancer.</li>
  <li>Distribute traffic evenly across a pool of backend servers.</li>
  <li>Serve the full offered load without dropping requests.</li>
</ul>
<h3>Non-Functional Targets</h3>
<ul>
  <li>Serve the full 1,000,000 req/s offered load with no dropped requests.</li>
  <li>Every server stays at or below 80% of its capacity (headroom budget).</li>
</ul>
<h3>Scale</h3>
<ul>
  <li><strong>Peak RPS:</strong> 1,000,000</li>
  <li><strong>Per-server capacity:</strong> 100,000 req/s</li>
  <li><strong>Headroom budget:</strong> 80% max utilization → usable 80,000 req/s per server → <strong>13 servers</strong> minimum.</li>
</ul>
```

- `initial_game_state`:

```json
{}
```

- `initial_game_state` must stay mutable-only. Do not paste the full `question.json` here.

## Test-case mapping rules

- Create the rows in the exact order shown below.
- For every row: `hidden = false`, `output = ""`, `output_file = empty`.
- Paste each JSON block into the Django `input` field exactly as shown.
- This question uses connector edges. Do not author grading expectations that depend on edge latency, bandwidth, or per-edge concurrency tuning.
- The 80% headroom rule is carried as a per-case **invariant** inside `SIMULATOR_CONFIG` (Row 1) and asserted by the `within-headroom` rubric check (Row 7). At 1,000,000 req/s the run is evaluated by the analytic engine, so `summary.errorRate` and `perNode.maxUtilization` are exact steady-state values.

## Row 1

- `title`: `SIMULATOR_CONFIG: quickcart-flash-sale`
- `input`:

```json
{
  "type": "SIMULATOR_CONFIG",
  "questionId": "quickcart-flash-sale",
  "domains": [
    "compute"
  ],
  "concepts": [
    "horizontal-scaling",
    "capacity-headroom",
    "load-balancing"
  ],
  "workloadCategory": "read-heavy",
  "constraints": {
    "allowedNodeTypes": [
      "api-endpoint",
      "load-balancer",
      "microservice"
    ]
  },
  "suite": {
    "cases": [
      {
        "description": "1,000,000 req/s peak with the 80% headroom rule enforced",
        "workload": {
          "baseRps": 1000000,
          "requestDistribution": [
            {
              "type": "GET",
              "weight": 1,
              "sizeBytes": 100
            }
          ]
        },
        "invariants": [
          {
            "id": "headroom-80",
            "description": "No server may exceed 80% of its capacity during the sale.",
            "condition": "perNode.maxUtilization <= 0.8"
          }
        ]
      }
    ]
  },
  "rubric": {
    "id": "quickcart-flash-sale",
    "passThreshold": 1
  },
  "environmentProfile": {
    "mode": "ASSIGNMENT",
    "visibility": {
      "prompt": true,
      "scaffoldSourceNodes": true,
      "gradingSuiteDetails": false,
      "liveMetrics": true,
      "rubricChecks": "LIVE_DURING_BUILD"
    },
    "capabilities": {
      "editPaletteList": null,
      "canEditScaffoldNodes": false,
      "canTriggerTestRuns": true,
      "edgeModel": "connector",
      "canEditEdges": false,
      "canEditResources": true,
      "canEditExecutionProfile": false
    },
    "graded": true,
    "chromeDensity": "minimal"
  }
}
```

## Row 2

- `title`: `STRUCTURAL_RULE: requires-load-balancer`
- `input`:

```json
{
  "type": "STRUCTURAL_RULE",
  "id": "requires-load-balancer",
  "kind": "requires_component",
  "description": "The design must include a load balancer.",
  "componentType": "load-balancer",
  "minCount": 1
}
```

## Row 3

- `title`: `RUBRIC_CHECK: single-source`
- `input`:

```json
{
  "type": "RUBRIC_CHECK",
  "id": "single-source",
  "kind": "topology",
  "description": "Exactly one traffic source (Users)",
  "metric": "topology.sourceCount",
  "op": "==",
  "value": 1,
  "points": 1
}
```

## Row 4

- `title`: `RUBRIC_CHECK: has-load-balancer`
- `input`:

```json
{
  "type": "RUBRIC_CHECK",
  "id": "has-load-balancer",
  "kind": "topology",
  "description": "Includes a load balancer",
  "metric": "topology.componentCounts.load-balancer",
  "op": ">=",
  "value": 1,
  "points": 1
}
```

## Row 5

- `title`: `RUBRIC_CHECK: has-servers`
- `input`:

```json
{
  "type": "RUBRIC_CHECK",
  "id": "has-servers",
  "kind": "topology",
  "description": "Includes a pool of backend servers",
  "metric": "topology.componentCounts.microservice",
  "op": ">=",
  "value": 1,
  "points": 1
}
```

## Row 6

- `title`: `RUBRIC_CHECK: no-dropped-requests`
- `input`:

```json
{
  "type": "RUBRIC_CHECK",
  "id": "no-dropped-requests",
  "kind": "simulation",
  "description": "Serves peak load without dropping requests",
  "metric": "summary.errorRate",
  "op": "<",
  "value": 0.01,
  "points": 1
}
```

## Row 7

- `title`: `RUBRIC_CHECK: within-headroom`
- `input`:

```json
{
  "type": "RUBRIC_CHECK",
  "id": "within-headroom",
  "kind": "invariant",
  "description": "Every server stays within the 80% capacity headroom budget",
  "metric": "invariantViolations.count",
  "op": "==",
  "value": 0,
  "points": 2
}
```

## Grading summary

| # | Check | Kind | Rule | Points |
|---|---|---|---|---|
| 3 | single-source | topology | `topology.sourceCount == 1` | 1 |
| 4 | has-load-balancer | topology | `topology.componentCounts.load-balancer >= 1` | 1 |
| 5 | has-servers | topology | `topology.componentCounts.microservice >= 1` | 1 |
| 6 | no-dropped-requests | simulation | `summary.errorRate < 0.01` | 1 |
| 7 | within-headroom | invariant | `invariantViolations.count == 0` (headroom-80) | 2 |

Total 6 points; `passThreshold` is a fraction (`1` = all points required). A 13-server fleet at 100k req/s each lands every server at 76.9% and passes all checks; 12 servers trips `within-headroom` (83.3% > 80%); fewer than 10 servers also trips `no-dropped-requests`.
