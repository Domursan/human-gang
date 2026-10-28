// Parcours : recherche globale (Ctrl+K) sur les pages du menu et les jeux du catalogue.
// Les résultats « Pages » viennent du menu (core/menu-def.js), « Jeux » du catalogue (espaces/jeux/catalogue.js) ;
// une page ou un jeu auquel le membre n'a pas accès n'apparaît pas. Accents et casse ignorés.
// Faux Supabase (fixtures/fake-sb.mjs) : admin par défaut ; membre simple avec scenario uid (Alice, non admin).
// scenario pagesExtra : déclare la page Uno (absente de la liste de base), comme sur le vrai site.
// Lancer : node tests/parcours/compte/parcours-recherche-pages-jeux.cjs
const { ROOT, check, finish, openPage, sleep, chromium } = require('../../lib/harness.cjs');

const MEMBRE = '00000002-0000-4000-8000-000000000002'; // Alice : membre simple
const UNO = { slug: 'uno', label: 'Uno', mode: 'membres', in_nav: false, sort: 900 };

/** Tape la requête dans la recherche (ouverte par Ctrl+K), attend les résultats, renvoie { groupe: [{ titre, href }] }. */
async function chercher(p, q) {
  await p.keyboard.press('Control+k');
  await p.waitForSelector('dialog.search-dialog[open]', { timeout: 3000 }).catch(() => {});
  await p.locator('#search-q').fill('');
  await p.locator('#search-q').pressSequentially(q);
  await sleep(700);
  return p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.search-results .sr-group')].map((g) => [
    g.querySelector('.sr-group-title').textContent.replace(/\s*\d+\s*$/, '').trim(),
    [...g.querySelectorAll('.sr-item')].map((a) => ({ titre: a.querySelector('.sr-title').textContent.trim(), href: a.getAttribute('href') })),
  ])));
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Admin : « cal » trouve la page Calendrier (menu IRL, lien direct).
  let p = await openPage(browser, { page: 'irl', width: 1280 });
  await p.waitForSelector('.site-header .nav-search-open', { timeout: 8000 }).catch(() => {});
  let r = await chercher(p, 'cal');
  check((r.Pages || []).some((x) => x.titre === 'Calendrier' && x.href === '/pages/irl/calendrier.html'), '« cal » : Calendrier dans le groupe Pages');

  // 2. Titres du menu avec le libellé du sous-menu : « ouverture » → Le jeu de cartes › Ouverture.
  r = await chercher(p, 'ouverture');
  check((r.Pages || []).some((x) => x.titre === 'Ouverture' && x.href === '/pages/cartes/cartes.html#ouverture'), '« ouverture » : entrée du menu avec son ancre');

  // 3. Jeu du catalogue avec ancre : GeoGuessr ouvre l'onglet dans la page des jeux.
  r = await chercher(p, 'geoguessr');
  check((r.Jeux || []).some((x) => x.titre === 'GeoGuessr' && x.href === '/pages/jeux/jeux.html#geo'), '« geoguessr » : jeu dans le groupe Jeux, lien /pages/jeux/jeux.html#geo');

  // 4. Accents et casse : « ÉCHECS » et « echecs » trouvent Échecs (page duel-echecs, admin).
  r = await chercher(p, 'ÉCHECS');
  check((r.Jeux || []).some((x) => x.titre === 'Échecs' && x.href === '/pages/jeux/duels.html#creer/echecs'), '« ÉCHECS » (accent, casse) : Échecs trouvé');
  r = await chercher(p, 'echecs');
  check((r.Jeux || []).some((x) => x.titre === 'Échecs'), '« echecs » sans accent : Échecs trouvé');

  // 5. Page de la page Uno : déclarée dans hg_pages, comme sur le site (scénario pagesExtra).
  await p.ctx.close();
  p = await openPage(browser, { page: 'irl', width: 1280, scenario: { pagesExtra: [UNO] } });
  await p.waitForSelector('.site-header .nav-search-open', { timeout: 8000 }).catch(() => {});
  r = await chercher(p, 'uno');
  check((r.Jeux || []).some((x) => x.titre === 'Uno' && x.href === '/pages/jeux/uno.html'), '« uno » : Uno dans le groupe Jeux (page déclarée)');

  // 6. Cliquer un résultat ouvre la page et ferme la recherche.
  await chercher(p, 'calendrier');
  await p.locator('.search-results .sr-item', { hasText: 'Calendrier' }).first().click();
  await p.waitForURL(/\/irl\/calendrier\.html$/, { timeout: 5000 }).catch(() => {});
  check(/\/pages\/irl\/calendrier\.html$/.test(new URL(p.url()).pathname), 'clic sur « Calendrier » : ouvre /pages/irl/calendrier.html');
  check(!(await p.isVisible('dialog.search-dialog[open]').catch(() => false)), 'clic sur un résultat : la recherche se ferme');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 7. Membre simple : une page réservée aux admins n'apparaît pas (Cartes, Jeux, Échecs).
  p = await openPage(browser, { page: 'irl', width: 1280, scenario: { uid: MEMBRE, pagesExtra: [UNO] } });
  await p.waitForSelector('.site-header .nav-search-open', { timeout: 8000 }).catch(() => {});
  r = await chercher(p, 'cartes');
  check(!(r.Pages || []).some((x) => x.href.startsWith('/pages/cartes/')), 'membre « cartes » : aucune entrée Le jeu de cartes (page admin)');
  r = await chercher(p, 'jeux');
  check(!(r.Pages || []).some((x) => x.href === '/pages/jeux/jeux.html'), 'membre « jeux » : le lien Jeux (page admin) n\'apparaît pas');
  r = await chercher(p, 'échecs');
  check(!(r.Jeux || []).some((x) => x.titre === 'Échecs'), 'membre « échecs » : jeu d\'une page admin absent');
  r = await chercher(p, 'uno');
  check((r.Jeux || []).some((x) => x.titre === 'Uno'), 'membre « uno » : Uno visible (page ouverte aux membres)');
  r = await chercher(p, 'cal');
  check((r.Pages || []).some((x) => x.titre === 'Calendrier'), 'membre « cal » : Calendrier visible');
  check(!p.errs.length, 'membre : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
