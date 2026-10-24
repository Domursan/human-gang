const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const code = process.argv[2];
const SU = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) console.log('SQL', r.message); return r; };
(async () => {
  SU(`select t_expirer('${code}')`); psql(uid(1), `select hg_lg_avancer('${code}')`);
  const p1 = await ouvrir(1, '#partie/' + code);
  await shot(p1, 'vote-avant');
  await p1.locator('.lg-siege', { hasText: 'Kaïs' }).first().click();
  await p1.waitForTimeout(300);
  const b = p1.getByRole('button', { name: /voter|confirmer/i }).first();
  console.log('bouton vote :', await b.textContent());
  await b.click(); await p1.waitForTimeout(1200);
  for (const i of [3, 5]) psql(uid(i), `select hg_lg_voter('${code}', '${uid(4)}')`);
  await p1.waitForTimeout(4500);
  await shot(p1, 'vote-apres');
  for (const i of [4, 6]) { const r = psql(uid(i), `select hg_lg_voter('${code}', '${uid(i === 4 ? 1 : 4)}')`); if (!r.ok) console.log(r.message); }
  await p1.waitForTimeout(5000);
  await shot(p1, 'fin-gagnant');
  const p4 = await ouvrir(4, '#partie/' + code, 390);
  await shot(p4, 'fin-perdant-tel');
  await fermer();
})();
