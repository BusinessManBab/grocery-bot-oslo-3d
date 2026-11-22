"""Bake data/landmarks.json: Oslo's famous buildings, from their real OpenStreetMap building parts.

    .cache/build-venv/bin/python tools/bake_landmarks.py

The background buildings (data/buildings.json) are single footprints with heights capped at 40 m,
and several famous buildings are missing or flattened in them, because OpenStreetMap maps them as
multi-part buildings (the Opera House, the Royal Palace, the City Hall's towers, the cathedral's
spire, the 100 m+ towers by Oslo S). The pinned OpenMapTiles snapshot the scenery comes from has
those parts, each with its own floor and roof height and often a colour. For every site below this
keeps those parts (pieces cut at tile edges joined again), measures the site's real footprint frame
(centre, long axis, length, width) for the hand-modelled shapes in src/landmarks.js, and lists the
background buildings each landmark replaces (tools/bake_buildings.mjs leaves those out).
Tiles come from .cache/oslo-vector-tiles (tools/expand_oslo.py), downloaded again if missing.

The tiles drop roof shapes, so each site's parts come from OpenStreetMap itself where it has them
(Overpass API, cached in .cache/overpass/ so a rebake gives the same result): roof shape (flat,
skillion, gabled, hipped, pyramidal, dome, onion, cone), roof height and direction, building and
roof colours and materials. Sites OSM has no parts for keep the tile parts.
"""
import hashlib
import json
import math
import re
import time
import urllib.parse
import urllib.request
import warnings
from pathlib import Path

import mapbox_vector_tile
from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
DATA, TILES = ROOT / "data", ROOT / ".cache" / "oslo-vector-tiles"
TEMPLATE = json.loads((DATA / "layout.json").read_text())["locationSource"]
Z, N = 14, 2 ** 14
SQ = math.cos(math.radians(59.92))
METRE = 1 / 1.113                         # 1e-5 degree of latitude is 1.113 m

# id, name, POI position (1e5 degree ints, from the snapshot's POI layer), radius in metres within
# which building parts belong to the site, and the shape src/landmarks.js builds:
#   parts: extrude the OSM parts as they are   model: hand-modelled on the measured frame
SITES = [
    dict(id="opera", name="Oslo Opera House", at=(1075268, 5990752), radius=95, build="parts", frame="outline", osm=True, facade="aluminium", colour="#eeece6"),
    dict(id="munch", name="MUNCH", at=(1075522, 5990563), radius=40, build="model", frame="tallest"),
    dict(id="deichman", name="Deichman Bjørvika", at=(1075261, 5990869), radius=40, build="parts", facade="glass", colour="#d9d6cf", osm=True),
    dict(id="barcode", name="Barcode", at=(1076000, 5990790), radius=170, build="parts", facade="barcode", min_height=40),
    dict(id="plaza", name="Radisson Blu Plaza", at=(1075596, 5991242), radius=20, build="parts", facade="glass", colour="#5a81a0", osm=True),
    dict(id="posthuset", name="Posthuset", at=(1075440, 5991155), radius=32, build="parts", facade="tower", colour="#dedad3", min_height=90, osm=True),
    dict(id="radhus", name="Oslo City Hall", at=(1073365, 5991205), radius=45, build="parts", facade="brick", colour="#8f3a30", min_height=20, extras="clocks", osm=True),
    dict(id="slottet", name="Royal Palace", at=(1072745, 5991714), radius=70, build="parts", facade="classic", colour="#f3e7c0", extras="portico", osm=True),
    dict(id="akershus", name="Akershus Castle", at=(1073630, 5990668), radius=42, build="parts", facade="castle", colour="#d8d0bf", extras="castle-roofs", osm=True),
    dict(id="stortinget", name="Stortinget", at=(1074012, 5991300), radius=40, build="parts", facade="classic", colour="#d9b46a", osm=True),
    dict(id="domkirke", name="Oslo Cathedral", at=(1074690, 5991256), radius=35, build="parts", facade="brick", colour="#a0874e", extras="spire", osm=True),
    dict(id="nationaltheatret", name="Nationaltheatret", at=(1073425, 5991437), radius=38, build="parts", facade="classic", colour="#ecd9a8", osm=True),
    dict(id="nasjonalmuseet", name="Nasjonalmuseet", at=(1072907, 5991162), radius=55, build="parts", facade="slate", colour="#5f5c5a", min_height=20, extras="light-hall", osm=True),
    dict(id="astrup", name="Astrup Fearnley Museet", at=(1072170, 5990715), radius=42, build="model", frame="all", max_height=21),
    dict(id="fram", name="Frammuseet", at=(1069955, 5990336), radius=30, build="model", frame="parts"),
    dict(id="monolitten", name="Monolitten, Vigelandsparken", at=(1069890, 5992767), radius=0, build="model"),
]


