# QuickCart Flash Sale — Lecture Sheet

Question ID: `quickcart-flash-sale`

## Learning objectives

- Explain why a load balancer enables horizontal scaling.
- Calculate a server fleet from peak traffic, per-server capacity, and headroom.
- Explain why capacity planning rounds up and targets less than 100% utilization.

## Givens

| Component | Given                                         |
| --------- | --------------------------------------------- |
| Users     | 1,000,000 requests per second at peak         |
| Server    | 100,000 requests per second per copy          |
| Server    | $0.192 per hour per copy                      |
| Rule      | Keep every server at or below 80% utilization |
| Rule      | Drop fewer than 1% of requests                |

## Napkin model

Usable capacity per server is `100,000 × 0.80 = 80,000 req/s`.

Required servers are `ceil(1,000,000 ÷ 80,000) = ceil(12.5) = 13`.

## Answer key

| Design                             | Expected result | Why                                                  |
| ---------------------------------- | --------------- | ---------------------------------------------------- |
| Users → 13 Servers                 | Fail            | There is no load balancer in the traffic path.       |
| Users → Load Balancer → 8 Servers  | Fail            | Offered traffic exceeds total server capacity.       |
| Users → Load Balancer → 10 Servers | Fail            | Servers are at 100%; there is no headroom.           |
| Users → Load Balancer → 12 Servers | Fail            | Each server is at about 83.3%, above the 80% target. |
| Users → Load Balancer → 13 Servers | Pass            | Each server is at about 76.9%, below the target.     |

## Expected wrong answers

| Wrong design                    | What it means                               | What to say                                                                   |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| 10 servers                      | Planned to theoretical capacity             | “What happens to headroom when every server is already at 100%?”              |
| 12 servers                      | Rounded down after applying headroom        | “Capacity planning rounds the required fleet up, not to the nearest integer.” |
| 20 servers                      | Correct but substantially overprovisioned   | “It works; now find the smallest fleet that preserves the target.”            |
| Servers without a load balancer | Added capacity without traffic distribution | “Which component makes all those copies participate in serving traffic?”      |

## Lecture steps

1. Place Users → Load Balancer → Server ×1. Predict the utilization, then run.
2. Change to Server ×10. Connect 100% utilization to the absence of headroom.
3. Change to Server ×12. Compare 83.3% with the 80% rule.
4. Change to Server ×13. Close with the 76.9% result and the round-up rule.
