// Vérification des bibliothèques locales (assets/vendor) SANS faux Supabase : les vrais fichiers sont importés
// dans une page servie en HTTP par ce script. Contrôles : createClient est une fonction (module et global),
// qrcode(0, 'M') produit un SVG ou une image, aucune erreur console, aucune requête hors de l'origine locale.
// Lancer : node tests/controles/vendor-check.cjs   (même environnement Playwright que les autres tests, voir tests/README.md)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { check, finish } = require('../lib/harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const PAGE = `<!doctype html><meta charset="utf-8"><title>vendor-check</title>
<script type="module">
  import { createClient } from '/assets/vendor/supabase-js-2.45.4.mjs';
  import sbDefault from '/assets/vendor/supabase-js-2.45.4.mjs';
  import qrcode from '/assets/vendor/qrcode-generator-1.4.4.mjs';
  const r = { createClientType: typeof createClient, defaultHasCreateClient: typeof sbDefault.createClient,
    globalSupabase: typeof globalThis.supabase?.createClient, version: null, qrType: typeof qrcode, qrSvg: '', qrImg: '', err: null };
  try {
    const client = createClient('https://example.invalid', 'publishable-key-for-test');
    r.clientAuth = typeof client?.auth?.getSession;
    const qr = qrcode(0, 'M'); qr.addData('https://humane-gang.com/pages/cartes/cartes.html#code=TEST'); qr.make();
    r.qrSvg = qr.createSvgTag(4, 0); r.qrImg = qr.createImgTag(4, 0);
  } catch (e) { r.err = String(e && e.stack || e); }
  window.__vendor = r;
</script>`;

(async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/__vendor-check') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    const type = f.endsWith('.mjs') || f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    hits.push(u.pathname);
    res.writeHead(200, { 'content-type': type }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errs = [];
  const externes = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== base) { externes.push(route.request().url()); return route.fulfill({ status: 204, body: '' }); }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${base}/__vendor-check`);
  await page.waitForFunction(() => !!window.__vendor, null, { timeout: 15000 }).catch(() => {});
  const r = await page.evaluate(() => window.__vendor || null);
  await browser.close();
  server.close();

  check(!!r, 'page de contrôle exécutée');
  if (r) {
    check(r.err === null, 'import et création du client sans erreur' + (r.err ? ` (${r.err.slice(0, 200)})` : ''));
    check(r.createClientType === 'function', `createClient importé est une fonction (${r.createClientType})`);
    check(r.defaultHasCreateClient === 'function', 'export par défaut porte createClient');
    check(r.globalSupabase === 'function', 'window.supabase.createClient défini par le build UMD');
    check(r.clientAuth === 'function', 'le client créé expose auth.getSession');
    check(r.qrType === 'function', `qrcode-generator importé est une fonction (${r.qrType})`);
    check(/^<svg[\s>]/.test(r.qrSvg) && r.qrSvg.includes('<path'), 'qrcode(0,\'M\') produit un SVG (createSvgTag)');
    check(/^<img\s/.test(r.qrImg), 'qrcode(0,\'M\') produit une balise img (createImgTag)');
  }
  check(externes.length === 0, `aucune requête hors de l'origine locale (${externes.slice(0, 3).join(', ') || 'aucune'})`);
  check(errs.length === 0, `aucune erreur console (${errs.slice(0, 3).join(' | ') || 'aucune'})`);
  check(hits.includes('/assets/vendor/supabase-js-2.45.4.mjs') && hits.includes('/assets/vendor/qrcode-generator-1.4.4.mjs'), 'les deux fichiers .mjs ont bien été servis');
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
