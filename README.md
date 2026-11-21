# Grocery Bot — expanded Oslo

A larger Oslo board in 2D and 3D, built following [OTHER-CITIES.md](OTHER-CITIES.md).
The default view is 3D; use the 2D / 3D buttons or press V to switch.
Playback opens at tick 120 with deliveries in motion; scrub back or use `?t=0` for the start.

- Approximately **3.9 × 4.3 km**, about **47% more area** than the original Oslo play area.
  The road network is rebuilt over a larger geographic area, not stretched into the old grid.
- **12 AI competitors**, each with a separate shop, **60 trucks** and **240 shop robots**.
  Four Rush AI instances compete with eight reference AIs in a seeded, real-engine match.
- **160 real Kartverket delivery addresses**, OpenStreetMap streets, buildings, parks and water,
  and Mapzen Terrarium elevation. Akerselva flows toward the fjord; the fjord is still.
- **11,819 building footprints**, with 157/160 homes matched to mapped buildings.
  Background wall jogs under approximately 1.5 m are simplified at load time to keep
  building geometry under the 650k-vertex budget; delivery-home outlines stay intact.
  Elevation spans **0–120 m**, sampled on a **439 × 487** terrain grid.
- Replay controls, standings, clickable shops and order cards. Click a standings row to
  focus that fleet and open its shop. The recording is an offline AI match, not a live server.
- Twelve distinct player colours; standings scroll to accommodate every competitor.

## Run locally

```sh
python3 -m http.server 8138
# http://localhost:8138/ (3D) or http://localhost:8138/?view=2d
python3 tools/check_preview.py
```

## Rebuild

Requires Python, Pillow, Node.js, a multi-town Oslo game checkout, a checkout with
`engine/feed.py` (and `engine/match_stats.py` if required), and `rush-ai`.

```sh
python3 tools/prepare_oslo.py /path/to/oslo/prototypes/town-rush /path/to/feed/prototypes/town-rush
python3 tools/simulate_match.py .cache/town-rush /path/to/rush-ai data 7
python3 tools/build_city.py buildings --osm .cache/osm-buildings.json
python3 tools/build_city.py terrain
python3 tools/check_preview.py
```

`prepare_oslo.py` copies the engine and build tools into `.cache/town-rush`, then
raises the player/shop limit to 12 **only in that isolated offline copy**. It never
changes the source checkout or live game. It uses the saved Oslo road, address and
water/green snapshots; buildings and terrain are fetched once and cached.
The expanded engine graph and configuration are preserved as `data/map.json` and
`data/town.json`. The 160 customer addresses are selected deterministically with
spacing and shop clearance; no postal addresses are invented.

Based on [grocery-bot-3d-hills-preview](https://github.com/BusinessManBab/grocery-bot-3d-hills-preview).
Map/building data © OpenStreetMap contributors (ODbL); addresses © Kartverket
(CC BY 4.0); elevation: Mapzen Terrarium tiles (AWS Open Data).
