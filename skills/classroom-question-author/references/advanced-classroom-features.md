# Advanced Classroom features

Use these only when the objective worksheet justifies them.

## Predictions

Add `classroom.predictions` for a predict–observe–explain activity. Number and
choice answers are completion-only and never scored. A reveal can name a
`copiesOf` component so the learner sees predicted versus built after the first
run.

## Presenter scripts

Add `classroom.lecture.dials` for authored traffic, given, or target values and
`steps` for deterministic `ClassroomDesignSketch` designs. Keep 2–4 steps, make
each talking point explain one transition, and ensure every component is in the
allowed card kit.

## Named choices

Use `classroom.choices[component]` for conceptual options such as routing,
cache-on/off, or sync/async. Every choice needs an `objectiveId`, a short label,
and a one-sentence explanation per option. Do not expose a raw engine enum.

## Fixed latency givens

`latencyMs` is an unloaded fixed delay placed before the capacity-only queue.
This keeps capacity and latency from over-determining one queue. State it in the
prompt and lecture sheet. Do not claim it models geographic or tail variability.

## Architect bridge

`classroom.hardware[component]` describes a representative real setup for the
read-only hardware peek. Treat it as explanatory, not proof that a cloud SKU
guarantees the authored capacity. Practice launches may open the same canvas in
Architect mode; Assignment launches never expose the bridge.

## Guided controls

Use `abstractions: ["guided", "architect"]` and `guidedKnobs` only when a second
pass intentionally unlocks a real node path. Every knob must name an objective.
All other config remains canonicalized from givens.

## Cohort insight boundary

Each submitted host payload carries `classroomInsights` with matched
misconception IDs and prediction answers. The LMS or course host owns cohorts,
rosters, retention, and aggregation. The simulator supplies a deterministic
aggregate reducer as a reference; it does not become an LMS.
