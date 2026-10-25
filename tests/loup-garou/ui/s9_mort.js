const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const code = process.argv[2];
(async () => {
  psql(uid(4), `select hg_lg_agir('${code}', 'devorer', '${uid(2)}')`);
  psql(uid(1), `select hg_lg_agir('${code}', 'sonder', '${uid(4)}')`);
  const p = await ouvrir(2, '#partie/' + code);
  await p.getByRole('button', { name: /spectateur/i }).click();
  await p.waitForTimeout(800);
  await shot(p, 'mort-spectateur-haut', false);
  await p.mouse.wheel(0, 700); await p.waitForTimeout(600);
  await shot(p, 'mort-spectateur-scroll', false);
  await fermer();
})();
