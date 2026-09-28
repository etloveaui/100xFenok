# cc independent re-derivation of G1. Own implementation; no worker artifact read as input.
# Variable definitions per frozen g1-criteria.json. Adds two alternative readings of
# "within-sector" that the criteria left undefined, so the handler can tell a finding
# from an implementation artifact.
import json, os, math
from datetime import date, timedelta

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
def rj(p): return json.load(open(os.path.join(ROOT, p)))
def ms(d): return date.fromisoformat(d[:10]).toordinal()

# ---------- inputs ----------
r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json")
panel = rj("data/computed/feno-rim-recovery/r1-edgar-panel.json")
fc = {}
for r in panel["rows"]:
    fc.setdefault(r["sym"] + "|" + str(r["origin"]), {})[r["tau"]] = r

_p, _d, _sic = {}, {}, {}
def px(sym):
    if sym not in _p:
        f = os.path.join(ROOT, "data/edgar/r3-panel/prices/%s.json" % sym)
        _p[sym] = json.load(open(f))["closes"] if os.path.exists(f) else None
    return _p[sym]
def dv(sym):
    if sym not in _d:
        f = os.path.join(ROOT, "data/edgar/r3-panel/dividends/%s.json" % sym)
        _d[sym] = json.load(open(f))["dividends"] if os.path.exists(f) else None
    return _d[sym]
def sic2(sym):
    if sym not in _sic:
        f = os.path.join(ROOT, "data/edgar/r1-panel/sic/%s.json" % sym)
        try: _sic[sym] = str(json.load(open(f)).get("sic") or "")[:2]
        except Exception: _sic[sym] = ""
    return _sic[sym]
def close_at(sym, iso):
    c = px(sym)
    if not c: return None
    ds = [d for d in c if d <= iso]
    if not ds: return None
    d = max(ds)
    if ms(iso) - ms(d) > 16: return None
    return c[d]

# ---------- build the G1 panel ----------
rows = []
for row in r2["rows"]:
    if row.get("icc_ri") is None: continue
    sym, Y = row["sym"], row["origin"]
    o0, o1 = "%d-06-30" % Y, "%d-06-30" % (Y + 3)
    p0, p1 = close_at(sym, o0), close_at(sym, o1)
    if p0 is None or p1 is None: continue
    dd = dv(sym) or {}
    divsum = sum(v for k, v in dd.items() if ms(o0) < ms(k) <= ms(o1))
    tr = ((p1 + divsum) / p0) ** (1 / 3) - 1
    f = fc.get(sym + "|" + str(Y))
    if not f or 1 not in f or 3 not in f: continue
    base = date(Y, 6, 30)
    pm1 = close_at(sym, (base - timedelta(days=30)).isoformat())
    pm12 = close_at(sym, (base - timedelta(days=365)).isoformat())
    mom = (pm1 / pm12 - 1) if (pm1 is not None and pm12 is not None and pm12 > 0) else None
    rec = {"sym": sym, "origin": Y, "tr": tr, "bp": row["B0"] / row["price"],
           "size": math.log(row["mcap"]), "mom": mom, "sic2": sic2(sym),
           "negE": 1 if any(f[t].get("negE") for t in (1, 2, 3) if t in f) else 0}
    for path, icckey in (("ri", "icc_ri"), ("ep", "icc_ep")):
        rec["icc_" + path] = row[icckey]
        rec["feps1_p_" + path] = f[1][path] / row["price"]
        rec["slope_" + path] = math.log(f[3][path] / f[1][path]) / 2
    rows.append(rec)
print("G1 panel rows: %d | with momentum: %d" % (len(rows), sum(1 for r in rows if r["mom"] is not None)))
print("origins present:", {Y: sum(1 for r in rows if r["origin"] == Y) for Y in sorted({r['origin'] for r in rows})})
print("origins with momentum:", {Y: sum(1 for r in rows if r["origin"] == Y and r["mom"] is not None)
                                 for Y in sorted({r['origin'] for r in rows})})

