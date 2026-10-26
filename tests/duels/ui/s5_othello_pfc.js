// Parcours navigateur des nouveaux duels en développement (admins seulement) : Othello contre le robot (formulaire, un coup,
// compte des pions) ; Pierre-feuille-ciseaux contre le robot (choix caché, révélation, historique, score) ; visibilité des
// jeux pour un membre ordinaire ; 360 px sans défilement horizontal. Captures dans tests/duels/ui/shots.
// Prérequis : base « duels » reconstruite (tests/duels/rebuild.sh, migrations 141 et 142 comprises) et serveur sur le port 8080.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
const code = (p) => decodeURIComponent((p.url().split('#partie/')[1] || '').split('?')[0]);
const hscroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
let reussi = 0, echec = 0;
const verifier = (condition, message) => {
  if (condition) { reussi++; console.log('OK    ', message); } else { echec++; console.log('ECHEC ', message); }
};
const attendre = (p, ms) => p.waitForTimeout(ms);

/** Formulaire « Nouveau duel » : choisit le jeu (déjà présélectionné par l'adresse) et le robot, puis envoie. */
async function creerContreRobot(p, jeu, format = null) {
  await p.goto(`http://localhost:8080/duels.html#creer/${jeu}`);
  await attendre(p, 1500);
  await p.locator(`input[name="jeu"][value="${jeu}"]`).check({ force: true });
  await p.locator('input[name="adv"][value="robot"]').check({ force: true });
  if (format) await p.locator(`input[name="format"][value="${format}"]`).check({ force: true });
  await attendre(p, 300);
  await p.click('[data-envoyer]');
  await p.waitForURL(/#partie\//, { timeout: 10000 }).catch(() => {});
  await attendre(p, 2000);
  return code(p);
}

(async () => {
  // L'utilisateur 2 devient admin (les jeux en développement ne sont ouverts qu'aux admins).
  su(`update hg_profiles set is_admin = true where id = '${uid(2)}'`);
  su(`update hg_profiles set is_admin = false where id = '${uid(3)}'`);
  // Duels encore ouverts des passages précédents (limite de 10 duels ouverts par membre) : on les annule.
  su("update hg_duel_parties set statut = 'annulee' where statut in ('attente', 'en_cours')");

  // ---- Othello contre le robot ----
  const a = await ouvrir(2, '#creer/othello');
  verifier(await a.locator('input[name="jeu"][value="othello"]').isChecked(), 'formulaire : Othello présélectionné par #creer/othello');
  verifier((await a.locator('.duels-dev').count()) >= 4, 'formulaire : les jeux en développement portent la pastille « En développement »');
  verifier((await a.locator('.duels-groupe[data-commence]').isHidden()) === false, 'formulaire : « Qui commence » affiché pour Othello');
  await shot(a, '14-creer-othello');
  const cO = await creerContreRobot(a, 'othello');
  verifier(/^HGOT-\d{4}$/.test(cO), `Othello : duel créé contre le robot (${cO || 'pas de code'})`);
  await shot(a, '15-othello-debut', false);
  const cases = a.locator('.duels-oth-case.is-possible');
  const nPoss = await cases.count();
  verifier(nPoss >= 2, `Othello : ${nPoss} coups possibles marqués au début`);
  verifier((await a.locator('.duels-oth-chip-n').allTextContents()).join(',') === '2,2', 'Othello : compte de départ 2 et 2');
  if (nPoss > 0) {
    await cases.first().click();
    await attendre(a, 2500);
  }
  const nbCoups = Number(su(`select nb_coups from hg_duel_parties where code = '${cO}'`));
  verifier(nbCoups >= 2, `Othello : le coup est joué et le robot répond (${nbCoups} coups en base)`);
  const total = (await a.locator('.duels-oth-chip-n').allTextContents()).map(Number).reduce((s, n) => s + n, 0);
  verifier(total === 4 + nbCoups, `Othello : le compte de pions suit les coups (${total} pions pour ${nbCoups} coups)`);
  verifier((await a.locator('.duels-oth-case.is-dernier').count()) === 1, 'Othello : le dernier coup est surligné');
  verifier((await a.locator('.duels-oth-case[tabindex="0"]').count()) === 1, 'Othello : une seule case est dans l’ordre de tabulation (clavier)');
  await a.locator('.duels-oth-case[tabindex="0"]').focus();
  const avant = Number(await a.evaluate(() => document.activeElement?.dataset?.i));
  await a.keyboard.press('ArrowRight');
  const apres = Number(await a.evaluate(() => document.activeElement?.dataset?.i));
  verifier(avant % 8 === 7 || apres === avant + 1, `Othello : la flèche droite déplace le focus (case ${avant} → ${apres})`);
  await shot(a, '16-othello-coup', false);
  await a.setViewportSize({ width: 360, height: 780 });
  await a.goto(`http://localhost:8080/duels.html#partie/${cO}`);
  await attendre(a, 2000);
  verifier((await hscroll(a)) === 0, 'Othello : 360 px, aucun défilement horizontal');
  await a.setViewportSize({ width: 390, height: 844 });
  await shot(a, '17-othello-390');

  // ---- Othello au téléphone : toucher une case la sélectionne, puis « Jouer en … » ----
  const t = await ouvrir(2, '#creer/othello', 390);
  const cT = await creerContreRobot(t, 'othello');
  await t.addInitScript(() => {
    // Simule un écran tactile : pas de survol précis, donc pas de clic direct.
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/hover: hover/.test(q) ? { matches: false, media: q, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } : orig(q));
  });
  await t.reload();
  await attendre(t, 2000);
  await t.locator('.duels-oth-case.is-possible').first().click();
  await attendre(t, 300);
  verifier((await t.locator('.duels-oth-valider').count()) === 1, 'Othello, téléphone : toucher une case la sélectionne');
  verifier(/^Jouer en [a-h][1-8]$/.test(((await t.locator('.duels-oth-valider').textContent()) || '').trim()), 'Othello, téléphone : le bouton « Jouer en … » nomme la case');
  await t.locator('.duels-oth-valider').click();
  await attendre(t, 2500);
  verifier(Number(su(`select nb_coups from hg_duel_parties where code = '${cT}'`)) >= 2, 'Othello, téléphone : le coup est joué après « Jouer en … »');
  await shot(t, '24-othello-telephone', false);

  // ---- Pierre-feuille-ciseaux contre le robot ----
  await a.setViewportSize({ width: 1280, height: 900 });
  await a.goto('http://localhost:8080/duels.html#creer/pfc');
  await attendre(a, 1200);
  verifier(await a.locator('.duels-groupe[data-commence]').isHidden(), 'PFC : « Qui commence » masqué (pas de premier joueur au pierre-feuille-ciseaux)');
  const cP = await creerContreRobot(a, 'pfc');
  verifier(/^HGPF-\d{4}$/.test(cP), `PFC : duel créé contre le robot (${cP || 'pas de code'})`);
  verifier((await a.locator('.duels-pfc-gestes').count()) === 1, 'PFC : trois gestes proposés');
  verifier((await a.locator('.duels-pfc-geste').count()) === 3, 'PFC : Pierre, Feuille et Ciseaux');
  await shot(a, '18-pfc-debut', false);
  await a.locator('.duels-pfc-geste[data-geste="feuille"]').click();
  await attendre(a, 2500);
  const lancers = Number(su(`select jsonb_array_length(coalesce(etat->'pfc'->'lancers', '[]'::jsonb)) from hg_duel_parties where code = '${cP}'`));
  verifier(lancers >= 1, `PFC : le lancer est résolu avec le robot (${lancers} lancer(s))`);
  verifier((await a.locator('.duels-pfc-cartes').count()) === 1, 'PFC : la zone du dernier lancer montre les deux gestes');
  verifier(((await a.locator('.duels-pfc-resultat').textContent()) || '').trim() !== '', 'PFC : le résultat du lancer est écrit');
  verifier((await a.locator('.duels-pfc-historique li').count()) >= 1, 'PFC : l’historique garde le lancer');
  const manche = ((await a.locator('.duels-pfc-manche').textContent()) || '').trim();
  verifier(/^Manche [123] sur 3$/.test(manche), `PFC : « ${manche} » (au meilleur des 3)`);
  verifier((await a.locator('.duels-pfc-score strong').count()) === 2, 'PFC : le score des manches (2 – 1 façon maquette) est affiché');
  verifier((await a.locator('.duels-pfc-geste:not(:disabled)').count()) === 3, 'PFC : après le lancer, les trois gestes sont à nouveau disponibles');
  await shot(a, '19-pfc-lancer', false);
  await a.setViewportSize({ width: 360, height: 780 });
  await a.goto(`http://localhost:8080/duels.html#partie/${cP}`);
  await attendre(a, 2000);
  verifier((await hscroll(a)) === 0, 'PFC : 360 px, aucun défilement horizontal');
  await a.setViewportSize({ width: 390, height: 844 });
  await shot(a, '20-pfc-390');

  // ---- Partie jusqu'au bout (une manche) puis écran de fin ----
  const cO1 = await creerContreRobot(a, 'othello', 1);
  await a.locator('.duels-oth-case.is-possible').first().click();
  await attendre(a, 2000);
  su(`select hg_duel__fin_manche(id, '${uid(2)}') from hg_duel_parties where code = '${cO1}' and statut = 'en_cours'`);
  verifier(su(`select statut from hg_duel_parties where code = '${cO1}'`) === 'terminee', 'Othello : la manche unique est jouée jusqu’au bout');
  await a.goto(`http://localhost:8080/duels.html#partie/${cO1}`);
  await attendre(a, 2500);
  verifier((await a.locator('.duels-fin-mini--cases').count()) === 1, 'Othello : écran de fin avec la dernière grille');
  verifier((await a.locator('.duels-fin-pion').count()) >= 5, 'Othello : les pions de la dernière grille sont dessinés');
  await shot(a, '22-othello-fin');

  const cP1 = await creerContreRobot(a, 'pfc', 1);
  for (let tour = 0; tour < 6; tour++) {
    if (su(`select statut from hg_duel_parties where code = '${cP1}'`) !== 'en_cours') break;
    await a.locator('.duels-pfc-geste[data-geste="pierre"]:not([disabled])').click().catch(() => {});
    await attendre(a, 1500);
  }
  verifier(su(`select statut from hg_duel_parties where code = '${cP1}'`) === 'terminee', 'PFC : la manche unique est jouée jusqu’au bout');
  await a.goto(`http://localhost:8080/duels.html#partie/${cP1}`);
  await attendre(a, 2500);
  verifier((await a.locator('.duels-fin-lancers li').count()) >= 1, 'PFC : écran de fin avec la liste des lancers');
  await shot(a, '23-pfc-fin');

  // ---- Visibilité : un membre ordinaire ne voit pas les jeux en développement ----
  const b = await ouvrir(3, '#creer', 1280);
  verifier((await b.locator('input[name="jeu"][value="othello"]').count()) === 0, 'membre : Othello n’est pas proposé');
  verifier((await b.locator('input[name="jeu"][value="pfc"]').count()) === 0, 'membre : Pierre-feuille-ciseaux n’est pas proposé');
  verifier((await b.locator('input[name="jeu"][value="quiestce"]').count()) === 1, 'membre : Qui est-ce ? reste proposé');
  await shot(b, '21-creer-membre', false);
  await fermer();

  console.log(`\n${reussi} OK, ${echec} ECHEC(S)`);
  process.exit(echec ? 1 : 0);
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
