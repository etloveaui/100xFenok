# Red-team independent implementations (cc, 2026-08-07)

Independent re-derivations written from the frozen criteria text alone, with no handler
module imported, used to verify the RIM recovery phases. Preserved at the handler's request
because they are the only independent implementations of the corrected numbers.

| script | verifies | key result |
|---|---|---|
| `r0_independent.py` | R0-A..D under `r0-criteria-v2.json` | reproduced the handler's R0 v2 figures; exposed that the ESS instrument inflates above T on negatively autocorrelated series |
| `r0_corrected.py` | R0-CORRECTED under the v3.1 share-basis rule | matched the handler to the digit: 284/848 corrected cells, IC(V/P) −0.0985/+0.1000, IC(B/P) −0.0292/+0.1593, b2 −0.1337/−0.0804 |
| `r1_independent.py` | R1 Li-Mohanram forecasts under v2.2/v2.6 | independent gate read; annual facts identified by duration, plus the v2.6 share-basis and earnings-yield guards |
| `r3_independent.py` | R3 incremental-ICC claim | reproduced FM 1.2071; decoupling, PIT-clean survivorship, outcome-cut demonstration, bi-dimensional portfolio |

Run from `source/100xFenok`. They read only committed caches and artifacts and write nothing.

The R3 script carries the demonstration that corrected the final decision: cutting the panel
on realized return deletes the outcome tail (1.207 → 0.103 cutting the top, → 1.363 cutting the
bottom, → 1.302 at random) whereas the PIT-clean cut by origin market cap leaves it at 1.200.
That is why the survivorship objection is recorded as raised-and-failed rather than confirmed.

Authority for the numbers remains the committed result JSONs; these scripts are the
reproduction path, not a second source of truth.
