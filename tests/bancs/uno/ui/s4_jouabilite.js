// Jouabilité (migration 171, oct. 2026) : éventail sur 2 arcs, photos, joueur actif, pioche obligée et cartes qui arrivent,
// Contre-UNO avec délai de grâce, UNO après l'avant-dernière carte, règles modifiées par l'hôte, téléphone.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
(async () => {
  const code = q(1, `select hg_uno_creer('{"nom":"Soirée Uno","nb_places":5}'::jsonb)`);
  for (const n of [2, 3, 4]) { q(n, `select hg_uno_rejoindre('${code}')`); q(n, `select hg_uno_pret('${code}', true)`); }
  // Salle : l'hôte change les règles
  const a = await ouvrir(1, `#partie/${code}`);
  await shot(a, '41-salle-hote');
  await a.click('[data-regle="sept_zero"]'); await a.waitForTimeout(1500);
  await a.click('[data-regle="t_tour"][data-valeur="60"]'); await a.waitForTimeout(1500);
  const b = await ouvrir(2, `#partie/${code}`);
  await b.waitForTimeout(2500);
  await shot(b, '42-salle-joueur');
  console.log('variantes', su(`select variantes::text || ' ' || t_tour from hg_uno_parties where code = '${code}' and statut = 'attente'`));
  console.log('prets', su(`select string_agg(pret::text, ',') from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie where p.code = '${code}' and p.statut='attente'`));
  await b.close();
  for (const n of [2, 3, 4]) q(n, `select hg_uno_pret('${code}', true)`);
  q(1, `select hg_uno_lancer('${code}')`);
  const pid = su(`select id from hg_uno_parties where code = '${code}' and statut = 'en_cours'`);
  // 17 cartes pour Domu (2 arcs), tour à Domu
  su(`update hg_uno_cartes set lieu = 'main', user_id = '${uid(1)}' where id in (select id from hg_uno_cartes where partie = '${pid}' and lieu = 'pioche' limit 10) returning 1`);
  su(`select hg_uno__compter('${pid}')`);
  su(`update hg_uno_parties set tour = '${uid(1)}', tour_fin = now() + interval '60 seconds', version = version + 1 where id = '${pid}' returning 1`);
  await a.waitForTimeout(4500);
  await shot(a, '43-table-eventail', true);
  // Aucune carte jouable : la pioche pulse
  su(`update hg_uno_cartes set lieu = 'pioche', user_id = null where partie = '${pid}' and user_id = '${uid(1)}' and (couleur = 'k' or couleur = (select couleur from hg_uno_parties where id = '${pid}') or valeur = (select valeur from hg_uno_cartes where partie = '${pid}' and lieu = 'defausse' order by ordre desc limit 1)) returning 1`);
  su(`select hg_uno__compter('${pid}')`);
  su(`update hg_uno_parties set version = version + 1 where id = '${pid}' returning 1`);
  await a.waitForTimeout(4500);
  await shot(a, '44-pioche-obligee', true);
  await a.click('[data-pioche]'); await a.waitForTimeout(250);
  await shot(a, '45-carte-qui-vole', true);
  await a.waitForTimeout(2500);
  // Lila pose son avant-dernière carte sans dire UNO : Contre-UNO (grâce puis actif)
  su(`update hg_uno_parties set uno_attente = '${uid(3)}', uno_depuis = now(), version = version + 1 where id = '${pid}' returning 1`);
  su(`update hg_uno_cartes set lieu = 'pioche', user_id = null where partie = '${pid}' and user_id = '${uid(3)}' and id not in (select id from hg_uno_cartes where partie = '${pid}' and user_id = '${uid(3)}' limit 1) returning 1`);
  su(`select hg_uno__compter('${pid}')`);
  await a.waitForTimeout(2200);
  await shot(a, '46-contre-grace', true);
  await a.waitForTimeout(3000);
  await shot(a, '47-contre-actif', true);
  // Lila dit UNO : annonce
  q(3, `select hg_uno_uno('${code}')`);
  await a.waitForTimeout(4600);
  await shot(a, '48-annonce-uno', true);
  const t = await ouvrir(1, `#partie/${code}`, 390);
  await t.waitForTimeout(1500);
  await shot(t, '49-tel', true);
  const carte = await t.$('.uno-fan-carte button');
  if (carte) { await carte.click({ force: true }); await t.waitForTimeout(400); await shot(t, '50-tel-carte-levee', true); }
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
