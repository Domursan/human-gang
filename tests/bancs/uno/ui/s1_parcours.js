// Parcours complet : accueil, création, salle d'attente, lancement, table (ordi + téléphone), Joker et roue, fin de partie.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
const su = (sql) => { const r = psql(null, 'reset role; ' + sql); if (!r.ok) throw new Error(r.message); return r.text; };
(async () => {
  const a = await ouvrir(1, '');
  await shot(a, '01-accueil');
  await a.goto('http://localhost:8080/pages/jeux/uno.html#creer'); await a.waitForTimeout(1500);
  await shot(a, '02-creer');
  const champ = await a.$('input[type="range"]');
  if (champ) await champ.evaluate((el) => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const btn = await a.$('form button[type="submit"]') || await a.$('button:has-text("Créer la partie")');
  await btn.click(); await a.waitForTimeout(2500);
  const code = decodeURIComponent(a.url().split('#partie/')[1] || '');
  console.log('code', code);
  q(2, `select hg_uno_rejoindre('${code}')`); q(2, `select hg_uno_pret('${code}', true)`);
  q(3, `select hg_uno_rejoindre('${code}')`); q(3, `select hg_uno_pret('${code}', true)`);
  await a.waitForTimeout(4500);
  await shot(a, '03-salle');
  const lancer = await a.$('button:has-text("Lancer")');
  if (lancer) { await lancer.click(); await a.waitForTimeout(2500); } else console.log('pas de bouton Lancer');
  await shot(a, '04-table-ordi', false);
  // Donne le tour à Domu avec un Joker jouable
  const pid = su(`select id from hg_uno_parties where code = '${code}' and statut = 'en_cours'`);
  su(`update hg_uno_cartes set user_id = '${uid(1)}' where id = (select id from hg_uno_cartes where partie = '${pid}' and lieu = 'pioche' and valeur = 'joker' limit 1) returning 1`);
  su(`update hg_uno_cartes set lieu = 'main' where partie = '${pid}' and user_id = '${uid(1)}' and lieu = 'pioche' returning 1`);
  su(`select hg_uno__compter('${pid}')`);
  su(`update hg_uno_parties set tour = '${uid(1)}', tour_fin = now() + interval '60 seconds', version = version + 1 where id = '${pid}' returning 1`);
  await a.waitForTimeout(4500);
  await shot(a, '05-mon-tour', false);
  const joker = await a.$('button.uc.k.jouable');
  if (joker) { await joker.click(); await a.waitForTimeout(800); await shot(a, '06-roue', false);
    const bleu = await a.$('.uno-roue .q-b'); if (bleu) { await bleu.click(); await a.waitForTimeout(2500); } }
  else console.log('pas de Joker jouable affiché');
  await shot(a, '07-apres-joker', false);
  const t = await ouvrir(2, `#partie/${code}`, 390);
  await shot(t, '08-table-tel', false);
  // Fin : Wae n'a plus qu'une carte jouable, c'est son tour
  su(`update hg_uno_cartes set lieu = 'pioche', user_id = null where partie = '${pid}' and user_id = '${uid(2)}' returning 1`);
  su(`update hg_uno_cartes set lieu = 'main', user_id = '${uid(2)}' where id = (select id from hg_uno_cartes where partie = '${pid}' and lieu = 'pioche' and valeur = 'joker' limit 1) returning 1`);
  su(`select hg_uno__compter('${pid}')`);
  su(`update hg_uno_parties set tour = '${uid(2)}', tour_fin = now() + interval '60 seconds', version = version + 1 where id = '${pid}' returning 1`);
  await t.waitForTimeout(4500);
  const j2 = await t.$('button.uc.jouable');
  if (j2) { await j2.click(); await t.waitForTimeout(700); const r = await t.$('.uno-roue .q-r'); if (r) await r.click(); await t.waitForTimeout(3000); }
  await shot(t, '09-fin-tel');
  await a.waitForTimeout(4500);
  await shot(a, '10-fin-ordi');
  const s = await ouvrir(1, '#stats');
  await shot(s, '11-stats');
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