OVERPASS = "https://overpass-api.de/api/interpreter"
CACHE = ROOT / ".cache" / "overpass"


def overpass(site):
    """Buildings and building parts around a site, with tags and geometry (cached)."""
    path = CACHE / f"{site['id']}.json"
    if not path.exists():
        lat, lon, r = site["at"][1] / 1e5, site["at"][0] / 1e5, max(site["radius"], 30) + 20
        q = (f'[out:json][timeout:60];(way(around:{r},{lat},{lon})["building:part"];relation(around:{r},{lat},{lon})["building:part"];'
             f'way(around:{r},{lat},{lon})["building"];relation(around:{r},{lat},{lon})["building"];);out tags geom;')
        body = None
        for attempt, endpoint in enumerate([OVERPASS, OVERPASS, "https://overpass.kumi.systems/api/interpreter", OVERPASS, "https://overpass.private.coffee/api/interpreter"]):
            req = urllib.request.Request(endpoint, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "grocery-bot-map-preview/1.0", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=120) as r_:
                    body = r_.read()
                json.loads(body)
                break
            except Exception as error:            # Overpass is often busy: back off and try again / elsewhere
                print(f"  overpass {site['id']}: {error}; retrying")
                body = None
                time.sleep(10 * (attempt + 1))
        if body is None:
            raise SystemExit(f"Overpass unavailable for {site['id']}")
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        time.sleep(2)
    return json.loads(path.read_text())


def metres(value):
    if value is None:
        return None
    m = re.match(r"\s*(-?[0-9.]+)", str(value).replace(",", "."))
    return float(m.group(1)) if m else None


COMPASS = {"N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5, "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5, "S": 180,
           "SSW": 202.5, "SW": 225, "WSW": 247.5, "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5}


def osm_parts(site, frame_area, tile_parts=()):
    """OSM building parts of a site as [{rings, min, max, roof, colour, ...}], or None when OSM has none."""
    data = overpass(site)
    c = Point(*site["at"])
    elements = []
    for e in data["elements"]:
        t = e.get("tags", {})
        if e["type"] == "way" and "geometry" in e:
            rings = [[(p["lon"] * 1e5, p["lat"] * 1e5) for p in e["geometry"]]]
            holes = []
        elif e["type"] == "relation":
            rings = [[(p["lon"] * 1e5, p["lat"] * 1e5) for p in m.get("geometry", [])] for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            holes = [[(p["lon"] * 1e5, p["lat"] * 1e5) for p in m.get("geometry", [])] for m in e.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
        else:
            continue
        for outer in rings:
            if len(outer) < 4:
                continue
            g = Polygon(outer, [h for h in holes if Polygon(outer).buffer(0).contains(Polygon(h).buffer(0).representative_point())]).buffer(0)
            if g.is_empty or g.geom_type != "Polygon":
                continue
            elements.append((g, t))
    parts = [(g, t) for g, t in elements if "building:part" in t and t["building:part"] != "no"]
    near = lambda g: math.hypot((g.centroid.x - c.x) * SQ, g.centroid.y - c.y) / METRE < site["radius"]
    parts = [(g, t) for g, t in parts if near(g)]
    if not parts:
        return None
    covered = unary_union([g for g, _ in parts]).buffer(1)
    # a building inside the site that its parts do not cover is a part of its own
    for g, t in elements:
        if "building" in t and "building:part" not in t and near(g) and g.intersection(covered).area < g.area * .5 and g.area * SQ / METRE ** 2 > 20:
            parts.append((g, t))
    # parts that all start above the ground (the Royal Palace's upper floors): the building outline
    # below them is the ground floor
    floors = [metres(t.get("min_height")) or 0 for _, t in parts if "building:part" in t]
    if floors and min(floors) > 0:
        for g, t in elements:
            if "building" in t and "building:part" not in t and near(g) and g.intersects(covered):
                parts.append((g, {**t, "height": str(min(floors)), "roof:shape": "flat", "base": "yes"}))
    base_added = any(t.get("base") for _, t in parts)
    out = []
    if floors and min(floors) > 0 and not base_added:      # no outline in OSM: the tiles' ground floor
        out += [q for q in tile_parts if q["min"] == 0]
    for g, t in parts:
        levels, min_level = metres(t.get("building:levels")), metres(t.get("building:min_level"))
        roof_h = metres(t.get("roof:height"))
        if roof_h is None and metres(t.get("roof:levels")):
            roof_h = metres(t.get("roof:levels")) * 3
        top = metres(t.get("height")) or ((levels or 0) * 3 + (roof_h or 0) if levels else None)
        floor = metres(t.get("min_height")) or ((min_level or 0) * 3 if min_level else 0)
        shape = t.get("roof:shape", "flat")
        if top is None:
            top = 1 if t.get("building:part") and not levels else 10
        direction = t.get("roof:direction")
        direction = COMPASS.get(direction.upper(), None) if direction and not re.match(r"^-?[0-9.]+$", direction) else metres(direction)
        roof = {"shape": shape}
        if roof_h is not None: roof["height"] = roof_h
        if direction is not None: roof["direction"] = direction
        if t.get("roof:orientation"): roof["orientation"] = t["roof:orientation"]
        poly = g.simplify(0.15)
        if poly.geom_type != "Polygon" or poly.is_empty:
            continue
        rings_ = [ring(poly.exterior.coords)] + [ring(h.coords) for h in poly.interiors]
        if len(rings_[0]) < 6:
            continue
        part = {"rings": rings_, "min": floor, "max": top, "roof": roof, "osm": t.get("name") or ""}
        for key, name in (("building:colour", "colour"), ("roof:colour", "roofColour"), ("building:material", "material"), ("roof:material", "roofMaterial")):
            if t.get(key): part[name] = t[key]
        out.append(part)
    return out


def coordinate(tx, ty, px, py, extent):
    return ((tx + px / extent) / N * 360 - 180) * 1e5, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / extent) / N)))) * 1e5


