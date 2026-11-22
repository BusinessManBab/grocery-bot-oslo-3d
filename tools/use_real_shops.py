"""Replace the distributed gameplay spawns with named, mapped grocery stores: MENY only.

.cache/build-venv/bin/python tools/use_real_shops.py
Uses cached POIs and the already completed driving graph; no new downloads/noding.

Every player shop is a MENY store. Of the MENY stores on the map, the twelve that lie furthest
apart are used (each with enough delivery homes around it); only if there were too few MENY
stores would other NorgesGruppen stores (KIWI, Joker, SPAR, Nærbutikken, Jacobs) fill the seats.
"""
import itertools
import hashlib
import json
import math
import sys
from pathlib import Path
import mapbox_vector_tile
from shapely.geometry import Point, Polygon
from shapely import make_valid
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SANDBOX = ROOT / ".cache/town-rush/public/data/towns/oslo"
load = lambda p: json.loads(p.read_text())
save = lambda p, x: p.write_text(json.dumps(x, separators=(",", ":")))


def sync_config(graph, town):
    town["map_id"] = graph["id"]
    town["build"].update(max_customers=len(graph["addresses"]), map_id=graph["id"], graph_id=graph["id"],
                         first_shop={"address": graph["shops"][0]["name"], "coordinates": graph["shops"][0]["coordinates"]})
    return town


if "--sync-config-only" in sys.argv:
    town = sync_config(load(DATA / "map.json"), load(DATA / "town.json"))
    save(DATA / "town.json", town)
    save(SANDBOX / "town.json", town)
    print("Synced build metadata; shop positions and graph unchanged.")
    raise SystemExit(0)
# Start from the finished city graph (the pruned v5 driving graph and its delivery homes), saved once
# before the first MENY run so the step can be repeated.
for name in ("map", "buildings", "game-map", "town", "layout"):
    cache = ROOT / f".cache/pre-meny-{name}.json"
    if not cache.exists():
        save(cache, load(DATA / f"{name}.json"))
graph, buildings, city, town, layout = [load(ROOT / f".cache/pre-meny-{n}.json") for n in ("map", "buildings", "game-map", "town", "layout")]
sq = math.cos(math.radians(59.92))
distance = lambda a, b: math.hypot((a[0] - b[0]) * sq, a[1] - b[1]) * 1.113
nodes = {r[0]: (round(r[2] * 1e5), round(r[1] * 1e5)) for r in graph["nodes"]}
node_ids = sorted(nodes)
node_tree = STRtree([Point(nodes[i][0] * sq, nodes[i][1]) for i in node_ids])
nearest_node = lambda p: node_ids[int(node_tree.nearest(Point(p[0] * sq, p[1])))]
footprints = [{"ring": b[1:], "h": b[0]} for b in buildings["buildings"]] + [{"ring": h["ring"], "h": h["h"]} for h in buildings["homes"]]
polygons = [make_valid(Polygon(list(zip(b["ring"][::2], b["ring"][1::2])))) for b in footprints]
building_tree = STRtree(polygons)
NORGESGRUPPEN = ("meny", "kiwi", "joker", "spar", "nærbutikken", "naerbutikken", "jacobs")
# Grocery stores from OpenStreetMap (Overpass, cached in .cache/overpass/groceries.json): the tile
# snapshot misses the newest MENY stores, and OSM's brand tags tell the chains apart.
GROCERIES = ROOT / ".cache/overpass/groceries.json"
if not GROCERIES.exists():
    import urllib.parse, urllib.request
    west, south, east, north = [v / 1e5 for v in city["bounds"]]
    query = f'[out:json][timeout:90];(nwr["shop"~"supermarket|convenience|grocery"]({south},{west},{north},{east}););out tags center;'
    request = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": query}).encode(),
                                     headers={"User-Agent": "grocery-bot-map-preview/1.0", "Accept": "application/json"})
    GROCERIES.parent.mkdir(parents=True, exist_ok=True)
    GROCERIES.write_bytes(urllib.request.urlopen(request, timeout=120).read())
def osm_building(identifier, p):
    """The OSM building a store is in (or the nearest within 60 m), from Overpass, cached."""
    import urllib.parse, urllib.request
    path = ROOT / f".cache/overpass/store-{identifier.replace('/', '-')}.json"
    if not path.exists():
        query = f'[out:json][timeout:60];way(around:80,{p[1] / 1e5},{p[0] / 1e5})["building"];out tags geom;'
        request = urllib.request.Request("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": query}).encode(),
                                         headers={"User-Agent": "grocery-bot-map-preview/1.0", "Accept": "application/json"})
        path.write_bytes(urllib.request.urlopen(request, timeout=120).read())
    best = None
    for way in json.loads(path.read_text())["elements"]:
        ring = [(round(q["lon"] * 1e5), round(q["lat"] * 1e5)) for q in way.get("geometry", [])]
        if len(ring) < 4:
            continue
        poly = make_valid(Polygon(ring))
        gap = 0 if poly.contains(Point(p)) else poly.distance(Point(p)) * 1.113
        if gap <= 60 and (best is None or gap < best[0]):
            t = way.get("tags", {})
            levels = float(t.get("building:levels", 0) or 0)
            h = float(str(t.get("height", "0")).split()[0] or 0) or (levels * 3.2 if levels else 8)
            flat = [v for q in (ring[:-1] if ring[0] == ring[-1] else ring) for v in q]
            best = (gap, {"ring": flat, "h": round(h), "info": [t.get("building", "yes"), t.get("roof:shape", ""), "", ""]})
    return best and best[1]


