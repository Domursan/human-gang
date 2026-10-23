// Parcours : Capsule temporelle (capsule.html), idée S7.
// Liste des capsules ; capsule scellée (compte à rebours, compteur, mes dépôts, dépôt, retrait, 3 au plus) ;
// dépôts fermés ; capsule ouverte (objets, vote sur une prédiction, « Ouverture ensemble » avec auteur révélé) ;
// création par le Staff ; 360 px ; aucune erreur JS.
// Faux Supabase : fixtures/fake-sb-contenus.mjs (scénarios capsuleOpen, capsuleClosed).
const { SHOTS, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const FX = 'fake-sb-contenus.mjs';
const CAP = 'cccccccc-0000-4000-8000-000000000001';

(async () => {
  const browser = await chromium.launch();
  /* ---------- Liste ---------- */
  let p = await openPage(browser, { page: 'capsule', fixture: FX });
  await p.waitForSelector('.cp-li', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.cp-li').count()) === 1 && (await p.locator('.cp-li').innerText()).includes('Nouvel an 2027'), 'liste : une capsule');
  check((await p.locator('.cp-li').innerText()).includes('3 membres ont glissé 3 objets'), 'liste : compteur sans contenu');
  check((await p.locator('#cp-new').count()) === 1, 'liste : le Staff peut créer une capsule');
  await p.click('#cp-new');
  await p.fill('#ce-title', 'Lettre au RDV 2027');
  await p.fill('#ce-dep', '2027-05-01T20:00');
  await p.fill('#ce-open', '2027-04-01T20:00');
  await p.click('dialog.ct-dialog button[type="submit"]');
  await sleep(300);
  check((await p.locator('.ct-dlg-err').innerText()).includes('L’ouverture doit suivre'), 'création : ouverture avant la fin des dépôts refusée');
  await p.click('dialog.ct-dialog [data-close]');
  check(p.errs.length === 0, 'liste : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Capsule scellée ---------- */
  p = await openPage(browser, { page: 'capsule', fixture: FX, hash: '' });
  await p.goto(`${new URL(p.url()).origin}${new URL(p.url()).pathname}?id=${CAP}`);
  await p.waitForSelector('.cp-hero', { timeout: 5000 }).catch(() => {});
  // textContent et non innerText : la classe .eyebrow passe le texte en majuscules (innerText le renverrait en « SCELLÉE »).
  check((await p.locator('.cp-hero').textContent()).includes('scellée'), 'scellée : libellé « Capsule temporelle · scellée »');
  check((await p.locator('.cp-cd > div').count()) === 4, 'scellée : compte à rebours en 4 cases');
  check(/\d+ jours/.test(await p.locator('.cp-cd').getAttribute('aria-label')), 'scellée : compte à rebours lisible (aria-label)');
  check((await p.locator('.cp-count').innerText()).includes('3 membres') && (await p.locator('.cp-count').innerText()).includes('3 objets'), 'scellée : « 3 membres ont glissé 3 objets »');
  check((await p.locator('.cp-item').count()) === 1, 'scellée : je ne vois que mon dépôt');
  check(!(await p.locator('#app').innerText()).includes('Bonne année le gang'), 'scellée : le mot d’Alice n’est pas affiché');
  check((await p.locator('.cp-mine-head').innerText()).includes('1 sur 3'), 'scellée : « 1 sur 3 »');
  await p.click('[data-kind="prediction"]');
  check((await p.locator('[data-kind="prediction"]').getAttribute('aria-pressed')) === 'true', 'type : « Prédiction » choisi (aria-pressed)');
  await p.click('.cp-submit');
  check((await p.locator('.cp-err').innerText()).includes('Écris ta prédiction'), 'dépôt vide refusé');
  await p.fill('#cp-body', 'KC gagne les Worlds');
  await p.click('.cp-submit');
  await sleep(400);
  const dep = (await log(p)).filter((e) => e[1] === 'hg_capsule_deposit');
  check(dep.length === 1 && dep[0][2].p_kind === 'prediction' && dep[0][2].p_body === 'KC gagne les Worlds', 'dépôt : hg_capsule_deposit (prédiction)');
  check((await p.locator('.cp-item').count()) === 2, 'dépôt : apparaît dans mes dépôts');
  await p.fill('#cp-body', 'Troisième');
  await p.click('.cp-submit');
  await sleep(400);
  check((await p.locator('#cp-form').count()) === 0 && (await p.locator('.cp-mine').innerText()).includes('tes 3 objets'), 'après 3 dépôts : plus de formulaire');
  await p.locator('[data-withdraw]').first().click();
  await sleep(400);
  check((await log(p)).some((e) => e[1] === 'hg_capsule_withdraw') && (await p.locator('.cp-item').count()) === 2, 'retrait : l’objet quitte la capsule');
  check(p.errs.length === 0, 'scellée : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Dépôts fermés ---------- */
  p = await openPage(browser, { page: 'capsule', fixture: FX, scenario: { capsuleClosed: true } });
  await p.goto(`${new URL(p.url()).origin}${new URL(p.url()).pathname}?id=${CAP}`);
  await p.waitForSelector('.cp-hero', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#cp-form').count()) === 0 && (await p.locator('[data-withdraw]').count()) === 0, 'dépôts fermés : ni formulaire ni retrait');
  await p.ctx.close();

  /* ---------- Capsule ouverte ---------- */
  p = await openPage(browser, { page: 'capsule', fixture: FX, scenario: { capsuleOpen: true } });
  await p.goto(`${new URL(p.url()).origin}${new URL(p.url()).pathname}?id=${CAP}`);
  await p.waitForSelector('.cp-open-item', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.cp-open-item').count()) === 3, 'ouverte : les 3 objets');
  check((await p.locator('#app').innerText()).includes('Bonne année le gang'), 'ouverte : le mot d’Alice est lisible');
  await p.click('[data-verdict="realisee"]');
  await sleep(300);
  check((await log(p)).some((e) => e[1] === 'hg_capsule_vote' && e[2].p_verdict === 'realisee') && (await p.locator('[data-verdict="realisee"]').innerText()).includes('1'), 'prédiction : vote « Réalisée »');
  await p.click('#cp-show');
  check(await p.locator('dialog.cp-show[open]').isVisible(), 'ouverture ensemble : plein écran');
  check((await p.locator('.cp-show-who').innerText()).trim() === '', 'ouverture ensemble : auteur caché au départ');
  await p.click('[data-show="reveal"]');
  check((await p.locator('.cp-show-who').innerText()).startsWith('—'), 'ouverture ensemble : auteur révélé après l’objet');
  await p.click('[data-show="next"]');
  check((await p.locator('.cp-show-n').innerText()).startsWith('2 /'), 'ouverture ensemble : objet suivant');
  await p.keyboard.press('Escape');
  check((await p.locator('dialog.cp-show').count()) === 0, 'ouverture ensemble : Échap ferme');
  await p.screenshot({ path: path.join(SHOTS, 'S7-ouverte.png'), fullPage: true }).catch(() => {});
  check(p.errs.length === 0, 'ouverte : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  for (const w of [360, 390]) {
    p = await openPage(browser, { page: 'capsule', fixture: FX, width: w, height: 844 });
    await p.goto(`${new URL(p.url()).origin}${new URL(p.url()).pathname}?id=${CAP}`);
    await p.waitForSelector('.cp-hero', { timeout: 5000 }).catch(() => {});
    check(await hscroll(p) <= 0, `${w} px : pas de défilement horizontal`);
    await p.screenshot({ path: path.join(SHOTS, `S7-${w}.png`), fullPage: true }).catch(() => {});
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
