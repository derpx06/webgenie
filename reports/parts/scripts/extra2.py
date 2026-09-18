import json,glob,re,collections,sys
import numpy as np
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1]
ELEM=re.compile(r'^\t*\*?\[(\d+)\]')
off_used=0; on_used=0
ar_after=collections.defaultdict(list)
plan_block=[]; req_block=[]; find_block=[]; steps_block=[]
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    lines=[json.loads(l) for l in open(f) if l.strip()]
    prev_actions=None
    for r in lines:
        if r.get('kind')!='session': continue
        d=r['data']; s=d['state']
        a=s.find('[Start of page]'); b=s.find('[End of page]')
        elem=s[a:b+13] if a>=0 and b>a else ''
        idx={}
        for l in elem.split('\n'):
            m=ELEM.match(l)
            if m: idx[int(m.group(1))]=l
        ar=s.find('Results of your last actions:')
        arlen=(len(s)-ar) if ar>=0 else 0
        if prev_actions:
            for n in prev_actions: ar_after[n].append(arlen)
        if r['component']=='navigator':
            for c in d.get('calls') or []:
                i=(c.get('args') or {}).get('index')
                if isinstance(i,int) and i in idx:
                    if 'offscreen="true"' in idx[i]: off_used+=1
                    else: on_used+=1
            prev_actions=[c['name'] for c in d.get('calls') or []]
print(run)
print(f'acted-on element lines: on-screen {on_used}, offscreen-marked {off_used} ({100*off_used/max(on_used+off_used,1):.1f}%)')
for n,v in sorted(ar_after.items(), key=lambda x:-len(x[1]))[:10]:
    print(f'  action-result block after {n:28s} n={len(v):4d} median {np.median(v):8.0f} chars  mean {np.mean(v):8.0f}')
