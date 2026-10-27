// Parcours Cluedo : accueil, création, salle, table (ordinateur et téléphone), fin.
const { ouvrir, shot, fermer, su } = require('./lib.js');
(async () => {
  const a = await ouvrir(1, '/pages/jeux/cluedo.html');
  await shot(a, 'clu_accueil');
  await a.goto('http://localhost:8080/pages/jeux/cluedo.html#creer'); await a.waitForTimeout(1500);
  await shot(a, 'clu_creer');
  const code = su(`select t_partie('cluedo', 4)`);
  await a.goto(`http://localhost:8080/pages/jeux/cluedo.html#partie/${code}`); await a.waitForTimeout(2500);
  await shot(a, 'clu_table_j1');
  const actif = su(`select t_num((etat->>'actif')::uuid) from hg_plat_parties where code='${code}'`);
  const b = await ouvrir(Number(actif), '/pages/jeux/cluedo.html', `#partie/${code}`);
  await shot(b, 'clu_table_actif');
  const t = await ouvrir(Number(actif), '/pages/jeux/cluedo.html', `#partie/${code}`, 390);
  await shot(t, 'clu_table_tel');
  // Salle d'attente
  const code2 = su(`select t_call(1, $q$hg_plat_creer('{"jeu":"cluedo","nb_places":5}'::jsonb)$q$) #>> '{}'`);
  su(`select t_call(2, format('hg_plat_rejoindre(%L)', '${code2}'))`);
  await a.goto(`http://localhost:8080/pages/jeux/cluedo.html#partie/${code2}`); await a.waitForTimeout(2500);
  await shot(a, 'clu_salle');
  // Fin
  su(`update hg_plat_parties set started_at = now() - interval '20 minutes' where code='${code}'; select hg_plat__terminer(t_pid('${code}'), array[t_uid(${actif})], 'enquete')`);
  await b.waitForTimeout(5000);
  await shot(b, 'clu_fin');
  await fermer();
})();
