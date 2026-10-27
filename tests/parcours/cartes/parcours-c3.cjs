// Parcours C3 (migration 080) : brillantes « fondues » du booster Raclette.
// 1. Collection : une brillante dont l'exemplaire porte finish = 'fondue' affiche le fromage (is-fondue, calque hgc-fondue)
//    au lieu du reflet holographique ; une brillante ordinaire garde son reflet.
// 2. Fenêtre agrandie : même rendu, libellé « brillante fondue ».
// 3. Effets : animé si permis ; figé avec « mouvement réduit ».
// 4. Boutique : la cartouche Raclette (cart--raclette) et « Dernière fournée » la dernière semaine.
const { openPage, check, finish, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const RATES = { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 };
const scenario = {
  types: true, bal: 5000,
  c080: {
    hg_card_copies: [{ id: 900, card_id: 'C6', owner_id: ME, shiny: true, serial: null, source: 'booster', obtained_at: iso(-1), locked_trade: null, recycled_at: null, finish: 'fondue' }],
    hg_booster_types: [{ id: 'raclette', name: 'Raclette', price: 120, size: 5, rates: RATES, shiny_rate: 6, pity_epique: 0, pool: 'tous', weekly_limit: 5, free_daily: false,
      active: true, style: 'cart--raclette', sort: 25, shiny_style: 'fondue', description: 'De décembre à février. Série « L’hiver du gang » ; ses brillantes sont fondues.',
      available_until: iso(2.5), on_shelf: true, open_now: true, only_set: 'hiver-raclette', only_set_name: 'L’hiver du gang' }],
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const motion of ['no-preference', 'reduce']) {
    const p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario, hash: '#collection', width: 1100, reducedMotion: motion });
    await p.waitForSelector('#cartes-p-collection .hgc', { timeout: 8000 });
    await p.evaluate(() => document.documentElement.setAttribute('data-fx', 'on'));
    const fondue = '#cartes-p-collection .hgc[data-card="C6"]';
    if (motion === 'no-preference') {
      check(await p.$(`${fondue}.is-fondue .hgc-fondue`), '(1) brillante fondue : calque de fromage');
      check(!(await p.$(`${fondue} .hgc-holo`)), '(1) pas de reflet holographique sur la fondue');
      check(await p.$('#cartes-p-collection .hgc[data-card="C7"].is-shiny .hgc-holo'), '(1) brillante ordinaire : reflet holographique');
      check(/brillante fondue/.test(await p.getAttribute(fondue, 'aria-label')), '(1) libellé accessible « brillante fondue »');
    }
    const anim = await p.$eval(`${fondue} .hgc-fondue i`, (i) => getComputedStyle(i).animationName);
    check(motion === 'reduce' ? anim === 'none' : anim === 'hgc-drip', `(3) ${motion} : animation « ${anim} »`);
    if (motion === 'no-preference') {
      await p.click('#cartes-p-collection .cz-zoom[data-card="C6"]');
      await sleep(500);
      check(await p.$('.cz-dialog[open] .hgc.is-fondue, dialog[open] .hgc.is-fondue'), '(2) fenêtre agrandie : rendu fondu');
      await p.keyboard.press('Escape');
      await p.screenshot({ path: 'tests/shots/c3-collection.png' });
      await p.evaluate(() => { location.hash = 'boutique'; }); // la barre d'onglets est masquée : on change d'onglet par l'adresse
      await p.waitForSelector('#cartes-p-boutique:not([hidden])', { timeout: 5000 });
      await sleep(400);
      const art = '#cartes-p-boutique .shop-item[data-type="raclette"]';
      check(await p.$(`${art} .cart-box.cart--raclette`), '(4) cartouche Raclette');
      check(/Dernière fournée/.test(await p.textContent(`${art} .shop-badge`)), '(4) « Dernière fournée »');
      check(!p.errs.length, 'aucune erreur de page ' + p.errs.join(' | '));
    }
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
