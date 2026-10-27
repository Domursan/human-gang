// Parcours : collection d'un autre membre, en lecture seule (/pages/cartes/cartes.html#collection/<id>).
// 1. Depuis le Classement : clic sur le pseudo d'Alice, vue « Collection de Alice » (onglets masqués, adresse à jour).
// 2. Mêmes filtres que « Collection » : Série « Toutes les séries », Rareté, Famille, Afficher (dont « Ses doublons que je n’ai pas »).
// 3. Repères : « Tu ne l’as pas », « Doublon chez lui » ; cartes qu’elle n’a pas en « ??? » ; compteur X / Y.
// 4. Aucune action de modification (pas de recyclage, de fabrication, de souhait) ; carte agrandie (loupe) avec ses exemplaires.
// 5. Sélection de cartes demandées, puis « Proposer un échange » : l’éditeur s’ouvre avec Alice et les cartes pré-cochées.
// 6. Depuis la fiche membre (/pages/compte/membre.html) et l’onglet Échanges : liens « Voir sa collection ». Adresse directe, retour, ma propre collection.
// 7. Téléphone 390 px : sans défilement horizontal ; défilement conservé au retour ; aucune erreur console.
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénario « echanges » (Alice : C1 x2, C5, C8, C9, C12 x2, C13 ; moi : C1 x3, C5 x2…).
// Lancer : node tests/parcours/cartes/parcours-collection-autre.cjs
const fs = require('fs');
const path = require('path');
const { ROOT, SHOTS, check, finish, openPage, log, hscroll, sleep, chromium } = require('../../lib/harness.cjs');
/** Ouvre un onglet de Cartes par son adresse : les onglets internes sont masqués (nouvel en-tête). */
const goTab = (p, id) => p.evaluate((id) => { if (location.hash === '#' + id) location.hash = ''; location.hash = id; }, id);

const ALICE = '00000002-0000-4000-8000-000000000002';
const ME = '11111111-1111-4111-8111-111111111111';
const SCN = { echanges: true, set2Open: true };
/** Texte (espaces réduits) de l'élément sel. */
const txt = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim());
/** Étiquettes affichées sur la carte card dans la collection (lues dans le DOM). */
const tags = (p, card) => p.$$eval(`.pv-cell:has(.cz-zoom[data-card="${card}"]) .pv-tag`, (x) => x.map((e) => e.textContent.trim()));
/** Adresse (hash) courante de la page. */
const hashNow = (p) => p.evaluate(() => location.hash);
// Affiché = présent à l’écran (boîte rendue), pas seulement sans attribut hidden
/** Vrai si l'élément sel existe et est affiché. */
const visible = (p, sel) => p.$eval(sel, (e) => e.getClientRects().length > 0).catch(() => false);

