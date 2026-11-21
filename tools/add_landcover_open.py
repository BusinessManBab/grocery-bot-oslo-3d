"""Add OSM open/field/built-up areas beside woodland for the no-tree rule."""
import json, math
from pathlib import Path
import mapbox_vector_tile
from shapely.geometry import box, shape
from shapely import make_valid
from shapely.ops import unary_union, transform
from shapely.geometry.polygon import orient
ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'data'; city=json.loads((DATA/'game-map.json').read_text()); bounds=city['bounds']; world=box(*bounds); Z,N=14,2**14
polys=[]
for path in sorted((ROOT/'.cache/oslo-vector-tiles').glob('*.pbf')):
 _,tx,ty=map(int,path.stem.split('-')); tile=mapbox_vector_tile.decode(path.read_bytes(),default_options={'y_coord_down':True})
 for layer_name,classes in [('landuse',{'residential','commercial','industrial','retail','railway','cemetery','farmland'}),('landcover',{'farmland','grass','sand','rock'})]:
  layer=tile.get(layer_name,{}); extent=layer.get('extent',4096)
  def project(xs,ys,_z=None):
   return ([(tx+x/extent)/N*360e5-180e5 for x in xs],[math.degrees(math.atan(math.sinh(math.pi*(1-2*(ty+y/extent)/N))))*1e5 for y in ys])
  for f in layer.get('features',[]):
   if f['properties'].get('class') not in classes: continue
   g=shape(f['geometry'])
   if not g.is_valid: g=make_valid(g)
   if g.geom_type not in ('Polygon','MultiPolygon'): continue
   polys.append(transform(project,g).intersection(world))
merged=unary_union([g for g in polys if not g.is_empty]).simplify(2,preserve_topology=True)
rings=[]
for p in ([merged] if merged.geom_type=='Polygon' else getattr(merged,'geoms',[])):
 p=orient(p,sign=-1)
 for r in [p.exterior,*p.interiors]:
  flat=[round(v) for pt in list(r.coords)[:-1] for v in pt]
  if len(flat)>=6: rings.append(flat)
lc=json.loads((DATA/'landcover.json').read_text()); lc['open']=rings
(DATA/'landcover.json').write_text(json.dumps(lc,separators=(',',':')))
print('Added',len(rings),'open/field/built-up rings')
