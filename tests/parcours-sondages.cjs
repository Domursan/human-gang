// Parcours P5 « Sondages libres » (migration 090).
// (a) accueil (390 px) : la ligne « sondage » du fil devient une carte (question, barres, avatars, temps restant).
// (b) vote d'un tap, changement de vote ; sondage anonyme sans avatar ; sondage clos : résultat, boutons désactivés.
// (c) création : 2 à 6 réponses, durée, options ; hg_poll_create puis fil rechargé avec la nouvelle carte.
// (d) « Sondages » : liste de tous les sondages. 360 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb-social.mjs. Lancer : node tests/parcours-sondages.cjs
const { check, finish, openPage, hscroll, chromium, SHOTS } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const h = (n) => new Date(Date.now() + n * 36e5).toISOString();
const P1 = 'aaaa0000-0000-4000-8000-000000000001', P2 = 'aaaa0000-0000-4000-8000-000000000002', P3 = 'aaaa0000-0000-4000-8000-000000000003';
const SCN = {
  polls: [
    { id: P1, created_by: U(2), question: 'Film de dimanche soir ?', options: ['Dune, deuxième partie', 'Le Comte de Monte-Cristo', 'Paddington au Pérou'], multi: false, anonymous: false, closes_at: h(22), closed_at: null, created_at: h(-2) },
    { id: P2, created_by: U(3), question: 'Qui est chaud ce soir ?', options: ['Moi', 'Pas moi'], multi: false, anonymous: true, closes_at: h(5), closed_at: null, created_at: h(-1) },
    { id: P3, created_by: U(4), question: 'Codenames ou Gartic ?', options: ['Codenames', 'Gartic'], multi: false, anonymous: false, closes_at: h(-1), closed_at: h(-1), created_at: h(-30) },
  ],
  votes: [
    { poll_id: P1, user_id: U(2), option_idx: 0 }, { poll_id: P1, user_id: U(3), option_idx: 0 }, { poll_id: P1, user_id: U(4), option_idx: 1 },
    { poll_id: P2, user_id: U(2), option_idx: 0 }, { poll_id: P3, user_id: U(2), option_idx: 0 }, { poll_id: P3, user_id: U(5), option_idx: 0 },
  ],
  activity: [
    { id: 3, user_id: U(2), kind: 'sondage', text: 'Alice a lancé un sondage : « Film de dimanche soir ? »', ref: 'poll:' + P1, created_at: h(-2) },
    { id: 2, user_id: U(3), kind: 'sondage', text: 'Bruno a lancé un sondage : « Qui est chaud ce soir ? »', ref: 'poll:' + P2, created_at: h(-1) },
    { id: 1, user_id: U(4), kind: 'sondage_resultat', text: 'Résultat du sondage « Codenames ou Gartic ? » : Codenames (2 voix sur 2)', ref: 'poll:' + P3, created_at: h(-1) },
  ],
};
const waitFor = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 6000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-social.mjs', width: 390, height: 900, scenario: SCN });
  await waitFor(p, () => document.querySelectorAll('#feed .poll-card').length >= 2);
  const card = `#poll-${P1}`;
  check(!!(await p.$(card)), '(a) carte du sondage dans le fil');
  const t = await p.textContent(card);
  check(t.includes('Film de dimanche soir ?') && t.includes('67 %') && t.includes('se termine dans'), '(a) question, pourcentage, temps restant');
  check((await p.$$(`${card} .poll-avs .avatar`)).length === 3, '(a) avatars des votants');
  check((await p.$$(`#poll-${P2} .poll-avs`)).length === 0 && (await p.textContent(`#poll-${P2}`)).includes('votes anonymes'), '(b) anonyme : aucun avatar');
  check(!!(await p.$(`#feed [data-poll-see="${P3}"]`)), '(b) ligne de résultat : bouton « Voir le sondage »');
  await p.screenshot({ path: `${SHOTS}/p5-fil-390.png`, fullPage: true });
  await p.click(`${card} [data-opt="2"]`);
  await waitFor(p, (c) => document.querySelector(`${c} [data-opt="2"]`)?.getAttribute('aria-pressed') === 'true', card);
  check(await p.getAttribute(`${card} [data-opt="2"]`, 'aria-pressed') === 'true', '(b) vote d’un tap (aria-pressed)');
  await p.click(`${card} [data-opt="1"]`);
  await waitFor(p, (c) => document.querySelector(`${c} [data-opt="1"]`)?.getAttribute('aria-pressed') === 'true', card);
  const votes = await p.evaluate((id) => window.__SOC.votes.filter((v) => v.poll_id === id && v.user_id === '11111111-1111-4111-8111-111111111111').map((v) => v.option_idx), P1);
  check(votes.length === 1 && votes[0] === 1, '(b) vote changé (sondage simple : une réponse)');
  // Sondage clos ouvert depuis le fil
  await p.click(`#feed [data-poll-see="${P3}"]`);
  await waitFor(p, () => !!document.querySelector('#poll-dlg[open] .poll-result'));
  check((await p.textContent('#poll-dlg .poll-result')).includes('Codenames'), '(b) sondage clos : résultat');
  check(await p.$eval('#poll-dlg [data-opt="0"]', (b) => b.disabled), '(b) sondage clos : vote impossible');
  await p.keyboard.press('Escape');
  // Création
  await p.click('#poll-new');
  await waitFor(p, () => !!document.querySelector('#poll-new-dlg[open]'));
  await p.fill('#poll-q', 'Pizza ou raclette pour samedi ?');
  await p.fill('#poll-a0', 'Pizza');
  await p.fill('#poll-a1', 'Raclette');
  await p.click('#poll-add');
  check((await p.$$('#poll-answers li')).length === 3, '(c) ajouter une réponse');
  await p.check('#poll-multi');
  await p.selectOption('#poll-h', '48');
  check(await hscroll(p) === 0, '(c) 390 px : boîte sans défilement horizontal');
  await p.screenshot({ path: `${SHOTS}/p5-creation-390.png` });
  await p.click('#poll-form [type=submit]');
  await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_poll_create'));
  const a = await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_poll_create')[2]);
  check(a.p_options.length === 2 && a.p_hours === 48 && a.p_multi === true && a.p_anonymous === false, '(c) réponse vide ignorée, durée et options transmises');
  await waitFor(p, () => [...document.querySelectorAll('#feed .poll-q')].some((e) => e.textContent.includes('Pizza ou raclette')));
  check([...await p.$$eval('#feed .poll-q', (e) => e.map((x) => x.textContent))].some((x) => x.includes('Pizza ou raclette')), '(c) fil rechargé avec la nouvelle carte');
  // Liste complète
  await p.click('#poll-all');
  await waitFor(p, () => document.querySelectorAll('#poll-dlg[open] .poll-card').length >= 4);
  check((await p.$$('#poll-dlg .poll-card')).length === 4, '(d) « Sondages » : tous les sondages');
  await p.keyboard.press('Escape');
  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
  await p.ctx.close();
  const q = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-social.mjs', width: 360, height: 800, scenario: SCN });
  await waitFor(q, () => document.querySelectorAll('#feed .poll-card').length >= 2);
  check(await hscroll(q) === 0, '(d) 360 px : pas de défilement horizontal');
  const hgt = await q.$eval('.poll-opt', (e) => e.getBoundingClientRect().height);
  check(hgt >= 44, '(d) réponses ≥ 44 px');
  await q.ctx.close();
  await browser.close();
  finish();
})();