(async () => {
  console.log('Racine testée : ' + ROOT);
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  // ---------- 1. Depuis le Classement ----------
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN });
  await goTab(p, 'classement');
  await p.waitForSelector('.cartes-lb-link', { timeout: 5000 });
  const liens = await p.$$eval('.cartes-lb-link', (x) => x.map((a) => [a.textContent, a.getAttribute('href')]));
  check(liens.length === 1 && liens[0][0] === 'Alice' && liens[0][1] === '#collection/' + ALICE, 'classement : seul Alice a un lien vers sa collection (' + JSON.stringify(liens) + ')');
  check((await p.$$eval('.cartes-lb strong', (x) => x.some((s) => s.querySelector('a') && s.textContent.includes('Ethan')))) === false, 'classement : pas de lien sur ma propre ligne');
  await p.click('.cartes-lb-link');
  await p.waitForSelector('#cartes-peer-title', { timeout: 5000 });
  await sleep(200);
  check(await txt(p, '#cartes-peer-title') === 'Collection de Alice', 'vue : titre « Collection de Alice »');
  check((await hashNow(p)) === '#collection/' + ALICE, 'adresse : #collection/<id> d’Alice');
  check(!(await visible(p, '#cartes-tablist')) && !(await visible(p, '#cartes-p-classement')), 'vue : onglets et panneaux masqués');
  check(await visible(p, '#cartes-peer'), 'vue : collection affichée');
  check(await txt(p, '.cartes-progress-label') === '6 / 12 cartes obtenues par Alice (toutes les séries)', 'compteur : « 6 / 12 cartes obtenues par Alice » (' + (await txt(p, '.cartes-progress-label')) + ')');
  check((await p.$$('.pv-cell')).length === 13, 'grille : 13 cartes (12 de la Première édition + 1 de la Saison 2)');
  check((await p.$$('.hgc.is-missing')).length === 7, 'cartes non possédées par Alice affichées en « ??? » (7)');
  // Aucune action de modification dans la vue
  const actions = await p.$$eval('#cartes-peer [data-action]', (x) => [...new Set(x.map((e) => e.dataset.action))]);
  const interdites = actions.filter((a) => !/^peer-|^zoom-card$/.test(a));
  check(interdites.length === 0, 'aucune action de modification dans la vue (actions : ' + actions.join(', ') + ')');
  check(!(await p.$('#cartes-peer [data-action=mass], #cartes-peer [data-action=recycle], #cartes-peer [data-action=craft], #cartes-peer [data-action=wish]')), 'pas de recyclage, fabrication ni souhait');
  check(!(await p.$('#cartes-peer .cartes-tab')), 'pas d’onglets de la page');

  // Repères d'échange
  check((await tags(p, 'C1')).join('|') === 'Doublon chez lui', 'repère C1 : « Doublon chez lui » seulement (j’en ai 3) (' + (await tags(p, 'C1')).join('|') + ')');
  check((await tags(p, 'C8')).join('|') === 'Tu ne l’as pas', 'repère C8 : « Tu ne l’as pas » (' + (await tags(p, 'C8')).join('|') + ')');
  check((await tags(p, 'C12')).sort().join('|') === 'Doublon chez lui|Tu ne l’as pas', 'repère C12 : doublon chez lui et « Tu ne l’as pas » (' + (await tags(p, 'C12')).join('|') + ')');
  check((await tags(p, 'C2')).length === 0, 'carte qu’elle n’a pas : aucun repère (??? seulement)');
  check((await p.$eval('.pv-cell:has(.cz-zoom[data-card="C1"]) .hgc', (e) => e.querySelector('.hgc-count')?.textContent)) === '×2', 'C1 : ×2 (deux exemplaires chez Alice)');

  // Filtre « Ses doublons que je n’ai pas » (C12 seulement)
  await p.selectOption('#peer-f-owned', 'dupes_missing');
  await sleep(120);
  const dm = await p.$$eval('.pv-cell .cz-zoom', (x) => x.map((b) => b.dataset.card));
  check(JSON.stringify(dm) === '["C12"]', 'filtre « Ses doublons que je n’ai pas » : seulement C12 (' + dm.join(',') + ')');
  check(await p.evaluate(() => document.activeElement?.id) === 'peer-f-owned', 'filtre : le focus reste sur le champ modifié');
  await p.selectOption('#peer-f-owned', 'owned');
  await sleep(100);
  check((await p.$$('.pv-cell')).length === 6, 'filtre « Possédées par lui » : 6 cartes');
  await p.selectOption('#peer-f-owned', 'all');
  await p.selectOption('#peer-f-owned', 'dupes');
  await p.selectOption('#peer-f-rarity', 'mythique');
  await sleep(100);
  check((await p.$$('.pv-cell')).length === 0 && /Aucune carte/.test(await txt(p, '#cartes-peer')), 'filtres sans correspondance (doublons + mythique) : message');
  await p.selectOption('#peer-f-rarity', '');
  await p.selectOption('#peer-f-owned', 'all');
  await sleep(100);

  // Série : une seule série puis retour
  await p.selectOption('#peer-set', 'SET2');
  await sleep(100);
  check((await p.$$('.pv-cell')).length === 1 && (await p.$$('.cz-group')).length === 0, 'série « Saison 2 » : une carte, sans intertitre');
  await p.selectOption('#peer-set', '__all__');
  await sleep(100);
  check((await p.$$('.cz-group')).length === 2, 'retour à « Toutes les séries » : deux intertitres');

  // Sélection (demandées) et loupe
  await p.click('[data-action=peer-pick][data-card="C12"]');
  await sleep(120);
  check((await p.getAttribute('[data-action=peer-pick][data-card="C12"]', 'aria-pressed')) === 'true', 'sélection : C12 demandée (aria-pressed)');
  check(await p.evaluate(() => document.activeElement?.dataset?.card) === 'C12', 'sélection : le focus reste sur la carte cochée');
  await p.click('[data-action=peer-pick][data-card="C1"]');
  await sleep(120);
  check(/2 cartes sélectionnées/.test(await txt(p, '#peer-sel')), 'sélection : « 2 cartes sélectionnées » (' + (await txt(p, '#peer-sel')) + ')');
  check(await p.$eval('[data-action=peer-pick][data-card="C5"]', (b) => b.getAttribute('aria-pressed')) === 'false', 'carte non sélectionnée : aria-pressed false');
  await p.click('.cz-zoom[data-card="C8"]');
  await p.waitForSelector('#cz-dialog[open]', { timeout: 3000 }).catch(() => {});
  check(await p.$eval('#cz-dialog', (d) => d.open), 'loupe : carte agrandie ouverte');
  check((await txt(p, '#cz-eyebrow')).startsWith('Collection de Alice'), 'carte agrandie : en-tête « Collection de Alice » (' + (await txt(p, '#cz-eyebrow')) + ')');
  check((await txt(p, '#cz-info .cz-sec')) === 'Dans sa collection', 'carte agrandie : titre « Dans sa collection »');
  check((await p.$$('#cz-info .cz-copies li')).length === 1, 'carte agrandie : son exemplaire de C8 (serial 3)');
  await p.keyboard.press('Escape');
  await sleep(120);
  check(!(await p.$eval('#cz-dialog', (d) => d.open)), 'Échap : carte agrandie fermée');
  await p.screenshot({ path: path.join(SHOTS, 'peer-1440-collection.png') });

  // Proposer un échange : l’éditeur s’ouvre avec Alice et les cartes cochées dans « Je demande »
  await p.click('[data-action=peer-offer]');
  await p.waitForSelector('#trd-edit[open]', { timeout: 5000 }).catch(() => {});
  await sleep(250);
  check(await p.$eval('#trd-edit', (d) => d.open), 'proposer : l’éditeur d’offre s’ouvre');
  check((await txt(p, '#trd-edit-title')) === 'Proposer un échange à Alice', 'proposer : titre « Proposer un échange à Alice »');
  const pre = await p.$$eval('#trd-grid-want button[data-side=want][aria-pressed=true]', (x) => x.map((b) => b.dataset.id).sort());
  check(JSON.stringify(pre) === JSON.stringify(['101', '106']), 'proposer : cartes demandées pré-cochées dans « Je demande » (' + pre.join(',') + ')');
  check((await p.$$eval('#trd-grid-give button[data-side=give][aria-pressed=true]', (x) => x.length)) === 0, '« Je donne » : rien de coché');
  await p.click('#trd-edit [data-act=close-editor]');
  await sleep(120);
  await p.screenshot({ path: path.join(SHOTS, 'peer-1440-echange.png') });
  check(!(await p.$eval('#trd-edit', (d) => d.open)), 'éditeur fermé');
  check(await p.$eval('#cartes-p-echanges', (e) => !e.hidden), 'après « Proposer » : onglet Échanges affiché');
  check(!(await visible(p, '#cartes-peer')), 'après « Proposer » : vue membre fermée');
  check((await hashNow(p)) === '' || (await hashNow(p)) === '#', 'après « Proposer » : adresse sans #collection');
  check(!p.errs.length, 'vue membre : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // ---------- 2. Retour, ma propre collection, adresse directe ----------
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '#collection/' + ALICE });
  await p.waitForSelector('#cartes-peer-title', { timeout: 5000 });
  check(await txt(p, '#cartes-peer-title') === 'Collection de Alice', 'adresse directe : la collection d’Alice s’ouvre');
  await p.click('[data-action=peer-back]');
  await sleep(150);
  check(await visible(p, '#cartes-section-h') && !(await visible(p, '#cartes-peer')), 'Retour : retour aux onglets (titre de section affiché)');
  check((await hashNow(p)) === '' || (await hashNow(p)) === '#', 'Retour : adresse nettoyée');
  await p.ctx.close();

  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '#collection/' + ME });
  await sleep(300);
  check(await visible(p, '#cartes-p-collection') && !(await visible(p, '#cartes-peer')), 'ma propre adresse : ma collection (onglet normal), pas de vue lecture seule');
  await p.ctx.close();

  // Adresse invalide : rien ne s’ouvre
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '#collection/pas-un-id' });
  await sleep(300);
  check(await visible(p, '#cartes-section-h') && !(await visible(p, '#cartes-peer')), 'adresse invalide : onglets normaux (titre de section affiché)');
  await p.ctx.close();

  // ---------- 3. Onglet Échanges : choix d'un membre puis « Voir sa collection » ----------
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN });
  await goTab(p, 'echanges');
  await p.waitForSelector('#trd-tab-proposer', { timeout: 5000 });
  await p.click('#trd-tab-proposer');
  check(!(await p.$eval('[data-peer-link]', (a) => a.getClientRects().length > 0)), 'Échanges : « Voir sa collection » masqué sans membre choisi');
  await p.selectOption('#trd-who', ALICE);
  await sleep(100);
  check(await p.$eval('[data-peer-link]', (a) => a.getClientRects().length > 0 && a.getAttribute('href') === '#collection/00000002-0000-4000-8000-000000000002'), 'Échanges : « Voir sa collection » pour Alice');
  await p.click('[data-peer-link]');
  await p.waitForSelector('#cartes-peer-title', { timeout: 5000 });
  check(await txt(p, '#cartes-peer-title') === 'Collection de Alice', 'Échanges : la collection d’Alice s’ouvre');
  await p.click('[data-action=peer-back]');
  await sleep(150);
  check(await p.$eval('#cartes-p-echanges', (e) => !e.hidden), 'Retour : on revient à l’onglet Échanges');
  await p.ctx.close();

  // ---------- 4. Fiche membre : bouton « Voir sa collection » ----------
  p = await openPage(browser, { page: 'membre', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '?id=' + ALICE });
  await p.waitForSelector('#mb-actions a', { timeout: 5000 }).catch(() => {});
  const lien = await p.$eval('#mb-actions a', (a) => [a.textContent.trim(), a.getAttribute('href')]).catch(() => null);
  check(lien && lien[0] === 'Voir sa collection' && lien[1] === '/pages/cartes/cartes.html#collection/' + ALICE, 'fiche membre d’Alice : bouton « Voir sa collection » (' + JSON.stringify(lien) + ')');
  await p.click('#mb-actions a');
  await p.waitForSelector('#cartes-peer-title', { timeout: 5000 }).catch(() => {});
  check(await txt(p, '#cartes-peer-title') === 'Collection de Alice', 'bouton de la fiche membre : ouvre la collection');
  await p.ctx.close();

  p = await openPage(browser, { page: 'membre', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '?id=' + ME });
  await sleep(400);
  check(!(await p.$('#mb-actions a')) && !(await visible(p, '#mb-actions')), 'ma propre fiche : pas de bouton');
  check(!p.errs.length, 'fiche membre : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // ---------- 5. Téléphone 390 px ----------
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, height: 844, scenario: SCN, touch: true, hash: '#collection/' + ALICE });
  await p.waitForSelector('#cartes-peer-title', { timeout: 5000 });
  await sleep(200);
  check((await hscroll(p)) === 0, 'téléphone 390 px : pas de défilement horizontal (' + (await hscroll(p)) + ' px)');
  await p.click('[data-action=peer-pick][data-card="C12"]');
  await p.evaluate(() => window.scrollTo(0, 400));
  await sleep(120);
  const y0 = await p.evaluate(() => window.scrollY);
  // Clic par le DOM : Playwright ferait défiler jusqu’à la carte avant de cliquer (hors sujet ici)
  await p.$eval('[data-action=peer-pick][data-card="C1"]', (b) => b.click());
  await sleep(150);
  const y1 = await p.evaluate(() => window.scrollY);
  check(Math.abs(y1 - y0) < 2, 'téléphone : défilement conservé après une sélection (' + y0 + ' → ' + y1 + ')');
  await p.selectOption('#peer-f-owned', 'dupes_missing');
  await sleep(120);
  check((await hscroll(p)) === 0, 'téléphone : pas de défilement horizontal après filtre');
  await p.screenshot({ path: path.join(SHOTS, 'peer-390-collection.png') });
  check(!p.errs.length, 'téléphone : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // ---------- 6. Membre introuvable (fantôme ou compte supprimé) ----------
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900, scenario: SCN, hash: '#collection/99999999-0000-4000-8000-000000000009' });
  await p.waitForSelector('#cartes-peer .empty', { timeout: 5000 }).catch(() => {});
  check(/introuvable/.test(await txt(p, '#cartes-peer')), 'membre introuvable : message, sans erreur');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch(async (e) => { console.error(e); process.exitCode = 1; process.exit(1); });
