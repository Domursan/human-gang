// Jouabilité des 5 jeux de plateau, uniquement par l'interface (clics), sur la base locale « plat » :
//   solo (un administrateur + robots), duel (2 joueurs) et groupe (4 à 5 joueurs) selon les minimums de chaque jeu.
// Usage : node s7_jouabilite.js <cluedo|shadow|destins|monopoly|risk> [pas=50]
// Chaque scénario : création par le formulaire, robots par le bouton, les autres rejoignent par le code et se déclarent prêts,
// l'hôte lance ; puis à chaque pas, le joueur attendu clique l'action disponible (les robots jouent via le chrono).
// Une action qui ne fait pas avancer la partie est signalée « bloqué » avec une capture. Fin de partie vérifiée à l'écran.
const { ouvrir, shot, fermer, su } = require('./lib.js');
const { log } = require('../../loup-garou/ui/fake.js');

const JEU = process.argv[2];
const PAS = Number(process.argv[3] || 50);
const PAGE = { cluedo: '/pages/jeux/cluedo.html', shadow: '/pages/jeux/shadow-hunters.html', destins: '/pages/jeux/destins.html', monopoly: '/pages/jeux/monopoly.html', risk: '/pages/jeux/risk.html' }[JEU];
const MIN = { cluedo: 3, shadow: 4, destins: 2, monopoly: 2, risk: 2 }[JEU];
const FILTRE = process.argv[4] || 'tous';   // 'solo', 'multi' ou 'tous'
const SCENARIOS_TOUS = [
  { nom: 'solo', humains: 1, robots: Math.max(MIN, 3) - 1 },
  ...(MIN <= 2 ? [{ nom: 'duel', humains: 2, robots: 0 }] : []),
  { nom: 'groupe', humains: JEU === 'shadow' ? 5 : 4, robots: 0 },
];
const SCENARIOS = SCENARIOS_TOUS.filter((x) => FILTRE === 'tous' || (FILTRE === 'solo' ? x.nom === 'solo' : x.nom !== 'solo'));
const ACTIONS = {
  cluedo: ['[data-montrer]', '[data-deplacer]', 'form[data-form-hyp] button[type=submit]', '[data-finir]', '[data-rester]'],
  shadow: ['[data-act="repondre"][data-mentir="false"]', '[data-act="repondre"]', '[data-act="donner"]', '[data-act="carte"]', '[data-act="aller"]',
    '[data-act="zone"]', '[data-act="lancer"]', '[data-act="attaquer"]', '[data-act="tirer"]', '[data-act="finir"]', '[data-act="passer"]'],
  destins: ['[data-voie]', '[data-voie2]', '[data-metier]', '[data-cible]', '[data-retraite]', 'form[data-form-assur] button[type=submit]', '[data-passer]', '[data-tourner]'],
  monopoly: ['[data-act="regler"]', '[data-act="acheter"]', '[data-act="payer_prison"]', '[data-act="lancer"]', '[data-act="finir"]', '[data-act="refuser"]', '[data-act="faillite"]'],
  risk: ['[data-valider]', '[data-avancer]', '[data-arreter]', '[data-manoeuvrer]', '[data-finir]'],
}[JEU];

const bilan = [];
const note = (s) => { console.log(s); bilan.push(s); };
const etat = (code) => JSON.parse(su(`select jsonb_build_object('statut', statut, 'version', version, 'tour', coalesce(tour::text, etat->>'actif'),
  'phase', etat->>'phase', 'nb_tours', nb_tours) from hg_plat_parties where code = '${code}'`));
const numDe = (uid) => (/^00000000-0000-0000-0000-0000000000(\d\d)$/.exec(uid || '') || [])[1];

async function rafraichir(pages) {
  for (const p of Object.values(pages)) {
    try { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); } catch { /* page fermée */ }
  }
  await pages[Object.keys(pages)[0]].waitForTimeout(900);
}
async function erreursVisibles(p) {
  return p.$$eval('.toast.error', (xs) => xs.map((x) => x.textContent)).catch(() => []);
}

