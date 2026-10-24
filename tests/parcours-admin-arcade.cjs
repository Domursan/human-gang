// Parcours : Autres jeux › Arcade (pages 404), admin-arcade.js, sur le faux Supabase.
// (a) 1280 px : trois cartes (Paillettes, Raclette, Domu-mobile) avec parties et Paillettes de la semaine ; règles en lecture
//     seule (aucun champ) ; classement des meilleurs scores ; récompense lue (5) et lien « Modifier dans Secrets » (jeux/secrets).
// (b) Semaines : précédente (RPC avec la date du lundi d'avant), suivante désactivée à la semaine en cours, « Cette semaine ».
// (c) Effacement : « Annuler » ne touche à rien ; « Effacer ce score » appelle hg_arcade_admin_clear avec le membre, le jeu et
//     le lundi de la semaine, la ligne disparaît, le focus revient au titre du jeu ; aucun confirm() natif.
// (d) Effacement refusé : message d'erreur, ligne conservée. (e) Lecture refusée : message et « Réessayer ».
// (f) Staff « reglages » : section et classement ; Staff « cartes » : pas de sous-section Arcade.
// (g) 390 px : pas de défilement horizontal, cibles ≥ 44 px ; aucune erreur JS partout.
// Captures : tests/shots/admin-arcade-1280.png et admin-arcade-390.png.
// Lancer : node tests/parcours-admin-arcade.cjs
const path = require('path');
const { SHOTS, check, finish, openPage, adminSection, hscroll, chromium } = require('./lib/harness.cjs');

/** Identifiant de test du membre n (U(2) = Alice, U(3) = Bruno, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

/** Lundi (AAAA-MM-JJ, UTC) de la semaine qui contient la date AAAA-MM-JJ. */
const lundi = (iso) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
/** Date AAAA-MM-JJ décalée de n jours. */
const addJ = (iso, n) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const CUR = lundi(new Date().toISOString().slice(0, 10));
const PREV = addJ(CUR, -7);

/** Appels d'une fonction RPC notés par le faux client. */
const rpcs = (p, fn) => p.evaluate((f) => window.__LOG.filter((l) => l[0] === 'rpc' && l[1] === f), fn);
/** Lignes du classement d'un jeu. */
const rows = (p, game) => p.locator(`.arc-game[data-game="${game}"] .arc-row`);
/** Boutons et liens trop petits (moins de 44 px) dans la section. */
const petites = (p) => p.evaluate(() => [...document.querySelectorAll('#arcade-root button, #arcade-root a')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44).map((el) => el.textContent.trim() || el.getAttribute('aria-label')));

