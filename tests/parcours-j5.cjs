// Parcours J5 : pronostics du gang (onglet « Pronostics » de la page Jeux, section admin « Pronostics »).
// Téléphone 390 px : compétitions en puces, carte de match ouverte (pastilles sans logo, mise 0 / 10 / 25 / 50,
// compte à rebours, « Valider : KC, 25 Paillettes »), carte verrouillée avec la répartition du gang, match terminé
// avec le gain ; les pronos des autres ne sont pas montrés avant la fermeture. Admin : coller des matchs, régler.
// Faux Supabase : fixtures/fake-sb.mjs + fixtures/fake-jeux.js. Lancer : node tests/parcours-j5.cjs
const { SHOTS, check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });

  let p = await openPage(browser, { page: 'jeux', hash: '#pronos', width: 390, height: 900, init: 'fake-jeux.js' });
  await p.waitForSelector('.pr-card', { timeout: 6000 }).catch(() => {});
  check((await p.locator('#jeux-tab-pronos').getAttribute('aria-selected')) === 'true', 'Jeux : #pronos ouvre l’onglet');
  check((await p.locator('.pr-comp').count()) === 3 && (await p.locator('.pr-comp[aria-pressed="true"]').innerText()).includes('Worlds'), 'compétitions en puces, Worlds choisie');
  check((await p.locator('.pr-head .pill').innerText()).includes('2e · 7 pts'), 'mon rang : « 2e · 7 pts »');
  const ouverte = p.locator('.pr-card').first();
  check((await ouverte.locator('.pr-opt').count()) === 2 && (await ouverte.locator('.pr-vs').count()) === 1, 'match ouvert : deux pastilles et « contre »');
  check((await ouverte.locator('img').count()) === 0, 'aucun logo d’équipe');
  // textContent : innerText insère un saut de ligne entre les éléments flex (.pill est inline-flex).
  const horloge = ((await ouverte.locator('.pr-clock').textContent()) || '').replace(/\s+/g, ' ').trim();
  check(/ferme dans 1 j \d+ h/.test(horloge), `compte à rebours « ferme dans 1 j … » (${horloge})`);
  check((await ouverte.locator('.pr-stake').count()) === 4, 'mises 0 / 10 / 25 / 50');
  check((await ouverte.innerText()).includes('solde 1’240') || (await ouverte.innerText()).includes('solde 1 240') || /solde 1.240/.test(await ouverte.innerText()), 'solde affiché');
  check(await ouverte.locator('.pr-send').isDisabled(), 'bouton désactivé tant qu’aucun prono n’est choisi');
  await ouverte.locator('.pr-opt', { hasText: 'KC' }).click();
  await p.locator('.pr-card').first().locator('.pr-stake[data-stake="25"]').click();
  const btn = p.locator('.pr-card').first().locator('.pr-send');
  check((await btn.innerText()).includes('Valider : KC, 25 Paillettes'), 'bouton « Valider : KC, 25 Paillettes »');
  check((await p.locator('.pr-card').first().locator('.pr-opt[aria-pressed="true"]').innerText()).includes('Ton prono'), 'choix marqué « Ton prono » (aria-pressed)');
  await p.screenshot({ path: path.join(SHOTS, 'j5-pronos-390.png'), fullPage: true });
  await btn.click();
  await sleep(500);
  const bets = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_pick_bet');
  check(bets.length === 1 && bets[0][2].p_choice === 'kc' && bets[0][2].p_stake === 25, 'appel : hg_pick_bet(KC, 25)');
  check((await p.locator('.pr-card').first().locator('.pr-send').innerText()).includes('Modifier'), 'après envoi : « Modifier » (mise modifiable jusqu’au début)');
  const verrou = p.locator('.pr-card').nth(1);
  check((await verrou.innerText()).includes('verrouillé') && (await verrou.locator('.pr-bar[role="img"]').getAttribute('aria-label')).includes('5 membres sur HLE'), 'match verrouillé : répartition du gang (role img, texte)');
  check((await verrou.innerText()).includes('Ton prono : BLG'), 'match verrouillé : mon prono');
  const fini = p.locator('.pr-card').nth(2);
  check((await fini.innerText()).includes('KC gagne') && (await fini.locator('.pr-gain').innerText()).includes('+38'), 'match terminé : résultat et gain « +38 »');
  check((await p.locator('.pr-row').count()) === 2, 'classement de la compétition');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal');
  // Compétition à trois choix (F1)
  await p.click('.pr-comp >> text=F1');
  await p.waitForSelector('.pr-card .pr-opt >> text=Norris', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.pr-card').first().locator('.pr-opt').count()) === 3, 'F1 : trois choix en grille');
  check((await hscroll(p)) <= 0, 'F1 390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  p = await openPage(browser, { page: 'jeux', hash: '#pronos', width: 390, init: 'fake-jeux.js', scenario: { jeux: { vide: true } } });
  await p.waitForSelector('.pr .card', { timeout: 6000 }).catch(() => {});
  check((await p.locator('.pr').innerText()).includes('Aucune compétition ouverte'), 'sans compétition : message');
  await p.ctx.close();

  /* ---------- Admin ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, init: 'fake-jeux.js' });
  await adminSection(p, 'cartes/pronos');
  await p.waitForSelector('.adp-item', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.shell-sub[href="#cartes/pronos"]').count()) === 1, 'admin : sous-menu « Pronostics » dans Jeux et cartes');
  check((await p.locator('.adp-item').count()) === 3, 'admin : trois matchs de la compétition');
  await p.fill('#adp-lines', 'Demi-finale · BO5 : KC ; T1 ; 31.10.2099 18:00\nfinale ; date manquante');
  await p.click('[data-act="add"]');
  check((await p.locator('.adp-err').innerText()).includes('Ligne 2'), 'admin : ligne illisible signalée, rien n’est envoyé');
  await p.fill('#adp-lines', 'Demi-finale · BO5 : KC ; T1 ; 31.10.2099 18:00\nG2 ; FNC ; 2099-11-01 20:30');
  await p.click('[data-act="add"]');
  await sleep(500);
  const add = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_pick_items_add');
  check(add.length === 1 && add[0][2].p_items.length === 2 && add[0][2].p_items[0].label === 'Demi-finale · BO5' && add[0][2].p_items[1].label === 'G2 contre FNC'
    && add[0][2].p_items[0].options[1].id === 't1' && add[0][2].p_items[0].locks_at === '2099-10-31T17:00:00.000Z', 'admin : matchs collés (titre, choix, heure suisse → UTC)');
  check((await p.locator('.adp-item').count()) === 5, 'admin : liste rechargée (5 matchs)');
  // Régler le match verrouillé (m2)
  await p.locator('.adp-item.is-todo [data-act="settle"]').click();
  await p.click('dialog[open] button[value="ok"], dialog[open] .btn-primary').catch(() => {});
  await sleep(500);
  const settle = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_pick_settle');
  check(settle.length === 1 && settle[0][2].p_item === 'm2', 'admin : résultat validé après confirmation');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
