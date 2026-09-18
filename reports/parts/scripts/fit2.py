import json,glob,numpy as np,sys,collections
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1]; SYSC=float(sys.argv[2]) if len(sys.argv)>2 else 0
rows=collections.defaultdict(list); unmatched=collections.Counter(); totin=0
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    lines=[json.loads(l) for l in open(f) if l.strip()]
    sess=collections.defaultdict(list); llm=collections.defaultdict(list)
    for r in lines:
        if r.get('kind')=='session': sess[r['component']].append(r)
        elif r.get('kind')=='llm':
            if 'failed' in r['msg'] or 'superseded' in r['msg'] or not r['data'].get('usage'): continue
            totin+=(r['data'].get('usage') or {}).get('inputTokens',0)
            llm[r['component']].append(r)
    for c in llm:
        S=sess.get(c,[]); si=0
        for r in llm[c]:
            # advance to the session record at or before this llm record's ts
            while si+1<len(S) and S[si+1]['ts']<=r['ts']: si+=1
            if si>=len(S) or abs(S[si]['ts']-r['ts'])>120000: unmatched[c]+=1; continue
            s=S[si]['data']['state']
            a=s.find('[Start of page]'); b=s.find('[End of page]')
            e=len(s[a:b+13]) if a>=0 and b>a else 0
            rows[c].append((e,len(s)-e,max(r['data']['promptChars']-len(s),0),(r['data'].get('usage') or {}).get('inputTokens',0),(r['data'].get('usage') or {}).get('cacheReadTokens',0),1 if S[si]['data'].get('images') else 0))
            si=min(si+1,len(S)-1)
att=collections.Counter(); n=0; tot=0
print(run,'unmatched',dict(unmatched),'run total input (successful calls)',f'{totin:,}')
for c,v in rows.items():
    A=np.array([[e,o,t,1.0] for e,o,t,_,_,_ in v]); y=np.array([x[3] for x in v])
    coef,*_=np.linalg.lstsq(A,y,rcond=None); pred=A@coef
    print(f'{c}: n={len(v)} R2={1-((y-pred)**2).sum()/((y-y.mean())**2).sum():.4f} coef elem {coef[0]:.4f} other {coef[1]:.4f} trans {coef[2]:.4f} const {coef[3]:.0f}')
    s=A.sum(0)
    for i,k in enumerate(['elements','otherState','sysAndTools']):
        pass
    att['elements']+=coef[0]*s[0]; att['otherState']+=coef[1]*s[1]; att['transcript']+=coef[2]*s[2]; att['sys+tools']+=coef[3]*len(v)
    tot+=y.sum(); n+=len(v)
    print(f'   medians: elem {np.median(A[:,0]):.0f}c other {np.median(A[:,1]):.0f}c trans {np.median(A[:,2]):.0f}c input {np.median(y):.0f}t cacheRead {sum(x[4] for x in v):,}')
print(f'ATTRIBUTED over {n} calls, {tot:,.0f} input tokens ({100*tot/totin:.1f}% of run):')
for k,val in att.most_common(): print(f'   {k:12s} {val:12,.0f}  {100*val/tot:5.1f}%   per task {val/60:,.0f}')
