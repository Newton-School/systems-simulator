/* eslint-disable prettier/prettier -- generated data uses stable JSON formatting */
/**
 * Generated from docs/system-design-concept-taxonomy.md.
 * Run `npm run generate:system-design-concepts`; do not edit by hand.
 */
export const SYSTEM_DESIGN_CONCEPTS = [
  {
    "id": "PF-01",
    "slug": "stakeholders-and-actors",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Stakeholders and actors",
    "summary": "end users, administrators, operators, developers, partners, regulators, attackers, and dependent systems.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about stakeholders and actors within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-02",
    "slug": "functional-requirements",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Functional requirements",
    "summary": "primary use cases, secondary use cases, control-plane operations, data-plane operations, and explicit non-goals.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about functional requirements within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-03",
    "slug": "quality-attributes",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Quality attributes",
    "summary": "availability, reliability, latency, throughput, scalability, durability, consistency, security, privacy, operability, maintainability, evolvability, portability, usability, cost, and sustainability.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "estimate",
      "objectiveStem": "reason about quality attributes within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-04",
    "slug": "constraints",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Constraints",
    "summary": "time, team, budget, legacy integration, regulation, geography, data residency, hardware, network, vendor, and migration constraints.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about constraints within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-05",
    "slug": "assumptions-and-unknowns",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Assumptions and unknowns",
    "summary": "documenting uncertain inputs, sensitivity analysis, risk-bearing assumptions, and questions that change the design.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about assumptions and unknowns within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-06",
    "slug": "prioritization",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Prioritization",
    "summary": "must/should/could, critical user journeys, tiering, graceful degradation priorities, and minimum viable architecture.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "design",
      "objectiveStem": "reason about prioritization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-07",
    "slug": "trade-off-reasoning",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Trade-off reasoning",
    "summary": "benefit, cost, failure mode, reversibility, blast radius, operational burden, and second-order effects of a decision.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about trade-off reasoning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PF-08",
    "slug": "architecture-communication",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Architecture communication",
    "summary": "context, container, component, deployment, data-flow, sequence, state, failure, and trust-boundary diagrams.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "diagnose",
      "objectiveStem": "reason about architecture communication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "PF-09",
    "slug": "architecture-decisions",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Architecture decisions",
    "summary": "ADRs, alternatives considered, decision drivers, consequences, expiry/revisit criteria, and fitness functions.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about architecture decisions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PF-10",
    "slug": "evolution-planning",
    "domainId": "domain-1",
    "domain": "Problem framing and architecture reasoning",
    "title": "Evolution planning",
    "summary": "current state, target state, transition states, strangler migration, coexistence, rollback, and decommissioning.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about evolution planning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SC-01",
    "slug": "traffic-estimation",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Traffic estimation",
    "summary": "requests per second, peak-to-average ratio, burst size, seasonality, diurnal patterns, organic growth, and launch events.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "classroom-direct",
      "activity": "size",
      "objectiveStem": "apply traffic estimation to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps",
        "maxUtilization"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "serves-all-traffic",
        "within-target-utilization",
        "right-sized"
      ],
      "boundary": "Grade only stated capacity, instance count, utilization, and traffic-serving evidence."
    }
  },
  {
    "id": "SC-02",
    "slug": "user-estimation",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "User estimation",
    "summary": "daily/monthly active users, concurrency, session length, think time, fan-out per action, and geographic distribution.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "estimate",
      "objectiveStem": "reason about user estimation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "SC-03",
    "slug": "data-volume-estimation",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Data-volume estimation",
    "summary": "object count, row/document size, metadata, indexes, replication overhead, retention, and annual growth.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "estimate",
      "objectiveStem": "reason about data-volume estimation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "SC-04",
    "slug": "bandwidth-estimation",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Bandwidth estimation",
    "summary": "ingress, egress, inter-service, replication, backup, media bitrate, compression, and protocol overhead.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "estimate",
      "objectiveStem": "reason about bandwidth estimation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "SC-05",
    "slug": "compute-estimation",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Compute estimation",
    "summary": "service time, concurrency, CPU time, memory, accelerators, worker count, throughput per instance, utilization target, and headroom.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-direct",
      "activity": "size",
      "objectiveStem": "apply compute estimation to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps",
        "maxUtilization"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "serves-all-traffic",
        "within-target-utilization",
        "right-sized"
      ],
      "boundary": "Grade only stated capacity, instance count, utilization, and traffic-serving evidence."
    }
  },
  {
    "id": "SC-06",
    "slug": "queueing-intuition",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Queueing intuition",
    "summary": "arrival rate, service rate, Little's Law, utilization, queue depth, waiting time, concurrency, and saturation knee.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-direct",
      "activity": "size",
      "objectiveStem": "apply queueing intuition to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps",
        "maxUtilization"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "serves-all-traffic",
        "within-target-utilization",
        "right-sized"
      ],
      "boundary": "Grade only stated capacity, instance count, utilization, and traffic-serving evidence."
    }
  },
  {
    "id": "SC-07",
    "slug": "queueing-models",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Queueing models",
    "summary": "M/M/1, M/M/c, bounded queues, burst absorption, priority queues, head-of-line blocking, and non-Poisson workloads.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about queueing models within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SC-08",
    "slug": "capacity-margins",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Capacity margins",
    "summary": "N, N+1, N+2, quorum margin, zone loss, region loss, failover capacity, maintenance capacity, and recovery surge.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-direct",
      "activity": "size",
      "objectiveStem": "apply capacity margins to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps",
        "maxUtilization"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "serves-all-traffic",
        "within-target-utilization",
        "right-sized"
      ],
      "boundary": "Grade only stated capacity, instance count, utilization, and traffic-serving evidence."
    }
  },
  {
    "id": "SC-09",
    "slug": "autoscaling",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Autoscaling",
    "summary": "horizontal, vertical, scheduled, predictive, event-driven, control-loop delay, cooldown, hysteresis, cold starts, and scaling oscillation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about autoscaling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SC-10",
    "slug": "load-and-performance-testing",
    "domainId": "domain-2",
    "domain": "Scale estimation and capacity planning",
    "title": "Load and performance testing",
    "summary": "baseline, stress, spike, soak, breakpoint, failover, capacity envelope, coordinated omission, and representative workloads.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about load and performance testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-01",
    "slug": "monoliths",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Monoliths",
    "summary": "modular monolith, deployment unit, shared state, simple transactions, scaling constraints, and appropriate use cases.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about monoliths within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "AS-02",
    "slug": "layered-and-n-tier-systems",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Layered and n-tier systems",
    "summary": "presentation, application, domain, data, dependency direction, and deployment boundaries.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about layered and n-tier systems within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-03",
    "slug": "microservices",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Microservices",
    "summary": "bounded services, independent deployment, decentralized data, operational cost, network failure, and service sprawl.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about microservices within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-04",
    "slug": "service-oriented-architecture",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Service-oriented architecture",
    "summary": "enterprise service bus, contracts, orchestration, governance, and differences from microservices.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about service-oriented architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-05",
    "slug": "event-driven-architecture",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Event-driven architecture",
    "summary": "producers, consumers, events, commands, notification versus event-carried state transfer, and temporal decoupling.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "connect",
      "objectiveStem": "apply event-driven architecture to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "server",
        "queue",
        "worker"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "AS-06",
    "slug": "serverless-architecture",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Serverless architecture",
    "summary": "functions, managed events, cold starts, statelessness, concurrency limits, duration limits, and cost shape.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about serverless architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-07",
    "slug": "data-intensive-styles",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Data-intensive styles",
    "summary": "Lambda architecture, Kappa architecture, batch plus serving, streaming-first processing, and materialized views.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about data-intensive styles within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-08",
    "slug": "hexagonal-clean-architecture",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Hexagonal/clean architecture",
    "summary": "ports, adapters, dependency inversion, testability, and isolation of infrastructure concerns.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about hexagonal/clean architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-09",
    "slug": "domain-driven-decomposition",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Domain-driven decomposition",
    "summary": "domains, subdomains, bounded contexts, aggregates, context maps, ubiquitous language, and team ownership.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about domain-driven decomposition within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-10",
    "slug": "cell-based-architecture",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Cell-based architecture",
    "summary": "self-contained cells, tenant or traffic partitioning, blast-radius reduction, routing, and cell imbalance.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about cell-based architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-11",
    "slug": "control-plane-versus-data-plane",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Control plane versus data plane",
    "summary": "separate scaling, availability, consistency, security, and failure requirements.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about control plane versus data plane within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AS-12",
    "slug": "buy-build-or-managed-service",
    "domainId": "domain-3",
    "domain": "Architecture styles and decomposition",
    "title": "Buy, build, or managed service",
    "summary": "differentiation, lock-in, compliance, integration, operability, and total cost of ownership.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about buy, build, or managed service within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-01",
    "slug": "resource-oriented-apis",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Resource-oriented APIs",
    "summary": "resources, identifiers, collections, relationships, filtering, sorting, pagination, and partial responses.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about resource-oriented apis within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-02",
    "slug": "rpc-and-procedure-oriented-apis",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "RPC and procedure-oriented APIs",
    "summary": "commands, schemas, generated clients, deadlines, streaming RPC, and coupling.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about rpc and procedure-oriented apis within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-03",
    "slug": "graph-query-apis",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Graph query APIs",
    "summary": "client-selected fields, resolver fan-out, batching, authorization, depth limits, cost limits, and schema evolution.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about graph query apis within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-04",
    "slug": "request-semantics",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Request semantics",
    "summary": "safe operations, idempotency, idempotency keys, conditional requests, retries, duplicate suppression, and replay.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about request semantics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-05",
    "slug": "contracts-and-schemas",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Contracts and schemas",
    "summary": "validation, optionality, defaults, compatibility, additive changes, consumer-driven contracts, and schema registry.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about contracts and schemas within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-06",
    "slug": "versioning-and-evolution",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Versioning and evolution",
    "summary": "URI/header/schema versions, deprecation, compatibility windows, feature negotiation, and migration.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about versioning and evolution within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-07",
    "slug": "pagination",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Pagination",
    "summary": "offset, cursor, keyset, stable ordering, continuation tokens, concurrent mutation, and deep-page cost.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about pagination within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-08",
    "slug": "long-running-operations",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Long-running operations",
    "summary": "asynchronous request-reply, job resources, polling, webhooks, callbacks, cancellation, and progress.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about long-running operations within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-09",
    "slug": "real-time-interfaces",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Real-time interfaces",
    "summary": "WebSocket, server-sent events, long polling, bidirectional streams, backpressure, reconnect, and presence.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about real-time interfaces within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-10",
    "slug": "api-gateways-and-backends-for-frontends",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "API gateways and backends-for-frontends",
    "summary": "routing, aggregation, authentication, authorization, quotas, transformation, and client specialization.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about api gateways and backends-for-frontends within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-11",
    "slug": "error-models",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Error models",
    "summary": "status codes, machine-readable errors, retryability, partial success, validation details, correlation IDs, and localization.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about error models within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "API-12",
    "slug": "protocol-design",
    "domainId": "domain-4",
    "domain": "API and interface design",
    "title": "Protocol design",
    "summary": "framing, serialization, negotiation, flow control, compatibility, formal state machines, and protocol ossification.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "explain",
      "objectiveStem": "reason about protocol design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "NET-01",
    "slug": "addressing-and-naming",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Addressing and naming",
    "summary": "IP addresses, ports, DNS, service discovery, registration, health, TTLs, caching, and stale records.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about addressing and naming within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-02",
    "slug": "transport-fundamentals",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Transport fundamentals",
    "summary": "TCP, UDP, QUIC, connection setup, reliability, ordering, congestion control, multiplexing, and head-of-line blocking.",
    "surfaces": [
      "G",
      "X"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about transport fundamentals within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-03",
    "slug": "application-protocols",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Application protocols",
    "summary": "HTTP versions, TLS, gRPC, WebSocket, MQTT, protocol selection, connection reuse, and message size.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about application protocols within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-04",
    "slug": "proxies-and-gateways",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Proxies and gateways",
    "summary": "forward proxy, reverse proxy, ingress, egress, API gateway, service mesh proxy, and trust termination.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "place",
      "objectiveStem": "apply proxies and gateways to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "api-gateway",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "NET-05",
    "slug": "load-balancing",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Load balancing",
    "summary": "L4/L7, round-robin, least-connections, weighted, hash-based, locality-aware, health-aware, global, and client-side balancing.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "place",
      "objectiveStem": "apply load balancing to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "NET-06",
    "slug": "session-affinity",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Session affinity",
    "summary": "cookies, source hashing, state locality, rebalance, failover, hot spots, and alternatives to stickiness.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about session affinity within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-07",
    "slug": "cdn-and-edge-caching",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "CDN and edge caching",
    "summary": "points of presence, origin shielding, cache keys, TTL, purge, stale serving, signed URLs, and dynamic acceleration.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "place",
      "objectiveStem": "apply cdn and edge caching to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "cdn",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "NET-08",
    "slug": "network-failure",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Network failure",
    "summary": "delay, jitter, loss, duplication, reordering, partitions, asymmetric reachability, black holes, and gray failures.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about network failure within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-09",
    "slug": "network-topology",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Network topology",
    "summary": "regions, zones, VPC/VNet, subnets, routing tables, NAT, peering, private links, transit, and egress control.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about network topology within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-10",
    "slug": "service-discovery-and-mesh",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Service discovery and mesh",
    "summary": "registry, sidecar/ambient data plane, mTLS, retries, traffic policy, telemetry, and control-plane failure.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about service discovery and mesh within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-11",
    "slug": "edge-security",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Edge security",
    "summary": "DDoS absorption, WAF, bot management, rate limits, geo restrictions, TLS termination, and origin protection.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about edge security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "NET-12",
    "slug": "packet-level-performance",
    "domainId": "domain-5",
    "domain": "Networking, naming, and edge delivery",
    "title": "Packet-level performance",
    "summary": "MTU, fragmentation, retransmission, bandwidth-delay product, socket buffers, and kernel/network offload.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "estimate",
      "objectiveStem": "reason about packet-level performance within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "CMP-01",
    "slug": "stateless-and-stateful-compute",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Stateless and stateful compute",
    "summary": "local state, external state, replaceability, affinity, recovery, and scaling implications.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about stateless and stateful compute within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-02",
    "slug": "horizontal-versus-vertical-scaling",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Horizontal versus vertical scaling",
    "summary": "capacity, limits, availability, cost, partitionability, and operational complexity.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-direct",
      "activity": "size",
      "objectiveStem": "apply horizontal versus vertical scaling to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps",
        "maxUtilization"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "serves-all-traffic",
        "within-target-utilization",
        "right-sized"
      ],
      "boundary": "Grade only stated capacity, instance count, utilization, and traffic-serving evidence."
    }
  },
  {
    "id": "CMP-03",
    "slug": "processes-threads-event-loops-and-coroutines",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Processes, threads, event loops, and coroutines",
    "summary": "concurrency models, blocking, scheduling, context switches, and workload fit.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about processes, threads, event loops, and coroutines within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-04",
    "slug": "resource-bottlenecks",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Resource bottlenecks",
    "summary": "CPU, memory, disk IOPS, disk throughput, network, file descriptors, threads, connections, and accelerators.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about resource bottlenecks within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-05",
    "slug": "resource-isolation",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Resource isolation",
    "summary": "requests, limits, quotas, cgroups, noisy neighbors, priority, preemption, and admission control.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about resource isolation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-06",
    "slug": "scheduling",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Scheduling",
    "summary": "bin packing, spread, affinity, anti-affinity, taints, priorities, topology constraints, data locality, and gang scheduling.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about scheduling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-07",
    "slug": "batch-processing",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Batch processing",
    "summary": "jobs, task graphs, partitioning, stragglers, speculative execution, checkpoints, retries, and work stealing.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about batch processing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-08",
    "slug": "parallel-computation",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Parallel computation",
    "summary": "data parallelism, task parallelism, pipelines, map/reduce, scatter-gather, fork-join, and synchronization barriers.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about parallel computation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-09",
    "slug": "serverless-execution",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Serverless execution",
    "summary": "concurrency, cold/warm instances, event sources, ephemeral storage, time limits, and poison events.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about serverless execution within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-10",
    "slug": "accelerated-compute",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Accelerated compute",
    "summary": "GPU/TPU allocation, batching, model placement, memory bandwidth, interconnect, and utilization.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about accelerated compute within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-11",
    "slug": "backpressure-and-admission",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Backpressure and admission",
    "summary": "bounded concurrency, semaphores, queues, token buckets, load shedding, and overload signals.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about backpressure and admission within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CMP-12",
    "slug": "runtime-behavior",
    "domainId": "domain-6",
    "domain": "Compute, concurrency, and resource management",
    "title": "Runtime behavior",
    "summary": "garbage collection, memory fragmentation, connection pools, thread pools, caches, and warmup.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about runtime behavior within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-01",
    "slug": "access-pattern-first-design",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Access-pattern-first design",
    "summary": "reads, writes, scans, updates, joins, aggregations, latency, scale, and consistency requirements.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about access-pattern-first design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-02",
    "slug": "relational-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Relational modeling",
    "summary": "entities, relations, keys, normalization, denormalization, constraints, joins, and referential integrity.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about relational modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-03",
    "slug": "key-value-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Key-value modeling",
    "summary": "keys, values, namespaces, access locality, conditional updates, and limitations.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about key-value modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-04",
    "slug": "document-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Document modeling",
    "summary": "aggregates, embedding, references, schema flexibility, update granularity, and document growth.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about document modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-05",
    "slug": "wide-column-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Wide-column modeling",
    "summary": "partition keys, clustering keys, sparse rows, query-driven tables, and write amplification.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about wide-column modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-06",
    "slug": "graph-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Graph modeling",
    "summary": "vertices, edges, properties, traversals, supernodes, path queries, and graph partitioning.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about graph modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-07",
    "slug": "time-series-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Time-series modeling",
    "summary": "timestamps, tags, high-cardinality dimensions, rollups, retention, downsampling, and late data.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about time-series modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-08",
    "slug": "geospatial-modeling",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Geospatial modeling",
    "summary": "coordinates, cells, geohash/S2-like indexing, proximity, bounding regions, routing, and spatial joins.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about geospatial modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-09",
    "slug": "blob-object-file-storage",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Blob/object/file storage",
    "summary": "object identifiers, metadata, multipart upload, immutability, lifecycle, range reads, and namespace semantics.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about blob/object/file storage within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-10",
    "slug": "search-indexes",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Search indexes",
    "summary": "inverted indexes, analyzers, tokenization, ranking, shards, replicas, refresh, and index lag.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about search indexes within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-11",
    "slug": "vector-storage",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Vector storage",
    "summary": "embeddings, exact versus approximate nearest neighbor, distance metrics, filtering, index build, recall, and freshness.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about vector storage within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-12",
    "slug": "polyglot-persistence",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Polyglot persistence",
    "summary": "selecting stores per access pattern, duplication, synchronization, governance, and operational cost.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about polyglot persistence within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-13",
    "slug": "metadata-and-schema",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Metadata and schema",
    "summary": "catalog, lineage, ownership, compatibility, quality, discoverability, and governance.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about metadata and schema within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DATA-14",
    "slug": "data-lifecycle",
    "domainId": "domain-7",
    "domain": "Data modeling and storage selection",
    "title": "Data lifecycle",
    "summary": "creation, hot/warm/cold tiers, archival, retention, legal hold, deletion, compaction, and restoration.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about data lifecycle within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-01",
    "slug": "index-structures",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Index structures",
    "summary": "B-tree/B+ tree, hash, LSM tree, bitmap, inverted, spatial, bloom filters, and learned indexes.",
    "surfaces": [
      "G",
      "X"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about index structures within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-02",
    "slug": "index-design",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Index design",
    "summary": "selectivity, composite keys, covering indexes, ordering, write cost, storage cost, and maintenance.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about index design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-03",
    "slug": "query-execution",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Query execution",
    "summary": "scans, seeks, joins, sorts, aggregation, plans, statistics, cardinality estimation, and plan regressions.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about query execution within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-04",
    "slug": "distributed-queries",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Distributed queries",
    "summary": "partition pruning, scatter-gather, exchanges, shuffles, partial aggregation, coordinator bottlenecks, and stragglers.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about distributed queries within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-05",
    "slug": "oltp-versus-olap",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "OLTP versus OLAP",
    "summary": "point operations, short transactions, scans, columnar storage, vectorized execution, and workload isolation.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about oltp versus olap within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-06",
    "slug": "row-versus-column-storage",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Row versus column storage",
    "summary": "locality, compression, updates, projections, and analytical scan efficiency.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about row versus column storage within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-07",
    "slug": "materialization",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Materialization",
    "summary": "materialized views, precomputation, incremental maintenance, freshness, invalidation, and storage trade-offs.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about materialization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-08",
    "slug": "data-federation",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Data federation",
    "summary": "query pushdown, heterogeneous sources, schema mapping, consistency, performance, and governance.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about data federation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "QRY-09",
    "slug": "approximate-computation",
    "domainId": "domain-8",
    "domain": "Query processing and indexing",
    "title": "Approximate computation",
    "summary": "sampling, sketches, HyperLogLog-like cardinality, quantiles, error bounds, and cost/accuracy trade-offs.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about approximate computation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-01",
    "slug": "cache-placement",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Cache placement",
    "summary": "browser, device, CDN, gateway, application, distributed cache, database buffer, and result cache.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "place",
      "objectiveStem": "apply cache placement to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "server",
        "cache",
        "sql-database"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "CACHE-02",
    "slug": "cache-aside-read-through-write-through-write-behind-and-refresh-ahead-patterns",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Cache-aside, read-through, write-through, write-behind, and refresh-ahead patterns",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about cache-aside, read-through, write-through, write-behind, and refresh-ahead patterns within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-03",
    "slug": "cache-keys",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Cache keys",
    "summary": "normalization, versioning, tenant/user dimensions, authorization context, locale, device, and query parameters.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about cache keys within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-04",
    "slug": "expiration-and-invalidation",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Expiration and invalidation",
    "summary": "TTL, explicit purge, versioned keys, event-driven invalidation, dependency tracking, and stale-while-revalidate.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about expiration and invalidation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-05",
    "slug": "eviction",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Eviction",
    "summary": "LRU, LFU, FIFO, random, size-aware, admission policies, memory pressure, and working sets.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about eviction within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-06",
    "slug": "cache-failure-modes",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Cache failure modes",
    "summary": "stampede, penetration, avalanche, hot keys, stale data, split caches, cache poisoning, and origin overload.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about cache failure modes within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-07",
    "slug": "stampede-protection",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Stampede protection",
    "summary": "request coalescing, single-flight, leases, probabilistic early refresh, jittered TTLs, and stale serving.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about stampede protection within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-08",
    "slug": "consistency-trade-offs",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Consistency trade-offs",
    "summary": "read-after-write, stale reads, invalidation races, local versus shared caches, and cache/database ordering.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about consistency trade-offs within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-09",
    "slug": "negative-and-semantic-caching",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Negative and semantic caching",
    "summary": "absence caching, error caching, approximate equivalence, privacy boundaries, and false matches.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about negative and semantic caching within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CACHE-10",
    "slug": "hit-rate-economics",
    "domainId": "domain-9",
    "domain": "Caching and content reuse",
    "title": "Hit-rate economics",
    "summary": "hit ratio, miss penalty, object popularity, cache size, latency, origin offload, and cost.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about hit-rate economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-01",
    "slug": "why-partition",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Why partition",
    "summary": "capacity limits, throughput, storage, locality, isolation, ownership, and administrative boundaries.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about why partition within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-02",
    "slug": "horizontal-vertical-functional-directory-based-and-tenant-based-partitioning",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Horizontal, vertical, functional, directory-based, and tenant-based partitioning",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about horizontal, vertical, functional, directory-based, and tenant-based partitioning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-03",
    "slug": "range-hash-consistent-hash-rendezvous-hash-geographic-and-composite-partitioning",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Range, hash, consistent-hash, rendezvous-hash, geographic, and composite partitioning",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about range, hash, consistent-hash, rendezvous-hash, geographic, and composite partitioning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-04",
    "slug": "partition-key-design",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Partition-key design",
    "summary": "cardinality, evenness, locality, query fit, monotonic keys, time buckets, and tenant skew.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about partition-key design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-05",
    "slug": "hot-partitions-and-hot-keys",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Hot partitions and hot keys",
    "summary": "skew detection, salting, splitting, replication, caching, isolation, and adaptive routing.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about hot partitions and hot keys within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-06",
    "slug": "rebalancing",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Rebalancing",
    "summary": "virtual nodes, shard splitting/merging, data movement, throttling, dual routing, and consistency during migration.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about rebalancing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-07",
    "slug": "cross-shard-operations",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Cross-shard operations",
    "summary": "scatter-gather reads, global indexes, distributed joins, aggregations, transactions, and referential constraints.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about cross-shard operations within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-08",
    "slug": "resharding-and-growth",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Resharding and growth",
    "summary": "online migration, shadow writes, backfill, checkpoints, validation, cutover, and rollback.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about resharding and growth within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-09",
    "slug": "partition-aware-identifiers",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Partition-aware identifiers",
    "summary": "natural keys, synthetic keys, sortable IDs, embedded shard hints, opacity, and hotspot risk.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about partition-aware identifiers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PART-10",
    "slug": "multi-level-partitioning",
    "domainId": "domain-10",
    "domain": "Partitioning and sharding",
    "title": "Multi-level partitioning",
    "summary": "region, cell, tenant, shard, replica, and physical storage hierarchy.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about multi-level partitioning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-01",
    "slug": "replication-purpose",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Replication purpose",
    "summary": "availability, durability, read scale, geographic proximity, backup, analytics, and isolation.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about replication purpose within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-02",
    "slug": "leader-follower-multi-leader-and-leaderless-replication",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Leader-follower, multi-leader, and leaderless replication",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about leader-follower, multi-leader, and leaderless replication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-03",
    "slug": "synchronous-semi-synchronous-and-asynchronous-replication",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Synchronous, semi-synchronous, and asynchronous replication",
    "summary": "latency, acknowledged durability, data loss, and availability.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about synchronous, semi-synchronous, and asynchronous replication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-04",
    "slug": "quorums",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Quorums",
    "summary": "N/R/W, majority, flexible quorums, sloppy quorums, quorum intersection, and failure tolerance.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about quorums within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-05",
    "slug": "replica-lag",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Replica lag",
    "summary": "measurement, bounded staleness, read-your-writes, monotonic reads, lag-aware routing, and catch-up.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about replica lag within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-06",
    "slug": "conflict-handling",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Conflict handling",
    "summary": "last-write-wins, version vectors, merge functions, CRDTs, application reconciliation, and user-visible conflicts.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about conflict handling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-07",
    "slug": "anti-entropy-and-repair",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Anti-entropy and repair",
    "summary": "read repair, background repair, Merkle trees, hinted handoff, tombstones, and garbage collection.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about anti-entropy and repair within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-08",
    "slug": "failover",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Failover",
    "summary": "detection, promotion, fencing, split brain, DNS/routing change, client reconnection, and failback.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about failover within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-09",
    "slug": "durability-mechanisms",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Durability mechanisms",
    "summary": "write-ahead log, fsync, checksums, replication, erasure coding, snapshots, backup, and immutable storage.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about durability mechanisms within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-10",
    "slug": "data-loss-windows",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Data-loss windows",
    "summary": "RPO, acknowledged writes, regional disasters, corruption, latent faults, and recovery validation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about data-loss windows within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-11",
    "slug": "backups-versus-replicas",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Backups versus replicas",
    "summary": "correlated corruption, point-in-time recovery, air gaps, retention, restore drills, and backup integrity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about backups versus replicas within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REP-12",
    "slug": "erasure-coding",
    "domainId": "domain-11",
    "domain": "Replication, durability, and availability",
    "title": "Erasure coding",
    "summary": "data/parity fragments, reconstruction, storage efficiency, repair bandwidth, and small-object trade-offs.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "estimate",
      "objectiveStem": "reason about erasure coding within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "CONS-01",
    "slug": "consistency-vocabulary",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Consistency vocabulary",
    "summary": "strong, eventual, causal, sequential, linearizable, serializable, and externally consistent behavior.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about consistency vocabulary within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-02",
    "slug": "client-session-guarantees",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Client/session guarantees",
    "summary": "read-your-writes, monotonic reads, monotonic writes, writes-follow-reads, and consistent prefix.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about client/session guarantees within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-03",
    "slug": "cap-reasoning",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "CAP reasoning",
    "summary": "partitions, availability, consistency, operation-level choices, and why normal-operation latency still matters.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about cap reasoning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-04",
    "slug": "pacelc-reasoning",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "PACELC reasoning",
    "summary": "partition trade-offs and latency/consistency trade-offs when the system is healthy.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about pacelc reasoning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-05",
    "slug": "acid-transactions",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "ACID transactions",
    "summary": "atomicity, consistency, isolation, durability, transaction boundaries, and business invariants.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about acid transactions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-06",
    "slug": "isolation-levels-and-anomalies",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Isolation levels and anomalies",
    "summary": "dirty reads/writes, non-repeatable reads, lost updates, read/write skew, phantoms, and serializability.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about isolation levels and anomalies within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-07",
    "slug": "concurrency-control",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Concurrency control",
    "summary": "locks, two-phase locking, MVCC, optimistic concurrency, compare-and-swap, validation, and deadlocks.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about concurrency control within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-08",
    "slug": "distributed-transactions",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Distributed transactions",
    "summary": "two-phase commit, coordinator failure, blocking, three-phase ideas, consensus-backed commit, and recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about distributed transactions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-09",
    "slug": "sagas",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Sagas",
    "summary": "orchestration, choreography, compensating actions, semantic rollback, isolation problems, and observability.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about sagas within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-10",
    "slug": "idempotency-and-deduplication",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Idempotency and deduplication",
    "summary": "request IDs, inbox/outbox tables, replay windows, result caching, and side-effect boundaries.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about idempotency and deduplication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-11",
    "slug": "ordering",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Ordering",
    "summary": "per-key, per-partition, causal, total, global, event time, processing time, reordering buffers, and late events.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about ordering within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "CONS-12",
    "slug": "correctness-testing",
    "domainId": "domain-12",
    "domain": "Consistency, concurrency, and transactions",
    "title": "Correctness testing",
    "summary": "histories, linearizability checking, serializability checking, invariant checking, and bounded claims.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "diagnose",
      "objectiveStem": "reason about correctness testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-01",
    "slug": "distributed-system-models",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Distributed-system models",
    "summary": "processes, messages, partial failure, asynchronous/synchronous timing assumptions, and failure detectors.",
    "surfaces": [
      "G",
      "X"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about distributed-system models within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-02",
    "slug": "time-and-clocks",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Time and clocks",
    "summary": "wall clocks, monotonic clocks, skew, drift, synchronization, leap events, and uncertainty intervals.",
    "surfaces": [
      "G",
      "X"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about time and clocks within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-03",
    "slug": "logical-time",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Logical time",
    "summary": "Lamport clocks, vector clocks, happens-before, causality, concurrent events, and hybrid logical clocks.",
    "surfaces": [
      "G",
      "X"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about logical time within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-04",
    "slug": "leader-election",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Leader election",
    "summary": "leases, terms/epochs, failure detection, split-brain prevention, fencing tokens, and re-election.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about leader election within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-05",
    "slug": "distributed-locks-and-leases",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Distributed locks and leases",
    "summary": "ownership, expiry, renewal, fencing, lock service failure, and safety versus liveness.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about distributed locks and leases within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-06",
    "slug": "consensus",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Consensus",
    "summary": "agreement, validity, termination, quorum, replicated logs, state-machine replication, and minority failure.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "diagnose",
      "objectiveStem": "reason about consensus within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-07",
    "slug": "paxos-family-concepts",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Paxos-family concepts",
    "summary": "proposer/acceptor/learner roles, ballots, quorum intersection, Multi-Paxos, and reconfiguration.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "configure",
      "objectiveStem": "reason about paxos-family concepts within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-08",
    "slug": "raft-family-concepts",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Raft-family concepts",
    "summary": "terms, leader election, log matching, commit index, snapshots, membership change, and safety.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "explain",
      "objectiveStem": "reason about raft-family concepts within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-09",
    "slug": "coordination-services",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Coordination services",
    "summary": "naming, configuration, membership, leader election, locks, watches, and ephemeral nodes.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about coordination services within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COORD-10",
    "slug": "impossibility-and-limits",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Impossibility and limits",
    "summary": "FLP intuition, Byzantine versus crash faults, failure-detector assumptions, and coordination cost.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "estimate",
      "objectiveStem": "reason about impossibility and limits within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-11",
    "slug": "byzantine-fault-tolerance",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Byzantine fault tolerance",
    "summary": "quorum sizes, equivocation, signatures, view changes, finality, and performance costs.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "estimate",
      "objectiveStem": "reason about byzantine fault tolerance within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "COORD-12",
    "slug": "distributed-identifiers",
    "domainId": "domain-13",
    "domain": "Distributed coordination, time, and consensus",
    "title": "Distributed identifiers",
    "summary": "UUID variants, sequence services, timestamp-based IDs, clock rollback, collision, ordering, and information leakage.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about distributed identifiers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-01",
    "slug": "synchronous-versus-asynchronous-processing",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Synchronous versus asynchronous processing",
    "summary": "coupling, latency, availability, buffering, user feedback, and operational complexity.",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "connect",
      "objectiveStem": "apply synchronous versus asynchronous processing to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "server",
        "queue",
        "worker"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "MSG-02",
    "slug": "queue-topology",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Queue topology",
    "summary": "producer, broker, consumer, competing consumers, priority queues, delay queues, and dead-letter queues.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "connect",
      "objectiveStem": "apply queue topology to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "server",
        "queue",
        "worker"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "MSG-03",
    "slug": "delivery-semantics",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Delivery semantics",
    "summary": "at-most-once, at-least-once, bounded exactly-once scopes, acknowledgement timing, and failure windows.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about delivery semantics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-04",
    "slug": "consumer-behavior",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Consumer behavior",
    "summary": "prefetch, concurrency, acknowledgement, visibility timeout, redelivery, poison messages, and graceful shutdown.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about consumer behavior within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-05",
    "slug": "backlog-management",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Backlog management",
    "summary": "queue depth, age of oldest message, arrival versus drain rate, autoscaling, retention, expiration, and overload.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about backlog management within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-06",
    "slug": "routing",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Routing",
    "summary": "point-to-point, publish/subscribe, topics, fan-out, filters, routing keys, headers, and content-based routing.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about routing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-07",
    "slug": "ordering",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Ordering",
    "summary": "FIFO scope, message groups, partitions, parallelism, retries, dead letters, and reordering.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about ordering within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-08",
    "slug": "duplicate-handling",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Duplicate handling",
    "summary": "idempotent consumers, dedup stores, natural idempotence, side effects, and dedup retention.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about duplicate handling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-09",
    "slug": "transactional-outbox-inbox-and-change-data-capture-publication",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Transactional outbox/inbox and change-data-capture publication",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about transactional outbox/inbox and change-data-capture publication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-10",
    "slug": "large-message-handling",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Large-message handling",
    "summary": "claim-check pattern, object storage, references, lifecycle, authorization, and atomicity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about large-message handling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-11",
    "slug": "flow-control-and-backpressure",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Flow control and backpressure",
    "summary": "credits, windows, bounded buffers, producer throttling, consumer lag, and load shedding.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about flow control and backpressure within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "MSG-12",
    "slug": "scheduling-and-workflows",
    "domainId": "domain-14",
    "domain": "Messaging, queues, and asynchronous work",
    "title": "Scheduling and workflows",
    "summary": "delayed work, cron, dependency graphs, retries, compensation, human tasks, and durable execution.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about scheduling and workflows within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-01",
    "slug": "event-logs",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Event logs",
    "summary": "append-only records, topics, partitions, offsets, retention, replay, and consumers.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about event logs within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-02",
    "slug": "partitioning-and-consumer-groups",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Partitioning and consumer groups",
    "summary": "ownership, parallelism, rebalancing, assignment, lag, and ordering scope.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about partitioning and consumer groups within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-03",
    "slug": "producer-semantics",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Producer semantics",
    "summary": "keys, partition selection, batching, acknowledgements, retries, idempotent producers, and transactions.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about producer semantics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-04",
    "slug": "consumer-semantics",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Consumer semantics",
    "summary": "offset commit, processing failure, replay, at-least-once effects, read-committed behavior, and poison events.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about consumer semantics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-05",
    "slug": "stream-time-semantics",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Stream-time semantics",
    "summary": "event time, ingestion time, processing time, watermarks, allowed lateness, and out-of-order events.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about stream-time semantics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-06",
    "slug": "stateful-processing",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Stateful processing",
    "summary": "keyed state, windows, joins, aggregations, changelogs, checkpoints, and state recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about stateful processing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-07",
    "slug": "windowing",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Windowing",
    "summary": "tumbling, hopping, sliding, session windows, triggers, early/late results, and correction.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about windowing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-08",
    "slug": "stream-table-duality",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Stream-table duality",
    "summary": "logs as change history, tables as current state, materialized views, upserts, and tombstones.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about stream-table duality within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-09",
    "slug": "event-sourcing",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Event sourcing",
    "summary": "event store, aggregates, replay, snapshots, projections, schema evolution, and correction events.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about event sourcing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-10",
    "slug": "change-data-capture",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Change data capture",
    "summary": "logs, snapshots, ordering, schema changes, backfill, duplicates, and downstream consistency.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about change data capture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-11",
    "slug": "stream-joins-and-enrichment",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Stream joins and enrichment",
    "summary": "co-partitioning, lookup state, temporal joins, late updates, and memory/state growth.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about stream joins and enrichment within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "STR-12",
    "slug": "data-contracts",
    "domainId": "domain-15",
    "domain": "Event streaming and stream processing",
    "title": "Data contracts",
    "summary": "event ownership, schemas, compatibility, quality, lineage, discoverability, and personally identifiable information.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about data contracts within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-01",
    "slug": "failure-modes",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Failure modes",
    "summary": "crash, omission, timing, corruption, overload, dependency failure, network partition, gray failure, and operator error.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about failure modes within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-02",
    "slug": "redundancy-and-fault-domains",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Redundancy and fault domains",
    "summary": "instance, rack, zone, region, provider, software version, dependency, and organizational common-mode failure.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "place",
      "objectiveStem": "apply redundancy and fault domains to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "load-balancer",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components",
        "copies"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "REL-03",
    "slug": "timeouts-and-deadlines",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Timeouts and deadlines",
    "summary": "connect/read/overall timeout, deadline propagation, cancellation, abandoned work, and timeout budgets.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about timeouts and deadlines within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-04",
    "slug": "retries",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Retries",
    "summary": "retryable errors, limits, exponential backoff, jitter, retry budgets, layered retries, and retry storms.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about retries within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-05",
    "slug": "circuit-breakers",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Circuit breakers",
    "summary": "closed/open/half-open states, thresholds, probe traffic, recovery, and interaction with retries.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about circuit breakers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-06",
    "slug": "bulkheads",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Bulkheads",
    "summary": "thread/connection/resource pools, tenant isolation, failure containment, and underutilization trade-offs.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about bulkheads within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-07",
    "slug": "rate-limiting-and-quotas",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Rate limiting and quotas",
    "summary": "token bucket, leaky bucket, fixed/sliding windows, distributed limits, fairness, bursts, and client signaling.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about rate limiting and quotas within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-08",
    "slug": "load-shedding-and-admission-control",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Load shedding and admission control",
    "summary": "priority, early rejection, adaptive concurrency, queue bounds, and brownout.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about load shedding and admission control within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-09",
    "slug": "graceful-degradation",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Graceful degradation",
    "summary": "optional features, stale data, cached results, partial responses, reduced quality, and critical-path preservation.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "classroom-structural",
      "activity": "select",
      "objectiveStem": "apply graceful degradation to a visible system-design decision",
      "requiredGivens": [
        "peakRps",
        "componentCapacityRps"
      ],
      "recommendedCards": [
        "users",
        "api-gateway",
        "server"
      ],
      "allowedDecisionKinds": [
        "place-component",
        "connect-components"
      ],
      "compatibleChecks": [
        "traffic-flows-through"
      ],
      "boundary": "Grade visible topology and placement only; do not infer unmodeled component behavior."
    }
  },
  {
    "id": "REL-10",
    "slug": "hedging-and-redundant-requests",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Hedging and redundant requests",
    "summary": "tail reduction, cancellation, extra load, idempotency, and percentile-triggered hedges.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about hedging and redundant requests within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-11",
    "slug": "health-checks",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Health checks",
    "summary": "liveness, readiness, startup, dependency checks, false positives, fail-open/closed, and coordinated restarts.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about health checks within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-12",
    "slug": "cascading-failures",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Cascading failures",
    "summary": "positive feedback, overload redistribution, retry amplification, cache failure, dependency fan-out, and recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about cascading failures within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-13",
    "slug": "chaos-engineering",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Chaos engineering",
    "summary": "hypothesis, steady state, fault injection, blast-radius controls, observability, abort conditions, and learning.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about chaos engineering within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-14",
    "slug": "disaster-recovery",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Disaster recovery",
    "summary": "risk assessment, RTO, RPO, backup, restore, failover, failback, runbooks, and exercises.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about disaster recovery within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "REL-15",
    "slug": "dependency-resilience",
    "domainId": "domain-16",
    "domain": "Reliability, resilience, and failure engineering",
    "title": "Dependency resilience",
    "summary": "criticality, fallback, isolation, contract behavior, timeout budgets, and third-party outage planning.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about dependency resilience within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-01",
    "slug": "latency-decomposition",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Latency decomposition",
    "summary": "network, queue, service, storage, serialization, contention, retries, and client rendering.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about latency decomposition within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-02",
    "slug": "percentiles-and-distributions",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Percentiles and distributions",
    "summary": "median, p95/p99/p99.9, averages, histograms, multimodality, and outliers.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about percentiles and distributions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-03",
    "slug": "tail-latency",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Tail latency",
    "summary": "fan-out amplification, stragglers, hedging, micro-partitioning, load balancing, and utilization.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about tail latency within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-04",
    "slug": "throughput-versus-latency",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Throughput versus latency",
    "summary": "saturation, queueing, concurrency, batching, headroom, and the universal scalability intuition.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about throughput versus latency within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-05",
    "slug": "batching",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Batching",
    "summary": "amortized overhead, batch size, wait time, throughput, memory, failure granularity, and fairness.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about batching within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-06",
    "slug": "fan-out-and-scatter-gather",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Fan-out and scatter-gather",
    "summary": "critical path, parallelism, partial results, deadlines, stragglers, and coordinator load.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about fan-out and scatter-gather within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-07",
    "slug": "data-locality",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Data locality",
    "summary": "compute-to-data, cache locality, region affinity, partition-aware routing, and cross-zone/region cost.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about data locality within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-08",
    "slug": "contention",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Contention",
    "summary": "locks, hot rows, hot keys, connection pools, shared resources, convoying, and priority inversion.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about contention within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-09",
    "slug": "profiling-and-benchmarking",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Profiling and benchmarking",
    "summary": "representative inputs, warmup, bottleneck attribution, micro versus macro benchmarks, and regression budgets.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about profiling and benchmarking within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PERF-10",
    "slug": "performance-anti-patterns",
    "domainId": "domain-17",
    "domain": "Performance and latency engineering",
    "title": "Performance anti-patterns",
    "summary": "chatty calls, N+1 queries, unbounded concurrency, synchronous chains, excessive serialization, and premature caching.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about performance anti-patterns within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-01",
    "slug": "threat-modeling",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Threat modeling",
    "summary": "assets, actors, trust boundaries, entry points, abuse cases, STRIDE-like categories, likelihood, impact, and mitigations.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about threat modeling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-02",
    "slug": "authentication",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Authentication",
    "summary": "passwords, MFA, sessions, tokens, federation, workload identity, device identity, and credential recovery.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about authentication within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-03",
    "slug": "authorization",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Authorization",
    "summary": "RBAC, ABAC, ReBAC, policy decision/enforcement, least privilege, object-level access, and tenant boundaries.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about authorization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-04",
    "slug": "identity-protocols",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Identity protocols",
    "summary": "OAuth, OpenID Connect, SAML, token audiences, scopes, consent, refresh, revocation, and key rotation.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identity protocols within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-05",
    "slug": "session-and-token-design",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Session and token design",
    "summary": "cookies, CSRF, token storage, expiration, rotation, replay, logout, and distributed revocation.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about session and token design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-06",
    "slug": "cryptography-in-architecture",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Cryptography in architecture",
    "summary": "encryption in transit/at rest/in use, envelope encryption, key hierarchy, KMS/HSM, rotation, and crypto agility.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about cryptography in architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-07",
    "slug": "secrets-management",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Secrets management",
    "summary": "issuance, storage, distribution, rotation, short-lived credentials, audit, and break-glass access.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about secrets management within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-08",
    "slug": "network-security",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Network security",
    "summary": "segmentation, private connectivity, firewall policy, egress control, mTLS, zero trust, and service identity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about network security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-09",
    "slug": "api-security",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "API security",
    "summary": "broken object authorization, broken authentication, mass assignment, resource exhaustion, inventory, unsafe consumption, and abuse.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about api security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-10",
    "slug": "application-layer-defenses",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Application-layer defenses",
    "summary": "input validation, output encoding, injection prevention, SSRF controls, file handling, and deserialization safety.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about application-layer defenses within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-11",
    "slug": "availability-security",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Availability security",
    "summary": "DDoS, bot abuse, quotas, proof of work, upstream protection, circuit breaking, and recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about availability security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-12",
    "slug": "software-supply-chain",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Software supply chain",
    "summary": "provenance, dependency risk, signing, SBOM, artifact integrity, CI isolation, and deployment policy.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about software supply chain within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-13",
    "slug": "audit-and-forensics",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Audit and forensics",
    "summary": "immutable logs, actor/action/resource/time, tamper evidence, retention, privacy, access, and investigation.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about audit and forensics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-14",
    "slug": "zero-trust-architecture",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Zero-trust architecture",
    "summary": "no implicit network trust, continuous authentication/authorization, resource protection, policy signals, and enforcement.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about zero-trust architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "SEC-15",
    "slug": "security-failure-behavior",
    "domainId": "domain-18",
    "domain": "Security architecture",
    "title": "Security failure behavior",
    "summary": "fail-open/closed, degraded identity, key-service outage, clock failure, revocation lag, and emergency access.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about security failure behavior within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-01",
    "slug": "data-classification",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Data classification",
    "summary": "public, internal, confidential, sensitive, regulated, secrets, and derived/inferred data.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about data classification within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-02",
    "slug": "data-minimization-and-purpose-limitation",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Data minimization and purpose limitation",
    "summary": "collect, process, expose, and retain only what is necessary.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about data minimization and purpose limitation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-03",
    "slug": "consent-and-preference",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Consent and preference",
    "summary": "collection, versioned consent, revocation, downstream propagation, and auditability.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about consent and preference within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-04",
    "slug": "data-residency-and-sovereignty",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Data residency and sovereignty",
    "summary": "storage, processing, support access, backups, replication, and cross-border transfer.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about data residency and sovereignty within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-05",
    "slug": "retention-and-deletion",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Retention and deletion",
    "summary": "TTLs, legal holds, backup deletion, derived data, caches, indexes, logs, and deletion verification.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about retention and deletion within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-06",
    "slug": "subject-rights",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Subject rights",
    "summary": "access, correction, portability, restriction, deletion, identity verification, and asynchronous workflows.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about subject rights within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-07",
    "slug": "de-identification",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "De-identification",
    "summary": "masking, tokenization, pseudonymization, anonymization limits, aggregation, and re-identification risk.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about de-identification within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-08",
    "slug": "multi-purpose-data-governance",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Multi-purpose data governance",
    "summary": "ownership, lineage, catalog, quality, access review, policy-as-code, and exception management.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about multi-purpose data governance within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-09",
    "slug": "compliance-architecture",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Compliance architecture",
    "summary": "evidence, controls, segregation of duties, audit scope, retention, change control, and continuous compliance.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about compliance architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PRIV-10",
    "slug": "regional-and-age-sensitive-experiences",
    "domainId": "domain-19",
    "domain": "Privacy, compliance, and governance",
    "title": "Regional and age-sensitive experiences",
    "summary": "policy routing, parental controls, localization, content restrictions, and explainability.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about regional and age-sensitive experiences within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-01",
    "slug": "service-level-vocabulary",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Service-level vocabulary",
    "summary": "SLI, SLO, SLA, error budget, availability, durability, correctness, freshness, and latency objectives.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about service-level vocabulary within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-02",
    "slug": "golden-signals",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Golden signals",
    "summary": "latency, traffic, errors, saturation, plus domain-specific indicators.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about golden signals within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-03",
    "slug": "metrics",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Metrics",
    "summary": "counters, gauges, histograms, summaries, labels, cardinality, aggregation, retention, and exemplars.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about metrics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-04",
    "slug": "logs",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Logs",
    "summary": "structured events, levels, context, sampling, redaction, indexing, retention, and cost.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about logs within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-05",
    "slug": "distributed-tracing",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Distributed tracing",
    "summary": "trace/span context, propagation, sampling, causality, critical path, baggage, and privacy.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about distributed tracing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-06",
    "slug": "correlation",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Correlation",
    "summary": "request IDs, trace IDs, deployment versions, tenant, region, feature flags, and cross-signal links.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about correlation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-07",
    "slug": "alerting",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Alerting",
    "summary": "symptom versus cause, burn-rate alerts, paging versus ticket, noise, deduplication, inhibition, and actionable runbooks.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about alerting within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-08",
    "slug": "dashboards",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Dashboards",
    "summary": "user journey, service overview, dependency, capacity, deployment, business, and debugging views.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about dashboards within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-09",
    "slug": "incident-response",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Incident response",
    "summary": "detection, triage, command, communication, mitigation, recovery, handoff, timeline, and status updates.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about incident response within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-10",
    "slug": "post-incident-learning",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Post-incident learning",
    "summary": "blameless analysis, contributing factors, corrective actions, owners, recurrence tests, and systemic fixes.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about post-incident learning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-11",
    "slug": "on-call-design",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "On-call design",
    "summary": "escalation, ownership, access, training, handover, sustainable load, and toil reduction.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about on-call design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-12",
    "slug": "capacity-and-reliability-reviews",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Capacity and reliability reviews",
    "summary": "forecasts, dependencies, failure-mode analysis, game days, readiness, and launch criteria.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about capacity and reliability reviews within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-13",
    "slug": "observability-architecture",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Observability architecture",
    "summary": "agents/collectors, pipelines, buffering, backpressure, sampling, storage tiers, multi-tenancy, and self-observability.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about observability architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "OBS-14",
    "slug": "telemetry-economics-and-safety",
    "domainId": "domain-20",
    "domain": "Observability and SRE",
    "title": "Telemetry economics and safety",
    "summary": "cardinality budgets, sampling, retention, egress, PII/secrets, access control, and cost.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about telemetry economics and safety within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-01",
    "slug": "deployment-strategies",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Deployment strategies",
    "summary": "recreate, rolling, blue-green, canary, ring, shadow, and progressive delivery.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about deployment strategies within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-02",
    "slug": "release-safety",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Release safety",
    "summary": "health gates, SLO gates, automated rollback, feature flags, kill switches, and blast-radius control.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about release safety within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-03",
    "slug": "backward-forward-compatibility",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Backward/forward compatibility",
    "summary": "APIs, events, schemas, databases, clients, mixed-version clusters, and expand-contract migrations.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about backward/forward compatibility within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-04",
    "slug": "database-migration",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Database migration",
    "summary": "additive schema, dual read/write, backfill, validation, cutover, cleanup, and rollback limitations.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about database migration within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-05",
    "slug": "configuration-management",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Configuration management",
    "summary": "defaults, validation, dynamic config, rollout, versioning, secrets separation, and safe fallback.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about configuration management within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-06",
    "slug": "infrastructure-as-code",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Infrastructure as code",
    "summary": "declarative state, plans, drift, modules, policy, state protection, and promotion.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about infrastructure as code within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-07",
    "slug": "immutable-infrastructure-and-image-pipelines",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Immutable infrastructure and image pipelines",
    "summary": "build once, provenance, scanning, signing, promotion, and rollback.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about immutable infrastructure and image pipelines within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-08",
    "slug": "environment-strategy",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Environment strategy",
    "summary": "local, test, staging, production, ephemeral, parity, test data, isolation, and cost.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about environment strategy within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-09",
    "slug": "feature-management",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Feature management",
    "summary": "flags, experiments, targeting, dependencies, lifecycle, stale flags, and emergency disablement.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about feature management within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-10",
    "slug": "legacy-modernization",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Legacy modernization",
    "summary": "strangler, anti-corruption layer, branch by abstraction, parallel run, data synchronization, and decommissioning.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about legacy modernization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-11",
    "slug": "fleet-and-control-plane-upgrades",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Fleet and control-plane upgrades",
    "summary": "version skew, quorum safety, draining, surge capacity, rollback, and compatibility.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about fleet and control-plane upgrades within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DEP-12",
    "slug": "organizational-architecture",
    "domainId": "domain-21",
    "domain": "Deployment, release, and system evolution",
    "title": "Organizational architecture",
    "summary": "ownership, Conway's Law, platform teams, service catalogs, golden paths, and cognitive load.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about organizational architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-01",
    "slug": "vms-containers-bare-metal-functions-and-managed-platforms",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "VMs, containers, bare metal, functions, and managed platforms",
    "summary": "isolation, startup, density, control, portability, and operations.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about vms, containers, bare metal, functions, and managed platforms within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-02",
    "slug": "container-images",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Container images",
    "summary": "layers, registries, immutability, provenance, vulnerability management, and runtime identity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about container images within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-03",
    "slug": "orchestrator-architecture",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Orchestrator architecture",
    "summary": "control plane, workers, desired state, reconciliation, scheduler, controllers, and backing store.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about orchestrator architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-04",
    "slug": "workload-controllers",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Workload controllers",
    "summary": "stateless replicas, stateful sets, daemon jobs, batch jobs, disruption, rollout, and identity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about workload controllers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-05",
    "slug": "service-networking",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Service networking",
    "summary": "service VIP/DNS, ingress, gateway, network policy, pod/task networking, and load balancing.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about service networking within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-06",
    "slug": "storage-orchestration",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Storage orchestration",
    "summary": "ephemeral versus persistent volumes, provisioning, attachment, locality, snapshots, and failure.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about storage orchestration within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-07",
    "slug": "scheduling-and-placement",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Scheduling and placement",
    "summary": "requests/limits, affinity, topology spread, taints, priorities, quotas, and preemption.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about scheduling and placement within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-08",
    "slug": "autoscaling-layers",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Autoscaling layers",
    "summary": "request/workload, node/cluster, vertical, event-driven, scheduling constraints, and capacity lag.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about autoscaling layers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-09",
    "slug": "multi-account-project-subscription-design",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Multi-account/project/subscription design",
    "summary": "isolation, billing, identity, policy, networking, logging, and organizational units.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about multi-account/project/subscription design within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-10",
    "slug": "hybrid-and-multi-cloud",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Hybrid and multi-cloud",
    "summary": "connectivity, identity, portability, consistent policy, data gravity, egress, failover, and operational complexity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about hybrid and multi-cloud within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-11",
    "slug": "platform-engineering",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Platform engineering",
    "summary": "self-service APIs, paved roads, templates, policy, observability, developer experience, and platform SLOs.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about platform engineering within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "PLAT-12",
    "slug": "control-plane-resilience",
    "domainId": "domain-22",
    "domain": "Containers, orchestration, and cloud platforms",
    "title": "Control-plane resilience",
    "summary": "reconciliation backlog, API overload, backing-store failure, split brain, upgrade, and disaster recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about control-plane resilience within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-01",
    "slug": "region-selection",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Region selection",
    "summary": "users, latency, services, capacity, cost, regulation, sustainability, and failure correlation.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about region selection within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-02",
    "slug": "active-passive-pilot-light-warm-standby-and-active-active-designs",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Active-passive, pilot-light, warm-standby, and active-active designs",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about active-passive, pilot-light, warm-standby, and active-active designs within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-03",
    "slug": "global-traffic-management",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Global traffic management",
    "summary": "DNS, anycast, global proxies, geo/proximity routing, health, weights, failover, and stale control data.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about global traffic management within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-04",
    "slug": "data-placement",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Data placement",
    "summary": "home region, local replicas, global tables, write locality, read locality, residency, and replication lag.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about data placement within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-05",
    "slug": "cross-region-consistency",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Cross-region consistency",
    "summary": "synchronous latency, asynchronous loss, conflict resolution, session guarantees, and partitions.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about cross-region consistency within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-06",
    "slug": "regional-evacuation",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Regional evacuation",
    "summary": "detection, traffic drain, dependency readiness, capacity, data promotion, validation, and failback.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about regional evacuation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-07",
    "slug": "dependency-mapping",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Dependency mapping",
    "summary": "region-scoped versus global services, hidden control-plane dependencies, certificates, identity, observability, and CI/CD.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about dependency mapping within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-08",
    "slug": "dr-objectives-and-tiers",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "DR objectives and tiers",
    "summary": "business impact, RTO/RPO, cost, automation, backup, replication, and test frequency.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about dr objectives and tiers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-09",
    "slug": "disaster-exercises",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Disaster exercises",
    "summary": "scenario, authority, communications, data integrity, recovery sequence, abort conditions, and lessons.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about disaster exercises within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "GEO-10",
    "slug": "sovereign-and-disconnected-operation",
    "domainId": "domain-23",
    "domain": "Multi-region, geo-distribution, and disaster recovery",
    "title": "Sovereign and disconnected operation",
    "summary": "local control planes, delayed synchronization, package distribution, key management, and audit.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about sovereign and disconnected operation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-01",
    "slug": "cost-model",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Cost model",
    "summary": "compute time, storage capacity/operations, network egress, managed-service units, licenses, support, and engineering labor.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about cost model within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-02",
    "slug": "unit-economics",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Unit economics",
    "summary": "cost per request, user, tenant, transaction, GB processed, model inference, and business outcome.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about unit economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-03",
    "slug": "provisioning-trade-offs",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Provisioning trade-offs",
    "summary": "on-demand, reservation/commitment, spot/preemptible, autoscaling, overprovisioning, and scarcity.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about provisioning trade-offs within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-04",
    "slug": "storage-lifecycle-economics",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Storage lifecycle economics",
    "summary": "hot/warm/cold/archive, retrieval fees, minimum duration, compression, deduplication, and deletion.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about storage lifecycle economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-05",
    "slug": "data-transfer-economics",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Data-transfer economics",
    "summary": "zones, regions, providers, CDN, replication, observability, backups, and data gravity.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about data-transfer economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-06",
    "slug": "finops",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "FinOps",
    "summary": "allocation, tagging, budgets, forecasts, anomaly detection, showback/chargeback, ownership, and optimization loops.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about finops within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-07",
    "slug": "cost-versus-reliability-performance-security",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Cost versus reliability/performance/security",
    "summary": "redundancy, headroom, premium services, encryption, observability, and recovery.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about cost versus reliability/performance/security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-08",
    "slug": "sustainability",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Sustainability",
    "summary": "energy proportionality, utilization, carbon-aware region/time, efficient algorithms, data minimization, hardware life, and measurement.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about sustainability within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-09",
    "slug": "waste-and-complexity",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Waste and complexity",
    "summary": "idle resources, zombie data, unused replicas, cardinality, over-retention, service sprawl, and operational burden.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about waste and complexity within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "COST-10",
    "slug": "build-versus-buy-economics",
    "domainId": "domain-24",
    "domain": "Cost, efficiency, and sustainability",
    "title": "Build-versus-buy economics",
    "summary": "staffing, opportunity cost, lock-in, scale discounts, migration cost, and exit strategy.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about build-versus-buy economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-01",
    "slug": "tenancy-models",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tenancy models",
    "summary": "shared everything, shared app/separate schema, separate database, separate stack, cells, and hybrid tiers.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about tenancy models within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-02",
    "slug": "tenant-identity-and-context-propagation",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tenant identity and context propagation",
    "summary": "authentication, routing, data access, background jobs, events, logs, and traces.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about tenant identity and context propagation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-03",
    "slug": "isolation",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Isolation",
    "summary": "data, compute, memory, connections, cache, queue, network, encryption keys, observability, and administration.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about isolation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-04",
    "slug": "fairness-and-noisy-neighbors",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Fairness and noisy neighbors",
    "summary": "quotas, rate limits, weighted scheduling, reserved capacity, burst credits, and admission control.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about fairness and noisy neighbors within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-05",
    "slug": "tenant-aware-partitioning",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tenant-aware partitioning",
    "summary": "shard keys, placement, large tenants, migration, residency, and hot tenants.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about tenant-aware partitioning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-06",
    "slug": "customization",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Customization",
    "summary": "configuration, schema extensions, workflows, feature flags, branding, and upgrade compatibility.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about customization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-07",
    "slug": "tenant-lifecycle",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tenant lifecycle",
    "summary": "provisioning, onboarding, trial, suspension, export, deletion, restore, and offboarding.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about tenant lifecycle within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-08",
    "slug": "tiered-service",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tiered service",
    "summary": "entitlements, SLOs, quotas, regions, support, pricing, and graceful limit behavior.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about tiered service within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-09",
    "slug": "control-plane-data-plane-separation",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Control-plane/data-plane separation",
    "summary": "global catalog, tenant routing, regional cells, management operations, and blast radius.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about control-plane/data-plane separation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEN-10",
    "slug": "tenant-observability-and-billing",
    "domainId": "domain-25",
    "domain": "Multi-tenancy and SaaS architecture",
    "title": "Tenant observability and billing",
    "summary": "usage metering, attribution, privacy, cardinality, reconciliation, and dispute handling.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about tenant observability and billing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-01",
    "slug": "test-pyramid-and-distributed-system-test-portfolio",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Test pyramid and distributed-system test portfolio",
    "summary": "unit, component, contract, integration, end-to-end, and production verification.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about test pyramid and distributed-system test portfolio within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-02",
    "slug": "contract-testing",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Contract testing",
    "summary": "provider/consumer compatibility, schemas, examples, evolution, and deployment gates.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about contract testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-03",
    "slug": "deterministic-simulation",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Deterministic simulation",
    "summary": "seeds, virtual time, controlled faults, repeatability, invariants, and model boundaries.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about deterministic simulation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-04",
    "slug": "fault-injection",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Fault injection",
    "summary": "process, network, storage, dependency, latency, corruption, clock, and resource faults.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about fault injection within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-05",
    "slug": "property-and-invariant-testing",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Property and invariant testing",
    "summary": "generated operations, safety, liveness proxies, state-machine models, and shrinking failures.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about property and invariant testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-06",
    "slug": "model-checking-and-formal-specification",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Model checking and formal specification",
    "summary": "state spaces, temporal properties, refinement, counterexamples, and limits.",
    "surfaces": [
      "A",
      "X"
    ],
    "authoring": {
      "outcome": "architect-handoff",
      "activity": "configure",
      "objectiveStem": "reason about model checking and formal specification within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use full scenarios and engine evidence in Architect mode."
    }
  },
  {
    "id": "TEST-07",
    "slug": "data-correctness-testing",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Data correctness testing",
    "summary": "reconciliation, checksums, shadow reads, dual-write comparison, replay, and drift detection.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about data correctness testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-08",
    "slug": "resilience-testing",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Resilience testing",
    "summary": "dependency loss, zone/region loss, overload, retry storms, failover, recovery, and steady-state hypotheses.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about resilience testing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-09",
    "slug": "performance-testing-correctness",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Performance testing correctness",
    "summary": "workload fidelity, coordinated omission, warm caches, saturation, percentiles, and environment variance.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about performance testing correctness within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-10",
    "slug": "architecture-fitness-functions",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Architecture fitness functions",
    "summary": "automated rules for dependencies, latency, cost, security, resilience, data ownership, and standards.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about architecture fitness functions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-11",
    "slug": "game-days-and-exercises",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Game days and exercises",
    "summary": "scenario design, roles, evidence, safety, runbooks, communication, and follow-up.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about game days and exercises within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "TEST-12",
    "slug": "production-verification",
    "domainId": "domain-26",
    "domain": "Testing, verification, and architecture fitness",
    "title": "Production verification",
    "summary": "canaries, synthetic probes, shadow traffic, real-user monitoring, feature experiments, and rollback triggers.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about production verification within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-01",
    "slug": "e-commerce",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "E-commerce",
    "summary": "catalog, inventory, cart, pricing, checkout, payment, order state, reservation, oversell prevention, and fulfillment.",
    "surfaces": [
      "C",
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about e-commerce within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-02",
    "slug": "payments-and-ledgers",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Payments and ledgers",
    "summary": "double-entry ledger, authorization/capture, idempotency, reconciliation, settlement, disputes, audit, and PCI boundaries.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about payments and ledgers within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-03",
    "slug": "booking-and-reservations",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Booking and reservations",
    "summary": "availability search, holds, expiry, contention, fairness, waitlists, overbooking, and confirmation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about booking and reservations within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-04",
    "slug": "social-feed",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Social feed",
    "summary": "fan-out-on-write/read, ranking, graph traversal, celebrity problem, privacy, moderation, freshness, and pagination.",
    "surfaces": [
      "C",
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about social feed within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-05",
    "slug": "messaging-and-chat",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Messaging and chat",
    "summary": "conversations, ordering scope, delivery/read receipts, presence, offline sync, attachments, groups, and encryption.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about messaging and chat within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-06",
    "slug": "collaborative-editing",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Collaborative editing",
    "summary": "operations, conflict-free merging/OT, presence, causality, offline edits, snapshots, and compaction.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about collaborative editing within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-07",
    "slug": "notifications",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Notifications",
    "summary": "preferences, templates, channel selection, fan-out, throttling, deduplication, scheduling, retries, and provider fallback.",
    "surfaces": [
      "C",
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about notifications within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-08",
    "slug": "search",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Search",
    "summary": "crawling/ingestion, parsing, indexing, ranking, query understanding, autocomplete, freshness, shards, and serving.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about search within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-09",
    "slug": "media-streaming",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Media streaming",
    "summary": "ingest, transcode, packaging, origin, CDN, adaptive bitrate, DRM, playback telemetry, and live latency.",
    "surfaces": [
      "C",
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about media streaming within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-10",
    "slug": "file-storage-and-synchronization",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "File storage and synchronization",
    "summary": "namespace, chunks, deduplication, upload resume, metadata, sharing, versioning, conflict, and offline sync.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about file storage and synchronization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-11",
    "slug": "geospatial-rides-delivery",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Geospatial/rides/delivery",
    "summary": "location updates, proximity search, matching, routing, ETA, geofencing, map tiles, and location privacy.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about geospatial/rides/delivery within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-12",
    "slug": "metrics-logging-tracing-platforms",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Metrics/logging/tracing platforms",
    "summary": "high-cardinality ingest, aggregation, indexing, sampling, retention, query fan-out, and tenant isolation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about metrics/logging/tracing platforms within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-13",
    "slug": "analytics-and-data-platforms",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Analytics and data platforms",
    "summary": "ingestion, lake/warehouse/lakehouse, ETL/ELT, orchestration, catalog, quality, batch/stream, and serving.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about analytics and data platforms within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-14",
    "slug": "iot",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "IoT",
    "summary": "device identity, provisioning, intermittent connectivity, telemetry, commands, digital twins, edge processing, firmware, and fleet safety.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about iot within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-15",
    "slug": "gaming",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Gaming",
    "summary": "session/matchmaking, authoritative state, tick rate, latency, cheating, regional placement, persistence, and leaderboards.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about gaming within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-16",
    "slug": "ad-serving",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Ad serving",
    "summary": "targeting, auctions, budget pacing, low latency, frequency capping, attribution, fraud, privacy, and reporting.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about ad serving within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-17",
    "slug": "recommendation-systems",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Recommendation systems",
    "summary": "candidates, ranking, features, freshness, online/offline consistency, experimentation, feedback loops, and bias.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about recommendation systems within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-18",
    "slug": "email",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Email",
    "summary": "submission, routing, queues, reputation, spam filtering, mailbox storage, search, synchronization, and deliverability.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about email within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-19",
    "slug": "web-crawling",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Web crawling",
    "summary": "frontier, politeness, robots rules, deduplication, recrawl, prioritization, distributed scheduling, and content storage.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "compare",
      "objectiveStem": "reason about web crawling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-20",
    "slug": "identity-platform",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Identity platform",
    "summary": "directory, credentials, federation, sessions, tokens, risk, recovery, revocation, audit, and high availability.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identity platform within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-21",
    "slug": "feature-flag-configuration-service",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Feature-flag/configuration service",
    "summary": "low-latency reads, streaming updates, targeting, consistency, audit, rollout, and fail-safe defaults.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about feature-flag/configuration service within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-22",
    "slug": "rate-limit-service",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Rate-limit service",
    "summary": "distributed counters, windows, token buckets, consistency, locality, fail-open/closed, and fairness.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about rate-limit service within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-23",
    "slug": "unique-id-service",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Unique-ID service",
    "summary": "uniqueness, ordering, throughput, clock failure, coordination, region allocation, and privacy.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about unique-id service within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-24",
    "slug": "workflow-durable-execution",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Workflow/durable execution",
    "summary": "state persistence, timers, retries, compensation, versioning, signals, determinism, and operator intervention.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about workflow/durable execution within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-25",
    "slug": "blockchain-distributed-ledger",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Blockchain/distributed ledger",
    "summary": "consensus, mempool, blocks, finality, forks, smart contracts, state, fees, and Byzantine assumptions.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about blockchain/distributed ledger within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "DOM-26",
    "slug": "edge-offline-first-systems",
    "domainId": "domain-27",
    "domain": "Domain archetypes and their distinctive concepts",
    "title": "Edge/offline-first systems",
    "summary": "local state, synchronization, conflicts, intermittent links, bandwidth, trust, updates, and fleet management.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about edge/offline-first systems within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-01",
    "slug": "ml-lifecycle",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "ML lifecycle",
    "summary": "data, training, evaluation, registry, deployment, inference, monitoring, feedback, and retraining.",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about ml lifecycle within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-02",
    "slug": "training-architecture",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Training architecture",
    "summary": "data pipelines, distributed training, checkpoints, accelerators, parallelism, fault recovery, and experiment tracking.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about training architecture within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-03",
    "slug": "online-inference",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Online inference",
    "summary": "model servers, batching, latency, throughput, autoscaling, accelerators, warmup, and fallback models.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about online inference within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-04",
    "slug": "offline-batch-inference",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Offline/batch inference",
    "summary": "partitioning, orchestration, cost, checkpointing, retries, and output versioning.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about offline/batch inference within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-05",
    "slug": "feature-platforms",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Feature platforms",
    "summary": "offline/online stores, point-in-time correctness, freshness, backfill, reuse, lineage, and training-serving skew.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about feature platforms within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-06",
    "slug": "model-lifecycle",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Model lifecycle",
    "summary": "versioning, registry, promotion, canary, shadow, rollback, ensemble, and deprecation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about model lifecycle within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-07",
    "slug": "ml-observability",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "ML observability",
    "summary": "quality, drift, skew, latency, saturation, fairness, safety, cost, and feedback delay.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about ml observability within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-08",
    "slug": "retrieval-augmented-generation",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Retrieval-augmented generation",
    "summary": "ingestion, chunking, embeddings, vector search, hybrid retrieval, reranking, context assembly, and citations.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about retrieval-augmented generation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-09",
    "slug": "llm-serving",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "LLM serving",
    "summary": "tokenization, prefill/decode, KV cache, continuous batching, quantization, model parallelism, routing, and speculative decoding.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about llm serving within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-10",
    "slug": "llm-application-reliability",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "LLM application reliability",
    "summary": "timeouts, fallbacks, structured output, validation, retries, nondeterminism, caching, and graceful degradation.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about llm application reliability within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-11",
    "slug": "agent-systems",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Agent systems",
    "summary": "tools, planning, memory, state, permissions, orchestration, human approval, loop limits, and recovery.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about agent systems within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-12",
    "slug": "ai-safety-and-security",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "AI safety and security",
    "summary": "prompt injection, data exfiltration, untrusted tool output, sandboxing, policy enforcement, and audit.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about ai safety and security within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-13",
    "slug": "ai-privacy-governance",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "AI privacy/governance",
    "summary": "training consent, sensitive data, residency, retention, model leakage, access control, provenance, and explainability.",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about ai privacy/governance within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-14",
    "slug": "evaluation",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "Evaluation",
    "summary": "offline datasets, online experiments, human review, task success, factuality, safety, regressions, and adversarial testing.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about evaluation within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "AI-15",
    "slug": "ai-economics",
    "domainId": "domain-28",
    "domain": "AI/ML and LLM system design",
    "title": "AI economics",
    "summary": "token/accelerator cost, routing, caching, batching, quality tiers, latency, utilization, and carbon/energy impact.",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about ai economics within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-01",
    "slug": "single-points-of-failure-and-hidden-shared-dependencies",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Single points of failure and hidden shared dependencies",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about single points of failure and hidden shared dependencies within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-02",
    "slug": "premature-distribution-needless-microservices-and-accidental-complexity",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Premature distribution, needless microservices, and accidental complexity",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about premature distribution, needless microservices, and accidental complexity within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-03",
    "slug": "scaling-the-wrong-bottleneck-and-assuming-horizontal-scaling-solves-state-or-contention",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Scaling the wrong bottleneck and assuming horizontal scaling solves state or contention",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about scaling the wrong bottleneck and assuming horizontal scaling solves state or contention within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-04",
    "slug": "chatty-interfaces-synchronous-dependency-chains-and-excessive-fan-out",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Chatty interfaces, synchronous dependency chains, and excessive fan-out",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about chatty interfaces, synchronous dependency chains, and excessive fan-out within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-05",
    "slug": "shared-database-coupling-and-cross-service-ownership-ambiguity",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Shared database coupling and cross-service ownership ambiguity",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about shared database coupling and cross-service ownership ambiguity within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-06",
    "slug": "distributed-monoliths-coordinated-deploys-shared-failure-and-weak-service-boundaries",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Distributed monoliths: coordinated deploys, shared failure, and weak service boundaries",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about distributed monoliths: coordinated deploys, shared failure, and weak service boundaries within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-07",
    "slug": "unbounded-queues-concurrency-retries-cardinality-data-growth-and-retention",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Unbounded queues, concurrency, retries, cardinality, data growth, and retention",
    "summary": "",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about unbounded queues, concurrency, retries, cardinality, data growth, and retention within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-08",
    "slug": "retry-storms-thundering-herds-cache-stampedes-and-autoscaling-feedback-loops",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Retry storms, thundering herds, cache stampedes, and autoscaling feedback loops",
    "summary": "",
    "surfaces": [
      "G",
      "A"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about retry storms, thundering herds, cache stampedes, and autoscaling feedback loops within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-09",
    "slug": "assuming-exactly-once-global-ordering-zero-downtime-migration-or-automatic-failover-without-defining-scope-and-failure-cases",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Assuming exactly-once, global ordering, zero-downtime migration, or automatic failover without defining scope and failure cases",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about assuming exactly-once, global ordering, zero-downtime migration, or automatic failover without defining scope and failure cases within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-10",
    "slug": "treating-replicas-as-backups-or-health-checks-as-proof-of-correctness",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Treating replicas as backups or health checks as proof of correctness",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about treating replicas as backups or health checks as proof of correctness within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-11",
    "slug": "ignoring-deletion-schema-evolution-backfill-rollback-and-operability",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Ignoring deletion, schema evolution, backfill, rollback, and operability",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about ignoring deletion, schema evolution, backfill, rollback, and operability within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-12",
    "slug": "security-only-at-the-perimeter-implicit-internal-trust-shared-credentials-and-missing-object-level-authorization",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Security only at the perimeter, implicit internal trust, shared credentials, and missing object-level authorization",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about security only at the perimeter, implicit internal trust, shared credentials, and missing object-level authorization within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-13",
    "slug": "monitoring-everything-without-a-question-slo-cardinality-budget-retention-plan-or-actionable-response",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Monitoring everything without a question, SLO, cardinality budget, retention plan, or actionable response",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about monitoring everything without a question, slo, cardinality budget, retention plan, or actionable response within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-14",
    "slug": "multi-region-architecture-without-dependency-capacity-data-failback-and-exercise-planning",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Multi-region architecture without dependency, capacity, data, failback, and exercise planning",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about multi-region architecture without dependency, capacity, data, failback, and exercise planning within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "ANTI-15",
    "slug": "product-name-architecture-choosing-technologies-before-requirements-access-patterns-failure-model-and-trade-offs-are-understood",
    "domainId": "domain-29",
    "domain": "Architecture anti-patterns and failure lessons",
    "title": "Product-name architecture: choosing technologies before requirements, access patterns, failure model, and trade-offs are understood",
    "summary": "",
    "surfaces": [
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about product-name architecture: choosing technologies before requirements, access patterns, failure model, and trade-offs are understood within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-01",
    "slug": "identify-the-system-s-critical-path",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify the system's critical path",
    "summary": "",
    "surfaces": [
      "C"
    ],
    "authoring": {
      "outcome": "external-lab",
      "activity": "explain",
      "objectiveStem": "reason about identify the system's critical path within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [],
      "compatibleChecks": [],
      "boundary": "Use an explanation or external lab until the simulator has honest evidence for this concept."
    }
  },
  {
    "id": "XR-02",
    "slug": "identify-state-ownership-and-the-source-of-truth",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify state, ownership, and the source of truth",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify state, ownership, and the source of truth within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-03",
    "slug": "identify-trust-boundaries-and-authorization-decisions",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify trust boundaries and authorization decisions",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify trust boundaries and authorization decisions within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-04",
    "slug": "identify-scaling-units-and-independent-bottlenecks",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify scaling units and independent bottlenecks",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify scaling units and independent bottlenecks within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-05",
    "slug": "identify-consistency-scope-object-key-partition-tenant-region-or-global",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify consistency scope: object, key, partition, tenant, region, or global",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "design",
      "objectiveStem": "reason about identify consistency scope: object, key, partition, tenant, region, or global within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-06",
    "slug": "identify-ordering-scope-and-whether-ordering-is-actually-required",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify ordering scope and whether ordering is actually required",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify ordering scope and whether ordering is actually required within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-07",
    "slug": "identify-failure-domains-and-correlated-failures",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify failure domains and correlated failures",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "diagnose",
      "objectiveStem": "reason about identify failure domains and correlated failures within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-08",
    "slug": "identify-overload-behavior-before-adding-retries-or-autoscaling",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify overload behavior before adding retries or autoscaling",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "configure",
      "objectiveStem": "reason about identify overload behavior before adding retries or autoscaling within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-09",
    "slug": "identify-which-data-may-be-stale-lost-duplicated-reordered-or-temporarily-unavailable",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify which data may be stale, lost, duplicated, reordered, or temporarily unavailable",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify which data may be stale, lost, duplicated, reordered, or temporarily unavailable within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-10",
    "slug": "identify-the-recovery-path-not-just-the-steady-state-path",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify the recovery path, not just the steady-state path",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify the recovery path, not just the steady-state path within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-11",
    "slug": "identify-how-the-system-is-observed-operated-changed-and-rolled-back",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify how the system is observed, operated, changed, and rolled back",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify how the system is observed, operated, changed, and rolled back within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-12",
    "slug": "identify-privacy-deletion-audit-and-regulatory-obligations",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Identify privacy, deletion, audit, and regulatory obligations",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about identify privacy, deletion, audit, and regulatory obligations within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-13",
    "slug": "quantify-cost-headroom-and-the-price-of-each-quality-attribute",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Quantify cost, headroom, and the price of each quality attribute",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "estimate",
      "objectiveStem": "reason about quantify cost, headroom, and the price of each quality attribute within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-14",
    "slug": "state-the-modeling-boundary-and-what-the-evidence-does-not-prove",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "State the modeling boundary and what the evidence does not prove",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about state the modeling boundary and what the evidence does not prove within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  },
  {
    "id": "XR-15",
    "slug": "compare-at-least-one-credible-alternative-and-name-the-condition-under-which-it-would-be-preferable",
    "domainId": "domain-30",
    "domain": "Cross-cutting reasoning every question can teach",
    "title": "Compare at least one credible alternative and name the condition under which it would be preferable",
    "summary": "",
    "surfaces": [
      "C",
      "G"
    ],
    "authoring": {
      "outcome": "guided",
      "activity": "explain",
      "objectiveStem": "reason about compare at least one credible alternative and name the condition under which it would be preferable within its stated model boundary",
      "requiredGivens": [],
      "recommendedCards": [],
      "allowedDecisionKinds": [
        "guided-knob"
      ],
      "compatibleChecks": [],
      "boundary": "Use curated Guided controls and explicit evidence; the current Classroom check set is insufficient."
    }
  }
] as const