(async () => {
  console.log('Semaine en cours : ' + CUR + ' (précédente : ' + PREV + ')');
  const browser = await chromium.launch();

  /* (a) Lecture, 1280 px */
  const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await adminSection(p, 'fete/arcade');
  await p.waitForSelector('#arcade-root .arc-game', { timeout: 8000 });
  const noms = await p.locator('.arc-game .card-title').allTextContents();
  check(noms.length === 3 && noms[0] === 'Paillettes' && noms[1] === 'Raclette' && noms[2] === 'Domu-mobile', `(a) trois cartes : ${noms.join(', ')}`);
  const pl = await p.textContent('.arc-game[data-game="paillettes"]');
  check(pl.includes('Parties jouées') && pl.includes('14') && pl.includes('Paillettes versées') && pl.includes('60'), '(a) Paillettes : 14 parties, 60 Paillettes versées');
  check((await p.textContent('.arc-game[data-game="domu"]')).includes('Domu-mobile'), '(a) Domu-mobile : carte présente');
  check((await p.textContent('.arc-game[data-game="paillettes"] .arc-rules')).includes('150') && (await p.textContent('.arc-game[data-game="domu"] .arc-rules')).includes('600'), '(a) règles : score maximum lu (150 et 600)');
  check((await p.textContent('.arc-game[data-game="paillettes"] .arc-rules')).includes('Points par seconde, au plus') && (await p.textContent('.arc-game[data-game="paillettes"] .arc-rules')).includes('25 s'), '(a) règles : points par seconde et durée minimale');
  check((await p.locator('#arcade-root input, #arcade-root select, #arcade-root textarea').count()) === 0, '(a) règles en lecture seule (aucun champ)');
  check((await p.textContent('.arc-game[data-game="paillettes"] .arc-rules')).includes('refusé'), '(a) phrase d\'explication des règles');
  check((await rows(p, 'paillettes').count()) === 3, '(a) classement Paillettes : 3 lignes');
  check((await rows(p, 'paillettes').first().textContent()).includes('Alice') && (await rows(p, 'paillettes').first().textContent()).includes('120'), '(a) premier du classement : Alice, 120 points');
  check((await p.locator('.arc-game[data-game="paillettes"] [data-arc="clear"]').first().textContent()).trim() === 'Effacer ce score', '(a) bouton « Effacer ce score » par ligne');
  check((await p.textContent('.arc-reward')).includes('5 Paillettes'), '(a) récompense d\'une partie lue (5 Paillettes)');
  check((await p.locator('.arc-reward a[href="#fete/secrets"]').textContent()).includes('Modifier dans Secrets'), '(a) lien « Modifier dans Secrets »');
  check((await rpcs(p, 'hg_arcade_admin_board')).some((l) => l[2].p_week === null), '(a) première lecture : semaine en cours (p_week null)');
  check((await p.locator('.arc-tag').count()) === 1 && (await p.locator('[data-arc="next"]').isDisabled()), '(b) semaine en cours : étiquette, suivante désactivée');
  await p.screenshot({ path: path.join(SHOTS, 'admin-arcade-1280.png'), fullPage: true });
  check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));

  /* (b) Semaines */
  await p.click('[data-arc="prev"]');
  await p.waitForFunction(() => document.querySelector('.arc-week')?.textContent.includes('Semaine du'), null, { timeout: 5000 });
  await p.waitForFunction((w) => window.__LOG.some((l) => l[1] === 'hg_arcade_admin_board' && l[2].p_week === w), PREV, { timeout: 5000 });
  check(true, `(b) semaine précédente : RPC avec p_week = ${PREV}`);
  check((await p.locator('.arc-tag').count()) === 0 && !(await p.locator('[data-arc="next"]').isDisabled()), '(b) semaine passée : suivante active, pas d\'étiquette');
  check((await p.locator('.arc-game[data-game="paillettes"] .arc-stats dd').allTextContents()).join(' ') === '6 20', '(b) semaine passée : 6 parties, 20 Paillettes');
  check((await p.locator('[data-arc="today"]').count()) === 1, '(b) bouton « Cette semaine » présent');
  await p.click('[data-arc="today"]');
  await p.waitForSelector('.arc-tag', { timeout: 5000 });
  check((await p.locator('[data-arc="next"]').isDisabled()) && (await p.locator('[data-arc="today"]').count()) === 0, '(b) retour à la semaine en cours');
  check((await rpcs(p, 'hg_arcade_admin_board')).length >= 3, '(b) chaque changement de semaine relit la base');

  /* (c) Effacement : annuler, puis confirmer */
  await p.evaluate(() => { window.__NATIVE = 0; window.confirm = () => { window.__NATIVE++; return true; }; });
  await rows(p, 'paillettes').first().locator('[data-arc="clear"]').click();
  await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
  const dlg = await p.textContent('dialog.hg-dialog');
  check(dlg.includes('Alice') && dlg.includes('Paillettes') && dlg.includes('120 points'), '(c) confirmation dans la page : membre, jeu et score');
  await p.locator('dialog.hg-dialog').getByRole('button', { name: 'Annuler' }).click();
  await p.waitForFunction(() => !document.querySelector('dialog.hg-dialog'), null, { timeout: 5000 });
  check((await rpcs(p, 'hg_arcade_admin_clear')).length === 0, '(c) « Annuler » : aucun effacement');
  check((await rows(p, 'paillettes').count()) === 3, '(c) « Annuler » : la ligne reste');
  check((await p.evaluate(() => window.__NATIVE)) === 0, '(c) aucun confirm() natif');
  await rows(p, 'paillettes').first().locator('[data-arc="clear"]').click();
  await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
  await p.locator('dialog.hg-dialog').getByRole('button', { name: 'Effacer ce score' }).click();
  await p.waitForFunction(() => window.__LOG.some((l) => l[1] === 'hg_arcade_admin_clear'), null, { timeout: 5000 });
  const cl = (await rpcs(p, 'hg_arcade_admin_clear'))[0];
  check(cl && cl[2].p_user === U(2) && cl[2].p_game === 'paillettes' && cl[2].p_week === CUR, `(c) RPC hg_arcade_admin_clear(p_user, p_game, p_week) = (Alice, paillettes, ${CUR})`);
  await p.waitForFunction(() => document.querySelectorAll('.arc-game[data-game="paillettes"] .arc-row').length === 2, null, { timeout: 5000 });
  check(!(await rows(p, 'paillettes').first().textContent()).includes('Alice'), '(c) Alice retirée du classement');
  check((await p.evaluate(() => document.activeElement?.id)) === 'arc-h-paillettes', '(c) focus rendu au titre du jeu');
  check((await p.evaluate(() => window.__NATIVE)) === 0, '(c) toujours aucun confirm() natif');
  check(p.errs.length === 0, '(a–c) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));

  /* Lien vers Secrets */
  await p.click(".arc-reward a[href=\"#fete/secrets\"]");
  await p.waitForFunction(() => location.hash === '#fete/secrets', null, { timeout: 5000 });
  await p.waitForSelector('#aeg-form', { timeout: 8000 }).catch(() => {});
  check(await p.evaluate(() => location.hash) === '#fete/secrets', '(a) « Modifier dans Secrets » mène à #fete/secrets');
  await p.ctx.close();

  /* (d) Effacement refusé */
  const d = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { arcadeClearFail: true } });
  await adminSection(d, 'jeux/arcade');
  await d.waitForSelector('#arcade-root .arc-game', { timeout: 8000 });
  await rows(d, 'paillettes').first().locator('[data-arc="clear"]').click();
  await d.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
  await d.locator('dialog.hg-dialog').getByRole('button', { name: 'Effacer ce score' }).click();
  await d.waitForSelector('.toast.error', { timeout: 5000 });
  check((await d.textContent('.toast.error')).includes('Effacement refusé'), '(d) message d\'erreur lisible (toast)');
  check((await rows(d, 'paillettes').count()) === 3, '(d) effacement refusé : la ligne reste');
  check((await rows(d, 'paillettes').first().locator('[data-arc="clear"]').isEnabled()), '(d) bouton de nouveau actif');
  await d.ctx.close();

  /* (e) Lecture refusée */
  const e = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { arcadeBoardFail: true } });
  await adminSection(e, 'jeux/arcade');
  await e.waitForSelector('#arcade-root .empty', { timeout: 8000 });
  check((await e.textContent('#arcade-root')).includes('Arcade indisponible') && (await e.locator('[data-arc="retry"]').count()) === 1, '(e) lecture refusée : message et « Réessayer »');
  await e.ctx.close();

  /* (f) Staff */
  const s = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: U(4), staff: ['reglages'] } });
  await adminSection(s, 'jeux/arcade');
  await s.waitForSelector('#arcade-root .arc-game', { timeout: 8000 });
  check((await s.locator('.arc-game').count()) === 3 && (await s.locator('[data-arc="clear"]').count()) > 0, '(f) Staff « reglages » : classement et effacement');
  check(s.errs.length === 0, '(f) aucune erreur JS (Staff)' + (s.errs.length ? ' : ' + s.errs.join(' | ') : ''));
  await s.ctx.close();
  const c = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: U(4), staff: ['cartes'] } });
  check((await c.locator('a.shell-sub[href="#fete/arcade"]').count()) === 0, '(f) Staff « cartes » : pas de sous-section Arcade');
  await c.ctx.close();

  /* (g) 390 px */
  const m = await openPage(browser, { page: 'admin', width: 390, height: 844 });
  await adminSection(m, 'jeux/arcade');
  await m.waitForSelector('#arcade-root .arc-game', { timeout: 8000 });
  check((await hscroll(m)) <= 0, '(g) 390 px : pas de défilement horizontal');
  const small = await petites(m);
  check(small.length === 0, '(g) 390 px : cibles ≥ 44 px' + (small.length ? ' : ' + small.join(', ') : ''));
  await m.locator('.arc-game[data-game="paillettes"]').scrollIntoViewIfNeeded();
  await m.screenshot({ path: path.join(SHOTS, 'admin-arcade-390.png'), fullPage: false });
  check(m.errs.length === 0, '(g) aucune erreur JS (390 px)' + (m.errs.length ? ' : ' + m.errs.join(' | ') : ''));
  await m.ctx.close();

  await browser.close();
  finish();
})().catch((err) => { console.error(err); process.exitCode = 1; });
