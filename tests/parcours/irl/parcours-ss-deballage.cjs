// Parcours : soirée déballage du Secret Santa (T2, migration 096).
// Page Secret Santa, édition 2026 à l'étape « envoi » : le membre voit un petit mot tant que rien n'est prévu ;
// l'organisateur (Staff « secret_santa ») crée la soirée, fixe la date gagnante, tire l'ordre, fait avancer la
// personne en cours (« Suivant », « Passer »), révèle. Le membre voit l'ordre et la personne en cours, jamais qui
// a offert à qui. Aucune récompense. Pas de défilement horizontal à 360 px.
// Faux Supabase : fixtures/fake-sb-saisons.mjs (scénarios unwrap, pilot, unwrapSeed). Appels dans window.__LOG.
// Lancer : flock .../nuit2/pw.lock env NODE_PATH=... node tests/parcours/irl/parcours-ss-deballage.cjs (voir RULES.md)
const { check, finish, openPage, hscroll, log, chromium } = require('../../lib/harness.cjs');

const FIX = 'fake-sb-saisons.mjs';
/** Édition 2026 à l'étape « envoi », tirée au sort (les paires ne sont pas encore révélées). */
const EDITIONS = [{ id: 'E26', year: 2026, status: 'envoi', budget: '20 CHF', drawn_at: '2026-11-20T10:00:00Z', shared_fields: [] }];
/** Appels d'une fonction de la soirée dans le journal. */
const calls = (lg, fn) => lg.filter((x) => x[0] === 'rpc' && x[1] === fn).map((x) => x[2]);

