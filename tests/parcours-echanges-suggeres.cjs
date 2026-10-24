// Parcours : bloc « Échanges possibles » en haut de l'onglet Échanges (cartes.html › Échanges).
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénario « suggest » (moi : souhaits C4 et C1, doublons C1, C3, C5 ;
// Alice : deux C1 et souhaits C1, C5 ; Bruno : deux C4 ; Chloé : souhait C3 ; David fantôme, jamais affiché).
// Contrôles : deux listes (« Ils ont une carte de ta liste », « Ils cherchent tes doublons »), échange gagnant-gagnant
// mis en avant et pré-coché des deux côtés, ouverture de l'éditeur pré-rempli (et envoi), tri, « Voir plus »,
// état vide, repli client si la fonction SQL manque (PGRST202) : même résultat ; 390 px sans défilement horizontal ;
// aucune erreur JS ni console.
// Lancer : node tests/parcours-echanges-suggeres.cjs
const { ROOT, check, finish, openPage, log, hscroll, sleep, chromium } = require('./lib/harness.cjs');
/** Ouvre un onglet de Cartes par son adresse : les onglets internes sont masqués (nouvel en-tête). */
const goTab = (p, id) => p.evaluate((id) => { if (location.hash === '#' + id) location.hash = ''; location.hash = id; }, id);

const DIALOG = '#trd-edit[open]';
const SUGG = '#trd-sugg';
const ITEM = `${SUGG} .trd-sugg-item`;

/** Ouvre l'onglet Échanges et attend le bloc « Échanges possibles » (ou son message). */
async function openTab(p) {
  await goTab(p, 'echanges');
  await p.waitForSelector(`${SUGG} .trd-sugg-box, ${SUGG} .trd-hint`, { timeout: 5000 });
  await sleep(200);
}
/** Texte (espaces réduits) de l'élément sel, ou chaîne vide. */
const txt = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim());
/** Pseudos des membres suggérés, dans l'ordre affiché. */
const names = (p) => p.$$eval(`${ITEM} h3`, (h) => h.map((x) => x.textContent.trim()));
/** Identifiants des cartes cochées dans la grille d'un côté de l'éditeur. */
const checked = (p, side) => p.$$eval(`#trd-grid-${side} button[aria-pressed="true"]`, (b) => b.map((x) => x.dataset.id));
/** Ouvre le bouton « Proposer un échange » du membre n-ième (0 = premier) et attend l'éditeur. */
async function openSugg(p, i) {
  await p.locator(`${ITEM} [data-act=sugg-open]`).nth(i).click();
  await p.waitForSelector(DIALOG, { timeout: 5000 });
  await sleep(150);
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const SCN = { suggest: true };

  /* ---------- Ordinateur 1280 px : contenu et ouverture de l'éditeur ---------- */
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: SCN, width: 1280, height: 900 });
  await openTab(p);
  check(await p.isVisible(`${SUGG} .trd-sugg-box`), 'bloc « Échanges possibles » visible en haut de l’onglet Échanges');
  check(JSON.stringify(await names(p)) === JSON.stringify(['Alice', 'Bruno', 'Chloé']),
    'membres suggérés : Alice (gagnant-gagnant) puis Bruno et Chloé ; David (fantôme) absent');
  check(await p.isVisible(`${ITEM}.is-both`) && /Échange gagnant-gagnant/.test(await txt(p, `${ITEM}.is-both`)),
    'Alice mise en avant : « Échange gagnant-gagnant »');
  const sec = (i) => p.$$eval(`${ITEM}`, (items, k) => [...items[k].querySelectorAll('.trd-sugg-part h4')].map((h) => h.textContent.trim()), i);
  check(JSON.stringify(await sec(0)) === JSON.stringify(['Ils ont une carte de ta liste', 'Ils cherchent tes doublons']),
    'Alice : les deux listes');
  check(JSON.stringify(await sec(1)) === JSON.stringify(['Ils ont une carte de ta liste']), 'Bruno : seulement « Ils ont une carte de ta liste »');
  check(JSON.stringify(await sec(2)) === JSON.stringify(['Ils cherchent tes doublons']), 'Chloé : seulement « Ils cherchent tes doublons »');
  check(await p.$$eval(`${ITEM}:first-child .trd-cards .hgc`, (c) => c.length) === 3, 'Alice : 3 vignettes (1 demandée, 2 données)');

  // Alice : les deux côtés sont pré-cochés
  await openSugg(p, 0);
  check(await txt(p, '#trd-edit-title') === 'Proposer un échange à Alice', 'bouton d’Alice : éditeur « Proposer un échange à Alice »');
  check(JSON.stringify(await checked(p, 'want')) === JSON.stringify(['101']), 'Alice : « Je demande » pré-coché (sa carte C1, exemplaire 101)');
  check(JSON.stringify((await checked(p, 'give')).sort()) === JSON.stringify(['1', '10']), 'Alice : « Je donne » pré-coché (mes C1 et C5, exemplaires 1 et 10)');
  check(await txt(p, '#trd-n-want') === '1 carte sélectionnée' && await txt(p, '#trd-n-give') === '2 cartes sélectionnées', 'compteurs de sélection des deux côtés');
  await p.fill('#trd-msg', 'Un échange qui nous arrange');
  await p.click('#trd-send');
  await p.waitForSelector(DIALOG, { state: 'detached', timeout: 4000 }).catch(() => {});
  await sleep(300);
  const sent = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_trade_propose');
  check(sent.length === 1 && JSON.stringify(sent[0][2].p_give) === '[1,10]' && JSON.stringify(sent[0][2].p_want) === '[101]' && sent[0][2].p_to === '00000002-0000-4000-8000-000000000002',
    'envoi depuis la suggestion : hg_trade_propose avec mes C1 et C5 (1, 10) contre la carte 101, destinataire Alice');

  // Bruno : seulement « Je demande »
  await openSugg(p, 1);
  check(await txt(p, '#trd-edit-title') === 'Proposer un échange à Bruno', 'bouton de Bruno : éditeur pour Bruno');
  check(JSON.stringify(await checked(p, 'want')) === JSON.stringify(['201']) && (await checked(p, 'give')).length === 0,
    'Bruno : seulement « Je demande » pré-coché (exemplaire 201)');
  await p.keyboard.press('Escape');
  await sleep(120);

  // Chloé : seulement « Je donne »
  await openSugg(p, 2);
  check(await txt(p, '#trd-edit-title') === 'Proposer un échange à Chloé', 'bouton de Chloé : éditeur pour Chloé');
  check(JSON.stringify(await checked(p, 'give')) === JSON.stringify(['5']) && (await checked(p, 'want')).length === 0,
    'Chloé : seulement « Je donne » pré-coché (mon C3, exemplaire 5)');
  await p.keyboard.press('Escape');
  await sleep(120);
  check(!p.errs.length, 'ordinateur : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Repli client : la fonction SQL n'existe pas encore (PGRST202) ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { suggest: true, suggFail: true }, width: 1280, height: 900 });
  await openTab(p);
  check(JSON.stringify(await names(p)) === JSON.stringify(['Alice', 'Bruno', 'Chloé']), 'repli client : mêmes membres, même ordre');
  check(await p.isVisible(`${ITEM}.is-both`), 'repli client : Alice reste en échange gagnant-gagnant');
  check((await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_trade_suggestions'), 'repli client : la fonction a bien été essayée en premier');
  check(!p.errs.length, 'repli client : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Liste longue : six membres, puis « Voir plus » ---------- */
  const many = Array.from({ length: 8 }, (_, i) => ({ user_id: i % 2 ? '00000002-0000-4000-8000-000000000002' : '00000003-0000-4000-8000-000000000003',
    pseudo: 'x', want: [{ card_id: 'C1', copy_id: i % 2 ? 101 : 102 }], give: [], both: false, n_want: 1, n_give: 0 }));
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { suggestions: many }, width: 1280, height: 900 });
  await openTab(p);
  check(await p.$$eval(ITEM, (x) => x.length) === 6, 'liste longue : six membres affichés d’abord');
  check(/Voir plus \(2\)/.test(await txt(p, `${SUGG} [data-act=sugg-more]`)), 'bouton « Voir plus (2) »');
  await p.click(`${SUGG} [data-act=sugg-more]`);
  await sleep(80);
  check(await p.$$eval(ITEM, (x) => x.length) === 8 && /Voir moins/.test(await txt(p, `${SUGG} [data-act=sugg-more]`)), '« Voir plus » : les huit membres, bouton « Voir moins »');
  check(!p.errs.length, 'liste longue : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Aucune suggestion : message, pas de bloc vide ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: { suggestions: [] }, width: 1280, height: 900 });
  await openTab(p);
  check(/Aucun échange possible pour le moment/.test(await txt(p, SUGG)), 'sans suggestion : message « Aucun échange possible pour le moment »');
  check(await p.$$eval(ITEM, (x) => x.length) === 0, 'sans suggestion : aucune carte de membre');
  await p.ctx.close();

  /* ---------- Téléphone 390 px : pas de défilement horizontal ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: SCN, width: 390, height: 844, touch: true });
  await openTab(p);
  check(await p.isVisible(`${SUGG} .trd-sugg-box`), '390 px : bloc « Échanges possibles » visible');
  check(await hscroll(p) === 0, '390 px : pas de défilement horizontal de la page');
  check(await p.evaluate(() => { const s = document.getElementById('trd-sugg'); return s.scrollWidth <= s.clientWidth + 1; }),
    '390 px : pas de débordement horizontal dans le bloc');
  await openSugg(p, 0);
  check(await hscroll(p) === 0, '390 px : pas de défilement horizontal avec l’éditeur ouvert');
  check(!p.errs.length, '390 px : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
