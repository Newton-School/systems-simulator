# Progressive Disclosure & Deliberate Abstraction — UI Spec

Status: proposal (no code changed). Goal: cut first-screen cognitive load. Reference model: Whimsical — a
near-empty canvas, one slim tool rail, and everything else categorised behind a menu, a panel or a
keystroke.

## 0. The rule

> The user sees **only what the current stage of the loop needs**. Everything else exists, but is one
> deliberate gesture away, and is grouped by intent, never dumped as a flat list.

The user's loop (the only thing the first screen must serve):

```
 READ the task  ->  PLACE parts  ->  CONNECT  ->  RUN  ->  UNDERSTAND  ->  IMPROVE
   (Stage 0)        (Stage 1)       (Stage 1)   (Stage 2)   (Stage 3)       (Stage 4)
```

## 1. What we have today (audit)

| Area              | Today (code)                                                                                                                                                                                                                                 | Items on first screen              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Header            | `layout/Header.tsx`: Back, Branding, left-sidebar toggle, CostChip, DesignChecksChip, ModeBadge, FileStatus, Open, Save, Auto Layout, TopologyJSON controls, SimulationControls (Run, Speed, Workload...), ThemeToggle, right-sidebar toggle | ~16                                |
| Left sidebar      | `library/LibrarySidebar.tsx`: 5 tabs (Question Text, Blueprints, Labs, Component Library, Scenarios); library is a long flat list of node types                                                                                              | 5 tabs + N nodes                   |
| Canvas rail       | `canvas/CanvasToolbar.tsx`: Select, Pan, Connect, Annotate palette, Symbol/Card toggle, Undo, Redo, More, Collapse                                                                                                                           | ~9                                 |
| Right panel       | `properties/PropertiesPanel.tsx` (~2000 lines) / `ClassroomInspector.tsx`: Givens, Copies, Choices, Guided controls, One level deeper                                                                                                        | 5 sections                         |
| Results tray      | `simulation/ResultsTray.tsx`: 7 tabs (Overview, Bottlenecks, Node Metrics, Event Log, Failures, Traces, Traffic) + many charts                                                                                                               | 7 tabs                             |
| Classroom results | `simulation/ClassroomResultsCard.tsx`: already a compact summary (Offered / Served / Dropped / Cost + per-component utilisation)                                                                                                             | good, but sits beside the big tray |

Total first-glance decisions: **well over 40**. Target: **under 10**.

## 2. Disclosure levels (the vocabulary used below)

| Level | Name                 | Visible when                            | Mechanism                                 |
| ----- | -------------------- | --------------------------------------- | ----------------------------------------- |
| L0    | **Always**           | Every moment                            | Fixed on screen                           |
| L1    | **Contextual**       | A specific stage or selection is active | Appears/disappears automatically          |
| L2    | **One click**        | User asks                               | Popover, dropdown, chevron, "More"        |
| L3    | **Deliberate**       | User opts in                            | Settings, Advanced mode, "Details" panel  |
| L4    | **Keyboard / power** | Expert                                  | Command palette (`Cmd/Ctrl+K`), shortcuts |

Budget per level: **L0 <= 6 controls**, L1 <= 4 per context, L2 menus <= 7 items (group the rest).

## 3. First screen (Stage 0 / 1) — the "Whimsical" view

### 3.1 What is on screen, exactly

```
+----------------------------------------------------------------------------------+
| [<] Design a URL Shortener  v          (center empty)         [  > Run  ]  [ ... ] |  <- L0 header (3 items + title)
+----------------------------------------------------------------------------------+
|                                                                                    |
|  +--------------------------+                                                      |
|  | TASK                  [-]|   <- L0 question card (collapsible, top-left)        |
|  | Handle 5k req/s with     |                                                      |
|  | 99.9% availability.      |                                                      |
|  | [ Show full brief ]      |                                                      |
|  +--------------------------+                                                      |
|                                                                                    |
|  +----+                                                                            |
|  | V  |  select            .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  |
|  | +  |  add component    .                                                    .  |
|  | /  |  connect          .      (ghost hint)                                  .  |
|  | T  |  note/text        .      "Drag a Client onto the canvas to begin"      .  |
|  | .. |  more             .         [ Load starter diagram ]                    .  |
|  +----+                                                                            |
|                                                                                    |
|                                                         [undo][redo] [100%] [fit] [?]|  <- L0 bottom-right utility
+----------------------------------------------------------------------------------+
```

### 3.2 L0 inventory (the whole first screen)

