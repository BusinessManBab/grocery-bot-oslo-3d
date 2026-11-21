"""Play a 12-seat Oslo Town Rush match with the real engine and export the preview.

    python3 tools/simulate_match.py ENGINE_DIR RUSH_AI_DIR OUT_DIR [seed]

ENGINE_DIR: the isolated multi-town engine prepared by tools/prepare_oslo.py.
Seats: four rush-ai instances (in-process, same interface as the CLI) and eight ReferenceBots.
Outputs:
  game.json   the public feed (engine.feed.from_replay, exactly what /api/games serves) + looks
  shop.json   the shop floor layout, rules, and every order's items/address/timeline
  (game.json also gets meta.you, the seat whose shop opens as "Your shop")
  shop.json   also truckLoads[seat][truck] = [[tick, item indexes, "0110" loaded flags]] whenever
              the items queued on that truck or their loading change
  shop.bin    per tick, per seat: 20 robots x [x, y, action, item1, item2, item3] and
              5 trucks x [items loaded, items needed] for the orders queued on that truck
"""
import json
from array import array
import os
import pickle
import sys
import time
import hashlib
if os.environ.get('SIM_DEBUG_STACK'):
    import faulthandler
    faulthandler.dump_traceback_later(20, repeat=True)

ENGINE, RUSH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SEED = int(sys.argv[4]) if len(sys.argv) > 4 else 7
sys.path.insert(0, ENGINE)
sys.path.insert(1, RUSH)

import engine.simulation as simulation                     # noqa: E402
from engine.bots import ReferenceBot                     # noqa: E402
from engine.feed import Feed                               # noqa: E402
from engine.presentation import snapshot                   # noqa: E402
import engine.presentation as presentation                 # noqa: E402
from engine.network import Network, network, _NETWORKS     # noqa: E402
from engine.simulation import create_match, match_start, observe, step   # noqa: E402
import ai as rush                                          # noqa: E402  (rush-ai/ai.py)
from roadnet import Network as RushNetwork                  # noqa: E402

# This compact preview displays actual truck positions/trails, not predicted
# future route legs. Do not repeatedly plan unused future trips for the feed.
# AI observations and authoritative engine routing are unaffected.
presentation.route_plan = lambda *_args: None


class CompactTree:
    """Lossless float64 free-flow cache, without a Python tuple/dict per road node."""
    def __init__(self, values):
        self.seconds = array('d', [float('inf')]) * len(node_index)
        self.metres = array('d', [float('inf')]) * len(node_index)
        for node, (seconds, metres) in values.items():
            index = node_index[node]
            self.seconds[index], self.metres[index] = seconds, metres

    def get(self, node, default=None):
        index = node_index.get(node)
        if index is None or self.seconds[index] == float('inf'):
            return default
        return self.seconds[index], self.metres[index]

    def __getitem__(self, node):
        value = self.get(node)
        if value is None:
            raise KeyError(node)
        return value


class CompactNetworkMixin:
    def tree(self, start):
        values = super().tree(start)
        if not isinstance(values, CompactTree):
            values = CompactTree(values)
            self.trees[start] = values
        return values

    def route(self, start, goal, seed=0, tick=0, closed=(), free=False, rush=False, traffic=None):
        # Free-flow routes do not depend on seed/tick/traffic. Use one cache key,
        # retaining exactly the same Dijkstra result and tie-breaking.
        if free:
            return super().route(start, goal, 0, 0, closed, True, False, None)
        return super().route(start, goal, seed, tick, closed, free, rush, traffic)


class CompactNetwork(CompactNetworkMixin, Network):
    pass


class CompactRushNetwork(CompactNetworkMixin, RushNetwork):
    pass

