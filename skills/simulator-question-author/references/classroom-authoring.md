# Classroom Authoring: Generalization Contract

Classroom authoring is **prompt-general but capability-bounded**. Apply the same
decision process to every source prompt; never reshape an unsupported lesson into
the QuickCart answer merely because that example exists.

## 1. Choose the teaching evidence first

For every learning objective, classify the evidence the student must manipulate:

| Evidence                                                                                                           | Classroom treatment                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Component presence, order, or path                                                                                 | Concept cards plus structural checks                                |
| Copies, stated capacity, throughput, utilization, headroom                                                         | Capacity card plus stated `capacityRps` and Classroom checks        |
| A fixed conceptual boundary such as gateway, CDN, or queue                                                         | Passthrough card; grade its position, not invented runtime behavior |
| Instance sizing, service-time tuning, retries, consistency, sharding mechanics, failure timing, or latency physics | Architect mode until a specific Classroom control and check exist   |
| Unsupported product guarantee or application behavior                                                              | Explain, reframe honestly, or block; never manufacture a proxy      |

Then choose exactly one outcome:

- **Classroom-direct:** every graded objective depends only on visible cards,
  structure, copy counts, stated givens, and registered Classroom checks.
- **Classroom-structural:** the topology lesson is supported, but runtime behavior
  is not. Grade structure only and do not claim simulation evidence.
- **Architect:** a hidden engine setting is itself the lesson, or a needed card or
  check is absent. Set `abstractions` to `["architect"]`.
- **Reframed/blocked:** use the feasibility workflow; do not emit misleading
  Classroom artifacts.

Record this decision in the coverage map's explanation for the affected source
requirements.

## 2. Use the registry, not an example

Read `references/capability-snapshot.json` → `classroom.cards`. It is the only
authoritative Classroom card list. The registry currently covers these broad
families:

- traffic source;
- API gateway, CDN, and load balancer;
- request-serving server and background worker;
- cache, SQL database, and NoSQL database;
- message queue.

Use the exact engine component token from each card's `covers` list. A prompt may
rename a card through `classroom.givens.<type>.label`, but a label never creates a
new component or behavior.

Every Classroom question must have an explicit `allowedNodeTypes` list. Every
allowed type must have a registered card. Capacity-bound allowed types must state
`capacityRps`; Classroom never derives a fact the prompt did not give. The prompt
must also state peak traffic.

Passthrough cards intentionally promise only their visible conceptual role. For
example, a queue card can teach producer → queue → worker placement, but it does
not prove backlog drain, delivery semantics, or retries. Those require Architect
mode until dedicated Classroom semantics exist.

## 3. Build checks from objectives

Use only check templates in the snapshot:

- `traffic-flows-through` for a required visible path;
- `serves-all-traffic` for a stated loss/error objective;
- `within-target-utilization` for a stated utilization/headroom objective;
- `right-sized` for feedback about obvious overprovisioning.

Do not add a utilization or serving check to a structural-only lesson. Do not use
an authored Architect check when it reads configuration Classroom removes; write
a plain-language Classroom check or keep the question Architect-only.

## 4. Prove the family, not just the happy path

Validation for a Classroom question requires:

1. the canonical solution passes with `--abstraction classroom`;
2. a plausible near miss fails the intended Classroom objective;
3. editing hidden engine configuration cannot change the result;
4. every allowed component has a card and every capacity card has a stated given;
5. learner feedback names the concept and human-unit threshold;
6. if the question is outside the server-scaling family, its own non-QuickCart
   path is exercised (for example Users → Gateway → Server, Service → Cache →
   Database, or Producer → Queue → Worker).

QuickCart is a reference for capacity arithmetic only. It is not a template for
gateway, caching, storage, messaging, consistency, resilience, or sharding
lessons.
