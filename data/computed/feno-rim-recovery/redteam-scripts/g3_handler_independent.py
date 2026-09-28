# cc independent re-derivation of G3. Own implementation, no worker artifact as input.
# Horizon is the only thing that varies; the ICC is never re-solved.
import json, os, math
from datetime import date, timedelta

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
def rj(p): return json.load(open(os.path.join(ROOT, p)))
def ms(d): return date.fromisoformat(d[:10]).toordinal()

r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json")
pan = rj("data/computed/feno-rim-recovery/r1-edgar-panel.json")
fc = {}
for r in pan["rows"]: fc.setdefault(r["sym"] + "|" + str(r["origin"]), {})[r["tau"]] = r
rates = rj("data/macro/fred-banking-daily.json")["series"]["DGS10"]
def rf_at(Y):
    t = "%d-06-30" % Y; v = None
    for x in rates:
        if x["date"] <= t: v = x["value"]
        else: break
    return v / 100.0
_p, _d = {}, {}
def px(s):
    if s not in _p:
        f = os.path.join(ROOT, "data/edgar/r3-panel/prices/%s.json" % s)
        _p[s] = json.load(open(f))["closes"] if os.path.exists(f) else None
    return _p[s]
def dvd(s):
    if s not in _d:
        f = os.path.join(ROOT, "data/edgar/r3-panel/dividends/%s.json" % s)
        _d[s] = json.load(open(f))["dividends"] if os.path.exists(f) else None
    return _d[s]
def close_at(s, iso):
    c = px(s)
    if not c: return None
    ds = [d for d in c if d <= iso]
    if not ds: return None
    d = max(ds)
    return None if ms(iso) - ms(d) > 16 else c[d]

rows = []
for row in r2["rows"]:
    if row.get("icc_ri") is None: continue
    s, Y = row["sym"], row["origin"]
    p0 = close_at(s, "%d-06-30" % Y)
    if p0 is None: continue
    f = fc[s + "|" + str(Y)]
    rec = {"sym": s, "origin": Y, "BP": row["B0"] / row["price"], "SIZE": math.log(row["mcap"]),
           "ICC": row["icc_ri"], "F1P": f[1]["ri"] / row["price"],
           "SLOPE": math.log(f[3]["ri"] / f[1]["ri"]) / 2, "rf": rf_at(Y)}
    ok = True
    for h in (1, 2, 3):
        p1 = close_at(s, "%d-06-30" % (Y + h))
        if p1 is None: ok = False; break
        dd = dvd(s) or {}
        ds_ = sum(v for k, v in dd.items() if ms("%d-06-30" % Y) < ms(k) <= ms("%d-06-30" % (Y + h)))
        rec["R%d" % h] = ((p1 + ds_) / p0) ** (1 / h) - 1
    if ok: rows.append(rec)
print("panel:", len(rows), "| per origin:", {Y: sum(1 for r in rows if r["origin"] == Y) for Y in sorted({r['origin'] for r in rows})})

def ols(X, y):
    n, k = len(y), len(X[0])
    A = [[0.0] * (k + 1) for _ in range(k)]
    for i in range(n):
        for a in range(k):
            A[a][k] += X[i][a] * y[i]
            for b in range(k): A[a][b] += X[i][a] * X[i][b]
    XtX = [row[:k] for row in A]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(A[r][c]))
        if abs(A[p][c]) < 1e-14: return None, None
        A[c], A[p] = A[p], A[c]
        pv = A[c][c]
        for q in range(c, k + 1): A[c][q] /= pv
        for r in range(k):
            if r == c: continue
            fq = A[r][c]
            if fq:
                for q in range(c, k + 1): A[r][q] -= fq * A[c][q]
    return [A[r][k] for r in range(k)], XtX
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

