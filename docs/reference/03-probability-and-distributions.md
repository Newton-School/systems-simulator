# 03. Probability and distributions

Marks: **[P]** primary, **[S]** secondary (encyclopedia or course text, fetched), **[K]** established knowledge,
not yet source-checked, **[?]** needs an owner decision. See [README](README.md).

Every service time, edge latency and arrival gap in the simulator is a random draw from a distribution.
This chapter says what each of the 14 distributions is, what it is for, and what its mean, spread and
percentiles must be, so a draw can be checked against theory.

## 1. What to know about any distribution

| Quantity                                | Meaning                                                         | Why the simulator cares                                      |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Mean E[X]                               | long-run average                                                | Sets capacity: mu = 1 / mean service time                    |
| Variance, standard deviation            | spread                                                          | Drives queue waits (Kingman, chapter 01 section 4.3)         |
| Coefficient of variation CV = sd / mean | spread relative to the mean; CV squared is the variability term | CV = 0 constant, CV = 1 exponential, CV > 1 heavy and bursty |
| Median and percentiles                  | the value below which p of draws fall                           | Latency is judged by p95, p99, p99.9, not the mean           |
| Support                                 | which values are possible                                       | Service times cannot be negative                             |
| Quantile function Q(p)                  | inverse of the CDF                                              | Used both to read percentiles and to sample                  |

Rules that hold for every distribution [K]:

- The mean of a sum is the sum of the means. The variance of a sum of **independent** terms is the sum of the variances.
  Percentiles do **not** add (chapter 01 section 6).
- Multiplying a draw by a constant c multiplies the mean and sd by c, leaves CV unchanged, and multiplies every percentile by c.

## 2. How a draw is made

**Inverse-transform sampling [S: Wikipedia].** If U is uniform on [0, 1] and F is the target CDF, then X = F⁻¹(U) has CDF F, where
F⁻¹(u) is the smallest x with F(x) >= u. Steps: draw u, apply the inverse CDF, return x. Closed forms exist for the
exponential, Weibull, Pareto and uniform. Others use specialised methods (Box-Muller for the normal, rejection or
multiplication methods for gamma, beta, binomial and Poisson). [K]

**Pseudo-random generators [K].** A seeded generator gives a reproducible stream of uniforms: same seed, same
sequence, same run. Good generators pass statistical test batteries; the simulator seeds a small-state generator
from a string hash (the code names sfc32 and xmur3). Whether it passes the standard batteries (TestU01 / PractRand) is **[?]**.

**Testable expectations**

- Same seed and same config produce identical draws. A different seed produces different draws with the same mean and spread.
- Over N draws the sample mean is within about 3 standard errors of the true mean: error is roughly 3 x sd / sqrt(N).
  This is the right tolerance to attach to every sampling check below.
- Heavy-tailed distributions (Pareto alpha <= 2, log-normal with large sigma) converge slowly; their sample means are noisy
  even at large N, so use quantiles (median, p99), not the sample mean, as oracles for them.

## 3. The catalogue

For each: parameters, pdf, moments, percentiles, real-world use, and the simulator's parameter name.
Parameter names are taken from the config type; the formulas are the oracle.

### 3.1 Constant and deterministic

- Every draw equals `value`. Mean = value, variance 0, CV 0. [K]
- Real use: idealised fixed cost, a fixed timer, a calibrated mean when variability is not the point.
- Effect in queues: lowest wait for a given load. M/D/1 waits half as long as M/M/1 (chapter 01 section 4.2).
- Simulator: `constant` and `deterministic` are the same thing.

### 3.2 Uniform

- Parameters `min`, `max`. pdf = 1 / (max − min) on [min, max]. Mean = (min + max) / 2. Variance = (max − min)² / 12. [K]
- Worked: min 10, max 30: mean 20, variance 33.3, sd 5.77, CV 0.289. Median 20. p99 = 10 + 0.99 x 20 = 29.8.
- Real use: jitter ("0 to 100 ms of random delay"), no knowledge beyond the bounds. Rarely a good latency model.

### 3.3 Exponential