| #   | Control                                                                                    | Where               | Replaces                                                                                |
| --- | ------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------- |
| 1   | Back (host only)                                                                           | header-left         | unchanged                                                                               |
| 2   | Question title (click = switch question / open task)                                       | header-left         | Branding + ModeBadge + FileStatus                                                       |
| 3   | **Workload** (secondary button, shows summary) + **Run** (single primary button, separate) | header-right        | whole SimulationControls cluster                                                        |
| 4   | `...` overflow menu                                                                        | header-right        | Open, Save, Auto Layout, TopologyJSON, Theme, Settings, Shortcuts, right-sidebar toggle |
| 5   | Question card (collapsible)                                                                | canvas top-left     | "Question Text" sidebar tab                                                             |
| 6   | Tool rail (Select, **Add**, Connect, Note, More)                                           | canvas left         | CanvasToolbar + library sidebar                                                         |
| 7   | Undo/Redo, Zoom, Fit, Help                                                                 | canvas bottom-right | Undo/Redo inside the rail                                                               |

Count: **7 groups**, ~12 clickable targets, and nothing else.

### 3.3 Moved out of L0 (and where each goes)

| Item                                                      | New home                                                                                 | Level   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| CostChip, DesignChecksChip                                | Appear **after first run** in the result summary; checks also in `...` > "Design checks" | L1      |
| ModeBadge                                                 | Folded into the title dropdown (shows Practice/Assignment inside it)                     | L2      |
| FileStatus (name, unsaved dot)                            | Tiny unsaved dot beside the title; name in `...` > File                                  | L2      |
| Open / Save / Auto Layout / TopologyJSON                  | `...` > **File** group                                                                   | L2      |
| ThemeToggle                                               | `...` > **View** group                                                                   | L2      |
| Left sidebar toggle                                       | Gone (no sidebar on first screen); library is a popover from **Add**                     | —       |
| Right sidebar toggle                                      | Gone; inspector opens on selection                                                       | —       |
| Blueprints, Labs, Scenarios tabs                          | `Add` popover > "Templates" tab, and `...` > "Scenarios"                                 | L2      |
| Symbol/Card toggle                                        | `...` > View > "Node style"                                                              | L3      |
| Annotation tools (Pen, Laser, Highlighter, Arrow, Eraser) | Rail `More` > **Annotate** (instructor/teaching only; hidden for learners)               | L2      |
| Reset topology, Delete selection                          | `More` > and right-click / `Del`                                                         | L2 / L4 |

## 4. Component library: from a flat list to a layered picker

Opened by the **Add** rail button (or `A`, or double-click the canvas). It is a popover, not a sidebar.

```
 Add component                                   [ search... ]
 +-----------------------------------------------------------+
 |  SUGGESTED FOR THIS QUESTION                              |   <- L1, from question's recommended set
 |   [Client] [Load Balancer] [Server] [Database] [Cache]    |
 |                                                           |
 |  Browse                                                   |   <- L2, collapsed categories
 |   > Traffic        (Client, DNS, CDN, API Gateway)        |
 |   > Compute        (Server, Worker, Function)             |
 |   > Data           (SQL, NoSQL, Cache, Object store)      |
 |   > Messaging      (Queue, Topic, Stream)                 |
 |   > Reliability    (Rate limiter, Circuit breaker)        |
 |                                                           |
 |  Templates   (Blueprints)        Custom definition...     |   <- L3
 +-----------------------------------------------------------+
```

Rules:

- Default shows **5–8** suggested nodes. If a question defines no recommended set, use the 6 most common.
- Categories are **collapsed**; at most one open at a time.
- Search is always focused on open. Typing bypasses categories entirely (L4).
- After the first placed node, the popover closes; **contextual add** (`ContextualAddPicker`, already
  in the codebase) offers "what usually connects next" from the selected node — this is the main way
  to grow a diagram.
- Node *display* is abstracted too: symbols by default (already done), properties hidden until selected.

## 5. Stage-by-stage: what is present when

### Stage 0 — Arrive (empty canvas)

```
 Header:  [title]                           [ > Run (disabled, hint: "add a component") ] [...]
 Canvas:  question card (open), tool rail, ghost hint, starter button
 Hidden:  inspector, results, library, everything in [...]
```

### Stage 1 — Build (>= 1 node)

```
 Header:  [title]                           [ > Run ]  [...]
 Canvas:  nodes (symbols) + tool rail; question card auto-collapses to a one-line chip
 On node select (L1) -> floating mini-bar above node + side inspector slides in:
```

```
            +-----------------------------+
            | [Duplicate] [Delete] [Link] |      <- floating mini-bar (L1, 3 actions)
            +--------------+--------------+
                           |
                       ( Server )

   Inspector (right, only on selection, 3 groups):
   +--------------------------+
   | Server                   |
   | Basics                   |   <- L1, 2–3 fields that matter (count, capacity)
   | > Behaviour              |   <- L2 collapsed
   | > Advanced               |   <- L3 collapsed (routing rules, queue weights, etc.)
   +--------------------------+
```