def tile(tx, ty):
    path = TILES / f"{Z}-{tx}-{ty}.pbf"
    if not path.exists():
        TILES.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(TEMPLATE.format(z=Z, x=tx, y=ty), timeout=60) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def tile_of(lon, lat):
    lon, lat = lon / 1e5, lat / 1e5
    return int((lon + 180) / 360 * N), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * N)


def building_features():
    """Every building and building part in the tiles around the sites, joined across tile edges."""
    tiles = set()
    for s in SITES:
        r = max(s["radius"], 50) * METRE
        for lon in (s["at"][0] - r / SQ, s["at"][0] + r / SQ):
            for lat in (s["at"][1] - r, s["at"][1] + r):
                tiles.add(tile_of(lon, lat))
    pieces = {}
    for tx, ty in sorted(tiles):
        layer = mapbox_vector_tile.decode(tile(tx, ty), default_options={"y_coord_down": True}).get("building", {})
        extent = layer.get("extent", 4096)
        own = box(0, 0, extent, extent)          # drop the tile's buffer: the neighbour tile has that piece
        for f in layer.get("features", []):
            g = shape(f["geometry"])
            g = (g if g.is_valid else make_valid(g)).intersection(own)
            if g.is_empty or g.area == 0:
                continue
            g = transform(lambda xs, ys, z=None: tuple(zip(*[coordinate(tx, ty, x, y, extent) for x, y in zip(xs, ys)])), g)
            key = f.get("id") or (tx, ty, len(pieces))
            entry = pieces.setdefault(key, {"props": f["properties"], "geoms": []})
            entry["geoms"].append(g)
    # At z14 OpenMapTiles merges buildings that share a height into one multipolygon feature, so
    # after joining the tile pieces, every separate polygon is its own building (part).
    out = []
    for entry in pieces.values():
        g = unary_union(entry["geoms"]).buffer(0)
        for poly in polygons(g):
            if poly.area > 0:
                out.append((poly, entry["props"]))
    return out


def polygons(g):
    if g.geom_type == "Polygon":
        return [g]
    return [p for part in getattr(g, "geoms", []) for p in polygons(part)]


def ring(coords):
    pts = [(round(x), round(y)) for x, y in coords]
    flat, last = [], None
    for p in pts[:-1] if pts[0] == pts[-1] else pts:
        if p != last:
            flat += list(p)
            last = p
    return flat


def frame(g):
    """Centre, long-axis angle (degrees, from east towards north), length and width in metres."""
    r = g.minimum_rotated_rectangle
    c = list(r.exterior.coords)
    edges = [((c[i + 1][0] - c[i][0]) * SQ, c[i + 1][1] - c[i][1]) for i in range(2)]
    lengths = [math.hypot(*e) / METRE for e in edges]
    k = 0 if lengths[0] >= lengths[1] else 1
    return {"center": [round(g.centroid.x), round(g.centroid.y)], "angle": round(math.degrees(math.atan2(edges[k][1], edges[k][0])), 1),
            "length": round(lengths[k], 1), "width": round(lengths[1 - k], 1)}


