// Parcours : suivi des quêtes de la semaine côté client (assets/js/quest-track.js).
// Appels à la RPC hg_quest_track : tuto lu (aide.html#<slug>), fiche d'un autre membre (membre.html?id=…),
// carte d'identité téléchargée, thème d'affichage changé par le membre, app installée (événement appinstalled).
// Contrôles : un membre connecté déclenche chaque action ; une même action n'est envoyée qu'une fois par session ;
// jamais sa propre fiche ; un visiteur n'envoie rien ; aucun envoi au chargement d'une page sans action.
// Faux Supabase : fixtures/fake-sb.mjs (hg_quest_track répond sans erreur ; le journal window.__LOG garde l'appel).
// Lancer : node tests/parcours-quetes-suivi.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { ORIGIN, PREFIX, check, finish, openPage, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const SLUG = 'ouvrir-un-booster';   // tuto membre (cartes-base)
const GUEST_SLUG = 'se-connecter';  // tuto « Premiers pas », visible sans compte

/** Liste des appels hg_quest_track faits par la page, au format { p_kind, p_ref }. */
async function suivis(p) {
  return (await log(p))
    .filter((e) => e[0] === 'rpc' && e[1] === 'hg_quest_track')
    .map((e) => e[2]);
}
/** Nombre d'appels hg_quest_track correspondant à kind (et ref, si donné). */
async function nb(p, kind, ref) {
  return (await suivis(p)).filter((a) => a.p_kind === kind && (ref === undefined || a.p_ref === ref)).length;
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- Tuto lu : membre connecté ---------- */
  let p = await openPage(browser, { page: 'aide', width: 1280 });
  check(await nb(p, 'tuto_lu') === 0, 'aide sans tuto ouvert : aucun envoi « tuto_lu »');
  await p.evaluate((s) => { location.hash = '#' + s; }, SLUG);
  await sleep(500);
  check(await nb(p, 'tuto_lu', SLUG) === 1, `membre : ouvrir « ${SLUG} » envoie tuto_lu (${await nb(p, 'tuto_lu', SLUG)})`);
  check((await suivis(p)).some((a) => a.p_kind === 'tuto_lu' && a.p_ref === SLUG), 'membre : p_ref du tuto_lu est le slug du tuto');
  // Même tuto rouvert dans la même session : pas de second envoi
  await p.evaluate(() => { location.hash = '#proposer-un-echange'; });
  await sleep(300);
  await p.evaluate((s) => { location.hash = '#' + s; }, SLUG);
  await sleep(400);
  check(await nb(p, 'tuto_lu', SLUG) === 1, 'membre : tuto rouvert dans la session : toujours un seul envoi');
  check(await nb(p, 'tuto_lu', 'proposer-un-echange') === 1, 'membre : un autre tuto envoie son propre tuto_lu');
  check(p.errs.length === 0, `aide : aucune erreur JS pendant le suivi${p.errs.length ? ' ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Visiteur : aucun envoi ---------- */
  p = await openPage(browser, { page: 'aide', scenario: { guest: true }, hash: '#' + GUEST_SLUG, width: 1280 });
  check(await p.locator('.aide-steps').count() === 1, 'visiteur : tuto « Premiers pas » affiché');
  check((await suivis(p)).length === 0, 'visiteur : ouvrir un tuto n\'envoie aucun hg_quest_track');
  check((await log(p)).some((e) => e[0] === 'rpc-401' && e[1] === 'hg_quest_track') === false, 'visiteur : aucun appel refusé (401) à hg_quest_track');
  await p.ctx.close();

  /* ---------- Fiche d'un autre membre ---------- */
  p = await openPage(browser, { page: 'membre', width: 1280 });
  check((await suivis(p)).filter((a) => a.p_kind === 'fiche_vue').length === 0, 'sa propre carte : aucun « fiche_vue »');
  const other = await p.evaluate((me) => window.__DB.hg_profiles.find((x) => x.id !== me && !x.is_ghost).id, ME);
  await p.goto(`${ORIGIN}${PREFIX}/membre.html?id=${other}`);
  await sleep(1200);
  check(await nb(p, 'fiche_vue', other) === 1, 'fiche d\'un autre membre : envoie fiche_vue avec son id');
  check((await suivis(p)).every((a) => a.p_ref !== ME), 'fiche d\'un autre membre : jamais l\'id du membre connecté');
  check(p.errs.length === 0, `fiche : aucune erreur JS${p.errs.length ? ' ' + p.errs.join(' | ') : ''}`);
  await p.ctx.close();

  /* ---------- Carte d'identité téléchargée ---------- */
  p = await openPage(browser, { page: 'membre', width: 1280 });
  check(await p.locator('#dl-card').count() === 1, 'carte : bouton « Télécharger la carte » présent');
  await p.locator('#dl-card').click();
  await sleep(1500);
  check(await nb(p, 'carte_identite', 'carte') === 1, 'téléchargement de la carte : envoie carte_identite');
  await p.ctx.close();

  /* ---------- Thème d'affichage changé par le membre ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  check(await nb(p, 'theme_change') === 0, 'accueil au chargement : aucun « theme_change » (pas au chargement)');
  await p.locator('.prefs-open').first().click();
  await sleep(300);
  await p.locator('input[name="mode"][value="clair"]').check({ force: true });
  await sleep(400);
  check(await nb(p, 'theme_change', 'clair') === 1, 'choix du mode « clair » : envoie theme_change avec « clair »');
  await p.locator('input[name="mode"][value="clair"]').check({ force: true });
  await sleep(200);
  check(await nb(p, 'theme_change', 'clair') === 1, 'mode « clair » déjà choisi dans la session : pas de second envoi');
  await p.ctx.close();

  /* ---------- App installée : événement appinstalled ---------- */
  p = await openPage(browser, { page: 'accueil', width: 1280 });
  check(await nb(p, 'app_installee') === 0, 'onglet ordinaire : aucun « app_installee » au chargement');
  await p.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await sleep(500);
  check(await nb(p, 'app_installee', 'app') === 1, 'événement appinstalled : envoie app_installee');
  await p.ctx.close();

  await browser.close();
  finish();
})();
