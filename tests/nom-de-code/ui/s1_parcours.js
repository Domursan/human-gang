// Parcours navigateur de Nom de code : accueil, création, salle (ordinateur et téléphone), table vue espion et vue agent,
// indice donné au clavier, propositions à la souris jusqu'à la majorité, fin (assassin). Captures dans tests/nom-de-code/ui/shots.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
const num = (u) => parseInt(String(u).slice(-2), 10);
(async () => {
  require('fs').mkdirSync(`${__dirname}/shots`, { recursive: true });
  const a = await ouvrir(1, '');
  await shot(a, '01-accueil');
  await a.goto('http://localhost:8080/nom-de-code.html#creer'); await a.waitForTimeout(1500);
  await shot(a, '02-creer');
  const code = JSON.parse(q(1, `select to_jsonb(hg_ndc_creer('{"nom":"Espions du dimanche","nb_places":12}'::jsonb))`));
  for (let i = 2; i <= 6; i++) { q(i, `select hg_ndc_rejoindre('${code}')`); if (i < 6) q(i, `select hg_ndc_pret('${code}', true)`); }
  q(2, `select hg_ndc_equipe('${code}', 'jaune')`); q(2, `select hg_ndc_espion('${code}')`);
  q(3, `select hg_ndc_equipe('${code}', 'rose')`); q(4, `select hg_ndc_equipe('${code}', 'rose')`);
  await a.goto(`http://localhost:8080/nom-de-code.html#partie/${code}`); await a.waitForTimeout(2500);
  await shot(a, '03-salle-hote');
  const t = await ouvrir(5, `#partie/${code}`, 390); await t.waitForTimeout(1500);
  await shot(t, '04-salle-tel');
  q(6, `select hg_ndc_pret('${code}', true)`);
  // L'hôte lance (bouton)
  await a.waitForTimeout(4500);
  const lancer = a.locator('[data-act="lancer"]');
  if (await lancer.count() && await lancer.isEnabled()) { await lancer.click(); await a.waitForTimeout(3000); } else { console.log('lancer désactivé, lancement par le serveur'); q(1, `select hg_ndc_lancer('${code}')`); }
  const etat = (n) => JSON.parse(q(n, `select hg_ndc_etat('${code}')`));
  let e = etat(1);
  const eq = e.partie.tour_equipe;
  const esp = num(e.joueurs.find((j) => j.equipe === eq && j.espion).user_id);
  const ags = e.joueurs.filter((j) => j.equipe === eq && !j.espion).map((j) => num(j.user_id));
  console.log('tour', eq, 'espion', esp, 'agents', ags.join(','));
  // Vue espion (ordinateur) : indice au clavier
  const s = await ouvrir(esp, `#partie/${code}`); await s.waitForTimeout(2500);
  await shot(s, '05-table-espion', false);
  const champ = s.locator('input[name="mot"]');
  if (await champ.count()) {
    await champ.fill('Galaxie'); await s.locator('select[name="nombre"]').selectOption('2');
    await s.locator('.ndc-bouton-indice').click(); await s.waitForTimeout(2500);
  } else console.log('pas de formulaire d\'indice');
  e = etat(1);
  console.log('phase', e.partie.phase, 'indice', e.indice && e.indice.mot);
  // Agents : ouvrent la table (le premier au téléphone) et proposent le même mot de l'équipe
  const bonne = JSON.parse(su(`select to_jsonb(pos) from hg_ndc_cartes where partie = '${e.partie.id}' and couleur = '${eq}' limit 1`));
  const pages = [];
  for (const [i, n] of ags.entries()) pages.push(await ouvrir(n, `#partie/${code}`, i === 0 ? 390 : 1280));
  await pages[0].waitForTimeout(2000);
  await pages[0].locator(`button.ndc-carte[data-pos="${bonne}"]`).click(); await pages[0].waitForTimeout(2500);
  await shot(pages[0], '06-table-agent-tel-proposition');
  if (pages[1]) { await pages[1].waitForTimeout(1000); await pages[1].locator(`button.ndc-carte[data-pos="${bonne}"]`).click(); await pages[1].waitForTimeout(2500); await shot(pages[1], '07-table-agent-revelee', false); }
  e = etat(1);
  console.log('révélée', e.cartes[bonne].revelee, 'essais', e.partie.essais);
  await s.waitForTimeout(2000); await shot(s, '08-table-espion-apres', false);
  // Fin : l'équipe révèle l'assassin
  const ass = JSON.parse(su(`select to_jsonb(pos) from hg_ndc_cartes where partie = '${e.partie.id}' and couleur = 'assassin'`));
  if (e.partie.tour_equipe === eq && e.partie.phase === 'devine') for (const n of ags) { try { q(n, `select hg_ndc_proposer('${code}', ${ass})`); } catch (err) { console.log(err.message); } }
  else su(`select hg_ndc__terminer('${e.partie.id}', 'rose', 'mots')`);
  await a.waitForTimeout(4500);
  await shot(a, '09-fin');
  await pages[0].waitForTimeout(1500); await shot(pages[0], '10-fin-tel');
  await a.goto('http://localhost:8080/nom-de-code.html#stats'); await a.waitForTimeout(2000);
  await shot(a, '11-stats');
  // Admin (section montée seule)
  await a.evaluate(async () => {
    const main = document.querySelector('main') || document.body;
    main.innerHTML = '<div id="r" style="max-width:1100px;margin:24px auto"></div>';
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/css/admin-ndc.css'; document.head.appendChild(l);
    const m = await import('/assets/js/admin-ndc.js'); await m.mountNdcSection(document.querySelector('#r'));
  });
  await a.waitForTimeout(2500); await shot(a, '12-admin');
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message.slice(0, 500)); await fermer(); process.exit(1); });