pois = {}
for element in json.loads(GROCERIES.read_text())["elements"]:
    tags = element.get("tags", {})
    name = tags.get("name") or ""
    chain = (tags.get("brand") or name).lower()
    if tags.get("shop") not in ("supermarket", "convenience") or not name or not any(b in chain for b in NORGESGRUPPEN):
        continue
    centre = element.get("center") or {"lat": element.get("lat"), "lon": element.get("lon")}
    p = (centre["lon"] * 1e5, centre["lat"] * 1e5)
    if not (city["bounds"][0] < p[0] < city["bounds"][2] and city["bounds"][1] < p[1] < city["bounds"][3]):
        continue
    node = nearest_node(p)
    hit = int(building_tree.nearest(Point(p)))
    identifier = f"{element['type']}/{element['id']}"
    footprint = footprints[hit] if polygons[hit].distance(Point(p)) <= 30 else None
    if footprint is None and "meny" in chain:
        footprint = osm_building(identifier, p)       # a newer store building the snapshot does not have
    if distance(p, nodes[node]) > 120 or footprint is None:
        continue
    pois[identifier] = {"name": name, "coordinates": [p[0] / 1e5, p[1] / 1e5], "node": node, "poiId": identifier,
                        "category": tags["shop"], "brand": tags.get("brand") or name.split(" ")[0],
                        "footprint": footprint, "source": "OpenStreetMap (Overpass API), ODbL"}

# Twelve seats: MENY stores first, the most spread-out set with customers around each; other
# NorgesGruppen stores only if MENY cannot fill the seats.
seats = len(layout["shops"])
P = lambda store: tuple(v * 1e5 for v in store["coordinates"])
customers = lambda store: sum(distance(P(store), (a["coordinates"][0] * 1e5, a["coordinates"][1] * 1e5)) < 1250 for a in graph["addresses"])
pool = [p for p in pois.values() if customers(p) >= 15]
meny = sorted([p for p in pool if "meny" in p["name"].lower()], key=lambda p: str(p["poiId"]))
others = sorted([p for p in pool if "meny" not in p["name"].lower()], key=lambda p: (p["category"] != "supermarket", str(p["poiId"])))
print(f"{len(meny)} MENY stores usable (of {sum('meny' in p['name'].lower() for p in pois.values())} mapped), {len(others)} other NorgesGruppen", flush=True)
def spread(group):
    return min(distance(P(a), P(b)) for a, b in itertools.combinations(group, 2))
if len(meny) >= seats:
    chosen = max(itertools.combinations(meny, seats), key=lambda g: (spread(g), sum(customers(p) for p in g)))
else:
    chosen = list(meny)
    while len(chosen) < seats:          # top up with the NorgesGruppen store furthest from the chosen ones
        chosen.append(max(others, key=lambda p: (min(distance(P(p), P(c)) for c in chosen) if chosen else 0, p["category"] == "supermarket")))
        others.remove(chosen[-1])
# each seat keeps its player and takes the chosen store nearest its old spawn
remaining, shops = list(chosen), []
for old in layout["shops"]:
    target = tuple(v * 1e5 for v in old["coordinates"])
    selected = min(remaining, key=lambda p: distance(target, P(p)))
    remaining.remove(selected)
    district = selected["name"].split(" ", 1)[1] if " " in selected["name"] else selected["name"]
    shop = {**old, "name": selected["name"], "address": selected["name"], "district": district,
            "coordinates": selected["coordinates"], "node": selected["node"], "store": selected}
    shops.append(shop)
    print(old["district"], "→", shop["name"], shop["coordinates"], flush=True)

# Never leave a delivery-home mesh in the same real footprint as a player shop.
store_rings = {tuple(s["store"]["footprint"]["ring"]) for s in shops}
addresses, homes = [], []
for address, home in zip(graph["addresses"], buildings["homes"]):
    if tuple(home["ring"]) in store_rings:
        continue
    addresses.append(address)
    homes.append(home)
graph.update(id="oslo-meny-preview-v6", shops=shops, addresses=addresses)
graph.pop("sha256", None)
graph["limitations"] = [x for x in graph["limitations"] if "Shop locations are gameplay" not in x]
graph["limitations"].append("Shop POI names and positions are from the pinned OSM-derived snapshot; not a live business directory.")
graph["sha256"] = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
sync_config(graph, town)
town["build"].update(max_customers=len(addresses), shops=[{"address": s["name"], "coordinates": s["coordinates"]} for s in shops])
city.update(id=graph["id"], homes=[h["p"] for h in homes])
city["coverage"]["note"] = "City-wide match starting at twelve mapped MENY stores."
buildings["homes"] = homes
separations = [distance(tuple(v * 1e5 for v in a["coordinates"]), tuple(v * 1e5 for v in b["coordinates"]))
               for i, a in enumerate(shops) for b in shops[i + 1:]]
for directory in (DATA, SANDBOX):
    save(directory / "map.json", graph)
    save(directory / "town.json", town)
save(DATA / "game-map.json", city)
save(DATA / "buildings.json", buildings)
save(DATA / "layout.json", {"shops": shops, "minimumSeparationMetres": round(min(separations)),
                           "maximumSeparationMetres": round(max(separations)), "deliveryHomes": len(homes),
                           "locationSource": city["coverage"]["source"], "realGroceryStores": True})
print(f"PASS: {len(shops)} real stores, separation {min(separations):.0f}–{max(separations):.0f} m; {len(homes)} homes")
