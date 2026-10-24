const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const code = process.argv[2];
(async () => {
  const p2 = await ouvrir(2, '#rejoindre/' + code, 390);
  await shot(p2, 'rejoindre-tel');
  const btn = p2.getByRole('button', { name: /rejoindre/i }).first();
  await btn.click(); await p2.waitForTimeout(2000);
  console.log('url J2', p2.url());
  await shot(p2, 'salle-tel');
  for (const i of [3, 4, 5, 6]) {
    console.log(psql(uid(i), `select hg_lg_rejoindre('${code}')`).ok, psql(uid(i), `select hg_lg_pret('${code}', true)`).ok);
  }
  const p1 = await ouvrir(1, '#partie/' + code);
  await shot(p1, 'salle-pleine');
  // J2 se déclare prêt via l'interface
  const pret = p2.getByRole('button', { name: /prêt/i }).first();
  if (await pret.count()) { await pret.click(); await p2.waitForTimeout(1500); }
  await p1.waitForTimeout(4500);
  await shot(p1, 'salle-prete');
  const lancer = p1.getByRole('button', { name: /lancer/i }).first();
  console.log('lancer actif', await lancer.isEnabled());
  await lancer.click(); await p1.waitForTimeout(2500);
  await shot(p1, 'revelation-hote');
  await p2.waitForTimeout(4500);
  await shot(p2, 'revelation-tel');
  await fermer();
})();
