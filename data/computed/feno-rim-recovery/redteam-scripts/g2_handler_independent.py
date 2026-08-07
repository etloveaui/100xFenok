# cc independent re-derivation of G2. Own implementation of the statistic, the permutation,
# the negative control and the GLS solver. Reads no worker artifact as input.
# T_obs is deterministic and must match exactly. p-values are re-run on a DIFFERENT seed:
# matching a p-value under the same seed only proves the same code ran twice.
import json, os, math, random
from datetime import date, timedelta

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
def rj(p): return json.load(open(os.path.join(ROOT, p)))
def ms(d): return date.fromisoformat(d[:10]).toordinal()

r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json")
panel = rj("data/computed/feno-rim-recovery/r1-edgar-panel.json")
fc = {}
for r in panel["rows"]:
    fc.setdefault(r["sym"] + "|" + str(r["origin"]), {})[r["tau"]] = r
rates = rj("data/macro/fred-banking-daily.json")["series"]["DGS10"]
def rf_at(Y):
    t = "%d-06-30" % Y; v = None
    for x in rates:
        if x["date"] <= t: v = x["value"]
        else: break
    return v / 100.0 if v is not None else None

_p, _d, _s = {}, {}, {}
def px(sym):
    if sym not in _p:
        f = os.path.join(ROOT, "data/edgar/r3-panel/prices/%s.json" % sym)
        _p[sym] = json.load(open(f))["closes"] if os.path.exists(f) else None
    return _p[sym]
def dvd(sym):
    if sym not in _d:
        f = os.path.join(ROOT, "data/edgar/r3-panel/dividends/%s.json" % sym)
        _d[sym] = json.load(open(f))["dividends"] if os.path.exists(f) else None
    return _d[sym]
def sic2(sym):
    if sym not in _s:
        f = os.path.join(ROOT, "data/edgar/r1-panel/sic/%s.json" % sym)
        try: _s[sym] = str(json.load(open(f)).get("sic") or "")[:2]
        except Exception: _s[sym] = ""
    return _s[sym]
def close_at(sym, iso):
    c = px(sym)
    if not c: return None
    ds = [d for d in c if d <= iso]
    if not ds: return None
    d = max(ds)
    return None if ms(iso) - ms(d) > 16 else c[d]

# ---------- build panel ----------
rows = []
for row in r2["rows"]:
    if row.get("icc_ri") is None: continue
    sym, Y = row["sym"], row["origin"]
    o0, o1 = "%d-06-30" % Y, "%d-06-30" % (Y + 3)
    p0, p1 = close_at(sym, o0), close_at(sym, o1)
    if p0 is None or p1 is None: continue
    dd = dvd(sym) or {}
    ds = sum(v for k, v in dd.items() if ms(o0) < ms(k) <= ms(o1))
    R = ((p1 + ds) / p0) ** (1 / 3) - 1
    base = date(Y, 6, 30)
    pm1 = close_at(sym, (base - timedelta(days=30)).isoformat())
    pm12 = close_at(sym, (base - timedelta(days=365)).isoformat())
    p_365 = close_at(sym, (base - timedelta(days=365)).isoformat())
    p_730 = close_at(sym, (base - timedelta(days=730)).isoformat())
    f = fc.get(sym + "|" + str(Y))
    rows.append({"sym": sym, "origin": Y, "R": R, "EXC": R - rf_at(Y),
                 "ICC": row["icc_ri"], "BP": row["B0"] / row["price"],
                 "SIZE": math.log(row["mcap"]), "SEC": sic2(sym),
                 "MOM": (pm1 / pm12 - 1) if (pm1 and pm12 and pm12 > 0) else None,
                 "PRE12": (p0 / p_365 - 1) if (p_365 and p_365 > 0) else None,
                 "PRE24": (p0 / p_730 - 1) if (p_730 and p_730 > 0) else None,
                 "B0": row["B0"], "price": row["price"], "payout": row["payout"],
                 "targetRoe": row["targetRoe"],
                 "f1": f[1]["ri"], "f2": f[2]["ri"], "f3": f[3]["ri"]})
print("panel:", len(rows), "| origins:", {Y: sum(1 for r in rows if r["origin"] == Y) for Y in sorted({r['origin'] for r in rows})})

# ---------- G2-A ----------
def terciles(vals):
    s = sorted(vals); n = len(s)
    return s[int(n * 0.3333)], s[int(n * 0.6667)]

