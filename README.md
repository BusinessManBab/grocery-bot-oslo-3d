# Grocery Bot — expanded Oslo

A larger Oslo world in 2D and 3D, built following [OTHER-CITIES.md](OTHER-CITIES.md).
The default view is 3D; use the 2D / 3D buttons or press V to switch.
Playback opens at tick 120 with deliveries in motion; scrub back or use `?t=0` for the start.

- Approximately **9.5 × 8.9 km / 85 km²**, **five times the previous preview's area**.
  Real scenery extends from Bygdøy and Skøyen through Frogner, Majorstuen and Ullevål
  to Bjerke, Helsfyr, Vålerenga and Ekeberg. Coordinates are not stretched.
- **Start inside the city**, not with the entire board shrunk to fit. Pan, wheel/pinch
  to zoom, right-drag to orbit, use the district picker to fly across Oslo, or choose
  **Full city** for the complete extent. **⌂** returns to the shop-layout view.
- **12 AI competitors**, each with a separate shop, **60 trucks** and **240 shop robots**.
  Four Rush AI instances compete with eight reference AIs in a seeded, real-engine match.
- **Twelve real, named grocery stores**, with at least **1.54 km separation**
  and **8 km** between the furthest pair: Skøyen, Bygdøy, Frogner, Majorstuen,
  Ullevål, Sagene, Bjerke, Helsfyr, Vålerenga, Ekeberg, Bjørvika and Grünerløkka.
- **398 delivery homes**: 160 real Kartverket addresses plus 238 explicitly labelled
  delivery-building points on real footprints near the shops. These new building
  points are not presented as verified postal addresses. OpenStreetMap streets, parks and water,
  and Mapzen Terrarium elevation. Akerselva flows toward the fjord; the fjord is still.
- Real building footprints, with 395/398 delivery homes matched to mapped buildings.
  Background wall jogs under approximately 1.5–2.5 m are simplified at load time.
  **The default version preloads every building's complete walls and roof**, in one
  permanent indexed context mesh. No distance-based wall hiding, chunk loading or
  geometry swapping occurs while moving the camera. The twelve shop buildings use
  their mapped footprints with player-coloured roofs, not oversized generic stores.
  There are approximately **54,800 buildings** in total. Real elevation
  now spans **0–377 m**, on a **711 × 668** height grid.
- **Cartoon buildings from the hills guide:** pitched roofs, chimneys, doors, apartment
  balconies, shop sign bands, industrial corrugation, garage doors, and a church spire.
  Styles come from OSM building types where available and a deterministic size/height
  guess otherwise. Windows/cladding use one repeating facade texture per style.
- **The reference forest system:** OSM woodland plus empty land away from buildings,
  painted green under the trees in 2D, with spruce and birch instanced meshes in 3D.
  Open fields, built-up land, parks, roads, water and shop plazas stay clear.
  The dense-city raster exclusion masks avoid polygon-by-polygon tree checks.
- Replay controls, standings, clickable shops and order cards. Click a standings row to
  focus that fleet and open its shop. The recording is an offline AI match, not a live server.
  The full-building version starts map-first on phones; tap a shop/player to open its interior.
- Inside the shop window: the four v1-style departments (Dairy fridges, Pantry shelves,
  Produce bins, Bakery racks), one sign each, and each player's own map trucks with
  look-specific cab/carriage roofs. Order cards group items by department in walking order.
- The expanded outer neighbourhoods are **part of the actual match**. A new replay
  is simulated on the wider connected graph with all twelve distributed shops.
  Map, truck routes, customer homes and shop recordings are regenerated together.
- Twelve distinct player colours; standings scroll to accommodate every competitor.

## Full-building rendering

- Every building's complete geometry remains resident and visible. There is no distance-based wall hiding, chunk swapping or detail pop-in.
The full version uses indexed faces, one context-building draw call, a single
vertex-coloured delivery-building mesh, shared materials, material-batched truck
meshes, cached static shadows and a capped pixel ratio.
Moving trucks do not trigger a city-wide shadow redraw. Building geometry stays the
same regardless of zoom, district or camera direction. The one-time initial load is
explicitly labelled. Browser residency is checked when run; software-WebGL timing is not a hardware-GPU 60-fps certification.

## Actual grocery locations

