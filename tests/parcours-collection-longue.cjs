// Parcours : collection très longue (idée Q5). Faux Supabase fixtures/fake-sb-cartes.mjs, scénario bigCollection :
// 2 000 cartes en 4 séries + les 12 de la première série, 5 000 exemplaires.
// Vérifie : premier dessin rapide (performance.measure « hg-collection »), dessin par lots de 120 avec compteur exact,
// « Afficher 120 de plus » (focus sur la première carte ajoutée), chargement automatique en approchant du bas,
// carte agrandie « Suivante » au-delà du lot dessiné, recherche sans accents, recyclage des doublons calculé sur toute
// la collection, pas de défilement horizontal à 360 px.
// Lancer : node tests/parcours-collection-longue.cjs
const { ROOT, check, finish, openPage, sleep, chromium } = require('./lib/harness.cjs');

const SCN = { bigCollection: true };
const cells = (p) => p.$$eval('#cartes-p-collection .cz-cell', (x) => x.length);
const dernierDessin = (p) => p.evaluate(() => { const m = performance.getEntriesByName('hg-collection'); return m.length ? m[m.length - 1].duration : -1; });

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: SCN });
  await p.click('[data-tab=collection]');
  await p.waitForSelector('#cartes-set', { timeout: 10000 });
  await p.selectOption('#cartes-set', '__all__');
  await sleep(300);
  const ms = await dernierDessin(p);
  console.log(`       premier dessin « Toutes les séries » : ${ms.toFixed(1)} ms`);
  check(ms >= 0 && ms < 150, `premier dessin sous 150 ms (${ms.toFixed(1)} ms)`);
  const total = await p.evaluate(() => window.__DB.hg_cards.filter((c) => ['SET1', 'SETB0', 'SETB1', 'SETB2', 'SETB3'].includes(c.set_id)).length);
  check(await cells(p) === 120, 'premier lot : 120 cartes dessinées');
  const compteur = (await p.textContent('.cz-more-count')).replace(/\s+/g, ' ');
  check(new RegExp(`^120 cartes affichées sur ${String(total).replace(/\B(?=(\d{3})+$)/g, '.')}$`).test(compteur), `compteur exact (« ${compteur} », ${total} cartes)`);
  check(await p.locator('[data-action=more-cards]').count() === 1, 'bouton « Afficher 120 de plus »');

  // Afficher plus : 240 cartes, le focus va sur la première carte ajoutée
  // Clic par script : un vrai clic ferait défiler la page jusqu'au bouton, et l'approche du bas chargerait déjà le lot suivant.
  await p.evaluate(() => document.querySelector('[data-action=more-cards]').click());
  await sleep(200);
  check(await cells(p) === 240, 'après « Afficher plus » : 240 cartes');
  const focus = await p.evaluate(() => document.activeElement?.closest('.cz-cell') ? [...document.querySelectorAll('#cartes-p-collection .cz-cell')].indexOf(document.activeElement.closest('.cz-cell')) : -1);
  check(focus === 120, `focus sur la première carte ajoutée (case ${focus})`);

  // Carte agrandie : « Suivante » depuis la dernière carte dessinée va au-delà du lot
  const lastId = await p.$$eval('#cartes-p-collection .cz-cell .cz-zoom', (x) => x[x.length - 1].dataset.card);
  await p.evaluate((id) => document.querySelector(`.cz-zoom[data-card="${id}"]`).click(), lastId);
  await p.waitForSelector('#cz-dialog[open]', { timeout: 3000 });
  const eb1 = await p.textContent('#cz-eyebrow');
  await p.evaluate(() => document.querySelector('#cz-dialog .cz-nav[data-cz=next]').click());
  await sleep(100);
  const eb2 = await p.textContent('#cz-eyebrow');
  check(/ 240 \/ /.test(eb1) && / 241 \/ /.test(eb2), `zoom : « Suivante » passe le lot (${eb1.trim()} → ${eb2.trim()})`);
  await p.keyboard.press('Escape');
  await sleep(150);

  // Recyclage en masse : calculé sur toute la collection, pas sur le lot
  const attendu = await p.evaluate(() => {
    const by = new Map();
    for (const c of window.__DB.hg_card_copies.filter((x) => x.owner_id === '11111111-1111-4111-8111-111111111111')) by.set(c.card_id, (by.get(c.card_id) || []).concat(c));
    let n = 0;
    for (const [id, l] of by) { const k = window.__DB.hg_cards.find((x) => x.id === id); if (!k || k.rarity === 'identite' || k.rarity === 'unique') continue; n += l.slice(1).filter((x) => !x.locked_trade).length; }
    return n;
  });
  const massTxt = (await p.textContent('.cartes-mass')).replace(/\s+/g, ' ');
  check(massTxt.replace(/[’'.  ]/g, '').includes(String(attendu) + 'doublonsrecyclables'), `doublons recyclables sur toute la collection (${attendu}) : « ${massTxt.trim().slice(0, 60)} »`);

  // Recherche sans accents : « raclette » (40 cartes) → tout est dessiné, compteur de résultats
  await p.fill('#cartes-f-q', 'RACLÉTTE');
  await sleep(500);
  const n = await cells(p);
  check(n === 40, `recherche « RACLÉTTE » : 40 cartes (${n})`);
  check(/40 résultats/.test(await p.textContent('#cartes-f-q-n')), 'compteur de résultats');
  check(await p.locator('.cz-more').count() === 0, 'sous 300 cartes : pas de lot, rien ne change');
  check(await p.evaluate(() => document.activeElement?.id === 'cartes-f-q'), 'le focus reste dans le champ de recherche');
  await p.fill('#cartes-f-q', '');
  await sleep(500);
  check(await cells(p) === 120, 'recherche vidée : retour au premier lot');

  // Filtres inchangés : rareté épique → toujours par lots si > 300, comptes cohérents
  await p.selectOption('#cartes-f-rarity', 'epique');
  await sleep(200);
  const epi = await p.$$eval('#cartes-p-collection .hgc', (x) => x.every((c) => c.className.includes('hgc-epique')));
  check(epi, 'filtre rareté : seulement des épiques');
  await p.selectOption('#cartes-f-rarity', '');
  await sleep(200);

  // Chargement automatique en approchant du bas
  await p.evaluate(() => document.querySelector('.cz-sentinel')?.scrollIntoView());
  await sleep(600);
  check(await cells(p) > 120, `en approchant du bas : lot suivant dessiné tout seul (${await cells(p)})`);
  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // Téléphone 360 px : pas de défilement horizontal
  const m = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 360, height: 780, scenario: SCN, mobile: true, dpr: 2 });
  await m.click('[data-tab=collection]');
  await m.waitForSelector('#cartes-set', { timeout: 10000 });
  await m.selectOption('#cartes-set', '__all__');
  await sleep(300);
  check(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360 px : pas de défilement horizontal');
  await m.evaluate(() => document.querySelector('.cz-more')?.scrollIntoView());
  await sleep(200);
  await m.screenshot({ path: require('path').join(require('./lib/harness.cjs').SHOTS, 'collection-longue-360.png') });
  check(!m.errs.length, '360 px : aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));
  await m.ctx.close();

  await browser.close();
  finish();
})();
