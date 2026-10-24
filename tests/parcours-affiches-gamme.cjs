// Parcours : affiches des boosters régénérées (idée A5, affiches/affiches.js), sur le faux Supabase.
// (a) connecté : la gamme lit hg_booster_types (9 types) : titre « Les 9 boosters », date des données, taux exacts ;
// (b) un type ajouté apparaît (10 → grille de 4 colonnes), un type désactivé disparaît, un type saisonnier a sa pastille ;
// (c) 12 types : aucun texte ne déborde de l'A3 ; (d) sans session : la liste écrite dans la page reste ;
// (e) affiche « boosters » : prix du Classique lu sur son type ; bouton « Voir l'affiche » dans l'éditeur de boosters.
const { ROOT, check, finish, openPage, adminSection, chromium, sleep } = require('./lib/harness.cjs');
const shots = process.env.SHOTS_DIR;
const T = (id, name, sort, extra = {}) => ({ id, name, price: 150, size: 5, rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  shiny_rate: 3, pool: 'tous', weekly_limit: null, free_daily: false, style: 'cart--serie', sort, active: true, description: '', excluded_rarities: [], excluded_sets: [], ...extra });
const open = (b, scenario, page = 'affiches/boosters-gamme-a3') => openPage(b, { page, width: 1123, height: 1587, scenario });
/** Débordements : éléments de tuile qui sortent de leur tuile, ou page plus haute que l'A3. */
const overflow = (p) => p.evaluate(() => {
  const bad = [];
  for (const t of document.querySelectorAll('.tile')) { const r = t.getBoundingClientRect(); for (const c of t.querySelectorAll('h2, .taux, .faits, .side')) { const q = c.getBoundingClientRect(); if (q.bottom > r.bottom + 1 || q.right > r.right + 1) bad.push(c.className || c.tagName); } }
  const foot = document.querySelector('.foot').getBoundingClientRect();
  if (foot.bottom > 1587) bad.push('pied hors A3');
  return bad;
});

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    let p = await open(browser, {});
    await sleep(600);
    check((await p.textContent('#gamme-titre')) === 'Les 9 boosters' && (await p.$$eval('.tile', (t) => t.length)) === 9, '(a) 9 boosters lus');
    check((await p.textContent('#gamme-date')).startsWith('Données du '), `(a) date des données (${await p.textContent('#gamme-date')})`);
    check((await p.textContent('.tile:nth-child(6) .taux')).includes('90 %') && (await p.textContent('.tile:nth-child(6) .taux')).includes('3,98 %'), '(a) taux du Quitte ou double exacts (90 %, 3,98 %)');
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    // (b) types modifiés : un nouveau saisonnier, Doré désactivé
    const base = await (async () => { const q = await open(browser, {}); const t = await q.evaluate(() => window.__DB.hg_booster_types); await q.ctx.close(); return t; })();
    const types = [...base.map((t) => (t.id === 'dore' ? { ...t, active: false } : t)),
      T('worlds', 'Worlds 2026', 95, { ends_at: '2026-11-03T22:00:00Z', style: 'cart--diamant' }), T('raclette', 'Raclette fondue', 96)];
    p = await open(browser, { boosterTypes: types });
    await sleep(600);
    const names = await p.$$eval('.tile h2', (h) => h.map((x) => x.textContent));
    check(names.length === 10 && names.includes('Worlds 2026') && !names.includes('Doré'), `(b) 10 boosters, Worlds ajouté, Doré retiré (${names.length})`);
    check(await p.$eval('#gamme', (g) => g.classList.contains('g4')), '(b) 10 boosters : grille de 4 colonnes');
    check((await p.textContent('.tile:nth-child(9)')).includes('Jusqu’au 3 nov.'), '(b) pastille « Jusqu’au 3 nov. »');
    if (shots) await p.screenshot({ path: `${shots}/A5-affiche-10.png` });
    await p.ctx.close();

    // (c) 12 types
    const twelve = [...base, T('a', 'Raclette fondue', 91), T('b', 'Nuit étoilée', 92), T('c', 'Ciné-club du dimanche', 93)];
    p = await open(browser, { boosterTypes: twelve });
    await sleep(600);
    const bad = await overflow(p);
    check((await p.$$eval('.tile', (t) => t.length)) === 12 && bad.length === 0, `(c) 12 boosters sans débordement${bad.length ? ' : ' + bad.slice(0, 5).join(', ') : ''}`);
    if (shots) await p.screenshot({ path: `${shots}/A5-affiche-12.png` });
    await p.ctx.close();

    // (d) sans session
    p = await open(browser, { guest: true, boosterTypes: [] });   // la RLS ne renvoie rien à un visiteur
    await sleep(600);
    check((await p.$$eval('.tile', (t) => t.length)) === 9 && (await p.textContent('#gamme-date')) === 'Données écrites dans la page', '(d) sans session : liste de repli');
    await p.ctx.close();

    // (e) boosters-a3 : prix du Classique
    const priced = base.map((t) => (t.id === 'classique' ? { ...t, price: 120 } : t));
    p = await open(browser, { boosterTypes: priced }, 'affiches/boosters-a3');
    await sleep(600);
    const prices = await p.$$eval('[data-cfg="cartes.booster_price"]', (e) => e.map((x) => x.textContent));
    check(prices.length && prices.every((x) => x === '120') && (await p.textContent('[data-expr="cartes.booster_price*5"]')) === '600', `(e) prix du Classique lu sur son type (${prices.join(',')})`);
    await p.ctx.close();
    p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    await adminSection(p, 'fabrique/boosters'); await sleep(500);
    check(await p.getAttribute('a[href="affiches/boosters-gamme-a3.html"]', 'target') === '_blank', '(e) « Voir l’affiche » dans l’éditeur de boosters');
    await p.ctx.close();
  } catch (e) { check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]); }
  finally { await browser.close(); }
  finish();
})();
