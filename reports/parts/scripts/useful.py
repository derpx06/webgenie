import json,glob,re,collections,sys
import numpy as np
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1]
ELEM=re.compile(r'^\t*\*?\[(\d+)\]')
per_call=[]; per_task=[]; repeats=0; total_actions=0; byname=collections.Counter(); byname_rep=collections.Counter()
offscreen_chars=0; elem_chars=0
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    lines=[json.loads(l) for l in open(f) if l.strip()]
    seen_sig=collections.Counter()
    task_lines=set(); task_used=set(); task_elem_chars=0; task_used_chars=0
    for r in lines:
        if r.get('kind')!='session' or r['component']!='navigator': continue
        d=r['data']; s=d['state']
        a=s.find('[Start of page]'); b=s.find('[End of page]')
        if a<0 or b<a: continue
        elem=s[a:b+13]
        idx={}
        for l in elem.split('\n'):
            m=ELEM.match(l)
            if m: idx[int(m.group(1))]=l
            if m and 'offscreen="true"' in l: offscreen_chars+=len(l)+1
        elem_chars+=len(elem); task_elem_chars+=len(elem)
        used=set()
        for c in d.get('calls') or []:
            total_actions+=1; byname[c['name']]+=1
            args={k:v for k,v in (c.get('args') or {}).items() if k!='memory'}
            sig=(c['name'],json.dumps(args,sort_keys=True))
            if seen_sig[sig]: repeats+=1; byname_rep[c['name']]+=1
            seen_sig[sig]+=1
            i=args.get('index')
            if isinstance(i,int) and i in idx: used.add(i)
        uc=sum(len(idx[i])+1 for i in used)
        task_used_chars+=uc
        per_call.append((len(idx), len(used), len(elem), uc))
        task_lines |= set(idx.values()); task_used |= {idx[i] for i in used}
    if task_elem_chars:
        per_task.append((len(task_lines), len(task_used), task_elem_chars, task_used_chars))
pc=np.array(per_call); pt=np.array(per_task)
print(run)
print(f'navigator calls with element list: {len(pc)}')
print(f'  lines/call median {np.median(pc[:,0]):.0f}; lines acted on/call median {np.median(pc[:,1]):.0f} mean {pc[:,1].mean():.2f}')
print(f'  element chars total {pc[:,2].sum():,}; chars of lines acted on in that same call {pc[:,3].sum():,} = {100*pc[:,3].sum()/pc[:,2].sum():.2f}%')
print(f'  per task: distinct element lines sent median {np.median(pt[:,0]):.0f}, distinct lines ever acted on median {np.median(pt[:,1]):.0f}')
print(f'  task-level useful share of element chars: {100*pt[:,3].sum()/pt[:,2].sum():.2f}%')
print(f'  offscreen-marked line chars {offscreen_chars:,} = {100*offscreen_chars/elem_chars:.1f}% of element block')
print(f'  actions {total_actions}, exact repeats {repeats} = {100*repeats/total_actions:.1f}%')
for n,c in byname.most_common(10): print(f'    {n:28s} {c:5d}  repeats {byname_rep[n]:4d} ({100*byname_rep[n]/c:.0f}%)')
