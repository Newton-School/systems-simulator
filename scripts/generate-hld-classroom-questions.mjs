#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type -- standalone artifact generator */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const questionModule = await import('../src/engine/analysis/question.ts')
const verificationModule = await import('../src/engine/analysis/questionAuthoringVerification.ts')
const parseQuestionPackage =
  questionModule.parseQuestionPackage ?? questionModule.default?.parseQuestionPackage
const runQuestionAuthoringVerification =
  verificationModule.runQuestionAuthoringVerification ??
  verificationModule.default?.runQuestionAuthoringVerification

const root = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(root, 'output/hld-questions')
const outputRoot = resolve(root, 'output/hld-classroom-questions')

const questions = [
  {
    directory: '01-load-balancer-and-queue',
    slug: 'food-delivery-load-balancer-and-queue',
    outcome: 'classroom-structural',
    classroom: {
      abstractions: ['classroom', 'architect'],
      givens: {
        microservice: { label: 'Application Server', capacityRps: 100 },
        'batch-worker': { label: 'Order Worker', capacityRps: 50 }
      },
      objectives: [
        {
          id: 'horizontal-entry',
          statement:
            'The student can place a load balancer before horizontally scaled application servers.',
          concept: 'load-balancing'
        },
        {
          id: 'async-boundary',
          statement:
            'The student can explain why a queue separates request acceptance from background order processing.',
          concept: 'asynchronous-processing'
        }
      ],
      checks: [
        {
          id: 'through-load-balancer',
          template: 'traffic-flows-through',
          via: 'load-balancer',
          component: 'microservice',
          label: 'User traffic reaches application servers through the load balancer',
          objectiveId: 'horizontal-entry',
          points: 1
        }
      ],
      misconceptions: [
        {
          id: 'servers-without-balancer',
          title: 'Servers without a traffic distributor',
          message:
            'Multiple servers do not provide horizontal scaling unless incoming traffic reaches them through a distributor.',
          nudge: 'Place a Load Balancer between Users and the Application Server tier.',
          priority: 1,
          objectiveId: 'horizontal-entry',
          detect: { kind: 'check-failed', checkId: 'through-load-balancer' },
          probe: {
            nodes: [
              { ref: 'users', component: 'api-endpoint' },
              { ref: 'server', component: 'microservice', copies: 2 }
            ],
            edges: [['users', 'server']]
          }
        }
      ],
      predictions: [
        {
          id: 'where-balancer-goes',
          question: 'Where should the load balancer sit relative to Users and Application Servers?',
          answer: {
            kind: 'choice',
            options: ['Before the application servers', 'After the order worker']
          }
        }
      ],
      lecture: {
        steps: [
          {
            id: 'direct-server',
            title: 'Start with one direct server path',
            talkingPoint:
              'A second server is not useful until traffic has a component that can distribute requests.',
            design: {
              nodes: [
                { ref: 'users', component: 'api-endpoint' },
                { ref: 'server', component: 'microservice' }
              ],
              edges: [['users', 'server']]
            }
          },
          {
            id: 'balanced-and-buffered',
            title: 'Add distribution and the asynchronous boundary',
            talkingPoint:
              'The load balancer enables horizontal application capacity; the queue marks where accepted work can wait for a worker.',
            design: {
              nodes: [
                { ref: 'users', component: 'api-endpoint' },
                { ref: 'balancer', component: 'load-balancer' },
                { ref: 'server', component: 'microservice', copies: 2 },
                { ref: 'queue', component: 'queue' },
                { ref: 'worker', component: 'batch-worker' }
              ],
              edges: [
                ['users', 'balancer'],
                ['balancer', 'server'],
                ['server', 'queue'],
                ['queue', 'worker']
              ]
            }
          }
        ]
      },
      hardware: {
        microservice: {
          instanceType: 'Representative stateless service tier',
          description:
            'The 100 req/s Classroom capacity is an authored teaching given, not a cloud-instance guarantee.'
        }
      }
    },
    promptAddition:
      'Classroom teaching givens: the public practice run offers 2 requests per second; each Application Server is modeled at 100 requests per second and each Order Worker at 50 requests per second. These locked values keep this activity focused on architecture placement, not machine tuning.',
    coverage: {
      dominantLesson:
        'Use a load balancer to make a horizontally scaled application tier reachable, then identify the queue as the asynchronous handoff.',
      limitations: [
        'The Classroom queue card proves visible placement only; it does not prove durable storage, backlog drain time, or waiting for delivery-partner availability.',
        'Those runtime guarantees remain in the Architect package and lecture discussion.'
      ]
    },
    lecture: `# Food Delivery Load Balancer and Queue - Lecture Sheet

Question ID: \`food-delivery-load-balancer-and-queue\`

## Classroom outcome

**Classroom-structural, with an Architect handoff.** Classroom grades the load balancer's position. The queue remains visible and discussable, but durable no-loss behavior and waiting for delivery-partner availability require the full Architect model.

## Learning objectives

- The student can place a load balancer before horizontally scaled application servers.
- The student can explain why a queue separates request acceptance from background processing.
- The student can identify which claims require an Architect experiment instead of a topology-only Classroom check.

## Givens

| Component | Locked teaching given |
| --- | --- |
| Public practice traffic | 2 requests per second |
| Application Server | 100 requests per second per copy |
| Order Worker | 50 requests per second per copy |

These numeric values are author-supplied simulator givens for the structural activity; the PDF states only "millions of order requests every day."

## Napkin model

The visible request path is: **Users -> Load Balancer -> Application Servers -> Queue -> Order Worker**.

The load balancer is what makes multiple application-server copies reachable. The queue is the handoff boundary where accepted work can wait. Classroom does not claim that merely drawing a Queue proves durability or delivery-partner availability semantics.

## Answer key

| Design | Result | Why |
| --- | --- | --- |
| Users -> Application Servers | Fail | There is no traffic distributor before the scaled tier. |
| Users -> Load Balancer -> Application Servers | Pass the scored Classroom check | The horizontal application tier is reached through the load balancer. |
| Add Queue -> Order Worker after the servers | Preferred teaching design | It exposes the asynchronous boundary, but durable retention is verified only in Architect mode. |

## Expected wrong answers

| Wrong design | What it means | What to say |
| --- | --- | --- |
| Multiple servers without a load balancer | Copies were mistaken for usable horizontal scaling | "Which component makes incoming traffic reach all those server copies?" |
| Queue alone is claimed to prevent all loss | A component label was mistaken for a runtime guarantee | "What happens when the queue fills or its consumer is unavailable, and where is that modeled?" |
| Worker is placed on the synchronous user path | Background processing was not separated | "Where should the user-visible request stop waiting?" |

## Lecture steps

1. Ask learners to predict whether adding a second direct server changes traffic distribution.
2. Run the missing-balancer probe and discuss why it fails.
3. Add the Load Balancer, then add Queue and Order Worker as the visible asynchronous boundary.
4. Open the same design in Architect mode to discuss queue capacity, durability, backlog, and delivery-partner unavailability.
`
  },
  {
    directory: '02-api-gateway',
    slug: 'food-delivery-api-gateway',
    outcome: 'classroom-structural',
    classroom: {
      abstractions: ['classroom', 'architect'],
      givens: {
        microservice: { label: 'Backend Service', capacityRps: 100 },
        'batch-worker': { label: 'Order Worker', capacityRps: 50 }
      },
      objectives: [
        {
          id: 'single-entry',
          statement:
            'The student can route every client request through one API Gateway before backend services.',
          concept: 'api-gateway'
        },
        {
          id: 'gateway-responsibilities',
          statement:
            'The student can distinguish gateway placement from authentication, routing-rule, and rate-limit behavior.',
          concept: 'gateway-responsibilities'
        }
      ],
      checks: [
        {
          id: 'through-api-gateway',
          template: 'traffic-flows-through',
          via: 'api-gateway',
          component: 'microservice',
          label: 'Client traffic reaches backend services through the API Gateway',
          objectiveId: 'single-entry',
          points: 1
        }
      ],
      misconceptions: [
        {
          id: 'client-bypasses-gateway',
          title: 'Client connects directly to a backend service',
          message:
            'A single entry point works only when client traffic cannot bypass the API Gateway.',
          nudge: 'Connect Users to the API Gateway, then connect the gateway to Backend Services.',
          priority: 1,
          objectiveId: 'single-entry',
          detect: { kind: 'check-failed', checkId: 'through-api-gateway' },
          probe: {
            nodes: [
              { ref: 'users', component: 'api-endpoint' },
              { ref: 'service', component: 'microservice' }
            ],
            edges: [['users', 'service']]
          }
        }
      ],
      predictions: [
        {
          id: 'single-entry-prediction',
          question: 'Which component should receive every mobile and web request first?',
          answer: { kind: 'choice', options: ['API Gateway', 'Individual backend service'] }
        }
      ],
      lecture: {
        steps: [
          {
            id: 'direct-client-service',
            title: 'Show the bypass',
            talkingPoint: 'Direct client-to-service edges create multiple public entry points.',
            design: {
              nodes: [
                { ref: 'users', component: 'api-endpoint' },
                { ref: 'service', component: 'microservice' }
              ],
              edges: [['users', 'service']]
            }
          },
          {
            id: 'gateway-entry',
            title: 'Create one client entry point',
            talkingPoint:
              'All client traffic enters the API Gateway before reaching independently scalable services.',
            design: {
              nodes: [
                { ref: 'users', component: 'api-endpoint' },
                { ref: 'gateway', component: 'api-gateway' },
                { ref: 'service', component: 'microservice', copies: 5 }
              ],
              edges: [
                ['users', 'gateway'],
                ['gateway', 'service']
              ]
            }
          }
        ]
      },
      hardware: {
        microservice: {
          instanceType: 'Representative independently scalable service',
          description:
            'The 100 req/s Classroom capacity is a locked exercise value, not a production sizing claim.'
        }
      }
    },
    promptAddition:
      'Classroom teaching givens: the public practice run offers 2 requests per second; each Backend Service is modeled at 100 requests per second and the carried-forward Order Worker at 50 requests per second. These values are locked so the lesson stays focused on the single entry point.',
    coverage: {
      dominantLesson: 'Make the API Gateway the single client entry point.',
      limitations: [
        'Classroom proves gateway placement, not authentication policy, route-table coverage, or rate-limit enforcement.',
        'Open the same question in Architect mode to grade those behavioral requirements.'
      ]
    },
    lecture: `# Food Delivery API Gateway - Lecture Sheet

Question ID: \`food-delivery-api-gateway\`

## Classroom outcome

**Classroom-structural, with an Architect handoff.** Classroom grades the API Gateway as the single entry point. Authentication, per-path service routing, and keyed rate limiting stay in the full Architect package.

## Learning objectives

- The student can route client traffic through one API Gateway before backend services.
- The student can explain why an API Gateway is more than another load balancer.
- The student can distinguish visible gateway placement from policy behavior that needs runtime evidence.

## Givens

| Component | Locked teaching given |
| --- | --- |
| Public practice traffic | 2 requests per second |
| Backend Service | 100 requests per second per copy |
| Carried-forward Order Worker | 50 requests per second per copy |

These capacities are author-supplied simulator givens. The PDF supplies the service list and architectural responsibilities, not numeric capacities.

## Napkin model

The entry invariant is: **every path from Users to a Backend Service starts Users -> API Gateway**.

The gateway provides the architectural boundary. Authentication, route matching, and rate limiting are behaviors configured and tested after switching to Architect mode.

## Answer key

| Design | Result | Why |
| --- | --- | --- |
| Users -> Backend Service | Fail | The client bypasses the single entry point. |
| Users -> API Gateway -> Backend Service | Pass the scored Classroom check | The gateway is the first component on the backend path. |
| Gateway plus five independently labeled services | Preferred teaching design | It connects the single entry point to the five service responsibilities named in the PDF. |

## Expected wrong answers

| Wrong design | What it means | What to say |
| --- | --- | --- |
| A client edge directly reaches a service | The gateway was treated as optional | "Can this request avoid authentication and rate limiting by taking another edge?" |
| Gateway and load balancer are treated as identical | Placement was learned without responsibility boundaries | "Which component owns client authentication and API routing?" |
| Drawing a gateway is claimed to prove auth and rate limiting | A label was mistaken for runtime evidence | "Where are the policy and the measured behavior configured?" |

## Lecture steps

1. Begin with a direct Users -> Backend Service design and run its probe.
2. Insert the API Gateway and reconnect the service path.
3. Expand the backend into User, Restaurant, Order, Payment, and Delivery responsibilities.
4. Open Architect mode to inspect authentication, routing rules, and rate-limit behavior.
`
  },
  {
    directory: '03-kafka-event-processing',
    slug: 'food-delivery-kafka-event-processing',
    outcome: 'architect-handoff',
    reason:
      'The Classroom catalog has no event-stream card and does not model Kafka consumer groups or independent fan-out. Relabeling Queue as Kafka would invent behavior.',
    objectives: [
      'The student can place an event stream after event-producing services.',
      'The student can separate the synchronous request path from background event processing.',
      'The student can explain why independent consumers require stream/consumer-group semantics.'
    ],
    lecture: `# Food Delivery Kafka Event Processing - Lecture Sheet

Question ID: \`food-delivery-kafka-event-processing\`

## Classroom outcome

**Architect handoff.** The current Classroom catalog has Queue but no Kafka/Event Stream card. A Queue label cannot prove independent consumer groups, fan-out, or stream retention, so this question is explicitly Architect-only.

## Learning objectives

- The student can place event publication after User, Order, Payment, and Delivery services.
- The student can keep background consumers off the synchronous user-response path.
- The student can explain how independent consumer groups differ from competing workers on one queue.

## Givens

| Item | Given |
| --- | --- |
| Event producers | User actions, order creation, payment processing, and delivery updates |
| Independent consumers | Notifications, user activity, and analytics |
| Response-time rule | Background processing must be asynchronous |
| Required environment | Architect mode with the Stream and consumer-group model |

## Napkin model

The main path completes without waiting for background work. Each independent consumer group receives every event; members inside one group share that group's work.

## Answer key

| Design | Result | Why |
| --- | --- | --- |
| Service -> Notification -> Analytics synchronously | Fail | Background work lengthens the main request and consumers are coupled. |
| Service -> one generic Queue -> competing workers | Fail for the stated lesson | Competing workers do not prove that every independent function receives every event. |
| Services -> Event Stream -> independent consumer groups | Pass in Architect mode | Publication is asynchronous and each group receives the event independently. |

## Expected wrong answers

| Wrong design | What it means | What to say |
| --- | --- | --- |
| One queue with all workers | Queue work sharing was confused with stream fan-out | "Should one event go to one worker, or once to every independent function?" |
| Synchronous notification call | Background work stayed on the response path | "Does the user request wait for notification delivery?" |
| Separate event stream per consumer | Independent consumption was implemented by duplicating infrastructure | "How can consumer groups share one durable event log?" |

## Lecture steps

1. Draw the synchronous request path and mark its response boundary.
2. Add asynchronous publication to one Event Stream.
3. Add Notification, Activity, and Analytics as separate consumer groups.
4. Run the Architect probes for asynchronous publish and independent group delivery.
`
  },
  {
    directory: '04-read-write-database-architecture',
    slug: 'food-delivery-read-write-database-architecture',
    outcome: 'architect-handoff',
    reason:
      'Classroom database cards support topology and generic capacity, but not primary/replica roles, read/write routing, replication, or stale-read evidence.',
    objectives: [
      'The student can send writes to a primary and reads to replicas.',
      'The student can explain how replication lag can produce stale reads.',
      'The student can select a consistency response appropriate to the workload.'
    ],
    lecture: `# Food Delivery Read Write Database Architecture - Lecture Sheet

Question ID: \`food-delivery-read-write-database-architecture\`

## Classroom outcome

**Architect handoff.** SQL Database cards can illustrate topology, but Classroom does not model primary/replica roles, read/write routing, replication lag, or stale-read correctness. The existing full-physics package remains the honest exercise.

## Learning objectives

- The student can route writes to a primary database and reads to replicas.
- The student can explain why read scaling introduces replication lag.
- The student can choose and justify a strategy for reads that require fresh data.

## Givens

| Item | Given |
| --- | --- |
| Workload shape | Millions of reads and comparatively fewer writes |
| Write destination | Primary database |
| Read destinations | Read replicas |
| Correctness concern | Maintain consistency while replication may lag |
| Required environment | Architect mode with replication and consistency evidence |

## Napkin model

Read replicas increase read capacity, not write capacity. A write becomes visible on a replica only after replication, so a read immediately after a write can be stale unless it is routed or synchronized appropriately.

## Answer key

| Design | Result | Why |
| --- | --- | --- |
| All reads and writes -> one database | Fail the scaling objective | High read traffic remains on the bottleneck. |
| Writes -> Primary; reads -> Replicas, no lag strategy | Incomplete | It scales reads but can return stale values. |
| Writes -> Primary; reads -> Replicas with an explicit freshness strategy | Pass in Architect mode | Read traffic is separated and stale-read behavior is addressed. |

## Expected wrong answers

| Wrong design | What it means | What to say |
| --- | --- | --- |
| More replicas are claimed to scale writes | Read and write scaling were conflated | "Which node accepts the write, and how many independent write leaders exist?" |
| Every read goes to a replica immediately after a write | Replication lag was ignored | "Can the replica have applied that write yet?" |
| A Database card labeled Replica is considered proof | A label was mistaken for modeled state | "Which runtime evidence shows replication and stale-read behavior?" |

## Lecture steps

1. Establish the read-heavy workload and single-database bottleneck.
2. Separate write and read routes to Primary and Replicas.
3. Inject or discuss replication lag and observe a read-after-write risk.
4. Compare freshness strategies in Architect mode.
`
  },
  {
    directory: '05-database-sharding-at-massive-scale',
    slug: 'food-delivery-database-sharding-at-massive-scale',
    outcome: 'architect-handoff',
    reason:
      'The Classroom catalog has no sharding or hashing card and does not model shard keys, keyed routing, finite storage, or hot-shard rebalancing.',
    objectives: [
      'The student can choose a shard key and route requests deterministically.',
      'The student can distribute data and write load across shard primaries.',
      'The student can detect and mitigate uneven key distribution.'
    ],
    lecture: `# Food Delivery Database Sharding at Massive Scale - Lecture Sheet

Question ID: \`food-delivery-database-sharding-at-massive-scale\`

## Classroom outcome

**Architect handoff.** Classroom has no Sharding or Hashing concept card and cannot grade shard keys, keyed query routing, finite storage, or hot-shard rebalancing. Replacing those components with generic databases would erase the lesson.

## Learning objectives

- The student can select a shard key that is present on every routed operation.
- The student can distribute data and writes across multiple shard primaries.
- The student can recognize and mitigate a hot shard caused by uneven key distribution.

## Givens

| Item | Given |
| --- | --- |
| Scale | Billions of users and transactions |
| Current limit | One database cannot carry write traffic or storage growth |
| Routing requirement | Requests must reach the correct database |
| Skew requirement | Uneven distribution and hot shards must be handled |
| Required environment | Architect mode with keyed sharding and storage metrics |

## Napkin model

For hash sharding, the conceptual route is \`shard = hash(userId) mod N\`. The key must exist on every operation, distribution must be observed rather than assumed, and a hot key may still overload one shard even when the hash function is correct.

## Answer key

| Design | Result | Why |
| --- | --- | --- |
| Add more read replicas to one primary | Fail | Write throughput and primary storage remain centralized. |
| Multiple databases with no shard router/key | Fail | Requests cannot deterministically find their data. |
| Keyed shard routers -> multiple shard primaries/replicas, with hot-key handling | Pass in Architect mode | Data, writes, and reads are partitioned and skew is explicitly addressed. |

## Expected wrong answers

| Wrong design | What it means | What to say |
| --- | --- | --- |
| Random database selection | Load balancing was confused with data ownership | "How does the next request find the same user's records?" |
| A low-cardinality shard key | Key distribution was not evaluated | "How many distinct partitions can this key actually create?" |
| Hashing is claimed to eliminate hot shards | Average distribution was confused with workload skew | "What happens when one user or tenant owns disproportionate traffic?" |

## Lecture steps

1. Show why read replicas do not remove the single write/storage owner.
2. Introduce \`userId\` and the keyed shard-routing layer.
3. Route reads and writes to four shard groups.
4. Run the skewed Architect workload and rebalance the hot keys.
`
  }
]

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

