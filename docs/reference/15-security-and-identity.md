# 15. Security and identity

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

The 11 `SecurityType`s: `iam-rbac`, `waf`, `firewall`, `bastion-host`, `certificate-authority`,
`secrets-rotation`, `kms-security`, `dlp-inspection`, `identity-provider`, `siem`,
`privilege-escalation-control`. Related: TLS handshake round trips (chapter 08), rate limiting and abuse
control (chapter 02), certificates and DNS (chapter 21), third-party identity (chapter 20).

## 1. Security as a cost on the path

Security controls are not free boxes: each one adds latency, consumes CPU, can **reject** traffic (rightly or
wrongly) and can fail. A security hop therefore shows up in the same three places as any other component: latency,
capacity and error rate. [D]

| Control                      | Cost on a request                                                                                                           | Can reject                 | Failure presents as                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| Authentication (token check) | local signature verification (microseconds to a millisecond) or a remote call to the identity provider (network round trip) | 401 (no or bad credential) | login outage, if every request needs a live provider call |
| Authorization (IAM, RBAC)    | policy evaluation, usually microseconds                                                                                     | 403                        | wrong permission denied or granted                        |
| WAF                          | inspects headers and body; cost grows with request size and rule count                                                      | yes: blocks matches        | false positives block legitimate users                    |
| Firewall, security groups    | per-packet rule match, negligible in hardware                                                                               | yes                        | silent drops look like timeouts                           |
| TLS termination              | handshake CPU and round trips (chapter 08)                                                                                  | handshake failures         | expired certificate = hard outage                         |
| KMS, encryption              | an encrypt or decrypt call; hardware-backed, quota-limited                                                                  | throttling                 | KMS throttling stalls every dependent request             |
| DLP inspection               | scans payloads for sensitive data; cost grows with payload bytes                                                            | yes                        | large uploads slow down                                   |
| SIEM                         | ingests security events asynchronously                                                                                      | no                         | dropped or delayed events, not user-visible errors        |

## 2. Authentication and authorization

- **Authentication** proves who the caller is; **authorization** decides what they may do. 401 means no valid identity, 403 means identified but not permitted. [S: RFC 9110 status codes 401 and 403]
- **Token validation.** A signed token (for example a JWT) is verified **locally** with the issuer's public key: cheap, no network, but revocation is not seen until expiry. An opaque token needs **introspection**: a call to the identity provider per request, unless cached. [S: RFC 7519; revocation behaviour is a consequence of local verification]
- **Expiry and scopes.** A token has a lifetime; an expired one is rejected; a token missing a required scope is rejected with 403. [P: RFC 7519 'exp' claim]
- **Policy evaluation (AWS IAM).** The default is **deny**; an allow in an identity-based or resource-based policy grants access; an **explicit deny overrides any allow**; permissions boundaries and organization service-control policies **intersect** with identity permissions (the action must be allowed by all). [P: AWS IAM policy evaluation logic]
- **RBAC** maps users to roles and roles to permissions; least privilege means each role has only what it needs. [D: definition]

Remote-validation arithmetic (Little, chapter 01): 2,000 requests/s each calling an identity provider that answers in 5 ms keeps **10 introspection calls in flight** and makes the provider a dependency of every request. Caching decisions for 60 s with 1,000 distinct tokens cuts that to about 1,000 / 60 = **17 calls/s**. [computed]

## 3. WAF and inspection

A web application firewall matches requests against rules. The OWASP Core Rule Set uses **anomaly scoring**: rules do not block individually; each match adds points to a score and a request is blocked when the score reaches a threshold (defaults **5 inbound**, **4 outbound**). **Paranoia levels** 1 to 4 enable progressively more rules: higher levels catch more attacks and produce more false positives, and common practice is to start with a very high threshold and lower it while tuning. [S: OWASP CRS documentation]

- **Cost:** per-request inspection latency that rises with the number of rules and with body size. [D]
- **False positives:** legitimate requests blocked. If a fraction f of legitimate traffic is blocked, availability for those users is 1 - f however healthy the backend. [D]
- **False negatives:** attacks that pass. The reason a WAF is one layer, not the defence. [D]
- Expected blocked traffic = block rate x requests (a Bernoulli thinning); expected added latency = inspection time x passed requests. [computed]

