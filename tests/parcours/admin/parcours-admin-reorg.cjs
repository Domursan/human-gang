// Parcours : réorganisation du panel admin (migration 103) : sept lieux, anciennes adresses et droits.
// (a) Anciennes adresses (#communication/assistance, #vie/secret-santa, #fabrique/bataille, #site/theme…) : chacune ouvre la
//     bonne sous-section (adresse remplacée, identifiant et onglet conservés), y compris les anciennes ancres de section.
// (b) Arborescence : six domaines dans l'ordre, identifiants de sous-section uniques, sous-sections non livrées absentes,
//     titres de groupe (Bot, Site, Apparence, Assistance…).
// (c) Staff sans les droits d'un domaine : une adresse de ce domaine ouvre la première page permise (pas d'erreur).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/admin/parcours-admin-reorg.cjs
const { check, finish, openPage, log, chromium } = require('../../lib/harness.cjs');

/** Adresse courante du fragment (ex. « #poste/assistance »). */
const hash = (p) => p.evaluate(() => location.hash);
/** Attend que le fragment soit `h` et que la sous-section active soit celle de `h` (ou la limite de temps). */
const attendre = (p, h) => p.waitForFunction((want) => {
  if (location.hash !== want) return false;
  return document.getElementById('shell')?.dataset.route === want.slice(1).split('/').slice(0, 2).join('/');
}, h, { timeout: 6000 }).catch(() => {});

/** Anciennes adresses et la nouvelle adresse attendue (l'identifiant et l'onglet suivent). */
const ANCIENNES = [
  ['#communication/assistance', '#poste/assistance'],
  ['#communication/assistance/sup-a', '#poste/assistance/sup-a'],
  ['#communication/idees', '#poste/idees'],
  ['#communication/bot', '#poste/bot'],
  ['#vie/secret-santa', '#camp/secret-santa'],
  ['#vie/sorties/ev-1', '#camp/sorties/ev-1'],
  ['#vie/souvenirs/ce-jour', '#camp/souvenirs/ce-jour'],
  ['#vie/rdv', '#fete/rdv'],
  ['#vie/evenements', '#fete/evenements'],
  ['#vie/badges-criteres', '#place/badges-criteres'],
  ['#site/theme', '#mairie/theme'],
  ['#site/reglages', '#mairie/reglages'],
  ['#site/accueil', '#place/accueil'],
  ['#fabrique/bataille', '#fabrique/arene'],
  ['#fete/questions', '#fete/questions'],
  ['#fete/mes-jeux', '#fete/mes-jeux'],
  ['#reglages', '#mairie/identite'],
  ['#secret-santa', '#camp/secret-santa'],
  ['#bataille', '#fabrique/arene'],
];

(async () => {
  const browser = await chromium.launch();
  try {
    /* (a) Anciennes adresses */
    for (const [vieille, neuve] of ANCIENNES) {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, hash: vieille });
      await attend(p, neuve);
      const h = await hash(p);
      const sub = await p.evaluate(() => document.getElementById('shell')?.dataset.route || '');
      check(h === neuve && sub === neuve.slice(1).split('/').slice(0, 2).join('/'),
        `(a) ${vieille} → ${neuve}${h === neuve ? '' : ` (adresse : ${h}, sous-section : ${sub || 'aucune'})`}`);
      check(!p.errs.length, `(a) ${vieille} : aucune erreur JS` + (p.errs.length ? ` (${p.errs.slice(0, 2).join(' | ')})` : ''));
      await p.ctx.close();
    }
    /** Attend que l'adresse soit `h` (ou la limite de temps). */
    function attend(p, h) { return p.waitForFunction((want) => location.hash === want, h, { timeout: 6000 }).catch(() => {}); }

    /* (b) Arborescence du panel (administrateur) : sept lieux, pages uniques, titres de groupe */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
      await p.waitForSelector('.plateau-lieu', { timeout: 6000 }).catch(() => {});
      const lieux = await p.$$eval('.plateau-lieu', (x) => x.map((a) => a.getAttribute('href')));
      check(JSON.stringify(lieux) === JSON.stringify(['#place', '#poste', '#ventes', '#camp', '#fabrique', '#fete', '#mairie']),
        `(b) sept lieux dans l’ordre : ${lieux.join(' ')}`);
      const ids = [];
      const titres = [];
      for (const lieu of lieux) {
        await p.evaluate((h) => { location.hash = h; }, lieu);
        await p.waitForSelector('#lieu-root .lieu-tile', { timeout: 6000 }).catch(() => {});
        ids.push(...(await p.$$eval('#lieu-root .lieu-tile', (x) => x.map((a) => a.dataset.sub))));
        titres.push(...(await p.$$eval('#lieu-root .lieu-group-title', (x) => x.map((t) => t.textContent.trim()))));
      }
      check(new Set(ids).size === ids.length, `(b) identifiants de page uniques (${ids.length} tuiles)`);
      for (const livre of ['roles', 'membres-irl', 'gestion', 'arcade']) {
        check(ids.includes(livre), `(b) « ${livre} » (page de lieu) est affichée`);
      }
      check(['Membres', 'Relances', 'Demandes', 'Discord', 'Accès', 'Badges', 'Catalogue', 'Économie', 'Animations', 'Suivi', 'Le site', 'Technique'].every((t) => titres.includes(t)),
        `(b) titres de groupe présents (${titres.join(', ')})`);
      check(ids.includes('theme') && ids.includes('arene'), '(b) « Thème » et « Arène » sont dans l’arborescence');
      check(await p.locator('.plateau-ico svg').count() >= 7, '(b) icônes des lieux rendues');
      check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ` (${p.errs.slice(0, 2).join(' | ')})` : ''));
      await p.ctx.close();
    }

    /* (c) Staff : droits d'un seul domaine (membres), adresse d'un autre lieu */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: '00000002-0000-4000-8000-000000000002', staff: ['membres'] }, hash: '#camp/sorties' });
      await p.waitForFunction(() => location.hash !== '#camp/sorties', null, { timeout: 6000 }).catch(() => {});
      const lieux = await p.$$eval('.plateau-lieu', (x) => x.map((a) => a.getAttribute('href')));
      check(!(await hash(p)).startsWith('#camp/sorties') || lieux.includes('#camp'), `(c) Staff « membres » : #camp/sorties ne s’ouvre que si le lieu est permis (${await hash(p)})`);
      check(lieux.includes('#place') && !lieux.includes('#fete') && !lieux.includes('#fabrique'), `(c) Staff « membres » : seuls les lieux permis (${lieux.join(' ')})`);
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
