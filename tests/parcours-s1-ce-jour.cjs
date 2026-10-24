// Parcours : idée S1 « Ce jour-là » (tuile de l'accueil), plus la vue admin « Ce jour-là ».
// Tuile visible avec des souvenirs (titre « Il y a 3 ans », vignettes, réactions, « Un autre », lien vers l'album),
// masquée sans souvenir ou quand le réglage est coupé ; placée entre Secret Santa et IRL sur mobile ; 360 px sans défilement.
// Faux Supabase : fixtures/fake-sb-contenu.mjs (scénario ceJour).
// Lancer : node tests/parcours-s1-ce-jour.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const ITEMS = [
  { kind: 'sortie', id: 'eeeeeeee-0000-4000-8000-000000000001', title: 'Escape game et kebab de minuit', place: 'Lyon', date: '2023-10-23', years_ago: 3, exact: true,
    thumbs: ['a/cover.webp', 'a/p1.webp', 'a/p2.webp'], photos: 24, present: 7, react_kind: 'photo', react_id: 'pppppppp-0000-4000-8000-000000000001', year: 2023 },
  { kind: 'moment', id: 'mmmmmmmm-0000-4000-8000-000000000001', title: 'Le karaoké de Noël', place: null, date: '2024-10-23', years_ago: 2, exact: true,
    thumbs: [], photos: 0, present: 0, react_kind: 'moment', react_id: 'mmmmmmmm-0000-4000-8000-000000000001', year: 2024 },
  { kind: 'secret_santa', id: 'E24', title: 'Soirée déballage du Secret Santa 2024', place: null, date: '2024-10-23', years_ago: 2, exact: true,
    thumbs: [], photos: 0, present: 0, react_kind: null, react_id: null, year: 2024 },
];

