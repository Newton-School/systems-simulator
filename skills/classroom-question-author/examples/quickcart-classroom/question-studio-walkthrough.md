# QuickCart Flash Sale — Classroom Question Studio Walkthrough

How to author **QuickCart Flash Sale** in Question Studio's Classroom flow
(Lesson → Preview → Export). Every step below was carried out in the live Studio and
the exported package was graded afterwards. The results are in
[What the finished question does](#what-the-finished-question-does).

**The lesson.** Students put a load balancer in front of a pool of servers and size the
pool to an 80% utilization budget:

- usable capacity per server = 80% × 100,000 = **80,000 req/s**
- servers needed = 1,000,000 ÷ 80,000 = 12.5 → **13** (always round up)

Students never pick instance types, service times or traffic settings. The question
states those numbers, and students decide only what to place, how to connect it and
how many servers to run.

---

## Before you start

1. Open Question Studio: `/question-studio` on the simulator URL (locally,
   `http://localhost:5173/question-studio`).
2. Click **New**.
3. Under **Authoring depth** (top right of the stage), make sure **Classroom** is
   selected. Classroom shows the three stages; Guided and Architect show the detailed
   seven-stage flow.

The draft is not saved automatically. Click **Save draft** before you reload or leave
the page.

---

## Stage 1 — Lesson

### 1. Question identity

| Field          | Value                  |
| -------------- | ---------------------- |
| Question title | `QuickCart Flash Sale` |

The generated question ID becomes `quickcart-flash-sale`.

### 2. Learner brief

Paste this into **Problem statement**:

```text
You are the backend architect for QuickCart. During a flash sale the site receives up to 1,000,000 requests per second. Each backend server can handle 100,000 requests per second, and to stay stable no server may run above 80% of its capacity. The load balancer is already configured to spread requests evenly across every server you add. Build the backend with the fewest servers that serves every request while staying within the 80% limit.
```

Keep the three numbers (1,000,000, 100,000 and 80%) in the prompt. You'll enter the
same numbers as givens below, and the learner's "What you're given" table is built
from them.

### 3. Functional requirements and measurable targets

Leave both empty. In Classroom mode the grading comes from the Classroom checks you
add later; requirement and target cards here would only repeat them.

### 4. Scale and additional context

| Field        | Value     |
| ------------ | --------- |
| Peak traffic | `1000000` |
| Read share   | `100`     |

Leave the other fields blank. Peak traffic is required: it is the traffic every
Classroom run and grade uses.

### 5. Runtime question setup

| Field             | Value         |
| ----------------- | ------------- |
| Question type     | Scaling       |
| Difficulty        | Beginner      |
| Learner entry     | Blank canvas  |
| Workload category | Read heavy    |
| Estimated time    | `10` min      |
| Pass threshold    | `1` (default) |
| Teaching domains  | **Compute**   |

Leave **Grade a budget**, **Let learners see grading scenarios** and **Show design
checks in Classroom mode** unticked. Design checks such as "single point of failure"
would flag the single load balancer, which isn't part of this lesson.

### 6. Concepts taught — this does most of the setup

QuickCart teaches two concepts, so add both. Type each ID in **Concepts taught** and
press **Enter** (or click **Add**):

1. `NET-05` (Load balancing)
2. `CMP-02` (Horizontal versus vertical scaling)

Adding a concept in Classroom depth applies its recipe immediately. After both are
added, the Studio has already:

- ticked **Allow Classroom launches**;
- set the component kit to **Users, Load Balancer, Server**;
- created one learning objective per concept;
- created five student decisions: placing Users, Load Balancer and Server, and
  connecting them (all for the load-balancing objective), plus the Server copy count
  (for the scaling objective);
- added two checks: **Traffic follows the required path** (proves load balancing)
  and **Serve the offered traffic** (proves scaling);
- set the utilization target to 80%.

An **Adaptive recipe** card shows what the recipe expects from you: peak traffic,
server capacity and the utilization target. The Studio never invents these numbers.
**Apply recommended setup** re-applies the latest concept's recipe. You only need it
if you removed something by mistake.

### 7. Classroom authoring

#### Component kit

Confirm that exactly three cards are ticked in the card list: **Users**, **Load
Balancer** and **Server**. Everything else (API Gateway, CDN, Worker, Cache, the
databases, Queue) stays unticked. These three cards are the learner's whole palette.

#### Givens

Fill in the **Server** row:

| Field         | Value    |
| ------------- | -------- |
| Lecture label | `Server` |
| Capacity      | `100000` |
| Cost / hr     | `0.192`  |

Leave the Load Balancer row and both fixed-latency fields empty.

| Target                   | Value              |
| ------------------------ | ------------------ |
| Maximum utilization      | `80` (already set) |
| Maximum dropped requests | `1` (default)      |

As soon as the server capacity is entered, the **Capacity answer key** at the bottom of
the section fills in (see step 9).

#### Student-configurable decisions

Review the five decisions. Nothing needs to change. Each one is linked to an
objective, and the Studio rejects any decision that isn't.

#### Classroom checks

Tick the two remaining checks:

- **Stay within the utilization target**
- **Avoid obvious overprovisioning**

Then set **Stay within the utilization target proves** to the **scaling** objective.
It defaults to the first objective (load balancing), which is wrong for this check.

| Check                              | Proves                   | Scored?            |
| ---------------------------------- | ------------------------ | ------------------ |
| Traffic follows the required path  | Load balancing           | Yes                |
| Serve the offered traffic          | Scaling                  | Yes                |
| Stay within the utilization target | Scaling                  | Yes                |
| Avoid obvious overprovisioning     | (no objective; feedback) | No — feedback only |

An objective can have at most two scored checks, so the scaling objective is full.

#### Learning objectives

Replace the generated wording with something specific. Both must start with "The
student can":

| Concept | Statement                                                                                    |
| ------- | -------------------------------------------------------------------------------------------- |
| NET-05  | `The student can place a load balancer so user traffic is spread across a pool of servers.`  |
| CMP-02  | `The student can size a server fleet to an 80% utilization budget instead of 100% capacity.` |

Learners see these under **What you'll practise**.

#### Wrong-answer messages (optional, recommended)

Click **+ Add message** and fill it in:

| Field        | Value                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Title        | `Planned to 100%, not 80%`                                                                                                                   |
| Failed check | Stay within the utilization target                                                                                                           |
| Objective    | The scaling objective                                                                                                                        |
| Message      | `Your fleet can carry the load, but the servers have no room for a burst. Plan with 80% of 100,000 = 80,000 req/s per server, and round up.` |

Students who build 10–12 servers see this message above their results. It never
names 13.

#### Lecture and advanced features (optional)

Skip these for a first pass. **+ Prediction** asks "How many servers will you need?"
before the first run, and **+ Presenter step** builds a scripted lecture sequence.

### 8. Check readiness

The right-hand **Readiness** panel should show **Draft checklist 4 / 4**: Question
identity, Learner brief, Generated baseline and Objective-backed checks. The header's
**Django bundle** button becomes available at the same moment.

### 9. Check the answer key

The **Capacity answer key** should read:

| Servers | Utilization | Result   |
| ------- | ----------- | -------- |
| 10      | 100.0%      | Fail     |
| 11      | 90.9%       | Fail     |
| 12      | 83.3%       | Fail     |
| **13**  | **76.9%**   | **Pass** |
| 14      | 71.4%       | Pass     |

13 is the first passing row, matching the lecture's 12.5 → 13. If it isn't, re-check
the server capacity, peak traffic and maximum utilization.

Click **Continue to Preview**.

---

## Stage 2 — Preview

The compiled learner experience should show:

- **RUNTIME-VALID**, with `beginner · scaling · blank-canvas`;
- **Starting design:** "Learners start with a blank canvas.";
- **Test access:** "No learner-visible dry run." Students' Run & Evaluate uses the
  stated peak traffic.

Open the **Interactive learner workspace** (use **Full screen** on a narrow window):

- **Components:** exactly three tiles: **Load Balancer**, **Server** and **Users**.
- **Question:** the header ends in `· CLASSROOM`; the brief shows **What you'll
  practise** (your two objectives) and **What you're given** (Users 1,000,000 req/s at
  peak, Load Balancer spreads traffic evenly, Server 100,000 req/s each, and the
  utilization and dropped-request rules).

