# 14. Orchestration and infrastructure

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 13 `OrchestrationType`s: `kubernetes-cluster`, `container-registry`, `service-registry`, `tool-registry`,
`config-store`, `secrets-manager`, `cluster-autoscaler`, `agent-orchestrator`, `orchestrator-scheduler`,
`ci-cd-runner`, `iac-engine`, `container-runtime`, `provisioner`. Horizontal scaling of one service
(autoscaler) lives here too; per-instance capacity is chapter 06.

## 1. What an orchestrator does

An orchestrator keeps a **desired state** (N replicas of a workload, each needing some CPU and memory) true on a
fleet of machines. It is a set of control loops: observe, compare with the desired state, act. Every loop has a
**period** and a **reaction lag**, so a response to a load change is never instant. [D]

## 2. Horizontal autoscaling (HPA)

The Kubernetes Horizontal Pod Autoscaler computes the replica count from the ratio of the observed metric to its target: [P: Kubernetes HPA docs]

**desiredReplicas = ceil( currentReplicas x currentMetricValue / desiredMetricValue )**

- **Sync period:** the controller runs every **15 s** by default. [P]
- **Tolerance:** if the ratio is within **10%** of 1.0 (0.9 to 1.1), nothing happens. [P]
- **Stabilization window:** scale-down looks back **300 s** and takes the highest recommendation, so a brief dip does not remove capacity; scale-up has **0 s**. [P]
- **Default rate policies:** scale-up may add the larger of **100% of current replicas or 4 pods every 15 s**; scale-down may remove **100% per 15 s** (held back by the 300 s window). [P]
- **Missing or not-ready pods:** when scaling up they are assumed to use **0%** of the target, when scaling down **100%**, which damps the decision. A just-started pod is ignored for CPU for 30 s (initial readiness delay) and 5 min (CPU initialisation period). [P]
- Utilization is measured against the pod's **resource request**, not the node. [P]

Worked: 4 replicas at 90% against a 70% target: ceil(4 x 90 / 70) = ceil(5.14) = **6**. 10 replicas at 30%: ceil(10 x 30 / 70) = **5**, but only after the 300 s window agrees. 4 replicas at 76%: ratio 1.086, inside tolerance, **no change**. [computed]

Time to scale out from 2 replicas to over 100 at the default policy: each step adds max(current, 4): 2 to 6 to 12 to 24 to 48 to 96 to 192, **6 steps = 90 s** of controller time, plus pod start-up and readiness for each wave. A spike faster than that overloads the service in the meantime. [computed]

**Why autoscalers oscillate:** a lag in the loop plus a metric that responds to the action (more replicas lowers utilization) gives overshoot; the stabilization window and tolerance are the damping. [D]

## 3. Cluster autoscaling and node provisioning

The Cluster Autoscaler adds nodes when pods are **unschedulable** and removes nodes that are under-used. [P: autoscaler FAQ]

- Scan interval **10 s**. Scale-up simulates a template node to see whether it would let the pending pods run. [P]
- A node is a scale-down candidate when its requested CPU and memory are under **50%** of allocatable (`--scale-down-utilization-threshold`, default 0.5) and every pod on it can move; it is removed after being unneeded for **10 minutes**. [P]
- A new node is expected within **15 minutes** (`--max-node-provision-time`); on GCE it usually takes **3 to 4 minutes** until pods can schedule, about 5 minutes end to end. [P]

So a traffic spike that needs new machines is served by the existing fleet for several minutes: the burst must be absorbed by headroom, queues or shedding, not by scaling. Scale-down is slow on purpose (10 minutes) to avoid flapping. [D from the two bullets above]

## 4. Scheduling and bin packing

The scheduler places a pod only on a node with enough free **CPU and memory** (and satisfying constraints). A pod that fits nowhere stays **Pending** and adds no capacity. [P]

- **Scoring strategies:** `LeastAllocated` spreads load across nodes; `MostAllocated` prefers highly utilized nodes (packs, helping scale-down of idle nodes); `RequestedToCapacityRatio` applies a configurable shape. Per-resource utilization is requested x 100 / capacity; the node score is the weighted average sum(score_i x weight_i) / sum(weight_i). [P: Kubernetes bin-packing docs]
- **Fragmentation:** pods of 3 vCPU on 8 vCPU nodes fit **2 per node**, stranding 2 vCPU (25%). 10 such pods need **5 nodes**, not the 3.75 that the sums suggest. 3 nodes of 4 vCPU hold only three 3-vCPU pods, not four. [computed]
- **Packing vs spreading:** packing needs fewer nodes (cost, scale-down) but concentrates pods, so one node failure takes a larger share of a workload; spreading across nodes and zones costs capacity but limits blast radius. [D]
- Optimal bin packing is NP-hard; first-fit-decreasing uses at most 11/9 of the optimum plus 6/9 of a bin. [S: Wikipedia, Bin packing problem, citing Dósa 2007]

## 5. Node failure and recovery