(async () => {
  const browser = await chromium.launch();
  const F = 'fake-sb-contenu.mjs';

  /* ---------- Tuile avec trois souvenirs (mobile 390 px) ---------- */
  let p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { ceJour: ITEMS }, width: 390, height: 900 });
  await p.waitForSelector('#tile-day:not([hidden]) .day-big', { timeout: 5000 }).catch(() => {});
  check(await p.locator('#tile-day').isVisible(), 'tuile : visible avec des souvenirs');
  check((await p.locator('#tile-day .day-eyebrow').innerText()).trim().toLowerCase() === 'ce jour-là', 'tuile : titre « Ce jour-là »');
  check((await p.locator('#tile-day .day-big').innerText()).trim() === 'Il y a 3 ans', 'tuile : « Il y a 3 ans » en grand');
  check((await p.locator('#tile-day .day-date').innerText()).includes('23 octobre 2023'), 'tuile : date du souvenir');
  check((await p.locator('#tile-day .day-thumbs img').count()) === 3, 'tuile : 3 vignettes');
  check((await p.locator('#tile-day .day-meta').innerText()).includes('Lyon') && (await p.locator('#tile-day .day-meta').innerText()).includes('7 présents'), 'tuile : ville et présents');
  check((await p.locator('#tile-day .react-bar .react-btn').count()) === 6, 'tuile : barre de réactions');
  check((await p.locator('#tile-day .day-go').getAttribute('href')) === 'irl.html#event-eeeeeeee-0000-4000-8000-000000000001', 'tuile : « Voir l’album » mène à la sortie');
  check((await p.locator('#tile-day .day-dots span').count()) === 3, 'tuile : 3 points (souvenirs)');
  const ySs = (await p.locator('#tile-ss').boundingBox()).y, yDay = (await p.locator('#tile-day').boundingBox()).y, yIrl = (await p.locator('#tile-irl').boundingBox()).y;
  check(ySs < yDay && yDay < yIrl, 'mobile : la tuile est entre Secret Santa et IRL (maquette)');
  await p.click('#tile-day .day-next');
  await sleep(100);
  check((await p.locator('#tile-day .day-title').innerText()).includes('karaoké'), '« Un autre » : deuxième souvenir');
  check((await p.locator('#tile-day .day-go').getAttribute('href')) === 'historique.html', '« Un autre » : lien vers l’historique pour un moment');
  await p.click('#tile-day .day-next'); await p.click('#tile-day .day-next');
  await sleep(100);
  check((await p.locator('#tile-day .day-title').innerText()).includes('Escape'), '« Un autre » : boucle sur le premier');
  await p.click('#tile-day .day-thumbs');
  await sleep(200);
  check(await p.locator('dialog.lightbox[open]').count() === 1, 'vignettes : la visionneuse s’ouvre');
  await p.keyboard.press('Escape');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.screenshot({ path: require('path').join(require('./lib/harness.cjs').SHOTS, 's1-accueil-mobile.png'), fullPage: false }).catch(() => {});
  await p.ctx.close();

  /* ---------- 360 px : pas de défilement horizontal ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { ceJour: ITEMS }, width: 360, height: 800 });
  await p.waitForSelector('#tile-day:not([hidden])', { timeout: 5000 }).catch(() => {});
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal');
  const tgt = await p.locator('#tile-day .day-next').boundingBox();
  check(tgt && tgt.height >= 44, '360 px : bouton « Un autre » d’au moins 44 px');
  await p.ctx.close();

  /* ---------- Ordinateur : pleine largeur sous les tuiles ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { ceJour: ITEMS }, width: 1280 });
  await p.waitForSelector('#tile-day:not([hidden])', { timeout: 5000 }).catch(() => {});
  const bd = await p.locator('#tile-day').boundingBox(), bh = await p.locator('#tile-hist').boundingBox();
  check(bd.y > bh.y && bd.width > bh.width * 2, 'ordinateur : tuile en pleine largeur sous les trois tuiles');
  await p.ctx.close();

  /* ---------- Sans souvenir / réglage coupé : pas de tuile ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { ceJour: [], noWord: true } });
  await sleep(300);
  check(await p.locator('#tile-day').isHidden(), 'sans souvenir : tuile masquée (jamais vide)');
  check((await log(p)).some((e) => e[0] === 'rpc' && e[1] === 'hg_on_this_day'), 'appel : hg_on_this_day');
  await p.ctx.close();
  p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { ceJourOff: true } });
  await sleep(300);
  check(await p.locator('#tile-day').isHidden(), 'réglage coupé (null) : tuile masquée');
  check(p.errs.length === 0, 'aucune erreur JS (tuile masquée)' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Visiteur : pas de tuile ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: F, scenario: { guest: true, ceJour: ITEMS } });
  check((await p.locator('#tile-day').count()) === 0, 'visiteur : pas de tuile « Ce jour-là »');
  await p.ctx.close();

  /* ---------- Admin : vue « Ce jour-là » ---------- */
  p = await openPage(browser, { page: 'admin', fixture: F, scenario: { ceJour: ITEMS } });
  await adminSection(p, 'irl/souvenirs');
  await p.evaluate(() => { location.hash = 'irl/souvenirs/ce-jour'; });
  await p.waitForSelector('#cj-list .cj-row', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#cj-list .cj-row').count()) === 3, 'admin : aperçu des 3 souvenirs du jour');
  check(await p.locator('#cj-on').isChecked(), 'admin : interrupteur allumé');
  await p.locator('#cj-list [data-cj]').first().click();
  await sleep(200);
  let calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_on_this_day_hide');
  check(calls.length === 1 && calls[0][2].p_kind === 'sortie' && calls[0][2].p_hide === true, 'admin : « Retirer » appelle hg_on_this_day_hide');
  await p.locator('#cj-on').uncheck();
  await sleep(200);
  calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_contenu_reglages_set');
  check(calls.length === 1 && calls[0][2].p.ce_jour_la === false, 'admin : couper la tuile appelle hg_contenu_reglages_set');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
