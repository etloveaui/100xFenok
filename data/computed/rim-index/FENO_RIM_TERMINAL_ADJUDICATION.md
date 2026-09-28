# Terminal specification adjudication

Adjudicated 2026-08-08 by cc (Opus). Criteria frozen before any of the three was computed:
`feno-index-rim-terminal-criteria.json` (`3adf5c077d`). Owner directive: E5 stopped, arithmetic
passing does not carry the economic specification.

## Verdict: freeze **B — theory-consistent stable growth**. Proceed to E5.

Everything except the terminal was held at its previously frozen value, so every difference below
is attributable to the terminal alone.

| spec | index | Base | vs current | terminal share | implied LTROE | implied ERP | gates |
|---|---|---:|---:|---:|---:|---:|---|
| A zero-growth | SPX | 4,385 | −41.5% | 53.1% | 38.42% | 1.48% | pass |
| A zero-growth | NDX | 19,433 | −31.3% | 67.2% | 45.13% | 2.46% | pass |
| **B stable growth** | **SPX** | **6,526** | **−12.9%** | 68.5% | 24.64% | 4.44% | **pass** |
| **B stable growth** | **NDX** | **31,452** | **+11.2%** | 79.7% | 28.13% | 5.53% | **pass** |
| C ROE fade | SPX | 11,125 | +48.5% | 81.5% | 17.04% | 7.12% | pass |
| C ROE fade | NDX | 115,599 | +308.9% | **94.5%** | 13.93% | **12.72%** | **FAIL** |

Canonical references: ERP 5.03%, LTROE 21.98% SPX and 30.81% NDX, Ke base 9.66%.

## The terminal was doing almost all the work

Same inputs, same ERP grid, same long-run ROE grid, same three explicit years. Changing only the
terminal moves the S&P 500 Base from 41.5% below the market to 12.9% below it, and the Nasdaq-100
from 31.3% below to 11.2% above. The owner's instinct to stop and adjudicate this before running
historical QA was correct: validating the old configuration would have been validating the
terminal, not the model.

## Why C fails, on gates frozen before it ran

Two of them, both on NDX. Terminal value is 94.5% of the total against a 90% ceiling, which means
the three explicit forecast years contribute about a twentieth of the answer and the thing is a
terminal-value calculator wearing a residual-income label. And explaining today's price needs an
equity risk premium of 12.72% against a 0–12% band.

The mechanism is the one the criteria named in advance. C rolls book forward at the *observed*
retention through the fade — 79.3% for SPX, 90.3% for NDX — while ROE fades only from 38.1% to
30.8% on the Nasdaq. Book compounds near 27% a year for a decade against a 9.7% discount rate.
Nothing converges; the model simply accumulates. C's SPX numbers pass every gate, and that is
precisely why the NDX failure matters: a specification that survives on one index and produces a
value four times the market on another is not a specification, it is a coincidence.

## Why A is a floor and not a Base

A passes every mechanical gate. It is still not a defensible centre, for a reason the gates do not
capture and the reverse-implied diagnostic does.

Under A, explaining today's S&P 500 requires either a long-run ROE of 38.4% held forever — against
a ten-year median of 21.98% and a current reading of 29.13% — or an equity risk premium of 1.48%.
Under B the same price requires 24.64% or 4.44%. The canonical premium is 5.03%.

When a model can only explain an ordinary market by assuming a nearly vanishing risk premium, the
suspicion belongs to the model. A's arithmetic holds book at B3 forever, which is the same thing
as assuming the index distributes every dollar it earns from year four onward. A broad equity
index does not do that, and the criteria said so before any of this was computed.

## What B assumes, in one sentence

After the third forecast year the index earns its long-run ROE on a book growing at the risk-free
rate, retaining exactly enough to fund that growth and paying out the rest.

The retention that follows is not free: `b = g / LTROE` gives 21.1% for SPX and 15.0% for NDX,
against observed retentions of 79.3% and 90.3%. B says the current retention rate is a feature of
today's growth phase and not of the steady state — an assumption the owner can accept or reject
without reading any code, which is what the interpretability test asked for.

The algebra leaves no alternative. Carrying today's 79.3% retention into perpetuity at a 21.98%
long-run ROE implies 17.4% growth against a 9.66% cost of equity. The denominator goes negative.
Any specification that lets the observed retention persist is not conservative or aggressive — it
is undefined.

## What I will not defend about B

**The growth rate is the most generous one theory allows.** `g = Rf = 4.63%` is Damodaran's cap,
not a midpoint. The Base is materially sensitive to it:

| | g = 0 (this is A) | g = 2.5% | g = Rf 4.63% |
|---|---:|---:|---:|
| SPX Base | 4,385 (−41.5%) | 5,197 (−30.6%) | 6,526 (−12.9%) |
| NDX Base | 19,433 (−31.3%) | 23,992 (−15.1%) | 31,452 (+11.2%) |

The Nasdaq flips from meaningfully overvalued to modestly undervalued between g = 2.5% and
g = 4.63%. Whoever reads the Base number is also accepting that growth rate, and it should be
displayed beside the value rather than buried in a contract.

**B has a pole that A does not.** The denominator is `Ke − g`, so the value function is singular
where the cost of equity meets the stable growth rate. My first reverse-implied solve crossed that
pole and returned its search bound of 30% as though it were a solution; re-solving on the valid
branch gives 4.44% and 5.53% and reprices to the exact market level. With the frozen grid the
nearest cell sits at Ke 9.16% against g 4.63%, a comfortable margin — but the diagnostic must
always be solved on the branch above the pole, and any future grid that narrows that gap is
dangerous in a way A never was.

**Terminal share is high.** 68.5% for SPX and 79.7% for NDX. Below the ceiling, and still most of
the answer lives beyond the forecast horizon.

## Yoo's equation

`NOT_VERIFIED`, unchanged. E0 refuted the linear-in-LTROE family — which covers both A and C's
terminal structure — using the one complete public matrix held locally. One fixture can refute and
cannot identify. D is not admitted and would require acquiring a second complete public 3×3 first.

Note what this means for B: the selected specification is also linear in LTROE at fixed Ke, so it
too is structurally unlike whatever produced Yoo's published grids. B is selected because it is
the weakest defensible assumption available, not because it reconstructs anyone's arithmetic.

## Verification

Handler computed all three specifications independently from the frozen inputs; every gate in the
comparison artifact was evaluated mechanically rather than by inspection. Monotonicity holds on
both axes for all three specifications and both indices, including C, whose failure is about
magnitude and not about ordering.
