"""Freeze a wide Oslo scenery snapshot without changing the synchronized AI match.

.cache/build-venv/bin/pip install mapbox-vector-tile pillow
.cache/build-venv/bin/python tools/expand_oslo.py

OpenFreeMap's versioned OpenMapTiles snapshot is used offline because the public
Overpass servers time out on the wider city. No tile service is used during play.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import urllib.request

import mapbox_vector_tile
from shapely.geometry import box, shape
from shapely.geometry.polygon import orient
from shapely.ops import transform, unary_union
from shapely import make_valid

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
BOUNDS = [10.66, 59.88, 10.83, 59.96]
BOX = [round(v * 1e5) for v in BOUNDS]
WORLD = box(*BOX)
Z, N = 14, 2 ** 14
ATTRIBUTION = "OpenStreetMap contributors (ODbL), OpenFreeMap / OpenMapTiles"
load = lambda path: json.loads(path.read_text())


def save(path, data):
    path.write_text(json.dumps(data, separators=(",", ":")))


def core_file(name):
    path = CACHE / f"oslo-core-{name}.json"
    if not path.exists():
        save(path, load(ROOT / f"data/{'game-map' if name == 'map' else name}.json"))
    return load(path)


core, original_buildings = core_file("map"), core_file("buildings")
metadata = CACHE / "openfreemap-snapshot.json"
if not metadata.exists():
    request = urllib.request.Request("https://tiles.openfreemap.org/planet", headers={"User-Agent": "Mozilla/5.0 GroceryBot-Oslo-MapBuilder/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        save(metadata, json.load(response))
template = load(metadata)["tiles"][0]
tile_cache = CACHE / "oslo-vector-tiles"
tile_cache.mkdir(exist_ok=True)


def tile_xy(lon, lat):
    return int((lon + 180) / 360 * N), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N)


def coordinate(tx, ty, px, py, extent):
    return ((tx + px / extent) / N * 360 - 180) * 1e5, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / extent) / N)))) * 1e5


def download(tile):
    tx, ty = tile
    path = tile_cache / f"{Z}-{tx}-{ty}.pbf"
    if not path.exists():
        url = template.format(z=Z, x=tx, y=ty)
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 GroceryBot-Oslo-MapBuilder/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            path.write_bytes(response.read())
    return tx, ty, path


x0, y1 = tile_xy(BOUNDS[0], BOUNDS[1])
x1, y0 = tile_xy(BOUNDS[2], BOUNDS[3])
tiles = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
print(f"Freezing {len(tiles)} z14 Oslo tiles from {template}", flush=True)
with ThreadPoolExecutor(max_workers=4) as pool:
    downloaded = list(pool.map(download, tiles))
print("Tiles downloaded; decoding real roads, water, buildings and woodland", flush=True)
water, green, wood = [], [], []
building_parts = {}
roads = {key: list(value) for key, value in core["roads"].items()}
CORE = box(*core["bounds"])
road_kinds = {"trunk": "major", "primary": "major", "secondary": "major",
              "tertiary": "street", "minor": "street", "service": "lane"}


def polygons(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    return [p for part in getattr(geometry, "geoms", []) for p in polygons(part)]


def lines(geometry):
    if geometry.geom_type == "LineString":
        return [geometry]
    return [p for part in getattr(geometry, "geoms", []) for p in lines(part)]


for tx, ty, path in downloaded:
    data = mapbox_vector_tile.decode(path.read_bytes(), default_options={"y_coord_down": True})
    west, north = coordinate(tx, ty, 0, 0, 4096)
    east, south = coordinate(tx, ty, 4096, 4096, 4096)
    owned = box(west, south, east, north).intersection(WORLD)
    for layer_name in ("water", "landcover", "landuse", "park", "building", "transportation"):
        layer = data.get(layer_name, {})
        extent = layer.get("extent", 4096)
        for feature in layer.get("features", []):
            props = feature["properties"]
            klass = props.get("class")
            if layer_name == "transportation" and (
                klass not in road_kinds or props.get("brunnel") == "tunnel" or props.get("access") in ("no", "private")):
                continue
            if layer_name == "landcover" and klass not in ("wood", "grass", "farmland"):
                continue
            if layer_name == "landuse" and klass not in ("grass", "meadow", "forest", "recreation_ground", "cemetery", "village_green"):
                continue
            def project(xs, ys, _z=None):
                points = [coordinate(tx, ty, x, y, extent) for x, y in zip(xs, ys)]
                return [p[0] for p in points], [p[1] for p in points]
            geometry = shape(feature["geometry"])
            if not geometry.is_valid:
                geometry = make_valid(geometry)
            geometry = transform(project, geometry).intersection(owned)
            if geometry.is_empty:
                continue
            if layer_name == "transportation":
                # Do not replace or generalize any road used by the recording.
                for line in lines(geometry.difference(CORE)):
                    if line.length > 2:
                        roads[road_kinds[klass]].append([round(v) for p in line.simplify(1.5).coords for v in p])
            elif layer_name == "building":
                if CORE.covers(geometry.centroid):
                    continue
                key = feature.get("id") or (tx, ty, len(building_parts))
                entry = building_parts.setdefault(key, {"height": min(40, max(3, props.get("render_height", 7))), "pieces": []})
                entry["pieces"].append(geometry)
            elif layer_name == "water":
                if props.get("brunnel") != "tunnel":
                    water.extend(polygons(geometry))
            else:
                green.extend(polygons(geometry))
                if klass in ("wood", "forest"):
                    wood.extend(polygons(geometry))


def rings(polys):
    # Preserve island / courtyard holes and eliminate artificial vector-tile seams.
    result = []
    for polygon in polygons(unary_union(polys).simplify(1.5, preserve_topology=True)):
        polygon = orient(polygon, sign=-1)
        for ring in [polygon.exterior, *polygon.interiors]:
            flat = [round(v) for point in list(ring.coords)[:-1] for v in point]
            if len(flat) >= 6:
                result.append(flat)
    return result


labels = list(core["labels"]) + [
    [name, round(lon * 1e5), round(lat * 1e5), zoom]
    for name, lon, lat, zoom in [
        ("Frogner", 10.708, 59.921, 0), ("Vigelandsparken", 10.700, 59.927, 1),
        ("Majorstuen", 10.714, 59.931, 0), ("Bygdøy", 10.679, 59.904, 0),
        ("Skøyen", 10.683, 59.924, 0), ("Ullevaal", 10.733, 59.949, 0),
        ("Sagene", 10.751, 59.941, 0), ("Torshov", 10.770, 59.938, 0),
        ("Sinsen", 10.786, 59.940, 0), ("Bjerke", 10.813, 59.944, 0),
        ("Helsfyr", 10.802, 59.917, 0), ("Kampen", 10.785, 59.913, 1),
        ("Vålerenga", 10.792, 59.906, 0), ("Ekeberg", 10.774, 59.890, 0),
        ("Gamle Oslo", 10.773, 59.904, 1), ("Oslofjorden", 10.715, 59.887, 0),
        ("Lindøya", 10.727, 59.892, 1), ("Hovedøya", 10.736, 59.895, 1),
    ]]
out = {**core, "bounds": BOX, "roads": roads, "water": rings(water), "green": rings(green), "labels": labels,
       "coverage": {"kind": "expanded-exploration", "playBounds": core["bounds"], "source": template,
                    "attribution": ATTRIBUTION,
                    "note": "Real outer Oslo scenery around the original synchronized 12-AI match."}}
save(ROOT / "data/game-map.json", out)
landcover = {"attribution": ATTRIBUTION, "wood": rings(wood), "open": []}
save(ROOT / "data/landcover.json", landcover)
context = list(original_buildings["buildings"])
for entry in building_parts.values():
    for polygon in polygons(unary_union(entry["pieces"])):
        ring = [round(v) for p in list(polygon.exterior.coords)[:-1] for v in p]
        if len(ring) >= 6:
            context.append([round(entry["height"])] + ring)
save(ROOT / "data/buildings.json", {**original_buildings, "attribution": ATTRIBUTION, "buildings": context})
print("Expanded city:", BOX, {k: len(v) for k, v in roads.items()}, "buildings", len(context),
      "wood", len(landcover["wood"]), "water", len(out["water"]), flush=True)