- Parameter rate lambda (simulator `lambda`, units per millisecond when the value is in ms, so mean = 1 / lambda ms).
- pdf = lambda e^(−lambda x), CDF = 1 − e^(−lambda x). Mean = 1/lambda, variance = 1/lambda², **CV = 1**. [S: Wikipedia]
- Quantile: Q(p) = −ln(1 − p) / lambda. Sampling: x = −ln(U) / lambda. [S]
- **Memoryless:** P(T > s + t | T > s) = P(T > t). The time left does not depend on time already waited. [S]
- Models the gaps in a Poisson process (section 3.7 and chapter 05). Its memorylessness makes M/M queues solvable in closed form.
- Worked: mean 20 ms (lambda = 0.05 per ms): median 13.9 ms, p95 59.9 ms, p99 92.1 ms, p99.9 138.2 ms. The p99 is 4.6 x the mean. [computed]
- Real use: mean service time when little else is known; time to failure of a part with no wear-out. Real latencies are usually less variable in
  the body and heavier in the tail than exponential.

### 3.4 Normal

- Parameters `mean`, `stdDev`. pdf = exp(−(x − mean)² / (2 sd²)) / (sd sqrt(2 pi)). [S]
- 68% within 1 sd, 95% within 2, 99.7% within 3. Quantile = mean + sd x z, with z = 1.645 (p95), 1.96 (two-sided 95%), 2.326 (p99),
  2.576 (two-sided 99%), 3.09 (p99.9). [S]
- **Support is all reals, so it can produce negative durations.** With mean 20 and sd 10, P(X < 0) = 2.3%. A negative service time is meaningless;
  a model must truncate or clamp it. Simulator: negative draws are clamped to 0 for service time (so the realised mean is slightly above the stated mean). **[?]** Owner to confirm.
- Real use: sums of many independent small delays (central limit theorem), measurement noise. Poor model for skewed latency.

### 3.5 Log-normal

- ln X is normal with parameters `mu` and `sigma` (of **ln X**, not of X). [S: Wikipedia]
- Mean = exp(mu + sigma²/2). Median = exp(mu). Variance = (exp(sigma²) − 1) exp(2 mu + sigma²). **CV = sqrt(exp(sigma²) − 1)**, depends only on sigma.
  mode < median < mean (right-skewed). Quantile Q(p) = exp(mu + sigma x z_p). [S]
- Worked: median 20 ms (mu = ln 20 = 2.996), sigma 0.5: mean 22.66 ms, CV 0.533, p95 45.5 ms, p99 64.0 ms, p99.9 93.8 ms. [computed]
- Real use: the best everyday model for request latency and file sizes: positive, skewed, tail a few times the median, from products of many independent factors. [S]
- Reading config: to hit a target median m use mu = ln m; a target p99 = m x exp(2.326 sigma) fixes sigma.

### 3.6 Gamma

- Parameters shape k and scale theta. Mean = k theta, variance = k theta², **CV = 1 / sqrt(k)**. [S: Wikipedia]
- k = 1 is exponential (rate 1/theta). Integer k is **Erlang**: the sum of k independent exponentials each with mean theta. [S]
- Worked: k = 4, theta = 5: mean 20, variance 100, CV 0.5. A service made of 4 sequential exponential stages of mean 5 ms each has exactly this distribution.
- Real use: multi-stage processing; waits composed of several phases. Use k to dial CV below 1 smoothly (k = 2: CV 0.71; k = 4: 0.5; k = 16: 0.25).

### 3.7 Poisson (counts)

- A **discrete** distribution of counts: P(X = k) = lambda^k e^(−lambda) / k!, mean = variance = lambda. [S: Wikipedia]
- Link to the Poisson process: if arrivals in [0, t] are Poisson with mean lambda t for every t, then inter-arrival times are independent exponentials with mean 1 / lambda. [S]
- Superposition: independent Poisson streams add; the sum is Poisson with the summed rate. Thinning: keeping each event with probability p gives a Poisson process of rate lambda p, and the split streams are independent. [S]
- Normal approximation: good for lambda above about 10 with a continuity correction. [S]
- **Using a count as a duration is a modelling choice.** A Poisson draw is an integer, with CV = 1 / sqrt(lambda). Check what unit the node means before using it as a service time. **[?]**

### 3.8 Binomial (counts)

- n trials each succeeding with probability p. Mean = n p, variance = n p (1 − p). [K]
- Worked: n = 10, p = 0.3: mean 3, variance 2.1. As n grows with n p fixed it approaches Poisson. [K]
- Real use: number of failures among n replicas, number of cache hits in a batch.

### 3.9 Weibull

- Parameters shape k and scale lambda. CDF = 1 − exp(−(x/lambda)^k). Mean = lambda Gamma(1 + 1/k). Median = lambda (ln 2)^(1/k).
  Quantile Q(p) = lambda (−ln(1 − p))^(1/k). Variance = lambda² (Gamma(1 + 2/k) − Gamma(1 + 1/k)²). [S: Wikipedia]
