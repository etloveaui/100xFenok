# cc independent re-derivation under km's v3.1 frozen rule. Own code, no handler imports.
import json, math, os
from datetime import date
def ordn(s): return date.fromisoformat(s[:10]).toordinal()
def rank_avg(v):
    idx=sorted(range(len(v)),key=lambda i:v[i]); r=[0.0]*len(v); i=0
    while i<len(idx):
        j=i
        while j+1<len(idx) and v[idx[j+1]]==v[idx[i]]: j+=1
        a=(i+j)/2.0+1
        for k in range(i,j+1): r[idx[k]]=a
        i=j+1
    return r
def pear(x,y):
    n=len(x);mx=sum(x)/n;my=sum(y)/n
    nu=sum((x[i]-mx)*(y[i]-my) for i in range(n));dx=sum((a-mx)**2 for a in x);dy=sum((b-my)**2 for b in y)
    return nu/math.sqrt(dx*dy) if dx and dy else None
def spm(x,y): return pear(rank_avg(x),rank_avg(y))
def mean(v): return sum(v)/len(v)
def sd(v):
    m=mean(v); return math.sqrt(sum((x-m)**2 for x in v)/(len(v)-1))
def ols(X,y):
    n=len(y);k=len(X[0])+1;A=[[0.0]*k for _ in range(k)];b=[0.0]*k
    for i in range(n):
        row=[1.0]+list(X[i])
        for r in range(k):
            b[r]+=row[r]*y[i]
            for c in range(k): A[r][c]+=row[r]*row[c]
    M=[A[r][:]+[b[r]] for r in range(k)]
    for c in range(k):
        p=max(range(c,k),key=lambda r:abs(M[r][c]))
        if abs(M[p][c])<1e-12: return None
        M[c],M[p]=M[p],M[c];pv=M[c][c]
        for j in range(c,k+1): M[c][j]/=pv
        for r in range(k):
            if r==c: continue
            f=M[r][c]
            if f:
                for j in range(c,k+1): M[r][j]-=f*M[c][j]
    return [M[r][k] for r in range(k)]
def nw_se(v,lag):
    n=len(v);m=mean(v);e=[x-m for x in v]
    s=sum(x*x for x in e)/n
    for L in range(1,lag+1):
        w=1-L/(lag+1); s+=2*w*sum(e[i]*e[i+L] for i in range(n-L))/n
    return math.sqrt(max(s,0)/n)
def p2(t): return 2*(1-0.5*(1+math.erf(abs(t)/math.sqrt(2))))
def ess_n(v,lags):
    n=len(v);m=mean(v);den=sum((x-m)**2 for x in v)
    if not den: return float(n)
    s=sum(sum((v[i]-m)*(v[i+k]-m) for i in range(n-k))/den for k in range(1,lags+1))
    return min(n/(1+2*max(s,0.0)), n)   # clamp low at 0 rho-sum -> ESS <= T
def lcg(seed):
    s=seed&0xFFFFFFFF
    def nxt():
        nonlocal s
        s=(s*1664525+1013904223)&0xFFFFFFFF
        return s/4294967296
    return nxt
def block_ci(v,blk,reps=10000,seed=20260807):
    n=len(v);rnd=lcg(seed);out=[]
    for _ in range(reps):
        b=[]
        while len(b)<n:
            st=int(rnd()*n); st=min(st,n-1)
            for k in range(blk):
                if len(b)>=n: break
                b.append(v[(st+k)%n])
        out.append(sum(b)/n)
    out.sort(); return out[int(reps*.025)], out[int(reps*.975)]

