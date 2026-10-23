// Parcours : idée J2 · Classement des jeux du jour (jeux.html#jdj et admin #cartes/jeux-du-jour), faux Supabase
// fake-sb-jeux.mjs. Aperçu du texte collé (reconnu / non reconnu), enregistrement et gain, classement du jour par jeu
// (cases neutres, jamais le texte brut), série et rang de la semaine, déjà déclaré, 360 px ; panel : réglages, retrait.
// Lancer : node tests/parcours-j2.cjs
const path = require('path');
const { SHOTS, check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const FIX = 'fake-sb-jeux.mjs';

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'jeux', fixture: FIX, hash: '#jdj', width: 360, height: 900 });
  await p.waitForSelector('#jdj-day-list .jg-board', { timeout: 6000 }).catch(() => {});
  check((await p.locator('#jdj-day-list').innerText()).includes('Alice'), 'classement du jour affiché');
  check(await p.locator('#jdj-chips button').count() === 2, 'un bouton par jeu déclaré (Worldle, Sutom)');
  check(!(await p.locator('#jdj-day-list').innerText()).includes('#Worldle'), 'le texte brut n’est jamais affiché');
  check(await p.locator('#jdj-day-list .jdj-cell').count() === 12, 'cases neutres : 6 par résultat sur 6');
  check((await p.locator('#jdj-streak').innerText()).includes('3 jours'), 'série affichée');
  check(await p.locator('#jdj-save').isDisabled(), 'enregistrer désactivé sans texte');
  // Non reconnu
  await p.locator('#jdj-raw').fill('bonjour tout le monde');
  check((await p.locator('#jdj-preview').innerText()).includes('Format non reconnu') && await p.locator('#jdj-preview a[href="assistance.html"]').count() === 1, 'non reconnu : message et lien « Signale-le »');
  check(await p.locator('#jdj-save').isDisabled(), 'non reconnu : enregistrement impossible');
  // Reconnu
  await p.locator('#jdj-raw').fill('#Worldle #1312 (23.10.2026) 2/6 (100%)\n🟩🟩🟩🟨⬜➡️\n🟩🟩🟩🟩🟩🎉');
  const pv = await p.locator('#jdj-preview').innerText();
  check(pv.includes('Reconnu : Worldle n°1312 · 2/6') && pv.includes('+5 Paillettes (1 sur 3'), 'aperçu : jeu, grille, score et gain');
  await p.locator('#jdj-save').click();
  await sleep(800);
  const sub = (await log(p)).filter((l) => l[1] === 'hg_daily_submit');
  check(sub.length === 1 && sub[0][2].p_raw.startsWith('#Worldle'), 'envoi : texte brut au serveur (qui le relit)');
  check(await p.locator('#jdj-raw').inputValue() === '', 'après l’envoi : champ vidé');
  check((await p.locator('#jdj-day-list').innerText()).includes('Ethan') && await p.locator('#jdj-day-list li.is-me').count() === 1, 'classement : ma ligne ajoutée et mise en avant');
  check((await p.locator('#jdj-rank').innerText()).match(/\d+(er|e)/), 'rang de la semaine affiché');
  // Déjà déclaré
  await p.locator('#jdj-raw').fill('#Worldle #1312 1/6');
  check((await p.locator('#jdj-preview').innerText()).includes('déjà déclaré') && await p.locator('#jdj-save').isDisabled(), 'déjà déclaré : signalé, bouton désactivé');
  // Coups (Cémantix)
  await p.locator('#jdj-raw').fill('J’ai trouvé #cemantix nº1037 en 54 coups !');
  check((await p.locator('#jdj-preview').innerText()).includes('54 coups'), 'Cémantix : nombre de coups');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  await p.screenshot({ path: path.join(SHOTS, 'jeux-jdj-360.png'), fullPage: true }).catch(() => {});
  check(p.errs.length === 0, `aucune erreur JS ${p.errs.join(' | ')}`);
  await p.ctx.close();

  /* ---------- Panel ---------- */
  p = await openPage(browser, { page: 'admin', fixture: FIX, width: 1280, height: 900 });
  await adminSection(p, 'cartes/jeux-du-jour');
  await p.waitForSelector('#ajx-jdj-list .ajx-row', { timeout: 4000 }).catch(() => {});
  check(await p.locator('input[name="actif"]:checked').count() === 7, 'panel : 7 jeux ouverts');
  check(await p.locator('#ajx-jdj-list .ajx-row').count() === 3, 'panel : résultats du jour');
  await p.locator('input[name="actif"][value="loldle"]').uncheck();
  await p.locator('[data-ref-date="sutom"]').fill('2026-10-23');
  await p.locator('#ajx-jdj-form [type="submit"]').click();
  await sleep(400);
  check((await log(p)).some((l) => l[0] === 'jdj_settings') === false, 'panel : référence incomplète refusée côté page');
  await p.locator('[data-ref-n="sutom"]').fill('1500');
  await p.locator('#ajx-jdj-form [type="submit"]').click();
  await sleep(400);
  const st = (await log(p)).filter((l) => l[0] === 'jdj_settings').pop();
  check(st && !st[1].actifs.includes('loldle') && st[1].ref.sutom.n === 1500, 'panel : réglages envoyés');
  await p.locator('#ajx-jdj-list [data-ajx="jdj-rm"]').first().click();
  await p.waitForSelector('dialog[open] .btn-danger, dialog[open] button', { timeout: 3000 }).catch(() => {});
  await p.locator('dialog[open]').getByRole('button', { name: 'Retirer' }).click().catch(() => {});
  await sleep(500);
  check((await log(p)).some((l) => l[0] === 'jdj_remove'), 'panel : retrait d’un résultat confirmé');
  check(p.errs.length === 0, `panel : aucune erreur JS ${p.errs.join(' | ')}`);
  await p.ctx.close();
  await browser.close();
  finish();
})();
