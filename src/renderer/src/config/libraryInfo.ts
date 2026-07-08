export interface LibraryItemInfo {
  represents: string
  realWorld: string
  config: string[]
}

interface LibraryInfoInput {
  id: string
  label: string
  subLabel: string
}

const DEFAULT_CONFIG = ['label', 'queue/workers', 'processing latency', 'node health']

const INFO_BY_ID: Record<string, LibraryItemInfo> = {
  'client-user': {
    represents: 'People or client apps that start requests and create traffic for the system.',
    realWorld: 'Browser, mobile app, IoT device, or API consumer.',
    config: ['workload pattern', 'base RPS', 'request type']
  },
  'input-source': {
    represents: 'A configurable source that generates requests when you need synthetic load.',
    realWorld: 'Synthetic load generator or upstream client.',
    config: ['workload pattern', 'base RPS', 'request size']
  },
  'output-sink': {
    represents: 'The final endpoint where a request flow ends after passing through the system.',
    realWorld: 'Webhook receiver, external sink, or final consumer.',
    config: ['label', 'processing latency', 'SLO']
  },
  'external-service': {
    represents: 'A dependency your system calls but does not own or control directly.',
    realWorld: 'Payment provider, email API, maps API, or SaaS API.',
    config: ['latency', 'timeout', 'node health']
  },
  dns: {
    represents: 'Translates a domain or service name into the network address traffic should use.',
    realWorld: 'Route 53, Cloud DNS, CoreDNS, or public DNS.',
    config: ['latency', 'TTL model', 'failure rate']
  },
  'dns-server': {
    represents: 'Provides name lookup inside the system so services can find each other.',
    realWorld: 'CoreDNS, BIND, Route 53 Resolver.',
    config: ['latency', 'cache behavior', 'node health']
  },
  cdn: {
    represents: 'Serves cached content from locations close to users to reduce origin load.',
    realWorld: 'CloudFront, Cloudflare, Fastly, Akamai.',
    config: ['cache hit ratio', 'edge latency', 'origin fallback']
  },
  'api-gateway': {
    represents: 'The public API entry point that can authenticate, throttle, and route requests.',
    realWorld: 'Kong, AWS API Gateway, Apigee, NGINX gateway.',
    config: ['routing strategy', 'rate limits', 'auth/error rate']
  },
  'load-balancer': {
    represents:
      'Distributes incoming traffic across multiple backend targets for scale and resilience.',
    realWorld: 'Classic ELB, HAProxy, NGINX, Envoy.',
    config: ['routing strategy', 'target health', 'edge latency']
  },
  'load-balancer-l4': {
    represents: 'Routes TCP/UDP connections without inspecting HTTP paths, headers, or payloads.',
    realWorld: 'AWS NLB, HAProxy TCP mode, LVS.',
    config: ['routing strategy', 'TCP/UDP protocol', 'target health']
  },
  'load-balancer-l7': {
    represents:
      'Routes HTTP/gRPC requests using application details such as host, path, or method.',
    realWorld: 'AWS ALB, Envoy, NGINX, HAProxy HTTP mode.',
    config: ['routing rules', 'target health', 'HTTP/gRPC latency']
  },
  'ingress-controller': {
    represents: 'Routes external traffic into a cluster and maps host/path rules to services.',
    realWorld: 'NGINX Ingress, Traefik, ALB Ingress Controller.',
    config: ['host/path rules', 'TLS termination', 'target health']
  },
  'reverse-proxy': {
    represents:
      'Sits before services to forward requests, terminate TLS, buffer, or route traffic.',
    realWorld: 'NGINX, Envoy, Apache Traffic Server.',
    config: ['routing rules', 'timeout', 'connection limits']
  },
  'service-mesh': {
    represents:
      'Adds traffic policy, retries, security, and observability between internal services.',
    realWorld: 'Istio, Linkerd, Consul Connect.',
    config: ['retry policy', 'mTLS', 'traffic split']
  },
  'nat-gateway': {
    represents:
      'Lets private resources make outbound network calls without exposing them publicly.',
    realWorld: 'AWS NAT Gateway, Cloud NAT, iptables NAT.',
    config: ['bandwidth', 'connection limit', 'latency']
  },
  'vpn-gateway': {
    represents: 'Connects two networks through an encrypted tunnel, usually across the internet.',
    realWorld: 'IPsec VPN, WireGuard, AWS VPN Gateway.',
    config: ['latency', 'bandwidth', 'packet loss']
  },
  'edge-router': {
    represents: 'Moves traffic between networks at the system boundary using routing policies.',
    realWorld: 'BGP edge router, cloud router, transit router.',
    config: ['routing policy', 'latency', 'packet loss']
  },
  'network-interface': {
    represents: 'Represents the network attachment a node uses to send and receive traffic.',
    realWorld: 'ENI, NIC, VPC interface endpoint.',
    config: ['bandwidth', 'protocol', 'packet loss']
  },
  'routing-rule': {
    represents: 'A rule that matches request properties and chooses where matching traffic goes.',
    realWorld: 'ALB listener rule, NGINX location block.',
    config: ['condition', 'target edge', 'priority']
  },
  'routing-policy': {
    represents: 'Defines how traffic is split, failed over, or prioritized across targets.',
    realWorld: 'Weighted routing, failover routing, canary split.',
    config: ['weights', 'failover target', 'conditions']
  },
  waf: {
    represents: 'Filters web requests before they reach services and blocks suspicious traffic.',
    realWorld: 'AWS WAF, Cloudflare WAF, ModSecurity.',
    config: ['block rate', 'rules', 'latency overhead']
  },
  'firewall-rule': {
    represents: 'A low-level rule that allows or blocks traffic based on network properties.',
    realWorld: 'iptables rule, cloud firewall rule, NACL.',
    config: ['protocol', 'allow/deny', 'source/target']
  },
  'security-group': {
    represents:
      'A stateful access policy attached to resources to control inbound/outbound traffic.',
    realWorld: 'AWS Security Group, Azure NSG.',
    config: ['inbound rules', 'outbound rules', 'protocol']
  },
  'backend-server': {
    represents: 'A long-running service that receives requests, does work, and returns responses.',
    realWorld: 'Node.js/Java/Go service on VM, container, or pod.',
    config: ['workers', 'queue capacity', 'processing latency']
  },
  'lambda-function': {
    represents: 'A short-lived function that runs only when triggered by an event or request.',
    realWorld: 'AWS Lambda, Cloud Functions, Azure Functions.',
    config: ['timeout', 'cold-start latency', 'concurrency']
  },
  'async-worker': {
    represents:
      'A background worker that pulls jobs from a queue and processes them asynchronously.',
    realWorld: 'Celery worker, Sidekiq, BullMQ, Kubernetes job worker.',
    config: ['workers', 'queue capacity', 'service time']
  },
  'cron-job': {
    represents: 'A task that runs on a schedule instead of being triggered by user traffic.',
    realWorld: 'Kubernetes CronJob, crontab, Cloud Scheduler.',
    config: ['schedule rate', 'service time', 'timeout']
  },
  'auth-service': {
    represents: 'Validates identity, tokens, and permissions before requests continue.',
    realWorld: 'OAuth service, Auth0, Cognito, custom auth API.',
    config: ['latency', 'error rate', 'capacity']
  },
  'search-service': {
    represents: 'Handles user or service search queries and returns matching results.',
    realWorld: 'Elasticsearch API, OpenSearch service, Solr service.',
    config: ['query latency', 'workers', 'SLO']
  },
  'sidecar-proxy': {
    represents: 'A small proxy deployed beside a service to control its inbound/outbound traffic.',
    realWorld: 'Envoy sidecar, Linkerd proxy.',
    config: ['latency overhead', 'retry policy', 'timeout']
  },
  'primary-db': {
    represents: 'The main transactional database that stores authoritative application data.',
    realWorld: 'PostgreSQL, MySQL, Aurora, Cloud SQL.',
    config: ['service time', 'queue capacity', 'availability target']
  },
  'read-replica': {
    represents: 'A read-only copy of a database used to scale read traffic away from the primary.',
    realWorld: 'Postgres replica, Aurora reader, MySQL replica.',
    config: ['replication lag', 'read latency', 'node health']
  },
  'redis-cache': {
    represents: 'An in-memory store used to return frequently used data with very low latency.',
    realWorld: 'Redis, Memcached, ElastiCache.',
    config: ['hit ratio', 'latency', 'capacity']
  },
  'message-queue': {
    represents: 'Buffers work between producers and consumers so processing can happen later.',
    realWorld: 'SQS, RabbitMQ queue, Azure Queue.',
    config: ['queue capacity', 'consumer rate', 'visibility timeout']
  },
  'message-broker': {
    represents: 'Receives messages and routes them to queues or consumers based on broker rules.',
    realWorld: 'RabbitMQ, ActiveMQ, NATS.',
    config: ['fanout mode', 'throughput', 'retention']
  },
  'pub-sub': {
    represents: 'Lets producers publish events once and deliver them to many subscribers.',
    realWorld: 'Google Pub/Sub, SNS, NATS topics.',
    config: ['subscriber count', 'delivery latency', 'retry policy']
  },
  stream: {
    represents: 'Stores ordered events so consumers can read and process them over time.',
    realWorld: 'Kafka, Kinesis, Pulsar.',
    config: ['partitions', 'retention', 'consumer lag']
  },
  'nosql-db': {
    represents: 'Stores data outside a strict relational model for flexible or high-scale access.',
    realWorld: 'DynamoDB, MongoDB, Cassandra.',
    config: ['read/write capacity', 'latency', 'consistency']
  },
  'object-storage': {
    represents: 'Stores files and blobs such as images, videos, backups, and exports.',
    realWorld: 'S3, GCS, Azure Blob Storage.',
    config: ['object size', 'throughput', 'latency']
  },
  'search-index': {
    represents: 'Indexes data so users can search text, filters, and facets quickly.',
    realWorld: 'Elasticsearch, OpenSearch, Solr.',
    config: ['index latency', 'query latency', 'replicas']
  },
  'time-series-db': {
    represents: 'Stores timestamped data such as metrics, events, and sensor readings.',
    realWorld: 'Prometheus, InfluxDB, TimescaleDB.',
    config: ['ingest rate', 'retention', 'query latency']
  },
  'graph-db': {
    represents: 'Stores entities and relationships so connected data can be traversed efficiently.',
    realWorld: 'Neo4j, Neptune, JanusGraph.',
    config: ['traversal depth', 'query latency', 'capacity']
  },
  'vector-db': {
    represents:
      'Stores embeddings so similar text, images, or items can be retrieved semantically.',
    realWorld: 'Pinecone, Weaviate, Milvus, pgvector.',
    config: ['index size', 'query latency', 'recall/precision']
  },
  'data-warehouse': {
    represents: 'Stores structured data for analytics, dashboards, and large reporting queries.',
    realWorld: 'Snowflake, BigQuery, Redshift.',
    config: ['query latency', 'warehouse size', 'concurrency']
  },
  'data-lake': {
    represents: 'Stores large volumes of raw or semi-structured data for later processing.',
    realWorld: 'S3 data lake, Delta Lake, Iceberg tables.',
    config: ['object throughput', 'partitioning', 'scan latency']
  },
  'kv-store': {
    represents: 'Stores and retrieves values by key for fast lookups and simple state.',
    realWorld: 'DynamoDB KV table, Redis KV, RocksDB service.',
    config: ['read/write latency', 'capacity', 'TTL']
  },
  'push-notification-service': {
    represents: 'Sends notifications from the backend to user devices or client apps.',
    realWorld: 'FCM, APNs, SNS Mobile Push.',
    config: ['fanout rate', 'provider latency', 'failure rate']
  },
  'streaming-analytics': {
    represents: 'Processes incoming event streams continuously to compute near-real-time results.',
    realWorld: 'Flink, Spark Streaming, Kafka Streams.',
    config: ['window size', 'parallelism', 'processing latency']
  },
  'llm-gateway': {
    represents: 'Routes AI requests to models while applying limits, policies, and observability.',
    realWorld: 'LLM proxy, LiteLLM, model gateway.',
    config: ['model route', 'rate limit', 'timeout']
  },
  'tool-registry': {
    represents: 'Lists the tools an agent can call and stores metadata needed to invoke them.',
    realWorld: 'MCP registry, plugin registry, internal tool catalog.',
    config: ['tool count', 'lookup latency', 'availability']
  },
  'memory-fabric': {
    represents: 'Stores context or memories that agents can retrieve across tasks and sessions.',
    realWorld: 'Vector memory, Redis memory, knowledge store.',
    config: ['retrieval latency', 'memory size', 'TTL']
  },
  'agent-orchestrator': {
    represents: 'Coordinates multi-step agent work by planning, delegating, and tracking progress.',
    realWorld: 'Agent runtime, workflow orchestrator, LangGraph service.',
    config: ['concurrency', 'tool latency', 'retry policy']
  },
  'safety-observability-mesh': {
    represents: 'Adds guardrails, audits, and monitoring around AI requests and responses.',
    realWorld: 'Policy engine, prompt firewall, eval/trace monitor.',
    config: ['block rate', 'audit latency', 'alert threshold']
  },
  'generic-service': {
    represents: 'A flexible placeholder when the exact service type is not important yet.',
    realWorld: 'Any internal service.',
    config: DEFAULT_CONFIG
  },
  'my-service': {
    represents: 'A custom service owned by your system that you can configure for the scenario.',
    realWorld: 'Any team-owned application component.',
    config: DEFAULT_CONFIG
  },
  'vpc-region': {
    represents: 'A top-level cloud network area where resources are grouped by region.',
    realWorld: 'AWS/GCP/Azure region-level VPC/VNet.',
    config: ['region', 'CIDR', 'child resources']
  },
  'availability-zone': {
    represents: 'A separate failure domain inside a region for spreading resilient deployments.',
    realWorld: 'AWS AZ, GCP zone, Azure availability zone.',
    config: ['zone', 'capacity', 'failure domain']
  },
  subnet: {
    represents: 'A smaller IP range inside a network that groups related resources.',
    realWorld: 'VPC subnet or VNet subnet.',
    config: ['CIDR', 'routing table', 'public/private mode']
  },
  'discovery-service': {
    represents: 'Keeps track of service instances so callers can find healthy destinations.',
    realWorld: 'Consul, Eureka, Kubernetes Service discovery.',
    config: ['TTL', 'registry latency', 'health source']
  },
  sharding: {
    represents: 'A strategy for splitting data across shards so one node does not hold everything.',
    realWorld: 'Range/hash sharding strategy.',
    config: ['shard key', 'shard count', 'rebalance policy']
  },
  hashing: {
    represents: 'Maps keys to shards or nodes so data and traffic are distributed predictably.',
    realWorld: 'Consistent hashing ring, rendezvous hashing.',
    config: ['hash key', 'virtual nodes', 'replication factor']
  },
  'shard-node': {
    represents: 'One shard that owns a subset of data or traffic in a partitioned system.',
    realWorld: 'Database shard, Kafka partition owner.',
    config: ['capacity', 'replica count', 'node health']
  },
  'partition-node': {
    represents: 'A partition that handles one slice of traffic or data for horizontal scaling.',
    realWorld: 'Kafka partition, DynamoDB partition, DB partition.',
    config: ['partition key', 'throughput', 'hotspot risk']
  },
  'config-store': {
    represents: 'Stores runtime settings that services read without requiring code changes.',
    realWorld: 'etcd, Consul KV, AWS AppConfig.',
    config: ['read latency', 'availability', 'update rate']
  },
  'secrets-manager': {
    represents: 'Stores sensitive values such as passwords, tokens, and certificates securely.',
    realWorld: 'AWS Secrets Manager, Vault, Secret Manager.',
    config: ['lookup latency', 'rotation interval', 'availability']
  },
  'feature-flag-service': {
    represents: 'Controls feature rollout by evaluating flags while the system is running.',
    realWorld: 'LaunchDarkly, Unleash, ConfigCat.',
    config: ['evaluation latency', 'flag count', 'availability']
  },
  'metrics-collector-agent': {
    represents: 'Collects numeric signals like latency, throughput, errors, and resource usage.',
    realWorld: 'Prometheus agent, Datadog agent, OpenTelemetry collector.',
    config: ['scrape interval', 'sample rate', 'export latency']
  },
  'log-collector-agent': {
    represents: 'Reads logs from services or hosts and forwards them to a central system.',
    realWorld: 'Fluent Bit, Filebeat, Vector.',
    config: ['batch size', 'flush interval', 'drop rate']
  },
  'log-aggregation-service': {
    represents: 'Stores logs from many services so they can be searched and investigated.',
    realWorld: 'ELK, Loki, Splunk.',
    config: ['ingest rate', 'retention', 'query latency']
  },
  'distributed-tracing-collector': {
    represents: 'Collects request traces so a flow can be followed across multiple services.',
    realWorld: 'OpenTelemetry Collector, Jaeger collector.',
    config: ['sample rate', 'batch size', 'export latency']
  },
  'alerting-engine': {
    represents: 'Checks metrics or logs against rules and notifies people when something is wrong.',
    realWorld: 'Alertmanager, PagerDuty rules, Datadog monitors.',
    config: ['threshold', 'evaluation interval', 'notification latency']
  },
  'health-check-monitor': {
    represents: 'Periodically checks whether services are reachable and healthy.',
    realWorld: 'ALB health checks, Kubernetes probes, synthetic monitors.',
    config: ['check interval', 'failure threshold', 'recovery threshold']
  }
}

export function getLibraryItemInfo(item: LibraryInfoInput): LibraryItemInfo {
  return (
    INFO_BY_ID[item.id] ?? {
      represents: item.subLabel || `A ${item.label.toLowerCase()} component in the topology.`,
      realWorld: item.label,
      config: DEFAULT_CONFIG
    }
  )
}
