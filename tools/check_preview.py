"""Check that the Oslo map, terrain, public feed and shop recording agree."""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
load = lambda name: json.loads((DATA / name).read_text())
town, graph, game, shop, relief, buildings = map(load, (
    "game-map.json", "map.json", "game.json", "shop.json", "terrain.json", "buildings.json"))
assert town["town"] == "oslo"
assert town["coverage"]["kind"] == "expanded-exploration"
core = town["coverage"]["playBounds"]
assert (town["bounds"][2] - town["bounds"][0]) * (town["bounds"][3] - town["bounds"][1]) > 4 * (core[2] - core[0]) * (core[3] - core[1])
assert len(load("landcover.json")["wood"]) > 0
assert graph["id"] == "oslo-expanded-preview-v1"
assert len(graph["shops"]) == len(game["meta"]["players"]) == shop["seats"] == 12
assert len({s["node"] for s in graph["shops"]}) == 12
assert len({p["look"]["color"] for p in game["meta"]["players"]}) == 12
assert len(graph["addresses"]) == len(town["homes"]) == len(buildings["homes"]) == 160
point = lambda xy: tuple(round(v * 1e5) for v in xy)
assert {point(a["coordinates"]) for a in graph["addresses"]} == {tuple(p) for p in town["homes"]}
assert {tuple(h["p"]) for h in buildings["homes"]} == {tuple(p) for p in town["homes"]}
assert [point(s["coordinates"]) for s in graph["shops"]] == [tuple(p["shop"]) for p in game["meta"]["players"]]
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
print(f"PASS: 12 active AIs, 60 trucks, 160 matching homes, {shop['ticks']} synchronized frames.")
print("Delivered per AI:", delivered)
print("Terrain:", relief)
