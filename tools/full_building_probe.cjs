// Static-layout renderer probe, independent of an in-progress match recording.
// This is NOT a moving-fleet or hardware-GPU performance benchmark.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const graph = JSON.parse(fs.readFileSync('data/map.json'));
  const replay = JSON.parse(fs.readFileSync('data/game.json'));
  replay.meta.players.forEach((player, seat) => Object.assign(player, {
    shop: graph.shops[seat].coordinates.map(v => Math.round(v * 1e5)),
    store: graph.shops[seat].store, district: graph.shops[seat].district,
  }));
  replay.frames = [{ t: 0, c: 12 * 3600, r: 0, o: [], x: [],
    p: replay.meta.players.map(player => [0, 0, 0, 100, Array.from({ length: 5 }, () => [...player.shop, 0]).flat()]) }];
  replay.finished = true;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=1536',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.route('**/data/game.json*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(replay) }));
    await page.goto('http://localhost:8138/?view=3d&buildings=all', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(() => groceryView.world3d && groceryView.panels, null, { timeout: 180000 });
    await page.evaluate(() => { groceryView.play.paused = true; groceryView.panels.closeShop(); });
    const before = await page.evaluate(() => {
      const world = groceryView.world3d, meshes = world.scene.children.filter(o => o.isMesh && o.renderOrder === 20);
      return { mode: world.buildingMode, stats: world.buildingStats, meshes: meshes.length,
        resident: meshes.length > 0 && meshes.every(m => m.visible && !m.frustumCulled), uuids: meshes.map(m => m.geometry.uuid) };
    });
    assert.equal(before.mode, 'all');
    assert(before.resident && before.stats.count > 54000);
    assert.equal(before.stats.contextDrawCalls, before.meshes);
    await page.screenshot({ path: '/tmp/opencode/oslo-all-buildings-layout.png', timeout: 120000 });
    await page.evaluate(([lon, lat]) => groceryView.world3d.explore(lon, lat), graph.shops[0].coordinates);
    await page.waitForFunction(([lon, lat]) => {
      const [x, z] = groceryView.toWorld(lon * 1e5, lat * 1e5), target = groceryView.world3d.controls.target;
      return Math.hypot(target.x - x, target.z - z) < 10;
    }, graph.shops[0].coordinates, { timeout: 90000 });
    assert.deepEqual(await page.evaluate(() => groceryView.world3d.scene.children.filter(o => o.isMesh && o.renderOrder === 20).map(o => o.geometry.uuid)), before.uuids);
    await page.screenshot({ path: '/tmp/opencode/oslo-real-grocery-closeup.png', timeout: 120000 });
    assert.deepEqual(errors, []);
    console.log('PASS: static fixture, permanent full-city geometry, real store footprint, no browser errors', before);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
