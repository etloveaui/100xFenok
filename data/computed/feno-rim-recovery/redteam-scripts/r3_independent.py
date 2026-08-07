#!/usr/bin/env python3
"""cc independent R3 verification. Own implementation, no handler module imported.

Reproduces and attacks the R3 claim that mechanical-forecast GLS-ICC carries 36-month
forward-return information beyond B/P. Inputs are the committed R2 rows plus the r3
price/dividend caches; nothing here reads handler code.

Four blocks, in the order they were run on 2026-08-07:
  1. reproduce   - per-origin cross-sectional ICC coefficient and the Fama-MacBeth mean
  2. decoupling  - move the return's starting price a month off the ICC's price
  3. survivorship- PIT-clean truncation by origin market cap
  4. outcome-cut - demonstrates that cutting on realized return is tail deletion, not a bound
  5. portfolio   - bi-dimensional within-B/P-tercile ICC spread

Run from source/100xFenok.
"""
import json, os, math, statistics as st, random
from datetime import date

PRICES = 'data/edgar/r3-panel/prices'
DIVS   = 'data/edgar/r3-panel/dividends'
R2ROWS = 'data/computed/feno-rim-recovery/R2_GLS_ICC.json'

def ordn(s): return date.fromisoformat(s[:10]).toordinal()

px, dv = {}, {}
for f in os.listdir(PRICES):
    if f.endswith('.json') and 'receipt' not in f:
        px[f[:-5]] = sorted((ordn(k), v) for k, v in
                            (json.load(open(os.path.join(PRICES, f))).get('closes') or {}).items() if v)
for f in os.listdir(DIVS):
    if f.endswith('.json') and 'receipt' not in f:
        dv[f[:-5]] = sorted((ordn(k), v) for k, v in
                            (json.load(open(os.path.join(DIVS, f))).get('dividends') or {}).items() if v)

def idx_at(a, t):
    lo, hi, f = 0, len(a) - 1, -1
    while lo <= hi:
        m = (lo + hi) // 2
        if a[m][0] <= t: f = m; lo = m + 1
        else: hi = m - 1
    return f

def ret(sym, t0, t1, off=0):
    """36m annualized total return. off shifts BOTH endpoints by `off` trading days,
    which decouples the return's starting price from the price the ICC was solved against."""
    a = px.get(sym)
    if not a: return None
    i0, i1 = idx_at(a, t0), idx_at(a, t1)
    if i0 < 0 or i1 < 0: return None
    i0 += off; i1 += off
    if i0 < 0 or i1 >= len(a) or i1 <= i0: return None
    d0, p0 = a[i0]; d1, p1 = a[i1]
    div = sum(v for (d, v) in dv.get(sym, []) if d0 < d <= d1)
    yrs = (d1 - d0) / 365.25
    if p0 <= 0 or yrs <= 0: return None
    return ((p1 + div) / p0) ** (1 / yrs) - 1

