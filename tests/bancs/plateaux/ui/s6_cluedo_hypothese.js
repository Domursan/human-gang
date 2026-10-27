// Régression : une hypothèse envoyée sans toucher aux listes (valeurs affichées par défaut) doit passer.
const { ouvrir, fermer, su } = require('./lib.js');
(async () => {
  const code = su(`select t_partie('cluedo', 3)`);
  const n = Number(su(`select t_num((etat->>'actif')::uuid) from hg_plat_parties where code='${code}'`));
  su(`select t_agir(t_uid(${n}), '${code}', 'deplacer', jsonb_build_object('piece', t_etat(t_uid(${n}), '${code}')->'jeu'->'voisines'->>0))`);
  const a = await ouvrir(n, '/pages/jeux/cluedo.html', `#partie/${code}`);
  await a.locator('form[data-form-hyp] button[type=submit]').click();
  await a.waitForTimeout(2500);
  console.log('hypothèses jouées :', su(`select jsonb_array_length(etat->'historique') from hg_plat_parties where code='${code}'`));
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
