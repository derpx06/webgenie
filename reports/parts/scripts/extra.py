import json,glob,collections,statistics as st,sys,re
import numpy as np
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1]
SYS={'planner':11548,'navigator':11034}
COEF={'planner':(0.3663,0.2509,3199),'navigator':(0.3662,0.3103,4910)}
imgres=[]; noimg=[]
fail=collections.Counter(); failmsgs=collections.Counter()
sup=0; supchars=0
reason=collections.Counter(); outp=collections.Counter()
overlap_prev=[]; elem_lines=[]
tot_elem_tok=0; tot_in=0
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    lines=[json.loads(l) for l in open(f) if l.strip()]
    sess={}
    for r in lines:
        if r.get('kind')=='session': sess[(r['ts'],r['component'])]=r['data']
    prev=None
    for r in lines:
        if r.get('kind')!='llm': continue
        c=r.get('component'); d=r.get('data',{})
        if 'failed' in r['msg']:
            fail[c]+=1; failmsgs[str(d.get('error'))[:80]]+=1; continue
        if 'superseded' in r['msg']:
            sup+=1; supchars+=d.get('promptChars',0); continue
        u=d.get('usage',{}) or {}
        tot_in+=u.get('inputTokens',0)
        reason[c]+=u.get('reasoningTokens',0); outp[c]+=u.get('outputTokens',0)
        s=sess.get((r['ts'],c))
        if not s or c not in COEF: continue
        st_=s['state']; a=st_.find('[Start of page]'); b=st_.find('[End of page]')
        elem=st_[a:b+13] if a>=0 and b>a else ''
        ce,co,cf=COEF[c]
        pred=ce*len(elem)+co*(len(st_)-len(elem))+cf
        (imgres if s.get('images') else noimg).append(u.get('inputTokens',0)-pred)
        tot_elem_tok+=ce*len(elem)
        if elem:
            ls=[l for l in elem.split('\n') if re.match(r'^\t*\*?\[\d+\]',l)]
            elem_lines.append(len(ls))
            if prev is not None:
                pset=collections.Counter(prev); cur=collections.Counter(ls)
                shared=sum(min(v,pset[k]) for k,v in cur.items())
                overlap_prev.append(shared/max(len(ls),1))
            prev=ls
print(run)
print('failed llm calls', dict(fail), 'top errors', failmsgs.most_common(5))
print('superseded (hedge losers)', sup, 'their promptChars', supchars, '-> approx tokens', round(supchars/3.0))
print('reasoning tokens', dict(reason), 'output tokens', dict(outp))
print('calls with image:', len(imgres), 'median residual (image token cost est):', round(np.median(imgres)) if imgres else None)
print('calls without image:', len(noimg), 'median residual:', round(np.median(noimg)))
print('element lines/call median', np.median(elem_lines), 'mean', round(np.mean(elem_lines),1))
print('line overlap with previous same-task element block: median %.3f mean %.3f n=%d'%(np.median(overlap_prev),np.mean(overlap_prev),len(overlap_prev)))
print('total element tokens (est) %,.0f of total input %,.0f = %.1f%%'.replace('%,','{:,}').format(0,0) if False else f'total element tokens (est) {tot_elem_tok:,.0f}; total input tokens (successful calls) {tot_in:,}')
