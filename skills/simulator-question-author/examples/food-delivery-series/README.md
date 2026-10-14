# Food Delivery Series

Five questions written from one HLD PDF, in the PDF's order. Each question
extends the previous design and grades only what it adds; earlier lessons are
carried forward as presence. Every folder holds the four required artifacts plus
the browser-safe student assignment.

| Folder                                  | PDF question                       | Sanity | Carried forward | Core |
| --------------------------------------- | ---------------------------------- | -----: | --------------: | ---: |
| `01-load-balancer-and-queue`            | Q1 Load Balancer + Queue Design    |      4 |               0 |    4 |
| `02-api-gateway`                        | Q2 Add API Gateway                 |      4 |               0 |    5 |
| `03-kafka-event-processing`             | Q3 Add Kafka Event Processing      |      5 |               1 |    2 |
| `04-read-write-database-architecture`   | Database Architecture (read/write) |      5 |               2 |    4 |
| `05-database-sharding-at-massive-scale` | Database Sharding at Massive Scale |      5 |               2 |    5 |

What to read in each `*.coverage.json`:

- `graded` bullets name the single check that grades them;
- `covered` bullets point at checks that already grade them (for example, the
  PDF's "Load Balancer" concept is the shared balancer-in-the-middle sanity rule);
- `explained` bullets are context or tolerated behavior, such as "During peak
  hours, order processing may become slower", and are not graded;
- `advisories` explain each Question Studio advisory that is left in place.

Validate one question:

```bash
node scripts/validate-artifacts.mjs examples/food-delivery-series/02-api-gateway food-delivery-api-gateway
```
