// Parcours : onglet « Boosters » du Jeu de cartes dans le panel admin (admin.html), sur le faux Supabase (fake-sb.mjs).
// Couvre : liste des 9 types (cartouche miniature, ordre, statistiques), éditeur en tiroir (sous-sections, total des taux en direct,
// chances, valeur de recyclage et alerte > 60 %, simulateur de 1 000 ouvertures), enregistrement (charge utile complète de
// hg_booster_type_save), total ≠ 100 qui bloque l'enregistrement, création d'un type, identifiant déjà pris, retrait de la vente
// avec confirmation dans la ligne puis remise en vente, ordre (descendre), lecture seule pour un Staff sans la permission « cartes »,
// 390 px sans défilement horizontal, aucune erreur console. Captures (1280 px, échelle 2) dans scratchpad/nuit2/shots/.
// Les contrôles portent sur l'état du faux (window.__DB) et sur les appels reçus (window.__LOG).
// Lancer : node tests/parcours-admin-boosters.cjs
const fs = require('fs');
const path = require('path');
const { check, finish, openPage, adminSection, hscroll, chromium } = require('./lib/harness.cjs');

const SHOTS = '/tmp/claude-0/-home-claude/745c1954-a6f8-5445-b8b6-c526f6aef9c2/scratchpad/nuit2/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const ALICE = '00000002-0000-4000-8000-000000000002';
/** Appels de hg_booster_type_save reçus par le faux (charges utiles). */
const saves = (p) => p.evaluate(() => (window.__LOG || []).filter((x) => x[0] === 'booster_type_save').map((x) => x[2]));
/** Ligne d'un type dans la base simulée. */
const typeRow = (p, id) => p.evaluate((i) => window.__DB.hg_booster_types.find((t) => t.id === i), id);
/** Attend que le tiroir soit fermé (retiré de la page). */
const waitClosed = (p) => p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
/** Ouvre l'onglet Boosters et attend la liste. */
async function openTab(p) {
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
}
/** Ouvre l'éditeur du type id. */
async function openEdit(p, id) {
  await p.click(`[data-bt="edit"][data-id="${id}"]`);
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
}
/** Déplie une sous-section de l'éditeur si elle est repliée. */
async function openSec(p, id) {
  const open = await p.evaluate((i) => document.querySelector(`#abt-sec-${i}`).open, id);
  if (!open) await p.click(`#abt-sec-${id} > summary`);
}
/** Champs attendus dans chaque charge utile de hg_booster_type_save. */
const KEYS = ['id', 'name', 'price', 'size', 'rates', 'shiny_rate', 'pity_epique', 'pool', 'weekly_limit', 'free_daily', 'style', 'description', 'active', 'sort', 'excluded_rarities', 'excluded_sets'].sort();

