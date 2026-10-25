# 17. DevOps and delivery

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 7 `DevopsType`s: `artifact-repository`, `build-system`, `feature-flag-service`, `deployment-controller`,
`chaos-engineering-framework`, `policy-as-code`, `pipeline-secrets`. Fault injection mechanics are chapter 22;
CI/CD runners as queues are chapter 14.

## 1. What delivery changes

Every release is a controlled change to a running system. The delivery strategy decides how much of the fleet
sees the change at once (the **blast radius**), how fast a bad change is noticed, and how fast it is undone. [D]

Expected harm from a bad release = share of traffic exposed x request rate x time until rollback. [D]

## 2. Deployment strategies

| Strategy       | Mechanism                                                          | Extra capacity                 | Rollback                          | Risk                                                                           |
| -------------- | ------------------------------------------------------------------ | ------------------------------ | --------------------------------- | ------------------------------------------------------------------------------ |
| **Recreate**   | stop all old, start all new                                        | none                           | redeploy old                      | downtime during the gap                                                        |
| **Rolling**    | replace instances gradually                                        | surge pods                     | roll forward or back, gradually   | mixed versions run together; capacity dips if unavailable > 0                  |
| **Blue-green** | a full second environment; the router switches all traffic at once | a **whole second environment** | switch the router back, instantly | everyone is exposed at the cut-over; transactions made meanwhile need handling |
| **Canary**     | send a small share to the new version, then widen                  | a small number of instances    | route the share back              | needs good metrics to decide                                                   |

- **Blue-green** (Fowler): two near-identical environments, one live and one for testing the next release; after testing the router sends all traffic to the new one and the old one idles; rollback is switching back. Separate schema changes from application releases so one database works with both versions. [S: martinfowler.com]
- **Canary** (Fowler): deploy to infrastructure with no traffic, route a small set of users, then add servers and users gradually until everyone is on the new version; roll back by rerouting. A router picks the users: random sample, employees first, or by geography. [S: martinfowler.com]
- **Rolling update** (Kubernetes Deployment): `maxSurge` and `maxUnavailable` default to **25%**; surge rounds **up** and unavailable rounds **down**. With 3 replicas: surge 1, unavailable 0, so there are always at least 3 ready and at most 4 running. [P: Kubernetes Deployment docs: maxSurge defaults to 25% rounded up, maxUnavailable to 25% rounded down]

Rolling worked example: 10 replicas, surge 25% (3), unavailable 25% (2): capacity never falls below **8 of 10**; each wave replaces up to about 5 pods and waits for readiness, so rollout time is roughly waves x (start-up + readiness delay). [computed]

**Blue-green cost:** 2x the steady-state instances while both exist; hours of overlap multiply the instance bill by the overlap fraction. [D]

## 3. Canary arithmetic

- Canary at weight w of R requests/s receives w x R. At 5% of 1,000 req/s that is **50 req/s**. [computed]
- Bad requests until rollback = w x R x t. A canary that fails everything for 60 s at 5% and 1,000 req/s causes **3,000** failed requests, against 60,000 for an all-at-once release. [computed]
- **How long to detect a regression.** To tell an error rate p1 from p2 with about 80% power at 5% significance, each arm needs roughly n = 16 x p(1 - p) / delta^2 requests, with p the mean rate and delta the difference. Detecting 1% vs 2% (p = 1.5%, delta = 1%): n = 16 x 0.015 x 0.985 / 0.0001 = **about 2,400** canary requests, so **47 s** at 50 req/s. A latency regression needs more samples because latency is noisy. [D: Lehr's approximation for 80% power at a two-sided 5% level; computed]
- A canary that is too small (w very low) or too short never collects enough data; one that is too large exposes too many. [D from the two formulas above]
- Promotion needs automatic checks on the golden signals (chapter 16) compared with the baseline, not just "no crashes". [S: Google SRE workbook, canarying releases]

## 4. Feature flags

A flag separates **deploy** from **release**: code ships dark and is turned on for a share of users. [S: Fowler, feature toggles]

- **Evaluation** is local (an in-memory rule check, microseconds) when the SDK streams rules from the flag service; it is a **remote call per request** if the service is queried synchronously. [D]
- **Percentage rollouts** hash a stable user id into a bucket, so a user keeps the same experience as the percentage rises. [D]
- **Failure:** if the flag service is down, clients use cached rules or a hard-coded default; a default of "on" for a risky feature is a latent incident. [D]
- Flags make rollback seconds, not minutes, but accumulate as debt if not removed. [D]

## 5. Build, artifacts, policy and secrets

| Component           | Behaviour                                                 | What to model                                                                                      |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Build system        | runs jobs on runners                                      | a queue; wall time shortened by parallel steps only up to the serial fraction (Amdahl, chapter 06) |
| Artifact repository | stores build outputs and images                           | download time in deploys; an outage blocks releases but not running traffic                        |
| Policy as code      | checks changes against rules before apply or at admission | a latency cost at admission; a wrong rule blocks all deploys                                       |
| Pipeline secrets    | credentials the pipeline uses                             | leak risk; rotation (chapter 15)                                                                   |

## 6. Chaos engineering

Run experiments to find weaknesses before they find you. The method: define a **steady state** metric, hypothesise it holds under a fault, inject a realistic fault with a **limited blast radius** and an **abort condition**, then compare. Typical faults: kill an instance, add latency, drop dependency calls, fail a zone. [P: Principles of Chaos Engineering]

The simulator's fault list is the same set (chapter 22), so a chaos experiment is a topology plus a fault and a pass/fail check on the steady-state metric.

## 7. Failure modes

- **Bad release at 100% exposure:** error rate jumps at once; recovery time equals rollback time.
- **Canary without comparison:** a regression that is small relative to noise is promoted.
- **Mixed versions:** during a rolling update both versions serve; incompatible schema or API changes break one of them.
- **Capacity dip:** `maxUnavailable` too high lowers capacity during a rollout and overloads the rest.
- **Stuck rollout:** new pods never become ready, so the rollout halts with a reduced fleet.

## 8. Simulator scope

The delivery components are mostly modelled as nodes on the path (latency, capacity, failure) and as scenarios using faults and instance counts. A rollout over time, percentage routing between two versions and an automatic promotion decision are expressed with routing weights and scheduled faults. [?] Owner to confirm what a "deployment controller" node should simulate by itself.

## 9. Testable expectations (summary)

- Failed requests during a bad canary = weight x rate x detection-to-rollback time.
- Blue-green needs double the instances while both are live.
- During a rolling update capacity is never below replicas - maxUnavailable.
- Detection time of a canary regression falls as canary weight rises (more samples per second).
- A flag evaluated remotely adds its latency to each request; a local flag does not.

## 10. Open items

- Not read directly: Argo Rollouts and Flagger analysis, and the DORA metrics. The chaos-experiment steps follow the Principles of Chaos Engineering (define steady state, hypothesise, introduce real-world variables, try to disprove).
- Decisions `[?]`: what the deployment-controller and feature-flag nodes should do inside the engine beyond routing.

## Sources

- [Deployments, Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) [P]
- [Principles of Chaos Engineering](https://principlesofchaos.org/) [P]

- [BlueGreenDeployment, Martin Fowler](https://martinfowler.com/bliki/BlueGreenDeployment.html) [S]
- [CanaryRelease, Martin Fowler](https://martinfowler.com/bliki/CanaryRelease.html) [S]
- [Deployments, Kubernetes](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) [P]