def strata_of(group, kind):
    if kind == "S_sec":
        by = {}
        for r in group: by.setdefault(r["SEC"], []).append(r)
        return [v for v in by.values() if len(v) >= 6]
    key = "BP" if kind == "S_bp" else "SIZE"
    c1, c2 = terciles([r[key] for r in group])
    b = [[], [], []]
    for r in group: b[0 if r[key] <= c1 else (1 if r[key] <= c2 else 2)].append(r)
    return [x for x in b if x]

def T_stat(strata, iccs=None):
    """half-split on ICC within stratum, difference of mean EXC, count-weighted, n_g>=4"""
    num = den = 0.0
    off = 0
    for g in strata:
        n = len(g)
        vals = [x["ICC"] for x in g] if iccs is None else iccs[off:off + n]
        off += n
        if n < 4: continue
        order = sorted(range(n), key=lambda i: vals[i])
        nh = math.ceil(n / 2)
        H = order[n - nh:]; L = order[:n - nh]
        if not H or not L: continue
        sp = sum(g[i]["EXC"] for i in H) / len(H) - sum(g[i]["EXC"] for i in L) / len(L)
        num += sp * n; den += n
    return num / den if den else None

REPS = 2000
ALT_SEED = 77777777           # deliberately NOT the worker's seed
print("\nG2-A  (T_obs deterministic; p re-run on an independent seed, %d reps)" % REPS)
for kind in ("S_bp", "S_size", "S_sec"):
    line = []
    for Y in sorted({r["origin"] for r in rows}):
        g = [r for r in rows if r["origin"] == Y]
        st = strata_of(g, kind)
        tobs = T_stat(st)
        flat = [x["ICC"] for s in st for x in s]
        rng = random.Random(ALT_SEED + Y * 13 + hash(kind) % 97)
        ge = 0
        sizes = [len(s) for s in st]
        for _ in range(REPS):
            perm = []
            for s in st:
                v = [x["ICC"] for x in s]
                rng.shuffle(v); perm.extend(v)
            if T_stat(st, perm) >= tobs: ge += 1
        p = (1 + ge) / (REPS + 1)
        line.append("%d:T=%+.4f p=%.4f%s" % (Y, tobs, p, "*" if p <= 0.05 else " "))
    sig = sum(1 for x in line if "*" in x)
    print("  %-7s %s   significant %d/5" % (kind, "  ".join(line), sig))

# ---------- G2-B ----------
def ols(X, y):
    n, k = len(y), len(X[0])
    A = [[0.0] * (k + 1) for _ in range(k)]
    for i in range(n):
        for a in range(k):
            A[a][k] += X[i][a] * y[i]
            for b in range(k): A[a][b] += X[i][a] * X[i][b]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-14: return None
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        for q in range(c, k + 1): A[c][q] /= pv
        for r in range(k):
            if r == c: continue
            fq = A[r][c]
            if fq:
                for q in range(c, k + 1): A[r][q] -= fq * A[c][q]
    return [A[r][k] for r in range(k)]

def partial_r2(data, dep, varnames, target):
    yv = [r[dep] for r in data]
    def rss(vs):
        X = [[1.0] + [float(r[v]) for v in vs] + [1.0 if r["origin"] == O else 0.0
             for O in sorted({z["origin"] for z in data})[1:]] for r in data]
        b = ols(X, yv)
        if not b: return None
        return sum((yv[i] - sum(X[i][j] * b[j] for j in range(len(b)))) ** 2 for i in range(len(yv))), b, X
    full = rss(varnames); red = rss([v for v in varnames if v != target])
    if not full or not red: return None, None
    r_full, b, X = full
    pr2 = (red[0] - r_full) / red[0] if red[0] else None
    # clustered t on target
    idx = 1 + varnames.index(target)
    resid = [yv[i] - sum(X[i][j] * b[j] for j in range(len(b))) for i in range(len(yv))]
    k = len(b)
    XtX = [[sum(X[i][a] * X[i][b2] for i in range(len(X))) for b2 in range(k)] for a in range(k)]
    inv = invert(XtX)
    meat = [[0.0] * k for _ in range(k)]
    gr = {}
    for i, r in enumerate(data): gr.setdefault(r["origin"], []).append(i)
    for ids in gr.values():
        gg = [sum(X[i][a] * resid[i] for i in ids) for a in range(k)]
        for a in range(k):
            for b2 in range(k): meat[a][b2] += gg[a] * gg[b2]
    V = mul(mul(inv, meat), inv)
    return b[idx], (b[idx] / math.sqrt(V[idx][idx]) if V[idx][idx] > 0 else None), pr2

