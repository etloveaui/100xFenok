#!/usr/bin/env python3
"""cc independent R1 implementation under frozen r1-criteria-v2.2.
Own code. No handler module imported. Built before the handler run lands so the
comparison is one pass. Reads only the frozen caches.
"""
import json, os, math
from datetime import date

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
FACTS = os.path.join(ROOT, "data/edgar/r1-panel")
PRICES = os.path.join(FACTS, "prices")
CUTOFF = date(2026, 8, 7).toordinal()
ORIGINS = [2019, 2020, 2021, 2022, 2023]
TAUS = [1, 2, 3]

def ordn(s): return date.fromisoformat(s[:10]).toordinal()
def label_of(pe_ord):
    d = date.fromordinal(pe_ord)
    return d.year + 1 if d.month >= 4 else d.year

def annual_map(rows):
    """form 10-K/10-K/A, fp=FY, earliest filed per label -> {label: (pe, filed, val)}"""
    out = {}
    for r in rows or []:
        if r.get("form") not in ("10-K", "10-K/A") or r.get("fp") != "FY": continue
        if not r.get("end") or not r.get("filed") or r.get("val") is None: continue
        if r.get("start"):                       # duration facts must be ~annual
            dur = ordn(r["end"]) - ordn(r["start"])
            if not (300 <= dur <= 400): continue
        pe, fl = ordn(r["end"]), ordn(r["filed"])
        lab = label_of(pe)
        prev = out.get(lab)
        if prev is None or fl < prev[1]: out[lab] = (pe, fl, float(r["val"]))
    return out

def share_facts(c):
    """all share observations with (date, filed, val), dei union us-gaap"""
    rows = []
    for key in ("EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"):
        for r in c.get(key) or []:
            if r.get("end") and r.get("filed") and r.get("val"):
                rows.append((ordn(r["end"]), ordn(r["filed"]), float(r["val"])))
    return sorted(rows)

# ---------- load ----------
firms = {}
for f in os.listdir(FACTS):
    if not f.endswith(".json") or "receipt" in f: continue
    sym = f[:-5]
    try: c = json.load(open(os.path.join(FACTS, f))).get("concepts", {})
    except Exception: continue
    E = annual_map(c.get("NetIncomeLoss"))
    SE = annual_map(c.get("StockholdersEquity"))
    CHE = annual_map(c.get("CashAndCashEquivalentsAtCarryingValue"))
    IVST = annual_map(c.get("ShortTermInvestments")) or annual_map(c.get("MarketableSecuritiesCurrent"))
    PSTK = annual_map(c.get("PreferredStockValue"))
    SH = share_facts(c)
    if not E or not SE or not SH: continue
    firms[sym] = dict(E=E, SE=SE, CHE=CHE, IVST=IVST, PSTK=PSTK, SH=SH)

prices, splits = {}, {}
for f in os.listdir(PRICES):
    if not f.endswith(".json"): continue
    sym = f[:-5]
    try: j = json.load(open(os.path.join(PRICES, f)))
    except Exception: continue
    prices[sym] = sorted((ordn(k), v) for k, v in (j.get("closes") or {}).items() if v)
    splits[sym] = {ordn(k): float(v) for k, v in (j.get("splits") or {}).items()}

def shares_basis(sym, pe, ref):
    """year-t shares on today's split basis; fact nearest period_end in [-183,+90], filed<=ref"""
    cand = [(abs(d - pe), -d, d, v) for (d, fl, v) in firms[sym]["SH"]
            if fl <= ref and pe - 183 <= d <= pe + 90]
    if not cand: return None, None
    _, _, d, v = min(cand)
    F = 1.0
    for sd, ratio in splits.get(sym, {}).items():
        if sd > d: F *= ratio
    return v * F, F