(async () => {
  const browser = await chromium.launch();
  // Captures nettes : toutes les pages de ce test sont en échelle 2 (deviceScaleFactor), sans toucher au harnais.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (o = {}) => newContext({ ...o, deviceScaleFactor: 2 });

  /* ---------- (a) Admin 1280 px : liste ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await openTab(p);
  const ids = await p.$$eval('.abt-row', (rs) => rs.map((r) => r.dataset.type));
  check(ids.length === 9, `(a) liste : 9 types affichés (${ids.length})`);
  check(ids.join(',') === 'classique,serie,argente,dore,diamant,quitte_double,collectionneur,holographique,identite', '(a) liste : triée par ordre (sort)');
  check(await p.locator('.abt-row .abt-cart .cart-box.cart--diamant').count() === 1, '(a) liste : cartouche miniature avec son style');
  check(await p.evaluate(() => !!document.querySelector('link[data-abt-css]')), '(a) cartes-boosters.css chargée à la demande');
  const bg = await p.$eval('.abt-row[data-type="dore"] .cart-body', (e) => getComputedStyle(e).backgroundImage);
  check(/gradient/.test(bg), '(a) variante « Doré » appliquée (dégradé de cartes-boosters.css)');
  check((await p.textContent('.abt-row[data-type="classique"]')).includes('Gratuit du jour'), '(a) le booster gratuit du jour est signalé');
  check((await p.textContent('.abt-row[data-type="diamant"]')).includes('5 par semaine'), '(a) limite par semaine affichée');
  check(/vendus sur 7 j/.test(await p.textContent('.abt-row[data-type="serie"]')), '(a) ventes 7 j affichées (hg_booster_type_stats)');
  check(await p.locator('.abt-stats tbody tr').count() === 9, '(a) tableau des ventes : une ligne par type');
  check(await p.locator('[data-bt="new"]').count() === 1, '(a) bouton « Nouveau type » présent');
  await p.screenshot({ path: path.join(SHOTS, 'boosters-liste-1280.png'), fullPage: true });

  /* ---------- (b) Éditeur : modifier Argenté et enregistrer ---------- */
  await openEdit(p, 'argente');
  await p.screenshot({ path: path.join(SHOTS, 'boosters-editeur-1280.png') });
  check(await p.locator('.abt-sec').count() === 5, '(b) éditeur : 5 sous-sections repliables (Général, Contenu, Limites, Chances, Simulateur)');
  check(await p.locator('.abt-style input[name="style"]').count() === 9, '(b) sélecteur de style : 9 cartouches');
  check(await p.isChecked('.abt-style input[value="cart--argente"]'), '(b) style actuel coché');
  check(await p.getAttribute('#abt-id', 'readonly') !== null, '(b) identifiant non modifiable pour un type existant');
  check((await p.textContent('#abt-total')).includes('100'), '(b) total des taux en direct : 100 %');
  check(await p.isEnabled('[data-drawer-submit]'), '(b) total = 100 : Enregistrer actif');
  check(/Épique ou mieux/.test(await p.textContent('#abt-live')) && /du prix/.test(await p.textContent('#abt-live')), '(b) chances et valeur de recyclage affichées');
  const cols = await p.$$eval('.abt-cols > .abt-col', (cs) => cs.map((c) => Math.round(c.getBoundingClientRect().left)));
  check(cols.length === 2 && cols[0] !== cols[1], '(b) deux colonnes sur grand écran');
  await p.fill('#abt-name', 'Argenté+');
  await p.fill('#abt-price', '300');
  await p.click('.abt-style:has(input[value="cart--dore"])');
  await openSec(p, 'contenu');
  await p.check('input[name="ex_rar"][value="identite"]');
  await p.fill('#abt-set-q', 'hallo');
  check(await p.locator('#abt-setlist > li:not([hidden])').count() === 1, '(b) séries exclues : la recherche filtre la liste');
  await p.check('input[name="ex_set"][value="halloween"]');
  check((await p.textContent('#abt-sets-n')).includes('1 exclue'), '(b) compteur des séries exclues');
  check((await p.textContent('#abt-preview .cart-lbl2')) === 'ARGENTÉ+', '(b) aperçu de la cartouche mis à jour');
  await openSec(p, 'limites');
  await p.fill('#abt-weekly_limit', '7');
  await p.click('[data-drawer-submit]');
  await waitClosed(p);
  let sv = await saves(p);
  const last = sv[sv.length - 1] || {};
  check(sv.length === 1 && last.id === 'argente', '(b) enregistrer : un appel hg_booster_type_save pour « argente »');
  const changedKeys = 'excluded_rarities,excluded_sets,id,name,price,style,weekly_limit';
  check(Object.keys(last).sort().join(',') === changedKeys, `(b) modification : seulement l'id et les champs changés (${Object.keys(last).sort().join(',')})`);
  check(last.create === undefined, '(b) modification : pas de drapeau create');
  check(last.name === 'Argenté+' && last.price === 300 && last.style === 'cart--dore' && last.weekly_limit === 7, '(b) charge utile : nom, prix, style, limite');
  check(JSON.stringify(last.excluded_rarities) === '["identite"]' && JSON.stringify(last.excluded_sets) === '["halloween"]', '(b) charge utile : raretés et séries exclues');
  const arg = await typeRow(p, 'argente');
  check(arg.rates.rare === 14.88 && arg.pity_epique === 20 && arg.active === true, '(b) champs non envoyés inchangés en base');
  await p.waitForSelector('.abt-row[data-type="argente"]', { timeout: 5000 });
  check((await p.textContent('.abt-row[data-type="argente"]')).includes('Argenté+'), '(b) liste rafraîchie après enregistrement');
  check((await typeRow(p, 'argente')).price === 300, '(b) base simulée à jour');

  /* ---------- (c) Total ≠ 100 : enregistrement bloqué ; simulateur ---------- */
  await openEdit(p, 'dore');
  await p.fill('#abt-rate-commune', '40');
  check(await p.evaluate(() => document.querySelector('#abt-total').classList.contains('is-err')), '(c) total ≠ 100 : état d\'erreur');
  check(/106/.test(await p.textContent('#abt-total')), '(c) total en direct (106 %)');
  check(await p.isDisabled('[data-drawer-submit]'), '(c) total ≠ 100 : Enregistrer désactivé');
  await p.press('#abt-name', 'Enter');
  await p.waitForTimeout(300);
  check((await saves(p)).length === 1, '(c) total ≠ 100 : Entrée n\'envoie rien');
  check(await p.locator('dialog.ui-drawer[open]').count() === 1, '(c) le tiroir reste ouvert');
  await p.fill('#abt-rate-commune', '34');
  check(await p.isEnabled('[data-drawer-submit]'), '(c) total revenu à 100 : Enregistrer actif');
  await openSec(p, 'sim');
  await p.click('[data-sim]');
  await p.waitForSelector('#abt-sim table', { timeout: 3000 });
  const simRows = await p.locator('#abt-sim tbody tr').count();
  const simTotal = await p.$$eval('#abt-sim tbody tr td:nth-child(2)', (tds) => tds.reduce((s, td) => s + Number(td.textContent.replace(/\D/g, '')), 0));
  await p.$eval('dialog.ui-drawer[open] .ui-drawer-body', (b) => { const r = b.querySelector('#abt-live').getBoundingClientRect(); b.scrollTop += r.top - b.getBoundingClientRect().top - 12; });
  await p.screenshot({ path: path.join(SHOTS, 'boosters-chances-simulateur-1280.png') });
  check(simRows === 7 && simTotal === 5000, `(c) simulateur : 7 raretés, 5 000 cartes (${simTotal})`);
  await p.click('dialog.ui-drawer[open] .ui-drawer-foot [data-drawer-close]');
  await waitClosed(p);
  check((await typeRow(p, 'dore')).rates.commune === 34, '(c) annuler : rien n\'est enregistré');

  /* ---------- (d) Alerte recyclage > 60 % ---------- */
  await openEdit(p, 'classique');
  check(await p.locator('#abt-live .abt-warn').count() === 1, '(d) Classique à 100 ✦ : alerte « plus de 60 % du prix »');
  await p.fill('#abt-price', '1000');
  check(await p.locator('#abt-live .abt-warn').count() === 0, '(d) prix 1 000 ✦ : plus d\'alerte');
  await p.click('dialog.ui-drawer[open] .ui-drawer-x');
  await waitClosed(p);

  /* ---------- (e) Nouveau type ---------- */
  await p.click('[data-bt="new"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  check((await p.textContent('dialog.ui-drawer[open] .ui-drawer-title')) === 'Nouveau type de booster', '(e) « Nouveau type » ouvre l\'éditeur');
  await p.fill('#abt-name', 'Booster d\'été');
  check(await p.inputValue('#abt-id') === 'booster_d_ete', `(e) identifiant proposé à partir du nom (${await p.inputValue('#abt-id')})`);
  await p.fill('#abt-id', 'classique');
  await p.click('[data-drawer-submit]');
  await p.waitForTimeout(300);
  check(/existe déjà/.test(await p.textContent('dialog.ui-drawer[open] .form-error')), '(e) identifiant déjà pris : message clair');
  check((await saves(p)).length === 1, '(e) identifiant déjà pris : rien n\'est envoyé');
  await p.fill('#abt-id', 'ete');
  await p.click('.abt-style:has(input[value="cart--holo"])');
  await openSec(p, 'contenu');
  await p.check('input[name="pool"][value="serie"]');
  await openSec(p, 'limites');
  await p.fill('#abt-weekly_limit', '3');
  await p.click('[data-drawer-submit]');
  await waitClosed(p);
  sv = await saves(p);
  const created = sv[sv.length - 1] || {};
  check(sv.length === 2 && created.id === 'ete' && created.name === 'Booster d\'été' && created.style === 'cart--holo' && created.pool === 'serie' && created.weekly_limit === 3,
    '(e) création : charge utile (id, nom, style, contenu, limite)');
  check(created.create === true && JSON.stringify(Object.keys(created).filter((k) => k !== 'create').sort()) === JSON.stringify(KEYS), '(e) création : { create: true, id, …tous les champs }');
  check(created.active === false && created.sort === 100 && Object.keys(created.rates).length === 7, '(e) création : retiré de la vente par défaut, rangé à la fin, 7 taux');
  await p.waitForSelector('.abt-row[data-type="ete"]', { timeout: 5000 });
  check(await p.locator('.abt-row').count() === 10, '(e) le nouveau type apparaît dans la liste');

  /* ---------- (e2) Gratuit du jour : un seul type ; toast avec les types concernés ---------- */
  await openEdit(p, 'serie');
  await p.check('input[name="free_daily"]');
  await p.click('[data-drawer-submit]');
  await waitClosed(p);
  check((await typeRow(p, 'serie')).free_daily === true && (await typeRow(p, 'classique')).free_daily === false, '(e2) gratuit du jour déplacé sur Série');
  check(/retiré de « Classique »/.test(await p.evaluate(() => document.body.innerText)), '(e2) toast : gratuit du jour retiré de « Classique »');
  await openEdit(p, 'classique');
  await p.check('input[name="free_daily"]');
  await p.click('[data-drawer-submit]');
  await waitClosed(p);
  check((await typeRow(p, 'classique')).free_daily === true, '(e2) remis sur Classique');

  /* ---------- (e3) Message du serveur affiché tel quel ---------- */
  await openEdit(p, 'holographique');
  await p.evaluate(() => { window.__SCN.boosterSaveError = 'Série inconnue : zzz'; });
  await p.fill('#abt-price', '1200');
  await p.click('[data-drawer-submit]');
  await p.waitForTimeout(300);
  check((await p.textContent('dialog.ui-drawer[open] .form-error')) === 'Série inconnue : zzz', '(e3) erreur du serveur affichée telle quelle, tiroir ouvert');
  await p.evaluate(() => { window.__SCN.boosterSaveError = null; });
  await p.click('dialog.ui-drawer[open] .ui-drawer-x');
  await waitClosed(p);

  /* ---------- (f) Retirer de la vente (confirmation dans la ligne), remettre en vente ---------- */
  await p.click('[data-bt="off"][data-id="diamant"]');
  check(await p.isVisible('.abt-row[data-type="diamant"] .abt-confirm'), '(f) Désactiver : confirmation dans la ligne');
  await p.click('[data-bt="off-no"][data-id="diamant"]');
  check(await p.locator('.abt-confirm').count() === 0 && (await typeRow(p, 'diamant')).active === true, '(f) Annuler : rien ne change');
  await p.click('[data-bt="off"][data-id="diamant"]');
  await p.click('[data-bt="off-ok"][data-id="diamant"]');
  await p.waitForSelector('[data-bt="on"][data-id="diamant"]', { timeout: 5000 });
  check((await typeRow(p, 'diamant')).active === false, '(f) confirmé : type retiré de la vente (active = false)');
  check((await p.textContent('.abt-row[data-type="diamant"]')).includes('Retiré'), '(f) la ligne indique « Retiré »');
  sv = await saves(p);
  check(JSON.stringify(sv[sv.length - 1]) === '{"id":"diamant","active":false}', `(f) charge utile : { id, active: false } (${JSON.stringify(sv[sv.length - 1])})`);
  await p.click('[data-bt="on"][data-id="diamant"]');
  await p.waitForSelector('[data-bt="off"][data-id="diamant"]', { timeout: 5000 });
  check((await typeRow(p, 'diamant')).active === true, '(f) Activer : remis en vente');

  /* ---------- (g) Ordre : descendre Classique ---------- */
  await p.click('[data-bt="down"][data-id="classique"]');
  await p.waitForFunction(() => document.querySelector('.abt-row')?.dataset.type === 'serie', null, { timeout: 5000 }).catch(() => {});
  const c = await typeRow(p, 'classique'), s = await typeRow(p, 'serie');
  check(c.sort > s.sort, `(g) Descendre : Classique passe après Série (${c.sort} > ${s.sort})`);
  check((await p.$$eval('.abt-row', (rs) => rs.map((r) => r.dataset.type))).slice(0, 2).join(',') === 'serie,classique', '(g) liste réordonnée');
  check(await p.isDisabled('[data-bt="up"][data-id="serie"]'), '(g) le premier type ne peut pas monter');
  check(p.errs.length === 0, '(a–g) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- (h) Staff sans la permission « cartes » : lecture seule ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, scenario: { uid: ALICE, staff: ['quiz'] } });
  check(await p.locator('#shell-subs a[href="#cartes/boosters"]').count() === 0, '(h) Staff « quiz » : pas d\'onglet Boosters dans la navigation');
  await p.evaluate(async () => {
    const m = await import(new URL('assets/js/admin-cards/boosters.js', location.href).href);
    const el = document.createElement('div');
    el.id = 'abt-test-ro';
    el.className = 'acd';
    document.querySelector('#app')?.prepend(el);
    await m.mountBoostersTab(el);
  });
  await p.waitForSelector('#abt-test-ro .abt-row', { timeout: 5000 });
  check(await p.locator('#abt-test-ro .abt-row').count() === 9, '(h) lecture seule : les 9 types sont listés');
  check(await p.locator('#abt-test-ro [data-bt="new"], #abt-test-ro [data-bt="off"], #abt-test-ro [data-bt="up"], #abt-test-ro [data-bt="down"]').count() === 0,
    '(h) lecture seule : ni « Nouveau type », ni Activer/Désactiver, ni ordre');
  check(/Lecture seule/.test(await p.textContent('#abt-test-ro .acd-note')), '(h) lecture seule : explication affichée');
  check(/indisponibles/.test(await p.textContent('#abt-test-ro')), '(h) statistiques refusées : message, pas d\'erreur');
  await p.click('#abt-test-ro [data-bt="edit"][data-id="dore"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  check(await p.locator('dialog.ui-drawer[open] [data-drawer-submit]').count() === 0, '(h) lecture seule : pas de bouton Enregistrer');
  check(await p.isDisabled('#abt-name') && await p.isDisabled('#abt-rate-commune') && await p.isDisabled('.abt-style input[value="cart--holo"]'), '(h) lecture seule : champs désactivés');
  await openSec(p, 'sim');
  await p.click('[data-sim]');
  check(await p.locator('#abt-sim tbody tr').count() === 7, '(h) lecture seule : le simulateur reste utilisable');
  await p.click('dialog.ui-drawer[open] .ui-drawer-x');
  check((await saves(p)).length === 0, '(h) lecture seule : aucun enregistrement');
  check(p.errs.length === 0, '(h) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* Staff avec « cartes » : écriture permise */
  p = await openPage(browser, { page: 'admin', width: 1280, scenario: { uid: ALICE, staff: ['cartes'] } });
  await openTab(p);
  check(await p.locator('[data-bt="new"]').count() === 1 && await p.locator('.acd-note').count() === 0, '(h) Staff « cartes » : écriture permise');
  check(p.errs.length === 0, '(h) Staff « cartes » : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- (i) Mobile 390 px ---------- */
  p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
  await openTab(p);
  let hs = await hscroll(p);
  check(hs <= 0, `(i) 390 px : liste sans défilement horizontal (hscroll=${hs})`);
  const small = await p.$$eval('.abt-row button', (bs) => bs.filter((b) => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44).length);
  check(small === 0, `(i) 390 px : boutons d'au moins 44 px (${small} trop petits)`);
  await p.screenshot({ path: path.join(SHOTS, 'boosters-liste-390.png'), fullPage: true });
  await openEdit(p, 'collectionneur');
  await openSec(p, 'contenu');
  const over = await p.$eval('dialog.ui-drawer[open] .ui-drawer-body', (b) => b.scrollWidth - b.clientWidth);
  hs = await hscroll(p);
  check(over <= 0 && hs <= 0, `(i) 390 px : éditeur sans défilement horizontal (tiroir ${over}, page ${hs})`);
  check(await p.isChecked('input[name="ex_rar"][value="identite"]') && await p.isChecked('input[name="ex_set"][value="gang-membres"]'), '(i) Collectionneur : identité et « Les OG » exclues (071)');
  await p.screenshot({ path: path.join(SHOTS, 'boosters-editeur-390.png') });
  check(p.errs.length === 0, '(i) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
