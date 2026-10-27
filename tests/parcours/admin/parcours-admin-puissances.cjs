// Parcours admin : puissance des cartes (Fabrique › Arène, bloc « Puissance des cartes », admin/puissances.js).
// Catégories : valeurs affichées (enregistrées, défauts en placeholder), aperçu en direct, enregistrement par fusion
// dans hg_settings.cards.puissances (les autres sous-clés et les clés inconnues restent), « Valeur par défaut »,
// refus d'une valeur hors 0 à 20. Par carte : filtres (Mythiques, Uniques, Les OG, Hors série, Tous), recherche,
// badge « Valeur propre », enregistrement et retour à la catégorie par hg_card_power_set (arguments vérifiés, base
// mise à jour), refus d'une valeur invalide. 390 px sans défilement horizontal ; aucune erreur JS.
// Faux : tests/fixtures/fake-sb-puissances.mjs (cartes, réglage « cards », RPC hg_card_power_set).
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');
const path = require('path');

const SHOTS = path.join(__dirname, '..', '..', 'shots');
const EXPLICATION = 'Puissance en duel = puissance de la carte + bonus si brillante + 2 si la famille a l’avantage';

/** Réglage « cards » tel qu'il est en base (fake). */
const cardsEnBase = (p) => p.evaluate(() => window.__DB.hg_settings.find((r) => r.key === 'cards')?.value);
/** Carte telle qu'elle est en base (fake). */
const carteEnBase = (p, id) => p.evaluate((i) => window.__DB.hg_cards.find((c) => c.id === i) || null, id);
/** Lignes affichées dans la liste par carte : nom et valeur propre (ou non). */
const lignes = (p) => p.evaluate(() => [...document.querySelectorAll('#pu-liste .puiss-ligne')].map((li) => ({
  id: li.dataset.id, nom: li.querySelector('.puiss-nom strong')?.textContent || '', propre: /Valeur propre/.test(li.textContent),
  saisie: li.querySelector('input').value, placeholder: li.querySelector('input').placeholder,
})));

