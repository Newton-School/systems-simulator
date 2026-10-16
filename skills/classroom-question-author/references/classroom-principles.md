# Classroom Principles

Every editable decision must point to an objective. Every other fact is shown as
a given and rebuilt by the grader. Grade the concept in the language used to
teach it, and prefer a structural-only claim over a fabricated runtime proxy.

Classroom currently supports visible topology, copies, stated capacity, generic
throughput/utilization/headroom, and registered passthrough cards. A card's
presence does not imply advanced behavior: Queue does not prove delivery or drain
time; Cache does not prove a hit ratio; Database does not prove replication or
consistency; CDN does not prove geographic latency. Use Architect mode until a
dedicated Classroom control and check exist.

Caching is the sharpest case. Placing a Cache on the read path is a structural
claim (`CACHE-01`). Hit-rate arithmetic ("90% hits, so the database sees 10%") is
not: the simulator doesn't yet reproduce the napkin answer, so `CACHE-10` routes to
Guided and Classroom has no hit-rate check. A cache-on/off named choice is allowed
only when the question states that component's `cacheHitRate` as a given; without
one, Studio export, readiness and the grader all refuse the question instead of
assuming a default rate.

Every taxonomy concept carries a generated authoring recipe. It is the default
routing contract for a new question: activity, honest environment, required
givens, recommended cards, allowed student decisions, compatible checks, and the
claim boundary. A Classroom recipe may generate one starter objective, one
decision, and one scored check, but it never invents source traffic or component
capacity. Concepts without honest Classroom evidence must route to Guided,
Architect, or an external lab.
