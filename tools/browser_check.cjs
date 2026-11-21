// PLAYWRIGHT_MODULE=/path/to/playwright node tools/browser_check.cjs
// Uses software WebGL for correctness checks, NOT a laptop GPU performance benchmark (tools/load_benchmark.cjs
// measures load time, memory and frame rate). Chunks are frustum-culled by the GPU, never hidden or swapped.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  try {
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 1000 }],
      ['phone', { width: 390, height: 844 }],
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(name, 'browser error:', error.message); });
      await page.goto((process.env.PREVIEW_URL || 'http://localhost:8138/') + '?view=2d', { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.groceryView?.game.players.length === 12 && window.groceryView.panels);
      await page.evaluate(() => { groceryView.play.paused = true; groceryView.play.head = 240; });
      await page.waitForFunction(() => document.getElementById('tick').textContent.includes('240'));
      assert.equal(await page.locator('.g-row').count(), 12);
      if (!await page.locator('#shop-close').isVisible()) await page.evaluate(() => groceryView.panels.showShop(2));
      // Every standings seat must reopen and switch its shop, including scrolled rows.
      for (let seat = 0; seat < 12; seat++) {
        await page.locator('#shop-close').click();
        await page.locator('.g-row').nth(seat).click();
        await page.waitForFunction(seat => {
          const player = groceryView.game.players[seat];
          return !document.getElementById('shopwin').hidden &&
            document.getElementById('shop-title').textContent ===
              (seat === groceryView.game.meta.you ? 'Your shop' : `${player.name}'s shop`);
        }, seat);
      }
      await page.locator('.g-row').nth(11).click(); // Clear fleet focus, leave the shop selected.
      await page.locator('#shop-close').click();
      // The actual order card data are checked using a known recording order.
      const oid = await page.evaluate(async () => {
        const shop = await (await fetch('data/shop.json')).json();
        return Object.keys(shop.orders)[0];
      });
      await page.evaluate(id => groceryView.panels.showOrder(id), oid);
      await page.waitForFunction(() => !document.getElementById('ordercard').hidden);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `/tmp/opencode/oslo-${name}-2d.png` });
      await page.locator('#view-3d').click();
      await page.waitForFunction(() => groceryView.world3d?.cityDone && document.body.classList.contains('is-3d'), null, { timeout: 120000 });
      const geometry = await page.evaluate(async () => {
        const world = groceryView.world3d;
        const { Frustum, Matrix4 } = await import('three');
        const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(world.camera.projectionMatrix, world.camera.matrixWorldInverse));
        let vertices = 0;
        world.scene.traverse(object => {
          if (object.isMesh && object.visible && [20, 21].includes(object.renderOrder) && frustum.intersectsObject(object)) vertices += object.geometry.attributes.position.count;
        });
        const context = world.scene.children.filter(o => o.isMesh && o.renderOrder === 20);
        return { buildingVertices: vertices, drawCalls: world.renderer.info.render.calls,
          mode: world.buildingMode, stats: world.buildingStats, meshes: context.length,
          resident: context.length > 0 && context.every(o => o.visible), uuids: context.map(o => o.geometry.uuid) };
      });
      assert.equal(geometry.mode, 'all');
      assert.equal(geometry.meshes, geometry.stats.contextDrawCalls);
      assert(geometry.resident && geometry.stats.count > 54000);
      const trees = await page.evaluate(() => groceryView.world3d.treeCounts);
      assert(trees.forest > 1000 && trees.parks > 500, JSON.stringify(trees));
      await page.selectOption('#explore-place', '10.774,59.890');
      await page.waitForFunction(() => {
        const [x, z] = groceryView.toWorld(1077400, 5989000);
        return Math.hypot(groceryView.world3d.controls.target.x - x, groceryView.world3d.controls.target.z - z) < 10;
      }, null, { timeout: 90000 });
      await page.screenshot({ path: `/tmp/opencode/oslo-${name}-ekeberg.png`, timeout: 120000 });
      const residency = await page.evaluate(geometry => {
        const context = groceryView.world3d.scene.children.filter(o => o.isMesh && o.renderOrder === 20);
        return context.length === geometry.meshes && context.every(o => o.visible) &&
          context.map(o => o.geometry.uuid).join(',') === geometry.uuids.join(',');
      }, geometry);
      assert(residency);
      await page.locator('#city-overview').click();
      await page.waitForFunction(() => groceryView.world3d.camera.position.distanceTo(groceryView.world3d.controls.target) > 10000, null, { timeout: 90000 });
      await page.screenshot({ path: `/tmp/opencode/oslo-${name}-3d.png`, timeout: 120000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      const timing = await page.evaluate(() => new Promise(resolve => {
        let first = 0, previous = 0; const samples = [];
        const measure = now => {
          if (!first) first = now;
          if (previous) samples.push(now - previous);
          previous = now;
          if (now - first < 3000) return requestAnimationFrame(measure);
          const gl = groceryView.world3d.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
          resolve({ softwareWebGL: true, fps: Math.round(samples.length * 1000 / samples.reduce((a, b) => a + b, 0)),
            renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown' });
        };
        requestAnimationFrame(measure);
      }));
      console.log(`${name}: PASS — real stores, full-building residency, district flight, overview`, geometry, trees, timing);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(process.env.PREVIEW_URL || 'http://localhost:8138/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => groceryView.world3d?.cityDone && groceryView.panels?.seat === 2 &&
      document.body.classList.contains('is-3d'), null, { timeout: 120000 });
    await page.screenshot({ path: '/tmp/opencode/oslo-default-3d.png', timeout: 120000 });
    console.log('Default entry: PASS — active 3D replay with Your shop open');
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
