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
- **Every player shop is a real MENY store** (OpenStreetMap, NorgesGruppen's MENY chain): the
  twelve MENY stores on the map that have delivery homes around them. The other four MENY on the
  map (Bryn, Manglerud, Vollebekk, Gressbanen) lie where no delivery homes are; other NorgesGruppen
  stores (KIWI, Joker, SPAR, Nærbutikken) would only be used if MENY could not fill the seats.
  Each original store building is removed and replaced by the compact Grocery Bot v2 shop
  used in Grimstad: cream walls, player-colour band and striped awning, windows and Grocery Bot sign.
- **397 delivery homes**: 160 real Kartverket addresses plus 237 explicitly labelled
  delivery-building points on real footprints near the shops. These new building
  points are not presented as verified postal addresses. OpenStreetMap streets, parks and water,
  and Mapzen Terrarium elevation. Akerselva flows toward the fjord; the fjord is still.
- Real building footprints, with nearly all 397 delivery homes matched to mapped buildings.
  Background wall jogs under approximately 1.5–2.5 m are simplified once, when the
  buildings are baked (`tools/bake_buildings.mjs`).
  **Every building's complete walls and roof are built and stay resident**: they stream in
  nearest-first while the page opens and are all in place within seconds. No distance-based
  wall hiding, level of detail or geometry swapping happens while moving the camera.
  The twelve shops use the same player-coloured v2 model, fitted individually to free space
  at 20–46 m wide rather than stretching to a mall outline. Their complete footprints,
  including awnings, stay at least 3 m from rendered roads and neighbouring buildings.
  `tools/fit_shop_sites.py` generates and checks `data/shop-placement.json` offline.
  There are about **54,200 background buildings** plus the
  delivery homes. Real elevation now spans **0–377 m**, on a **711 × 668** height grid.
- **Oslo's landmarks, true to life** (`src/landmarks.js`, data from `tools/bake_landmarks.py`).
  The plain building data missed or flattened Oslo's famous buildings (OpenStreetMap maps them
  as multi-part buildings, and heights were capped at 40 m). The most famous ones are shaped
  from photos and the orthophoto and lightly detailed:
  the **Opera House** (flat marble plaza at the water, the ramp rising from the fjord, the north
  wing over its long glass facade, the glazed foyer under a knife-thin roof edge, white stage
  towers, the aluminium workshops), the **City Hall** (brown brick towers, east 66 m with the
  clock, west 63 m with the mast), the **Royal Palace** (cream walls, zinc roofs, the portico
  facing Karl Johans gate), **Akershus Castle** (pale plaster on the rock, red-brown tile roofs,
  two copper spires), **MUNCH** (bending over at 37 m) and the **Vigeland Monolith**. The other
  well-known buildings get their correct shape from their OSM parts, heights and colours,
  without extra detail: Stortinget, the cathedral, Nationaltheatret, Nasjonalmuseet (light hall
  on top), Deichman, Barcode, the Plaza and Posthuset towers, Astrup Fearnley, the Fram Museum.
  A delivery address inside a landmark (the Opera and the City Hall are addresses in the match)
  is drawn by the landmark, with its order pin above the roof.
- **No trees inside houses:** every tree whose crown would stand in or against a building,
  delivery home or landmark is removed when baking (`tools/tree_clearance.mjs`).
- **Nothing floats on the fjord:** buildings standing mostly on the water the map draws
  (houseboats, pier kiosks, boathouses whose decks are not drawn) are left out when baking.
  Islands and filled-in harbours are land, so the cabins on Lindøya, Nakholmen and Bleikøya
  and Tjuvholmen's buildings stay. One delivery address on the City Hall pier remains, because
  it is part of the recorded match.
- **Trucks a third smaller**, so they keep to the streets instead of clipping the houses.
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

## Loading and rendering

The earlier version built all 54k buildings and 5 million road vertices on the page's main
thread from an 8.8 MB JSON file. That froze the page for 30 s on a desktop and about two minutes
on a 4× slower CPU, and peaked at ~1.4 GB, which is why it crashed on phones. Now:

- **Baked data.** `data/buildings.bin` (0.76 MB over the wire instead of 1.8 MB, no JSON parsing)
  holds the footprints already simplified, without the shop stores and sorted into a 6 × 6 grid
  of chunks. `data/trees.bin` (0.2 MB) holds the 22k forest and 6k park trees, which used to be
  planted at every visit by rasterizing every road and footprint.
