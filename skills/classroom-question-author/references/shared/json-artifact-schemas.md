# JSON Artifact Schemas

The three author-side files describe one question and must be validated together.
Field shapes in this reference target the October 2026 authoring contract.

| File                                     | Surface               | Security classification    |
| ---------------------------------------- | --------------------- | -------------------------- |
| `<slug>.simulator-question-project.json` | Question Studio       | Private editable source    |
| `<slug>.question-package.json`           | Author/grader runtime | Private grading contract   |
| `<slug>.solution-topology.json`          | Simulator / CLI       | Private reference solution |

The browser-safe student assignment is derived during publication. It is not the
full question package.

## 1. Question Studio project

Required envelope:

```json
{
  "artifact": "dsds-question-project",
  "artifactVersion": "1.0",
  "projectId": "<stable UUID>",
  "updatedAt": "<ISO-8601>",
  "question": {},
  "assets": { "gamedTopologies": [] },
  "ui": { "activeStage": "export" }
}
```

`question` contains:

- stable title-derived `id`, title, description, tags, author, and created date;
- `setup`: difficulty, type, entry format, domains, concepts, workload category,
  estimated time, pass threshold, private-suite visibility, budget, constraints,
  and optional `builderPolicy`;
- learner prompt, atomic FRs/NFRs, scale, and context;
- private authoring scenarios and an optional separate public `dryRunCase`;
- structural rules, semantic rules, metric rules, rubric checks, and justification;
- optional scaffold/reference/gamed topologies under `assets`.

Use `dryRunScenarioId` only when the selected private scenario is intentionally
safe to reveal in full. Otherwise author `dryRunCase` separately and omit hidden
invariants, faults, experiments, and thresholds.

### Builder policy

Optional `setup.builderPolicy` fields:

```json
{
  "allowServiceBuilder": false,
  "allowMyServices": false,
  "allowCustomNodeBuilder": false,
  "allowedNodeClasses": ["compute", "storage"],
  "allowedRuntimeTemplates": ["long-running-service"],
  "allowedTraitPacks": ["capacity", "workload-profile"],
  "maxDefinitions": 2,
  "maxOperationsPerService": 4,
  "lockDefinitionsAfterFirstRun": true
}
```

Omitted fields preserve the normal unrestricted behavior. Do not combine a
restrictive builder policy with an allowlist that hides both builder tiles unless
the policy is intentionally dormant.

## 2. Private question package

Required top-level shape:

```json
{
  "version": "1.0",
  "id": "<slug>",
  "title": "<title>",
  "difficulty": "beginner",
  "type": "scaling",
  "entryFormat": "blank-canvas",
  "prompt": {},
  "scaffold": { "type": "empty" },
  "constraints": {
    "allowedNodeTypes": ["api-endpoint", "load-balancer", "microservice"],
    "canModifyScaffold": true,
    "canRemoveScaffoldNodes": true
  },
  "suite": { "name": "<slug>-suite", "cases": [], "visibleToStudent": false },
  "rubric": { "version": "1.0", "id": "<slug>-rubric", "passThreshold": 1, "checks": [] }
}
```

Optional package surfaces include `builderPolicy`, structural rules, semantic
criteria, justification prompts, budget, domains, concepts, scaffold locks and
baseline verdict, authored faults, and chaos experiments.

Project-to-package compilation rules:

- human error-rate percentages compile to raw fractions;
- durations compile from seconds to milliseconds;
- rule/check IDs and learner-facing descriptions remain identical;
- `setup.builderPolicy` compiles to top-level `builderPolicy`;
- only compiled private scenarios enter `suite.cases`;
- the public dry run enters `suite.dryRunCase` without gaining private mechanics.

## 3. Canonical solution TopologyJSON

The solution must be engine-format TopologyJSON, not a saved React Flow canvas.
It requires `id`, `name`, `version`, `global`, `nodes`, `edges`, and an executable
`workload`:

```json
{
  "id": "<slug>-solution",
  "name": "<title> — Reference Solution",
  "version": "2.1.0",
  "global": {
    "simulationDuration": 5000,
    "warmupDuration": 0,
    "seed": "<slug>-v1",
    "timeResolution": "microsecond",
    "defaultTimeout": 5000
  },
  "nodes": [
    {
      "id": "source",
      "type": "api-endpoint",
      "category": "compute",
      "role": "source",
      "label": "Traffic Source",
      "position": { "x": 80, "y": 300 }
    }
  ],
  "edges": [],
  "workload": {
    "sourceNodeId": "source",
    "pattern": "constant",
    "baseRps": 1000,
    "requestDistribution": [{ "type": "read", "weight": 1, "sizeBytes": 100 }]
  }
}
```

Do not include `data.rendererType`, React Flow handles, `selected`, `dragging`,
dimensions, nested `nodes`, or canvas `scenario`. The renderer derives those when
it opens canonical TopologyJSON.

### Capacity

Capacity must come from serialized engine fields:

1. `config.capacityRps` only when `config.capacityAuthored === true`;
2. otherwise effective concurrency derived from resources divided by mean service
   time;
3. components explicitly classified as passthrough by the current spec.

For even fan-out:

```text
perNodeLoad = offeredRps / replicaCount
utilization = perNodeLoad / perNodeCapacity
replicaCount >= offeredRps / (perNodeCapacity * utilizationLimit)
```

Choose a replica count strictly inside the limit when possible, then prove one
fewer replica fails the intended headroom check.

### Edges

Canonical edges contain engine semantics rather than renderer styling:

```json
{
  "id": "source-to-service",
  "source": "source",
  "target": "service",
  "mode": "synchronous",
  "protocol": "https",
  "latency": {
    "distribution": { "type": "constant", "value": 1 },
    "pathType": "same-dc"
  },
  "bandwidth": 1000,
  "maxConcurrentRequests": 10000,
  "packetLossRate": 0,
  "errorRate": 0
}
```

Author connection, batching, congestion, geo latency, or protocol fields only when
the lesson needs them.

## 4. Coverage map

`<slug>.coverage.json` (template: `assets/coverage.template.json`) traces the
source to the grading and records the grading budget:

| Field                 | Meaning                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `artifact`, `version` | `"simulator-question-coverage"`, `"1.0"`                                                                     |
| `questionId`          | Same id as the project and package                                                                           |
| `source`              | `document` and `section` the question was written from                                                       |
| `series.buildsOn`     | Previous question id; required when `carriedForward` is not empty                                            |
| `requirements[]`      | Every source bullet verbatim: `id`, `kind` (`requirement`, `concept`, `nfr`), `status`, `checks` or `reason` |
| `sanity[]`            | Ids of sanity rows                                                                                           |
| `carriedForward[]`    | `{ check, from }` presence rows kept from earlier questions                                                  |
| `advisories[]`        | `{ code, path?, reason }` for each Studio advisory left in place                                             |

`status` is `graded` (one core check), `covered` (already graded by listed
checks), or `explained` (a `reason`, no checks). Every project rule and check id
must appear in exactly one tier. Rules are in
[grading budget](grading-budget.md).

## 5. Cross-file contract

Verify:

- project and package IDs, titles, descriptions, metadata, and thresholds agree;
- the supplied package is the exact successful compile output of the project;
- rule, criterion, invariant, scenario, and check IDs are stable and unique;
- learner-facing descriptions are preserved exactly;
- project constraints and builder policy compile unchanged;
- every solution component is accepted by the allowlist under directional family
  matching and is absent from the expanded forbidden list;
- every rubric metric is in the capability snapshot and has a producing case;
- every invariant check has a declared invariant in each relevant private case;
- the solution workload matches the intended private case in load, mix, seed,
  duration, and execution mode;
- the public dry run contains no hidden invariant, fault, experiment, or rubric
  threshold;
- the solution passes, and the near miss fails the intended obligation;
- the project stores the solution as `assets.referenceTopology`, each near miss in
  `assets.gamedTopologies` targets a core check, and `verification` is current;
- the coverage map traces every row and stays inside the grading budget.

## 6. Validation commands

Standalone:

```bash
node scripts/validate-artifacts.mjs <directory> <slug>
```

Simulator checkout:

```bash
npm run audit:simulator-question -- <directory> <slug>
npm run sim -- validate <slug>.solution-topology.json
npm run sim -- grade <slug>.question-package.json <slug>.solution-topology.json
```

Question Studio verification must be done in AUTHOR mode. Assignment mode is
deliberately unable to expose private package internals or import the private
reference solution.
