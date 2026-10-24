// Q3 · Vignettes des albums (photos.js, irl.js, historique.js, admin-souvenirs/photos.js), faux Supabase.
// - IRL : une photo avec vignette et dimensions → la grille affiche la vignette avec width/height (la case garde sa taille).
// - IRL : envoi d'une photo → deux fichiers (photo + <chemin>.thumb.webp) et une ligne hg_photos avec thumb_path, width, height.
// - Admin › Souvenirs › Photos : « Générer les vignettes manquantes » crée les vignettes absentes (envoi + mise à jour de la ligne).
// Lancer : node tests/parcours-vignettes.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const EV = 'eeeeeeee-0000-4000-8000-000000000001';
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
/** PNG 2 × 1 (rouge), pour l'envoi de photo. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEAAB0eAf+0bGc5AAAAAElFTkSuQmCC', 'base64');

(async () => {
  const browser = await chromium.launch();

  /* ---------- IRL : grille et envoi ---------- */
  {
    const photos = [
      { id: 'pppppppp-0000-4000-8000-000000000001', event_id: EV, user_id: ME, path: `${ME}/${EV}/a.webp`, thumb_path: `${ME}/${EV}/a.webp.thumb.webp`, width: 1600, height: 1200, caption: null, created_at: iso(-30) },
      { id: 'pppppppp-0000-4000-8000-000000000002', event_id: EV, user_id: ME, path: `${ME}/${EV}/b.webp`, caption: null, created_at: iso(-30) },
    ];
    const p = await openPage(browser, { page: 'irl', width: 390, height: 844, scenario: { photos } });
    await p.locator('.album .thumb img').first().waitFor({ timeout: 8000 }).catch(() => {});
    const dims = await p.$$eval('.album .thumb img', (l) => l.map((i) => [i.getAttribute('width'), i.getAttribute('height')]));
    check(dims.length === 2, `IRL : 2 photos dans l’album (${dims.length})`);
    check(dims[0]?.[0] === '1600' && dims[0]?.[1] === '1200', 'IRL : vignette avec width/height connus');
    check(dims[1]?.[0] === null, 'IRL : ancienne photo sans dimensions (repli sur la photo entière)');

    await p.setInputFiles(`input[data-upload="${EV}"]`, { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
    await p.waitForFunction(() => (window.__DB.hg_photos || []).length >= 3, null, { timeout: 10000 }).catch(() => {});
    // Le faux Supabase insère en tête de table (unshift) : la nouvelle ligne est la première.
    const row = await p.evaluate(() => window.__DB.hg_photos[0]);
    const uploads = (await log(p)).filter((l) => l[0] === 'upload').map((l) => l[1]);
    check(!!row?.path && uploads.includes(row.path), `envoi : photo envoyée (${row?.path})`);
    check(row?.thumb_path === `${row?.path}.thumb.webp` && uploads.includes(row.thumb_path), 'envoi : vignette <chemin>.thumb.webp envoyée et enregistrée');
    check(row?.width === 2 && row?.height === 1, `envoi : dimensions enregistrées (${row?.width} × ${row?.height})`);
    check(await hscroll(p) <= 0, 'IRL : pas de défilement horizontal à 390');
    check(!p.errs.length, 'IRL : aucune erreur : ' + p.errs.join(' | '));
    await p.ctx.close();
  }

  /* ---------- Historique : vignette ---------- */
  {
    const photos = [{ id: 'pppppppp-0000-4000-8000-000000000001', event_id: EV, user_id: ME, path: `${ME}/${EV}/a.webp`, thumb_path: `${ME}/${EV}/a.webp.thumb.webp`, width: 800, height: 600, caption: null, created_at: iso(-30) }];
    const p = await openPage(browser, { page: 'historique', width: 1280, scenario: { photos } });
    await sleep(800);
    const w = await p.$$eval('.tl-thumb img', (l) => l.map((i) => i.getAttribute('width')));
    check(w.includes('800'), `historique : vignette avec dimensions (${w.join(',')})`);
    check(!p.errs.length, 'historique : aucune erreur : ' + p.errs.join(' | '));
    await p.ctx.close();
  }

  /* ---------- Admin : vignettes manquantes ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, scenario: { photoUrl: 'assets/img/favicon-64.png' } });
    await adminSection(p, 'camp/souvenirs');
    await p.click('#shell-col .sv-views a[data-view="photos"]');
    await p.waitForSelector('#souvenirs-root .sv-photo', { timeout: 5000 }).catch(() => {});
    const btn = p.locator('#sv-ph-gen-btn');
    check(await btn.isVisible(), 'admin : bouton « Générer les vignettes manquantes » visible');
    const h = await btn.evaluate((b) => b.getBoundingClientRect().height);
    check(h >= 44, `admin : bouton d’au moins 44 px (${h})`);
    await btn.click();
    await p.waitForFunction(() => /Terminé/.test(document.querySelector('#sv-ph-gen-status')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const status = await p.textContent('#sv-ph-gen-status');
    check(/Terminé : 2 vignettes créées/.test(status), `admin : 2 vignettes créées (${status})`);
    const rows = await p.evaluate(() => window.__DB.hg_photos.map((r) => [r.thumb_path, r.width, r.height]));
    check(rows.every((r) => r[0] && r[0].endsWith('.thumb.webp') && r[1] === 64 && r[2] === 64), `admin : lignes mises à jour (${JSON.stringify(rows)})`);
    const uploads = (await log(p)).filter((l) => l[0] === 'upload').map((l) => l[1]);
    check(uploads.filter((u) => u.endsWith('.thumb.webp')).length === 2, 'admin : 2 vignettes envoyées au stockage');
    check(!p.errs.length, 'admin : aucune erreur : ' + p.errs.join(' | '));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
