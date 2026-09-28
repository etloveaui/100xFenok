#!/usr/bin/env python3
"""cc independent red-team recomputation of R0-A..D.
Own implementation in Python. No import of any handler module (handler code is .mjs).
Reads only committed input artifacts; does NOT read R0_ADJUDICATION.json or r0-firm-panel.json.
"""
import json, math, os, random
from datetime import date

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
def rj(p): return json.load(open(os.path.join(ROOT, p)))
def ordn(s): return date.fromisoformat(s[:10]).toordinal()

H, FADE, TERM = 3, 3, 10
WIN_DAYS = 36 * 30.44
TOL = 45

# ---------- own primitives ----------
def rank_avg(v):
    idx = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v); i = 0
    while i < len(idx):
        j = i
        while j + 1 < len(idx) and v[idx[j + 1]] == v[idx[i]]: j += 1
        a = (i + j) / 2.0 + 1
        for k in range(i, j + 1): r[idx[k]] = a
        i = j + 1
    return r

def pearson(x, y):
    n = len(x); mx = sum(x)/n; my = sum(y)/n
    nu = sum((x[i]-mx)*(y[i]-my) for i in range(n))
    dx = sum((a-mx)**2 for a in x); dy = sum((b-my)**2 for b in y)
    return nu/math.sqrt(dx*dy) if dx and dy else None

def spearman(x, y):
    if len(x) < 4: return None
    return pearson(rank_avg(x), rank_avg(y))

