import json, glob, os, statistics as st, collections, sys
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
RUNS=['mind2web-r1-a920989','mind2web-r2-base-a920989','mind2web-r2-cand-6347e1c','mind2web-r3-3fdf2fa']
def pct(v,p):
    if not v: return float('nan')
    v=sorted(v); k=(len(v)-1)*p/100; f=int(k); c=min(f+1,len(v)-1)
    return v[f]+(v[c]-v[f])*(k-f)
out={}
for run in RUNS:
    rows=[]
    for f in sorted(glob.glob(R+run+'/*/result.json')):
        rows.append(json.load(open(f)))
    oc=collections.Counter(r.get('outcome') for r in rows)
    m=lambda r,*k: (lambda d: d)(r.get('metrics') or {})
    steps=[r.get('steps',0) for r in rows]
    secs=[r.get('seconds',0) for r in rows]
    tin=sum((r.get('metrics') or {}).get('tokens',{}).get('input',0) for r in rows)
    tout=sum((r.get('metrics') or {}).get('tokens',{}).get('output',0) for r in rows)
    tcac=sum((r.get('metrics') or {}).get('tokens',{}).get('cached',0) for r in rows)
    trea=sum((r.get('metrics') or {}).get('tokens',{}).get('reasoning',0) for r in rows)
    cost=sum((r.get('metrics') or {}).get('costUsd',0) or 0 for r in rows)
    calls=sum((r.get('metrics') or {}).get('llmCalls',0) for r in rows)
    # non site_down subset for per-task stats
    live=[r for r in rows if r.get('outcome') not in ('site_down',)]
    ls=[r.get('steps',0) for r in live]; lsec=[r.get('seconds',0) for r in live]
    # action medians
    act=collections.defaultdict(list); gs=[]
    for r in rows:
        mm=r.get('metrics') or {}
        for k,v in (mm.get('actionMs') or {}).items(): act[k]+=v
        gs+=mm.get('getStateMs') or []
    out[run]=dict(n=len(rows), outcomes=dict(oc), steps_total=sum(steps),
        wall_s=sum(secs), tin=tin, tout=tout, tcached=tcac, treason=trea, cost=cost, llmcalls=calls,
        steps_p50=pct(ls,50), steps_p95=pct(ls,95), sec_p50=pct(lsec,50), sec_p95=pct(lsec,95),
        n_live=len(live),
        getState_med=pct(gs,50), getState_n=len(gs),
        actions={k:(round(pct(v,50),1),len(v)) for k,v in sorted(act.items(), key=lambda x:-len(x[1]))})
print(json.dumps(out, indent=1, default=str))
