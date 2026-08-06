import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..","..","..");
const rj=(r)=>JSON.parse(fs.readFileSync(path.join(ROOT,r),"utf8"));
const ms=(d)=>Date.parse(d+"T00:00:00Z"), DAY=864e5, H=3, FADE=3, TERM=10;
const r6=(x)=>Number.isFinite(x)?Math.round(x*1e6)/1e6:null;
const rank=(v)=>{const s=v.map((x,i)=>[x,i]).sort((a,b)=>a[0]-b[0]);const r=[];let i=0;
  while(i<s.length){let j=i;while(j+1<s.length&&s[j+1][0]===s[i][0])j++;const a=(i+j)/2+1;for(let k=i;k<=j;k++)r[s[k][1]]=a;i=j+1;}return r;};
const sp=(x,y)=>{if(x.length<4)return null;const rx=rank(x),ry=rank(y),n=x.length,mx=rx.reduce((a,b)=>a+b)/n,my=ry.reduce((a,b)=>a+b)/n;
  let nu=0,dx=0,dy=0;for(let i=0;i<n;i++){const a=rx[i]-mx,b=ry[i]-my;nu+=a*b;dx+=a*a;dy+=b*b;}return dx&&dy?nu/Math.sqrt(dx*dy):null;};
function boot(v,seed=539363334,reps=2000,blk=4){ if(v.length<4)return null; let s=seed>>>0;
  const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const d=[]; for(let r=0;r<reps;r++){const b=[];while(b.length<v.length){const st=Math.floor(rnd()*v.length);
    for(let k=0;k<blk&&b.length<v.length;k++)b.push(v[(st+k)%v.length]);}
    d.push(b.reduce((a,x)=>a+x,0)/b.length);}
  d.sort((a,b)=>a-b);
  return {mean:r6(d.reduce((a,b)=>a+b,0)/d.length),ci_lower:r6(d[Math.floor(d.length*.025)]),ci_upper:r6(d[Math.floor(d.length*.975)]),reps:d.length,block:blk,seed};}
// same residual-income function as X3
function riValue(book0,pathArr,ke){ if(!(book0>0)||!(ke>0)||!pathArr.length)return null;
  let v=book0,pb=book0,last=null;
  for(let k=0;k<pathArr.length;k++){const{earnings,book}=pathArr[k];
    if(!Number.isFinite(earnings)||!Number.isFinite(book))return null;
    const ri=earnings-ke*pb; v+=ri/(1+ke)**(k+1); pb=book; last=ri;}
  if(last!==null){const n=pathArr.length;
    for(let k=1;k<=TERM;k++)v+=last*((TERM-k)/TERM)/(1+ke)**(n+k);}
  return v;}
function deployPath(m){ const{book,roe,roe_band:bd}=m;
  if(!(book>0)||!Number.isFinite(roe))return null;
  const tgt=Number.isFinite(bd?.low)&&Number.isFinite(bd?.high)?(bd.low+bd.high)/2:roe;
  const p=[]; let pb=book;
  for(let y=1;y<=H;y++){const w=Math.min(1,y/FADE);const r=roe+(tgt-roe)*w;const e=r*pb;const nb=pb+e;p.push({earnings:e,book:nb});pb=nb;}
  return p;}
const panel=rj("data/computed/feno-rim-v2/e2-basket-panel.json");
const audit=rj("data/computed/feno-rim-v2/E1_E2_FORENSIC_AUDIT.json");
const rates=rj("data/macro/fred-banking-daily.json").series.DGS10;
const erp=rj("data/computed/feno-rim-v2/erp-archive-restoration.json").observations
  .map(o=>({t:ms(o.first_knowable),us:o.us_erp})).sort((a,b)=>a.t-b.t);
const complete=new Set(audit.p0_adjudications.p0_3_baseline_truncation.evidence.e2_baseline_windows
  .window_rows_per_origin.filter(w=>w.years>=9.5).map(w=>w.as_of));
const px={},dv={};
for(const f of fs.readdirSync(path.join(ROOT,"data/yf/finance"))){
  if(!f.endsWith(".unadjusted.json"))continue; const s=f.replace(".unadjusted.json","");
  const d=rj("data/yf/finance/"+f).data;
  px[s]=(d.history_unadjusted||[]).map(r=>({t:ms(r.date),c:r.Close})).sort((a,b)=>a.t-b.t);
  dv[s]=Object.entries(d.dividends||{}).map(([k,v])=>({t:ms(k),a:v})).sort((a,b)=>a.t-b.t);}