(async () => {
  const browser = await chromium.launch();

  /* 1. Membre, rien de prévu : un petit mot, aucune commande d'organisateur. */
  let p = await openPage(browser, { page: 'secret-santa', fixture: FIX, width: 1280, scenario: { editions: EDITIONS, unwrap: true } });
  await p.waitForSelector('#ss-unwrap', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('#ss-unwrap')), 'envoi : la section « Soirée déballage » est présente');
  check((await p.textContent('#ss-unwrap')).includes('proposera bientôt'), 'membre, rien de prévu : un petit mot seulement');
  check(!(await p.$('#ss-unwrap [data-draw]')) && !(await p.$('#ss-unwrap [data-next]')), 'membre : aucun bouton d’organisateur');
  check(!(await p.$('#ss-unwrap .uw-pilot')), 'membre : pas de panneau organisateur');
  check(!calls(await log(p), 'hg_ss_unwrap_next').length, 'membre : aucun appel hg_ss_unwrap_next');
  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'membre : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 2. Organisateur : crée la soirée, fixe la date, tire l'ordre, fait avancer. */
  p = await openPage(browser, { page: 'secret-santa', fixture: FIX, width: 1280, scenario: { editions: EDITIONS, unwrap: true, pilot: true } });
  await p.waitForSelector('#ss-unwrap .uw-pilot', { timeout: 8000 }).catch(() => {});
  check(!!(await p.$('#ss-unwrap [data-setup]')), 'organisateur : formulaire « Créer la soirée » présent');
  await p.fill('#uw-title', 'Soirée déballage 2026');
  await p.fill('#uw-d1', '2026-12-05T20:00');
  await p.fill('#uw-d2', '2026-12-06T20:00');
  await p.fill('#uw-turn', '5');
  await p.click('#ss-unwrap [data-setup] button[type="submit"]');
  await p.waitForSelector('#ss-unwrap [data-fix]', { timeout: 8000 }).catch(() => {});
  const setup = calls(await log(p), 'hg_ss_unwrap_setup');
  check(setup.length === 1 && setup[0].p_edition === 'E26' && setup[0].p_dates.length === 2, 'soirée créée avec deux dates proposées');
  check(setup.length === 1 && setup[0].p_turn_seconds === 300, 'minuteur de 5 minutes envoyé en secondes');
  const fixBtns = await p.locator('#ss-unwrap [data-fix]').count();
  check(fixBtns === 2, `deux dates à fixer affichées (${fixBtns})`);
  await p.locator('#ss-unwrap [data-fix]').first().click();
  await p.waitForTimeout(400);
  check(calls(await log(p), 'hg_ss_unwrap_fix_date').length === 1, 'date gagnante fixée (un appel)');

  await p.locator('#ss-unwrap [data-draw]').click();
  await p.waitForSelector('#ss-unwrap [data-next="suivant"]', { timeout: 8000 }).catch(() => {});
  check(calls(await log(p), 'hg_ss_unwrap_draw').length === 1, 'ordre tiré (un appel hg_ss_unwrap_draw)');
  check(!!(await p.$('#ss-unwrap [data-next="suivant"]')), 'ordre tiré : boutons « Suivant » et « Passer » disponibles');
  check((await p.textContent('#ss-unwrap')).includes('Ordre de passage'), 'ordre affiché');
  check((await p.textContent('#ss-unwrap')).includes('Minuteur indicatif') || (await p.$('#uw-clock')) !== null, 'minuteur indicatif présent');

  await p.locator('#ss-unwrap [data-next="suivant"]').click();
  await p.waitForTimeout(400);
  const nx = calls(await log(p), 'hg_ss_unwrap_next');
  check(nx.length === 1 && nx[0].p_action === 'suivant' && nx[0].p_edition === 'E26', '« Suivant » : hg_ss_unwrap_next(suivant) pour E26');

  await p.locator('#ss-unwrap [data-next="passer"]').click().catch(() => {});
  await p.waitForTimeout(400);
  const nx2 = calls(await log(p), 'hg_ss_unwrap_next');
  check(nx2.length === 2 && nx2[1].p_action === 'passer', '« Passer » : la personne absente passe en fin de liste (hg_ss_unwrap_next(passer))');

  // Le texte de la soirée ne dit jamais qui a offert à qui.
  const txt = await p.textContent('#ss-unwrap');
  check(!/offre[rz]? à|a offert|Santa de/i.test(txt), 'soirée : aucun « qui a offert à qui » affiché');
  check(!calls(await log(p), 'hg_ss_reveal').length, 'soirée : les paires ne sont pas demandées avant la révélation');

  check(!p.errs.filter((e) => !/^404 /.test(e)).length, 'organisateur : aucune erreur console : ' + p.errs.join(' | '));
  await p.close();

  /* 3. Membre pendant la soirée : ordre et personne en cours, sans commandes. */
  p = await openPage(browser, { page: 'secret-santa', fixture: FIX, width: 1280, scenario: { editions: EDITIONS, unwrap: true, unwrapSeed: true } });
  await p.waitForSelector('#ss-unwrap', { timeout: 8000 }).catch(() => {});
  const t3 = await p.textContent('#ss-unwrap').catch(() => '');
  check(t3.includes('Ordre de passage'), 'membre pendant la soirée : l’ordre de passage est visible');
  check(!(await p.$('#ss-unwrap [data-next]')), 'membre pendant la soirée : aucune commande « Suivant »');
  check(!!(await p.$('#ss-unwrap .uw-timer')) || t3.includes('indicatif'), 'membre pendant la soirée : minuteur indicatif, sans alerte');
  check(calls(await log(p), 'hg_ss_unwrap_state').length >= 1, 'membre : l’état de la soirée est lu par hg_ss_unwrap_state');
  await p.close();

  /* 4. Téléphone de 360 px : pas de défilement horizontal. */
  p = await openPage(browser, { page: 'secret-santa', fixture: FIX, width: 360, height: 780, mobile: true, scenario: { editions: EDITIONS, unwrap: true, pilot: true, unwrapSeed: true } });
  await p.waitForSelector('#ss-unwrap', { timeout: 8000 }).catch(() => {});
  check(await hscroll(p) <= 0, `360 px : pas de défilement horizontal (${await hscroll(p)} px)`);
  await p.close();

  await browser.close();
  finish();
})();
