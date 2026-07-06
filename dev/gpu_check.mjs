// M3 real-GPU check launcher (seed of the G17 debug harness).
//
// Serves the repo over localhost, opens dev/gpu_check.html in Chromium via
// Playwright, and asserts the 16×16 GPU-vs-CPU comparison passes on a real
// WebGPU device. Run:
//
//     npm run build && node dev/gpu_check.mjs            # headless
//     npm run build && node dev/gpu_check.mjs --headed   # watch it
//
// Exits 0 on pass, 1 on fail. This is dev tooling, not part of the Vitest
// suite (the suite's GPU tests self-skip without navigator.gpu); G8/G14 own
// the CI story and G17 formalises this page into the full debug harness.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wgsl': 'text/plain', '.json': 'application/json', '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const headed = process.argv.includes('--headed');
const browser = await chromium.launch({
  headless: !headed,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=WebGPU',
    // Fall back to SwiftShader if no hardware GPU is reachable (CI parity
    // with the G8 swiftshader smoke job).
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[page] ${m.text()}`));
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

const qs = process.env.GPU_CHECK_QS ?? '';
await page.goto(`http://127.0.0.1:${port}/dev/gpu_check.html${qs}`);
const result = await page.waitForFunction(() => window.__RESULT, null, { timeout: 180_000 })
  .then((h) => h.jsonValue());

console.log('\n=== GPU CHECK RESULT ===');
console.log(JSON.stringify(result, null, 2));

// Capture the outcome-class grid — the project's first on-screen pixels.
try {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'dev', 'out'), { recursive: true });
  await page.locator('#c').screenshot({ path: join(root, 'dev', 'out', 'gpu_check_webgpu_canvas.png') });
  await page.locator('#c2').screenshot({ path: join(root, 'dev', 'out', 'gpu_check.png') });
  console.log('canvas screenshot: dev/out/gpu_check.png');
} catch (e) {
  console.warn('screenshot failed:', e.message);
}

if (!headed) {
  await browser.close();
  server.close();
  process.exit(result.ok ? 0 : 1);
} else {
  console.log('(headed mode: browser left open, Ctrl-C to quit)');
}
