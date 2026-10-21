// Parcours : aide et tutos.
// Bouton « ? » dans la colonne d'outils (et lien « Aide & tutos » dans le menu mobile) sur plusieurs pages ;
// page aide.html : liste des groupes, recherche, tuto ouvert par l'adresse aide.html#<slug>, « Y aller » ;
// visiteur (sans compte) : seulement les tutos « Premiers pas » ; accès à l'assistance depuis l'aide ;
// plus de lien Assistance dans le pied de page ; 390 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb.mjs (scenario.guest pour un visiteur).
// Lancer : node tests/parcours-aide.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { ORIGIN, PREFIX, check, finish, openPage, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const SLUG = 'utiliser-la-page-aide';

(async () => {
  const browser = await chromium.launch();

  /* ---------- Bouton « ? » sur plusieurs pages (membre, 1280 px) ---------- */
  for (const pg of ['accueil', 'cartes', 'irl', 'compte', 'assistance', 'legal']) {
    const p = await openPage(browser, { page: pg, width: 1280 });
    const n = await p.locator('.side-tools a.nav-help[href="aide.html"]').count();
    check(n === 1, `${pg} : bouton « ? » dans la colonne d'outils (${n})`);
    await p.ctx.close();
  }

  /* ---------- Visiteur : bouton « ? » aussi, pied de page sans Assistance ---------- */
  let p = await openPage(browser, { page: 'accueil', scenario: { guest: true }, width: 1280 });
  check(await p.locator('.side-tools a.nav-help').count() === 1, 'visiteur : bouton « ? » présent');
  check(await p.locator('.site-footer a[href="assistance.html"]').count() === 0, 'pied de page : plus de lien Assistance');
  await p.ctx.close();

  /* ---------- Membre : pied de page sans Assistance, page d'aide ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  check(await p.locator('.site-footer a[href="assistance.html"]').count() === 0, 'membre : pied de page sans lien Assistance');
  check(await p.locator('.site-footer a[href="legal.html#mentions"]').count() === 1, 'membre : pied de page garde les liens légaux');
  await p.ctx.close();

  /* ---------- Page d'aide (membre) : liste, recherche ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  check(p.errs.length === 0, `aide : chargement sans erreur${p.errs.length ? ' ' + p.errs.join(' | ') : ''}`);
  check(await p.locator('.aide-group').count() === 1, 'aide : un groupe affiché (Premiers pas)');
  check(await p.locator(`a.aide-tuto-link[href="aide.html#${SLUG}"]`).count() === 1, 'aide : le tuto de démonstration est listé');
  check(await p.locator('.aide-tuto-title').first().innerText().then((t) => t.includes("Utiliser la page d'aide")), 'aide : titre du tuto affiché');
  await p.fill('#aide-q', 'booster');
  await sleep(150);
  check(await p.locator('.aide-tuto-link').count() === 0, 'recherche « booster » : aucun résultat');
  check(await p.locator('#aide-empty').isVisible(), 'recherche « booster » : message « aucun tuto »');
  await p.fill('#aide-q', 'ASSISTANCE');
  await sleep(150);
  check(await p.locator(`a.aide-tuto-link[href="aide.html#${SLUG}"]`).count() === 1, 'recherche « ASSISTANCE » (mot-clé, casse ignorée) : trouve le tuto');
  await p.fill('#aide-q', 'Utilisér');
  await sleep(150);
  check(await p.locator(`a.aide-tuto-link[href="aide.html#${SLUG}"]`).count() === 1, 'recherche « Utilisér » (accents ignorés) : trouve le tuto');
  await p.fill('#aide-q', '');
  await sleep(100);
  check(await p.locator('#aide-count').innerText().then((t) => t === ''), 'recherche vide : pas de compteur');
  check(await p.locator('.side-tools a.nav-help[aria-current="page"]').count() === 1, 'aide : « ? » marqué comme page courante');
  check(await hscroll(p) <= 0, 'aide 1280 : pas de défilement horizontal');
  await p.ctx.close();

  /* ---------- Tuto ouvert par son adresse ---------- */
  p = await openPage(browser, { page: 'aide', hash: '#' + SLUG, width: 1280 });
  check(await p.locator('#aide-list-view').isHidden(), 'tuto par adresse : la liste est masquée');
  check(await p.locator('#aide-tuto-view').isVisible(), 'tuto par adresse : le tuto est affiché');
  check(await p.locator('.aide-step').count() === 5, 'tuto : cinq étapes numérotées');
  check(await p.locator('.aide-step-num').first().innerText().then((t) => t === '1'), 'tuto : numérotation à partir de 1');
  check(await p.locator('.aide-shot').count() === 1, 'tuto : la capture de l\'étape 1 est là');
  check(await p.locator('.aide-tips li').count() === 2, 'tuto : deux astuces');
  check(await p.locator('.aide-actions a.btn-primary').getAttribute('href') === 'aide.html', 'tuto : bouton « Y aller » vers la page du tuto');
  check(await p.title().then((t) => t.startsWith("Utiliser la page d'aide")), 'tuto : titre de l\'onglet mis à jour');
  check(await hscroll(p) <= 0, 'tuto 1280 : pas de défilement horizontal');
  // Retour à la liste par le fil d'Ariane
  await p.click('.aide-crumb a');
  await sleep(200);
  check(await p.locator('#aide-list-view').isVisible(), 'tuto : « Tous les tutos » revient à la liste');
  await p.ctx.close();

  /* ---------- Adresse inconnue ---------- */
  p = await openPage(browser, { page: 'aide', hash: '#n-existe-pas', width: 1280 });
  check((await p.locator('#aide-tuto-view').innerText()).includes("n'existe pas"), 'adresse inconnue : message « n\'existe pas »');
  await p.ctx.close();

  /* ---------- Visiteur : tutos Premiers pas seulement, pas de tuto membre ---------- */
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, width: 1280 });
  check(await p.locator(`a.aide-tuto-link[href="aide.html#${SLUG}"]`).count() === 1, 'visiteur : tuto « Premiers pas » visible');
  check(await p.locator('#aide-guest').isVisible(), 'visiteur : note « Te connecter » affichée');
  check(await p.locator('#aide-list-view a[href="compte.html"]').count() >= 1, 'visiteur : lien vers la connexion');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, hash: '#' + SLUG, width: 1280 });
  check(await p.locator('.aide-steps').count() === 1, 'visiteur : tuto « Premiers pas » ouvrable par son adresse');
  await p.ctx.close();

  /* ---------- Assistance depuis l'aide ---------- */
  p = await openPage(browser, { page: 'aide', width: 1280 });
  const help = p.locator('.aide-help');
  check(await help.locator('a[href="assistance.html"]').count() === 1, 'aide : « Contacter l\'assistance » mène à assistance.html');
  check(await help.locator('a[href="assistance.html?sujet=Bug%20sur%20le%20site"]').count() === 1, 'aide : « Signaler un bug » mène au sujet « Bug sur le site »');
  check(await help.locator('a[href="accueil.html#idees"]').count() === 1, 'aide : « Proposer une idée » mène à la boîte à idées');
  await help.locator('a[href="assistance.html?sujet=Bug%20sur%20le%20site"]').click();
  await p.waitForURL(/assistance\.html\?sujet=Bug/, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  check(await p.locator('#sp-subject').inputValue().then((v) => v === 'Bug sur le site'), 'assistance : le sujet « Bug sur le site » est pré-rempli');
  check(await p.locator('#support-form').isVisible(), 'assistance : le formulaire est intact');
  await p.ctx.close();

  /* ---------- Téléphone 390 px : bouton, menu, page d'aide sans défilement ---------- */
  p = await openPage(browser, { page: 'accueil', width: 390 });
  check(await p.locator('.side-tools a.nav-help').isVisible(), '390 px : bouton « ? » visible dans la rangée d\'outils');
  check(await hscroll(p) <= 0, '390 px accueil : pas de défilement horizontal');
  await p.click('.nav-toggle');
  await sleep(150);
  check(await p.locator('.nav a.nav-help-link').isVisible(), '390 px : « Aide & tutos » dans le menu');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', width: 390 });
  check(await hscroll(p) <= 0, '390 px aide : pas de défilement horizontal (liste)');
  check(await p.locator('.aide-tuto-link').first().isVisible(), '390 px aide : liste lisible');
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', hash: '#' + SLUG, width: 390 });
  check(await hscroll(p) <= 0, '390 px tuto : pas de défilement horizontal');
  await p.screenshot({ path: require('path').join(require('./lib/harness.cjs').SHOTS, 'aide-tuto-390.png') }).catch(() => {});
  await p.ctx.close();
  p = await openPage(browser, { page: 'aide', hash: '#' + SLUG, width: 1280 });
  await p.screenshot({ path: require('path').join(require('./lib/harness.cjs').SHOTS, 'aide-tuto-1280.png') }).catch(() => {});
  await p.ctx.close();

  await browser.close();
  finish();
})();
