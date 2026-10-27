// Parcours : état du site (core/site-etat.js) — bandeau d'annonce et écran de maintenance, sur le faux Supabase.
// (a) sans réglage : ni bandeau ni écran, aucune feuille site-etat.css chargée ;
// (b) bandeau actif : visible sous l'en-tête de l'accueil (role="status"), fermé pour la session (rechargement), absent du panel ;
//     un texte vide n'affiche rien ;
// (c) maintenance : l'accueil montre l'écran à un membre (contenu masqué, lien « Changer de compte ») et à un visiteur
//     (« Se connecter ») ; pas à l'administrateur ni au Staff ;
// (d) admin.html, compte.html, /pages/infos/legal.html jamais bloquées ;
// (e) 360 px sans défilement horizontal (bandeau + écran) ; cible du bouton de fermeture ≥ 44 px ; aucune erreur JS.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/compte/parcours-site-etat.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('../../lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Scénario avec site_identite donné (réglages semés dans hg_settings). */
const withId = (identite, extra = {}) => ({ settings: [{ key: 'site_identite', value: identite }], ...extra });
const BANDEAU = { bandeau_actif: true, bandeau_texte: 'Soirée raclette samedi chez {nom} !' };
const MAINT = { maintenance_active: true, maintenance_message: 'On repeint les murs, retour ce soir.' };
/** Écran de maintenance visible et contenu masqué. */
const maintOn = (p) => p.evaluate(() => {
  const s = document.getElementById('site-maint'), app = document.getElementById('app');
  return !!s && s.getClientRects().length > 0 && !!app && app.getClientRects().length === 0;
});
const maintOff = (p) => p.evaluate(() => !document.getElementById('site-maint') && !document.body.classList.contains('site-maint-on'));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const errs = [];
  const done = async (p) => { errs.push(...p.errs.map((e) => `${p.url()} : ${e}`)); await p.ctx.close(); };

  /* (a) Sans réglage */
  let p = await openPage(browser, { page: 'accueil', scenario: { uid: U(2) } });
  check(await p.locator('.site-bandeau').count() === 0 && await maintOff(p), '(a) sans réglage : ni bandeau ni maintenance');
  check(await p.locator('link[data-site-etat]').count() === 0, '(a) feuille site-etat.css non chargée');
  check(await p.locator('#app').isVisible(), '(a) contenu de l\'accueil visible');
  await done(p);

  /* (b) Bandeau */
  p = await openPage(browser, { page: 'accueil', scenario: withId(BANDEAU, { uid: U(2) }) });
  await p.waitForSelector('.site-bandeau', { timeout: 5000 });
  check((await p.getAttribute('.site-bandeau', 'role')) === 'status', '(b) bandeau role="status"');
  check((await p.textContent('.site-bandeau-texte')).includes('Soirée raclette samedi chez Humane Gang'), '(b) texte du bandeau, {nom} remplacé');
  check(await p.evaluate(() => document.querySelector('.site-header')?.nextElementSibling?.classList.contains('site-bandeau')), '(b) bandeau juste sous l\'en-tête');
  check(await maintOff(p), '(b) pas de maintenance');
  const box = await p.locator('.site-bandeau-fermer').boundingBox();
  check(box && box.width >= 44 && box.height >= 44, '(b) bouton de fermeture ≥ 44 px');
  await p.click('.site-bandeau-fermer');
  check(await p.locator('.site-bandeau').count() === 0, '(b) bandeau fermé');
  await p.reload();
  await p.waitForTimeout(1200);
  check(await p.locator('.site-bandeau').count() === 0, '(b) fermé pour la session (après rechargement)');
  await done(p);
  p = await openPage(browser, { page: 'accueil', scenario: withId({ bandeau_actif: true, bandeau_texte: '   ' }, { uid: U(2) }) });
  check(await p.locator('.site-bandeau').count() === 0, '(b) texte vide : pas de bandeau');
  await done(p);
  p = await openPage(browser, { page: 'admin', scenario: withId(BANDEAU) });
  check(await p.locator('.site-bandeau').count() === 0, '(b) pas de bandeau dans le panel');
  await done(p);

  /* (c) Maintenance */
  p = await openPage(browser, { page: 'accueil', scenario: withId({ ...MAINT, ...BANDEAU }, { uid: U(2) }) });
  check(await maintOn(p), '(c) membre : écran de maintenance, contenu masqué');
  check((await p.textContent('#site-maint')).includes('On repeint les murs'), '(c) message saisi par l\'admin');
  check((await p.textContent('#site-maint a[href="/pages/compte/compte.html"]')).includes('Changer de compte'), '(c) lien vers /pages/compte/compte.html');
  check(await p.locator('.site-header').isVisible(), '(c) en-tête toujours visible');
  check(await p.locator('.site-bandeau').count() === 1, '(c) le bandeau reste affiché au-dessus');
  await done(p);
  p = await openPage(browser, { page: 'accueil', scenario: withId({ maintenance_active: true, maintenance_message: '' }, { guest: true }) });
  check(await maintOn(p), '(c) visiteur : écran de maintenance');
  check((await p.textContent('#site-maint')).includes('Le site est en maintenance, reviens un peu plus tard.'), '(c) message par défaut si vide');
  check((await p.textContent('#site-maint a')).includes('Se connecter'), '(c) visiteur : « Se connecter »');
  await done(p);
  p = await openPage(browser, { page: 'accueil', scenario: withId(MAINT) });
  check(await maintOff(p) && await p.locator('#app').isVisible(), '(c) administrateur : pas d\'écran de maintenance');
  await done(p);
  p = await openPage(browser, { page: 'accueil', scenario: withId(MAINT, { uid: U(3), staff: ['cartes'] }) });
  check(await maintOff(p) && await p.locator('#app').isVisible(), '(c) Staff : pas d\'écran de maintenance');
  await done(p);
  p = await openPage(browser, { page: 'irl', scenario: withId(MAINT, { uid: U(2) }) });
  check(await maintOn(p), '(c) autre page de membre (irl) : écran de maintenance');
  await done(p);

  /* (d) Pages jamais bloquées */
  for (const [slug, scn] of [['compte', { uid: U(2) }], ['legal', { uid: U(2) }], ['compte', { guest: true }], ['admin', { uid: U(3), staff: ['cartes'] }], ['admin', {}]]) {
    p = await openPage(browser, { page: slug, scenario: withId(MAINT, scn) });
    check(await maintOff(p), `(d) ${slug}.html (${scn.guest ? 'visiteur' : scn.staff ? 'Staff' : scn.uid ? 'membre' : 'admin'}) jamais bloquée`);
    await done(p);
  }

  /* (e) Mobile 360 px */
  p = await openPage(browser, { page: 'accueil', width: 360, height: 780, scenario: withId({ ...MAINT, bandeau_actif: true,
    bandeau_texte: 'Annonce très longue : ' + 'motsansespacetreslongpourtesterlecoupage'.repeat(3) + ' fin.' }, { uid: U(2) }) });
  check(await maintOn(p) && await p.locator('.site-bandeau').count() === 1, '(e) 360 px : bandeau et écran affichés');
  check((await hscroll(p)) <= 0, '(e) 360 px : pas de défilement horizontal');
  await done(p);
  p = await openPage(browser, { page: 'accueil', width: 360, height: 780, scenario: withId(BANDEAU, { uid: U(2) }) });
  check((await hscroll(p)) <= 0, '(e) 360 px, bandeau seul : pas de défilement horizontal');
  await done(p);

  check(errs.length === 0, '(e) aucune erreur JS' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