/** Clique la première action visible et active ; renvoie le sélecteur qui a fait avancer la partie, ou null. */
async function jouerUnCoup(p, code, pages) {
  await rafraichir(pages);   // en vrai, le temps réel met l'écran à jour après le coup d'un robot
  const avant = etat(code).version;
  // Risk : renforts et mise en place : ajoute toutes les troupes sur un territoire, puis valide.
  if (JEU === 'risk') {
    // Renforts : clic sur un de mes territoires (+1 par clic) jusqu'à épuisement, puis « Valider mes troupes ».
    const e0 = etat(code);
    if (['renforts', 'placement'].includes(e0.phase)) {
      const moiN = Number(Object.entries(pages).find(([, pg]) => pg === p)?.[0]);
      const t = su(`select x from unnest(hg_plat__rk_mes(t_pid('${code}'), t_uid(${moiN}))) x order by x limit 1`);
      const reste = Number(su(`select case when etat->>'phase' = 'placement' then (select (j.etat->>'a_placer')::int from hg_plat_joueurs j where j.partie = p.id and j.user_id = t_uid(${moiN})) else (etat->>'renforts')::int end from hg_plat_parties p where code = '${code}'`));
      // Échange de cartes obligatoire (5 cartes) : sélectionner une combinaison et l'échanger.
      const combi = su(`select array_to_string(hg_plat__rk_trouver(hg_plat__rk_cartes(t_pid('${code}'), t_uid(${moiN}))), ',')`);
      if (combi && Number(su(`select cardinality(hg_plat__rk_cartes(t_pid('${code}'), t_uid(${moiN})))`)) >= 5) {
        for (const c of combi.split(',')) await p.locator(`[data-carte-id="${c}"]`).first().click().catch(() => {});
        await p.locator('[data-echanger]').first().click().catch(() => {});
        await rafraichir(pages);
      }
      const reste2 = Number(su(`select case when etat->>'phase' = 'placement' then (select (j.etat->>'a_placer')::int from hg_plat_joueurs j where j.partie = p.id and j.user_id = t_uid(${moiN})) else (etat->>'renforts')::int end from hg_plat_parties p where code = '${code}'`)) || reste;
      for (let i = 0; i < reste2 && t; i++) { await p.locator(`[data-terr="${t}"]`).click().catch(() => {}); }
    }
    // Attaque : une fois par tour, depuis mon plus gros territoire vers un voisin ennemi (sélection par clics sur la carte).
    const e = etat(code);
    if (e.phase === 'attaque' && !p.__attaque) {
      p.__attaque = true;
      const n = numDe(e.tour);
      const paire = su(`select x || ',' || y from unnest(hg_plat__rk_mes(t_pid('${code}'), t_uid(${n}))) x, unnest(hg_plat__rk_voisins(x)) y
        where hg_plat__rk_armees(t_pid('${code}'), x) >= 2 and hg_plat__rk_proprio(t_pid('${code}'), y) <> t_uid(${n})
        order by hg_plat__rk_armees(t_pid('${code}'), x) desc limit 1`);
      if (paire) {
        const [de, vers] = paire.split(',');
        await p.locator(`[data-terr="${de}"]`).click(); await p.waitForTimeout(250);
        await p.locator(`[data-terr="${vers}"]`).click(); await p.waitForTimeout(250);
        const att = p.locator('[data-attaquer]:not([disabled])').first();
        if (await att.isVisible().catch(() => false)) { await att.click(); await rafraichir(pages); if (etat(code).version !== avant) return 'attaque (carte)'; }
      }
    }
    if (e.phase !== 'attaque') p.__attaque = false;
  }
  // Cluedo : avant de montrer, choisir une carte.
  if (JEU === 'cluedo') {
    const carte = p.locator('[data-montre]').first();
    if (await carte.isVisible().catch(() => false)) await carte.click();
  }
  // Shadow Hunters : choisir un lieu avant « aller ».
  if (JEU === 'shadow') {
    const lieu = p.locator('[data-panneau] [data-lieu]:not([data-act])').first();
    if (await lieu.isVisible().catch(() => false)) await lieu.click().catch(() => {});
  }
  for (const sel of ACTIONS) {
    const b = p.locator(sel).filter({ visible: true }).first();
    if (!(await b.count()) || !(await b.isEnabled().catch(() => false))) continue;
    await b.click().catch(() => {});
    await rafraichir(pages);
    if (etat(code).version !== avant) return sel;
  }
  return null;
}