def main():
    features = building_features()
    tree = STRtree([g for g, _ in features])
    extra = json.loads((DATA / "buildings.json").read_text())
    footprints = [Polygon([(b[i], b[i + 1]) for i in range(1, len(b) - 1, 2)]) for b in extra["buildings"]]
    footprints = [p if p.is_valid else make_valid(p) for p in footprints]
    shapes = STRtree(footprints)
    sites, dropped = [], set()
    metres = lambda a, b: math.hypot((a.x - b.x) * SQ, a.y - b.y) / METRE
    for s in SITES:
        c = Point(*s["at"])
        reach = s["radius"] * METRE / SQ
        mine = [(g, p) for j in tree.query(c.buffer(reach)) for g, p in [features[j]]
                if s["radius"] and metres(g.centroid, c) < s["radius"] and g.area * SQ / METRE ** 2 > 4
                and float(p.get("render_height") or 0) <= s.get("max_height", 1e9)]
        parts, used = [], []
        for g, p in mine:
            if p.get("hide_3d"):
                continue                       # an outline whose parts are drawn instead
            top, floor = float(p.get("render_height") or 0), float(p.get("render_min_height") or 0)
            if top <= floor or top < s.get("min_height", 0):
                continue
            used.append(g)
            for poly in polygons(g.simplify(0.25)):
                rings = [ring(poly.exterior.coords)] + [ring(h.coords) for h in poly.interiors]
                if len(rings[0]) >= 6:
                    parts.append({"rings": rings, "min": floor, "max": top, "colour": p.get("colour")})
        # the footprint a hand model is fitted to: the building's outline, its tallest part, its
        # parts, or everything picked at the site
        outlines = [g for g, p in mine if p.get("hide_3d")]
        how = s.get("frame", "parts")
        if how == "outline" and outlines:
            area = max(outlines, key=lambda g: g.area)
        elif how == "tallest" and mine:
            area = max(mine, key=lambda q: float(q[1].get("render_height") or 0))[0]
        elif how == "all" and mine:
            area = unary_union([g for g, _ in mine])
        else:
            area = unary_union(used) if used else c.buffer(6 * METRE)
        site = {k: s[k] for k in ("id", "name", "build") if k in s}
        site.update({k: s[k] for k in ("facade", "colour", "extras") if k in s})
        site["frame"] = frame(area) if s["radius"] else {"center": list(s["at"]), "angle": 0, "length": 0, "width": 0}
        if s.get("osm"):
            real = osm_parts(s, area, parts)
            if real:
                parts = real
                used = used + [Polygon([(q["rings"][0][i], q["rings"][0][i + 1]) for i in range(0, len(q["rings"][0]), 2)]).buffer(0) for q in real]
        site["parts"] = sorted(parts, key=lambda q: (q["min"], -q["max"]))
        if s["build"] == "model":
            site["outline"] = [ring(p.exterior.coords) for p in polygons(area)]
        # background footprints replaced: a third or more of the footprint under what the landmark
        # draws (+3 m); a hand model also replaces whatever stands inside its own outlines
        drawn = unary_union(used + ([area] if s["build"] == "model" else []) + [g for g in outlines if any(g.intersects(u) for u in used)])
        clear = (drawn if not drawn.is_empty else c.buffer(1)).buffer(3 * METRE)
        drop = sorted(int(i) for i in shapes.query(clear)
                      if footprints[i].area > 0 and footprints[i].intersection(clear).area >= footprints[i].area / 3)
        site["replaces"] = drop
        dropped.update(drop)
        sites.append(site)
        f = site["frame"]
        print(f"{s['id']:16} {len(parts):3} parts, max {max([q['max'] for q in parts] or [0]):5.1f} m, "
              f"frame {f['length']:.0f} x {f['width']:.0f} m @ {f['angle']}°, replaces {len(drop)} footprints")
    source = hashlib.sha256((DATA / "buildings.json").read_bytes() + (DATA / "layout.json").read_bytes() + Path(__file__).read_bytes()).hexdigest()[:16]
    (DATA / "landmarks.json").write_text(json.dumps({"format": "grocery-bot-landmarks/1", "source": source,
        "attribution": "OpenStreetMap contributors (ODbL), OpenFreeMap / OpenMapTiles", "sites": sites}, separators=(",", ":")))
    print(f"landmarks.json: {len(sites)} sites, {len(dropped)} background footprints replaced")


if __name__ == "__main__":
    main()