ROOT='.'
panel=json.load(open('data/computed/feno-rim-v2/e2-basket-panel.json'))
audit=json.load(open('data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json'))
rates=json.load(open('data/macro/fred-banking-daily.json'))['series']['DGS10']
erp=sorted(({'t':ordn(o['first_knowable']),'us':o['us_erp']} for o in json.load(open('data/computed/feno-rim-v2/erp-archive-restoration.json'))['observations']),key=lambda z:z['t'])
comp={w['as_of'] for w in audit['p0_adjudications']['p0_3_baseline_truncation']['evidence']['e2_baseline_windows']['window_rows_per_origin'] if w['years']>=9.5}
px,dv,splits={},{},{}
for f in os.listdir('data/yf/finance'):
    if f.endswith('.unadjusted.json'):
        s=f[:-len('.unadjusted.json')];d=json.load(open('data/yf/finance/'+f))['data']
        px[s]=sorted(((ordn(r['date']),r['Close']) for r in (d.get('history_unadjusted') or [])))
        dv[s]=sorted(((ordn(k),v) for k,v in (d.get('dividends') or {}).items()))
for f in os.listdir('data/yf/finance'):
    if f.endswith('.json') and not f.endswith('.unadjusted.json'):
        s=f[:-5]
        try: splits[s]={ordn(k):v for k,v in (json.load(open('data/yf/finance/'+f))['data'].get('splits') or {}).items()}
        except Exception: pass
# EDGAR share facts
facts={}
for f in os.listdir('data/edgar/rim-dow'):
    s=f[:-5]; c=json.load(open('data/edgar/rim-dow/'+f))['concepts']
    rows=[]
    for key in ('EntityCommonStockSharesOutstanding','SharesFallback'):
        for r in c.get(key,[]) or []:
            if r.get('end') and r.get('filed') and r.get('val') is not None:
                rows.append((ordn(r['end']), ordn(r['filed']), r['val']))
    facts[s]=rows
def basis_date(sym, shares, t0):
    cand=[e for (e,fl,v) in facts.get(sym,[]) if v==shares and e<=t0 and fl<=t0]
    return max(cand) if cand else None
def at_i(a,t):
    lo,hi,fn=0,len(a)-1,-1
    while lo<=hi:
        m=(lo+hi)//2
        if a[m][0]<=t: fn=m;lo=m+1
        else: hi=m-1
    return fn
H,FADE,TERM=3,3,10
def dpath(m):
    bk,roe,bd=m['book'],m['roe'],m.get('roe_band')
    tgt=(bd['low']+bd['high'])/2 if bd else roe
    p=[];pb=bk
    for y in range(1,H+1):
        w=min(1.0,y/FADE);r=roe+(tgt-roe)*w;e=r*pb;nb=pb+e;p.append((e,nb));pb=nb
    return p
def riv(b0,path,ke):
    v=b0;pb=b0;last=None
    for k,(e,bk) in enumerate(path):
        ri=e-ke*pb; v+=ri/(1+ke)**(k+1); pb=bk; last=ri
    for k in range(1,TERM+1): v+=last*((TERM-k)/TERM)/(1+ke)**(len(path)+k)
    return v

rows=[]; ncorr=0; ntot=0; nomatch=[]
for o in panel['origin_rows']:
    t0=ordn(o['as_of']); t1=t0+36*30.44
    rate=None
    for r in rates:
        if r['date']<=o['as_of']: rate=r
        else: break
    pe=[x for x in erp if x['t']<=t0]
    if not rate or not pe: continue
    ke=rate['value']*0.01+pe[-1]['us']; rf0=rate['value']*0.01
    ms=[]
    for m in o['members']:
        if not m.get('ok') or not(m.get('book',0)>0 and m.get('price',0)>0 and m.get('shares',0)>0): continue
        if m.get('roe') is None or not math.isfinite(m['roe']): continue
        p=px.get(m['symbol']); a=at_i(p,t0) if p else -1; b=at_i(p,t1) if p else -1
        if a<0 or b<0 or t0-p[a][0]>45 or t1-p[b][0]>45: continue
        V=riv(m['book'],dpath(m),ke)
        if not V or V<=0: continue
        bd_=basis_date(m['symbol'], m['shares'], t0)
        if bd_ is None: nomatch.append((o['as_of'],m['symbol'])); bd_=t0
        F=1.0
        for sdte,ratio in splits.get(m['symbol'],{}).items():
            if sdte>bd_: F*=ratio
        ntot+=1
        if F>1.0000001: ncorr+=1
        mc=m['price']*m['shares']*F
        div=sum(x[1] for x in dv.get(m['symbol'],[]) if t0<x[0]<=t1)
        tr=((p[b][1]+div)/p[a][1])**(1/3)-1
        ms.append({'sym':m['symbol'],'vp':V/mc,'bp':m['book']/mc,'tr':tr,'exc':tr-rf0})
    if len(ms)<20: continue
    rows.append({'as_of':o['as_of'],'complete':o['as_of'] in comp,'ms':ms})

