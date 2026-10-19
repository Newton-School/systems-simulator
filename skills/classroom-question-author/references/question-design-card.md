# Question Design Card

Read this before anything else. It is the way of thinking; the
[objective worksheet](objective-worksheet.md) is where you write the answers down.

## The idea

A question is not a diagram for students to draw. It is **proof that a student learned
one idea**. Design it backwards, from what the student should be able to do to what they
touch on screen:

```
Idea → "The student can…" → the decision that shows it → the evidence that proves it → the wrong answer it must catch
```

## Sort every number and knob into one of three buckets

| Bucket                                | Test                                          | QuickCart example                           |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| **Decision** (the student changes it) | Does changing it _teach_ the idea?            | Placing the load balancer; how many servers |
| **Given** (stated, fixed, visible)    | Does the student _need to know_ it to decide? | 1M req/s peak, 100k req/s per server, 80%   |
| **Hidden** (the simulator handles it) | Neither                                       | Instance type, service time, edge latency   |

Most broken questions put something in the wrong bucket: a given turned into a decision
(tuning instance types to reach 100k req/s), or a decision with no idea behind it.

## Ask six questions, in order

1. **What should the student be able to do afterwards?** One sentence starting "The
   student can…". If you can't write it, you have a topic, not a question.
2. **Which decision shows it?** Classroom offers three kinds: _place_ a component,
   _connect_ components, _choose a count or named option_. If the idea isn't one of
   these, it isn't a Classroom build exercise.
3. **What must they know to decide?** Those are the givens, and every one that decides
   pass or fail appears as a number in the prompt.
4. **How would you know they got it?** One or two checks per objective, each visible:
   the path goes through X, nothing is dropped, everything stays under the target. A
   check that proves no stated objective is removed.
5. **What is the most likely wrong answer, and does it fail for the right reason?**
   QuickCart: 12 servers (forgot the 80% rule) fails on headroom only, with a message
   naming that mistake. If the wrong answer passes, or fails for an unrelated reason,
   the question is broken.
6. **Can napkin math predict the right answer, using only what the Classroom model
   honestly simulates?** If yes, it's a Classroom question. If the result depends on
   engine behaviour, route it elsewhere (below).

## Route the question honestly

These match the `authoring.outcome` values in the concept registry.

| The lesson is…                                                                   | Outcome                | Example                                         |
| -------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------- |
| Structure plus counts, and arithmetic on stated capacity predicts the result     | `classroom-direct`     | Size a server fleet to 80% headroom             |
| Where components go and what connects to what; no runtime claim                  | `classroom-structural` | Put a queue between the API and its workers     |
| Classroom plus one or two real settings, each tied to an objective               | `guided`               | Choosing instance sizes when cost is the lesson |
| The simulator's behaviour itself (replication, quorum, retries, failover timing) | `architect-handoff`    | Leader failover under load                      |
| Comparing, explaining or classifying, not building                               | `external-lab`         | CAP trade-offs                                  |

A card's presence is not a claim. A Queue on the canvas does not prove delivery or drain
time; a Cache does not prove a hit ratio (cache placement is `CACHE-01`, Classroom;
hit-rate arithmetic is `CACHE-10`, Guided); a Database does not prove replication or
consistency (see [classroom principles](classroom-principles.md)). Never manufacture
evidence for behaviour the Classroom model doesn't implement.

## Two tests before you publish

- **Could a student fail without misunderstanding the idea?** Something hidden is
  leaking. Make it a given or switch it off.
- **Could a student pass without understanding the idea?** The evidence is too weak.
  Add a check, or a wrong design that must fail.

## Worked examples

**QuickCart (`classroom-direct`).**

1. The student can size a server fleet to an 80% utilization budget.
2. Decisions: place Users → Load Balancer → Server; choose the Server copy count.
3. Givens: 1,000,000 req/s peak; 100,000 req/s per server; keep each server ≤ 80%.
4. Evidence: traffic goes through the load balancer; nothing dropped; every server
   ≤ 80%.
5. Wrong answer: 12 servers (83.3%) fails headroom only → "Planned to 100%, not 80%".
6. Napkin: 1,000,000 ÷ (0.8 × 100,000) = 12.5 → 13. Arithmetic on stated capacity.

**Order processing with a queue (`classroom-structural`).**

1. The student can decouple order intake from slow processing with a queue.
2. Decisions: place Users → Server → Queue → Worker and connect them.
3. Givens: the prompt says processing is slow and must not block order intake.
4. Evidence: order traffic reaches the Worker through the Queue.
5. Wrong answer: the Server calls the Worker directly → the path check fails, with a
   message about blocking on slow work.
6. Napkin: none needed. This is a placement claim, so don't grade drain time or
   backlog; Classroom doesn't simulate them honestly.

**Strong versus eventual consistency (route out).** No count or placement decision
reveals understanding, and the outcome depends on replication behaviour. Use an
explanation exercise (`external-lab`) or an Architect question with replicas and
faults, not a Classroom diagram.

## Then

Fill in the [objective worksheet](objective-worksheet.md), look up the concept's
recipe in the [concept registry](system-design-concepts.md), and pick cards and
checks from the [card](concept-cards.md) and [check](classroom-checks.md) catalogs.
