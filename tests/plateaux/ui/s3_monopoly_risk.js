// Parcours Monopoly et Risk : table (ordinateur et téléphone), quelques actions, fin. Base : « plat ».
const { ouvrir, shot, fermer, su } = require('./lib.js');
const actif = (code) => Number(su(`select t_num(coalesce(tour, (etat->>'actif')::uuid)) from hg_plat_parties where code='${code}'`));
(async () => {
  // Monopoly
  let code = su(`select t_partie('monopoly', 4)`);
  for (let i = 0; i < 30; i++) su(`select t_expirer('${code}')`);
  let n = actif(code);
  const a = await ouvrir(n, 'monopoly.html', `#partie/${code}`);
  await shot(a, 'mo_table');
  const autre = n === 1 ? 2 : 1;
  su(`update hg_plat_parties set etat = etat || jsonb_build_object('offre', jsonb_build_object('de', t_uid(${n}), 'a', t_uid(${autre}), 'donne', '{"argent":100}'::jsonb, 'recoit', '{}'::jsonb)), version = version + 1 where code='${code}'`);
  const t = await ouvrir(autre, 'monopoly.html', `#partie/${code}`, 390);
  await shot(t, 'mo_tel_offre');
  su(`update hg_plat_parties set started_at = now() - interval '3 hours' where code='${code}'`);
  for (let i = 0; i < 20; i++) { if (su(`select statut from hg_plat_parties where code='${code}'`) !== 'en_cours') break; su(`select t_expirer('${code}')`); }
  await a.waitForTimeout(5000); await shot(a, 'mo_fin');
  // Risk
  code = su(`select t_partie('risk', 4)`);
  const p = await ouvrir(1, 'risk.html', `#partie/${code}`);
  await shot(p, 'rk_placement');
  su(`select t_expirer('${code}')`);
  n = actif(code);
  const r = await ouvrir(n, 'risk.html', `#partie/${code}`);
  await shot(r, 'rk_renforts');
  const rt = await ouvrir(n, 'risk.html', `#partie/${code}`, 390);
  await shot(rt, 'rk_tel');
  su(`select t_rk_tour('${code}')`);
  await r.waitForTimeout(5000); await shot(r, 'rk_apres_tour');
  for (let i = 0; i < 60; i++) { if (su(`select statut from hg_plat_parties where code='${code}'`) !== 'en_cours') break; su(`select t_rk_tour('${code}')`); }
  if (su(`select statut from hg_plat_parties where code='${code}'`) === 'en_cours') su(`select hg_plat__terminer(t_pid('${code}'), array[t_uid(1)], 'monde')`);
  await r.waitForTimeout(5000); await shot(r, 'rk_fin');
  await fermer();
})();