- k = 1 is exponential with rate 1/lambda. k = 2 is Rayleigh. [S]
- **Hazard rate** h(x) = (k/lambda)(x/lambda)^(k−1): falling for k < 1 (early failures), constant at k = 1, rising for k > 1 (wear-out). [S]
- Worked: k = 2, lambda = 20: mean 17.72, variance 85.8, median 16.65, p99 42.9. [computed]
- Real use: time to failure and repair; service times with a hard lower shoulder.

### 3.10 Pareto (Type I)

- Parameters scale x_m (the minimum possible value) and shape alpha. CDF = 1 − (x_m / x)^alpha for x >= x_m. [S: Wikipedia]
- Mean = alpha x_m / (alpha − 1) **only if alpha > 1**; infinite otherwise. Variance finite **only if alpha > 2**; infinite for 1 < alpha <= 2. Median = x_m 2^(1/alpha). Quantile = x_m (1 − p)^(−1/alpha). [S]
- Power-law tail: smaller alpha is a heavier tail. The n-th moment is infinite when alpha <= n. [S]
- Worked: alpha = 2.5, x_m = 10: mean 16.67, variance 222, CV 0.89, median 13.2, p99 63.1, p99.9 158.5. [computed]
- **Config trap.** The simulator names the fields `shape` (alpha) and `scale` (x_m). Mixing them up gives a valid but wrong distribution. Check with the median: x_m x 2^(1/alpha).
- Real use: file sizes, job sizes, request sizes, think times: a few huge items carry much of the load. With alpha <= 2 sample means never settle, which makes a queue fed by it unpredictable.

### 3.11 Beta

- Support [0, 1]. Parameters alpha, beta. Mean = alpha / (alpha + beta). Variance = alpha beta / ((alpha + beta)² (alpha + beta + 1)). Mode (alpha − 1) / (alpha + beta − 2) for alpha, beta > 1. [S: Wikipedia]
- alpha = beta = 1 is uniform; alpha = beta symmetric about 0.5. [S]
- Real use: a **proportion** (hit ratio, error fraction), not a duration. To use as a time, scale the draw. Used to vary a probability per run. **[?]** what the simulator uses it for.

### 3.12 Mixture

- A weighted combination of component distributions: draw a component with probability w_i, then draw from it. Weights are non-negative and sum to 1. [S: Wikipedia]
- Mean = sum w_i mu_i. Variance = sum w_i (sigma_i² + mu_i²) − mu². [S]
- Models **bimodal** latency: a fast path and a slow path (cache hit versus miss, warm versus cold start, local versus cross-region).
- Worked: 90% fast (1 ms), 10% slow (50 ms), both constant: mean 5.9 ms, variance 216.1, sd 14.7, **CV 2.49**, CV² 6.2. The p89 is 1 ms and the p99 is 50 ms.
  A queue fed by this has a Pollaczek-Khinchine wait factor (1 + CV²)/2 = 3.6 x the M/M/1 wait (chapter 01 section 4.2).
  Lesson: **the mean says 5.9 ms and nothing actually takes 5.9 ms.**
- **Weight rule.** The type says weights should sum to 1. The simulator normalises by the total, so weights 9 and 1 work like 0.9 and 0.1. **[?]** Owner to decide whether a sum other than 1 should be a validation warning.

### 3.13 Empirical

- Draw from observed data. Two modes in the config: `step` (resample the recorded values) and `linear` (interpolate between them). [K]
- Step: the CDF is the empirical CDF; draws are only the recorded values. Linear: draws can fall between recorded values, which smooths the tail but can never exceed the recorded maximum.
- Real use: replaying a production latency sample. Caveat: a sample has no tail beyond its largest value, so p99.99 of the model equals the sample max, not reality. [K]
- Mean of draws converges to the sample mean (step) or very close to it (linear).

## 4. Choosing a distribution (what real latency looks like)

| Situation                                   | Typical shape             | Use                                              |
| ------------------------------------------- | ------------------------- | ------------------------------------------------ |
| Fixed work, no variability                  | CV 0                      | constant                                         |
| Memoryless service, unknown structure       | CV 1                      | exponential                                      |
| Several sequential stages                   | CV < 1                    | gamma (Erlang), integer shape = number of stages |
| Typical request latency, skewed with a tail | CV 0.3 to 1, right-skewed | log-normal                                       |
| Fast path plus slow path                    | bimodal, CV > 1           | mixture                                          |
| Job or object sizes, heavy tail             | power law                 | Pareto (watch alpha)                             |
| Time to failure or repair                   | hazard varies             | Weibull                                          |
| Network jitter with a known bound           | flat                      | uniform                                          |
| A measured production sample                | whatever it is            | empirical                                        |