A node that stops reporting is marked **NotReady** after the node-monitor grace period (**50 s** in the current `kube-controller-manager` reference, 40 s in older releases), and its pods are evicted when their default not-ready toleration (**300 s**) runs out, so replacement pods start only after about **350 s** (340 s with the older 40 s grace period; the simulator's default is 350 s); then each needs scheduling room, an image pull and start-up. [P: Kubernetes kube-controller-manager reference, `--node-monitor-grace-period` default 50 s; Kubernetes taints docs, automatic `tolerationSeconds=300` for not-ready and unreachable]

During the 50 s before NotReady the dead pods still sit in service endpoints, so a share of requests equal to (pods on the failed node / ready pods) errors out. A workload with all replicas on one node is down for the whole 350 s plus start-up. [D]

**Image pull:** time = image size / bandwidth: 500 MB at 1 Gbps (125 MB/s) is 4 s; layers cached on the node cost nothing. A new node pulls every image cold. [D]

## 6. The rest of the control plane

| Component                         | What it does                         | What it costs the request path                                                                                                                         |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container registry                | stores images; serves pulls          | nothing at request time; adds to pod start-up (pull time); an outage blocks scale-out and replacement but not running pods                             |
| Service registry                  | lookup of healthy instances          | a stale entry sends traffic to a dead instance until its TTL or health check expires                                                                   |
| Config store, secrets manager     | serve configuration and secrets      | read at start-up or refreshed on an interval; if read per request, it is a dependency with its own latency and availability                            |
| CI/CD runner                      | executes builds and deploys          | a queue: builds arrive at rate lambda, each takes a runner for service time s; M/M/c applies (chapter 01)                                              |
| IaC engine, provisioner           | create machines and resources        | provisioning latency (minutes; the simulator's `machineProvisionMs` default is 90 s; managed-service times are provider-specific and not asserted) [D] |
| Agent orchestrator, tool registry | route work among AI agents and tools | chapter 18                                                                                                                                             |

CI runner example: builds at 6 per hour, 10 minutes each, 2 runners: offered load a = 1 Erlang, utilization 0.5, Erlang C = 1/3, mean wait = C / (c x mu - lambda) = (1/3) / (12 - 6 per hour) = **3.3 minutes**. [computed]

## 7. Failure modes

- **Pending pods:** not enough room (fragmentation, node limit reached): the scale-up asked for does not happen. Visible as desired replicas above ready replicas.
- **Autoscaler lag:** metric window plus sync period plus pod start-up: the service runs hot for minutes after a step in load.
- **Flapping:** scale-down too eager; fixed by the stabilization window.
- **Thundering start-up:** many replicas starting together all pull images and warm caches at once (chapter 10).
- **Cascading eviction:** a node under memory pressure evicts pods, which land on other nodes and push them over.

## 8. Simulator parameter map

| Setting                                                            | Meaning                                        | Real counterpart              |
| ------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------- |
| `autoscaleMinInstances`, `autoscaleMaxInstances`                   | bounds on instance count; max enables the loop | HPA minReplicas / maxReplicas |
| `autoscaleTargetUtilization` (0.7)                                 | target utilization                             | HPA target                    |
| `autoscaleCooldownMs` (5000)                                       | loop period                                    | sync period (15 s)            |
| `autoscaleStep` (1)                                                | instances added or removed per tick            | HPA rate policy               |
| `autoscalePolicy` (`step`), `autoscaleScaleDownWindowMs` (300000)  | `step` or `hpa`; the HPA scale-down window     | HPA rule and stabilization    |
| `placementStrategy`                                                | `spread` or `bin-pack`                         | scheduler scoring             |
| `podStartupMs` (5000)                                              | time from placement to ready                   | image pull + start            |
| `rescheduleDelayMs` (350000)                                       | failure detection + eviction                   | 50 s + 300 s                  |
| `clusterMaxMachines`, `machineProvisionMs` (90000)                 | node limit, boot time                          | Cluster Autoscaler            |
| `machineFailureAtMs`, `machineFailureCount`, `machineRecoveryAtMs` | scripted machine loss                          | node failure                  |
| `scheduledOn`                                                      | the cluster a workload is placed on            | namespace / node pool         |

The simulator's autoscaler adds or removes `autoscaleStep` instances per tick toward the target band (scale up above the target, scale down below half of it) rather than computing the proportional formula, so it converges linearly, not in one calculation. [repo]

## 9. Testable expectations (summary)

- Proportional rule: replicas needed = ceil(load / (target utilization x capacity per replica)); a controller at that count sits at or just under the target.
- Inside the tolerance band no scaling; scale-down is slower than scale-up.
- Capacity follows demand with a lag of at least one period plus start-up; a faster spike than the lag overloads the service.
- A pod that fits on no node adds no capacity; fragmentation makes cluster capacity lower than the arithmetic sum.
- A machine failure removes its pods at once and replacements arrive after detection plus start-up; recovery time is at least the detection delay.
- Bin-packing uses fewer machines than spreading for the same workload; a machine loss under bin-packing removes a larger share.
- Node provisioning time delays scale-up for a cluster that must grow.

## 10. Open items

- Cluster Autoscaler provisioning figures for clouds other than GCE are not asserted.
- Decided and implemented: `autoscalePolicy: 'hpa'` follows the proportional rule with a 10% tolerance, a rate-limited scale-up and a 300 s scale-down window (`autoscaleScaleDownWindowMs`), with a 15 s sync period by default. The step autoscaler stays the default, so existing designs are unchanged.

## Sources

- [Horizontal Pod Autoscaling, Kubernetes](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) [P]
- [Resource bin packing, Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/resource-bin-packing/) [P]
- [Taints and tolerations, Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) [P]
- [Cluster Autoscaler FAQ](https://github.com/kubernetes/autoscaler/blob/master/cluster-autoscaler/FAQ.md) [P]
- [kube-controller-manager reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/) [P]
