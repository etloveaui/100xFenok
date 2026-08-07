# cc independent re-derivation of G0 steps B/C + C1 + C6.
# Own re-implementation of the committed r2-gls-icc.mjs selection rules. No worker code imported,
# no worker artifact read as input. Reads only committed repo data + the committed R2 artifact.
import json, os, math
from datetime import date

ROOT = "/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/source/100xFenok"
def rj(p): return json.load(open(os.path.join(ROOT, p)))
DAY = 86400.0
def ms(d): return date.fromisoformat(d[:10]).toordinal() * DAY   # ordinal-days as the time unit

# ---------- prices ----------
_pc = {}
def prices(sym):
    if sym not in _pc:
        p = os.path.join(ROOT, "data/edgar/r1-panel/prices/%s.json" % sym)
        _pc[sym] = json.load(open(p)) if os.path.exists(p) else None
    return _pc[sym]

def origin_close(sym, Y):
    pc = prices(sym)
    if not pc: return None, None
    target = "%d-06-30" % Y
    ds = sorted(d for d in pc["closes"] if d <= target)
    if not ds: return None, None
    d = ds[-1]
    if ms(target) - ms(d) > 16 * DAY: return None, None
    return pc["closes"][d], d

def split_factor_after(sym, after_ms):
    """product of split ratios strictly after after_ms"""
    pc = prices(sym)
    if not pc: return 1.0
    F = 1.0
    for sd, f in pc["splits"].items():
        if ms(sd) > after_ms: F *= f
    return F

# ---------- EDGAR facts ----------
E_PRIMARY = "IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity"
E_FALLBACK = "NetIncomeLoss"

def annual_duration(concepts, name):
    rows = concepts.get(name) or []
    by_end = {}
    for r in rows:
        if r.get("form") not in ("10-K", "10-K/A"): continue
        if not r.get("end") or not r.get("start"): continue
        v = r.get("val")
        if v is None or not isinstance(v, (int, float)): continue
        days = (ms(r["end"]) - ms(r["start"])) / DAY
        if days < 300 or days > 400: continue
        cur = by_end.get(r["end"])
        if not cur or r["filed"] < cur["filed"]: by_end[r["end"]] = r
    return sorted(({"endMs": ms(r["end"]), "val": r["val"], "filed": ms(r["filed"])} for r in by_end.values()),
                  key=lambda x: x["endMs"])

def shares_facts(concepts):
    rows = concepts.get("EntityCommonStockSharesOutstanding") or []
    by_date = {}
    for r in rows:
        d = r.get("start") or r.get("end")
        v = r.get("val")
        if not d or v is None or not isinstance(v, (int, float)) or v <= 0: continue
        cur = by_date.get(d)
        if not cur or r["filed"] < cur["filed"]: by_date[d] = r
    out = []
    for r in by_date.values():
        d = r.get("start") or r["end"]
        out.append({"date": d, "ms": ms(d), "val": r["val"], "filed": ms(r["filed"])})
    return sorted(out, key=lambda x: x["ms"])

