# JSON Artifact Schemas

This reference defines the **three openable JSON files** the skill emits for one
question. All three describe the _same_ question and must agree (see
[the consistency contract](#4-cross-file-consistency-contract)). Field shapes were
verified against the simulator on **2026-09-22**.

Emit these exact filenames from one title-derived slug `<slug>`:

| #   | File                                     | Opens in                              | Purpose                                                                   |
| --- | ---------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `<slug>.simulator-question-project.json` | **Question Studio** (Open project)    | The editable authoring project. Same name Question Studio writes on Save. |
| 2   | `<slug>.question-package.json`           | **Simulator** (Open question package) | The compiled, gradeable question a learner attempts.                      |
| 3   | `<slug>.solution-topology.json`          | **Simulator** (Open design/topology)  | A reference solution canvas that passes every check.                      |

`<slug>` is derived from the question title (QuickCart is only the worked example).
The filename suffix is what identifies each file to a human; the simulator itself
recognises the type by content — the `artifact` field for #1, `version`/`suite`/
`rubric` for #2, and `version: "2.0.0"` + `nodes` for #3 — so older files still
open regardless of suffix.

Worked, guaranteed-valid instances of all three live in
[`examples/quickcart/`](../examples/quickcart/). When unsure about a field, copy
its shape from there rather than inventing one.

---

## 1. Question Studio project — `*.simulator-question-project.json`

The authoring document. It is a thin envelope around a `question` object; opening
it in Question Studio restores every editor stage.

```jsonc
{
  "artifact": "dsds-question-project", // REQUIRED literal — the open handler keys on this
  "artifactVersion": "1.0", // REQUIRED literal
  "projectId": "<uuid>", // any stable unique id
  "updatedAt": "<ISO-8601>", // e.g. "2026-09-22T00:00:00.000Z"
  "question": {
    "id": "<slug>",
    "title": "<Title>",
    "description": "<one-paragraph summary>",
    "tags": [],
    "author": "<author>",
    "createdAt": "<ISO-8601>",
    "setup": {
      "difficulty": "beginner | intermediate | advanced",
      "type": "scaling | ...",
      "entryFormat": "blank-canvas | scaffold",
      "domains": ["compute"],
      "concepts": ["horizontal-scaling", "capacity-headroom", "load-balancing"],
      "workloadCategory": "read-heavy | write-heavy | mixed",
      "estimatedTimeMinutes": 10,
      "passThreshold": 0.81, // MUST equal question.json rubric.passThreshold
      "suiteVisibleToStudent": true,
      "constraints": {
        "allowedNodeTypes": ["microservice", "api-endpoint", "load-balancer-l7"],
        "canModifyScaffold": true,
        "canRemoveScaffoldNodes": true
      }
    },
    "prompt": {
      "text": "<learner prompt, \\n for line breaks>",
      "scale": { "peakRps": 1000000, "readWriteRatio": 100 },
      "functionalRequirements": [{ "id": "fr-<uuid>", "text": "..." }],
      "nonFunctionalRequirements": [
        {
          "id": "nfr-<uuid>",
          "metric": "throughput",
          "operator": ">=",
          "value": 1000000,
          "unit": "req_per_sec"
        }
      ]
    },
    "dryRunScenarioId": "baseline",
    "justify": [],
    "scenarios": [
      /* see scenario shape below; author-side superset of suite.cases */
    ],
    "structuralRules": [
      /* see §rules */
    ],
    "semanticRules": [],
    "metricRules": [
      {
        "id": "metric-target",
        "description": "Keep errors under 1%...",
        "metric": "error_rate",
        "operator": "<",
        "value": 1,
        "unit": "percent"
      }
    ],
    "rubricChecks": [
      {
        "id": "rubric-check-1",
        "description": "Serve the full flash-sale load...",
        "metric": "summary.throughput",
        "op": ">=",
        "value": 1000000,
        "points": 1
      },
      {
        "id": "rubric-check-2",
        "description": "Stay within the headroom budget...",
        "metric": "invariantViolations.count",
        "op": "==",
        "value": 0,
        "points": 2
      }
    ]
  },
  "assets": { "gamedTopologies": [] },
  "ui": { "activeStage": "export" }
}
```

Scenario shape (project side — human units where noted):

```jsonc
{
  "id": "baseline",
  "description": "...",
  "seed": "<slug>-v1",
  "pattern": "constant | bursty | spike | sawtooth | diurnal",
  "durationSeconds": 5,
  "warmupSeconds": 0,
  "baseRps": 1000000,
  "readPercent": 100,
  "requestSizeBytes": 100,
  "sourceNodeId": "",
  "faults": [],
  "invariants": [
    {
      "id": "invariant-1",
      "description": "No server may exceed 80% of its capacity.",
      "condition": "perNode.maxUtilization <= 0.8"
    }
  ]
}
```

> Note the **project** scenario uses human units (`durationSeconds`, `readPercent`,
> `baseRps`) while the **compiled** `suite.cases` (file #2) use raw engine units
> (`simulationDuration` in ms, `requestDistribution` weights). Keep them equivalent.

---

## 2. Question package — `*.question-package.json`

The compiled, gradeable question. The simulator loads it as the active question a
learner attempts; it carries the workload suite, the structural rules, and the
rubric. This is the runtime source of truth.

```jsonc
{
  "version": "1.0",
  "id": "<slug>",
  "title": "<Title>",
  "description": "...",
  "difficulty": "beginner",
  "estimatedTimeMinutes": 10,
  "type": "scaling",
  "entryFormat": "blank-canvas",
  "prompt": {
    "text": "...",
    "functionalRequirements": ["...", "..."],
    "nonFunctionalRequirements": [
      {
        "metric": "throughput",
        "operator": ">=",
        "value": 1000000,
        "unit": "req_per_sec",
        "description": "..."
      },
      {
        "metric": "error_rate",
        "operator": "<",
        "value": 1,
        "unit": "percent",
        "description": "..."
      }
    ],
    "scale": { "peakRps": 1000000, "readWriteRatio": 100 }
  },
  "scaffold": { "type": "empty" },
  "constraints": {
    "allowedNodeTypes": ["microservice", "api-endpoint", "load-balancer-l7"],
    "canModifyScaffold": true,
    "canRemoveScaffoldNodes": true
  },
  "structuralRules": [
    /* see §rules — these carry a human `description` */
  ],
  "workloadCategory": "read-heavy",
  "domains": ["compute"],
  "concepts": ["horizontal-scaling", "capacity-headroom", "load-balancing"],
  "suite": {
    "name": "<slug>-suite",
    "cases": [
      {
        "id": "baseline",
        "description": "...",
        "global": { "simulationDuration": 5000, "seed": "<slug>-v1", "warmupDuration": 0 },
        "workload": {
          "pattern": "constant",
          "baseRps": 1000000,
          "requestDistribution": [
            { "type": "read", "weight": 1, "sizeBytes": 100 },
            { "type": "write", "weight": 0, "sizeBytes": 100 }
          ]
        },
        "invariants": [
          {
            "id": "headroom-80",
            "description": "No server may exceed 80% of its capacity during the sale",
            "condition": "perNode.maxUtilization <= 0.8"
          }
        ]
      }
    ],
    "visibleToStudent": true,
    "dryRunCase": {
      /* usually a copy of the primary case */
    }
  },
  "rubric": {
    "version": "1.0",
    "id": "<slug>-rubric",
    "passThreshold": 0.81,
    "checks": [
      {
        "id": "metric-target",
        "description": "Keep errors under 1%...",
        "kind": "simulation",
        "metric": "summary.errorRate",
        "op": "<",
        "value": 0.01
      },
      {
        "id": "rubric-check-1",
        "description": "Serve the full flash-sale load...",
        "kind": "simulation",
        "metric": "summary.throughput",
        "op": ">=",
        "value": 1000000,
        "points": 1
      },
      {
        "id": "rubric-check-2",
        "description": "Stay within the headroom budget...",
        "kind": "invariant",
        "metric": "invariantViolations.count",
        "op": "==",
        "value": 0,
        "points": 2
      }
    ]
  },
  "author": "<author>",
  "createdAt": "<ISO-8601>"
}
```

Rubric-check rules:

- `kind: "simulation"` for `summary.*` / `perNode.*` metrics; `kind: "invariant"`
  for `invariantViolations.count` and the invariant family.
- **Units are raw**, not UI: error rate `1%` → `summary.errorRate < 0.01`; a
  utilization budget of 80% → `perNode.maxUtilization <= 0.8`.
- `description` is what the student sees in the Tests panel — write a **plain
  sentence**, never `metric op value` jargon (e.g. "Serve the full 1,000,000 req/s",
  not "Summary throughput >= 1000000.").
- The invariant that a rubric check counts (`invariantViolations.count == 0`) must
  actually be declared in every `suite.cases[*].invariants`, or it can never fire.

---

## 3. Solution topology — `*.solution-topology.json`

A React-Flow canvas that **passes every check**. Opening it in the simulator loads
the design; running it against the question (or standalone via its own `scenario`)
must reproduce a full pass. The open handler recognises a design by the presence of
`.nodes`.

```jsonc
{
  "version": "2.0.0", // REQUIRED literal — the canvas schema version
  "nodes": [
    /* see node shape */
  ],
  "edges": [
    /* see edge shape */
  ],
  "scenario": {
    // optional; include so it runs standalone
    "global": {
      "simulationDuration": 5000,
      "warmupDuration": 0,
      "seed": "<slug>-v1",
      "defaultTimeout": 5000,
      "traceSampleRate": 0.01
    },
    "selectedSourceNodeId": "<source node id>",
    "workloadOverride": {}
  }
}
```

Source node (traffic origin — one per design; `structuralRole: "source"`):

```jsonc
{
  "id": "src",
  "type": "serviceNode",
  "position": { "x": 700, "y": -360 },
  "data": {
    "schemaVersion": 2,
    "templateId": "input-source",
    "componentType": "api-endpoint",
    "structuralRole": "source",
    "profile": "source",
    "rendererType": "serviceNode",
    "label": "Traffic Source",
    "subLabel": "Entry Point / Ingress",
    "iconKey": "input-source",
    "source": {
      "requestDistribution": [{ "type": "default", "weight": 1, "sizeBytes": 100 }],
      "defaultWorkload": { "pattern": "constant", "baseRps": 1000000 }
    }
  },
  "width": 256,
  "height": 127,
  "positionAbsolute": { "x": 700, "y": -360 },
  "selected": false,
  "dragging": false,
  "nodes": []
}
```

Service / compute node (a backend server; `structuralRole: "service"`):

```jsonc
{
  "id": "srv_1",
  "type": "serviceNode",
  "position": { "x": 100, "y": 120 },
  "data": {
    "schemaVersion": 2,
    "templateId": "backend-server",
    "componentType": "microservice",
    "structuralRole": "service",
    "profile": "service",
    "rendererType": "serviceNode",
    "label": "API Server 1",
    "subLabel": "Long-running Process",
    "iconKey": "SERVER",
    "sim": {
      "resources": {
        "instanceType": "c5.2xlarge",
        "instanceCount": 1,
        "workloadKind": "io-bound",
        "perRequestMemMb": 16
      },
      "processing": {
        "distribution": { "type": "exponential", "lambda": 0.390625 },
        "timeout": 100
      },
      "queue": { "workers": 256, "capacity": 4096, "discipline": "fifo" }
    }
  },
  "width": 256,
  "height": 141,
  "positionAbsolute": { "x": 100, "y": 120 },
  "selected": false,
  "dragging": false,
  "nodes": []
}
```

Router node (a load balancer; `structuralRole: "router"` — treated as passthrough,
never a bottleneck):

```jsonc
{
  "id": "lb",
  "type": "serviceNode",
  "position": { "x": 700, "y": -140 },
  "data": {
    "schemaVersion": 2,
    "templateId": "load-balancer-l7",
    "componentType": "load-balancer-l7",
    "structuralRole": "router",
    "profile": "router",
    "rendererType": "serviceNode",
    "label": "Load Balancer L7",
    "subLabel": "HTTP / gRPC",
    "iconKey": "load-balancer-l7",
    "routingStrategy": "round-robin",
    "sim": {
      "resources": {
        "instanceType": "c5.2xlarge",
        "instanceCount": 1,
        "workloadKind": "io-bound",
        "perRequestMemMb": 4
      },
      "processing": { "distribution": { "type": "exponential", "lambda": 2.5 }, "timeout": 100 },
      "queue": { "workers": 256, "capacity": 4096, "discipline": "fifo" }
    }
  },
  "width": 256,
  "height": 141,
  "positionAbsolute": { "x": 700, "y": -140 },
  "selected": false,
  "dragging": false,
  "nodes": []
}
```

Edge (round-robin fan-out is even by default; omit `weight` unless skewing):

```jsonc
{
  "id": "reactflow__edge-lb-srv_1",
  "type": "packet",
  "animated": true,
  "style": { "stroke": "#94A3B8", "strokeWidth": 2 },
  "source": "lb",
  "sourceHandle": "bottom-1-source",
  "target": "srv_1",
  "targetHandle": "top-1-target",
  "selected": false
}
```

### Capacity math (this is why the solution passes)

The engine **derives** a service node's capacity — it never reads a story number:

```
workers        = vCPU(instanceType) × instanceCount × (io-bound ? 32 : 1)
capacity (rps) = workers ÷ meanServiceTimeSeconds
utilization    = offeredRps ÷ capacity           (offeredRps = load ÷ fan-out count)
```

- `meanServiceTimeSeconds` = mean of `processing.distribution` ÷ 1000. For
  `exponential`, mean(ms) = `1 / lambda`.
- `c5.2xlarge` = 8 vCPU → io-bound `8 × 32 = 256` workers. At `lambda = 0.390625`
  (mean 2.56 ms) → `256 ÷ 0.00256 = 100,000 rps` per server.
- To satisfy a `perNode.maxUtilization <= T` budget at offered load `L` split `N`
  ways: pick `N` so `(L ÷ N) ÷ capacity ≤ T`. For `L = 1,000,000`,
  `capacity = 100,000`, `T = 0.8` → `N ≥ 12.5` → **13 servers** (busiest 76.9%).
- **Routers are passthrough**: give the load balancer any reasonable config; its
  capacity is treated as infinite, so only service nodes appear in `maxUtilization`.

---

## 4. Cross-file consistency contract

Before emitting, verify every row agrees across the three files:

- `id` / `title` / `description` identical in #1.question, #2, and implied by #3's labels.
- `passThreshold` equal in #1 `setup.passThreshold` and #2 `rubric.passThreshold`.
- Every `#1.structuralRules[*]` and `#1.semanticRules[*]` has a matching #2 rule or
  criterion with the same ID, behavior fields, and learner-facing `description`.
- Every `#1.metricRules[*]` / `#1.rubricChecks[*]` has a matching
  `#2.rubric.checks[*]` (same metric/op/value and exact human `description`).
- Every invariant a rubric check counts is declared in `#2.suite.cases[*].invariants`.
- `allowedNodeTypes` in #1 and #2 match, and **every `componentType` used in #3 is
  in that list** (or the solution violates the question's own constraints).
- The workload in #2 `suite.cases[0]` equals #3's `scenario` + source `defaultWorkload`
  (same `baseRps`, pattern, duration, seed) so the solution reproduces the graded run.
- Run the capacity math for #3 and confirm the busiest service node lands at or
  below the invariant's utilization target — with margin, not on the boundary.

## 5. Validation before returning

- All three parse as JSON.
- #1 has `"artifact": "dsds-question-project"`; #2 has `version`, `suite`, `rubric`;
  #3 has `"version": "2.0.0"` and a non-empty `nodes` array.
- Structural rules only reference `componentType`s the palette supports.
- Request weights per case sum to a positive total; warmup < duration.
- The solution's derived utilization is strictly inside the budget.

If the target environment allows, open #2 as the question and #3 as the design,
run **Run & Evaluate**, and confirm a full pass. Report offline validation and any
in-app run as separate levels of evidence.
