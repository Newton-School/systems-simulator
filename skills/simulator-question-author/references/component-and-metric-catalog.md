# Component and Metric Catalog

Use [capability-snapshot.json](capability-snapshot.json) as the complete,
machine-generated catalog. It is derived from the engine authoring registry,
palette, and builder-policy enums and includes:

- every authorable component token, label, alias, category, and support tier;
- every rubric metric with kind, group, unit, operator set, and evidence mode;
- every structural and semantic rule kind;
- workload patterns and chaos-experiment presets;
- builder node classes, runtime templates, and trait packs;
- directional component-family relationships.

Never infer a token from a palette label. Search the snapshot by label or alias and
serialize the matching `id`.

## Component families

Family matching is directional. A requirement for `load-balancer` accepts
`load-balancer`, `load-balancer-l4`, and `load-balancer-l7`. A requirement for
`load-balancer-l7` accepts only `load-balancer-l7`. Apply this rule consistently
to allowlists, forbidden lists, structural rules, semantic criteria, topology
component-count metrics, and reference-solution validation.

## Metric selection

Use a metric only when its `evidenceModes` include the selected execution path.
The main groups are:

- `latency`, `requests`, `perNode`: core simulation outcomes;
- `coordination`, `resilience`, `consistency`: opt-in runtime mechanisms;
- `topology`: fixed totals available without component-specific metric invention;
- `cache`, `collapse`, `changeStream`, `telemetry`, `cluster`, `edges`,
  `faultDomains`: feature metrics that normally resolve only when the feature is
  configured and exercised;
- `invariants`: declared case invariants and global correctness checks.

An unresolved metric fails; it does not behave as zero. This makes checks such as
`cache.hitRatio >= 0.8` fail closed when no cache lookup occurred, and prevents a
design without the required feature from passing a `== 0` feature-counter check.

## Units

Use the `unit` stored beside each metric. Important conversions:

| Human statement         | Raw package value               |
| ----------------------- | ------------------------------- |
| Error rate below 1%     | `summary.errorRate < 0.01`      |
| Utilization at most 80% | `perNode.maxUtilization <= 0.8` |
| Latency below 250 ms    | latency metric `< 250`          |
| Pass threshold 100%     | `rubric.passThreshold: 1`       |

For count metrics, remember the grader's floating comparison tolerance. Express an
integer maximum as `<= N`, not `< N+1`.

## Consistency and linearizability

Consistency metrics require replicated SQL/NoSQL nodes with a configured
consistency model plus keyed reads/writes. Session guarantees require
`workload.sessions.count`.

A zero `consistency.linearizabilityViolations` count is insufficient by itself.
Pair it with `consistency.linearizableVerified == 1` or
`consistency.linearizabilityOpsNotChecked == 0` so bounded-out operations cannot
produce a false claim. The verifier covers single-key register histories, not
multi-key transactional linearizability.

## Maintaining the snapshot

From a simulator checkout:

```bash
npx tsx scripts/generate-simulator-question-author-snapshot.ts
npm run check:simulator-question-author-snapshot
```

Do not hand-edit the generated JSON. A stale-snapshot check should fail before the
skill is packaged.
