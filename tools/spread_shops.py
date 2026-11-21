"""Give the wider Oslo preview a real, connected driving graph and spread-out shops.

.cache/build-venv/bin/python tools/spread_shops.py
Uses only the cached, versioned OpenFreeMap snapshot. Never edits the source game.
"""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path

import mapbox_vector_tile
from shapely import make_valid
from shapely.geometry import Point, box, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SANDBOX = ROOT / ".cache/town-rush/public/data/towns/oslo"
load = lambda p: json.loads(p.read_text())
save = lambda p, data: p.write_text(json.dumps(data, separators=(",", ":")))
town, city, buildings = map(load, (DATA / "town.json", DATA / "game-map.json", DATA / "buildings.json"))
for name, value in (("spread-base-buildings", buildings), ("spread-base-map", load(DATA / "map.json"))):
    path = ROOT / f".cache/{name}.json"
    if not path.exists():
        save(path, value)
buildings = load(ROOT / ".cache/spread-base-buildings.json")
bounds = city["bounds"]
world = box(*bounds)
sq = math.cos(math.radians((bounds[1] + bounds[3]) / 2e5))
DISTRICTS = [
    ("Skøyen", 10.688, 59.925), ("Bygdøy", 10.687, 59.909),
    ("Frogner", 10.712, 59.918), ("Majorstuen", 10.712, 59.936),
    ("Ullevål", 10.735, 59.950), ("Sagene", 10.754, 59.940),
    ("Bjerke", 10.800, 59.944), ("Helsfyr", 10.809, 59.922),
    ("Vålerenga", 10.791, 59.907), ("Ekeberg", 10.785, 59.889),
    ("Bjørvika", 10.757, 59.909), ("Grünerløkka", 10.767, 59.925),
]
SPEEDS = {"trunk": 60, "primary": 50, "secondary": 50, "tertiary": 40, "minor": 30, "service": 15}
KINDS = {"trunk": "trunk", "primary": "primary", "secondary": "secondary",
         "tertiary": "tertiary", "minor": "residential", "service": "service"}


def metres(a, b):
    return math.hypot((a[0] - b[0]) * sq, a[1] - b[1]) * 1.113


def line_parts(geometry):
    if geometry.geom_type == "LineString":
        return [geometry]
    return [line for part in getattr(geometry, "geoms", []) for line in line_parts(part)]


by_layer = defaultdict(list)
for path in sorted((ROOT / ".cache/oslo-vector-tiles").glob("*.pbf")):
    _, tx, ty = map(int, path.stem.split("-"))
    tile = mapbox_vector_tile.decode(path.read_bytes(), default_options={"y_coord_down": True})
    layer = tile.get("transportation", {})
    extent, n = layer.get("extent", 4096), 2 ** 14
    def project(xs, ys, _z=None):
        return ([(tx + x / extent) / n * 360e5 - 180e5 for x in xs],
                [math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + y / extent) / n)))) * 1e5 for y in ys])
    def xy(px, py):
        x, y = project([px], [py])
        return x[0], y[0]
    west, north = xy(0, 0)
    east, south = xy(extent, extent)
    owned = world.intersection(box(west, south, east, north))
    for feature in layer.get("features", []):
        props = feature["properties"]
        kind = props.get("class")
        if kind not in SPEEDS or props.get("brunnel") == "tunnel" or props.get("access") in ("no", "private"):
            continue
        geometry = shape(feature["geometry"])
        if geometry.geom_type not in ("LineString", "MultiLineString"):
            continue
        for line in line_parts(transform(project, geometry).intersection(owned)):
            if line.length > 1:
                by_layer[props.get("layer", 0)].append((line, kind, props.get("oneway", 0)))

print("Noding the cached road network by grade, retaining mapped one-way directions", flush=True)
raw_edges = {}
for grade, features in sorted(by_layer.items()):
    originals = [f[0] for f in features]
    tree = STRtree(originals)
    # Intersections on different grades are not joined; ramps still meet their road
    # at shared endpoints. Vector-tile seams are joined by coordinate snapping.
    noded = unary_union(originals)
    for line in line_parts(noded):
        source = int(tree.nearest(line.interpolate(.5, normalized=True)))
        original, kind, one_way = features[source]
        coords = list(line.coords)
        forward = original.project(Point(coords[-1])) >= original.project(Point(coords[0]))
        direction = (-1 if one_way == -1 else 1) * (1 if forward else -1)
        for a, b in zip(coords, coords[1:]):
            # A metre-scale frozen grid joins equal road junctions across tile seams.
            a, b = (round(a[0] / 2) * 2, round(a[1])), (round(b[0] / 2) * 2, round(b[1]))
            length = metres(a, b)
            if a == b or length < .1:
                continue
            pairs = [(a, b), (b, a)] if not one_way else [(a, b)] if direction > 0 else [(b, a)]
            for start, end in pairs:
                key = start, end
                candidate = (round(length, 2), SPEEDS[kind], KINDS[kind])
                if key not in raw_edges or length / SPEEDS[kind] < raw_edges[key][0] / raw_edges[key][1]:
                    raw_edges[key] = candidate