print(f"corrected cells: {ncorr}/{ntot}   share-fact match failures: {len(nomatch)}")
if nomatch[:5]: print("  no-match sample:", nomatch[:5])
SETS={'all_origins':rows,'window_complete':[r for r in rows if r['complete']]}
def report(name,v):
    T=len(v);m=mean(v);e=ess_n(v,11);hw=1.96*sd(v)/math.sqrt(e)
    se=nw_se(v,11); t=m/se if se else float('nan')
    b4=block_ci(v,4)
    print(f"  {name:26s} T={T:2d} mean={m:+.4f}  ESS={e:5.2f} ESS-CI=[{m-hw:+.4f},{m+hw:+.4f}]  NW11 t={t:+.2f} p={p2(t):.5f}  b4=[{b4[0]:+.4f},{b4[1]:+.4f}]")
    return m
for sname,oset in SETS.items():
    print(f"=== {sname} ===")
    icv=[spm([x['vp'] for x in o['ms']],[x['tr'] for x in o['ms']]) for o in oset]
    icb=[spm([x['bp'] for x in o['ms']],[x['tr'] for x in o['ms']]) for o in oset]
    print(f"  mean IC(V/P)={mean(icv):+.4f}   mean IC(B/P)={mean(icb):+.4f}   incremental={mean(icv)-mean(icb):+.4f}")
    report('R0-A mean D',[a-b for a,b in zip(icv,icb)])
    par,reg=[],[]
    for o in oset:
        ms=o['ms'];n=len(ms)
        rv=rank_avg([x['vp'] for x in ms]);rb=rank_avg([x['bp'] for x in ms]);rr=rank_avg([x['tr'] for x in ms])
        c=ols([[b] for b in rb],rv); resid=[rv[i]-(c[0]+c[1]*rb[i]) for i in range(n)]
        c2=ols([[b] for b in rb],rr); residr=[rr[i]-(c2[0]+c2[1]*rb[i]) for i in range(n)]
        par.append(spm(resid,residr)); reg.append(spm(resid,[x['tr'] for x in ms]))
    report('R0-B partial',par); report('R0-B regressor-only',reg)
    b2=[]
    for o in oset:
        ms=o['ms'];n=len(ms)
        ub=[(x-1)/(n-1) for x in rank_avg([x['bp'] for x in ms])]
        uv=[(x-1)/(n-1) for x in rank_avg([x['vp'] for x in ms])]
        b2.append(ols([[ub[i],uv[i]] for i in range(n)],[x['exc'] for x in ms])[2])
    report('R0-C M1 b2',b2)
    Ss=[]
    for o in oset:
        ms=o['ms'];n=len(ms)
        rb=rank_avg([x['bp'] for x in ms]);rv=rank_avg([x['vp'] for x in ms])
        g={}
        for i in range(n): g.setdefault(min(int(3*(rb[i]-1)/n),2),[]).append(i)
        parts=[]
        for _,idxs in g.items():
            if len(idxs)<2: continue
            srt=sorted(idxs,key=lambda i:rv[i]); k=len(srt); nlow=k-k//2
            lo_,hi_=srt[:nlow],srt[nlow:]
            if lo_ and hi_: parts.append(mean([ms[i]['exc'] for i in hi_])-mean([ms[i]['exc'] for i in lo_]))
        Ss.append(mean(parts))
    report('R0-D mean S',Ss)
    ph=[mean(b2[i::12]) for i in range(12) if len(b2[i::12])>=2]
    print(f"  b2 non-overlapping phases positive: {sum(1 for x in ph if x>0)}/{len(ph)}")