SB_MED = {}
def firm_median_basis(sym, ref):
    key = (sym, ref)
    if key in SB_MED: return SB_MED[key]
    vals = []
    for lab in firms[sym]["E"]:
        pe = firms[sym]["E"][lab][0]
        sb, _ = shares_basis(sym, pe, ref)
        if sb and sb > 0: vals.append(sb)
    v = sorted(vals); SB_MED[key] = (v[len(v)//2] if v else None)
    return SB_MED[key]

def row_at(sym, lab, ref):
    """per-share regressors at base label `lab`, PIT vs ref. None if unusable."""
    fm = firms[sym]
    if lab not in fm["E"] or lab not in fm["SE"]: return None
    pe, fl, Eval = fm["E"][lab]
    if fl > ref: return None
    se_pe, se_fl, SEv = fm["SE"][lab]
    if se_fl > ref: return None
    sb, F = shares_basis(sym, pe, ref)
    if not sb or sb <= 0: return None
    med = firm_median_basis(sym, ref)
    if med and (sb > 10 * med or sb * 10 < med):
        SB_REJECT.append((sym, lab)); return None
    def g(m, l):
        r = m.get(l)
        return r[2] if (r and r[1] <= ref) else None
    che_t, che_p = g(fm["CHE"], lab), g(fm["CHE"], lab - 1)
    se_p = g(fm["SE"], lab - 1)
    ivst_t = g(fm["IVST"], lab) or 0.0
    ivst_p = g(fm["IVST"], lab - 1) or 0.0
    pstk_t = g(fm["PSTK"], lab) or 0.0
    pstk_p = g(fm["PSTK"], lab - 1) or 0.0
    if None not in (che_t, che_p, se_p):
        tacc = ((SEv - che_t + ivst_t - pstk_t) - (se_p - che_p + ivst_p - pstk_p)) / sb
        tacc_missing = False
    else:
        tacc, tacc_missing = 0.0, True
    return dict(sym=sym, lab=lab, pe=pe, sb=sb, F=F,
                eps=Eval / sb, bps=(SEv - pstk_t) / sb, tacc=tacc,
                tacc_missing=tacc_missing, nege=1.0 if Eval < 0 else 0.0)

def dependent(sym, lab_base, sb, tau, ref):
    fm = firms[sym]
    r = fm["E"].get(lab_base + tau)
    if not r or r[1] > ref: return None
    return r[2] / sb

def winsor_bounds(vals):
    s = sorted(vals); n = len(s)
    if n < 5: return (s[0], s[-1])
    lo = s[max(0, int(math.floor(0.01 * (n - 1))))]
    hi = s[min(n - 1, int(math.ceil(0.99 * (n - 1))))]
    return lo, hi
def clip(x, b): return min(max(x, b[0]), b[1])

def ols(X, y):
    n = len(y); k = len(X[0]) + 1
    A = [[0.0] * k for _ in range(k)]; b = [0.0] * k
    for i in range(n):
        row = [1.0] + list(X[i])
        for r in range(k):
            b[r] += row[r] * y[i]
            for c in range(k): A[r][c] += row[r] * row[c]
    M = [A[r][:] + [b[r]] for r in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12: return None
        M[c], M[p] = M[p], M[c]
        pv = M[c][c]
        for j in range(c, k + 1): M[c][j] /= pv
        for r in range(k):
            if r == c: continue
            f = M[r][c]
            if f:
                for j in range(c, k + 1): M[r][j] -= f * M[c][j]
    return [M[r][k] for r in range(k)]

def price_at(sym, ref):
    p = prices.get(sym)
    if not p: return None
    best = None
    for d, v in p:
        if d <= ref: best = (d, v)
        else: break
    if not best or ref - best[0] > 14: return None
    return best[1]

results = {}
diag = []
guard_drop = []
SB_REJECT = []
for Y in ORIGINS:
    ref = date(Y, 6, 30).toordinal()
    for tau in TAUS:
        lo_lab, hi_lab = Y - tau - 9, Y - tau        # date range [Apr1 Y-tau-10, Mar31 Y-tau]
        pool = []
        for sym in firms:
            for lab in range(lo_lab, hi_lab + 1):
                r = row_at(sym, lab, ref)
                if not r: continue
                y = dependent(sym, lab, r["sb"], tau, ref)
                if y is None: continue
                pool.append((r, y))
        if len(pool) < 300:
            diag.append((Y, tau, "VOID", len(pool))); continue
        # winsorize per fiscal label within pool
        by_lab = {}
        for r, y in pool: by_lab.setdefault(r["lab"], []).append((r, y))
        bounds = {}
        for lab, items in by_lab.items():
            bounds[lab] = {k: winsor_bounds([it[0][k] for it in items]) for k in ("eps", "bps", "tacc")}
            bounds[lab]["y"] = winsor_bounds([it[1] for it in items])
        Xep, Xri, yv = [], [], []
        for r, y in pool:
            b = bounds[r["lab"]]
            e = clip(r["eps"], b["eps"]); bp = clip(r["bps"], b["bps"]); ta = clip(r["tacc"], b["tacc"])
            yy = clip(y, b["y"])
            Xep.append([r["nege"], e, r["nege"] * e])
            Xri.append([r["nege"], e, r["nege"] * e, bp, ta])
            yv.append(yy)
        cep, cri = ols(Xep, yv), ols(Xri, yv)
        if cep is None or cri is None:
            diag.append((Y, tau, "SINGULAR", len(pool))); continue
        last_lab = max(by_lab)
        bl = bounds[last_lab]
        # forecast rows: latest usable base label at origin
        rows = []
        for sym in firms:
            cand = [l for l in firms[sym]["E"] if firms[sym]["E"][l][1] <= ref]
            if not cand: continue
            t = max(cand)
            r = row_at(sym, t, ref)
            if not r: continue
            act = dependent(sym, t, r["sb"], tau, CUTOFF)
            if act is None: continue
            px = price_at(sym, ref)
            if not px: continue
            e = clip(r["eps"], bl["eps"]); bp = clip(r["bps"], bl["bps"]); ta = clip(r["tacc"], bl["tacc"])
            f_rw = r["eps"]
            f_ep = cep[0] + cep[1] * r["nege"] + cep[2] * e + cep[3] * r["nege"] * e
            f_ri = cri[0] + cri[1] * r["nege"] + cri[2] * e + cri[3] * r["nege"] * e + cri[4] * bp + cri[5] * ta
            if abs(r["eps"]) / px > 1.0:           # v2.6 earnings-yield guard
                guard_drop.append((sym, Y, tau)); continue
            rows.append(dict(sym=sym, act=act, rw=f_rw, ep=f_ep, ri=f_ri, px=px, nege=r["nege"]))
        results[(Y, tau)] = dict(pool=len(pool), rows=rows, cep=cep, cri=cri)
        diag.append((Y, tau, "ok", len(pool), len(rows)))

def mae(rows, key): return sum(abs(r["act"] - r[key]) / r["px"] for r in rows) / len(rows)
def medae(rows, key):
    v = sorted(abs(r["act"] - r[key]) / r["px"] for r in rows); n=len(v)
    return v[n//2] if n%2 else (v[n//2-1]+v[n//2])/2
def bias(rows, key): return sum((r["act"] - r[key]) / r["px"] for r in rows) / len(rows)

print(f"share-basis outlier rejects: {len(SB_REJECT)}  symbols {sorted({g[0] for g in SB_REJECT})[:14]}")
print(f"guard drops (|eps|/px>1): {len(guard_drop)}  symbols {sorted({g[0] for g in guard_drop})}")
print("cc INDEPENDENT R1 (frozen v2.2 spec, own implementation)\n")
print(f"firms with usable facts: {len(firms)}   price caches: {len(prices)}\n")
print(f"{'tau':>3s} {'origins':>8s} {'n':>6s} {'MAE_RW':>9s} {'MAE_EP':>9s} {'MAE_RI':>9s} {'RI<RW':>7s} {'RI<EP':>7s}")
gate = {}
for tau in TAUS:
    allrows = []
    for Y in ORIGINS:
        r = results.get((Y, tau))
        if r: allrows += r["rows"]
    if not allrows: continue
    m = {k: mae(allrows, k) for k in ("rw", "ep", "ri")}
    gate[tau] = m
    md = {k: medae(allrows, k) for k in ("rw","ep","ri")}
    print(f"{tau:>3d} {len([Y for Y in ORIGINS if (Y,tau) in results]):>8d} {len(allrows):>6d} "
          f"{m['rw']:>9.4f} {m['ep']:>9.4f} {m['ri']:>9.4f} "
          f"{'YES' if m['ri']<m['rw'] else 'no':>7s} {'YES' if m['ri']<m['ep'] else 'no':>7s}"
          f"   | medAE rw {md['rw']:.4f} ep {md['ep']:.4f} ri {md['ri']:.4f}")
print()
print("GATE (necessary+sufficient): RI price-scaled MAE < RW at BOTH tau=1 and tau=2, full sample")
ok = all(tau in gate and gate[tau]["ri"] < gate[tau]["rw"] for tau in (1, 2))
print(f"  tau=1  RI {gate.get(1,{}).get('ri',float('nan')):.4f} vs RW {gate.get(1,{}).get('rw',float('nan')):.4f}")
print(f"  tau=2  RI {gate.get(2,{}).get('ri',float('nan')):.4f} vs RW {gate.get(2,{}).get('rw',float('nan')):.4f}")
print(f"  => {'PASS' if ok else 'FAIL'}")
print()
avg = {k: sum(gate[t][k] for t in gate) / len(gate) for k in ("ri", "ep", "rw")}
print(f"R2 input by pre-committed rule (lower avg MAE across tau1-3): "
      f"{'RI' if avg['ri']<avg['ep'] else 'EP'}   (RI {avg['ri']:.4f} vs EP {avg['ep']:.4f})")
print()
print("pooled RI coefficients per (origin,tau)  [c1 NegE, c2 eps, c3 NegE*eps, c4 bps, c5 tacc]")
print("expected signs: c2>0 c4>0 c3<0 c5<0")
sign_ok = {"c2": 0, "c3": 0, "c4": 0, "c5": 0}; tot = 0
for (Y, tau), r in sorted(results.items()):
    c = r["cri"]; tot += 1
    sign_ok["c2"] += c[2] > 0; sign_ok["c3"] += c[3] < 0; sign_ok["c4"] += c[4] > 0; sign_ok["c5"] += c[5] < 0
print(f"  sign agreement across {tot} pooled fits: "
      f"c2>0 {sign_ok['c2']}/{tot}  c3<0 {sign_ok['c3']}/{tot}  c4>0 {sign_ok['c4']}/{tot}  c5<0 {sign_ok['c5']}/{tot}")
print()
print("per-origin pool sizes / forecast rows:")
for d in diag: print("  ", d)
