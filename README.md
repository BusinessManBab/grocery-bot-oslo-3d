# Grocery Bot — expanded Oslo

A larger Oslo world in 2D and 3D, built following [OTHER-CITIES.md](OTHER-CITIES.md).
The default view is 3D; use the 2D / 3D buttons or press V to switch.
Playback opens at tick 120 with deliveries in motion; scrub back or use `?t=0` for the start.

- Approximately **9.5 × 8.9 km / 85 km²**, **five times the previous preview's area**.
  Real scenery extends from Bygdøy and Skøyen through Frogner, Majorstuen and Ullevål
  to Bjerke, Helsfyr, Vålerenga and Ekeberg. Coordinates are not stretched.
- **Start inside the city**, not with the entire board shrunk to fit. Pan, wheel/pinch
  to zoom, right-drag to orbit, use the district picker to fly across Oslo, or choose
  **Full city** for the complete extent. **⌂** returns to the central AI match.
- **12 AI competitors**, each with a separate shop, **60 trucks** and **240 shop robots**.
  Four Rush AI instances compete with eight reference AIs in a seeded, real-engine match.
- **160 real Kartverket delivery addresses**, OpenStreetMap streets, buildings, parks and water,
  and Mapzen Terrarium elevation. Akerselva flows toward the fjord; the fjord is still.
- Real building footprints, with 157/160 delivery homes matched to mapped buildings.
  Background wall jogs under approximately 1.5–2.5 m are simplified at load time.
  Neighbourhood-sized building chunks retain distant roof silhouettes and reveal
  local wall geometry as you explore, within an active-geometry budget.
  There are **54,642 context footprints** plus the 160 delivery homes. Real elevation
  now spans **0–377 m**, on a **711 × 668** height grid.
- **The same low-poly tree models as the hills reference:** round park crowns,
  dark green conical spruce, and lighter birch. Forests are placed only on OSM
  forest/wood polygons; full building footprints, roads, shops and water stay clear.
  Trees use instanced geometry rather than one draw call per tree.
- Replay controls, standings, clickable shops and order cards. Click a standings row to
  focus that fleet and open its shop. The recording is an offline AI match, not a live server.
- The expanded outer neighbourhoods are **exploration scenery around the recorded
  central play area**. The original engine graph, 160 customers and 12-AI match remain
  synchronized; the replay does not pretend that trucks drove newly added roads.
- Twelve distinct player colours; standings scroll to accommodate every competitor.

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
python3 tools/simulate_match.py .cache/town-rush /path/to/rush-ai data 7
python3 -m venv .cache/build-venv
.cache/build-venv/bin/pip install mapbox-vector-tile pillow
.cache/build-venv/bin/python tools/expand_oslo.py
python3 tools/build_city.py terrain --step 12
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
This avoids large-city query timeouts on public Overpass servers.
It preserves every replay road and delivery-home footprint in the central area and
adds contextual roads outside it. `data/landcover.json` identifies mapped woods.
The underlying `.cache/oslo-core-map.json`, `.cache/oslo-core-buildings.json`,
tile snapshot URL and downloaded tiles are kept for repeatable offline rebuilds.

Based on [grocery-bot-3d-hills-preview](https://github.com/BusinessManBab/grocery-bot-3d-hills-preview).
Map/building data © OpenStreetMap contributors (ODbL); addresses © Kartverket
(CC BY 4.0); outer-city vector data: OpenFreeMap / OpenMapTiles;
elevation: Mapzen Terrarium tiles (AWS Open Data).