LOOKS = {
    'Kale Storm': {'shape': 'box', 'color': 'plum', 'eyes': 'visor', 'carriage': 'canvas', 'head': 'high', 'visor': 'tint', 'decal': 'dots'},
    'Oat Runner': {'shape': 'bean', 'color': 'red', 'eyes': 'dots', 'carriage': 'box', 'head': 'flat', 'visor': 'none', 'decal': 'stripe'},
    'Rush AI': {'shape': 'round', 'color': 'lemon', 'eyes': 'sleepy', 'carriage': 'cooler', 'head': 'nose', 'visor': 'tint', 'decal': 'band'},
    'Cheddar Dash': {'shape': 'bean', 'color': 'oat', 'eyes': 'happy', 'carriage': 'box', 'head': 'nose', 'visor': 'shade', 'decal': 'stripe'},
    'Plum Pusher': {'shape': 'dome', 'color': 'ink', 'eyes': 'wink', 'carriage': 'flatbed', 'head': 'slant', 'visor': 'lights', 'decal': 'plain'},
}
# ids sort into seat (and shop) order
NAMES = ['Kale Storm', 'Oat Runner', 'Rush AI', 'Cheddar Dash', 'Plum Pusher', 'Milk Rocket',
         'Pasta Pilot', 'Yogurt Yeti', 'Turbo Turnip', 'Rye Rider', 'Berry Bolt', 'Fjord Fresh']
COLOURS = ['plum', 'red', 'lemon', 'oat', 'ink', 'milk', 'leaf', 'carrot', 'teal', 'rose', 'indigo', 'cocoa']
for i, name in enumerate(NAMES):
    LOOKS[name] = {**list(LOOKS.values())[i % 5], 'color': COLOURS[i]}
SEATS = [(f'p{i + 1:02}', name, 'rush' if i in (2, 5, 8, 11) else ReferenceBot)
         for i, name in enumerate(NAMES)]
DEPARTMENTS = [
    ('Dairy', 'fridge', 2, ['milk', 'yogurt', 'cream', 'butter', 'cheese', 'eggs', 'juice']),
    ('Pantry', 'shelf', 7, ['pasta', 'rice', 'flour', 'sugar', 'oats', 'cereal']),
    ('Produce', 'bin', 12, ['apples', 'bananas', 'tomatoes', 'carrots', 'onions', 'peppers', 'lettuce']),
    ('Bakery', 'rack', 17, ['bread']),
]
ROWS = [3, 4, 5, 7, 8, 9]          # y 6 is the cross aisle; y 1-2 stay free for the loading bays
_engine_make_shop = simulation.make_shop


