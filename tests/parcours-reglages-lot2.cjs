// Parcours : réglages « Comptes et invitations » (lot 2 des réglages admin).
// Admin (Membres · Invitations) : voir les règles en vigueur, refuser un préfixe invalide, enregistrer
// (hg_settings.invites), rétablir les valeurs par défaut (suppression de la clé).
// Effets côté site, avec des réglages semés par le scénario (scenario.settings du faux Supabase) :
//   - rejoindre.html : durée affichée (« Valable 72 h ») ; sans réglage, 48 h ;
//   - accueil visiteur : titre et bouton réglés (site_textes) ; sans réglage, textes d'origine ;
//   - compte (membre) : groupes de champs réglés (profile_fields) ; valeur invalide ⇒ liste d'origine.
// Le SQL (migration 051) n'est pas exécuté ici : les fonctions hg_claim_invite_link et hg_ghost_invite
// sont simulées par le faux client. Lancer : node tests/parcours-reglages-lot2.cjs
const { check, finish, openPage, adminSection, log, sleep, chromium, ORIGIN, PREFIX } = require('./lib/harness.cjs');

/** Écritures sur hg_settings (upsert ou delete) dans le journal du faux client. */
const settingsWrites = async (p) => (await log(p)).filter((e) => e[1] === 'hg_settings' && (e[0] === 'upsert' || e[0] === 'delete' || e[0] === 'insert'));

