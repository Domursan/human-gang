// Parcours : réorganisation du panel admin (migration 103) : arborescence en six domaines, anciennes adresses et droits.
// (a) Anciennes adresses (#communication/assistance, #vie/secret-santa, #cartes/bataille, #site/theme…) : chacune ouvre la
//     bonne sous-section (adresse remplacée, identifiant et onglet conservés), y compris les anciennes ancres de section.
// (b) Arborescence : six domaines dans l'ordre, identifiants de sous-section uniques, sous-sections non livrées absentes,
//     titres de groupe (Bot, Site, Apparence, Assistance…).
// (c) Staff sans les droits d'un domaine : une adresse de ce domaine ouvre la première page permise (pas d'erreur).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-reorg.cjs
const { check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

/** Adresse courante du fragment (ex. « #pilotage/assistance »). */
const hash = (p) => p.evaluate(() => location.hash);
/** Attend que le fragment soit `h` et que la sous-section active soit celle de `h` (ou la limite de temps). */
const attendre = (p, h) => p.waitForFunction((want) => {
  if (location.hash !== want) return false;
  const cur = document.querySelector('.shell-sub[aria-current="true"]');
  return !!cur && cur.getAttribute('href') === want.split('/').slice(0, 2).join('/');
}, h, { timeout: 6000 }).catch(() => {});

/** Anciennes adresses et la nouvelle adresse attendue (l'identifiant et l'onglet suivent). */
const ANCIENNES = [
  ['#communication/assistance', '#pilotage/assistance'],
  ['#communication/assistance/sup-a', '#pilotage/assistance/sup-a'],
  ['#communication/idees', '#pilotage/idees'],
  ['#communication/bot', '#pilotage/bot'],
  ['#vie/secret-santa', '#irl/secret-santa'],
  ['#vie/sorties/ev-1', '#irl/sorties/ev-1'],
  ['#vie/souvenirs/ce-jour', '#irl/souvenirs/ce-jour'],
  ['#vie/rdv', '#event/rdv'],
  ['#vie/evenements', '#event/evenements'],
  ['#vie/badges-criteres', '#membres/badges-criteres'],
  ['#site/theme', '#pilotage/theme'],
  ['#site/reglages', '#pilotage/reglages'],
  ['#site/accueil', '#membres/accueil'],
  ['#cartes/bataille', '#cartes/arene'],
  ['#cartes/questions', '#jeux/questions'],
  ['#cartes/mes-jeux', '#jeux/mes-jeux'],
  ['#reglages', '#pilotage/identite'],
  ['#secret-santa', '#irl/secret-santa'],
  ['#bataille', '#cartes/arene'],
];

(async () => {
  const browser = await chromium.launch();
  try {
    /* (a) Anciennes adresses */
    for (const [vieille, neuve] of ANCIENNES) {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, hash: vieille });
      await attend(p, neuve);
      const h = await hash(p);
      const sub = await p.evaluate(() => document.querySelector('.shell-sub[aria-current="true"]')?.getAttribute('href') || '');
      check(h === neuve && sub === neuve.split('/').slice(0, 2).join('/'),
        `(a) ${vieille} → ${neuve}${h === neuve ? '' : ` (adresse : ${h}, sous-section : ${sub || 'aucune'})`}`);
      check(!p.errs.length, `(a) ${vieille} : aucune erreur JS` + (p.errs.length ? ` (${p.errs.slice(0, 2).join(' | ')})` : ''));
      await p.ctx.close();
    }
    /** Attend que l'adresse soit `h` (ou la limite de temps). */
    function attend(p, h) { return p.waitForFunction((want) => location.hash === want, h, { timeout: 6000 }).catch(() => {}); }

    /* (b) Arborescence du panel (administrateur) */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
      await p.waitForFunction(() => document.querySelectorAll('.shell-dom').length > 0, null, { timeout: 6000 }).catch(() => {});
      const domaines = await p.$$eval('.shell-dom', (x) => x.map((a) => a.dataset.dom));
      check(JSON.stringify(domaines) === JSON.stringify(['pilotage', 'membres', 'irl', 'event', 'cartes', 'jeux']),
        `(b) six domaines dans l’ordre : ${domaines.join(', ')}`);
      const ids = await p.$$eval('#shell-subs [data-sub]', (x) => x.map((a) => a.dataset.sub));
      check(new Set(ids).size === ids.length, `(b) identifiants de sous-section uniques (${ids.length} liens)`);
      for (const livre of ['roles', 'membres-irl', 'gestion']) {
        check(await p.locator(`#shell-subs [data-sub="${livre}"]`).count() === 1, `(b) « ${livre} » (nouvelle sous-section) est affichée`);
      }
      check(await p.locator('#shell-subs .shell-sub[data-sub="arcade"]').count() === 1, '(b) « Arcade (pages 404) » (Jeux) est affichée');
      const titres = await p.$$eval('#shell-subs .shell-subhead', (x) => x.map((t) => t.textContent.trim()));
      check(['Bot', 'Site', 'Apparence', 'Assistance', 'Comptes', 'Badges', 'Catalogue', 'Économie', 'Animation', 'Suivi'].every((t) => titres.includes(t)),
        `(b) titres de groupe présents (${titres.join(', ')})`);
      check(await p.locator('#shell-subs .shell-sub[data-sub="theme"]').count() === 1 && await p.locator('#shell-subs .shell-sub[data-sub="arene"]').count() === 1,
        '(b) « Thème » (Apparence) et « Arène » (Le jeu de cartes) sont dans l’arborescence');
      // Le rail : une couleur et une icône par domaine (les six icônes sont rendues)
      check(await p.locator('.shell-dom svg').count() >= 6, '(b) icônes du rail rendues');
      check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ` (${p.errs.slice(0, 2).join(' | ')})` : ''));
      await p.ctx.close();
    }

    /* (c) Staff : droits d'un seul domaine (membres), adresse d'un autre domaine */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['membres'] }, hash: '#irl/sorties' });
      await p.waitForFunction(() => location.hash !== '#irl/sorties', null, { timeout: 6000 }).catch(() => {});
      check(await hash(p) === '#pilotage/apercu', `(c) Staff « membres » : #irl/sorties ouvre la première page permise (${await hash(p)})`);
      const domaines = await p.$$eval('.shell-dom', (x) => x.map((a) => a.dataset.dom));
      // « membres » donne aussi IRL › Membres IRL (droit membres) ; pas Event, Le jeu de cartes ni Autres jeux.
      check(JSON.stringify(domaines) === JSON.stringify(['pilotage', 'membres', 'irl']), `(c) Staff « membres » : seuls les domaines permis (${domaines.join(', ')})`);
      check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ` (${p.errs.slice(0, 2).join(' | ')})` : ''));
      await p.ctx.close();
    }
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
