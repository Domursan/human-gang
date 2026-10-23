// Parcours : Carnet de voyage (carnet.html), idée S12.
// Fil des cartes postales (la plus récente en grand, avec timbre et tampon), carte différée absente du fil mais présente
// dans « Mon carnet », onglets ARIA, envoi d'une carte (photo réencodée, lieu saisi), masquage, 360 px, aucune erreur JS.
// Leaflet et Nominatim ne répondent pas dans le test : la page doit le dire sans planter.
// Faux Supabase : fixtures/fake-sb-contenus.mjs.
const { SHOTS, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const FX = 'fake-sb-contenus.mjs';
// Petite image PNG valide (1 × 1) pour l'envoi.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'carnet', fixture: FX, width: 1280 });
  await p.waitForSelector('.cv-pc', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.cv-pc').count()) === 1, 'fil : la carte la plus récente en grand');
  check((await p.locator('.cv-pc').innerText()).includes('Kyoto') && (await p.locator('.cv-pc .cv-stamp').count()) === 1, 'carte postale : lieu, timbre');
  check((await p.locator('.cv-pc .cv-tampon').innerText()).includes('KYOTO'), 'carte postale : tampon avec la ville');
  check((await p.locator('.cv-list .cv-li').count()) === 1, 'fil : les autres cartes en liste');
  check(!(await p.locator('#cv-feed').innerText()).includes('Rome'), 'fil : ma carte « publier à mon retour » n’y est pas');
  check((await p.locator('#cv-map-status').innerText()).includes('pays'), 'carte du monde : compteur cartes / pays');
  check((await p.locator('#cv-feed [data-react-bar^="postcard:"]').count()) === 2, 'réactions : une barre par carte publiée');
  // Onglets
  await p.click('#cv-tab-moi');
  check((await p.locator('#cv-tab-moi').getAttribute('aria-selected')) === 'true' && await p.locator('#cv-panel-moi').isVisible(), 'onglet « Mon carnet » sélectionné (ARIA)');
  check((await p.locator('#cv-mine').innerText()).includes('Rome') && (await p.locator('#cv-mine').innerText()).includes('Publiée le'), 'mon carnet : la carte différée avec sa date de publication');
  check((await p.locator('#cv-stats').innerText()).includes('1') && (await p.locator('#cv-stats').innerText()).includes('Italie'), 'mon carnet : compteur et pays (sans classement)');
  await p.click('#cv-mine [data-hide]');
  await sleep(300);
  const hide = (await log(p)).filter((e) => e[1] === 'hg_postcard_hide');
  check(hide.length === 1 && hide[0][2].p_hidden === true, 'masquer ma carte : hg_postcard_hide');
  await p.keyboard.press('ArrowLeft');
  // Envoi
  await p.click('#cv-send');
  await p.setInputFiles('#cs-photo', { name: 'vacances.png', mimeType: 'image/png', buffer: PNG });
  await p.fill('#cs-q', 'Lisbonne');
  await p.fill('#cs-msg', 'Pastéis de nata à volonté');
  await p.check('#cs-later');
  check(await p.locator('#cs-pub-f').isVisible(), 'envoi : « Publier à mon retour » affiche la date');
  const later = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await p.fill('#cs-pub', later);
  await p.click('dialog.ct-dialog button[type="submit"]');
  await sleep(1200);
  const L = await log(p);
  const up = L.filter((e) => e[0] === 'upload');
  const add = L.filter((e) => e[1] === 'hg_postcard_add');
  check(up.length === 1 && /^11111111-1111-4111-8111-111111111111\/postcards\/[0-9a-f-]{36}\.(webp|jpg)$/.test(up[0][1]), 'envoi : photo réencodée envoyée sous <moi>/postcards/<uuid>.webp');
  check(add.length === 1 && add[0][2].p_place === 'Lisbonne' && add[0][2].p_publish_at && add[0][2].p_geoguessr === false, 'envoi : hg_postcard_add (lieu, publication différée, GeoGuessr non coché)');
  check((await p.locator('dialog.ct-dialog[open]').count()) === 0, 'envoi : la boîte se ferme');
  check(p.errs.filter((e) => !/leaflet|nominatim|204/i.test(e)).length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  for (const w of [360, 390]) {
    p = await openPage(browser, { page: 'carnet', fixture: FX, width: w, height: 900 });
    await p.waitForSelector('.cv-pc', { timeout: 5000 }).catch(() => {});
    check(await hscroll(p) <= 0, `${w} px : pas de défilement horizontal`);
    await p.screenshot({ path: path.join(SHOTS, `S12-${w}.png`), fullPage: true }).catch(() => {});
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
