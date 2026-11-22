// GPU-only probe: original Grocery Bot 2D shop, not a reskinned host mall.
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
      .filter(o => o.userData.shopStyle === 'original-2d')
      .map(group => {
        const colours = [], dimensions = [];
        group.traverse(o => {
          if (!o.isMesh) return;
          if (o.material.color) colours.push(o.material.color.getHexString());
          const p = o.geometry.parameters;
          if (p?.width) dimensions.push([p.width, p.height, p.depth]);
        });
        return { scale: group.scale.toArray(), colours, dimensions };
      }));
    assert.equal(shops.length, 12);
    for (const shop of shops) {
      assert.deepEqual(shop.scale, [1, 1, 1]);
      assert(shop.colours.includes('c8102e'));
      assert(shop.colours.includes('9ccbd0'));
      assert(shop.colours.includes('fffaf5'));
      assert(Math.max(...shop.dimensions.map(d => d[1])) < 12, 'No mall-height shop walls');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: all 12 original red 2D-style shops, compact geometry, no browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