for (const definition of questions) {
  const sourceDirectory = resolve(sourceRoot, definition.directory)
  const outputDirectory = resolve(outputRoot, definition.directory)
  mkdirSync(outputDirectory, { recursive: true })

  const prefix = resolve(sourceDirectory, definition.slug)
  const project = loadJson(`${prefix}.simulator-question-project.json`)
  const question = loadJson(`${prefix}.question-package.json`)
  const solution = loadJson(`${prefix}.solution-topology.json`)
  const coverage = loadJson(`${prefix}.coverage.json`)

  const classroom =
    definition.outcome === 'classroom-structural'
      ? definition.classroom
      : {
          abstractions: ['architect'],
          objectives: definition.objectives.map((statement, index) => ({
            id: `architect-objective-${index + 1}`,
            statement,
            concept: 'architect-handoff'
          }))
        }

  project.question.setup.classroom = classroom
  question.classroom = classroom

  if (definition.promptAddition) {
    project.question.prompt.text = `${project.question.prompt.text}\n\n${definition.promptAddition}`
    question.prompt.text = `${question.prompt.text}\n\n${definition.promptAddition}`
  }

  if (definition.outcome === 'classroom-structural') {
    const allowed = question.constraints.allowedNodeTypes.filter(
      (type) => type !== 'load-balancer-l7'
    )
    question.constraints.allowedNodeTypes = allowed
    project.question.setup.constraints.allowedNodeTypes = [...allowed]
  }

  coverage.classroom = {
    outcome: definition.outcome,
    ...(definition.coverage ?? {}),
    ...(definition.reason ? { reason: definition.reason } : {}),
    objectives: classroom.objectives.map(({ id, statement, concept }) => ({
      id,
      statement,
      concept
    })),
    checks: (classroom.checks ?? []).map((check) => ({
      id: check.id,
      objectiveId: check.objectiveId,
      evidence: check.template
    }))
  }

  const parsedQuestion = parseQuestionPackage(question)
  const verification = runQuestionAuthoringVerification(parsedQuestion, {
    reference: { id: 'reference', label: 'Reference', topology: solution },
    gamed: project.assets.gamedTopologies
      .filter((design) => design.topology)
      .map((design) => ({
        id: design.id,
        label: design.label,
        topology: design.topology,
        ...(design.misconception ? { misconception: design.misconception } : {}),
        ...(design.expectedObligationId
          ? { expectedObligationId: design.expectedObligationId }
          : {})
      }))
  })
  project.verification = {
    signature: verification.signature,
    ready: verification.ready,
    blockers: verification.blockers,
    generatedAt: verification.generatedAt
  }

  const targetPrefix = resolve(outputDirectory, definition.slug)
  writeJson(`${targetPrefix}.simulator-question-project.json`, project)
  writeJson(`${targetPrefix}.question-package.json`, question)
  writeJson(`${targetPrefix}.solution-topology.json`, solution)
  writeJson(`${targetPrefix}.coverage.json`, coverage)
  writeFileSync(`${targetPrefix}.lecture-sheet.md`, definition.lecture)
}

console.log(`Generated ${questions.length} Classroom authoring sets in ${outputRoot}`)
