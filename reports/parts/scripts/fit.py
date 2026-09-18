import json,glob,numpy as np,sys,collections
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1]
SYS={'planner':11548,'navigator':11034}
rows=collections.defaultdict(list)
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    sess={}; 
    lines=[json.loads(l) for l in open(f) if l.strip()]
    for r in lines:
        if r.get('kind')=='session': sess[(r['ts'],r['component'])]=r['data']
    for r in lines:
        if r.get('kind')!='llm' or 'failed' in r['msg'] or 'superseded' in r['msg']: continue
        d=sess.get((r['ts'],r['component']))
        if not d: continue
        c=r['component']
        if c not in SYS: continue
        s=d['state']; pc=r['data']['promptChars']; it=r['data']['usage']['inputTokens']
        a=s.find('[Start of page]'); b=s.find('[End of page]')
        elem=len(s[a:b+13]) if a>=0 and b>a else 0
        other=len(s)-elem
        trans=pc-len(s)-SYS[c]
        rows[c].append((elem,other,max(trans,0),it,r['data']['usage'].get('cacheReadTokens',0)))
for c,v in rows.items():
    A=np.array([[e,o,t,1.0] for e,o,t,_,_ in v]); y=np.array([x[3] for x in v])
    coef,*_=np.linalg.lstsq(A,y,rcond=None)
    pred=A@coef
    print(f'{c}: n={len(v)} R2={1-((y-pred)**2).sum()/((y-y.mean())**2).sum():.4f}')
    print(f'   tok/char: elements {coef[0]:.4f} ({1/coef[0]:.2f} c/t), otherState {coef[1]:.4f} ({1/coef[1]:.2f}), transcript {coef[2]:.4f} ({1/coef[2]:.2f}), const {coef[3]:.0f} tok')
    e=np.array([x[0] for x in v]); o=np.array([x[1] for x in v]); t=np.array([x[2] for x in v])
    tot=y.sum()
    print(f'   TOTAL inputTokens {tot:,.0f}; attributed: elements {coef[0]*e.sum():,.0f} ({100*coef[0]*e.sum()/tot:.1f}%), otherState {coef[1]*o.sum():,.0f} ({100*coef[1]*o.sum()/tot:.1f}%), transcript {coef[2]*t.sum():,.0f} ({100*coef[2]*t.sum()/tot:.1f}%), fixed {coef[3]*len(v):,.0f} ({100*coef[3]*len(v)/tot:.1f}%)')
    print(f'   median chars: elem {np.median(e):.0f} other {np.median(o):.0f} transcript {np.median(t):.0f}; median inputTokens {np.median(y):.0f}; cacheRead total {sum(x[4] for x in v):,}')
