const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const SU = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) console.log('SQL', r.message); return r.text; };
(async () => {
  const code = psql(uid(1), `select hg_lg_creer('{"nom":"Soirée avec invités","nb_joueurs":6,"invites":true,"composition":{"loup-garou":1,"voyante":1,"villageois":4}}'::jsonb)`).text;
  for (const i of [2, 3, 4]) { psql(uid(i), `select hg_lg_rejoindre('${code}')`); psql(uid(i), `select hg_lg_pret('${code}', true)`); }
  const inv = [];
  for (const [k, nom] of [[0, 'Zoé'], [1, 'Yann']]) {
    const p = await ouvrir(null, '?code=' + code, k ? 1280 : 390);
    if (!k) await shot(p, 'invite-rejoindre-tel');
    await p.getByLabel(/pseudo/i).fill(nom);
    await p.getByRole('button', { name: /invité/i }).click();
    await p.waitForTimeout(2500);
    console.log(nom, p.url().replace(/.*html/, ''));
    inv.push(p);
  }
  await shot(inv[0], 'invite-salle-tel');
  for (const p of inv) { const b = p.getByRole('button', { name: /prêt/i }).first(); if (await b.count()) await b.click(); }
  await inv[1].waitForTimeout(5000);
  console.log('prêts', SU(`select count(*) from hg_lg_joueurs j join hg_lg_parties p on p.id=j.partie where p.code='${code}' and pret`));
  psql(uid(1), `select hg_lg_lancer('${code}')`);
  await inv[1].waitForTimeout(5000);
  await shot(inv[1], 'invite-revelation');
  for (const p of inv) { const b = p.getByRole('button', { name: /compris/i }).first(); if (await b.count()) await b.click(); }
  for (const i of [1, 2, 3, 4]) psql(uid(i), `select hg_lg_vu('${code}')`);
  await inv[0].waitForTimeout(5000);
  await shot(inv[0], 'invite-nuit-tel');
  // un visiteur sans lien
  const v = await ouvrir(null, '');
  await shot(v, 'invite-sans-lien', false);
  // fin de partie
  SU(`select hg_lg__terminer(t_pid('${code}'), 'village')`);
  await inv[1].waitForTimeout(5000);
  await shot(inv[1], 'invite-fin');
  await fermer();
})();
