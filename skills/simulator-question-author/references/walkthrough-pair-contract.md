# Walkthrough Pair Contract

The two files serve different readers but describe one executable question. Use
this contract to keep them synchronized.

## 1. Audience boundary

### `builder-walkthrough.md`

Reader: learner, teacher demonstrating the solution, or reviewer reproducing the
canonical design.

It answers:

- What am I building?
- Which components do I place?
- What exact configuration values do I enter?
- How do I connect and route them?
- What calculation determines sizing?
- What should I see when I run it?
- Why do plausible wrong designs fail?

Do not turn it into a Question Studio manual.

### `question-studio-walkthrough.md`

Reader: question author or curriculum engineer.

It answers:

- How do I encode the learner prompt and starting state?
- Which scenario actually runs?
- Which controls compile into which grading obligations?
- Which values, units, points, and thresholds are exact?
- What is modeled, inferred, or deferred?
- How do I prove the question discriminates correctly?
- What do I inspect before export?

Do not repeat every learner canvas click; link to the builder guide for the
canonical answer.

## 2. Shared facts that must match

| Fact                             | Builder location      | Studio location                   |
| -------------------------------- | --------------------- | --------------------------------- |
| Title/slug                       | Heading/introduction  | Frame and Export                  |
| Teaching objective               | Problem/why           | Overview/metadata                 |
| Real and modeled scale           | Problem/run           | Brief/Scenarios                   |
| Component labels and type tokens | Place/configure       | Start constraints/Grading         |
| Topology and routing             | Final topology/wiring | Scaffold/structural rules         |
| Capacity derivation              | Configuration/math    | Prompt givens/scenario/acceptance |
| Workload mix and pattern         | Run setup             | Scenarios                         |
| Faults/invariants                | Run expectations      | Scenarios/Grading                 |
| Passing metrics                  | Expected results      | Metric/verdict checks             |
| Valid alternatives               | Trade space           | Solution-space notes              |
| Unsupported behavior             | Modeling boundaries   | Feasibility/deferred concerns     |

One source of truth should populate both files. Never calculate values separately
while drafting each guide.

## 3. Builder guide content contract

Required sections, adapted to the question:

1. purpose and link to Question Studio guide;
2. learner problem;
3. governing calculations/assumptions;
4. final topology;
5. place nodes;
6. configure nodes/resources/traits;
7. wire edges and routing;
8. configure workload or explain injected question workload;
9. run and inspect;
10. expected results for passing and near-miss designs;
11. simulator physics and modeling boundaries;
12. gotchas and anti-gaming cases;
13. gradeable versus explanation-only decisions;
14. optional simpler/harder variants.

For a scaffolded repair/optimization question, replace “place nodes” with the
appropriate inspect/change workflow.

## 4. Question Studio guide content contract

Required sections:

1. purpose and link to builder guide;
2. final teaching/grading contract;
3. feasibility decision and boundaries;
4. access/start instructions;
5. exact values for every visible Studio stage;
6. requirement-to-check traceability;
7. compiled row/check plan;
8. preview checklist;
9. export checklist;
10. passing, near-miss, and anti-gaming acceptance cases;
11. troubleshooting tied to real compiler/evaluator failures.

If a stage is intentionally unused, say so and explain why.

## 5. Writing exact steps

Use:

- current UI labels in bold;
- literal values in code formatting;
- tables for repeated field/value mappings;
- resolved component types beside palette labels;
- formulas with units;
- expected metric values or defensible ranges;
- explicit defaults only when the default is stable and verified.

Avoid:

- “configure as appropriate”;
- “add enough servers” without the calculation;
- “the grader checks performance” without metric/operator/value;
- unverified screenshots or coordinates;
- claims that dots/animation counts are exact request data;
- ambiguous names such as “server” when several type tokens exist.

## 6. Traceability discipline

For each prompt statement, choose one primary disposition:

- graded structurally;
- graded semantically;
- graded at runtime;
- graded as an invariant;
- constrained by budget;
- explanation-only;
- narrative;
- deferred.

Redundant checks are allowed only when they provide orthogonal protection. For
example:

- structural rule: load balancer exists;
- runtime check: offered traffic is actually served.

Do not duplicate the same count in structural and topology rubric form merely to
increase row count.

## 7. Expected-results discipline

Every results table should identify:

- the changed design variable;
- derived load/capacity relationship;
- expected metric;
- expected grading outcome;
- the specific rule/check that fails.

Use actual simulator output when available. When only analytically derived,
label it as a prediction pending execution.

## 8. Modeling-boundary language

Use precise language:

- “The simulator models…”
- “The question infers this from topology…”
- “This is a simplified proxy for…”
- “The learner explains this tradeoff; it is not runtime-graded.”
- “This guarantee is out of scope and is not claimed.”

Avoid “the simulator proves” unless the engine truly implements the property.

## 9. Cross-file final check

Compare both files side by side and verify:

- same title and slug;
- same component labels/types;
- same topology arrows and edge modes;
- same scale and request mix;
- same capacity assumptions and instance/node equivalence;
- same scenario duration, seed, faults, and invariants;
- same thresholds and boundary operators;
- same passing/near-miss outcomes;
- same support caveats;
- reciprocal relative links work;
- no placeholders, internal planning notes, or unsupported claims remain.