- **Built in workers, nearest first.** Up to four module workers (`src/world-worker.js`) build
  the roads and then the building chunks closest to the camera, and hand back quantized,
  indexed typed arrays (20 bytes per vertex instead of 44; int16 positions per chunk, int8
  normals, uint8 colours). The page puts them straight on the GPU and drops its own copy.
  Browsers without module workers build on the page, one chunk between frames.
- **Fewer vertices, fewer draw calls.** Indexed faces and shared roof corners: 3.2M building
  vertices instead of 4.7M. Road ribbons get mitred joins and are split only where the ground
  needs it: 0.8M vertices instead of 4.9M. The delivery homes are one mesh per material
  (instead of three draw calls per home), and each player's five trucks are instanced.
- **Nothing stalls a frame.** Setup runs in short steps; shaders are compiled up front (in
  parallel where the browser supports it), including those of chunks still being built. The
  shadow map is redrawn at most twice a second while the camera moves, and at once when it rests.
- **A lighter tier for phones and small machines** (`?quality=low|high` to force): no shadows,
  a 2048 px ground texture, no MSAA, at most 1.25× resolution. A machine on the full tier that
  still cannot hold ~25 fps once the city is in steps down to it by itself.
- Every chunk stays resident once built; chunks off screen are skipped by GPU frustum culling,
  never hidden or swapped. The label at the bottom left counts the buildings in as they arrive.

Measured with `tools/load_benchmark.cjs` (headless Chrome on a GTX 1660 SUPER, same machine and
replay for both; "4× CPU" is Chrome's CPU throttling, "phone" a 390 × 844 @3× touch viewport):

| | Before (v17) | Now (v18) |
|---|---|---|
| 3D view on screen, desktop | 31.3 s | 2.9 s |
| Every building resident, desktop | 31.3 s | 3.0 s |
| Every building resident, desktop at 4× CPU | 124.5 s | 6.3 s |
| Every building resident, phone at 4× CPU | 122.8 s | 6.6 s |
| Longest frozen stretch of the page, desktop / 4× CPU | 28.7 s / 119 s | 0.5 s / 1.4 s |
| Peak memory, renderer + GPU process (all runs) | 1.35–1.41 GB | 0.77–0.86 GB |
| Frame rate at 4× CPU (start view, street level) | 10 / 20 fps | 30 / 60 fps |

The 3D view itself is checked with `tools/browser_check.cjs` and `tools/full_building_probe.cjs`.

## Player shops: MENY stores

Store names, positions and buildings come from OpenStreetMap (Overpass API, cached in
`.cache/overpass/`; buildings the scenery snapshot lacks are taken from OSM too). They are mapped
store locations, not a live business directory. `tools/use_real_shops.py` picks them.

| Seat area | MENY store |
|---|---|
| Skøyen | Meny Skøyen |
| Frogner | Meny Frogner |
| Vika | Meny Vika |
| Colosseum | Meny Colosseum |
| Bjølsen | Meny Bjølsen |
| Ringnes park | Meny Ringnes park |
| Løren | Meny Løren |
| Lillo Gård | Meny Lillo Gård |
| Grønland | Meny Grønland |
| Bjørvika | Meny Bjørvika |
| Oslo City | Meny Oslo City |
| Bogstadveien | Meny Bogstadveien |

## Run locally

```sh
python3 -m http.server 8138
# http://localhost:8138/ (3D) or http://localhost:8138/?view=2d
python3 tools/check_preview.py
# load time, memory and frame rate, on a machine with a GPU (see the script's header):
PLAYWRIGHT_MODULE=/path/to/playwright node tools/load_benchmark.cjs http://localhost:8138/ new --throttle 4 --phone
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
.cache/build-venv/bin/python tools/bake_landmarks.py              # data/landmarks.json
node tools/bake_buildings.mjs                                     # data/buildings.bin + homes.json
PLAYWRIGHT_MODULE=/path/to/playwright node tools/bake_trees.cjs   # data/trees.bin (then cleared of buildings)
node tools/tree_clearance.mjs                                     # re-clear trees after changing buildings/landmarks
python3 tools/check_preview.py                                    # also fails if a bake is stale
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
