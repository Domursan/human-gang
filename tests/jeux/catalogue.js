// Parcours navigateur de la page « Jeux » (vue des cartes) : un admin voit les jeux en préparation, un membre non.
// Prérequis : base locale « uno » (tests/uno/rebuild.sh), serveur sur 8080. Le test règle les pages comme sur le site :
// jeux et uno ouvertes aux membres, loup-garou en mode admin.
process.env.FAKE_DB = 'uno';
const { chromium } = require('playwright');
const { attach } = require('../loup-garou/ui/fake.js');
require('child_process').execFileSync('psql', ['-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', 'uno', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `insert into hg_pages(slug, label, mode) values ('jeux', 'Jeux', 'membres'), ('loup-garou', 'Loup-Garou', 'admin'), ('uno', 'Uno', 'membres')
  on conflict (slug) do update set mode = excluded.mode`]);
const fs = require('fs');
(async () => {
  const b = await chromium.launch(); let ok = true;
  fs.mkdirSync(`${__dirname}/shots`, { recursive: true });
  const check = (c, m) => { console.log(`${c ? 'ok  ' : 'ÉCHEC'} ${m}`); if (!c) ok = false; };
  for (const [n, w, nom] of [[1, 1280, 'admin'], [2, 1280, 'membre'], [2, 390, 'membre-tel']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, serviceWorkers: 'block' });
    await attach(ctx, n);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`[${nom}] pageerror`, e.message));
    await p.goto('http://localhost:8080/jeux.html'); await p.waitForTimeout(2500);
    const titres = await p.$$eval('.jx-carte:not([hidden]) .jx-t', (xs) => xs.map((x) => x.textContent));
    const prep = await p.$$eval('.jx-carte.is-prep', (xs) => xs.length);
    const sections = await p.$$eval('.jx-section:not([hidden]) .jx-h', (xs) => xs.map((x) => x.textContent));
    console.log(nom, '·', sections.join(' / '), '·', titres.join(', '));
    if (n === 1) { check(prep === 6, 'admin : 6 jeux en préparation'); check(titres.includes('Loup-Garou'), 'admin : Loup-Garou visible');
      check(await p.$$eval('.jx-carte.is-chantier .jx-t', (xs) => xs.some((x) => x.textContent === 'Loup-Garou')), 'admin : Loup-Garou en chantier');
      check(await p.$$eval('.jx-section.is-chantier', (xs) => xs.length) === 1, 'admin : section multijoueurs en chantier'); }
    else { check(prep === 0, 'membre : aucun jeu en préparation'); check(!titres.includes('Loup-Garou'), 'membre : Loup-Garou masqué (page admin)');
      check(!sections.includes('Jeux multijoueurs'), 'membre : section multijoueurs masquée'); check(titres.includes('Uno'), 'membre : Uno visible');
      check(!(await p.$('.is-chantier')), 'membre : aucun chantier'); }
    check(!(await p.$('.nav-group[data-menu="jeux"]')), `${nom} : plus de menu déroulant Jeux`);
    await p.screenshot({ path: `${__dirname}/shots/${nom}.png`, fullPage: true });
    if (n === 2 && w > 600) {
      await p.fill('#jx-q', 'sut'); await p.waitForTimeout(200);
      check((await p.$$eval('.jx-carte:not([hidden])', (xs) => xs.length)) === 1, 'recherche « sut » : une carte');
      await p.fill('#jx-q', ''); await p.click('.jx-carte a[href="#sutom"]'); await p.waitForTimeout(1500);
      check(await p.isVisible('#jeux-retour'), 'dans un jeu : lien « Tous les jeux » visible');
      check(await p.isHidden('#jeux-panel-tous'), 'dans un jeu : cartes masquées');
      await p.click('#jeux-retour'); await p.waitForTimeout(800);
      check(await p.isVisible('#jeux-panel-tous'), 'retour aux cartes');
      await p.goto('http://localhost:8080/jeux.html#geo'); await p.waitForTimeout(1500);
      check(await p.isVisible('#jeux-panel-geo'), 'lien direct jeux.html#geo ouvre le jeu');
    }
    await ctx.close();
  }
  await b.close(); process.exit(ok ? 0 : 1);
})();