## 4. Keys, certificates and secrets

- **Envelope encryption.** A key-management service protects a **root key** that never leaves hardware (AWS KMS: FIPS 140-3 Level 3 modules); data is encrypted with a **data key**, which is itself encrypted by the root key. The expensive KMS call is made per data key, **not per request**. [P: AWS KMS developer guide]
- **KMS on the hot path.** If every request makes a KMS call, request rate becomes KMS rate and per-account quotas (thousands of requests per second, shared across keys) become the capacity limit; caching data keys for seconds to minutes removes that. [K: quota values are provider- and region-specific and not verified here]
- **Certificate authority.** Issues certificates with a validity period; clients check expiry and revocation (CRL or OCSP, an extra lookup unless stapled). An expired certificate fails every new connection. [S: chapter 21 and Let's Encrypt FAQ]
- **Secrets rotation.** Rotating without downtime needs an **overlap**: the old and new secret both valid until all clients have refreshed. Rotation faster than client refresh causes authentication failures. [D]
- **Bastion host, privilege-escalation control:** access paths for operators; they add steps (latency for humans) and an audit trail, not request-path cost. [D]

## 5. Failure modes

- **Identity provider outage:** every new login and every uncached introspection fails; locally validated tokens keep working until they expire.
- **Over-eager WAF:** after a rule update a share of legitimate traffic gets 403; error rate rises with no backend fault.
- **KMS throttling:** latency and errors on every encrypt or decrypt path.
- **Certificate expiry:** all new TLS connections fail at one instant.
- **Revocation lag:** a revoked token is still accepted until its cache or lifetime runs out.

## 6. Simulator parameter map

| Setting                                                                            | Meaning                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticationEnabled`, `authTokenField`, `authStatusField`, `authRequiredScopes` | token present, valid, unexpired and carrying the scopes (enforced on `api-gateway`, `auth-service`, `identity-provider` and `iam-rbac`; the IAM policy evaluation rules are not modelled); otherwise rejected with a missing/invalid/expired reason |
| `inspectionMs`, `blockRate`                                                        | WAF-style scan latency per request and a fraction blocked (`inspection_blocked`), on `waf`, `firewall`, `network-policy` and `policy-engine`                                                                                                        |
| `cryptoMs`                                                                         | CPU cost of an encrypt/verify/sign per request, added to service time, on `kms-storage` and `kms-security`                                                                                                                                          |

[repo] The trait takes the credential from request metadata, so a workload models a population of valid, expired and invalid callers.

## 7. Testable expectations (summary)

- A request without a credential is rejected; an expired or invalid one is rejected with its own reason; a missing scope is rejected.
- The fraction blocked by an inspection hop equals the configured block rate within sampling error; passed requests pay the inspection time.
- Added path latency equals the sum of the inspection and crypto costs configured on the path.
- A remote-validation dependency adds its latency to every request; a cache removes it for repeated tokens.
- An explicit deny overrides an allow; with no allow the default is deny.
- A security hop with a block rate lowers goodput by that fraction while leaving the backend's load lower by the same amount.

## 8. Open items

- Not asserted: KMS request quotas (provider- and region-specific) and CRS performance measurements. JWT validation is cited to RFC 7519; OCSP and CRL behaviour is stated only qualitatively.
- Decisions `[?]`: whether a KMS node should enforce a request quota (the trait comment says quota-limited; the cost is modelled, the quota is not); whether authentication should model a remote identity-provider call with caching.

## Sources

- [AWS IAM policy evaluation logic](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html) [P]
- [AWS KMS developer guide: overview](https://docs.aws.amazon.com/kms/latest/developerguide/overview.html) [P]
- [OWASP CRS: anomaly scoring](https://coreruleset.org/docs/2-how-crs-works/2-1-anomaly_scoring/) [S]
- [Handling false positives with the OWASP ModSecurity Core Rule Set (netnea)](https://www.netnea.com/cms/?p=1395) [S]
