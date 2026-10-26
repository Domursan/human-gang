// Parcours Shadow Hunters et Destins : table (ordinateur et téléphone), quelques actions, fin.
const { ouvrir, shot, fermer, su } = require('./lib.js');
const actif = (code) => Number(su(`select t_num(coalesce(tour, (etat->>'actif')::uuid)) from hg_plat_parties where code='${code}'`));
(async () => {
  // Shadow Hunters
  let code = su(`select t_partie('shadow', 5)`);
  let n = actif(code);
  const a = await ouvrir(n, 'shadow-hunters.html', `#partie/${code}`);
  await shot(a, 'sh_table_debut');
  su(`select t_agir(t_uid(${n}), '${code}', 'lancer')`);
  await a.waitForTimeout(4500); await shot(a, 'sh_table_lieu');
  const t = await ouvrir(n, 'shadow-hunters.html', `#partie/${code}`, 390);
  await shot(t, 'sh_tel');
  // Vision reçue
  const m = n === 1 ? 2 : 1;
  su(`update hg_plat_parties set etat = etat || jsonb_build_object('phase','vision','vision', jsonb_build_object('carte','V:v12','de', t_uid(${n}),'pour', t_uid(${m}))), tour = t_uid(${m}), version = version + 1 where code='${code}'`);
  const b = await ouvrir(m, 'shadow-hunters.html', `#partie/${code}`, 390);
  await shot(b, 'sh_vision_tel');
  su(`update hg_plat_parties set started_at = now() - interval '1 hour' where code='${code}'; select hg_plat__sh_blesser(t_pid('${code}'), user_id, 30, null) from hg_plat_joueurs where partie = t_pid('${code}') and hg_plat__sh_camp(prive->>'perso') = 'shadow'; select hg_plat__sh_verifier(t_pid('${code}'))`);
  await a.waitForTimeout(5000); await shot(a, 'sh_fin');
  // Destins
  code = su(`select t_partie('destins', 4)`);
  n = actif(code);
  const d = await ouvrir(n, 'destins.html', `#partie/${code}`);
  await shot(d, 'de_depart');
  su(`select t_agir(t_uid(${n}), '${code}', 'voie', '{"voie":"universite"}'); select t_agir(t_uid(${n}), '${code}', 'tourner')`);
  await d.waitForTimeout(5000); await shot(d, 'de_apres_roue');
  for (let i = 0; i < 25; i++) su(`select t_expirer('${code}')`);
  await d.waitForTimeout(5000); await shot(d, 'de_milieu');
  const dt = await ouvrir(n, 'destins.html', `#partie/${code}`, 390);
  await shot(dt, 'de_tel');
  su(`update hg_plat_parties set started_at = now() - interval '1 hour' where code='${code}'`);
  for (let i = 0; i < 300; i++) { if (su(`select statut from hg_plat_parties where code='${code}'`) !== 'en_cours') break; su(`select t_expirer('${code}')`); }
  await d.waitForTimeout(5000); await shot(d, 'de_fin');
  await fermer();
})();
