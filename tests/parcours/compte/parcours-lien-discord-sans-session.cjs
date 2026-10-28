// Parcours : lien (Discord, notification, lien de jeu) ouvert sans session.
// Une page membre redirige vers la connexion en gardant son adresse complète (chemin, paramètres, ancre) dans ?next= ;
// après connexion, retour exact à cette adresse. Un ?next= qui pointe ailleurs (autre site, « // », javascript:) est ignoré.
// Faux Supabase (fixtures/fake-sb.mjs) : voir harness.cjs. Rien n'atteint la vraie base.
// Lancer : node tests/parcours/compte/parcours-lien-discord-sans-session.cjs
const { ROOT, check, finish, openPage, chromium } = require('../../lib/harness.cjs');

const EMAIL = 'ethan@example.test';
const MDP = 'mot-de-passe-de-test';

/** Ouvre la page de connexion avec ?next=, renvoie la valeur décodée de next. */
async function ouvrirConnexion(browser, next) {
  return openPage(browser, { page: 'compte', scenario: { guest: true }, hash: `?next=${encodeURIComponent(next)}` });
}

/** Connexion avec les bons identifiants de test. */
async function connecter(p) {
  await p.fill('#li-email', EMAIL);
  await p.fill('#li-pass', MDP);
  await p.click('#pane-login button[type=submit]');
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Ancre seule : cartes.html#echanges, sans session.
  let p = await openPage(browser, { page: 'cartes', hash: '#echanges', scenario: { guest: true } });
  await p.waitForURL(/\/compte\/compte\.html/, { timeout: 8000 }).catch(() => {});
  let u = new URL(p.url());
  check(u.pathname === '/pages/compte/compte.html', 'cartes#echanges sans session : redirection vers la connexion');
  check(u.searchParams.get('next') === '/pages/cartes/cartes.html#echanges', 'cartes#echanges : next garde le chemin complet et l\'ancre (' + u.searchParams.get('next') + ')');
  await connecter(p);
  let arrivee = false;
  await p.waitForURL((x) => x.pathname === '/pages/cartes/cartes.html' && x.hash === '#echanges', { timeout: 8000 }).then(() => { arrivee = true; }, () => {});
  check(arrivee, 'cartes#echanges : après connexion, retour exact sur /pages/cartes/cartes.html#echanges (' + p.url().replace(/^.*\/pages/, '/pages') + ')');
  await p.ctx.close();

  // 2. Paramètres et ancre : irl.html?e=abc#sortie-1 (lien « voir la sortie »).
  p = await openPage(browser, { page: 'irl', hash: '?e=abc#sortie-1', scenario: { guest: true } });
  await p.waitForURL(/\/compte\/compte\.html/, { timeout: 8000 }).catch(() => {});
  u = new URL(p.url());
  check(u.pathname === '/pages/compte/compte.html', 'irl?e=abc#sortie-1 sans session : redirection vers la connexion');
  check(u.searchParams.get('next') === '/pages/irl/irl.html?e=abc#sortie-1', 'irl?e=abc#sortie-1 : next garde les paramètres et l\'ancre (' + u.searchParams.get('next') + ')');
  await connecter(p);
  arrivee = false;
  await p.waitForURL((x) => x.pathname === '/pages/irl/irl.html' && x.search === '?e=abc' && x.hash === '#sortie-1', { timeout: 8000 }).then(() => { arrivee = true; }, () => {});
  check(arrivee, 'irl?e=abc#sortie-1 : après connexion, retour exact (' + p.url().replace(/^.*\/pages/, '/pages') + ')');
  await p.ctx.close();

  // 3. Lien de jeu avec code : « J'ai un compte, me connecter » (rejoindre d'Uno) ramène au même code.
  const lienJeu = '/pages/jeux/uno.html?code=HG-ABCD';
  p = await ouvrirConnexion(browser, lienJeu);
  check(new URL(p.url()).searchParams.get('next') === lienJeu, 'lien de jeu avec ?code= : next conservé à l\'identique');
  await connecter(p);
  arrivee = false;
  await p.waitForURL((x) => x.pathname === '/pages/jeux/uno.html' && x.search === '?code=HG-ABCD', { timeout: 8000 }).then(() => { arrivee = true; }, () => {});
  check(arrivee, 'lien de jeu avec ?code= : après connexion, retour sur uno.html?code=HG-ABCD');
  await p.ctx.close();

  // 4. next malveillant : ignoré, retour à l'accueil du compte.
  const malveillants = ['https://exemple.com', '//exemple.com', 'javascript:alert(1)', '/pages/../../exemple.html', '/autre/page.html'];
  for (const next of malveillants) {
    p = await ouvrirConnexion(browser, next);
    await connecter(p);
    let ok = false;
    await p.waitForURL(/\/pages\/compte\/accueil\.html$/, { timeout: 8000 }).then(() => { ok = true; }, () => {});
    check(ok && !/exemple\.com|javascript:/.test(p.url()), 'next malveillant « ' + next + ' » ignoré : retour à /pages/compte/accueil.html');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
