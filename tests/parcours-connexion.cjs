// Parcours : connexion depuis la page Mon compte (compte.html).
// Faux Supabase (fixtures/fake-sb.mjs) : signInWithPassword accepte tout mot de passe non vide
// et ouvre une session qui persiste dans localStorage ; avec badPassword, il répond
// « Invalid login credentials ». Rien n'atteint la vraie base (voir harness.cjs).
// Lancer : node tests/parcours-connexion.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

const EMAIL = 'ethan@example.test';

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1. Identifiants invalides : message en français, la page reste sur compte.html.
  let p = await openPage(browser, { page: 'compte', scenario: { guest: true, badPassword: true } });
  check(await p.isVisible('#pane-login'), 'visiteur : formulaire de connexion affiché');
  await p.fill('#li-email', EMAIL);
  await p.fill('#li-pass', 'mauvais-mot-de-passe');
  await p.click('#pane-login button[type=submit]');
  await p.waitForSelector('#pane-login .form-error:not([hidden])', { timeout: 5000 }).catch(() => {});
  const err = await p.textContent('#pane-login .form-error').catch(() => '');
  check(/E-mail ou mot de passe incorrect/.test(err), 'identifiants faux : message « E-mail ou mot de passe incorrect »');
  check(p.url().endsWith('/compte.html'), 'identifiants faux : pas de redirection');
  check((await log(p)).some((l) => l[0] === 'auth' && l[1] === 'signInWithPassword' && l[2] === EMAIL), 'identifiants faux : la connexion a bien été tentée');
  check(!p.errs.length, 'identifiants faux : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 2. Bons identifiants : connexion puis redirection vers l'accueil.
  p = await openPage(browser, { page: 'compte', scenario: { guest: true } });
  await p.fill('#li-email', EMAIL);
  await p.fill('#li-pass', 'mot-de-passe-de-test');
  await p.click('#pane-login button[type=submit]');
  let redirected = true;
  await p.waitForURL(/\/accueil\.html$/, { timeout: 8000 }).catch(() => { redirected = false; });
  check(redirected, 'bons identifiants : redirection vers accueil.html');
  check(!p.errs.length, 'bons identifiants : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Session ouverte : la page Mon compte affiche le profil (pseudo et bouton de déconnexion).
  p = await openPage(browser, { page: 'compte', scenario: {} });
  await p.waitForSelector('#head-pseudo', { timeout: 5000 }).catch(() => {});
  check((await p.textContent('#head-pseudo').catch(() => '')) === 'Ethan', 'session ouverte : pseudo affiché sur compte.html');
  check(await p.isVisible('#logout'), 'session ouverte : bouton « Se déconnecter » visible');
  await p.ctx.close();

  await browser.close();
  finish();
})();
