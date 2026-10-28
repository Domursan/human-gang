// Parcours : mémoire d'affichage (core/memoire.js, init.js, profile.js, pages-access.js, perms.js, godmode.js).
// (a) membre : à la 2e et à la 3e page, aucun appel de profil, de pages, de droits ni de mode sans limite avant l'en-tête ;
//     en-tête et menu affichés tout de suite ; la base est relue ensuite (après l'affichage).
// (b) droit de page retiré entre deux pages : la relecture en arrière-plan renvoie à l'accueil, avec le message de refus.
// (c) déconnexion : la mémoire d'affichage et les droits gardés sont effacés.
// (d) autre compte : la mémoire d'un autre compte est effacée au démarrage, et l'en-tête montre le bon membre.
// (e) mémoire périmée (plus de 10 minutes) : démarrage complet, avec les appels avant l'en-tête.
// (f) vue « comme un membre » : la mémoire des pages et du mode sans limite de l'admin n'est pas écrasée.
// (g) admin en mode sans limite : la mémoire le garde, et la page suivante affiche le bandeau tout de suite.
// Faux Supabase : fixtures/fake-sb.mjs (window.__DB, window.__LOG). Lancer : node tests/parcours/compte/parcours-memoire-affichage.cjs
const { ORIGIN, PREFIX, urlPage, check, finish, openPage, sleep, chromium } = require('../../lib/harness.cjs');

const ALICE = '00000002-0000-4000-8000-000000000002'; // membre sans droit de panel
const ETHAN = '11111111-1111-4111-8111-111111111111'; // admin

/** Script de chaque chargement : note les appels de démarrage émis avant l'en-tête et avant le menu. */
function observateur() {
  const BOOT = new Set(['hg_profiles', 'hg_pages', 'hg_admin_state', 'hg_my_pages', 'hg_god_mode', 'hg_my_perms']);
  const RE = /^(rpc|select|insert|update|upsert|delete)$/;
  const boot = () => (window.__LOG || []).filter((e) => RE.test(e[0]) && BOOT.has(e[1])).length;
  window.__M = {};
  const obs = new MutationObserver(() => {
    if (window.__M.entete === undefined && document.querySelector('.site-header')) window.__M.entete = boot();
    if (window.__M.menu === undefined && document.querySelector('.site-header .nav-top')) window.__M.menu = boot();
    if (window.__M.entete !== undefined && window.__M.menu !== undefined) obs.disconnect();
  });
  obs.observe(document, { childList: true, subtree: true });
}
// Faux serveur, par chargement : hg_god_mode répond « activé » ; hg_my_pages ne donne plus la page irl si le test l'a demandé
// (localStorage « hg_test_retire » = 'irl'), comme si l'admin avait retiré l'accès pendant la visite.
const CONTENU_OBS = `(${observateur.toString()})(); window.__FAKE_RPC = async (fn) => {
  if (fn === 'hg_god_mode') return { data: true, error: null };
  if (fn === 'hg_my_pages' && localStorage.getItem('hg_test_retire') === 'irl') {
    const pages = (window.__DB.hg_pages || []).filter((p) => p.mode === 'membres' && p.slug !== 'irl')
      .map(({ slug, label, in_nav, sort }) => ({ slug, label, in_nav, sort }));
    return { data: pages, error: null };
  }
  return undefined;
};`;
const CONTENU_DIEU = CONTENU_OBS;

/** Va sur une page du site (même onglet) et attend son affichage. */
async function aller(p, slug) {
  await p.goto(`${ORIGIN}${PREFIX}${urlPage(slug)}`);
  await sleep(1200);
}
/** Appels relevés au chargement courant : avant en-tête, avant menu, et journal des appels. */
const mesure = (p) => p.evaluate(() => ({
  entete: window.__M?.entete,
  menu: window.__M?.menu,
  rpc: (window.__LOG || []).filter((e) => e[0] === 'rpc').map((e) => e[1]),
}));
/** Clés de mémoire d'affichage présentes dans l'onglet. */
const cles = (p) => p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('hg_memo:') || k === 'hg_my_perms'));

