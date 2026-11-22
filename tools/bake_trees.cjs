// Plants the forest and park trees once and writes data/trees.bin (see src/forest.js).
//   PLAYWRIGHT_MODULE=/path/to/playwright node tools/bake_trees.cjs
// Needs any Chromium; no GPU (it is Canvas2D only). Re-run after changing roads, buildings,
// land cover or shop positions.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => { console.error(error); process.exitCode = 1; });
    await page.route('http://bake.local/**', route => {
      const file = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ path: file, contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
    });
    await page.goto('http://bake.local/tools/bake-trees.html');
    const baked = await page.waitForFunction(() => window.baked, null, { timeout: 300000 }).then(handle => handle.jsonValue());
    // then clear trees out of houses and landmarks (tools/tree_clearance.mjs), with an input fingerprint
    // so tools/check_preview.py can tell when the bake is stale
    const { clearTrees, treeSource } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'tools', 'tree_clearance.mjs')).href);
    const { packTrees, unpackTrees } = await import(require('node:url').pathToFileURL(path.join(ROOT, 'src', 'forest.js')).href);
    const raw = Buffer.from(baked.base64, 'base64');
    const cleared = clearTrees(unpackTrees(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
    const buffer = Buffer.from(packTrees({ forest: cleared.forest, parks: cleared.parks, source: treeSource() }));
    fs.writeFileSync(path.join(ROOT, 'data', 'trees.bin'), buffer);
    console.log(`trees.bin: ${cleared.forest.length} forest trees, ${cleared.parks.length} park trees (${cleared.removed} cleared from buildings), ${buffer.length} bytes`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
