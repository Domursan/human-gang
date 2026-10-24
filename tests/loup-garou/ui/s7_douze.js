const { ouvrir, shot, fermer } = require('./lib.js');
const { psql, uid } = require('./fake.js');
const SU = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) console.log('SQL', r.message); return r.text; };
(async () => {
  const code = psql(uid(1), `select hg_lg_creer('{"nom":"Grande tablée","nb_joueurs":12,"composition":{"loup-garou":3,"voyante":1,"sorciere":1,"cupidon":1,"chasseur":1,"petite-fille":1,"villageois":4}}'::jsonb)`).text;
  for (let i = 2; i <= 12; i++) { psql(uid(i), `select hg_lg_rejoindre('${code}')`); psql(uid(i), `select hg_lg_pret('${code}', true)`); }
  psql(uid(1), `select hg_lg_lancer('${code}')`);
  for (let i = 1; i <= 12; i++) psql(uid(i), `select hg_lg_vu('${code}')`);
  const qui = (r) => +SU(`select right(user_id::text,2)::int from hg_lg_cartes c join hg_lg_parties p on p.id=c.partie where p.code='${code}' and c.role='${r}' limit 1`);
  console.log('phase', SU(`select phase from hg_lg_parties where code='${code}'`));
  const cu = qui('cupidon');
  const pc = await ouvrir(cu, '#partie/' + code, 390);
  await shot(pc, 'cupidon-tel');
  const noms = await pc.locator('button.lg-siege:not(:disabled)').allTextContents();
  await pc.locator('button.lg-siege:not(:disabled)').nth(0).click(); await pc.locator('button.lg-siege:not(:disabled)').nth(3).click();
  await pc.waitForTimeout(300); await shot(pc, 'cupidon-choix-tel', false);
  const b = pc.locator('.lg-pl-action-carte button.btn-primary, .lg-pl-action-carte button[type=submit]').last();
  console.log('bouton', await b.textContent().catch(() => '?')); await b.click().catch((e) => console.log('clic', e.message));
  await pc.waitForTimeout(1500);
  console.log('phase', SU(`select phase from hg_lg_parties where code='${code}'`));
  // loups dévorent le villageois
  const vic = qui('villageois');
  for (const r of SU(`select string_agg(right(user_id::text,2),',') from hg_lg_cartes c join hg_lg_parties p on p.id=c.partie where p.code='${code}' and c.role='loup-garou'`).split(','))
    psql(uid(+r), `select hg_lg_agir('${code}', 'devorer', '${uid(vic)}')`);
  psql(uid(qui('voyante')), `select hg_lg_agir('${code}', 'sonder', '${uid(qui('chasseur'))}')`);
  const so = qui('sorciere');
  const ps = await ouvrir(so, '#partie/' + code, 390);
  console.log('phase', SU(`select phase from hg_lg_parties where code='${code}'`));
  await shot(ps, 'sorciere-tel');
  const pp = await ouvrir(qui('petite-fille'), '#partie/' + code);
  await shot(pp, 'petite-fille', false);
  await fermer();
})();