points = sorted({p for edge in raw_edges for p in edge})
ids = {p: index + 1000000 for index, p in enumerate(points)}
adj, back = defaultdict(list), defaultdict(list)
for a, b in raw_edges:
    adj[a].append(b)
    back[b].append(a)
anchor = min(points, key=lambda p: metres(p, (1075100, 5992100)))


def reachable(links):
    seen, queue = {anchor}, [anchor]
    while queue:
        for p in links[queue.pop()]:
            if p not in seen:
                seen.add(p)
                queue.append(p)
    return seen


connected = reachable(adj) & reachable(back)
kept = sorted(connected)
print(f"Connected city: {len(kept)} of {len(points)} vertices", flush=True)
node_tree = STRtree([Point(p[0] * sq, p[1]) for p in kept])
nearest = lambda p: kept[int(node_tree.nearest(Point(p[0] * sq, p[1])))]
shops = []
for index, (district, lon, lat) in enumerate(DISTRICTS):
    target = (lon * 1e5, lat * 1e5)
    candidates = [p for p in kept if metres(p, target) < 600 and
                  all(metres(p, (s["coordinates"][0] * 1e5, s["coordinates"][1] * 1e5)) >= 1250 for s in shops) and
                  all(metres(p, h["p"]) >= 160 for h in buildings["homes"][:160])]
    if not candidates:
        raise ValueError(f"No separated, connected road spawn near {district}")
    p = min(candidates, key=lambda p: (metres(p, target), p))
    shops.append({"id": f"s{index + 1}", "node": ids[p], "name": f"Grocery Bot · {district}",
                  "address": district, "district": district, "coordinates": [p[0] / 1e5, p[1] / 1e5]})
    print(f"  s{index + 1}: {district} {p}", flush=True)

# Keep the 160 verified postal deliveries, then add 20 real delivery buildings
# around each district. These are explicitly building points, not invented addresses.
base = load(ROOT / ".cache/spread-base-map.json")
addresses = [{**a, "node": ids[nearest((a["coordinates"][0] * 1e5, a["coordinates"][1] * 1e5))]}
             for a in base["addresses"][:160]]
homes = list(buildings["homes"][:160])
chosen = set()
footprints = []
for index, b in enumerate(buildings["buildings"]):
    ring = list(zip(b[1::2], b[2::2]))
    polygon = shape({"type": "Polygon", "coordinates": [ring + [ring[0]]]})
    if not polygon.is_valid:
        polygon = make_valid(polygon)
    if polygon.is_empty or polygon.area * sq * 1.113 ** 2 < 50:
        continue
    point = polygon.representative_point()
    p = (round(point.x), round(point.y))
    footprints.append((index, p, nearest(p)))
for district_index, shop in enumerate(shops):
    center = tuple(round(v * 1e5) for v in shop["coordinates"])
    candidates = [(i, p, road) for i, p, road in footprints if
                  160 < metres(center, p) < 1250 and metres(p, road) < 65 and i not in chosen]
    count = 0
    for i, p, road in sorted(candidates, key=lambda row: (metres(center, row[1]), row[0])):
        if any(metres(p, h["p"]) < 105 for h in homes):
            continue
        if any(metres(p, tuple(round(v * 1e5) for v in s["coordinates"])) < 160 for s in shops):
            continue
        count += 1
        identifier = f"district-{district_index + 1}-{count}"
        addresses.append({"id": identifier, "address": f"{shop['district']} · delivery building {count}",
                          "kind": "building", "coordinates": [p[0] / 1e5, p[1] / 1e5], "node": ids[road]})
        b = buildings["buildings"][i]
        homes.append({"p": p, "h": min(14, b[0]), "ring": b[1:]})
        chosen.add(i)
        if count == 20:
            break
    if count < 12:
        raise ValueError(f"Only {count} nearby delivery buildings for {shop['district']}")
    print(shop["district"], "new delivery buildings", count, flush=True)