This maps to the existing `ClassroomInspector` sections: **Givens + Copies + Choices = Basics**,
**Guided controls = Behaviour**, **One level deeper = Advanced**. Ordering already exists; the change
is default-collapsed state and moving it behind selection.

### Stage 2 — Run

**Run and Workload are two separate controls.** Run is a plain button with no chevron and no attached
menu; it never opens anything. Workload is its own button next to it that opens its own popover.

```
 Header:   [ Workload v ]  [ > Run ]  [ ... ]
               |               |
               |               +-- click: runs immediately with the current workload
               +-- click: opens the Workload popover (does NOT run)
```

- **Run / Run again**: one action only. Uses the current workload, or the defaults derived from the
  question givens if the user never touched it. Becomes **Stop** while running.
- **Workload** (L2, popover): shows a one-line summary on the button itself
  (e.g. `Workload: 5k rps, steady, 60s`) so the user sees what Run will use without opening it.
  - Popover level 1: Source, Pattern, Base RPS, Duration.
  - "Advanced" accordion inside it (L3): burst/spike/ramp fields, warmup, stop-when, max requests, seed.
  - "Failure test" is a second section in the same popover (or its own `Failures` button if it gets
    heavy): Target, Mode, Fail at, Duration.
- While running: Run becomes **Stop**; **Pause / Step / Speed** appear (L1, only during a run).
  Workload is read-only (shown, not editable) until the run ends.
- Classroom mode: Workload shows the question's givens as read-only text (`compileClassroomRun` owns
  them); the button can be hidden if the question fixes the workload entirely.

### Stage 3 — Understand (post-run)

Tray stays **collapsed to a summary strip**. Detail is pulled, not pushed.

```
 Canvas (nodes now tinted by health; ONE legend chip)
 +----------------------------------------------------------------------------------+
 |  PASSED / NEEDS WORK   Served 4.8k/5k rps  Dropped 4%  p95 120ms   Cost $0.42/h    |  <- L1 summary strip
 |  Bottleneck: Database at 118% (target <= 80%)   -> [ Highlight ]  [ Try: add cache ]|
 |                                                       [ See details v ]  [ Run again ]|
 +----------------------------------------------------------------------------------+
```

Click **See details** -> tray expands (L3) with grouped tabs, not seven flat ones:

```
 Details  [ Summary ]  [ Components ]  [ Requests ]  [ Timeline ]
```

| New tab    | Folds in (today)          |
| ---------- | ------------------------- |
| Summary    | Overview, Bottlenecks     |
| Components | Node Metrics              |
| Requests   | Traces, Traffic, Failures |
| Timeline   | Event Log                 |

The request debugger / sequence diagrams stay at L3 behind "Requests". Charts inside a tab: show the
2 that matter (p95 latency, error rate) and put the rest under "More metrics".

Classroom mode reuses `ClassroomResultsCard` as the summary strip (it already is one); the big tray is
not rendered unless the user clicks **See details**.

### Stage 4 — Improve (loop back)

```
 Summary strip adds ONE suggestion chip (L1): "Try: add a cache in front of the DB" -> [Add it]
 "Run again" re-runs; delta vs previous run shown inline (+/- rps, +/- latency).
```

## 6. Header: before / after

```
BEFORE (16 items)
[<][Brand]|[Sb]|[Cost][Checks]|[Mode] | [file*] [Open][Save][Layout][JSON..] | [Run][Speed][Workload] | [Theme]|[Sb]

AFTER (4 items + title)
[<] <Question title v> *                                        [ Workload v ] [ > Run ]  [ ... ]
```

`...` menu, grouped (max 7 items per group visible, rest in submenus):

```
 File        Open...   Save   Import/Export JSON
 Canvas      Auto layout   Node style (Symbols/Cards)   Reset topology
 Checks      Design checks   Cost estimate
 View        Theme   Show inspector   Show results
 Learn       Scenarios   Concepts   Shortcuts (?)
 Settings...
```

## 7. Where each thing lives (summary matrix)

| Feature                   | S0             | S1        | S2                      | S3         | S4            | Entry point                               |
| ------------------------- | -------------- | --------- | ----------------------- | ---------- | ------------- | ----------------------------------------- |
| Question card             | open           | chip      | chip                    | chip       | chip          | canvas top-left                           |
| Tool rail (5)             | yes            | yes       | yes                     | yes        | yes           | canvas left                               |
| Add popover               | hint           | on `A`    | -                       | -          | -             | rail **Add**                              |
| Contextual add            | -              | on select | -                       | -          | on suggestion | node handle                               |
| Inspector (Basics)        | -              | on select | on select               | on select  | on select     | auto                                      |
| Inspector Advanced        | -              | collapsed | collapsed               | collapsed  | collapsed     | accordion                                 |
| Run                       | disabled       | enabled   | Stop                    | Run again  | Run again     | header                                    |
| Workload / failure test   | -              | button    | read-only while running | button     | button        | separate **Workload** button, left of Run |
| Pause/Step/Speed          | -              | -         | yes                     | -          | -             | during run only                           |
| Summary strip             | -              | -         | -                       | yes        | yes           | bottom                                    |
| Detail tray (4 tabs)      | -              | -         | -                       | on demand  | on demand     | "See details"                             |
| Cost / checks             | `...`          | `...`     | `...`                   | in summary | in summary    | menu / strip                              |
| File ops, theme, settings | `...`          | `...`     | `...`                   | `...`      | `...`         | `...`                                     |
| Annotations               | `...` (teach)  |           |                         |            |               | rail More                                 |
| Command palette           | `Cmd+K` always |           |                         |            |               | keyboard                                  |

