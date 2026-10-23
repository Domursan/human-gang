// Parcours V9 : ciné-club (cine.html).
// Couvre : vote de la semaine (deux films, totaux, clôture, seuil), voter (« Ton choix »), « Je serai là » (aria-pressed),
// lien vocal Discord ; film vu avec note moyenne, avis, spoiler flouté puis affiché, « Le livre est mieux » (compteur) ;
// noter (dialogue, compteur de caractères) ; proposer un film (doublon refusé, puis ajout) ; « + » sur la liste d'attente ;
// projectionniste : programmer une séance (2 à 4 films) quand il n'y en a pas ; 360 px sans défilement horizontal ; aucune erreur.
// Lancer : node tests/parcours-v9.cjs (à travers le verrou commun des tests navigateur).
const { check, finish, openPage, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const vd = (p, fn, a) => p.evaluate(fn, a);
const NOPE = 'f0000000-0000-4000-8000-000000000001', SPOT = 'f0000000-0000-4000-8000-000000000002', DUNE = 'f0000000-0000-4000-8000-000000000003';
const LOTR = 'f0000000-0000-4000-8000-000000000004';

(async () => {
  const browser = await chromium.launch();

  /* ---------- Membre, téléphone 390 px ---------- */
  let p = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', width: 390, height: 844 });
  await p.waitForSelector('.cine-cur', { timeout: 8000 });
  const cur = await p.textContent('.cine-cur');
  check(/Vote de la semaine/.test(cur) && /Clôture/.test(cur), 'séance : vote de la semaine et clôture');
  check(await p.locator('.cine-film').count() === 2, 'deux films en lice');
  check(/3 votants\. En dessous de 4/.test(cur), 'votants et seuil de report');
  check(await p.locator('.cine-cur a[href^="https://discord.com/channels/"]').count() === 1, 'lien du salon vocal');
  await p.click(`[data-act="vote"][data-film="${SPOT}"]`);
  await p.waitForSelector('.cine-film.is-mine');
  check(/Spotlight/.test(await p.textContent('.cine-film.is-mine')), 'vote enregistré : « Ton choix » sur Spotlight');
  check(await vd(p, () => window.__VD.votes.length) === 4, '4 votants après mon vote');
  await p.click('[data-act="presence"]');
  await p.waitForSelector('[data-act="presence"][aria-pressed="true"]');
  check(/Ethan/.test(await p.textContent('.cine-presence')), '« Je serai là » : mon nom dans les présents');

  // Film vu
  const seen = p.locator('.cine-seen').first();
  check(/Dune/.test(await seen.textContent()) && /4,5 \/ 5/.test(await seen.textContent()), 'film vu : moyenne 4,5 / 5');
  check(await p.locator('.cine-spoiler').count() === 1, 'avis avec spoiler flouté');
  await p.click('[data-act="spoiler"]');
  check(/Paul devient empereur/.test(await p.textContent('.cine-reviews')) && await p.locator('.cine-spoiler').count() === 0, 'spoiler affiché à la demande');
  await p.click(`[data-act="book"][data-film="${DUNE}"]`);
  await p.waitForSelector(`[data-act="book"][aria-pressed="true"]`);
  check(/Le livre est mieux · 2/.test(await p.textContent(`[data-act="book"][data-film="${DUNE}"]`)), '« Le livre est mieux » : compteur à 2');

  // Noter
  await p.click(`[data-act="review"][data-film="${DUNE}"]`);
  await p.waitForSelector('dialog.cine-dlg[open]');
  await p.check('dialog.cine-dlg[open] input[name="stars"][value="3"]');
  await p.fill('#cr-body', 'Long mais beau.');
  check(/15 \/ 280/.test(await p.textContent('#cr-count')), 'compteur de caractères');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await p.waitForSelector('dialog.cine-dlg', { state: 'detached', timeout: 4000 }).catch(() => {});
  check(await vd(p, () => window.__VD.reviews.some((r) => r.user === '11111111-1111-4111-8111-111111111111' && r.stars === 3 && r.body === 'Long mais beau.')), 'avis enregistré (3 étoiles)');
  check(/4,0 \/ 5/.test(await p.textContent('.cine-seen')), 'moyenne recalculée (4,0 / 5)');

  // Proposer
  await p.click('[data-act="propose"]');
  await p.waitForSelector('#cp-title');
  await p.fill('#cp-title', 'Nope'); await p.fill('#cp-year', '2022');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await sleep(300);
  check(/déjà proposé/.test(await p.textContent('dialog.cine-dlg[open] .cine-form-err')), 'doublon refusé avec message');
  await p.fill('#cp-title', 'Le Voyage de Chihiro'); await p.fill('#cp-year', '2001'); await p.fill('#cp-pitch', 'Pour Mycethyst');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await p.waitForSelector('dialog.cine-dlg', { state: 'detached', timeout: 4000 }).catch(() => {});
  check(/Le Voyage de Chihiro/.test(await p.textContent('.cine-wait')), 'film proposé dans la liste d’attente');
  await p.click(`[data-act="plus"][data-film="${LOTR}"]`);
  await p.waitForSelector(`[data-act="plus"][data-film="${LOTR}"][aria-pressed="true"]`);
  check(/\+ 3/.test(await p.textContent(`[data-act="plus"][data-film="${LOTR}"]`)), '« + » : compteur à 3');
  // Le compte par défaut est admin (droit « evenements ») : le contrôle « membre simple » se fait avec un membre sans droits.
  const simple = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', scenario: { uid: '00000003-0000-4000-8000-000000000003' }, width: 390, height: 844 });
  await simple.waitForSelector('.cine-cur', { timeout: 8000 });
  check(await simple.locator('[data-act="open-session"]').count() === 0 && await simple.locator('[data-act="fix"]').count() === 0 && await simple.locator('.cine-host').count() === 0, 'membre simple : pas d’outils de projectionniste');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'membre : aucune erreur console' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Projectionniste sans séance, 360 px ---------- */
  p = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', scenario: { cineHost: true }, width: 360, height: 780 });
  await p.waitForSelector('.cine-cur', { timeout: 8000 });
  // Annuler la séance en cours puis en programmer une autre
  await p.click('.cine-host summary');
  await p.click('[data-act="cancel"]');
  await p.waitForSelector('dialog.hg-dialog[open]');
  await p.click('dialog.hg-dialog[open] .dialog-actions .btn:last-child');
  await p.waitForSelector('[data-act="open-session"]', { timeout: 4000 });
  check(true, 'séance annulée : bouton « Programmer une séance »');
  await p.click('[data-act="open-session"]');
  await p.waitForSelector('#cs-when');
  check(await p.locator('dialog.cine-dlg[open] input[name="films"]').count() === 4, 'les 4 films en attente proposés');
  await p.uncheck('dialog.cine-dlg[open] input[name="films"] >> nth=1');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await sleep(200);
  check(/2 à 4/.test(await p.textContent('dialog.cine-dlg[open] .cine-form-err')), 'un seul film coché : refusé');
  await p.check('dialog.cine-dlg[open] input[name="films"] >> nth=1');
  await p.fill('#cs-voice', 'https://exemple.com/film');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await sleep(200);
  check(/salon Discord/.test(await p.textContent('dialog.cine-dlg[open] .cine-form-err')), 'lien de visionnage refusé');
  await p.fill('#cs-voice', '');
  await p.click('dialog.cine-dlg[open] [type="submit"]');
  await p.waitForSelector('.cine-film', { timeout: 4000 });
  check(await vd(p, () => window.__VD.session.status === 'vote' && window.__VD.session.films.length === 2), 'nouvelle séance avec vote');
  check(await p.locator('[data-act="fix"]').count() === 2, 'projectionniste : « Choisir ce film »');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  await p.screenshot({ path: require('path').join(__dirname, 'shots', 'v9-cine-360.png'), fullPage: true }).catch(() => {});
  check(p.errs.length === 0, 'projectionniste : aucune erreur console' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Vide ---------- */
  p = await openPage(browser, { page: 'cine', fixture: 'fake-sb-vd.mjs', scenario: { cineEmpty: true }, width: 1280 });
  await p.waitForSelector('.cine-cur', { timeout: 8000 });
  check(/Pas de séance programmée/.test(await p.textContent('.cine-cur')) && /Aucun film vu/.test(await p.textContent('#cine-root')), 'aucune donnée : messages d’état vide');
  check(p.errs.length === 0, 'vide : aucune erreur console');
  await p.ctx.close();

  await browser.close();
  finish();
})();