VARS = ["BP", "SIZE", "F1P", "SLOPE", "ICC"]
def pooled(data, dep, extra_fe=None):
    lv = sorted({r["origin"] for r in data})[1:]
    sec = sorted({r.get("SEC", "") for r in data})[1:] if extra_fe else []
    X, y = [], []
    for r in data:
        X.append([1.0] + [r[v] for v in VARS] + [1.0 if r["origin"] == O else 0.0 for O in lv]
                 + [1.0 if r.get("SEC") == S else 0.0 for S in sec])
        y.append(r[dep])
    b, XtX = ols(X, y)
    if not b: return None, None
    k = len(b)
    resid = [y[i] - sum(X[i][j] * b[j] for j in range(k)) for i in range(len(y))]
    inv = invert(XtX)
    meat = [[0.0] * k for _ in range(k)]
    gr = {}
    for i, r in enumerate(data): gr.setdefault(r["origin"], []).append(i)
    for ids in gr.values():
        g = [sum(X[i][a] * resid[i] for i in ids) for a in range(k)]
        for a in range(k):
            for b2 in range(k): meat[a][b2] += g[a] * g[b2]
    V = mul(mul(inv, meat), inv)
    idx = 1 + VARS.index("ICC")
    return b[idx], (b[idx] / math.sqrt(V[idx][idx]) if V[idx][idx] > 0 else None)

def rank_avg(v):
    idx = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(idx):
        j = i
        while j + 1 < len(idx) and v[idx[j + 1]] == v[idx[i]]: j += 1
        a = (i + j) / 2.0 + 1
        for k in range(i, j + 1): r[idx[k]] = a
        i = j + 1
    return r
def pear(x, y):
    n = len(x); mx = sum(x) / n; my = sum(y) / n
    nu = sum((x[i] - mx) * (y[i] - my) for i in range(n))
    dx = sum((a - mx) ** 2 for a in x); dy = sum((b - my) ** 2 for b in y)
    return nu / math.sqrt(dx * dy) if dx and dy else None
def q_nearest(sorted_vals, q):
    n = len(sorted_vals); return sorted_vals[max(0, math.ceil(q * n) - 1)]

for h in (1, 2, 3):
    dep = "R%d" % h
    b, t = pooled(rows, dep)
    per, ics, spreads = [], [], []
    for Y in sorted({r["origin"] for r in rows}):
        g = [r for r in rows if r["origin"] == Y]
        X = [[1.0] + [r[v] for v in VARS] for r in g]
        bb, _ = ols(X, [r[dep] for r in g])
        per.append(bb[1 + VARS.index("ICC")])
        ics.append(pear(rank_avg([r["ICC"] for r in g]), rank_avg([r[dep] for r in g])))
        sv = sorted(r["BP"] for r in g)
        c1, c2 = q_nearest(sv, 1 / 3), q_nearest(sv, 2 / 3)
        buckets = [[], [], []]
        for r in g: buckets[0 if r["BP"] <= c1 else (1 if r["BP"] <= c2 else 2)].append(r)
        sp = []
        for bkt in buckets:
            if len(bkt) < 4: continue
            o = sorted(bkt, key=lambda z: (z["ICC"], z["sym"]))
            nh = math.ceil(len(o) / 2)
            L, H = o[:len(o) - nh], o[len(o) - nh:]
            sp.append(sum(z[dep] - z["rf"] for z in H) / len(H) - sum(z[dep] - z["rf"] for z in L) / len(L))
        spreads.append(sum(sp) / len(sp) if sp else None)
    fm = sum(per) / len(per)
    x = [p - fm for p in per]; T = len(per)
    g = sum((1 - abs(i - j) / 2) * x[i] * x[j] for i in range(T) for j in range(T) if abs(i - j) <= 1)
    se = math.sqrt(max(g / (T * T), 0)); fmt = fm / se if se > 0 else None
    print("\n=== %dm horizon (T_eff = %.2f, n = %d) ===" % (h * 12, 5.0 / h, len(rows)))
    print("  pooled b_icc = %+.6f   clustered t = %+.4f   %s" % (b, t, "PASSES |t|>=2" if abs(t) >= 2 else "BELOW |t|=2"))
    print("  per-origin   : " + "  ".join("%+.3f" % p for p in per) + "   positive %d/5" % sum(1 for p in per if p > 0))
    print("  FM mean      = %+.6f  NW t = %+.4f" % (fm, fmt))
    print("  rank IC      : " + "  ".join("%+.3f" % i for i in ics) + "   mean %+.6f  positive %d/5" % (sum(ics) / len(ics), sum(1 for i in ics if i > 0)))
    print("  spread(equal): " + "  ".join("%+.3f" % s for s in spreads) + "   positive %d/5" % sum(1 for s in spreads if s > 0))