def ols(X, y):
    n = len(y); k = len(X[0])
    A = [[sum(X[i][r] * X[i][c] for i in range(n)) for c in range(k)] for r in range(k)]
    b = [sum(X[i][r] * y[i] for i in range(n)) for r in range(k)]
    M = [A[r][:] + [b[r]] for r in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-14: return None
        M[c], M[p] = M[p], M[c]; pv = M[c][c]
        for j in range(c, k + 1): M[c][j] /= pv
        for r in range(k):
            if r != c and M[r][c]:
                f = M[r][c]
                for j in range(c, k + 1): M[r][j] -= f * M[c][j]
    return [M[r][k] for r in range(k)]

def fm(coefs):
    m = st.mean(coefs); s = st.stdev(coefs)
    return m, m / (s / math.sqrt(len(coefs)))

rows = json.load(open(R2ROWS))['rows']
D = {}
for r in rows:
    Y = int(r['origin']); t0 = ordn(f'{Y}-06-30'); t1 = ordn(f'{Y+3}-06-30')
    base, shift = ret(r['sym'], t0, t1, 0), ret(r['sym'], t0, t1, 21)
    if base is None or shift is None: continue
    if not r.get('price') or r['price'] <= 0 or not r.get('mcap'): continue
    D.setdefault(Y, []).append(dict(sym=r['sym'], icc=r['icc_ri'], bp=r['B0'] / r['price'],
                                    mc=r['mcap'], base=base, shift=shift))

def coef(d, dep):
    return ols([[1.0, x['bp'], x['icc']] for x in d], [x[dep] for x in d])[2]

print('1+2. REPRODUCE AND DECOUPLING ATTACK   tr ~ 1 + bp + icc, ICC coefficient')
cb, cs = [], []
for Y in sorted(D):
    cb.append(coef(D[Y], 'base')); cs.append(coef(D[Y], 'shift'))
    print(f'   {Y}  n={len(D[Y]):3d}  baseline {cb[-1]:+.4f}   p0 shifted +1m {cs[-1]:+.4f}')
for lab, c in (('baseline', cb), ('decoupled', cs)):
    m, t = fm(c); print(f'   FM {lab:10s} mean {m:+.4f}  t {t:+.2f}')

print('\n3. SURVIVORSHIP BOUND - PIT-clean, cut by market cap AT THE ORIGIN')
for lab, cut in (('full sample', 0.0), ('drop top decile', .10), ('drop top quintile', .20), ('drop top third', .333)):
    c = [coef(sorted(D[Y], key=lambda x: -x['mc'])[int(len(D[Y]) * cut):], 'base') for Y in sorted(D)]
    m, t = fm(c); print(f'   {lab:20s} FM mean {m:+.4f}  t {t:+.2f}')

print('\n4. OUTCOME-CONDITIONED CUT IS TAIL DELETION, NOT A BOUND')
N = 74
per = lambda d: max(1, int(round(N * len(d) / 330)))
rnd = random.Random(20260807)
def run(sel, lab):
    c = [coef(sel(D[Y]), 'base') for Y in sorted(D)]
    m, t = fm(c); print(f'   {lab:42s} FM mean {m:+.4f}  t {t:+.2f}')
run(lambda d: d, 'full sample')
run(lambda d: sorted(d, key=lambda x: -x['base'])[per(d):], 'drop TOP by realized return')
run(lambda d: sorted(d, key=lambda x: x['base'])[per(d):],  'drop BOTTOM by realized return')
def rand_drop(d):
    e = d[:]; rnd.shuffle(e); return e[per(d):]
run(rand_drop, 'drop RANDOM same count')
run(lambda d: sorted(d, key=lambda x: -x['mc'])[per(d):], 'drop LARGEST by mcap at origin (PIT-clean)')

print('\n5. BI-DIMENSIONAL PORTFOLIO TEST - within B/P terciles, high-ICC half minus low-ICC half')
S = []
for Y in sorted(D):
    d = D[Y]; n = len(d)
    byb = sorted(range(n), key=lambda i: d[i]['bp'])
    parts = []
    for g in range(3):
        idx = sorted(byb[g * n // 3:(g + 1) * n // 3], key=lambda i: d[i]['icc'])
        k = len(idx); lo, hi = idx[:k - k // 2], idx[k - k // 2:]
        parts.append(st.mean(d[i]['base'] for i in hi) - st.mean(d[i]['base'] for i in lo))
    S.append(st.mean(parts))
    print(f'   {Y}  S = {S[-1]:+.4f}')
m, t = fm(S)
print(f'   mean S {m:+.4f}  positive in {sum(1 for x in S if x>0)}/{len(S)} origins  FM t {t:+.2f}')
print('\nNOTE: five origins with 36-month windows twelve months apart share 24/36 months.')
print('Effective independent return periods ~2. No t-statistic here is meaningful; the')
print('evidence is direction plus robustness, not significance.')