Click **Done previewing**, then **Continue to Export**.

---

## Stage 3 — Export

**Generated output is current** should appear, with package ID `quickcart-flash-sale`.

- If **Authoring advisories** says no `domains` are declared, go back to step 5 and
  select **Compute**.
- **Download question (.json)** gives the package to load in the simulator.
- **Download Django bundle** gives the Newton handoff.
- Click **Save draft** to keep the editable project.

The package's `classroom` section should contain the Server given, the 80% target, the
two objectives, the three scored checks plus the feedback check, the message and the
five decisions. See [the appendix](#appendix-the-generated-classroom-section).

---

## What the finished question does

Graded in Classroom mode against the exported package:

| Student design              | Result | What the student sees                                                                            |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Users → LB → **12** servers | Fail   | "Server ×12: 83.3% (target 80%)." and the **Planned to 100%, not 80%** message                   |
| Users → LB → **13** servers | Pass   | All checks pass                                                                                  |
| Users → LB → **30** servers | Pass   | Unscored feedback: "30 server copies is much more than this traffic needs."                      |
| Users → servers (**no LB**) | Fail   | Both path checks fail ("expected edge from api-endpoint to load-balancer"…); no headroom message |

"13 servers" and "one Server with Copies = 13" grade the same.

To check it yourself from a checkout (any reference topology with Users → Load
Balancer → 13 servers works, e.g. the simulator skill's QuickCart solution):

```bash
npm run sim -- grade quickcart-flash-sale.question.json quickcart-flash-sale.solution-topology.json --abstraction classroom
```

---

## Troubleshooting

Validation messages you may see in the Lesson stage, and the fix:

| Message                                                              | Fix                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| "Compute component 'microservice' needs an explicit capacity given." | Enter the Server **Capacity** (`100000`).                                                                 |
| "An active Classroom intent needs a stated peak traffic value."      | Enter **Peak traffic** in Scale (`1000000`).                                                              |
| "Objective '…' has more than two scored checks…"                     | A check is pointing at the wrong objective. Set **Stay within the utilization target proves** to scaling. |
| "Objective '…' has no scored evidence."                              | Point at least one scored check at that objective.                                                        |
| "Objective '…' must be an observable 'The student can…' statement."  | Start the objective with "The student can".                                                               |
| "Check '…' is not supported evidence for the selected concepts' …"   | Add the concept that check belongs to (the path check needs `NET-05`).                                    |
| The answer key's first pass isn't 13                                 | Re-check server capacity (100,000), peak (1,000,000) and maximum utilization (80).                        |

---

## Appendix: the generated `classroom` section

```json
{
  "abstractions": ["classroom", "guided", "architect"],
  "givens": { "microservice": { "label": "Server", "capacityRps": 100000, "costPerHour": 0.192 } },
  "targets": { "maxUtilization": 0.8 },
  "objectives": [
    {
      "id": "objective-net-05",
      "concept": "NET-05",
      "statement": "The student can place a load balancer so user traffic is spread across a pool of servers."
    },
    {
      "id": "objective-cmp-02",
      "concept": "CMP-02",
      "statement": "The student can size a server fleet to an 80% utilization budget instead of 100% capacity."
    }
  ],
  "checks": [
    {
      "id": "objective-net-05-traffic-flows-through",
      "template": "traffic-flows-through",
      "via": "load-balancer",
      "component": "microservice",
      "objectiveId": "objective-net-05"
    },
    {
      "id": "objective-cmp-02-serves-all-traffic",
      "template": "serves-all-traffic",
      "objectiveId": "objective-cmp-02"
    },
    {
      "id": "classroom-within-target-utilization",
      "template": "within-target-utilization",
      "component": "microservice",
      "objectiveId": "objective-cmp-02"
    },
    {
      "id": "classroom-right-sized",
      "template": "right-sized",
      "severity": "feedback",
      "component": "microservice",
      "factor": 1.5
    }
  ],
  "misconceptions": [
    {
      "id": "misconception-1",
      "title": "Planned to 100%, not 80%",
      "objectiveId": "objective-cmp-02",
      "detect": { "kind": "check-failed", "checkId": "classroom-within-target-utilization" },
      "message": "Your fleet can carry the load, but the servers have no room for a burst. Plan with 80% of 100,000 = 80,000 req/s per server, and round up."
    }
  ],
  "controls": [
    { "kind": "place-component", "component": "api-endpoint", "objectiveId": "objective-net-05" },
    { "kind": "place-component", "component": "load-balancer", "objectiveId": "objective-net-05" },
    { "kind": "place-component", "component": "microservice", "objectiveId": "objective-net-05" },
    { "kind": "connect-components", "objectiveId": "objective-net-05" },
    { "kind": "copies", "component": "microservice", "objectiveId": "objective-cmp-02" }
  ]
}
```

(Labels and control IDs are omitted for brevity.)
