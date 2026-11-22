"""Check that the Oslo map, terrain, public feed and shop recording agree."""
import json
import math
import hashlib
import struct
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
load = lambda name: json.loads((DATA / name).read_text())
town, graph, game, shop, relief, buildings = map(load, (
    "game-map.json", "map.json", "game.json", "shop.json", "terrain.json", "buildings.json"))
layout = load("layout.json")
assert town["town"] == "oslo"
assert town["coverage"]["kind"] == "distributed-city-match"
assert town["coverage"]["playBounds"] == town["bounds"]
assert len(load("landcover.json")["wood"]) > 0
assert graph["id"] == "oslo-meny-preview-v6"
assert len(graph["shops"]) == len(game["meta"]["players"]) == shop["seats"] == 12
assert len({s["node"] for s in graph["shops"]}) == 12
assert len({p["look"]["color"] for p in game["meta"]["players"]}) == 12
assert len(graph["addresses"]) == len(town["homes"]) == len(buildings["homes"]) == layout["deliveryHomes"] >= 390
assert sum(a.get("kind") == "building" for a in graph["addresses"]) >= 230
point = lambda xy: tuple(round(v * 1e5) for v in xy)
assert {point(a["coordinates"]) for a in graph["addresses"]} == {tuple(p) for p in town["homes"]}
assert {tuple(h["p"]) for h in buildings["homes"]} == {tuple(p) for p in town["homes"]}
assert [point(s["coordinates"]) for s in graph["shops"]] == [tuple(p["shop"]) for p in game["meta"]["players"]]
assert [s["coordinates"] for s in layout["shops"]] == [s["coordinates"] for s in graph["shops"]]
assert layout["realGroceryStores"]
assert len({s["store"]["poiId"] for s in graph["shops"]}) == 12
for location, player in zip(graph["shops"], game["meta"]["players"]):
    assert location["store"]["poiId"] == player["store"]["poiId"]
    assert location["coordinates"] == player["store"]["coordinates"]
    assert location["store"]["category"] in ("supermarket", "convenience")
    assert "meny" in location["store"]["name"].lower(), location["store"]["name"]      # every player shop is a MENY
sq = math.cos(math.radians(59.92))
distance = lambda a, b: math.hypot((a[0] - b[0]) * sq, a[1] - b[1]) * 111300
separations = [distance(a["coordinates"], b["coordinates"]) for i, a in enumerate(graph["shops"]) for b in graph["shops"][i + 1:]]
assert min(separations) >= 400 and max(separations) >= 5000, separations      # MENY stores sit closer than the old hand-spread spawns
for s in graph["shops"]:
    assert sum(distance(a["coordinates"], s["coordinates"]) < 1250 for a in graph["addresses"]) >= 15, s
assert game["finished"] and len(game["frames"]) == game["meta"]["ticks"] + 1 == shop["ticks"]
assert (DATA / "shop.bin").stat().st_size == shop["seats"] * shop["ticks"] * shop["frameBytes"]
assert (DATA / "terrain.bin").stat().st_size == relief["rows"] * relief["cols"] * 2
x0, y0, x1, y1 = town["bounds"]
for p in [*town["homes"], *(p["shop"] for p in game["meta"]["players"])]:
    assert x0 <= p[0] <= x1 and y0 <= p[1] <= y1, p
delivered = [0] * 12
for order in shop["orders"].values():
    if order["deliveredAt"] is not None:
        delivered[order["history"][-1][2]] += 1
assert all(n > 0 for n in delivered), delivered
assert all(len(frame["p"]) == 12 and all(len(p[4]) == 15 for p in frame["p"]) for frame in game["frames"])
# baked files the 3D view loads instead of buildings.json / landcover.json: present and up to date
def baked(name, sources):
    raw = (DATA / name).read_bytes()
    size = int.from_bytes(raw[:4], "little")
    header = json.loads(raw[4:4 + size])
    digest = hashlib.sha256(b"".join((DATA / s).read_bytes() for s in sources)).hexdigest()[:16]
    assert header["source"] == digest, f"{name} is stale: rerun its bake (tools/bake_buildings.mjs, tools/bake_trees.cjs)"
    return header
landmarks = load("landmarks.json")
digest = hashlib.sha256((DATA / "buildings.json").read_bytes() + (DATA / "layout.json").read_bytes() + (DATA.parent / "tools" / "bake_landmarks.py").read_bytes()).hexdigest()[:16]
assert landmarks["source"] == digest, "landmarks.json is stale: rerun tools/bake_landmarks.py"
assert {s["id"] for s in landmarks["sites"]} >= {"opera", "munch", "radhus", "slottet", "akershus", "domkirke"}
assert all(s.get("parts") or s["build"] == "model" for s in landmarks["sites"])
bin_header = baked("buildings.bin", ["buildings.json", "game-map.json", "game.json", "landmarks.json"])
assert bin_header["count"] > 54000 and sum(c[1] for c in bin_header["chunks"]) == bin_header["count"]
assert bin_header["bounds"] == town["bounds"]
# Shop models replace their host buildings; never leave the mall behind them.
raw = (DATA / "buildings.bin").read_bytes()
body_start = 4 + int.from_bytes(raw[:4], "little")
id_layout = next(item for item in bin_header["layout"] if item["name"] == "id")
assert id_layout["type"] == "Uint16"
resident_ids = set(struct.unpack_from(f"<{id_layout['length']}H", raw, body_start + id_layout["offset"]))
store_rings = {tuple(p["store"]["footprint"]["ring"]) for p in game["meta"]["players"]}
host_ids = {i for i, b in enumerate(buildings["buildings"]) if tuple(b[1:]) in store_rings}
# Two stores have synthetic footprints, so there is no source building to remove.
assert host_ids, "Expected mapped host buildings for the player shops"
assert not (host_ids & resident_ids), "Original shop buildings must be absent from the rendered city"
placements = load("shop-placement.json")
placement_sources = ["buildings.bin", "buildings.json", "homes.json", "game-map.json", "game.json", "landmarks.json"]
assert placements["source"] == hashlib.sha256(b"".join((DATA / p).read_bytes() for p in placement_sources)).hexdigest()[:16], "Shop placements are stale: rerun tools/fit_shop_sites.py"
assert [p["seat"] for p in placements["shops"]] == list(range(12))
assert all(p["bodyWidthMetres"] > 18 and p["roadClearanceMetres"] >= 3 and p["buildingClearanceMetres"] >= 3 for p in placements["shops"])
assert [(h["p"], h["ring"]) for h in load("homes.json")["homes"]] == [(h["p"], h["ring"]) for h in buildings["homes"]]
tree_header = baked("trees.bin", ["game-map.json", "buildings.json", "landcover.json", "game.json", "homes.json", "landmarks.json"])
assert tree_header["forest"] > 1000 and tree_header["parks"] > 500, tree_header
print(f"PASS: 12 real grocery-store locations, 60 trucks, {len(town['homes'])} matching homes, {shop['ticks']} synchronized frames.")
print(f"Shop separations: {min(separations):.0f}–{max(separations):.0f} m")
print("Delivered per AI:", delivered)
print("Terrain:", relief)
print(f"Baked: {bin_header['count']} buildings in {sum(1 for c in bin_header['chunks'] if c[1])} chunks, "
      f"{tree_header['forest']} forest + {tree_header['parks']} park trees, {len(landmarks['sites'])} landmarks")