def build_firm(sym):
    p = os.path.join(ROOT, "data/edgar/r1-panel/%s.json" % sym)
    if not os.path.exists(p): return None
    concepts = json.load(open(p))["concepts"]
    eP = annual_duration(concepts, E_PRIMARY)
    eF = annual_duration(concepts, E_FALLBACK)
    if not eP and not eF: return None
    years = {}
    for r in eP:
        years.setdefault(r["endMs"], {"endMs": r["endMs"], "E": r})
    for r in eF:
        if r["endMs"] not in years: years[r["endMs"]] = {"endMs": r["endMs"], "E": r}
    sh = shares_facts(concepts)
    tagged = [dict(s, basis=s["val"] * split_factor_after(sym, s["ms"])) for s in sh]
    bs = sorted(t["basis"] for t in tagged)
    med = bs[len(bs) // 2] if bs else None
    return {"years": sorted(years.values(), key=lambda y: y["endMs"]), "shares": tagged,
            "lo": med / 10 if med is not None else None, "hi": med * 10 if med is not None else None}

def shares_at(f, end_ms, as_of):
    best = None
    for s in f["shares"]:
        if s["filed"] > as_of: continue
        if s["ms"] < end_ms - 183 * DAY or s["ms"] > end_ms + 90 * DAY: continue
        if f["lo"] is not None and (s["basis"] < f["lo"] or s["basis"] > f["hi"]): continue
        d = abs(s["ms"] - end_ms)
        if best is None or d < best[0] or (d == best[0] and s["ms"] > best[1]["ms"]): best = (d, s)
    return best[1] if best else None

def base_year(f, Y):
    origin_ms = ms("%d-06-30" % Y); guard_end = ms("%d-03-31" % Y)
    for y in reversed(f["years"]):
        if y["endMs"] > origin_ms: continue
        if y["E"]["filed"] > origin_ms: continue
        m = date.fromordinal(int(y["endMs"] / DAY)).month
        if 4 <= m <= 6 and y["endMs"] > guard_end: continue
        return y
    return None

# ---------- rebuild every committed cell ----------
r2 = rj("data/computed/feno-rim-recovery/R2_GLS_ICC.json")
rows = r2["rows"]
firms = {}
cells = []
recon_fail = []
for row in rows:
    sym, Y = row["sym"], row["origin"]
    if sym not in firms: firms[sym] = build_firm(sym)
    f = firms[sym]
    if not f: recon_fail.append((sym, Y, "no firm")); continue
    b = base_year(f, Y)
    if not b: recon_fail.append((sym, Y, "no base year")); continue
    origin_ms = ms("%d-06-30" % Y)
    sh = shares_at(f, b["endMs"], origin_ms)
    if not sh: recon_fail.append((sym, Y, "no shares")); continue
    price, d = origin_close(sym, Y)
    if price is None: recon_fail.append((sym, Y, "no price")); continue
    F_sh = split_factor_after(sym, sh["ms"])          # incumbent: shares onto today basis
    F_d  = split_factor_after(sym, ms(d))             # direct: price onto as-traded basis
    mcap_corrected = price * sh["val"] * F_sh
    mcap_direct    = price * F_d * sh["val"]
    ratio = mcap_direct / mcap_corrected if mcap_corrected else None
    between = [(sd, r) for sd, r in prices(sym)["splits"].items()
               if min(sh["ms"], ms(d)) < ms(sd) <= max(sh["ms"], ms(d))]
    cells.append({"sym": sym, "origin": Y, "committed_mcap": row["mcap"], "mcap_corrected": mcap_corrected,
                  "mcap_direct": mcap_direct, "ratio": ratio, "icc": row.get("icc_ri"),
                  "price": price, "committed_price": row["price"], "shares_raw": sh["val"],
                  "sh_date": sh["date"], "close_date": d, "splits_between": between})

print("committed rows: %d | rebuilt: %d | failures: %d" % (len(rows), len(cells), len(recon_fail)))
if recon_fail[:5]: print("  failure sample:", recon_fail[:5])

# ---------- did I reproduce the committed incumbent numbers? ----------
worst_p = max(cells, key=lambda c: abs(c["price"] - c["committed_price"]) / c["committed_price"])
worst_m = max(cells, key=lambda c: abs(c["mcap_corrected"] - c["committed_mcap"]) / c["committed_mcap"])
print("max rel diff vs committed  price: %.3e (%s %d)" % (
    abs(worst_p["price"] - worst_p["committed_price"]) / worst_p["committed_price"], worst_p["sym"], worst_p["origin"]))
print("max rel diff vs committed  mcap : %.3e (%s %d)" % (
    abs(worst_m["mcap_corrected"] - worst_m["committed_mcap"]) / worst_m["committed_mcap"], worst_m["sym"], worst_m["origin"]))

# ---------- P5 / categories ----------
dev = [c for c in cells if abs(c["ratio"] - 1.0) > 1e-9]
explained = [c for c in dev if c["splits_between"]]
unexplained = [c for c in dev if not c["splits_between"]]
print("\ndeviating cells: %d / %d (%.2f%%)  explained by a split in between: %d  unexplained: %d"
      % (len(dev), len(cells), 100.0 * len(dev) / len(cells), len(explained), len(unexplained)))
exact = 0
for c in explained:
    # ratio must equal F_d / F_sh exactly; recompute independently
    Fd = split_factor_after(c["sym"], ms(c["close_date"])); Fs = split_factor_after(c["sym"], ms(c["sh_date"]))
    if abs(c["ratio"] - Fd / Fs) < 1e-12: exact += 1
print("explained cells whose ratio equals the split-factor quotient exactly: %d/%d" % (exact, len(explained)))
for c in sorted(dev, key=lambda x: (x["origin"], x["sym"]))[:30]:
    print("   %-6s %d  ratio=%.6f  shares_date=%s close=%s  splits_between=%s"
          % (c["sym"], c["origin"], c["ratio"], c["sh_date"], c["close_date"], c["splits_between"]))

# ---------- C1 rank correlation per origin ----------
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
print("\nC1 per-origin Spearman rank correlation of the two market caps:")
for Y in sorted({c["origin"] for c in cells}):
    g = [c for c in cells if c["origin"] == Y]
    rho = pear(rank_avg([c["mcap_corrected"] for c in g]), rank_avg([c["mcap_direct"] for c in g]))
    print("   %d  n=%4d  rho=%.10f" % (Y, len(g), rho))

# ---------- C6 cap-weighted aggregates under both bases ----------
print("\nC6 cap-weighted mean ICC, both bases (committed diag shown for cross-check):")
diag = r2["diag"]["per_origin"]
for Y in sorted({c["origin"] for c in cells}):
    g = [c for c in cells if c["origin"] == Y and c["icc"] is not None]
    def cw(key):
        s = sum(c[key] for c in g)
        return sum(c["icc"] * c[key] for c in g) / s if s else None
    a, b = cw("mcap_corrected"), cw("mcap_direct")
    committed = diag[str(Y)]["cap_weighted_mean_icc"]
    print("   %d  n=%4d  corrected=%.6f  direct=%.6f  absdiff=%.6f   committed=%.6f (my corrected - committed = %+.2e)"
          % (Y, len(g), a, b, abs(a - b), committed, a - committed))