def realistic_shop(rules):
    shop = _engine_make_shop(rules)
    w, h = shop['grid']['width'], shop['grid']['height']
    if (w, h) != (23, 12):
        raise SystemExit(f'DEPARTMENTS is drawn for the 23 x 12 shop (5 trucks), not {w} x {h}; update it')
    walls = [cell for cell in shop['grid']['walls']]
    items, departments, fixtures = [], [], {}
    for name, fixture, x, products in DEPARTMENTS:
        wanted = [p for p in products if p in rules['products']]
        if not wanted:
            continue
        cells = [(x, y) for y in ROWS] + [(x + 2, y) for y in ROWS]          # left column, then right
        # same products next to each other: each product gets a run of cells, the first ones one more
        counts = [len(cells) // len(wanted) + (1 if i < len(cells) % len(wanted) else 0) for i in range(len(wanted))]
        run = [p for p, n in zip(wanted, counts) for _ in range(n)]
        for (cx, cy), product in zip(cells, run):
            items.append({'id': f'item_{len(items)}', 'type': product, 'position': [cx, cy]})
            fixtures[f'{cx},{cy}'] = fixture
        walls += [[x + 1, y] for y in ROWS]                                 # the spine between the rows
        departments.append({'name': name, 'x': x, 'y': ROWS[0], 'fixture': fixture})
    missing = set(rules['products']) - {i['type'] for i in items}
    if missing:
        raise SystemExit(f'products without a shelf: {sorted(missing)}; add them to DEPARTMENTS')
    shop['grid']['walls'], shop['items'] = walls, items
    shop['departments'], shop['fixtures'] = departments, fixtures
    return shop


simulation.make_shop = realistic_shop
ACTIONS = {'wait': 0, 'move_up': 1, 'move_down': 1, 'move_left': 1, 'move_right': 1, 'pick_up': 2, 'load': 3, 'drop_off': 3}

state = create_match(seed=SEED, difficulty='medium', players=[{'id': i, 'name': n} for i, n, _ in SEATS],
                     match_id='OSLO-12-AI', town='oslo')
topology = network(state['map'])


def share_topology(net):
    # Nodes/edges/adjacency are immutable and identical for every player. Keep
    # one copy rather than twelve large dictionaries. Policy-specific speed
    # calibration and all mutable caches remain on each network.
    for name in ('nodes', 'edges', 'adj', 'signals', 'crossings', 'stops'):
        setattr(net, name, getattr(topology, name))
    net.data = topology.data


bots = {}
for pid, _, kind in SEATS:
    start = match_start(state, pid)
    bots[pid] = rush.make_bot(start) if kind == 'rush' else kind(start)
    share_topology(bots[pid].net)
products = state['rules']['products']
order_seat = {pid: i for i, (pid, _, _) in enumerate(SEATS)}
frames = bytearray()
history = {}          # order id -> [[tick, status, seat]]
truck_loads = [[[] for _ in range(5)] for _ in SEATS]   # seat -> truck -> [[tick, item indexes, loaded "0101"]] on change


def load_of(truck):
    """The items queued on a docked truck, in order, and which of them robots have loaded."""
    items, done = [], ''
    for oid in truck['queue']:
        order = state['orders'].get(oid)
        if not order:
            continue
        left = list(order['items_delivered'])
        for item in order['items_required']:
            items.append(products.index(item))
            done += '1' if item in left else '0'
            if item in left:
                left.remove(item)
    return items, done


def capture():
    for pid, _, _ in SEATS:
        player = state['players'][pid]
        for bot in player['bots']:
            inv = [products.index(t) + 1 for t in bot['inventory']][:3]
            frames.extend([bot['position'][0], bot['position'][1], ACTIONS.get(bot['last_action'], 0), *(inv + [0] * (3 - len(inv)))])
        for t, truck in enumerate(player['trucks']):
            items, done = load_of(truck)
            log = truck_loads[order_seat[pid]][t]
            if not log or log[-1][1] != items or log[-1][2] != done:
                log.append([state['tick'], items, done])
            queued = [state['orders'][o] for o in truck['queue'] if o in state['orders']]
            loaded = sum(len(o['items_delivered']) for o in queued)
            needed = sum(len(o['items_required']) for o in queued)
            frames.extend([min(255, loaded), min(255, needed)])
    for oid, o in state['orders'].items():
        now = [state['tick'], o['status'], order_seat.get(o['by'], -1)]
        h = history.setdefault(oid, [])
        if not h or h[-1][1:] != now[1:]:
            h.append(now)


def views_of(current):
    shared = {}
    return {pid: snapshot(current, pid, shared) for pid in current['players']}


public_feed = Feed.start(views_of(state), 'OSLO-12-AI')
shop_fingerprint = hashlib.sha256(json.dumps(state['shop'], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
checkpoint = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.cache',
                          f"match-{SEED}-{state['map']['sha256'][:12]}-{shop_fingerprint[:8]}.pickle")
if os.path.exists(checkpoint):
    with open(checkpoint, 'rb') as f:
        saved = pickle.load(f)
    if saved.get('mapHash') == state['map'].get('sha256') and saved.get('shopHash') == shop_fingerprint:
        if saved['bots'] is None:
            saved['bots'] = bots
            print('Reconnecting AI clients against the recovered engine state', flush=True)
        state, bots, public_feed, frames, history, truck_loads = (
            saved[key] for key in ('state', 'bots', 'feed', 'frames', 'history', 'truckLoads'))
        print('Resuming checkpoint at tick', state['tick'], flush=True)
    else:
        capture()
else:
    capture()

# Full-city Dijkstra trees are large. Share the identical immutable free-flow
# results across bots, and bound this performance-only cache. Eviction changes
# neither actions nor engine rules; missing results are recomputed deterministically.
road_trees = {}
node_index = {row[0]: index for index, row in enumerate(state['map']['nodes'])}
if topology.data is not state['map']:
    _NETWORKS.clear()
    topology = network(state['map'])
for bot in bots.values():
    if getattr(bot, 'net', None) is None:
        bot.net = RushNetwork(bot.start['map']) if isinstance(bot, rush.RushBot) else Network(bot.start['map'])
    net = getattr(bot, 'net', None)
    if net is not None:
        is_rush = isinstance(net, RushNetwork)
        net.__class__ = CompactRushNetwork if is_rush else CompactNetwork
        share_topology(net)
        # Caches built during match creation are not strategy state. Drop them
        # once to avoid copying large trees on a constrained build host.
        net.trees.clear()
        net.cache.clear()
        net.slow.clear()
        if is_rush:
            net.trees = road_trees
    if hasattr(bot, 'dist_cache'):
        bot.dist_cache = road_trees
    if hasattr(bot, 'paths'):
        bot.paths.clear()
home_nodes = {p['home'] for p in state['players'].values()}


def trim_caches():
    removable = [key for key in road_trees if key not in home_nodes]
    for key in removable[:max(0, len(road_trees) - 64)]:
        del road_trees[key]
    for bot in bots.values():
        net = getattr(bot, 'net', None)
        if net is not None and len(net.cache) > 1024:
            for key in list(net.cache)[:-1024]:
                del net.cache[key]
        paths = getattr(bot, 'paths', None)
        if paths is not None and len(paths) > 128:
            for key in list(paths)[:-128]:
                del paths[key]


print('stage:before trim', flush=True) if os.environ.get('SIM_MEMORY') else None
trim_caches()


def save_checkpoint():
    runtime = []
    try:
        for bot in bots.values():
            runtime.append((bot, bot.net, getattr(bot, 'dist_cache', None), getattr(bot, 'paths', None)))
            bot.net = None
            if hasattr(bot, 'dist_cache'):
                bot.dist_cache = {}
            if hasattr(bot, 'paths'):
                bot.paths = {}
        with open(checkpoint + '.tmp', 'wb') as f:
            pickle.dump({'mapHash': state['map'].get('sha256'), 'shopHash': shop_fingerprint, 'state': state, 'bots': bots, 'feed': public_feed,
                         'frames': frames, 'history': history, 'truckLoads': truck_loads}, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(checkpoint + '.tmp', checkpoint)
        with open(checkpoint + '.json.tmp', 'w') as progress:
            json.dump({'tick': state['tick'], 'finished': state['finished'], 'mapHash': state['map']['sha256'], 'shopHash': shop_fingerprint}, progress)
        os.replace(checkpoint + '.json.tmp', checkpoint + '.json')
    finally:
        for bot, net, distances, paths in runtime:
            bot.net = net
            if distances is not None:
                bot.dist_cache = distances
            if paths is not None:
                bot.paths = paths


segment_start = state['tick']
while not state['finished']:
    actions = {}
    for pid, bot in bots.items():
        action_started = time.perf_counter()
        try:
            actions[pid] = bot.actions(observe(state, pid))
        except Exception as error:
            raise RuntimeError(f"AI failed at tick {state['tick']}, seat {pid}") from error
        trim_caches()
        if os.environ.get('SIM_TRACE'):
            print('action', state['tick'], pid, round(time.perf_counter() - action_started, 3), flush=True)
    phase_started = time.perf_counter()
    state = step(state, actions)
    stepped = time.perf_counter()
    public_feed.add(views_of(state))
    viewed = time.perf_counter()
    capture()
    if os.environ.get('SIM_TRACE'):
        print('phases', state['tick'], 'step', round(stepped - phase_started, 3),
              'view', round(viewed - stepped, 3), 'capture', round(time.perf_counter() - viewed, 3), flush=True)
    if os.environ.get('SIM_SMOKE_TICKS') and state['tick'] >= int(os.environ['SIM_SMOKE_TICKS']):
        print('Smoke run completed at tick', state['tick'], 'without writing preview data', flush=True)
        sys.exit(0)
    if state['tick'] % 100 == 0:
        print('tick', state['tick'], {p['name']: p['score'] for p in state['players'].values()}, flush=True)
        save_checkpoint()
    if os.environ.get('SIM_RUN_TICKS') and state['tick'] - segment_start >= int(os.environ['SIM_RUN_TICKS']) and not state['finished']:
        save_checkpoint()
        print('Segment saved at tick', state['tick'], flush=True)
        # All output files are closed. Avoid walking millions of disposable
        # routing-cache references during interpreter teardown on small hosts.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)

feed = public_feed.since(0)
for player in feed['meta']['players']:
    player['look'] = {**LOOKS[player['name']], 'name': 'Grocery Bot'}
    shop_id = state['players'][player['id']]['shop']
    location = next(s for s in state['map']['shops'] if s['id'] == shop_id)
    player['district'] = location.get('district')
    player['store'] = location.get('store')
feed['meta']['you'] = next(i for i, (_, name, _) in enumerate(SEATS) if name == 'Rush AI')   # whose shop opens as "Your shop"
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'game.json'), 'w') as f:
    json.dump(feed, f, separators=(',', ':'))

rules = state['rules']
orders = {}
for oid, o in state['orders'].items():
    orders[oid] = {
        'items': o['items_required'], 'address': o['address'].get('address') or o['address'].get('id'),
        'placed': o['released_tick'], 'expires': o['expires_tick'], 'deadline': o.get('deadline_tick'),
        'firstLoad': o.get('first_load_tick'), 'ready': o.get('ready_at_tick'),
        'deliveredAt': round(o['delivered_at'] / rules['tick_seconds'], 2) if o.get('delivered_at') is not None else None,
        'satisfaction': o.get('satisfaction'), 'points': o.get('points'), 'reward': o['reward'], 'rushBonus': o.get('rush_bonus'),
        'lateSeconds': o.get('late_seconds'), 'history': history.get(oid, []),
    }
shop = state['shop']
with open(os.path.join(OUT, 'shop.json'), 'w') as f:
    json.dump({'seed': SEED, 'grid': shop['grid'], 'items': [[i['position'][0], i['position'][1], products.index(i['type'])] for i in shop['items']],
               'departments': shop.get('departments', []), 'fixtures': shop.get('fixtures', {}),
               'bays': [b['bay'] for b in shop['bays']], 'loadCells': [b['load_cells'] for b in shop['bays']], 'spawn': shop['spawn'],
               'products': products, 'botsPerPlayer': rules['bots_per_player'], 'trucksPerPlayer': rules['trucks_per_player'],
               'botCapacity': rules['bot_capacity'], 'tickSeconds': rules['tick_seconds'], 'lateStepTicks': rules['late_step_ticks'],
               'lateStepPercent': rules['late_step_percent'], 'seats': len(SEATS), 'frameBytes': rules['bots_per_player'] * 6 + rules['trucks_per_player'] * 2,
               'ticks': state['tick'] + 1, 'truckLoads': truck_loads, 'orders': orders}, f, separators=(',', ':'))
with open(os.path.join(OUT, 'shop.bin'), 'wb') as f:
    f.write(bytes(frames))
hashes = {}
for filename in ('game.json', 'shop.json', 'shop.bin'):
    with open(os.path.join(OUT, filename), 'rb') as f:
        hashes[filename] = hashlib.sha256(f.read()).hexdigest()
with open(os.path.join(OUT, 'recording.json'), 'w') as f:
    json.dump({'mapHash': state['map']['sha256'], 'seed': SEED, 'ticks': state['tick'] + 1,
               'players': len(SEATS), 'sha256': hashes}, f, separators=(',', ':'))
print('final', {p['name']: (p['score'], p['delivered']) for p in state['players'].values()}, 'bin', len(frames))
sys.stdout.flush()
sys.stderr.flush()
os._exit(0)