# ---------- OLS with origin-clustered SEs ----------
def ols(X, y):
    n, k = len(y), len(X[0])
    XtX = [[0.0] * k for _ in range(k)]; Xty = [0.0] * k
    for i in range(n):
        for a in range(k):
            Xty[a] += X[i][a] * y[i]
            for b in range(k): XtX[a][b] += X[i][a] * X[i][b]
    A = [XtX[i][:] + [Xty[i]] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-12: return None
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        for q in range(c, k + 1): A[c][q] /= pv
        for r in range(k):
            if r == c: continue
            f = A[r][c]
            if f:
                for q in range(c, k + 1): A[r][q] -= f * A[c][q]
    beta = [A[r][k] for r in range(k)]
    inv = invert(XtX)
    return beta, inv, n, k
def invert(M):
    k = len(M); A = [M[i][:] + [1.0 if i == j else 0.0 for j in range(k)] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-12: return None
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        for q in range(2 * k): A[c][q] /= pv
        for r in range(k):
            if r == c: continue
            f = A[r][c]
            if f:
                for q in range(2 * k): A[r][q] -= f * A[c][q]
    return [r[k:] for r in A]
def mul(A, B):
    k = len(A); return [[sum(A[i][q] * B[q][j] for q in range(k)) for j in range(k)] for i in range(k)]

def fit_clustered(data, varnames, fe_key="origin"):
    """pooled with fixed effects on fe_key, clustered SEs by origin"""
    levels = sorted({r[fe_key] for r in data})[1:]     # drop one for the intercept
    X, y = [], []
    for r in data:
        row = [1.0] + [float(r[v]) for v in varnames] + [1.0 if r[fe_key] == L else 0.0 for L in levels]
        X.append(row); y.append(r["tr"])
    out = ols(X, y)
    if not out: return None
    beta, inv, n, k = out
    resid = [y[i] - sum(X[i][j] * beta[j] for j in range(k)) for i in range(n)]
    meat = [[0.0] * k for _ in range(k)]
    groups = {}
    for i, r in enumerate(data): groups.setdefault(r["origin"], []).append(i)
    for idxs in groups.values():
        g = [sum(X[i][a] * resid[i] for i in idxs) for a in range(k)]
        for a in range(k):
            for b in range(k): meat[a][b] += g[a] * g[b]
    V = mul(mul(inv, meat), inv)
    se = [math.sqrt(max(V[i][i], 0)) for i in range(k)]
    names = ["const"] + varnames + ["FE_%s" % L for L in levels]
    return {"names": names, "beta": beta, "se": se,
            "t": [beta[i] / se[i] if se[i] > 0 else None for i in range(k)], "n": n,
            "clusters": len(groups)}

def fit_plain(data, varnames):
    X = [[1.0] + [float(r[v]) for v in varnames] for r in data]
    y = [r["tr"] for r in data]
    out = ols(X, y)
    return None if not out else {"names": ["const"] + varnames, "beta": out[0]}

def get(fit, name):
    return fit["beta"][fit["names"].index(name)] if fit and name in fit["names"] else None
def gett(fit, name):
    return fit["t"][fit["names"].index(name)] if fit and name in fit["names"] else None

def fama_macbeth(data, varnames, key):
    per = {}
    for r in data: per.setdefault(r["origin"], []).append(r)
    bs = []
    for o in sorted(per):
        f = fit_plain(per[o], varnames)
        if f: bs.append((o, get(f, key)))
    vals = [b for _, b in bs if b is not None]
    T = len(vals)
    if T < 2: return bs, None, None
    m = sum(vals) / T
    x = [v - m for v in vals]
    g = sum((1 - abs(i - j) / 2) * x[i] * x[j] for i in range(T) for j in range(T) if abs(i - j) <= 1)
    se = math.sqrt(max(g / (T * T), 0))
    return bs, m, (m / se if se > 0 else None)

def vif(data, varnames, target):
    others = [v for v in varnames if v != target]
    X = [[1.0] + [float(r[v]) for v in others] for r in data]
    y = [float(r[target]) for r in data]
    out = ols(X, y)
    if not out: return None
    beta = out[0]
    yb = sum(y) / len(y)
    ss_res = sum((y[i] - sum(X[i][j] * beta[j] for j in range(len(beta)))) ** 2 for i in range(len(y)))
    ss_tot = sum((v - yb) ** 2 for v in y)
    r2_ = 1 - ss_res / ss_tot if ss_tot else 0
    return 1 / (1 - r2_) if r2_ < 1 else float("inf")

# ---------- run a specification ----------
def run(label, data, path):
    icc, f1, sl = "icc_" + path, "feps1_p_" + path, "slope_" + path
    has_mom = all(r["mom"] is not None for r in data)
    v = ["bp", "size"] + (["mom"] if has_mom else []) + [f1, sl, icc]
    pooled = fit_clustered(data, v)
    bs, fm, fmt = fama_macbeth(data, v, icc)
    print("\n=== %s (path=%s, n=%d, origins=%d) ===" % (label, path.upper(), len(data), len({r['origin'] for r in data})))
    print("  pooled b_icc = %.6f   t = %.3f" % (get(pooled, icc), gett(pooled, icc)))
    print("  FM mean      = %.6f   t = %s" % (fm, ("%.3f" % fmt) if fmt else "n/a"))
    print("  per-origin   : " + "  ".join("%d:%+.4f" % (o, b) for o, b in bs))
    print("  sign positive: %d/%d" % (sum(1 for _, b in bs if b and b > 0), len(bs)))
    loo = []
    for o in sorted({r["origin"] for r in data}):
        sub = [r for r in data if r["origin"] != o]
        f = fit_clustered(sub, v)
        loo.append((o, get(f, icc)))
    print("  leave-one-out: " + "  ".join("-%d:%+.4f" % (o, b) for o, b in loo)
          + "   positive %d/%d" % (sum(1 for _, b in loo if b and b > 0), len(loo)))
    print("  VIF icc=%.3f  feps1_p=%.3f  slope=%.3f" % (vif(data, v, icc), vif(data, v, f1), vif(data, v, sl)))
    return {"pooled": get(pooled, icc), "t": gett(pooled, icc), "fm": fm,
            "sign": (sum(1 for _, b in bs if b and b > 0), len(bs)),
            "loo": (sum(1 for _, b in loo if b and b > 0), len(loo))}

# ---------- three readings of "within-sector" ----------
def sector_readings(data, path):
    icc = "icc_" + path; f1 = "feps1_p_" + path; sl = "slope_" + path
    has_mom = all(r["mom"] is not None for r in data)
    base = ["bp", "size"] + (["mom"] if has_mom else []) + [f1, sl]
    # sizes
    sizes = {}
    for r in data: sizes.setdefault((r["origin"], r["sic2"]), []).append(r)
    small = sum(len(v) for k, v in sizes.items() if len(v) < 5)
    print("\n  sector groups: %d | cells in groups with <5 firms: %d/%d (%.1f%%)"
          % (len(sizes), small, len(data), 100 * small / len(data)))
    # (a) worker reading: normalized rank of ICC within (origin, sic2), singletons -> 0.5
    for r in data:
        g = sizes[(r["origin"], r["sic2"])]
        if len(g) <= 1: r["_rank"] = 0.5
        else:
            srt = sorted(g, key=lambda z: z[icc])
            r["_rank"] = srt.index(r) / (len(g) - 1)
    a = fit_clustered(data, base + ["_rank"])
    # (b) sector fixed effects, ICC in levels  (the standard within-sector estimator)
    lv = sorted({r["sic2"] for r in data})[1:]
    X, y = [], []
    for r in data:
        X.append([1.0] + [float(r[v]) for v in base + [icc]]
                 + [1.0 if r["sic2"] == L else 0.0 for L in lv]
                 + [1.0 if r["origin"] == O else 0.0 for O in sorted({z["origin"] for z in data})[1:]])
        y.append(r["tr"])
    o2 = ols(X, y)
    b_fe = o2[0][1 + len(base + [icc]) - 1] if o2 else None
    # (c) ICC demeaned within (origin, sic2), levels preserved
    for r in data:
        g = sizes[(r["origin"], r["sic2"])]
        m = sum(z[icc] for z in g) / len(g)
        r["_dm"] = r[icc] - m
    c = fit_clustered(data, base + ["_dm"])
    print("  (a) worker: normalized within-sector ICC RANK      b=%+.6f  t=%+.3f" % (get(a, "_rank"), gett(a, "_rank")))
    print("  (b) sector fixed effects, ICC in LEVELS            b=%+.6f" % b_fe)
    print("  (c) ICC demeaned within (origin,sector), LEVELS    b=%+.6f  t=%+.3f" % (get(c, "_dm"), gett(c, "_dm")))

MOM = [r for r in rows if r["mom"] is not None]
run("PRIMARY RI (momentum sample)", MOM, "ri")
sector_readings(MOM, "ri")
run("SENSITIVITY RI (all cells, no momentum)", rows, "ri")
sector_readings(rows, "ri")
run("EP path (momentum sample)", MOM, "ep")
run("no-negE RI (momentum sample)", [r for r in MOM if not r["negE"]], "ri")
