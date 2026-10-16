# Classroom Checks

| Template                    | Use when                                     | Evidence            |
| --------------------------- | -------------------------------------------- | ------------------- |
| `traffic-flows-through`     | Traffic must pass through a visible boundary | Structural path     |
| `serves-all-traffic`        | The source states a loss/error objective     | Simulation summary  |
| `within-target-utilization` | The source states a headroom limit           | Per-node invariant  |
| `right-sized`               | Overprovisioning feedback helps learning     | Copy-count feedback |

Every scored check must correspond to a source requirement and teaching
objective. `right-sized` may be feedback-only. Do not add runtime checks to a
structural-only question.
