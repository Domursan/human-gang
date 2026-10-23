// Parcours : accueil personnalisable (idée P9, migration 091).
// (a) Accueil d'origine sans disposition : mêmes blocs qu'avant, bouton « Personnaliser ».
// (b) Mode édition : monter « Fil d'activité », masquer la boîte à idées, ajouter « Quêtes » depuis la réserve, Terminé :
//     disposition enregistrée (hg_home_layout), blocs visibles et masqués appliqués, aucune requête pour un bloc masqué.
// (c) Profil type « Fan de cartes » ; (d) « Accueil d'origine » efface la disposition.
// (e) Disposition enregistrée relue dans un autre contexte (autre appareil) ; bloc d'une page interdite jamais proposé.
// (f) Événement en cours : obligatoire, sans interrupteur ; 360 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb.mjs + fake-sb-social.mjs. Lancer : node tests/parcours-accueil-perso.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');
const errs = (p) => (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : '');
const order = (p) => p.evaluate(() => [...document.querySelectorAll('#app [data-home-id]')].filter((e) => !e.hidden && e.closest('#app')).map((e) => e.dataset.homeId));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  {
    const p = await openPage(browser, { page: 'accueil', scenario: { extra: 'fake-sb-social.mjs' } });
    await p.waitForSelector('.home-perso-btn', { timeout: 8000 }).catch(() => {});
    const o = await order(p);
    check(JSON.stringify(o.filter((x) => x !== 'evenement' && x !== 'defi')) === JSON.stringify(['secret_santa', 'irl', 'historique', 'fil', 'anniversaires', 'idees']), '(a) ordre d’origine (' + o.join(',') + ')');
    check(await p.locator('.home-tiles > [data-home-id]').count() === 3 && await p.locator('.home-row > [data-home-id]').count() === 2, '(a) tuiles en grille, fil et anniversaires côte à côte');
    check(await p.isVisible('.home-perso-btn'), '(a) bouton « Personnaliser »');
    check(!p.errs.length, '(a) aucune erreur JS' + errs(p));

    await p.click('.home-perso-btn');
    await p.waitForSelector('.home-editor', { timeout: 5000 }).catch(() => {});
    check(await p.isVisible('.home-editor') && await p.isHidden('#idees'), '(b) mode édition : liste à la place des blocs');
    check(await p.locator('.he-row[data-id="evenement"] .he-req').count() === 1 && await p.locator('.he-row[data-id="evenement"] [data-toggle]').count() === 0, '(f) événement en cours obligatoire');
    check(await p.locator('.he-reserve [data-add="quetes"]').count() === 1, '(b) « Quêtes » dans la réserve');
    await p.click('.he-row[data-id="fil"] [data-move="-1"]');
    check(/Fil d’activité déplacé en position/.test(await p.textContent('#he-live')), '(b) déplacement annoncé (aria-live)');
    const ids = await p.evaluate(() => [...document.querySelectorAll('.he-row')].map((r) => r.dataset.id));
    check(ids.indexOf('fil') < ids.indexOf('historique'), '(b) fil monté au-dessus de l’historique');
    await p.click('.he-row[data-id="idees"] [data-toggle]');
    await p.click('.he-reserve [data-add="quetes"]');
    await Promise.all([p.waitForNavigation({ timeout: 8000 }).catch(() => {}), p.click('[data-done]')]);
    await p.waitForTimeout(1200);
    const up = (await log(p));
    const o2 = await order(p);
    check(!o2.includes('idees') && await p.locator('#idees').count() === 0, '(b) boîte à idées masquée (retirée)');
    check(o2.indexOf('fil') < o2.indexOf('historique'), '(b) ordre appliqué après rechargement (' + o2.join(',') + ')');
    check(o2[o2.length - 1] === 'quetes', '(b) quêtes ajoutées en fin');
    check(await p.isVisible('.home-own-quetes') && /1 sur 3|2 sur 3/.test(await p.textContent('.home-own-quetes')), '(b) bloc Quêtes chargé');
    check(!up.some((l) => l[0] === 'insert' && l[1] === 'hg_ideas'), '(b) aucune requête de la boîte à idées');
    check(/1 bloc masqué/.test(await p.textContent('#app')), '(b) rappel « 1 bloc masqué »');
    check(!p.errs.length, '(b) aucune erreur JS' + errs(p));
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('hg_home_layout') || 'null'));
    check(saved && saved.blocks.some((b) => b.id === 'idees' && b.on === false), '(b) copie locale enregistrée');
    // (d) accueil d'origine
    await p.click('.home-perso-btn');
    await p.waitForSelector('.home-editor', { timeout: 5000 }).catch(() => {});
    await p.click('[data-profile="origine"]');
    await Promise.all([p.waitForNavigation({ timeout: 8000 }).catch(() => {}), p.click('[data-done]')]);
    await p.waitForTimeout(600);
    check(await p.evaluate(() => localStorage.getItem('hg_home_layout')) === null, '(d) « Accueil d’origine » : disposition effacée');
    const od = await order(p);
    check(od.includes('idees') && od.includes('secret_santa') && !od.includes('quetes'), '(d) accueil d’origine rétabli (' + od.join(',') + ')');
    await p.ctx.close();
  }
  {
    // (e) Autre appareil : la base fournit la disposition, pas de copie locale
    const p = await openPage(browser, { page: 'accueil', width: 360, height: 900, scenario: { extra: 'fake-sb-social.mjs',
      homeLayout: [{ id: 'fil', on: true }, { id: 'evenement', on: true }, { id: 'quetes', on: true }, { id: 'idees', on: false }, { id: 'inconnu', on: true }],
      access: [{ page_slug: 'irl', user_id: '00000002-0000-4000-8000-000000000002', allowed: false }], uid: '00000002-0000-4000-8000-000000000002' } });
    await p.waitForSelector('.home-perso-btn', { timeout: 8000 }).catch(() => {});
    const o = await order(p);
    check(o[0] === 'fil' && !o.includes('idees'), '(e) disposition relue depuis la base (' + o.join(',') + ')');
    check(!o.includes('quetes'), '(e) bloc Quêtes absent sans accès aux cartes');
    check(!o.includes('irl'), '(e) bloc d’une page interdite absent');
    await p.click('.home-perso-btn');
    await p.waitForSelector('.home-editor', { timeout: 5000 }).catch(() => {});
    check(await p.locator('[data-id="irl"], [data-add="irl"]').count() === 0, '(e) page interdite jamais proposée');
    check(await p.locator('.he-row[data-id="secret_santa"] .he-new').count() === 1, '(e) nouveau bloc du défaut : étiquette « Nouveau »');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(f) 360 px : pas de défilement horizontal (édition)');
    // (c) profil type
    await p.click('[data-profile="cartes"]');
    const ids = await p.evaluate(() => [...document.querySelectorAll('.he-row')].map((r) => r.dataset.id));
    check(ids[0] === 'evenement' && ids[1] === 'defi' && ids[2] === 'quiz' && !ids.includes('quotidien'), '(c) profil « Fan de cartes », sans les blocs interdits (' + ids.slice(0, 3).join(',') + ')');
    check(await p.getAttribute('[data-profile="cartes"]', 'aria-pressed') === 'true', '(c) profil choisi : aria-pressed');
    check(!p.errs.length, '(e) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
