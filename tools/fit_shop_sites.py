"""Fit larger v2 shops to free space without touching roads or other buildings.

Run with .cache/build-venv/bin/python tools/fit_shop_sites.py [--check].
Geometry calculations only: no browser or rendering.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

DATA = Path(__file__).resolve().parents[1] / "data"
SOURCES = ["buildings.bin", "buildings.json", "homes.json", "game-map.json", "game.json", "landmarks.json"]
M = 1 / 1.113
ROAD_GAP = 3 * M
BUILDING_GAP = 3 * M


def load(name):
    return json.loads((DATA / name).read_text())


town, game, buildings = load("game-map.json"), load("game.json"), load("buildings.json")
bounds = town["bounds"]
origin = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
squash = math.cos(origin[1] / 1e5 * math.pi / 180)


def world(x, y):
    return ((x - origin[0]) * squash, -(y - origin[1]))


def raw(x, z):
    return [round(x / squash + origin[0], 5), round(origin[1] - z, 5)]


def polygon(flat):
    return Polygon([world(x, y) for x, y in zip(flat[::2], flat[1::2])]).buffer(0)


binary = (DATA / "buildings.bin").read_bytes()
size = int.from_bytes(binary[:4], "little")
header = json.loads(binary[4:4 + size])
layout = next(item for item in header["layout"] if item["name"] == "id")
assert layout["type"] == "Uint16"
ids = struct.unpack_from(f"<{layout['length']}H", binary, 4 + size + layout["offset"])
def array(name, code):
    item = next(part for part in header["layout"] if part["name"] == name)
    return struct.unpack_from(f"<{item['length']}{code}", binary, 4 + size + item["offset"])


# Check the actual simplified render polygons, not their noisier source outlines.
first, delta, counts = array("first", "i"), array("delta", "h"), array("points", "H")
obstacles = []
cursor = 0
for index, count in enumerate(counts):
    x, y = first[index * 2:index * 2 + 2]
    flat = [x, y]
    for point in range(1, count):
        x += delta[cursor]
        y += delta[cursor + 1]
        cursor += 2
        flat.extend([x, y])
    obstacles.append(polygon(flat))
obstacles += [polygon(h["ring"]) for h in load("homes.json")["homes"]]
for site in load("landmarks.json")["sites"]:
    obstacles += [polygon(p["rings"][0]) for p in site.get("parts", [])]
    obstacles += [polygon(r) for r in site.get("outline", [])]
obstacles = [p for p in obstacles if not p.is_empty]
building_tree = STRtree(obstacles)

# ROAD_LAYERS in src/world-build.js: the broadest visible ribbon counts.
roads = []
for kind, half in [("lane", 2.2), ("street", 7.5), ("major", 11)]:
    for flat in town["roads"].get(kind, []):
        points = [world(x, y) for x, y in zip(flat[::2], flat[1::2])]
        if len(points) >= 2:
            roads.append(LineString(points).buffer(half, join_style="mitre"))
road_tree = STRtree(roads)
waters = [polygon(r) for r in town["water"]]
water_tree = STRtree(waters)


def nearby(tree, shapes, area):
    return [shapes[i] for i in tree.query(area)]


def footprint(x, z, width, angle):
    # Includes the roof rim, footing, and the entire tilted awning, not just walls.
    unit = width * M / 62
    local = [(-31.5, -18), (31.5, -18), (31.5, 24), (-31.5, 24)]
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    return Polygon([(x + unit * (u * c - v * s), z + unit * (u * s + v * c)) for u, v in local])


def fingerprint():
    digest = hashlib.sha256()
    for name in SOURCES:
        digest.update((DATA / name).read_bytes())
    return digest.hexdigest()[:16]


def constraints(player):
    lot = polygon(player["store"]["footprint"]["ring"])
    area = lot.buffer(120 * M).envelope
    near_buildings = unary_union(nearby(building_tree, obstacles, area))
    near_roads = unary_union(nearby(road_tree, roads, area))
    near_water = unary_union(nearby(water_tree, waters, area))
    forbidden = unary_union([
        near_buildings.buffer(BUILDING_GAP), near_roads.buffer(ROAD_GAP),
        near_water.buffer(2 * M),
    ])
    # Stay in the immediate neighbourhood of the original store.
    allowed = lot.buffer(65 * M).difference(forbidden)
    return lot, allowed, near_buildings, near_roads


def fit(player):
    lot, allowed, near_buildings, near_roads = constraints(player)
    centre = lot.representative_point()
    minx, minz, maxx, maxz = lot.buffer(60 * M).bounds
    # Include both open-lot centres and a regular 4 m grid.
    xs = np.arange(minx, maxx + 1, 4 * M)
    zs = np.arange(minz, maxz + 1, 4 * M)
    candidates = [(x, z) for x in xs for z in zs if allowed.contains(Point(x, z))]
    candidates += [(centre.x, centre.y), (lot.centroid.x, lot.centroid.y)]
    # A store's existing building edges supply useful angles between the 15-degree steps.
    ring = list(lot.exterior.coords) if lot.geom_type == "Polygon" else list(max(lot.geoms, key=lambda p: p.area).exterior.coords)
    angles = set(range(0, 180, 15))
    for a, b in zip(ring, ring[1:]):
        if math.dist(a, b) > 8 * M:
            angles.add(round(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180, 2))
    # Prefer a supermarket-sized body, but don't consume an entire empty city block.
    for width in range(46, 17, -2):
        choices = []
        for angle in sorted(angles):
            shapes = np.array([footprint(x, z, width, angle) for x, z in candidates], dtype=object)
            fits = shapely.covers(allowed, shapes)
            for index in np.flatnonzero(fits):
                x, z = candidates[index]
                shape = shapes[index]
                # Fill the former store lot before considering surrounding open space.
                score = shape.intersection(lot).area / shape.area * 50 - Point(x, z).distance(centre) / M
                choices.append((score, x, z, angle, shape))
        if choices:
            _, x, z, angle, shape = max(choices, key=lambda item: item[0])
            return {
                "seat": player["seat"], "name": player["store"]["name"],
                "centre": raw(x, z), "bodyWidthMetres": width,
                "angleDegrees": round(-angle, 2),  # THREE rotationY reverses planar angle
                "footprint": [raw(px, pz) for px, pz in list(shape.exterior.coords)[:-1]],
                "buildingClearanceMetres": round(shape.distance(near_buildings) / M, 3),
                "roadClearanceMetres": round(shape.distance(near_roads) / M, 3),
            }
    raise RuntimeError(f"No safe shop placement found for {player['store']['name']}")


if "--check" in sys.argv:
    saved = load("shop-placement.json")
    assert saved["source"] == fingerprint(), "Shop placement data is stale"
    assert len(saved["shops"]) == len(game["meta"]["players"]) == 12
    shapes = []
    for seat, (player, placement) in enumerate(zip(game["meta"]["players"], saved["shops"])):
        assert placement["seat"] == seat
        x, z = world(*placement["centre"])
        shape = footprint(x, z, placement["bodyWidthMetres"], -placement["angleDegrees"])
        lot, allowed, near_buildings, near_roads = constraints(player)
        assert allowed.buffer(.001).covers(shape), f"Unsafe placement: {placement['name']}"
        assert placement["bodyWidthMetres"] >= 18
        shapes.append(shape)
    for i, shape in enumerate(shapes):
        assert all(shape.distance(other) >= BUILDING_GAP for other in shapes[i + 1:])
    print("PASS: 12 shops, complete awnings included, >=3 m from roads and other buildings")
else:
    result = []
    for player in game["meta"]["players"]:
        # Meta records don't all carry a seat field; order defines the seat.
        player = {**player, "seat": len(result)}
        placement = fit(player)
        result.append(placement)
        print(f"{placement['name']}: {placement['bodyWidthMetres']} m wide, "
              f"building gap {placement['buildingClearanceMetres']} m, road gap {placement['roadClearanceMetres']} m", flush=True)
    (DATA / "shop-placement.json").write_text(json.dumps({
        "source": fingerprint(), "roadSetbackMetres": 3, "buildingSetbackMetres": 3,
        "shops": result,
    }, separators=(",", ":")) + "\n")