(async () => {
  const browser = await chromium.launch();
  try {
    // (a) Membre : pages 2 et 3 affichées sans appel de démarrage avant l'en-tête
    {
      const p = await openPage(browser, { page: 'accueil', scenario: { uid: ALICE }, init: { content: CONTENU_OBS } });
      check((await cles(p)).some((k) => k === 'hg_memo:' + ALICE), '(a) après la 1re page : mémoire d’affichage du compte gardée');
      await aller(p, 'irl');
      const m2 = await mesure(p);
      check(m2.entete === 0, `(a) 2e page : aucun appel de profil, de pages ni de droits avant l’en-tête (${m2.entete})`);
      check(m2.menu === 0, `(a) 2e page : le menu aussi s'affiche sans appel (${m2.menu})`);
      check(await p.isVisible('.site-header .nav-top') || (await p.$('.site-header .nav-top')) !== null, '(a) 2e page : menu présent');
      check(m2.rpc.includes('hg_my_pages') && m2.rpc.includes('hg_my_perms'), '(a) 2e page : les pages et les droits sont relus après l’affichage');
      check(/\/irl\.html$/.test(p.url()), '(a) 2e page : reste sur la page demandée');
      await aller(p, 'cartes');
      const m3 = await mesure(p);
      check(m3.entete === 0 && m3.menu === 0, `(a) 3e page : aucun appel avant l’en-tête (${m3.entete}, menu ${m3.menu})`);
      check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      // (b) droit retiré entre deux pages : la relecture renvoie à l'accueil
      await aller(p, 'irl');
      await p.evaluate(() => localStorage.setItem('hg_test_retire', 'irl'));
      await aller(p, 'irl');
      const renvoye = await p.waitForURL(/\/pages\/compte\/accueil\.html/, { timeout: 8000 }).then(() => true).catch(() => false);
      check(renvoye, '(b) page retirée : la relecture en arrière-plan renvoie à l’accueil');
      // Le message d'accès refusé est celui de l'accueil (?refus=irl, retiré ensuite de l'adresse)
      const message = await p.waitForFunction(() => document.body.innerText.includes('pas accès'), null, { timeout: 5000 }).then(() => true).catch(() => false);
      check(message, '(b) accueil : message « Tu n’as pas accès à cette page » affiché');
      // (c) déconnexion : mémoire et droits effacés
      await p.click('.nav-me');
      await p.click('.me-fan .nav-logout');
      await p.waitForURL(/compte\.html/, { timeout: 8000 }).catch(() => {});
      check((await cles(p)).length === 0, '(c) déconnexion : mémoire d’affichage et droits effacés');
      await p.ctx.close();
    }
    // (d) Autre compte : sa mémoire est effacée, l'en-tête montre le membre connecté
    {
      const p = await openPage(browser, { page: 'accueil', scenario: { uid: ALICE }, init: { content: CONTENU_OBS } });
      await p.evaluate((me) => sessionStorage.setItem('hg_memo:' + me, JSON.stringify({ profil: { t: Date.now(), v: { id: me, pseudo: 'Ethan', is_admin: true } } })), ETHAN);
      await aller(p, 'irl');
      const restent = await cles(p);
      check(!restent.includes('hg_memo:' + ETHAN), '(d) mémoire d’un autre compte effacée au démarrage');
      const nom = await p.getAttribute('.site-header .nav-me', 'aria-label');
      check(/Alice/.test(nom || ''), `(d) en-tête : le membre connecté (« ${nom} »)`);
      await p.ctx.close();
    }
    // (e) Mémoire périmée : démarrage complet, appels avant l'en-tête
    {
      const p = await openPage(browser, { page: 'accueil', scenario: { uid: ALICE }, init: { content: CONTENU_OBS } });
      await p.evaluate(() => {
        const k = Object.keys(sessionStorage).find((x) => x.startsWith('hg_memo:'));
        const v = JSON.parse(sessionStorage.getItem(k) || '{}');
        for (const c of Object.keys(v)) v[c].t -= 11 * 60 * 1000;
        sessionStorage.setItem(k, JSON.stringify(v));
      });
      await aller(p, 'irl');
      const m = await mesure(p);
      check(m.entete >= 1, `(e) mémoire de plus de 10 minutes : démarrage complet, relu avant l’en-tête (${m.entete})`);
      check(!p.errs.length, '(e) aucune erreur JS');
      await p.ctx.close();
    }
    // (f) Vue « comme un membre » : la mémoire des pages et du mode sans limite de l'admin n'est pas écrasée
    {
      const p = await openPage(browser, { page: 'accueil', init: { content: CONTENU_OBS } });
      const valeurs = () => p.evaluate((me) => {
        const v = JSON.parse(sessionStorage.getItem('hg_memo:' + me) || '{}');
        return JSON.stringify({ pages: v.pages?.v ?? null, god: v.god?.v ?? null });
      }, ETHAN);
      const avant = await valeurs();
      check(avant !== 'null' && avant.includes('"declared"'), '(f) admin : pages gardées avant la vue');
      await p.evaluate((u) => sessionStorage.setItem('hg_view_as', JSON.stringify({ id: u, pseudo: 'Alice', is_admin: false, pages: [{ slug: 'accueil', label: 'Accueil', in_nav: false, sort: 0 }], roles: [] })), ALICE);
      await aller(p, 'accueil');
      check((await valeurs()) === avant, '(f) vue « comme un membre » : pages et mode sans limite de l’admin inchangés');
      check(await p.$('.view-as-bar') !== null, '(f) bandeau de vue affiché');
      await p.evaluate(() => sessionStorage.removeItem('hg_view_as'));
      await p.ctx.close();
    }
    // (g) Admin en mode sans limite : gardé en mémoire, bandeau dès la page suivante
    {
      const p = await openPage(browser, { page: 'accueil', init: { content: CONTENU_DIEU } });
      await aller(p, 'irl');
      const gardé = await p.evaluate((me) => JSON.parse(sessionStorage.getItem('hg_memo:' + me) || '{}').god?.v ?? null, ETHAN);
      check(!!gardé && gardé.on === true, '(g) mode sans limite gardé en mémoire');
      const m = await mesure(p);
      check(m.entete === 0, `(g) page suivante : aucun appel avant l’en-tête (${m.entete})`);
      check(await p.getAttribute('html', 'data-godmode') === 'on', '(g) page suivante : mode sans limite affiché');
      check(await p.$('.god-banner') !== null, '(g) bandeau du mode sans limite affiché');
      await p.ctx.close();
    }
  } finally {
    await browser.close();
  }
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
