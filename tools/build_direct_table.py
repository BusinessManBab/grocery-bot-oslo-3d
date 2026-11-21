"""Precompute exact shop→delivery road values for the large preview graph.

One process per shop. Uses compact float64 arrays (the engine's Dijkstra values,
including its same tie-breaking order), so the city graph does not need 12 large
Python dictionaries resident at once.
"""
import heapq, json, subprocess, sys
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT/'.cache/town-rush'))
from engine.network import Network, truck_mps
m=json.loads((ROOT/'data/map.json').read_text())
if len(sys.argv)>1:
 i=int(sys.argv[1]);shop=m['shops'][i];net=Network(m);index={row[0]:j for j,row in enumerate(m['nodes'])};size=len(index)
 seconds=array('d',[float('inf')])*size;metres=array('d',[float('inf')])*size
 start=shop['node'];seconds[index[start]]=0;metres[index[start]]=0;q=[(0.0,0.0,start)];adj=net.adj;cal=net.car_calibration
 while q:
  cost,length,node=heapq.heappop(q)
  if cost!=seconds[index[node]]:continue
  for a,b,edge_metres,speed,*_ in adj.get(node,[]):
   candidate=cost+edge_metres/truck_mps(speed,cal)
   j=index[b]
   if candidate<seconds[j]:seconds[j]=candidate;metres[j]=length+edge_metres;heapq.heappush(q,(candidate,length+edge_metres,b))
 values={str(a['node']):[seconds[index[a['node']]],metres[index[a['node']]]] for a in m['addresses']}
 assert all(v[0]<float('inf') for v in values.values())
 print(json.dumps({'node':str(start),'values':values}));raise SystemExit
out={}
for i in range(len(m['shops'])):
 raw=subprocess.check_output([sys.executable,__file__,str(i)],cwd=ROOT);item=json.loads(raw);out[item['node']]=item['values'];print('shop',i+1,'done',flush=True)
(ROOT/'data/direct-table.json').write_text(json.dumps({'map':m['id'],'values':out},separators=(',',':')))
print('saved direct table for',len(out),'shops')
