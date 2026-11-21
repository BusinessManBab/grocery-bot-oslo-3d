"""Replace the distributed gameplay spawns with named, mapped grocery stores.

.cache/build-venv/bin/python tools/use_real_shops.py
Uses cached POIs and the already completed driving graph; no new downloads/noding.
"""
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
for name in ("map", "buildings", "game-map", "town", "layout"):
    cache = ROOT / f".cache/pre-real-{name}.json"
    if not cache.exists():
        save(cache, load(DATA / f"{name}.json"))
graph, buildings, city, town, layout = [load(ROOT / f".cache/pre-real-{n}.json") for n in ("map", "buildings", "game-map", "town", "layout")]
sq = math.cos(math.radians(59.92))
distance = lambda a, b: math.hypot((a[0] - b[0]) * sq, a[1] - b[1]) * 1.113
nodes = {r[0]: (round(r[2] * 1e5), round(r[1] * 1e5)) for r in graph["nodes"]}
node_ids = sorted(nodes)
node_tree = STRtree([Point(nodes[i][0] * sq, nodes[i][1]) for i in node_ids])
nearest_node = lambda p: node_ids[int(node_tree.nearest(Point(p[0] * sq, p[1])))]
footprints = [{"ring": b[1:], "h": b[0]} for b in buildings["buildings"]] + [{"ring": h["ring"], "h": h["h"]} for h in buildings["homes"]]
polygons = [make_valid(Polygon(list(zip(b["ring"][::2], b["ring"][1::2])))) for b in footprints]
building_tree = STRtree(polygons)
pois = {}
for path in sorted((ROOT / ".cache/oslo-vector-tiles").glob("*.pbf")):
    _, tx, ty = map(int, path.stem.split("-"))
    layer = mapbox_vector_tile.decode(path.read_bytes(), default_options={"y_coord_down": True}).get("poi", {})
    extent = layer.get("extent", 4096)
    for feature in layer.get("features", []):
        props = feature["properties"]
        if props.get("subclass") not in ("supermarket", "convenience") or not props.get("name") or "meny" in props["name"].lower():
            continue
        if feature["geometry"]["type"] != "Point":
            continue
        x, y = feature["geometry"]["coordinates"]
        if not (0 <= x < extent and 0 <= y < extent):
            continue
        p = (((tx + x / extent) / 2 ** 14 * 360 - 180) * 1e5,
             math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + y / extent) / 2 ** 14)))) * 1e5)
        if not (city["bounds"][0] < p[0] < city["bounds"][2] and city["bounds"][1] < p[1] < city["bounds"][3]):
            continue
        node = nearest_node(p)
        hit = int(building_tree.nearest(Point(p)))
        if distance(p, nodes[node]) > 120 or polygons[hit].distance(Point(p)) > 30:
            continue
        identifier = feature.get("id") or props["name"]
        pois[identifier] = {"name": props["name"], "coordinates": [p[0] / 1e5, p[1] / 1e5],
                            "node": node, "poiId": identifier, "category": props["subclass"],
                            "footprint": footprints[hit], "source": city["coverage"]["source"]}

shops = []
for old in layout["shops"]:
    target = tuple(v * 1e5 for v in old["coordinates"])
    candidates = [p for p in pois.values() if
                  distance(target, tuple(v * 1e5 for v in p["coordinates"])) < 1500 and
                  all(distance(tuple(v * 1e5 for v in p["coordinates"]), tuple(v * 1e5 for v in s["coordinates"])) >= 1200 for s in shops)]
    if not candidates:
        raise ValueError("No separated real grocery store near " + old["district"])
    # Prefer proper supermarkets over kiosks, but retain the established geography.
    selected = min(candidates, key=lambda p: (distance(target, tuple(v * 1e5 for v in p["coordinates"])) +
                                             (600 if p["category"] != "supermarket" else 0), str(p["poiId"])))
    shop = {**old, "name": selected["name"], "address": selected["name"],
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
graph.update(id="oslo-real-grocers-preview-v3", shops=shops, addresses=addresses)
graph.pop("sha256", None)
graph["limitations"] = [x for x in graph["limitations"] if "Shop locations are gameplay" not in x]
graph["limitations"].append("Shop POI names and positions are from the pinned OSM-derived snapshot; not a live business directory.")
graph["sha256"] = hashlib.sha256(json.dumps(graph, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
sync_config(graph, town)
town["build"].update(max_customers=len(addresses), shops=[{"address": s["name"], "coordinates": s["coordinates"]} for s in shops])
city.update(id=graph["id"], homes=[h["p"] for h in homes])
city["coverage"]["note"] = "City-wide match starting at twelve mapped grocery-store locations."
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
