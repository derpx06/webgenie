import json,glob,collections,sys
import numpy as np
R='/home/manas/Documents/webSurfer/chrome-extension/e2e/results/'
for run in sys.argv[1:]:
    d=collections.defaultdict(list)
    for f in sorted(glob.glob(R+run+'/*/trace.jsonl')):
        for line in open(f):
            try: r=json.loads(line)
            except: continue
            if r.get('kind')=='span' and r.get('durationMs') is not None:
                m=r['msg']; c=r['component']
                if c=='NavigatorAgent' and m.startswith('action '): d['act:'+m[7:]].append(r['durationMs'])
                elif c=='Validation' and m.startswith('validated '): d['val:'+m.split()[1].rstrip(':')].append(r['durationMs'])
                elif m=='getState': d['getState'].append(r['durationMs'])
                elif m=='network idle': d['networkIdle'].append(r['durationMs'])
                elif m=='input dispatch': d['inputDispatch'].append(r['durationMs'])
            elif r.get('kind')=='llm' and r.get('durationMs') is not None:
                tag='llm:'+r['component']+(':fail' if 'failed' in r['msg'] else (':superseded' if 'superseded' in r['msg'] else ''))
                d[tag].append(r['durationMs'])
    print('==',run)
    for k in sorted(d, key=lambda x:-len(d[x])):
        v=d[k]
        if len(v)<5: continue
        print(f'  {k:32s} n={len(v):5d} med {np.median(v):8.0f} ms  p90 {np.percentile(v,90):8.0f}  total {sum(v)/1000:8.0f} s')