async function scenario(sc) {
  const pages = {};
  // 1. Création par le formulaire (joueur 1, administrateur).
  const h = await ouvrir(1, PAGE, '#creer');
  pages[1] = h;
  const places = sc.humains + sc.robots;
  await h.locator('input[name="nb_places"]').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, places);
  await h.locator('[data-envoyer]').click();
  await h.waitForTimeout(2000);
  const code = (/#partie\/([A-Z0-9-]+)/.exec(h.url()) || [])[1];
  if (!code) { note(`${sc.nom} : ÉCHEC création (adresse ${h.url()})`); return; }
  // 2. Robots par le bouton.
  for (let i = 0; i < sc.robots; i++) { await h.getByRole('button', { name: 'Ajouter un robot' }).click(); await h.waitForTimeout(700); }
  // 3. Les autres rejoignent par le code et se déclarent prêts.
  for (let n = 2; n <= sc.humains; n++) {
    const p = await ouvrir(n, PAGE, `#rejoindre/${code}`);
    pages[n] = p;
    await p.locator('[data-envoyer]').waitFor({ timeout: 20000 });
    await p.locator('[data-envoyer]').click();
    await p.locator('[data-pret]').waitFor({ timeout: 20000 });
    await p.locator('[data-pret]').click(); await p.waitForTimeout(800);
  }
  await rafraichir(pages);
  // 4. L'hôte lance.
  const lancer = h.getByRole('button', { name: 'Lancer la partie' });
  await lancer.waitFor({ timeout: 20000 });
  for (let k = 0; k < 20 && !(await lancer.isEnabled()); k++) { await rafraichir(pages); }
  await lancer.click();
  await h.waitForTimeout(1500); await rafraichir(pages);
  let e = etat(code);
  if (e.statut !== 'en_cours') { note(`${sc.nom} : ÉCHEC lancement (${e.statut})`); await shot(h, `jou_${JEU}_${sc.nom}_lancement`); return; }
  note(`${sc.nom} : ${sc.humains} humain(s) + ${sc.robots} robot(s), partie ${code} lancée par l'interface`);
  // 5. Partie : chaque pas, le joueur attendu agit (humain : clic ; robot ou mise en place du Risk : chrono).
  let coups = 0; let robots = 0; let bloques = 0; const parAction = {};
  for (let i = 0; i < PAS * 3 && coups < PAS; i++) {
    e = etat(code);
    if (e.statut !== 'en_cours') break;
    const n = numDe(e.tour);
    // Mise en place du Risk : tous les humains placent, puis le chrono place pour les robots.
    if (JEU === 'risk' && e.phase === 'placement') {
      for (const p of Object.values(pages)) { if (await p.locator('[data-valider]').count()) await jouerUnCoup(p, code, pages); }
      if (etat(code).phase === 'placement') su(`select t_expirer('${code}')`);
      continue;
    }
    if (!n || !pages[Number(n)]) { su(`select t_expirer('${code}')`); robots++; continue; }
    const p = pages[Number(n)];
    let sel = await jouerUnCoup(p, code, pages);
    if (!sel) { await p.reload(); await p.waitForTimeout(2500); sel = await jouerUnCoup(p, code, pages); if (sel) note(`${sc.nom} : écran en retard, débloqué par un rechargement (phase ${e.phase})`); }
    if (sel) { coups++; parAction[sel] = (parAction[sel] || 0) + 1; continue; }
    bloques++;
    const err = await erreursVisibles(p);
    note(`${sc.nom} : bloqué (joueur ${n}, phase ${e.phase})${err.length ? ' : ' + err.join(' / ') : ''}`);
    await shot(p, `jou_${JEU}_${sc.nom}_bloque_${bloques}`);
    if (bloques >= 3) break;
    su(`select t_expirer('${code}')`);   // on débloque par le chrono pour continuer à tester
  }
  note(`${sc.nom} : ${coups} coups joués par clic, ${robots} tours de robots/chrono, ${bloques} blocage(s) ; actions : ${Object.entries(parAction).map(([k, v]) => `${k.replace(/\[data-|\]|"/g, '')}×${v}`).join(', ')}`);
  // 6. Fin : Cluedo par une accusation juste à l'écran ; sinon fin forcée, puis écran de fin vérifié.
  e = etat(code);
  if (JEU === 'cluedo' && e.statut === 'en_cours') {
    for (let k = 0; k < 40; k++) {
      e = etat(code);
      const n = numDe(e.tour);
      if (n && pages[Number(n)] && ['deplacer', 'hypothese', 'apres'].includes(e.phase) && e.tour === su(`select etat->>'actif' from hg_plat_parties where code='${code}'`)) break;
      if (n && pages[Number(n)]) await jouerUnCoup(pages[Number(n)], code, pages); else su(`select t_expirer('${code}')`);
    }
    e = etat(code);
    const n = numDe(e.tour);
    const p = pages[Number(n)];
    if (p) {
      const env = JSON.parse(su(`select secret->'enveloppe' from hg_plat_parties where code='${code}'`));
      await p.locator('[data-accuser]').first().click(); await p.waitForTimeout(400);
      const f = p.locator('form[data-form-acc]');
      await f.locator('select[name="suspect"]').selectOption(env.suspect);
      await f.locator('select[name="arme"]').selectOption(env.arme);
      await f.locator('select[name="piece"]').selectOption(env.piece);
      await f.locator('button[type=submit]').click();
      await rafraichir(pages);
      note(`${sc.nom} : accusation juste à l'écran → ${etat(code).statut}`);
    }
  }
  if (etat(code).statut === 'en_cours') {
    su(`update hg_plat_parties set started_at = now() - interval '2 hours' where code = '${code}'; select hg_plat__terminer(t_pid('${code}'), array[t_uid(1)], 'test')`);
  }
  await rafraichir(pages); await h.waitForTimeout(1500);
  const fin = await h.locator('h1').first().textContent().catch(() => '');
  note(`${sc.nom} : écran de fin « ${(fin || '').trim()} »`);
  if (sc.nom === 'groupe') await shot(h, `jou_${JEU}_${sc.nom}_fin`);
}

(async () => {
  for (const sc of SCENARIOS) {
    try { await scenario(sc); } catch (err) { note(`${sc.nom} : ERREUR ${err.message.split('\n')[0]}`); }
  }
  const rpc = log.filter((x) => !x.startsWith('rpc inconnue'));
  note(`erreurs serveur vues par l'écran : ${rpc.length}${rpc.length ? '\n  ' + [...new Set(rpc)].slice(0, 12).join('\n  ') : ''}`);
  await fermer();
  require('fs').mkdirSync(`${__dirname}/shots`, { recursive: true });
  require('fs').writeFileSync(`${__dirname}/shots/jouabilite_${JEU}_${FILTRE}.txt`, bilan.join('\n'));
})();
