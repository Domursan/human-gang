const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const code = process.argv[2];
(async () => {
  const p1 = await ouvrir(1, '#partie/' + code, 390);
  await p1.getByRole('button', { name: /compris/i }).first().click();
  for (const i of [2, 3, 4, 5, 6]) psql(uid(i), `select hg_lg_vu('${code}')`);
  await p1.waitForTimeout(4500);
  await shot(p1, 'nuit-voyante-tel');
  const p4 = await ouvrir(4, '#partie/' + code);
  await shot(p4, 'nuit-loup');
  const p2 = await ouvrir(2, '#partie/' + code);
  await shot(p2, 'nuit-villageois');
  await fermer();
})();