Guide to CV [K]: CV < 1 smoother than Poisson (waits shorter than M/M); CV = 1 exponential; CV > 1 burstier, and the tail dominates waiting.

## 5. Simulator parameter map (config reference)

| Config `type`               | Fields                                          | Unit          | Real parameter              |
| --------------------------- | ----------------------------------------------- | ------------- | --------------------------- |
| `constant`, `deterministic` | `value`                                         | ms            | the value                   |
| `uniform`                   | `min`, `max`                                    | ms            | bounds                      |
| `exponential`               | `lambda`                                        | per ms        | rate; mean = 1/lambda ms    |
| `normal`                    | `mean`, `stdDev`                                | ms            | mean, sd                    |
| `log-normal`                | `mu`, `sigma`                                   | ln(ms)        | parameters of ln X          |
| `gamma`                     | `shape`, `scale`                                | ms            | k, theta                    |
| `weibull`                   | `shape`, `scale`                                | ms            | k, lambda                   |
| `pareto`                    | `shape`, `scale`                                | ms            | alpha, x_m                  |
| `beta`                      | `alpha`, `beta`                                 | unitless      | proportion on [0, 1]        |
| `poisson`                   | `lambda`                                        | count         | mean count                  |
| `binomial`                  | `n`, `p`                                        | count         | trials, success probability |
| `empirical`                 | `samples`, `interpolation` (`linear` or `step`) | ms            | recorded values             |
| `mixture`                   | `components[{weight, distribution}]`            | per component | w_i, component              |

## 6. Testable expectations (per distribution)

For N = 200,000 seeded draws, with tolerance about 3 sd / sqrt(N) on the mean and a few percent on quantiles:

- Mean, sd and CV equal the formulas above (exponential 20 ms, log-normal median 20 ms sigma 0.5, gamma k 4 theta 5, Weibull k 2 lambda 20,
  uniform 10 to 30, mixture 90/10).
- Percentiles: exponential p99 = 92.1 ms for mean 20; log-normal p99 = 64.0 ms for median 20 sigma 0.5.
- Pareto alpha 2.5, x_m 10: median 13.2 and p99 63.1 (use quantiles, not the mean).
- No draw below x_m (Pareto), below min (uniform), or below 0 (service times).
- Mixture proportions: about 90% of draws land in the fast mode.
- Determinism: identical seed gives an identical stream.
- A service time distribution with CV c gives a queue whose mean wait scales with (1 + c²)/2 relative to M/M (chapter 01 test Q-07).

## 7. Open items

- Fetch and cite: a statistics text for the quantile and moment formulas marked `[K]` (uniform, binomial); the sfc32 and xmur3 generators and their test-battery results.
- Owner decisions `[?]`: normal-draw truncation and clamping (3.4); Poisson and beta as durations (3.7, 3.11); mixture weights that do not sum to 1 (3.12).
- A distribution-sampling test suite (`e2e/journeys/ch03-distributions.spec.ts`) is the natural next step; the oracles are in this chapter.

## Sources

- [Exponential distribution, Wikipedia](https://en.wikipedia.org/wiki/Exponential_distribution) [S]
- [Normal distribution, Wikipedia](https://en.wikipedia.org/wiki/Normal_distribution) [S]
- [Log-normal distribution, Wikipedia](https://en.wikipedia.org/wiki/Log-normal_distribution) [S]
- [Gamma distribution, Wikipedia](https://en.wikipedia.org/wiki/Gamma_distribution) [S]
- [Poisson distribution, Wikipedia](https://en.wikipedia.org/wiki/Poisson_distribution) [S]
- [Weibull distribution, Wikipedia](https://en.wikipedia.org/wiki/Weibull_distribution) [S]
- [Pareto distribution, Wikipedia](https://en.wikipedia.org/wiki/Pareto_distribution) [S]
- [Beta distribution, Wikipedia](https://en.wikipedia.org/wiki/Beta_distribution) [S]
- [Mixture distribution, Wikipedia](https://en.wikipedia.org/wiki/Mixture_distribution) [S]
- [Inverse transform sampling, Wikipedia](https://en.wikipedia.org/wiki/Inverse_transform_sampling) [S]
