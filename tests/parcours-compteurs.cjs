// Parcours : pastilles de compteur « à faire » (assets/js/core/badges-compteur.js).
// Une pastille chiffrée apparaît sur les entrées du menu « Le jeu de cartes » (Ouverture, Échanges) et sur le bouton
// du menu (somme), et sur l'onglet « Sorties » de la page IRL. Elle est absente quand rien n'attend le membre.
// 1. Jeu de cartes : Ouverture = booster gratuit prêt + boosters offerts (ici 1 + 1 = 2) ; Échanges = offres reçues
//    en attente (2) ; le menu porte la somme (4). Ordinateur (1280 px) et téléphone (390 px, menu ouvert).
// 2. Sans rien en attente (booster gratuit pas encore prêt, aucune offre) : aucune pastille.
// 3. Une seule lecture de hg_cards_me par rafraîchissement ; une lecture en erreur ne casse pas la page.
// 4. IRL : onglet « Sorties » avec une sortie à venir sans ma réponse (1), puis sans pastille une fois répondu.
// 5. Visiteur : aucune lecture de compteur (aucune requête hg_cards_me).
// Faux Supabase : fixtures/fake-sb-cartes.mjs (S.trades, S.gift, S.freeAt, S.cardsMeErreur) et fixtures/fake-sb.mjs
// (S.sorties, S.rsvps).
// Lancer : node tests/parcours-compteurs.cjs
const { openPage, check, finish, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const FIXTURE_CARTES = 'fake-sb-cartes.mjs';
const ME = '11111111-1111-4111-8111-111111111111';
const iso = (h) => new Date(Date.now() + h * 3600e3).toISOString();

/** Nombre de lectures hg_cards_me déjà faites (journal du faux client, window.__LOG). */
const lecturesCartes = (p) => p.evaluate(() => (window.__LOG || []).filter((x) => x[0] === 'rpc' && x[1] === 'hg_cards_me').length);
/** Lance une nouvelle lecture des compteurs comme le ferait le retour sur l'onglet (sans attendre la minute). */
const relire = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
/** Texte lu d'une entrée de menu ou d'un onglet, et son chiffre (vide si pas de pastille visible). */
const pastille = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  const b = el?.querySelector(':scope > .cpt-badge');
  const visible = !!b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0;
  return { visible, nombre: b?.querySelector('.cpt-n')?.textContent || '', lu: b?.textContent.trim() || '', nom: el?.textContent.trim() || '' };
}, sel);
/** Ouvre le menu « Le jeu de cartes » (téléphone : d'abord le bouton Menu). */
async function ouvrirMenuCartes(p, w) {
  if (w <= 760) await p.click('.nav-toggle');
  await p.click('button.nav-top[aria-controls="nav-menu-cartes"]');
  await sleep(150);
}

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Jeu de cartes : pastilles avec des éléments en attente ----------
  const gratuitPret = new Date(Date.now() - 1000).toISOString();
  const trades = [
    { id: 'T1', from_user: '22222222-2222-4222-8222-222222222222', to_user: ME, status: 'proposee', created_at: iso(-1) },
    { id: 'T2', from_user: '33333333-3333-4333-8333-333333333333', to_user: ME, status: 'proposee', created_at: iso(-2) },
    { id: 'T3', from_user: ME, to_user: '44444444-4444-4444-8444-444444444444', status: 'proposee', created_at: iso(-3) }, // envoyée par moi : ne compte pas
  ];
  for (const w of [1280, 390]) {
    const p = await openPage(browser, { page: 'cartes', fixture: FIXTURE_CARTES, scenario: { trades, freeAt: gratuitPret, gift: 1 }, width: w, height: 800, touch: w < 600 });
    await sleep(400);
    const avant = await lecturesCartes(p);
    await relire(p);
    await sleep(500);
    const nb = (await lecturesCartes(p)) - avant;
    check(nb === 1, `${w} px : une seule lecture de hg_cards_me par rafraîchissement (${nb})`);
    await ouvrirMenuCartes(p, w);
    const ouv = await pastille(p, 'a[href="cartes.html#ouverture"]');
    const ech = await pastille(p, 'a[href="cartes.html#echanges"]');
    const grp = await pastille(p, '.nav-group[data-menu="cartes"] > .nav-top');
    check(ouv.visible && ouv.nombre === '2', `${w} px : Ouverture porte la pastille 2 (booster gratuit + don) (« ${ouv.lu} »)`);
    check(ech.visible && ech.nombre === '2', `${w} px : Échanges porte la pastille 2, sans compter mes offres envoyées (« ${ech.lu} »)`);
    check(grp.visible && grp.nombre === '4', `${w} px : le menu « Le jeu de cartes » porte la somme 4 (« ${grp.lu} »)`);
    check(ech.lu.includes('à faire') && ouv.nom.includes('Ouverture'), `${w} px : le nombre est lu avec son libellé (« ${ech.lu} »)`);
    check(!(await pastille(p, 'a[href="cartes.html#inventaire"]')).visible, `${w} px : Inventaire (rien à faire) n'a pas de pastille`);
    check(await hscroll(p) === 0, `${w} px : pas de défilement horizontal`);
    check(p.errs.length === 0, `${w} px : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
    await p.close?.();
  }

  // ---------- 2. Rien en attente : aucune pastille ; lecture en erreur : rien d'inventé ----------
  {
    const p = await openPage(browser, { page: 'cartes', fixture: FIXTURE_CARTES, scenario: { freeAt: iso(5), gift: 0 }, width: 1280, height: 800 });
    await sleep(500);
    await ouvrirMenuCartes(p, 1280);
    const ouv = await pastille(p, 'a[href="cartes.html#ouverture"]');
    const ech = await pastille(p, 'a[href="cartes.html#echanges"]');
    const grp = await pastille(p, '.nav-group[data-menu="cartes"] > .nav-top');
    check(!ouv.visible && !ech.visible && !grp.visible, 'sans rien en attente : ni pastille sur Ouverture, Échanges ni le menu');
    check(p.errs.length === 0, `sans rien en attente : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
    await p.close?.();
  }
  {
    const p = await openPage(browser, { page: 'cartes', fixture: FIXTURE_CARTES, scenario: { freeAt: gratuitPret, gift: 1, cardsMeErreur: true }, width: 1280, height: 800 });
    await sleep(500);
    await relire(p);
    await sleep(400);
    check(!(await pastille(p, 'a[href="cartes.html#ouverture"]')).visible, 'lecture de hg_cards_me en erreur : pas de pastille Ouverture inventée');
    check(p.errs.length === 0, `lecture de hg_cards_me en erreur : la page ne plante pas (${p.errs.join(' | ') || 'rien'})`);
    await p.close?.();
  }

  // ---------- 3. IRL : onglet « Sorties » avec une sortie à venir sans ma réponse, puis répondue ----------
  const future = { id: 'EV-FUTUR-0001', title: 'Sortie à venir', location: 'Genève', starts_at: iso(72), created_by: '22222222-2222-4222-8222-222222222222' };
  for (const w of [1280, 390]) {
    const p = await openPage(browser, { page: 'irl', width: w, height: 800, touch: w < 600, scenario: { sorties: [future], rsvps: [] } });
    await sleep(600);
    const t = await pastille(p, '#tab-sorties');
    check(t.visible && t.nombre === '1', `IRL ${w} px : l'onglet Sorties porte la pastille 1 (« ${t.lu} »)`);
    check(await hscroll(p) === 0, `IRL ${w} px : pas de défilement horizontal`);
    check(p.errs.length === 0, `IRL ${w} px : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
    await p.close?.();
  }
  {
    const p = await openPage(browser, { page: 'irl', width: 1280, height: 800, scenario: { sorties: [future], rsvps: [{ event_id: future.id, user_id: ME, status: 'oui' }] } });
    await sleep(600);
    const t = await pastille(p, '#tab-sorties');
    check(!t.visible, 'IRL : sortie à venir déjà répondue : pas de pastille sur l\'onglet Sorties');
    await p.close?.();
  }

  // ---------- 4. Visiteur : aucune lecture de compteur ----------
  {
    const p = await openPage(browser, { page: 'accueil', fixture: FIXTURE_CARTES, width: 1280, height: 800, scenario: { guest: true } });
    await relire(p);
    await sleep(500);
    const nb = await lecturesCartes(p);
    check(nb === 0, `visiteur : aucune lecture de compteur (${nb} hg_cards_me)`);
    check(!(await p.$('[data-cpt]')), 'visiteur : aucun élément à compteur dans la page');
    await p.close?.();
  }

  await browser.close();
  finish();
})();
