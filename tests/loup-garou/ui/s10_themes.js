const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const SU = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) console.log('SQL', r.message); return r.text; };
(async () => {
  const code = psql(uid(1), `select hg_lg_creer('{"nom":"Thèmes","nb_joueurs":8,"composition":{"loup-garou":1,"loup-blanc":1,"voyante":1,"sorciere":1,"petite-fille":1,"ancien":1,"chevalier-epee-rouillee":1,"villageois":1}}'::jsonb)`).text;
  for (let i = 2; i <= 8; i++) { psql(uid(i), `select hg_lg_rejoindre('${code}')`); psql(uid(i), `select hg_lg_pret('${code}', true)`); }
  psql(uid(1), `select hg_lg_lancer('${code}')`);
  for (let i = 1; i <= 8; i++) psql(uid(i), `select hg_lg_vu('${code}')`);
  const roles = SU(`select string_agg(right(user_id::text,2)||'='||role, ' ' order by user_id) from hg_lg_cartes c join hg_lg_parties p on p.id=c.partie where p.code='${code}'`);
  console.log(roles);
  const pick = (r) => +roles.split(' ').find((x) => x.endsWith('=' + r)).split('=')[0];
  for (const [r, w] of [['sorciere', 1280], ['loup-garou', 1280], ['voyante', 390], ['petite-fille', 1280]]) {
    const p = await ouvrir(pick(r), '#partie/' + code, w);
    await p.waitForTimeout(1500);
    await shot(p, 'theme-' + r + (w < 600 ? '-tel' : ''));
  }
  await fermer();
})();