POI names, coordinates and footprints come from the pinned OpenFreeMap/OpenMapTiles
OpenStreetMap snapshot. They are mapped store locations, not a live business directory.
The exact POI identifiers and source URL are preserved in `data/layout.json`.

| District | Grocery store |
|---|---|
| Skøyen | Bunnpris Skøyen Atrium |
| Bygdøy | Matkroken Huk |
| Frogner | Extra Gimle |
| Majorstuen | Kiwi Ringhuset |
| Ullevål | Coop Mega Ullevål |
| Sagene | Rema 1000 Mogata |
| Bjerke | Kiwi Bjerke |
| Helsfyr / Ulven | Kiwi Ulven |
| Vålerenga / Etterstad | Rema 1000 Etterstad |
| Ekeberg / Holtet | Joker Holtet |
| Bjørvika | Joker Barcode |
| Grünerløkka / Rodeløkka | Kiwi Rodeløkka |

## Run locally

```sh
python3 -m http.server 8138
# http://localhost:8138/ (3D) or http://localhost:8138/?view=2d
python3 tools/check_preview.py
```

## Rebuild

Requires Python, Pillow, mapbox-vector-tile, Node.js, a multi-town Oslo game checkout, a checkout with
`engine/feed.py` (and `engine/match_stats.py` if required), and `rush-ai`.

```sh
python3 tools/prepare_oslo.py /path/to/oslo/prototypes/town-rush /path/to/feed/prototypes/town-rush
python3 -m venv .cache/build-venv
.cache/build-venv/bin/pip install mapbox-vector-tile pillow
.cache/build-venv/bin/python tools/expand_oslo.py
python3 tools/build_city.py terrain --step 12
.cache/build-venv/bin/python tools/spread_shops.py
.cache/build-venv/bin/python tools/use_real_shops.py
python3 tools/record_city.py .cache/town-rush /path/to/rush-ai 8
python3 tools/check_preview.py
```

`prepare_oslo.py` copies the engine and build tools into `.cache/town-rush`, then
raises the player/shop limit to 12 **only in that isolated offline copy**. It never
changes the source checkout or live game. It uses the saved Oslo road, address and
water/green snapshots; buildings and terrain are fetched once and cached.
The expanded engine graph and configuration are preserved as `data/map.json` and
`data/town.json`. The 160 customer addresses are selected deterministically with
spacing and shop clearance; no postal addresses are invented.

`expand_oslo.py` caches wide-area road, land-cover, water and building vector tiles
from a pinned OpenFreeMap / OpenMapTiles snapshot (derived from OpenStreetMap).
`add_landcover_open.py` adds built-up/field masks used by the forest exclusion rule.
`build_city.py buildings` now also records each building's OSM type and roof/colour
metadata. `build_city.py landcover` is available for Overpass-based rebuilds.
The underlying tile snapshot URL and downloaded tiles stay cached and offline.

`spread_shops.py` freezes the cached full-city road geometry into a connected,
directed graph, retaining mapped one-way directions and separating junction
noding by grade. Shops are snapped to connected roads with customer clearance
and minimum separation. Road speeds use road-class fallbacks; this offline preview
graph does not claim mapped speed limits, traffic controls or turn restrictions.
The shop layout and measured separation are saved in `data/layout.json`.
`use_real_shops.py` selects nearby mapped grocery POIs while preserving wide
separation and the completed road graph. `build_direct_table.py` freezes exact
per-shop delivery times/distances, so the 12-shop city can initialize without
holding twelve full 50k-node Dijkstra dictionaries at once. Delivery meshes overlapping a real store
are removed (two in this snapshot). `simulate_match.py` checkpoints every 100 ticks
by map hash and bounds/shares pathfinding caches to keep wider-map recording manageable.
`record_city.py` also saves resumable short worker segments for constrained hosts.
Free-flow trees retain exact float64 values in compact arrays, without changing
either AI's speed model or the engine rules.
Based on [grocery-bot-3d-hills-preview](https://github.com/BusinessManBab/grocery-bot-3d-hills-preview).
Map/building data © OpenStreetMap contributors (ODbL); addresses © Kartverket
(CC BY 4.0); outer-city vector data: OpenFreeMap / OpenMapTiles;
elevation: Mapzen Terrarium tiles (AWS Open Data).
