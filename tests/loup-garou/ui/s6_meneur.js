const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const SU = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) console.log('SQL', r.message); return r; };
(async () => {
  const r = psql(uid(1), `select hg_lg_creer('{"nom":"Soirée meneur","mode":"mj","nb_joueurs":7,"composition":{"loup-garou":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"villageois":1}}'::jsonb)`);
  const code = JSON.parse(JSON.stringify(r.text)); console.log('code', code, r.message || '');
  for (let i = 2; i <= 8; i++) { psql(uid(i), `select hg_lg_rejoindre('${code}')`); psql(uid(i), `select hg_lg_pret('${code}', true)`); }
  psql(uid(1), `select hg_lg_lancer('${code}')`);
  for (let i = 2; i <= 8; i++) psql(uid(i), `select hg_lg_vu('${code}')`);
  psql(uid(1), `select hg_lg_avancer('${code}', true)`);
  psql(uid(3), `select hg_lg_message('${code}', 'salon', 'salut')`);
  const m = await ouvrir(1, '#partie/' + code);
  await shot(m, 'meneur');
  const mt = await ouvrir(1, '#partie/' + code, 390);
  await shot(mt, 'meneur-tel');
  // un joueur en téléphone pendant la nuit avec un message dans le chat
  const role = (n) => SU(`select role from hg_lg_cartes c join hg_lg_parties p on p.id = c.partie where p.code = '${code}' and c.user_id = '${uid(n)}'`).text;
  let loup = 2; while (role(loup) !== 'loup-garou' && loup < 8) loup++;
  psql(uid(loup), `select hg_lg_message('${code}', 'loups', 'On mange Brume ?')`);
  const pl = await ouvrir(loup, '#partie/' + code, 390);
  await shot(pl, 'loup-tel');
  console.log('phase', SU(`select phase from hg_lg_parties where code = '${code}'`).text);
  await fermer();
})();
