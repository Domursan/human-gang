// Parcours P1 « Profil gaming » (migration 090).
// (a) fiche d'Alice (390 px) : bloc « En jeu », jeu du moment, favoris, bouton Copier (presse-papiers).
// (b) annuaire « Qui joue à… » : onglets par jeu (profil masqué exclu), flèches du clavier, « Tout copier ».
// (c) page compte : carte « Profil gaming », 3 favoris au plus, reprise manuelle depuis « Mes informations », enregistrement.
// (d) 360 px : pas de défilement horizontal. Faux Supabase : fixtures/fake-sb-social.mjs.
// Lancer : node tests/parcours/compte/parcours-profil-gaming.cjs
const { check, finish, openPage, hscroll, chromium, SHOTS } = require('../../lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const SCN = {
  gaming: {
    [U(2)]: { accounts: { riot: 'AliceKC#KCWIN', steam: 'alice_hg', geoguessr: 'Alice le globe' }, now_playing: 'CK3 – campagne Serge', favorites: ['LoL', 'CK3', 'GeoGuessr'], hidden: false },
    [U(3)]: { accounts: { riot: 'Bruno#EUW' }, now_playing: null, favorites: ['LoL'], hidden: false },
    [U(4)]: { accounts: { riot: 'Cache#000' }, now_playing: null, favorites: ['LoL'], hidden: true },
  },
};
const waitFor = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 6000 }).catch(() => {});
// Le site de test est en http : pas de navigator.clipboard (contexte non sécurisé). Presse-papiers simulé.
const CLIP_STUB = () => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__CLIP = t; } } }); };
const clip = (p) => p.evaluate(() => window.__CLIP);

(async () => {
  const browser = await chromium.launch();
  /* (a) et (b) fiche d'Alice */
  {
    const p = await openPage(browser, { page: 'membre', fixture: 'fake-sb-social.mjs', width: 390, height: 844, scenario: SCN });
    await p.ctx.addInitScript(CLIP_STUB);
    await p.goto(`http://hg.test/pages/compte/membre.html?id=${U(2)}`);
    await waitFor(p, () => !!document.querySelector('#mb-gaming .gm-row'));
    const block = await p.textContent('#mb-gaming').catch(() => '');
    check(block.includes('En jeu') && block.includes('AliceKC#KCWIN') && block.includes('alice_hg'), '(a) bloc « En jeu » avec les pseudos');
    check(block.includes('En ce moment : CK3 – campagne Serge'), '(a) jeu du moment affiché');
    check(block.includes('Public · membres du gang'), '(a) mention Public');
    check(!block.includes('Battle.net'), '(a) champ vide absent');
    await p.click('#mb-gaming .gm-copy');
    await p.waitForTimeout(200);
    check(await clip(p) === 'AliceKC#KCWIN', '(a) Copier : Riot ID dans le presse-papiers');
    await waitFor(p, () => !!document.querySelector('#gm-who [role=tab]'));
    const tabs = await p.$$eval('#gm-who [role=tab]', (els) => els.map((e) => e.textContent.trim()));
    check(tabs[0] === 'LoL · 2', `(b) onglet « LoL · 2 » (profil masqué exclu) : ${tabs.join(' | ')}`);
    check(tabs.includes('CK3 · 1') && tabs.includes('GeoGuessr · 1') && !tabs.some((t) => t.startsWith('Codenames')), '(b) onglets des jeux joués seulement');
    await p.click('#gm-copy-all');
    await p.waitForTimeout(200);
    check(await clip(p) === 'Alice : AliceKC#KCWIN\nBruno : Bruno#EUW', '(b) « Tout copier » : liste prête à coller');
    await p.focus('#gm-tab-0');
    await p.keyboard.press('ArrowRight');
    check(await p.getAttribute('#gm-tab-1', 'aria-selected') === 'true' && await p.evaluate(() => document.activeElement.id) === 'gm-tab-1', '(b) flèche droite : onglet suivant (ARIA)');
    const tgt = await p.$eval('#gm-who .gm-tab', (e) => e.getBoundingClientRect().height);
    check(tgt >= 44, '(b) cible des onglets ≥ 44 px');
    check(await hscroll(p) === 0, '(a) 390 px : pas de défilement horizontal');
    await p.screenshot({ path: `${SHOTS}/p1-fiche-390.png`, fullPage: true });
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  /* Profil masqué : invisible pour un autre membre */
  {
    const p = await openPage(browser, { page: 'membre', fixture: 'fake-sb-social.mjs', width: 360, height: 800, scenario: SCN });
    await p.goto(`http://hg.test/pages/compte/membre.html?id=${U(4)}`);
    await p.waitForTimeout(1500);
    check(await p.$eval('#mb-gaming', (e) => e.hidden), '(a) profil masqué : pas de bloc « En jeu »');
    check(await hscroll(p) === 0, '(d) 360 px : pas de défilement horizontal (fiche)');
    await p.ctx.close();
  }
  /* (c) page compte */
  {
    const p = await openPage(browser, { page: 'compte', fixture: 'fake-sb-social.mjs', width: 360, height: 800, scenario: SCN });
    await waitFor(p, () => !!document.querySelector('#gm-form'));
    check(!!(await p.$('#gm-form')), '(c) carte « Profil gaming » sur la page compte');
    check((await p.textContent('#gaming')).includes('Public · membres du gang'), '(c) mention Public');
    for (const n of ['LoL', 'CK3', 'GeoGuessr']) await p.check(`[data-fav="${n}"]`);
    check(await p.$eval('[data-fav="Codenames"]', (e) => e.disabled), '(c) 4e favori désactivé (3 au plus)');
    await p.evaluate((me) => { window.__DB.hg_profile_info.push({ user_id: me, data: { steam: 'ethan_steam', nintendo: 'SW-1111-2222-3333', instagram: '@prive' } }); }, ME);
    await p.fill('#gm-riot', 'Ethan#HG');
    await p.click('#gm-import');
    await p.waitForTimeout(400);
    check(await p.inputValue('#gm-steam') === 'ethan_steam' && await p.inputValue('#gm-switch') === 'SW-1111-2222-3333', '(c) reprise : champs vides remplis depuis « Mes informations »');
    check(await p.inputValue('#gm-riot') === 'Ethan#HG', '(c) reprise : un champ déjà rempli n’est pas écrasé');
    const before = await p.evaluate(() => window.__LOG.filter((l) => l[1] === 'hg_gaming_save').length);
    check(before === 0, '(c) reprise strictement manuelle : rien n’est enregistré sans clic');
    await p.fill('#gm-now', 'Worlds en boucle');
    await p.click('#gm-form [type=submit]');
    await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_gaming_save'));
    const args = await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_gaming_save')?.[2]);
    check(args?.p_accounts?.riot === 'Ethan#HG' && args.p_now_playing === 'Worlds en boucle' && args.p_favorites.length === 3 && args.p_hidden === false, '(c) enregistrement : pseudos, jeu du moment, favoris');
    check(!('instagram' in (args?.p_accounts || {})), '(c) aucune info privée hors plateformes transmise');
    check(await hscroll(p) === 0, '(d) 360 px : pas de défilement horizontal (compte)');
    await p.locator('#gaming').screenshot({ path: `${SHOTS}/p1-compte-360.png` });
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
