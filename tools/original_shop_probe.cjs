// GPU-only probe: original v2 town shop, with each player's colour.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--headless=new', '--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist',
  ] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || 'http://localhost:8138/?view=3d');
    await page.waitForFunction(() => window.groceryView?.world3d?.cityDone && groceryView.panels, null, { timeout: 180000 });
    const shops = await page.evaluate(() => groceryView.world3d.scene.children
      .filter(o => o.userData.shopStyle === 'v2-town')
      .map(group => {
        const colours = [], dimensions = [];
        group.traverse(o => {
          if (!o.isMesh) return;
          for (const material of Array.isArray(o.material) ? o.material : [o.material])
            if (material.color) colours.push(material.color.getHexString());
          const p = o.geometry.parameters;
          if (p?.width) dimensions.push([p.width, p.height, p.depth]);
        });
        return { scale: group.scale.toArray(), colours, dimensions, colour: group.userData.shopColour,
          width: group.userData.shopWidthMetres, placement: group.userData.shopPlacement };
      }));
    assert.equal(shops.length, 12);
    for (const shop of shops) {
      assert.deepEqual(shop.scale, [1, 1, 1]);
      assert(shop.colours.includes(shop.colour.replace('#', '').toLowerCase()), 'Shop must use its player colour');
      assert(shop.colours.includes('b6d4d7'));
      assert(shop.colours.includes('fff3da'));
      assert(shop.width >= 18 && shop.width <= 46);
      assert(shop.placement.roadClearanceMetres >= 3);
      assert(shop.placement.buildingClearanceMetres >= 3);
      assert(shop.dimensions.some(d => Math.abs(d[0] - shop.width / 1.113) < .01), 'Model must use fitted site width');
    }
    assert.deepEqual(errors, []);
    assert.equal(new Set(shops.map(shop => shop.colour)).size, 12);
    assert.deepEqual(await page.evaluate(() => groceryView.world3d.landmarkStats.palace), {
      mainHeight: 19, roofWings: 3, columns: 8, continuousPortico: true,
    });
    for (let seat = 0; seat < 12; seat++) {
      const labels = await page.evaluate(seat => {
        groceryView.panels.showShop(seat);
        return document.body.innerText + ' ' + [...document.querySelectorAll('.g-row')].map(row => row.title).join(' ');
      }, seat);
      assert(!/\b(meny|kiwi|joker|spar|nærbutikken|jacobs)\b/i.test(labels), 'Shop labels must not advertise the source store chain');
    }
    console.log('PASS: all 12 v2 town shops, matching player colours, compact geometry, no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