def ols(X, y):
    """X = list of rows (without intercept). Returns [a, b1, b2, ...] via normal equations."""
    n = len(y); k = len(X[0]) + 1
    A = [[0.0]*k for _ in range(k)]; b = [0.0]*k
    for i in range(n):
        row = [1.0] + list(X[i])
        for r in range(k):
            b[r] += row[r]*y[i]
            for c in range(k): A[r][c] += row[r]*row[c]
    # gaussian elimination with partial pivoting
    M = [A[r][:] + [b[r]] for r in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-12: return None
        M[c], M[p] = M[p], M[c]
        pv = M[c][c]
        for j in range(c, k+1): M[c][j] /= pv
        for r in range(k):
            if r == c: continue
            f = M[r][c]
            if f:
                for j in range(c, k+1): M[r][j] -= f*M[c][j]
    return [M[r][k] for r in range(k)]

def mean(v): return sum(v)/len(v)
def median(v):
    s = sorted(v); n = len(s)
    return s[n//2] if n % 2 else (s[n//2-1]+s[n//2])/2
def sd(v):
    m = mean(v); return math.sqrt(sum((x-m)**2 for x in v)/(len(v)-1))

def nw_se(v, lag):
    n = len(v); m = mean(v); e = [x-m for x in v]
    s = sum(x*x for x in e)/n
    for L in range(1, lag+1):
        w = 1 - L/(lag+1)
        s += 2*w*sum(e[i]*e[i+L] for i in range(n-L))/n
    return math.sqrt(max(s, 0)/n)

def norm_p_two(t):
    return 2*(1 - 0.5*(1+math.erf(abs(t)/math.sqrt(2))))

def lcg(seed):
    s = seed & 0xFFFFFFFF
    def nxt():
        nonlocal s
        s = (s*1664525 + 1013904223) & 0xFFFFFFFF
        return s/4294967296
    return nxt

def block_boot(v, blk, reps=10000, seed=20260807, use_lcg=True):
    n = len(v)
    rnd = lcg(seed) if use_lcg else (lambda r=random.Random(seed): r.random)()
    out = []
    for _ in range(reps):
        b = []
        while len(b) < n:
            st = int(rnd()*n)
            if st >= n: st = n-1
            for k in range(blk):
                if len(b) >= n: break
                b.append(v[(st+k) % n])
        out.append(sum(b)/n)
    out.sort()
    return out[int(reps*0.025)], out[int(reps*0.975)], mean(out)

def ess_n(v, lags):
    n = len(v); m = mean(v)
    den = sum((x-m)**2 for x in v)
    if den == 0: return float(n)
    s = 0.0
    for k in range(1, lags+1):
        s += sum((v[i]-m)*(v[i+k]-m) for i in range(n-k))/den
    return n/(1+2*s)

# ---------- build the firm-level panel (own construction) ----------
panel = rj("data/computed/feno-rim-v2/e2-basket-panel.json")
audit = rj("data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json")
rates = rj("data/macro/fred-banking-daily.json")["series"]["DGS10"]
erp = sorted(({"t": ordn(o["first_knowable"]), "us": o["us_erp"]}
              for o in rj("data/computed/feno-rim-v2/erp-archive-restoration.json")["observations"]),
             key=lambda z: z["t"])
complete_set = {w["as_of"] for w in
                audit["p0_adjudications"]["p0_3_baseline_truncation"]["evidence"]["e2_baseline_windows"]["window_rows_per_origin"]
                if w["years"] >= 9.5}

px, dv = {}, {}
for f in os.listdir(os.path.join(ROOT, "data/yf/finance")):
    if not f.endswith(".unadjusted.json"): continue
    s = f[:-len(".unadjusted.json")]
    d = rj("data/yf/finance/" + f)["data"]
    px[s] = sorted(((ordn(r["date"]), r["Close"]) for r in (d.get("history_unadjusted") or [])), key=lambda z: z[0])
    dv[s] = sorted(((ordn(k), v) for k, v in (d.get("dividends") or {}).items()), key=lambda z: z[0])

def at_idx(arr, t):
    lo, hi, f = 0, len(arr)-1, -1
    while lo <= hi:
        mid = (lo+hi)//2
        if arr[mid][0] <= t: f = mid; lo = mid+1
        else: hi = mid-1
    return f

def deploy_path(m):
    book, roe, bd = m["book"], m["roe"], m.get("roe_band")
    if not (book > 0) or roe is None or not math.isfinite(roe): return None
    tgt = (bd["low"]+bd["high"])/2 if bd and math.isfinite(bd.get("low", float('nan'))) and math.isfinite(bd.get("high", float('nan'))) else roe
    p, pb = [], book
    for y in range(1, H+1):
        w = min(1.0, y/FADE); r = roe + (tgt-roe)*w
        e = r*pb; nb = pb + e
        p.append((e, nb)); pb = nb
    return p

def ri_value(book0, path, ke):
    if not (book0 > 0) or not (ke > 0) or not path: return None
    v = book0; pb = book0; last = None
    for k, (earn, bk) in enumerate(path):
        if not math.isfinite(earn) or not math.isfinite(bk): return None
        ri = earn - ke*pb
        v += ri/(1+ke)**(k+1)
        pb = bk; last = ri
    if last is not None:
        n = len(path)
        for k in range(1, TERM+1):
            v += last*((TERM-k)/TERM)/(1+ke)**(n+k)
    return v

origins = []
for o in panel["origin_rows"]:
    t0 = ordn(o["as_of"]); t1 = t0 + WIN_DAYS
    rate = None
    for r in rates:
        if r["date"] <= o["as_of"]: rate = r
        else: break
    pe = [x for x in erp if x["t"] <= t0]
    if rate is None or not pe: continue
    ke = rate["value"]*0.01 + pe[-1]["us"]
    rf0 = rate["value"]*0.01
    members = []
    for m in o["members"]:
        if not m.get("ok"): continue
        if not (m.get("book", 0) > 0 and m.get("price", 0) > 0 and m.get("shares", 0) > 0): continue
        if m.get("roe") is None or not math.isfinite(m["roe"]): continue
        p = px.get(m["symbol"])
        if not p: continue
        ia, ib = at_idx(p, t0), at_idx(p, t1)
        if ia < 0 or ib < 0: continue
        if t0 - p[ia][0] > TOL or t1 - p[ib][0] > TOL: continue
        dp = deploy_path(m); V = ri_value(m["book"], dp, ke) if dp else None
        if V is None or not math.isfinite(V) or V <= 0: continue
        mcap = m["price"]*m["shares"]
        div = sum(x[1] for x in dv.get(m["symbol"], []) if t0 < x[0] <= t1)
        tr = ((p[ib][1] + div)/p[ia][1])**(1/3) - 1
        mom = None
        if ia >= 252:
            c1, c0 = p[ia-21][1], p[ia-252][1]
            if c0 > 0: mom = c1/c0 - 1
        members.append({"sym": m["symbol"], "vp": V/mcap, "bp": m["book"]/mcap,
                        "tr": tr, "exc": tr - rf0, "mc": mcap, "mom": mom})
    if len(members) < 20: continue
    icv = spearman([x["vp"] for x in members], [x["tr"] for x in members])
    icb = spearman([x["bp"] for x in members], [x["tr"] for x in members])
    if icv is None or icb is None: continue
    origins.append({"as_of": o["as_of"], "n": len(members), "ic_vp": icv, "ic_bp": icb,
                    "complete": o["as_of"] in complete_set, "members": members})

# ---------- reproduction gate ----------
x2 = {r["as_of"]: r for r in rj("data/computed/feno-rim-v2/RIM_CROSS_SECTIONAL_BOTTOM_UP.json")["per_origin_rows"]}
gate_fail = []
for o in origins:
    ref = x2.get(o["as_of"])
    if ref is None: gate_fail.append((o["as_of"], "missing_in_x2")); continue
    if ref["n"] != o["n"]: gate_fail.append((o["as_of"], f"n {ref['n']}!={o['n']}"))
    if abs(round(o["ic_vp"], 6) - ref["ic_vp"]) > 1e-6: gate_fail.append((o["as_of"], f"ic_vp {ref['ic_vp']} vs {o['ic_vp']:.6f}"))
    if abs(round(o["ic_bp"], 6) - ref["ic_bp"]) > 1e-6: gate_fail.append((o["as_of"], f"ic_bp {ref['ic_bp']} vs {o['ic_bp']:.6f}"))
    if ref["complete"] != o["complete"]: gate_fail.append((o["as_of"], "complete flag"))
print(f"REPRODUCTION GATE: origins rebuilt={len(origins)} x2={len(x2)} mismatches={len(gate_fail)}")
for g in gate_fail[:10]: print("   MISMATCH", g)
print("GATE:", "PASS" if not gate_fail and len(origins) == len(x2) else "FAIL")
print()

SETS = {"all_origins": origins, "window_complete": [o for o in origins if o["complete"]]}

def report_series(name, v, label):
    T = len(v); m = mean(v)
    out = {"n": T, "mean": m, "median": median(v), "share_pos": sum(1 for x in v if x > 0)/T}
    se2 = nw_se(v, 2); out["nw2_t"] = m/se2 if se2 else float('nan'); out["nw2_p"] = norm_p_two(out["nw2_t"])
    se11 = nw_se(v, 11); out["nw11_t"] = m/se11 if se11 else float('nan'); out["nw11_p"] = norm_p_two(out["nw11_t"])
    out["ess"] = ess_n(v, 11)
    s = sd(v); hw = 1.96*s/math.sqrt(out["ess"])
    out["ess_ci"] = (m-hw, m+hw)
    for blk in (4, 8, 12):
        out[f"b{blk}"] = block_boot(v, blk)[:2]
    lo, hi, _ = block_boot(v, 4, seed=20260807, use_lcg=False)
    out["b4_alt_rng"] = (lo, hi)
    print(f"  [{label}] {name}: T={T} mean={m:+.4f} median={median(v):+.4f} pos={out['share_pos']*100:.0f}% "
          f"| NW2 t={out['nw2_t']:+.2f} p={out['nw2_p']:.3f} | NW11 t={out['nw11_t']:+.2f} p={out['nw11_p']:.3f} "
          f"| ESS={out['ess']:.1f} ESS-CI=[{out['ess_ci'][0]:+.4f},{out['ess_ci'][1]:+.4f}]")
    print(f"        block CIs  4:[{out['b4'][0]:+.4f},{out['b4'][1]:+.4f}]  8:[{out['b8'][0]:+.4f},{out['b8'][1]:+.4f}]  "
          f"12:[{out['b12'][0]:+.4f},{out['b12'][1]:+.4f}]  b4(alt RNG):[{out['b4_alt_rng'][0]:+.4f},{out['b4_alt_rng'][1]:+.4f}]")
    return out

RES = {}
SERIES = {}

print("=== R0-A  paired IC difference  D = IC(V/P) - IC(B/P) ===")
for sname, oset in SETS.items():
    D = [o["ic_vp"]-o["ic_bp"] for o in oset]
    SERIES[f"A|{sname}"] = D
    RES[("A", sname)] = report_series("D", D, sname)
print()

print("=== R0-B  residualized V/P  (rank V/P ~ rank B/P per origin, Spearman resid vs return) ===")
for sname, oset in SETS.items():
    ser = []
    for o in oset:
        ms_ = o["members"]; n = len(ms_)
        rv = rank_avg([x["vp"] for x in ms_]); rb = rank_avg([x["bp"] for x in ms_])
        co = ols([[b] for b in rb], rv)
        resid = [rv[i] - (co[0] + co[1]*rb[i]) for i in range(n)]
        ser.append(spearman(resid, [x["tr"] for x in ms_]))
    SERIES[f"B|{sname}"] = ser
    RES[("B", sname)] = report_series("residual IC", ser, sname)
print()

print("=== R0-C  Fama-MacBeth on unit ranks, dependent = exc ===")
def unit(r, n): return [(x-1)/(n-1) for x in r]
for sname, oset in SETS.items():
    b2m1, b2m2, m2_void = [], [], 0
    for o in oset:
        ms_ = o["members"]; n = len(ms_)
        ub = unit(rank_avg([x["bp"] for x in ms_]), n)
        uv = unit(rank_avg([x["vp"] for x in ms_]), n)
        y = [x["exc"] for x in ms_]
        c1 = ols([[ub[i], uv[i]] for i in range(n)], y)
        b2m1.append(c1[2])
        sub = [x for x in ms_ if x["mom"] is not None]
        if len(sub) >= 20:
            k = len(sub)
            sb = unit(rank_avg([x["bp"] for x in sub]), k)
            sv = unit(rank_avg([x["vp"] for x in sub]), k)
            ss = unit(rank_avg([math.log(x["mc"]) for x in sub]), k)
            sm = unit(rank_avg([x["mom"] for x in sub]), k)
            c2 = ols([[sb[i], sv[i], ss[i], sm[i]] for i in range(k)], [x["exc"] for x in sub])
            b2m2.append(c2[2])
        else: m2_void += 1
    SERIES[f"C1|{sname}"] = b2m1
    SERIES[f"C2|{sname}"] = b2m2
    SERIES[f"asof|{sname}"] = [o["as_of"] for o in oset]
    RES[("C1", sname)] = report_series("b2 Model1", b2m1, sname)
    # leave-one-out on Model 1
    full = mean(b2m1); loo = [mean([b2m1[j] for j in range(len(b2m1)) if j != i]) for i in range(len(b2m1))]
    print(f"        LOO Model1: max|delta mean|={max(abs(x-full) for x in loo):.4f} sign_flip={'YES' if any((x>0)!=(full>0) for x in loo) else 'no'}")
    if b2m2:
        RES[("C2", sname)] = report_series("b2 Model2", b2m2, sname)
        print(f"        Model2 origins used={len(b2m2)} voided={m2_void}")
print()

print("=== R0-D  stratified permutation (B/P terciles, within-tercile V/P median split) ===")
def stat_S(ms_, order=None):
    n = len(ms_)
    rb = rank_avg([x["bp"] for x in ms_])
    rv = rank_avg([x["vp"] for x in ms_]) if order is None else order
    groups = {}
    for i in range(n):
        g = int(3*(rb[i]-1)/n); g = min(g, 2)
        groups.setdefault(g, []).append(i)
    parts = []
    for g, idxs in groups.items():
        if len(idxs) < 2: continue
        srt = sorted(idxs, key=lambda i: rv[i])
        k = len(srt); nlow = k - k//2
        low = srt[:nlow]; high = srt[nlow:]
        if not low or not high: continue
        parts.append(mean([ms_[i]["exc"] for i in high]) - mean([ms_[i]["exc"] for i in low]))
    return mean(parts) if parts else None

for sname, oset in SETS.items():
    Ss, ps = [], []
    for oi, o in enumerate(oset):
        ms_ = o["members"]; n = len(ms_)
        rb = rank_avg([x["bp"] for x in ms_]); rv = rank_avg([x["vp"] for x in ms_])
        Sobs = stat_S(ms_)
        if Sobs is None: continue
        groups = {}
        for i in range(n):
            g = min(int(3*(rb[i]-1)/n), 2); groups.setdefault(g, []).append(i)
        rnd = random.Random(20260807 + oi)
        ge = 0; reps = 10000
        for _ in range(reps):
            perm = rv[:]
            for g, idxs in groups.items():
                vals = [rv[i] for i in idxs]; rnd.shuffle(vals)
                for i, val in zip(idxs, vals): perm[i] = val
            Sp = stat_S(ms_, order=perm)
            if Sp is not None and Sp >= Sobs: ge += 1
        p1 = (ge+1)/(reps+1)
        Ss.append(Sobs); ps.append(p1)
    T = len(Ss)
    print(f"  [{sname}] mean S={mean(Ss):+.4f} median={median(Ss):+.4f} S>0 in {sum(1 for x in Ss if x>0)}/{T} "
          f"| origins with one-sided p<0.05: {sum(1 for p in ps if p<0.05)}/{T}")
    lo, hi, _ = block_boot(Ss, 4)
    lo8, hi8, _ = block_boot(Ss, 8)
    print(f"        block-4 CI on mean S [{lo:+.4f},{hi:+.4f}]  block-8 [{lo8:+.4f},{hi8:+.4f}]  ESS={ess_n(Ss,11):.1f}")
    SERIES[f"D|{sname}"] = Ss
    RES[("D", sname)] = {"mean": mean(Ss), "pos": sum(1 for x in Ss if x > 0), "T": T,
                         "sig": sum(1 for p in ps if p < 0.05)}
print()

print("=== VERDICT MAPPING CHECK (criteria as written) ===")
c1w = RES[("C1", "window_complete")]; c1a = RES[("C1", "all_origins")]; bw = RES[("B", "window_complete")]
cond1 = c1w["mean"] > 0 and c1w["nw2_p"] <= 0.05 and c1w["b4"][0] > 0
cond2 = c1a["mean"] > 0
cond3 = bw["mean"] > 0 and bw["b4"][0] > 0
print(f"  (1) Model1 wc: mean>0={c1w['mean']>0} NWp<=.05={c1w['nw2_p']<=0.05} b4 lower>0={c1w['b4'][0]>0} -> {cond1}")
print(f"  (2) Model1 all mean>0 -> {cond2}")
print(f"  (3) R0-B wc: mean>0={bw['mean']>0} b4 lower>0={bw['b4'][0]>0} -> {cond3}")
print(f"  R0_INCREMENTAL_POSITIVE = {cond1 and cond2 and cond3}")
for sname in SETS:
    a = RES[("A", sname)]
    signs = {blk: (a[f"b{blk}"][0] > 0, a[f"b{blk}"][1] < 0) for blk in (4, 8, 12)}
    concl = {blk: ("pos" if s[0] else "neg" if s[1] else "zero") for blk, s in signs.items()}
    print(f"  R0-A block-sensitivity [{sname}]: {concl} -> unstable={'YES' if len(set(concl.values()))>1 else 'no'}")


import json as _j
_j.dump(SERIES, open("/tmp/rt_r0_series.json","w"))
print("\nseries dumped:", {k: len(v) for k,v in SERIES.items()})
