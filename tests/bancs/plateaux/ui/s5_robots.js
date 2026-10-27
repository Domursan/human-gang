// Parcours : un administrateur seul crée une partie, ajoute des robots, lance, et les robots jouent.
const { ouvrir, shot, fermer, su } = require('./lib.js');
(async () => {
  const code = su(`select t_call(1, $q$hg_plat_creer('{"jeu":"cluedo","nb_places":4}'::jsonb)$q$) #>> '{}'`);
  const a = await ouvrir(1, '/pages/jeux/cluedo.html', `#partie/${code}`);
  const b = a.getByRole('button', { name: 'Ajouter un robot' });
  console.log('bouton visible :', await b.isVisible());
  await b.click(); await a.waitForTimeout(1500); await b.click(); await a.waitForTimeout(1500);
  await shot(a, 'robots_salle');
  await a.getByRole('button', { name: 'Lancer la partie' }).click(); await a.waitForTimeout(3000);
  console.log('statut :', su(`select statut from hg_plat_parties where code='${code}'`));
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