def invert(M):
    k = len(M); A = [M[i][:] + [1.0 if i == j else 0.0 for j in range(k)] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        for q in range(2 * k): A[c][q] /= pv
        for r in range(k):
            if r == c: continue
            fq = A[r][c]
            if fq:
                for q in range(2 * k): A[r][q] -= fq * A[c][q]
    return [r[k:] for r in A]
def mul(A, B):
    k = len(A); return [[sum(A[i][q] * B[q][j] for q in range(k)) for j in range(k)] for i in range(k)]

print("\nG2-B negative control")
for dep, yrs in (("PRE12", (2020, 2021, 2022, 2023)), ("PRE24", (2021, 2022, 2023))):
    d = [r for r in rows if r["origin"] in yrs and r[dep] is not None and r["MOM"] is not None]
    b, t, pr2 = partial_r2(d, dep, ["BP", "SIZE", "MOM", "ICC"], "ICC")
    d2 = [r for r in rows if r["origin"] in yrs and r[dep] is not None]
    b2, t2, pr22 = partial_r2(d2, dep, ["BP", "SIZE", "ICC"], "ICC")
    print("  %s n=%4d  b_icc=%+.6f t=%+.3f partialR2=%.2e   | no-mom n=%4d b=%+.6f t=%+.3f pR2=%.2e"
          % (dep, len(d), b, t, pr2, len(d2), b2, t2, pr22))

# ---------- G2-C ----------
T = 12
def gls_icc(price, B0, f1, f2, f3, payout, target):
    if not (price > 0 and B0 > 0): return None
    B = [B0] * (T + 1); froe = [0.0] * (T + 1)
    froe[1] = f1 / B0; B[1] = B0 + f1 * (1 - payout)
    froe[2] = f2 / B[1]; B[2] = B[1] + f2 * (1 - payout)
    froe[3] = f3 / B[2]; B[3] = B[2] + f3 * (1 - payout)
    step = (froe[3] - target) / (T - 3)
    for i in range(4, T + 1):
        froe[i] = froe[3] - (i - 3) * step
        B[i] = B[i - 1] + froe[i] * B[i - 1] * (1 - payout)
    def val(r):
        v = B0
        for i in range(1, T): v += (froe[i] - r) * B[i - 1] / (1 + r) ** i
        v += (froe[T] - r) * B[T - 1] / (r * (1 + r) ** (T - 1))
        return v
    lo, hi = 0.001, 0.60
    flo, fhi = val(lo) - price, val(hi) - price
    if not (flo > 0 and fhi < 0): return None
    a, b = lo, hi
    for _ in range(60):
        m = (a + b) / 2; fm = val(m) - price
        if abs(fm) < 1e-9 or (b - a) / 2 < 1e-9: return m
        if fm > 0: a = m
        else: b = m
    return (a + b) / 2

MOM = [r for r in rows if r["MOM"] is not None]
def fit_icc_coef(data, icckey):
    lv = sorted({r["origin"] for r in data})[1:]
    X = [[1.0, r["BP"], r["SIZE"], r["MOM"], r[icckey]] + [1.0 if r["origin"] == O else 0.0 for O in lv] for r in data]
    y = [r["R"] for r in data]
    b = ols(X, y)
    return b[4] if b else None
obs = fit_icc_coef(MOM, "ICC")
REPS_C = 40
rng = random.Random(31337)
dist, nonconv = [], []
for rep in range(REPS_C):
    ok, drop = [], 0
    for Y in sorted({r["origin"] for r in MOM}):
        g = [r for r in MOM if r["origin"] == Y]
        prices = [r["price"] for r in g]
        rng.shuffle(prices)
        for r, pp in zip(g, prices):
            v = gls_icc(pp, r["B0"], r["f1"], r["f2"], r["f3"], r["payout"], r["targetRoe"])
            if v is None: drop += 1
            else: ok.append({**r, "ICCs": v})
    nonconv.append(drop / len(MOM))
    c = fit_icc_coef(ok, "ICCs")
    if c is not None: dist.append(c)
dist.sort()
def pct(q): return dist[min(int(q * len(dist)), len(dist) - 1)]
print("\nG2-C shuffled-price placebo (%d reps, independent seed)" % REPS_C)
print("  observed b_icc (my rebuild) = %+.6f" % obs)
print("  placebo mean=%+.6f sd=%.6f  [p2.5 %+.6f, p50 %+.6f, p97.5 %+.6f]"
      % (sum(dist) / len(dist), math.sqrt(sum((x - sum(dist) / len(dist)) ** 2 for x in dist) / (len(dist) - 1)),
         pct(0.025), pct(0.5), pct(0.975)))
print("  reps with placebo b >= observed: %d/%d" % (sum(1 for x in dist if x >= obs), len(dist)))
print("  max non-convergence share in any rep: %.3f%%" % (100 * max(nonconv)))
