// Parcours navigateur des duels : accueil, création contre le robot (P4, Morpion Ultime, Mastermind), coups joués à la souris,
// défi entre deux membres, fin de duel, statistiques, code du jour, téléphone. Captures dans tests/duels/ui/shots.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
const code = (p) => decodeURIComponent((p.url().split('#partie/')[1] || '').split('?')[0]);
(async () => {
  const a = await ouvrir(2, '');
  await shot(a, '01-accueil');
  // P4 contre le robot
  await a.goto('http://localhost:8080/duels.html#creer/p4'); await a.waitForTimeout(1500);
  await shot(a, '02-creer');
  const robot = await a.$('input[value="robot"]'); if (robot) await robot.check({ force: true }); else console.log('pas de choix robot');
  await a.waitForTimeout(300);
  const go = await a.$('button:has-text("robot"), button:has-text("Créer le duel")');
  if (!go) { console.log('pas de bouton de création'); } else { await go.click(); await a.waitForTimeout(2500); }
  const c1 = code(a); console.log('P4', c1);
  await shot(a, '03-p4', false);
  for (let i = 0; i < 3; i++) {
    const col = await a.$('.duels-p4 button[data-col]:not([disabled]), .duels-p4 button[aria-label^="Colonne"]:not([disabled])');
    if (!col) { console.log('pas de colonne jouable'); break; }
    await col.click(); await a.waitForTimeout(400);
    const valider = await a.$('button:has-text("Valider la colonne")'); if (valider && await valider.isVisible()) await valider.click();
    await a.waitForTimeout(1800);
  }
  console.log('coups P4', su(`select nb_coups from hg_duel_parties where code = '${c1}' order by created_at desc limit 1`));
  await shot(a, '04-p4-coups', false);
  // Morpion Ultime contre le robot (création directe), table
  const c2 = JSON.parse(q(2, `select to_jsonb(hg_duel_creer('{"jeu":"morpion","variante":"ultime","adversaire":"robot","robot":2,"commence":"moi"}'::jsonb))`));
  await a.goto(`http://localhost:8080/duels.html#partie/${c2}`); await a.waitForTimeout(2500);
  const cell = await a.$('button.morpion-case:not([disabled])'); if (cell) { await cell.click(); await a.waitForTimeout(2000); } else console.log('pas de case morpion');
  await shot(a, '05-ultime', false);
  // Mastermind contre le robot
  const c3 = JSON.parse(q(2, `select to_jsonb(hg_duel_creer('{"jeu":"mastermind","adversaire":"robot","robot":2}'::jsonb))`));
  await a.goto(`http://localhost:8080/duels.html#partie/${c3}`); await a.waitForTimeout(2500);
  // phase « codes » : je choisis le code du robot, puis j'essaie
  for (let tour = 0; tour < 2; tour++) {
    for (let i = 0; i < 4; i++) { const l = a.locator('button.mm-pal').nth(i); if (await l.count()) { await l.click(); await a.waitForTimeout(200); } }
    await shot(a, tour ? '06b-mastermind-essai' : '06a-mastermind-code', false);
    const v = a.locator('button[data-act="valider"]'); if (await v.count()) { await v.click(); await a.waitForTimeout(2500); } else console.log('pas de bouton valider', tour);
  }
  console.log('essais MM', su(`select essais from hg_duel_joueurs j join hg_duel_parties p on p.id = j.partie where p.code = '${c3}' and not j.robot order by p.created_at desc limit 1`));
  await shot(a, '06-mastermind', false);
  // Défi entre membres 2 → 3 (P4 classique), accepté au téléphone
  const c4 = JSON.parse(q(2, `select to_jsonb(hg_duel_creer('{"jeu":"p4","adversaire":"membre","membre":"${uid(3)}","commence":"moi","format":3}'::jsonb))`));
  const b = await ouvrir(3, '', 390);
  await shot(b, '07-accueil-tel');
  await b.goto(`http://localhost:8080/duels.html#rejoindre/${c4}`); await b.waitForTimeout(2000);
  await shot(b, '08-defi-tel');
  const acc = await b.$('button:has-text("Accepter")'); if (acc) { await acc.click(); await b.waitForTimeout(2500); } else console.log('pas de bouton Accepter');
  await a.goto(`http://localhost:8080/duels.html#partie/${c4}`); await a.waitForTimeout(2500);
  await shot(b, '09-p4-tel', false);
  // Fin : forfait simulé, puis écran de fin
  su(`update hg_duel_parties set etat = etat || '{"abandon":"${uid(3)}"}' where code = '${c4}' and statut = 'en_cours'`);
  su(`select hg_duel__terminer(id, '${uid(2)}') from hg_duel_parties where code = '${c4}' and statut = 'en_cours'`);
  await a.waitForTimeout(4000);
  await shot(a, '10-fin');
  await b.waitForTimeout(1500);
  await shot(b, '11-fin-tel');
  await a.goto('http://localhost:8080/duels.html#stats'); await a.waitForTimeout(2000);
  await shot(a, '12-stats');
  await a.goto('http://localhost:8080/duels.html#jour'); await a.waitForTimeout(2000);
  await shot(a, '13-jour');
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
