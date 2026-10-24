// Parcours admin : mise en page « liste + détail » de Vie du gang › Sorties IRL (admin.html#camp/sorties).
// Colonne 2 : puces de filtre (À venir par défaut, Passées, Toutes), recherche, lignes compactes.
// Zone principale : détail de la sortie choisie ; l'URL suit la sélection (#camp/sorties/<id>), Précédent fonctionne.
// Panneau d'infos (≥ 1440 px) : organisateur, chiffres des réponses, photos liées.
// Mobile (390 px) : liste plein écran, puis détail avec bouton retour.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-p2-sorties.cjs
const { ROOT, check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
const ME = '11111111-1111-4111-8111-111111111111';
/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const EV_A = 'ea000000-0000-4000-8000-00000000000a'; // à venir, date fixée, 1 « je viens », 1 « peut-être »
const EV_B = 'eb000000-0000-4000-8000-00000000000b'; // à caler (sondage)
const EV_C = 'ec000000-0000-4000-8000-00000000000c'; // passée
/** Date ISO décalée de n jours (négatif : dans le passé). */
const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

const SCN = {
  sorties: [
    { id: EV_A, title: 'Raclette au chalet', description: null, location: 'Villars', starts_at: days(10), cover_path: null, created_by: ME, created_at: days(-5), retro: false },
    { id: EV_B, title: 'Karaoké surprise', description: null, location: null, starts_at: null, cover_path: null, created_by: U(2), created_at: days(-2), retro: false },
    { id: EV_C, title: 'Bowling de l\'hiver', description: null, location: 'Morges', starts_at: days(-20), cover_path: null, created_by: ME, created_at: days(-30), retro: false },
  ],
  rsvps: [
    { event_id: EV_A, user_id: U(2), status: 'oui', updated_at: days(-1) },
    { event_id: EV_A, user_id: U(3), status: 'peut-etre', updated_at: days(-1) },
  ],
  eventDates: [
    { id: 'd1000000-0000-4000-8000-000000000001', event_id: EV_B, proposed_at: days(5) },
    { id: 'd2000000-0000-4000-8000-000000000002', event_id: EV_B, proposed_at: days(6) },
  ],
  eventVotes: [],
};

/** Ligne de la colonne liste pour la sortie d'identifiant id. */
const row = (p, id) => p.locator(`#shell-col .ui-row[data-id="${id}"]`);
/** Adresse (hash) courante de la page. */
const hashOf = (p) => p.evaluate(() => location.hash);
/** Écran affiché : valeur de l'attribut data-screen (liste ou détail). */
const screen = (p) => p.getAttribute('#shell', 'data-screen');

/* ---------- Scénario ---------- */
(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // ----- Ordinateur 1440 px : liste, détail, panneau d'infos -----
  const p = await openPage(browser, { page: 'admin', scenario: SCN, width: 1440 });
  await p.evaluate(() => { location.hash = '#camp/sorties'; });
  await p.waitForSelector('#shell-col .ui-row', { timeout: 5000 }).catch(() => {});

  check((await p.locator('#shell-col .ui-row').count()) === 2, 'liste : « À venir » par défaut (2 sorties)');
  check((await p.getAttribute('#shell-col .ui-chip[data-filter="avenir"]', 'aria-pressed')) === 'true', 'puce « À venir » active au départ');
  check((await p.locator('#shell-col .ui-chip').allInnerTexts()).join('|').includes('Toutes'), 'puces : À venir, Passées, Toutes');
  check((await p.textContent('#ass-d-body')).includes('Choisis une sortie'), 'zone principale : invitation à choisir une sortie sans sélection');
  check(await p.isVisible('#shell-info') === false || (await p.textContent('#shell-info')).includes('Choisis une sortie'), 'panneau d\'infos : invitation sans sélection');

  await row(p, EV_A).click();
  await p.waitForSelector('#ass-d-head h2', { state: 'visible', timeout: 5000 });
  check((await hashOf(p)) === `#camp/sorties/${EV_A}`, 'sélection : l\'adresse suit la sortie (#camp/sorties/<id>)');
  check((await p.textContent('#ass-d-head h2')) === 'Raclette au chalet', 'détail : titre de la sortie dans l\'en-tête');
  check((await p.locator('#ass-d-head button').allInnerTexts()).join('|').match(/Modifier.*Supprimer/) !== null, 'détail : actions Modifier et Supprimer dans l\'en-tête');
  check((await row(p, EV_A).getAttribute('aria-selected')) === 'true', 'liste : la sortie choisie est sélectionnée');
  check(await p.isVisible('#shell-info'), 'panneau d\'infos affiché ≥ 1440 px');
  const info = await p.textContent('#shell-info');
  check(info.includes('Organisateur') && info.includes('Je viens') && info.includes('Peut-être') && info.includes('Pas dispo'), 'panneau d\'infos : organisateur et chiffres (oui, peut-être, non)');
  check(await p.isVisible('#shell-info .ui-facts'), 'panneau d\'infos : grille des chiffres');

  // Précédent : revient à la liste sans sélection
  await p.goBack();
  await p.waitForTimeout(400);
  check((await hashOf(p)) === '#camp/sorties', 'Précédent : retour à la liste sans sélection');
  check((await p.textContent('#ass-d-body')).includes('Choisis une sortie'), 'Précédent : zone principale vide');

  // Adresse directe : la sortie s'ouvre telle quelle
  await p.evaluate((h) => { location.hash = h; }, `#camp/sorties/${EV_B}`);
  await p.waitForSelector('#ass-d-head h2', { state: 'visible', timeout: 5000 }).catch(() => {});
  check((await p.textContent('#ass-d-head h2')) === 'Karaoké surprise', 'adresse directe #camp/sorties/<id> : la sortie s\'ouvre');
  check((await p.locator('#ass-d-body .ass-d-sec').count()) >= 2, 'détail : inscriptions et dates proposées');
  check((await p.locator('#ass-d-body button[data-act="fix"]').count()) === 2, 'sondage : deux dates à fixer');

  // Filtre « Passées » et recherche
  await p.click('#shell-col .ui-chip[data-filter="passees"]');
  check((await p.locator('#shell-col .ui-row').count()) === 1, 'filtre « Passées » : une sortie');
  await p.click('#shell-col .ui-chip[data-filter="all"]');
  check((await p.locator('#shell-col .ui-row').count()) === 3, 'filtre « Toutes » : trois sorties');
  await p.fill('#shell-col .ui-search input', 'morges');
  await p.waitForTimeout(300);
  check((await p.locator('#shell-col .ui-row').count()) === 1, 'recherche sur le lieu : une sortie');
  await p.fill('#shell-col .ui-search input', '');
  await p.waitForTimeout(300);

  // Création depuis la colonne 2 : la nouvelle sortie s'ouvre
  await p.click('#ass-new');
  await p.waitForSelector('#ass-e-form', { state: 'visible' });
  await p.fill('#ass-e-name', 'Pizzas du jeudi');
  await p.fill('#ass-e-loc', 'Nyon');
  const d = new Date(Date.now() + 40 * 864e5);
  /** Écrit un nombre sur deux chiffres (format de date). */
  const pad = (n) => String(n).padStart(2, '0');
  await p.fill('#ass-e-start', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:00`);
  await p.click('#ass-e-submit');
  await p.waitForSelector('#ass-d-head h2:has-text("Pizzas du jeudi")', { timeout: 5000 }).catch(() => {});
  check((await p.textContent('#ass-d-head h2')) === 'Pizzas du jeudi', 'création : la nouvelle sortie s\'ouvre dans la zone principale');
  check((await hashOf(p)).startsWith('#camp/sorties/') && !(await hashOf(p)).endsWith('/'), 'création : l\'adresse porte l\'identifiant de la sortie');

  check(!p.errs.length, 'ordinateur : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check((await hscroll(p)) <= 0, 'ordinateur : pas de défilement horizontal');
  await p.ctx.close();

  // ----- Mobile 390 px : liste plein écran, puis détail avec retour -----
  const m = await openPage(browser, { page: 'admin', scenario: SCN, width: 390 });
  await m.evaluate(() => { location.hash = '#camp/sorties'; });
  await m.waitForSelector('#shell-col .ui-row', { timeout: 5000 }).catch(() => {});
  check((await screen(m)) === 'list', 'mobile : la liste occupe l\'écran');
  check(!(await m.isVisible('#app')), 'mobile : la zone principale est masquée tant qu\'aucune sortie n\'est choisie');
  check((await m.locator('#shell-col .ui-row').count()) === 2, 'mobile : deux sorties dans la liste');
  await row(m, EV_A).click();
  await m.waitForSelector('#ass-d-head h2', { state: 'visible', timeout: 5000 }).catch(() => {});
  check((await screen(m)) === 'page' && await m.isVisible('#app'), 'mobile : le détail remplace la liste');
  check(await m.isVisible('#zone-back'), 'mobile : bouton retour visible');
  check((await m.getAttribute('#zone-back', 'href')) === '#camp/sorties', 'mobile : le retour mène à la liste de la sous-section');
  await m.click('#zone-back');
  await m.waitForTimeout(400);
  check((await screen(m)) === 'list', 'mobile : le retour ramène à la liste');
  check((await hscroll(m)) <= 0, 'mobile : pas de défilement horizontal');
  check(!m.errs.length, 'mobile : aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));
  await m.ctx.close();

  await browser.close();
  finish();
})();
