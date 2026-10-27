// Parcours : affiche « La gamme des boosters » (/affiches/boosters-gamme-a3.html), faux Supabase.
// La gamme est un tableau : une colonne par booster (9 au plus, sur l’A3 ; les autres sont signalés en pied), reconstruit
// depuis hg_booster_types (types actifs, ordre « sort »), avec repli écrit dans gamme.js sans session.
// (a) connecté : 9 boosters lus, accroche « Neuf boosters », date des données, taux exacts (Quitte ou double : 90 %, 3,98 %) ;
// (b) un type ajouté prend sa place, un type désactivé disparaît, un type saisonnier a sa date « Jusqu’au … » ;
// (c) 12 types : 9 colonnes, rien ne déborde de l’A3, pied « autre(s) dans la Boutique » ;
// (d) sans session : la liste écrite dans la page reste ; (e) affiche « boosters » : prix du Classique lu sur son type ;
// bouton « Voir l’affiche » dans l’éditeur de boosters.
const { ROOT, check, finish, openPage, adminSection, chromium, sleep } = require('../../lib/harness.cjs');
const shots = process.env.SHOTS_DIR;
const T = (id, name, sort, extra = {}) => ({ id, name, price: 150, size: 5, rates: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 },
  shiny_rate: 3, pool: 'tous', weekly_limit: null, free_daily: false, style: 'cart--serie', sort, active: true, description: '', excluded_rarities: [], excluded_sets: [], ...extra });
const open = (b, scenario, page = 'affiches/boosters-gamme-a3') => openPage(b, { page, width: 1123, height: 1587, scenario });
/** Noms des colonnes de boosters (en-tête du tableau), dans l’ordre. */
const colonnes = (p) => p.$$eval('.gamme thead th.bo', (ths) => ths.map((th) => th.textContent.replace(/\s+/g, ' ').trim()));
/** Texte d’une ligne du tableau (ligne d’en-tête de rangée = libellé), cellules de boosters comprises. */
const ligne = (p, libelle) => p.$$eval('.gamme tbody tr', (trs, l) => {
  const tr = trs.find((x) => x.querySelector('th')?.textContent.trim() === l);
  return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()) : [];
}, libelle);
/** Débordements : cellules ou noms de booster plus larges que leur case, tableau plus large que la page, pied hors A3. */
const overflow = (p) => p.evaluate(() => {
  const bad = [];
  for (const c of document.querySelectorAll('.gamme th, .gamme td')) if (c.scrollWidth > c.clientWidth + 1) bad.push(c.className || c.tagName);
  if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page plus large que l’A3');
  const foot = document.querySelector('.pied').getBoundingClientRect();
  if (foot.bottom > 1587) bad.push('pied hors A3');
  return bad;
});

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    let p = await open(browser, {});
    await sleep(600);
    const noms = await colonnes(p);
    check(noms.length === 9 && (await p.textContent('#gamme-intro')).startsWith('Neuf boosters'), `(a) 9 boosters lus (${noms.length}), accroche « Neuf boosters »`);
    check((await p.textContent('#gamme-date')).startsWith('Données du '), `(a) date des données (${await p.textContent('#gamme-date')})`);
    const taux = await ligne(p, 'Commune');
    const quitte = await p.$$eval('.gamme thead th.bo', (ths) => ths.findIndex((th) => th.textContent.includes('Quitte')));
    const tauxQuitte = await Promise.all(['Commune', 'Légendaire'].map((r) => ligne(p, r).then((v) => v[quitte])));
    check(quitte === 5 && tauxQuitte[0] === '90' && tauxQuitte[1] === '3,98', `(a) taux du Quitte ou double exacts (commune ${tauxQuitte[0]}, légendaire ${tauxQuitte[1]})`);
    check(taux.length === 9, '(a) une case de taux par booster');
    check(p.errs.length === 0, '(a) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    // (b) types modifiés : Doré désactivé, un saisonnier (Worlds) ajouté, un autre (Raclette) au-delà de la neuvième colonne
    const base = await (async () => { const q = await open(browser, {}); const t = await q.evaluate(() => window.__DB.hg_booster_types); await q.ctx.close(); return t; })();
    const types = [...base.map((t) => (t.id === 'dore' ? { ...t, active: false } : t)),
      T('worlds', 'Worlds 2026', 95, { ends_at: '2026-11-03T22:00:00Z', style: 'cart--diamant' }), T('raclette', 'Raclette fondue', 96)];
    p = await open(browser, { boosterTypes: types });
    await sleep(600);
    const names = await colonnes(p);
    check(names.length === 9 && names.some((n) => n.includes('Worlds 2026')) && !names.some((n) => n.includes('Doré')) && !names.some((n) => n.includes('Raclette')),
      `(b) Worlds ajouté, Doré retiré, Raclette au-delà des 9 colonnes (${names.length} colonnes)`);
    check((await p.textContent('#gamme-date')).includes('1 autre(s) dans la Boutique'), '(b) pied : « 1 autre(s) dans la Boutique »');
    const acces = await ligne(p, 'Accès');
    check(acces.some((t) => t.includes('Jusqu’au 3 nov.')), '(b) date « Jusqu’au 3 nov. » sur le booster saisonnier');
    if (shots) await p.screenshot({ path: `${shots}/A5-affiche-10.png` });
    await p.ctx.close();

    // (c) 12 types : neuf colonnes, rien qui déborde
    const twelve = [...base, T('a', 'Raclette fondue', 91), T('b', 'Nuit étoilée', 92), T('c', 'Ciné-club du dimanche', 93)];
    p = await open(browser, { boosterTypes: twelve });
    await sleep(600);
    const bad = await overflow(p);
    check((await colonnes(p)).length === 9 && bad.length === 0, `(c) 12 boosters : 9 colonnes, sans débordement${bad.length ? ' : ' + bad.slice(0, 5).join(', ') : ''}`);
    check((await p.textContent('#gamme-date')).includes('3 autre(s) dans la Boutique'), '(c) pied : « 3 autre(s) dans la Boutique »');
    if (shots) await p.screenshot({ path: `${shots}/A5-affiche-12.png` });
    await p.ctx.close();

    // (d) sans session
    p = await open(browser, { guest: true, boosterTypes: [] });   // la RLS ne renvoie rien à un visiteur
    await sleep(600);
    check((await colonnes(p)).length === 9 && (await p.textContent('#gamme-date')) === 'Données écrites dans la page', '(d) sans session : liste de repli (9 boosters)');
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
    check(await p.getAttribute('a[href="/affiches/boosters-gamme-a3.html"]', 'target') === '_blank', '(e) « Voir l’affiche » dans l’éditeur de boosters');
    await p.ctx.close();
  } catch (e) { check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]); }
  finally { await browser.close(); }
  finish();
})();