(async () => {
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-puissances.mjs', width: 1280, height: 900, reducedMotion: 'reduce' });
  await adminSection(p, 'fabrique/arene');
  await p.waitForSelector('#pu-cat-form', { timeout: 6000 }).catch(() => {});
  await p.waitForSelector('#pu-liste .puiss-ligne', { timeout: 6000 }).catch(() => {});

  await p.setViewportSize({ width: 1280, height: 2600 });
  await sleep(300);
  await p.locator('.puiss').screenshot({ path: path.join(SHOTS, 'puissances-admin.png') });
  await p.setViewportSize({ width: 1280, height: 900 });
  /* ---------- Puissance par catégorie ---------- */
  check(await p.locator('#pu-cat-form').count() === 1, 'catégories : formulaire présent dans la section Arène');
  check(await p.locator('#pu-f-legendaire').inputValue() === '4', 'catégories : Légendaire enregistrée (4) affichée');
  check(await p.locator('#pu-f-legendaire').getAttribute('placeholder') === '5', 'catégories : défaut 5 en placeholder de Légendaire');
  check(await p.locator('#pu-f-commune').inputValue() === '0', 'catégories : Commune enregistrée (0), pas le défaut');
  check(await p.locator('#pu-f-rare').inputValue() === '', 'catégories : Rare sans valeur enregistrée (vide = défaut 3)');
  check(await p.locator('#pu-f-brillante').getAttribute('placeholder') === '1', 'catégories : bonus d’une brillante, défaut 1');
  check((await p.locator('#pu-explic').innerText()).includes(EXPLICATION), 'catégories : explication « ' + EXPLICATION + ' »');
  await p.fill('#pu-f-legendaire', '6');
  await p.fill('#pu-f-brillante', '2');
  check((await p.locator('#pu-explic').innerText()).includes('6 + 2 + 2 = 10'), 'catégories : aperçu en direct (Légendaire 6, brillante 2 : 6 + 2 + 2 = 10)');
  await p.fill('#pu-f-brillante', '1');
  // Mythique : repliée, puis enregistrée seulement si saisie
  check(await p.locator('#pu-f-mythique').isHidden(), 'catégories : Mythique, Identité et Unique repliées par défaut');
  await p.click('.puiss-plus summary');
  check(await p.locator('#pu-f-mythique').isVisible(), 'catégories : le pli s’ouvre (Mythique visible)');

  // Refus d'une valeur hors bornes : rien n'est écrit
  const avant = (await log(p)).filter((e) => e[0] === 'upsert' && e[1] === 'hg_settings').length;
  await p.fill('#pu-f-epique', '25');
  await p.click('#pu-cat-form button[type="submit"]');
  await sleep(250);
  check(!(await p.locator('#pu-err').isHidden()) && (await p.locator('#pu-err').innerText()).includes('Épique'), 'catégories : 25 refusé, le message nomme Épique');
  check((await log(p)).filter((e) => e[0] === 'upsert' && e[1] === 'hg_settings').length === avant, 'catégories : aucune écriture quand une valeur est invalide');
  await p.fill('#pu-f-epique', '');

  // Enregistrement par fusion : Légendaire 6, Mythique 8 ; Commune retirée (défaut) ; sous-clés inconnues conservées
  await p.fill('#pu-f-legendaire', '6');
  await p.fill('#pu-f-mythique', '8');
  await p.click('#pu-cat-form [data-defaut="commune"]');
  check(await p.locator('#pu-f-commune').inputValue() === '', '« Valeur par défaut » : le champ Commune se vide');
  await p.click('#pu-cat-form button[type="submit"]');
  await sleep(300);
  let cards = await cardsEnBase(p);
  check(cards?.puissances?.legendaire === 6, 'enregistrement : Légendaire 6 écrite dans puissances');
  check(cards?.puissances?.mythique === 8, 'enregistrement : Mythique 8 écrite dans puissances');
  check(!('commune' in (cards?.puissances || {})), 'enregistrement : Commune vide retire la clé (le défaut s’applique)');
  check(cards?.puissances?.futur_reglage === 2, 'enregistrement : clé inconnue de puissances conservée');
  check(cards?.quetes_preuve_par_semaine === 3 && cards?.tag_labels?.hiver === 'Hiver', 'enregistrement : autres réglages de « cards » intacts');
  const ecr = (await log(p)).filter((e) => e[0] === 'upsert' && e[1] === 'hg_settings' && e[2]?.key === 'cards');
  check(ecr.length >= 1, 'enregistrement : une écriture de hg_settings « cards »');
  check((await p.locator('#pu-f-legendaire').inputValue()) === '6', 'enregistrement : valeurs réaffichées après enregistrement');

  /* ---------- Puissance par carte ---------- */
  const chip = (f) => p.click(`.puiss-chip[data-f="${f}"]`);
  const noms = async () => (await lignes(p)).map((l) => l.nom).sort();
  await chip('mythique');
  check(JSON.stringify(await noms()) === JSON.stringify(['Ethan', 'Serge']), 'filtre Mythiques : Serge et Ethan');
  await chip('unique');
  check(JSON.stringify(await noms()) === JSON.stringify(['La Domu-mobile', 'Le Tzatzikistan']), 'filtre Uniques : les deux uniques');
  await chip('og');
  check(JSON.stringify(await noms()) === JSON.stringify(['Alice', 'Bruno', 'Ethan']), 'filtre Les OG : Alice, Bruno, Ethan');
  await chip('hors');
  check(JSON.stringify(await noms()) === JSON.stringify(['Le gobelet', 'La Domu-mobile', 'Le Tzatzikistan'].sort()), 'filtre Hors série : gobelet et uniques');
  await chip('tous');
  const tous = await noms();
  check(tous.length === 7 && !tous.includes('Lyon 2026') && !tous.includes('Raclette'), 'filtre Tous : 7 cartes, sans les cartes hors liste');
  check((await p.locator('.puiss-chip[data-f="tous"]').getAttribute('aria-pressed')) === 'true', 'filtre : le chip actif est marqué (aria-pressed)');

  // Recherche (sans accents)
  await p.fill('#pu-recherche', 'domu');
  check(JSON.stringify(await noms()) === JSON.stringify(['La Domu-mobile']), 'recherche : « domu » trouve La Domu-mobile');
  await p.fill('#pu-recherche', '');

  // Valeur propre et valeur de catégorie
  const L = Object.fromEntries((await lignes(p)).map((l) => [l.nom, l]));
  check(L['Ethan'].propre && L['Ethan'].saisie === '7', 'carte : Ethan a sa valeur propre (7) et le badge');
  check(!L['Serge'].propre && L['Serge'].saisie === '' && L['Serge'].placeholder === '8', 'carte : Serge suit sa catégorie (placeholder 8, Mythique réglée)');
  check((await p.locator('#pu-liste li', { hasText: 'Le Tzatzikistan' }).innerText()).includes('puissance en duel : 9'), 'carte : puissance effective affichée (9)');

  // Enregistrer une valeur propre
  const rowSerge = p.locator('#pu-liste .puiss-ligne', { hasText: 'Serge' });
  await rowSerge.locator('input').fill('9');
  await rowSerge.locator('button', { hasText: 'Enregistrer' }).click();
  await sleep(250);
  let rpc = (await log(p)).filter((e) => e[1] === 'hg_card_power_set');
  check(rpc.length === 1 && rpc[0][2].p_card === 'M1' && rpc[0][2].p_power === 9, 'enregistrer : hg_card_power_set(M1, 9) appelée avec les bons arguments');
  check((await carteEnBase(p, 'M1'))?.power === 9, 'enregistrer : la base porte la valeur propre 9');
  const serge = (await lignes(p)).find((l) => l.nom === 'Serge');
  check(serge.propre && serge.saisie === '9', 'enregistrer : la ligne montre la valeur propre');

  // Retour à la catégorie
  const rowEthan = p.locator('#pu-liste .puiss-ligne', { hasText: 'Ethan' });
  await rowEthan.locator('button', { hasText: 'Revenir à la catégorie' }).click();
  await sleep(250);
  rpc = (await log(p)).filter((e) => e[1] === 'hg_card_power_set');
  check(rpc.length === 2 && rpc[1][2].p_card === 'M2' && rpc[1][2].p_power === null, 'retour : hg_card_power_set(M2, null) appelée');
  check((await carteEnBase(p, 'M2'))?.power === null, 'retour : la base n’a plus de valeur propre (null)');
  const ethan = (await lignes(p)).find((l) => l.nom === 'Ethan');
  check(!ethan.propre && ethan.saisie === '' && ethan.placeholder === '8', 'retour : Ethan revient à la catégorie (placeholder 8)');

  // Vide dans la saisie = retour à la catégorie
  await p.locator('#pu-liste .puiss-ligne', { hasText: 'La Domu-mobile' }).locator('input').fill('');
  await p.locator('#pu-liste .puiss-ligne', { hasText: 'La Domu-mobile' }).locator('button', { hasText: 'Enregistrer' }).click();
  await sleep(250);
  rpc = (await log(p)).filter((e) => e[1] === 'hg_card_power_set');
  check(rpc.length === 3 && rpc[2][2].p_power === null, 'enregistrer vide : envoie null (retour à la catégorie)');

  // Valeur invalide : aucun appel
  await p.locator('#pu-liste .puiss-ligne', { hasText: 'Le gobelet' }).locator('input').fill('21');
  await p.locator('#pu-liste .puiss-ligne', { hasText: 'Le gobelet' }).locator('button', { hasText: 'Enregistrer' }).click();
  await sleep(200);
  rpc = (await log(p)).filter((e) => e[1] === 'hg_card_power_set');
  check(rpc.length === 3, 'carte : 21 refusé côté écran (aucun appel)');

  /* ---------- 390 px ---------- */
  await p.setViewportSize({ width: 390, height: 900 });
  await sleep(250);
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (panel Arène)');
  await p.setViewportSize({ width: 360, height: 800 });
  await sleep(200);
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (panel Arène)');

  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