(async () => {
  console.log('Racine testée : ' + require('./lib/harness.cjs').ROOT);
  const browser = await chromium.launch();

  /* ---------- Admin : Membres · Invitations, règles des codes ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await adminSection(p, 'place/invitations');
  await p.waitForSelector('.il-rules', { timeout: 8000 });
  check((await p.textContent('.il-rules')).includes('Valeurs par défaut en vigueur'), 'admin : indique que les valeurs par défaut sont en vigueur');
  const resumes = await p.textContent('.il-rules-list');
  check(resumes.includes('48 h') && resumes.includes('30') && resumes.includes('60 jours') && resumes.includes('HG-'), 'admin : résumé des règles (48 h / 30 / 60 jours / HG-)');
  check(await p.isDisabled('[data-il-rules-reset]'), 'admin : « Rétablir » inactif tant que rien n\'est personnalisé');

  // Préfixe invalide : le tiroir refuse, aucune écriture
  await p.click('[data-il-rules-edit]');
  await p.waitForSelector('dialog.ui-drawer[open] #il-rule-prefixe', { timeout: 5000 });
  await p.fill('#il-rule-prefixe', 'bad');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await sleep(300);
  check((await settingsWrites(p)).length === 0, 'admin : préfixe invalide refusé, aucune écriture');
  check(await p.locator('dialog.ui-drawer[open]').count() === 1, 'admin : le tiroir reste ouvert après une erreur');

  // Maximum par heure à 0 : refusé
  await p.fill('#il-rule-prefixe', 'XY-');
  await p.fill('#il-rule-validite_heures', '72');
  await p.fill('#il-rule-max_codes_heure_lien', '0');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await sleep(300);
  check((await settingsWrites(p)).length === 0, 'admin : maximum par heure à 0 refusé, aucune écriture');

  // Valeurs valides : une seule écriture, clé « invites », tiroir fermé
  await p.fill('#il-rule-max_codes_heure_lien', '40');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await sleep(500);
  const ups = (await settingsWrites(p)).filter((e) => e[0] === 'upsert');
  check(ups.length === 1 && ups[0][2]?.key === 'invites', 'admin : enregistrement → une écriture de hg_settings.invites');
  const sent = ups[0]?.[2]?.value || {};
  check(sent.validite_heures === 72 && sent.max_codes_heure_lien === 40 && sent.fantome_jours === 60 && sent.prefixe === 'XY-',
    'admin : valeurs envoyées complètes (72 / 40 / 60 / XY-)');
  check((await p.textContent('.il-rules')).includes('Des valeurs personnalisées'), 'admin : indique des valeurs personnalisées');
  check((await p.textContent('.il-rules-list')).includes('72 h'), 'admin : le résumé affiche 72 h');
  check(await p.locator('dialog.ui-drawer[open]').count() === 0, 'admin : tiroir fermé après enregistrement');

  // Rétablir : confirmation, suppression de la clé
  await p.click('[data-il-rules-reset]');
  await p.waitForSelector('dialog.hg-dialog[open]', { timeout: 5000 });
  await p.click('dialog.hg-dialog[open] .dialog-actions button:not(.btn-ghost)');
  await sleep(400);
  const dels = (await settingsWrites(p)).filter((e) => e[0] === 'delete');
  check(dels.length === 1, 'admin : « Rétablir » supprime la clé hg_settings.invites (après confirmation)');
  check((await p.textContent('.il-rules')).includes('Valeurs par défaut en vigueur'), 'admin : après rétablissement, valeurs par défaut affichées');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Visiteur : page de rejoindre (durée de validité réglée) ---------- */
  const JOIN = `${ORIGIN}${PREFIX}/rejoindre.html?l=abcdef123456`;
  p = await openPage(browser, { page: 'rejoindre', scenario: { guest: true, settings: [{ key: 'invites', value: { validite_heures: 72 } }] } });
  await p.goto(JOIN);
  await p.waitForSelector('.rj-code-note', { timeout: 8000 });
  check((await p.textContent('.rj-code-note')).includes('Valable 72 h'), 'rejoindre : code affiché « Valable 72 h » avec le réglage');
  check(!p.errs.length, 'rejoindre : aucune erreur JS (réglage)');
  await p.ctx.close();

  p = await openPage(browser, { page: 'rejoindre', scenario: { guest: true } });
  await p.goto(JOIN);
  await p.waitForSelector('.rj-code-note', { timeout: 8000 });
  check((await p.textContent('.rj-code-note')).includes('Valable 48 h'), 'rejoindre : sans réglage, « Valable 48 h » (comportement d\'origine)');
  await p.ctx.close();

  /* ---------- Visiteur : accueil, textes réglés ---------- */
  p = await openPage(browser, { page: 'accueil', scenario: { guest: true, settings: [{ key: 'site_textes', value: { accueil_titre: 'Le QG de test', accueil_cta_connexion: 'Entrer au QG' } }] } });
  await p.waitForSelector('.home-hero-guest h1', { timeout: 8000 });
  check((await p.textContent('.home-hero-guest h1')).trim() === 'Le QG de test', 'accueil visiteur : titre réglé affiché');
  check((await p.textContent('.home-hero-guest')).includes('Entrer au QG'), 'accueil visiteur : bouton de connexion réglé');
  check(!p.errs.length, 'accueil visiteur : aucune erreur JS (textes)');
  await p.ctx.close();

  p = await openPage(browser, { page: 'accueil', scenario: { guest: true } });
  await p.waitForSelector('.home-hero-guest h1', { timeout: 8000 });
  check((await p.textContent('.home-hero-guest h1')).trim() === 'Le QG du Humane Gang', 'accueil visiteur : sans réglage, titre d\'origine');
  await p.ctx.close();

  /* ---------- Membre : champs de profil réglés ---------- */
  const REGLE = { groups: [
    { id: 'test_groupe', label: 'Groupe de test', fields: [{ id: 'couleur_test', label: 'Couleur du test', type: 'text' }] },
  ] };
  p = await openPage(browser, { page: 'compte', scenario: { settings: [{ key: 'profile_fields', value: REGLE }] } });
  await p.waitForSelector('#info-groups', { state: 'attached', timeout: 8000 });
  await sleep(300);
  const groupes = await p.textContent('#info-groups');
  check(groupes.includes('Groupe de test') && groupes.includes('Couleur du test'), 'compte : groupes et champs réglés affichés');
  check(!groupes.includes('Réseaux sociaux'), 'compte : les groupes d\'origine ne sont plus listés');
  check(!p.errs.length, 'compte : aucune erreur JS (champs réglés)');
  await p.ctx.close();

  p = await openPage(browser, { page: 'compte', scenario: { settings: [{ key: 'profile_fields', value: { groups: [{ id: 'Mauvais ID', label: 'x', fields: [] }] } }] } });
  await p.waitForSelector('#info-groups', { state: 'attached', timeout: 8000 });
  await sleep(300);
  check((await p.textContent('#info-groups')).includes('Réseaux sociaux'), 'compte : valeur invalide ⇒ liste d\'origine');
  await p.ctx.close();

  finish();
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
