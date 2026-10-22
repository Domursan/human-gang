// Parcours : barre d'onglets de la page Cartes (cartes.html).
// 1. Téléphone (360, 390, 430 px) : les six onglets sont en grille (3 colonnes, 2 lignes), tous visibles sans défilement,
//    libellé entier (pas de coupure), icône affichée, pas de défilement horizontal de la page.
// 2. Onglet actif bien marqué ; clic et flèches clavier changent d'onglet comme avant.
// 3. Ordinateur (1280 px) : une seule rangée de libellés, sans icône, soulignement de l'onglet actif.
// Faux Supabase : fixtures/fake-sb-cartes.mjs.
// Lancer : node tests/parcours-cartes-onglets.cjs
const { openPage, check, finish, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const FIXTURE = 'fake-sb-cartes.mjs';
/** Géométrie de chaque onglet (boîte, défilement interne, icône affichée) dans la page. */
const geometrie = (p) => p.evaluate(() => {
  const t = document.querySelector('#cartes-tablist');
  return {
    grille: getComputedStyle(t).display === 'grid',
    largeurTablist: t.clientWidth, scrollTablist: t.scrollWidth,
    onglets: [...t.querySelectorAll('[role=tab]')].map((b) => {
      const r = b.getBoundingClientRect(), ico = b.querySelector('.cartes-tab-ico');
      return {
        id: b.dataset.tab, gauche: r.left, droite: r.right, haut: r.top, bas: r.bottom,
        coupe: b.scrollWidth > b.clientWidth + 1,
        icone: !!ico && getComputedStyle(ico).display !== 'none',
      };
    }),
  };
});

(async () => {
  const browser = await chromium.launch();

  // ---------- 1. Téléphone : grille, tout visible ----------
  for (const w of [360, 390, 430]) {
    const p = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: w, height: 800, touch: true });
    const g = await geometrie(p);
    const ids = g.onglets.map((o) => o.id).join(',');
    check(g.grille, `${w} px : barre d'onglets en grille`);
    check(ids === 'ouverture,inventaire,boutique,collection,classement,echanges', `${w} px : six onglets dans l'ordre (${ids})`);
    check(g.onglets.every((o) => o.gauche >= 0 && o.droite <= w + 0.5), `${w} px : chaque onglet tient dans l'écran, sans défilement`);
    check(g.scrollTablist <= g.largeurTablist + 1, `${w} px : la barre ne défile pas en largeur`);
    check(g.onglets.every((o) => !o.coupe), `${w} px : aucun libellé coupé`);
    check(g.onglets.every((o) => o.icone), `${w} px : chaque onglet a son icône`);
    const lignes = new Set(g.onglets.map((o) => Math.round(o.haut))).size;
    check(lignes === 2, `${w} px : deux lignes de trois onglets (${lignes} ligne(s))`);
    check(await hscroll(p) === 0, `${w} px : pas de défilement horizontal de la page`);
    check(p.errs.length === 0, `${w} px : aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
    if (w === 390) {
      // ---------- 2. Onglet actif et interactions ----------
      const actif = await p.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected'));
      check(actif === 'true', '390 px : Ouverture est l\'onglet actif au départ');
      const bordure = await p.$eval('#cartes-tab-ouverture', (b) => getComputedStyle(b).boxShadow);
      check(bordure !== 'none', '390 px : l\'onglet actif a un contour marqué');
      await p.tap('[data-tab=classement]');
      await sleep(300);
      check(await p.$eval('#cartes-tab-classement', (b) => b.getAttribute('aria-selected')) === 'true', '390 px : un toucher sur Classement l\'active');
      check(await p.$eval('#cartes-p-classement', (s) => !s.hidden), '390 px : le panneau Classement s\'affiche');
      await p.focus('#cartes-tab-classement');
      await p.keyboard.press('ArrowRight');
      await sleep(300);
      check(await p.$eval('#cartes-tab-echanges', (b) => b.getAttribute('aria-selected')) === 'true', '390 px : la flèche droite passe à Échanges');
      check(await p.evaluate(() => document.activeElement?.id) === 'cartes-tab-echanges', '390 px : le focus suit la flèche');
      check(await hscroll(p) === 0, '390 px : pas de défilement horizontal après changement d\'onglet');
      check(p.errs.length === 0, `390 px : aucune erreur console après interactions (${p.errs.join(' | ') || 'rien'})`);
    }
    await p.ctx.close();
  }

  // ---------- 3. Ordinateur : rangée inchangée ----------
  const d = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900 });
  const gd = await geometrie(d);
  check(!gd.grille, '1280 px : barre d\'onglets en rangée (pas en grille)');
  check(gd.onglets.every((o) => !o.icone), '1280 px : pas d\'icône sur les onglets');
  check(new Set(gd.onglets.map((o) => Math.round(o.haut))).size === 1, '1280 px : les six onglets sur une seule ligne');
  check(d.errs.length === 0, `1280 px : aucune erreur console (${d.errs.join(' | ') || 'rien'})`);
  await d.ctx.close();

  // ---------- 4. Contenu des nouveaux onglets ----------
  // Achat dans la Boutique : mode typé (migration 069), où le classique s'achète avec « Acheter · total ».
  const q = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, scenario: { types: true } });
  check(await q.$eval('#cartes-p-ouverture', (s) => !s.hidden && !!s.querySelector('#cartes-free') && !!s.querySelector('#cartes-stock') && !!s.querySelector('#cartes-quests')),
    'Ouverture : booster gratuit, boosters en stock et quêtes');
  check(await q.$eval('#cartes-p-ouverture', (s) => !s.querySelector('[data-action=buy-stock]')), 'Ouverture : pas d\'achat (il est dans la Boutique)');
  await q.click('[data-tab=boutique]'); await sleep(300);
  check(await q.$eval('#cartes-p-boutique', (s) => !s.hidden && !!s.querySelector('[data-action=buy-stock]') && !!s.querySelector('.cartes-odds')), 'Boutique : booster à acheter (buy-stock) et chances');
  await q.click('[data-tab=inventaire]'); await sleep(300);
  check(await q.$eval('#cartes-p-inventaire', (s) => !s.hidden && !!s.querySelector('#cartes-history') && s.querySelectorAll('.inv-box').length === 3), 'Inventaire : trois blocs et historique des Paillettes');
  check(!(await q.$('#cartes-history-wrap')), 'L\'ancien historique global a disparu');
  await q.click('[data-tab=boutique]'); await sleep(300);
  // Acheter reste dans la Boutique : pas de révélation, et le lien « Les ouvrir » apparaît sous l'article.
  await q.click('#cartes-paid [data-action=buy-stock]'); await sleep(900);
  check(await q.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true', 'Acheter dans la Boutique reste sur la Boutique');
  check(await q.$eval('#cartes-reveal', (r) => r.innerHTML.trim() === ''), 'Acheter : aucune révélation');
  check(await q.$eval('#cartes-paid', (a) => !!a.querySelector('[data-tab-go=ouverture]')), 'Acheter : lien « Les ouvrir » sous l\'article');
  await q.click('#cartes-paid [data-tab-go=ouverture]'); await sleep(300);
  check(await q.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected')) === 'true', '« Les ouvrir » passe sur Ouverture');
  // L'ouverture se fait dans Ouverture : la révélation y reste affichée.
  await q.click('#cartes-p-ouverture [data-action=open-free]'); await sleep(900);
  check(await q.$eval('#cartes-tab-ouverture', (b) => b.getAttribute('aria-selected')) === 'true', 'Ouvrir dans Ouverture : reste sur Ouverture');
  check(await q.$eval('#cartes-reveal', (r) => r.innerHTML.trim().length > 0), 'La révélation s\'affiche dans Ouverture');
  check(q.errs.length === 0, `Contenu : aucune erreur console (${q.errs.join(' | ') || 'rien'})`);
  await q.ctx.close();
  const h = await openPage(browser, { page: 'cartes', fixture: FIXTURE, width: 1280, height: 900, hash: '#boutique' });
  await sleep(300);
  check(await h.$eval('#cartes-tab-boutique', (b) => b.getAttribute('aria-selected')) === 'true' && await h.$eval('#cartes-p-boutique', (s) => !s.hidden), 'cartes.html#boutique ouvre la Boutique');
  await h.ctx.close();

  await browser.close();
  finish();
})();
