// Parcours : session absente ou fermée. Ce qui tourne sur une page (rafraîchissements, minuteurs, accueil visiteur)
// ne doit jamais envoyer une RPC réservée aux membres sans session (en ligne : 401 « permission denied »,
// avec la seule clé publique). Une page ouverte sans session doit afficher son écran (connexion), pas une page vide.
// Faux Supabase : fixtures/fake-sb.mjs refuse et journalise (rpc-401) toute RPC non anonyme sans session.
// Lancer : node tests/parcours/compte/parcours-session.cjs   (HG_PREFIX=/human-gang pour servir le site sous son chemin en ligne)
const { ROOT, PREFIX, check, finish, openPage, log, sleep, chromium } = require('../../lib/harness.cjs');

/** Entrées du journal correspondant à un appel refusé faute de session (rpc-401). */
const count401 = async (p) => (await log(p)).filter((l) => l[0] === 'rpc-401');

(async () => {
  console.log('Racine testée : ' + ROOT + (PREFIX ? ' (chemin ' + PREFIX + ')' : ''));
  const browser = await chromium.launch();

  // 1. Visiteur sur l'accueil : aucun appel réservé aux membres, page affichée.
  let p = await openPage(browser, { page: 'accueil', scenario: { guest: true } });
  let bad = await count401(p);
  check(!bad.length, 'visiteur sur l\'accueil : aucune RPC réservée aux membres' + (bad.length ? ' (' + bad.map((l) => l[1]).join(', ') + ')' : ''));
  check(!p.errs.length, 'visiteur sur l\'accueil : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check((await p.textContent('#app')).trim().length > 40, 'visiteur sur l\'accueil : contenu affiché');
  await p.ctx.close();

  // 2. Visiteur sur une page membre : renvoi vers la connexion, pas d'écran vide.
  p = await openPage(browser, { page: 'membre', scenario: { guest: true } });
  check(/compte\.html\?next=membre\.html/.test(p.url()), 'visiteur sur /pages/compte/membre.html : renvoi vers /pages/compte/compte.html (next=membre.html)');
  check(await p.isVisible('#pane-login'), 'visiteur sur /pages/compte/membre.html : formulaire de connexion affiché');
  bad = await count401(p);
  check(!bad.length, 'visiteur sur /pages/compte/membre.html : aucune RPC réservée aux membres' + (bad.length ? ' (' + bad.map((l) => l[1]).join(', ') + ')' : ''));
  check(!p.errs.length, 'visiteur sur /pages/compte/membre.html : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2 bis. Visiteur sur /pages/compte/compte.html : écran de connexion, aucune RPC membre.
  p = await openPage(browser, { page: 'compte', scenario: { guest: true } });
  check(await p.isVisible('#pane-login'), 'visiteur sur /pages/compte/compte.html : formulaire de connexion affiché');
  bad = await count401(p);
  check(!bad.length, 'visiteur sur /pages/compte/compte.html : aucune RPC réservée aux membres' + (bad.length ? ' (' + bad.map((l) => l[1]).join(', ') + ')' : ''));
  await p.ctx.close();

  // 3. Membre déconnecté pendant que la page tourne : les rafraîchissements en cours ou à venir ne doivent rien envoyer.
  p = await openPage(browser, { page: 'irl' });
  const res = await p.evaluate(async () => {
    const base = location.href;
    /** Importe un module JavaScript du site (chemin relatif f) pour vérifier son contenu. */
    const m = (f) => import(new URL(f, base).href);
    const sbm = await m('/assets/commun/core/supabase.js');
    const unread = await m('/assets/commun/core/unread.js');
    const badges = await m('/assets/commun/core/badges.js');
    const pages = await m('/assets/commun/core/pages-access.js');
    const dyn = await m('/assets/commun/dyn-events.js');
    await sbm.sb.auth.signOut();
    await Promise.allSettled([
      unread.refreshUnread(),
      badges.checkNewBadges({ force: true }),
      pages.loadMyPages({ force: true }),
      dyn.getActiveDynEvents({ force: true }),
    ]);
    return window.__LOG.filter((l) => l[0] === 'rpc-401').map((l) => l[1]);
  });
  check(!res.length, 'après déconnexion : rafraîchissements sans session, aucune RPC envoyée' + (res.length ? ' (' + res.join(', ') + ')' : ''));
  await p.ctx.close();

  // 4. Membre : la déconnexion depuis l'en-tête mène à /pages/compte/compte.html sans erreur JS.
  p = await openPage(browser, { page: 'accueil' });
  await p.click('.nav-me'); // « Se déconnecter » est dans l'éventail de la photo de profil
  await p.click('.me-fan .nav-logout');
  await p.waitForURL(/compte\.html/, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  check(/compte\.html$/.test(p.url()), 'déconnexion depuis l\'en-tête : arrivée sur /pages/compte/compte.html');
  check(await p.isVisible('#pane-login').catch(() => false), 'déconnexion depuis l\'en-tête : connexion affichée');
  check(!p.errs.length, 'déconnexion depuis l\'en-tête : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