const at=(a,t)=>{let f=null;for(const r of a){if(r.t<=t)f=r;else break;}return f;};
const rows=[];
for(const o of panel.origin_rows){
  const t0=ms(o.as_of), t1=t0+36*30.44*DAY;
  let rate=null; for(const r of rates){if(r.date<=o.as_of)rate=r;else break;}
  const pe=erp.filter(x=>x.t<=t0).at(-1);
  if(!rate||!pe)continue;
  const ke=rate.value*0.01+pe.us;
  const vp=[],bp=[],ret=[];
  for(const m of o.members){
    if(!m.ok||!(m.book>0)||!(m.price>0)||!(m.shares>0)||!Number.isFinite(m.roe))continue;
    const p=px[m.symbol]; if(!p?.length)continue;
    const a=at(p,t0), b=at(p,t1);
    if(!a||!b||t0-a.t>45*DAY||t1-b.t>45*DAY)continue;
    const dp=deployPath(m); const V=dp?riValue(m.book,dp,ke):null;
    if(!Number.isFinite(V)||V<=0)continue;
    const mcap=m.price*m.shares;
    const div=(dv[m.symbol]||[]).filter(x=>x.t>t0&&x.t<=t1).reduce((s,x)=>s+x.a,0);
    const tr=Math.pow((b.c+div)/a.c,1/3)-1;
    vp.push(V/mcap); bp.push(m.book/mcap); ret.push(tr);}
  if(vp.length<20)continue;
  const icV=sp(vp,ret), icB=sp(bp,ret);
  if(icV===null||icB===null)continue;
  rows.push({as_of:o.as_of,n:vp.length,ic_vp:r6(icV),ic_bp:r6(icB),complete:complete.has(o.as_of)});}
const rep=(set,label)=>{ const v=set.map(r=>r.ic_vp), b=set.map(r=>r.ic_bp);
  const mv=v.reduce((a,x)=>a+x,0)/v.length, mb=b.reduce((a,x)=>a+x,0)/b.length;
  const ci=boot(v);
  console.log(label.padEnd(18),"origins="+String(set.length).padStart(3),
    "| mean IC(V/P)",mv.toFixed(4).padStart(8),"CI ["+ci.ci_lower+", "+ci.ci_upper+"]",
    "| mean IC(B/P)",mb.toFixed(4).padStart(8),
    "| incremental",(mv-mb).toFixed(4).padStart(8),
    "| positive",set.filter(r=>r.ic_vp>0).length+"/"+set.length);
  return {n:set.length,mean_ic_vp:r6(mv),ic_ci:ci,mean_ic_bp:r6(mb),incremental:r6(mv-mb),positive:set.filter(r=>r.ic_vp>0).length};};
console.log("X2 CONFIRMATORY — per-origin cross-sectional IC, X3's deployable RIM value\n");
const A=rep(rows,"all origins"), C=rep(rows.filter(r=>r.complete),"window-complete");
const pass=A.mean_ic_vp>0&&C.mean_ic_vp>0&&A.ic_ci.ci_lower>0&&C.ic_ci.ci_lower>0&&A.incremental>0&&C.incremental>0;
console.log("\nverdict:",pass?"X2_CROSS_SECTIONAL_SIGNAL_PRESENT":"X2_FAILS_FROZEN_BAR");
const body={schema_version:"feno_rim_v2_x2_cross_sectional.v1",phase:"X2",research_only:true,promotion:null,
  criteria_sha256:"fff144076c6a616cb371f4d832bee9d00fe421b6dadb84fb7ed1a2f5728c8272",
  per_origin_rows:rows,origin_sets:{all_origins:A,window_complete:C},
  verdict:{pass,label:pass?"X2_CROSS_SECTIONAL_SIGNAL_PRESENT":"X2_FAILS_FROZEN_BAR"},
  generated_at:new Date().toISOString()};
fs.writeFileSync(path.join(ROOT,"data/computed/feno-rim-v2/RIM_CROSS_SECTIONAL_BOTTOM_UP.json"),JSON.stringify(body,null,2)+"\n");