## 8. Abstraction principles (beyond hiding)

1. **Name by intent, not by implementation.** "Add component", "Test failure", "See why", not
   "Topology JSON", "Edge routing", "Chaos experiment".
2. **Group, then hide.** A category with 12 children is one row until opened.
3. **Defaults carry the user.** Run without config; node properties pre-filled from question givens.
4. **Hide controls that cannot act yet.** No disabled-but-visible clutter (e.g. Pause before a run);
   only Run stays visible-disabled with a reason.
5. **One primary action per stage.** S0: add a node. S1: Run. S3: fix the bottleneck. Style it as the
   only filled button.
6. **Verdict before data.** Every results view opens on one sentence + one number.
7. **Progressive reveal of the *product*, too.** After the user's 3rd successful run, show a one-time
   hint for Workload/Failure tests ("Try breaking it"). Features are introduced when they become useful.
8. **Remember the user.** Persist the last open accordion/tab state; experts who open Advanced once
   keep it open (per-user preference, L3 "Always show advanced").
9. **Never remove, only relocate.** Everything stays reachable via `Cmd+K` search, so power users lose
   nothing.

## 9. Command palette (L4 safety net)

`Cmd/Ctrl+K` lists every action by plain name: "Open file", "Auto layout", "Add cache", "Run with
failure test", "Show request traces", "Toggle theme". This is what makes aggressive hiding safe.

## 10. Implementation map (for later)

| Change                                                                                                           | Files                                                                                                                                             | Size |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Slim header (title, Run, `...`)                                                                                  | `layout/Header.tsx`, new `layout/HeaderMenu.tsx`, `simulation/SimulationControls.tsx`                                                             | M    |
| Separate Run button and Workload button + popover (tray content moves into the popover, extras under "Advanced") | `simulation/SimulationControls.tsx` split into `RunButton` and `WorkloadPopover`                                                                  | M    |
| Library -> Add popover, suggested set                                                                            | `library/LibrarySidebar.tsx`, `ComponentLibrarySidebarPanel.tsx`, `engine/catalog/paletteTemplates.ts`, question schema (`recommendedComponents`) | L    |
| Question card replaces sidebar tab                                                                               | new `question/QuestionCard.tsx`, `WorkspaceLayout.tsx`                                                                                            | M    |
| Rail trimmed to 5 + More                                                                                         | `canvas/CanvasToolbar.tsx`                                                                                                                        | S    |
| Empty-state ghost hint + starter                                                                                 | `canvas/FlowCanvas.tsx`                                                                                                                           | S    |
| Inspector on-selection, accordions collapsed                                                                     | `properties/PropertiesPanel.tsx`, `ClassroomInspector.tsx`                                                                                        | M    |
| Summary strip + 4-tab details                                                                                    | `simulation/ResultsTray.tsx` (7 -> 4 tabs), `ClassroomResultsCard.tsx`                                                                            | L    |
| Command palette                                                                                                  | new `layout/CommandPalette.tsx`                                                                                                                   | M    |

Suggested order: **(1) results summary strip, (2) header, (3) Add popover, (4) question card,
(5) inspector, (6) empty state, (7) command palette.** Each is independently shippable behind a flag
(e.g. `simpleShell`), defaulting on for Classroom mode and off for Author mode, so authors keep the
dense UI.

## 11. How we will know it worked

- First-screen interactive targets: **~40 -> <= 12**.
- Time to first placed node (target < 20 s); time to first run (target < 90 s).
- % of sessions that reach a run; % that open "See details" (should be a minority, not zero).
- Qualitative: repeat the same first-impression test that produced the "daunting" feedback.

## 12. Open questions

1. Should Author mode keep the full dense UI, or get the same shell with authoring panels added at L2?
2. Are Blueprints/Labs/Scenarios learner-facing in Classroom, or instructor-only?
3. Can questions declare a `recommendedComponents` list (needed for the suggested set)?
4. Is a persistent right inspector acceptable, or should it be a floating card anchored to the node?