edges = [[ids[a], ids[b], *raw_edges[a, b]] for a, b in sorted(raw_edges) if a in connected and b in connected]
graph = {"id": "oslo-distributed-preview-v2", "license": "ODbL-1.0; © OpenStreetMap contributors",
         "attribution": city["coverage"]["attribution"], "source": city["coverage"]["source"],
         "nodes": [[ids[p], p[1] / 1e5, p[0] / 1e5] for p in kept], "edges": edges,
         "shops": shops, "addresses": addresses, "signals": [], "crossings": [], "stops": [],
         "limitations": ["Offline preview graph derived from the versioned OpenMapTiles road geometry.",
                          "Road-class speed fallbacks; no mapped traffic controls or turn-restriction relations.",
                          "New delivery buildings are real footprints, not verified postal addresses.",
                          "Shop locations are gameplay spawns, not claims about real grocery stores."]}
graph["sha256"] = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
town.update(map_id=graph["id"], incident=None)
town["build"]["shops"] = [{"address": s["district"], "coordinates": s["coordinates"]} for s in shops]
town["build"].update(max_customers=len(addresses), graph_id=graph["id"],
                     road_bounds=[v / 1e5 for v in bounds],
                     first_shop=town["build"]["shops"][0])
town["build"]["area"] = [[bounds[0] / 1e5, bounds[1] / 1e5], [bounds[2] / 1e5, bounds[1] / 1e5],
                         [bounds[2] / 1e5, bounds[3] / 1e5], [bounds[0] / 1e5, bounds[3] / 1e5]]
town["play_area"]["polygon"] = town["build"]["area"]
for directory in (DATA, SANDBOX):
    save(directory / "map.json", graph)
    save(directory / "town.json", town)
city["id"] = graph["id"]
city["homes"] = [h["p"] for h in homes]
city["coverage"].update(kind="distributed-city-match", playBounds=bounds,
                        note="All twelve AI shops and their delivery routes use the wider connected city graph.")
# Draw exactly the frozen drivable edges, deduplicating the two directions.
segments = {"major": set(), "street": set(), "lane": set()}
drawn = set()
for a, b, _, _, kind in edges:
    pair = min(a, b), max(a, b)
    if pair in drawn:
        continue
    drawn.add(pair)
    pa, pb = points[a - 1000000], points[b - 1000000]
    segments["major" if kind in ("trunk", "primary", "secondary") else "lane" if kind == "service" else "street"].add((min(pa, pb), max(pa, pb)))


def road_chains(pieces):
    links = defaultdict(set)
    for a, b in pieces:
        links[a].add(b)
        links[b].add(a)
    left = set(pieces)
    def take(a, b):
        key = min(a, b), max(a, b)
        if key not in left:
            return False
        left.remove(key)
        return True
    def walk(a, b):
        run = [a, b]
        while len(links[run[-1]]) == 2:
            following = next(p for p in sorted(links[run[-1]]) if p != run[-2])
            if not take(run[-1], following):
                break
            run.append(following)
        return [v for p in run for v in p]
    output = []
    for a in sorted(links):
        if len(links[a]) != 2:
            for b in sorted(links[a]):
                if take(a, b):
                    output.append(walk(a, b))
    while left:
        a, b = min(left)
        take(a, b)
        output.append(walk(a, b))
    return output


city["roads"] = {kind: road_chains(pieces) for kind, pieces in segments.items()}
save(DATA / "game-map.json", city)
save(DATA / "buildings.json", {**buildings, "homes": homes,
                              "buildings": [b for i, b in enumerate(buildings["buildings"]) if i not in chosen]})
separations = [metres(tuple(round(v * 1e5) for v in a["coordinates"]),
                      tuple(round(v * 1e5) for v in b["coordinates"]))
               for i, a in enumerate(shops) for b in shops[i + 1:]]
save(DATA / "layout.json", {"shops": shops, "minimumSeparationMetres": round(min(separations)),
                           "maximumSeparationMetres": round(max(separations)), "deliveryHomes": len(homes)})
print(f"PASS: {len(shops)} shops, {len(homes)} homes, {len(kept)} nodes, {len(edges)} directed edges; "
      f"shop separations {min(separations):.0f}–{max(separations):.0f} m", flush=True)
