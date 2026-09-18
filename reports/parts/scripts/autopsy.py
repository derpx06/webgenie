import json, glob, re, collections, hashlib, statistics as st, sys
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
run=sys.argv[1] if len(sys.argv)>1 else 'mind2web-r2-cand-6347e1c'
MARKS=[('plan','[CURRENT PLAN]'),('requirements','[REQUIREMENTS]'),('validated','[VALIDATED PROGRESS]'),
       ('findings','[FINDINGS]'),('steps_old','[Steps so far, oldest first]'),('steps_earlier','[Earlier steps]'),
       ('memory','[Agent memory]'),('browser','[Current browser state]'),('scroll','[Scroll info of current page]')]
def split(s):
    out=collections.Counter()
    # element block
    a=s.find('[Start of page]'); b=s.find('[End of page]')
    elem=s[a:b+len('[End of page]')] if a>=0 and b>a else ''
    out['elements']=len(elem)
    rest=s[:a]+s[b+len('[End of page]'):] if elem else s
    # action results tail
    ar=rest.find('Results of your last actions:')
    if ar>=0:
        out['action_results']=len(rest)-ar; rest=rest[:ar]
    cs=rest.find('Current step:')
    if cs>=0:
        out['stepline']=len(rest)-cs; rest=rest[:cs]
    pos=[]
    for name,mk in MARKS:
        i=rest.find(mk)
        if i>=0: pos.append((i,name))
    pos.sort()
    if pos:
        out['header']=pos[0][0]
        for j,(i,name) in enumerate(pos):
            end=pos[j+1][0] if j+1<len(pos) else len(rest)
            out[name]+=end-i
    else:
        out['header']=len(rest)
    return out, elem

per=collections.defaultdict(lambda: collections.Counter())
ncalls=collections.Counter()
promptchars=collections.defaultdict(list); intok=collections.defaultdict(list)
statelen=collections.defaultdict(list)
repeat=[]   # per task: (distinct element blocks, total element blocks, resent chars)
img=collections.Counter()
tasks=0
for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
    sess=[]; llms=[]
    for line in open(f):
        try: r=json.loads(line)
        except: continue
        if r.get('kind')=='session': sess.append(r)
        elif r.get('kind')=='llm' and r.get('durationMs') is not None and 'failed' not in r['msg'] and 'superseded' not in r['msg']: llms.append(r)
    if not sess: continue
    tasks+=1
    byts={ (r['ts'],r['component']):r for r in llms }
    hashes=collections.Counter(); tot=0; resent=0
    for r in sess:
        comp=r['component']; d=r['data']; s=d['state']
        sec,elem=split(s)
        ncalls[comp]+=1
        for k,v in sec.items(): per[comp][k]+=v
        statelen[comp].append(len(s))
        if d.get('images'): img[comp]+=int(d['images'])
        l=byts.get((r['ts'],comp))
        if l:
            promptchars[comp].append(l['data']['promptChars']); intok[comp].append(l['data']['usage']['inputTokens'])
        if elem:
            h=hashlib.md5(elem.encode('utf-8','replace')).hexdigest()
            tot+=1
            if hashes[h]: resent+=len(elem)
            hashes[h]+=1
    if tot: repeat.append((len(hashes),tot,resent))
print('run',run,'tasks with sessions',tasks)
for comp in per:
    tot=sum(per[comp].values())
    print(f'--- {comp}: {ncalls[comp]} calls, state chars total {tot}, median state len {st.median(statelen[comp]):.0f}')
    for k,v in per[comp].most_common():
        print(f'   {k:16s} {v:10d} {100*v/tot:5.1f}%  per-call {v/ncalls[comp]:8.0f}')
print('images per component', dict(img))
# chars-per-token fit
import math
for comp in promptchars:
    x=promptchars[comp]; y=intok[comp]
    n=len(x); mx=sum(x)/n; my=sum(y)/n
    sxx=sum((a-mx)**2 for a in x); sxy=sum((a-mx)*(b-my) for a,b in zip(x,y))
    a=sxy/sxx; b=my-a*mx
    print(f'FIT {comp}: n={n} inputTokens = {a:.5f}*promptChars + {b:.0f}  -> chars/token {1/a:.2f}, fixed {b:.0f} tok')
    print(f'    median promptChars {st.median(x):.0f}, median inputTokens {st.median(y):.0f}')
d=[r[0] for r in repeat]; t=[r[1] for r in repeat]; rs=[r[2] for r in repeat]
print(f'REPEAT: tasks {len(repeat)} distinct element blocks median {st.median(d):.0f}, total blocks median {st.median(t):.0f}')
print(f'  repeat factor (total/distinct) median {st.median([b/a for a,b,_ in repeat]):.2f} mean {sum(t)/sum(d):.2f}')
print(f'  resent element chars per task: median {st.median(rs):.0f} mean {sum(rs)/len(rs):.0f}; total {sum(rs)}')
