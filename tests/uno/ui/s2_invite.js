// Invité sans compte : aperçu, pseudo, salle d'attente, partie lancée par l'hôte, table sur téléphone.
const { ouvrir, shot, fermer, psql, uid } = require('./lib.js');
const q = (n, sql) => { const r = psql(uid(n), sql); if (!r.ok) throw new Error(r.message); return r.text; };
(async () => {
  const code = q(1, `select hg_uno_creer('{"nb_places":4,"invites":true}'::jsonb)`);
  const g = await ouvrir(0, `?code=${code}`, 390);
  await shot(g, 'i1-rejoindre');
  await g.fill('input[type="text"], input[name="pseudo"], #uno-pseudo', 'Mélo');
  const b = await g.$('button:has-text("Rejoindre la partie")'); await b.click();
  await g.waitForTimeout(3000);
  await shot(g, 'i2-salle');
  const pret = await g.$('button:has-text("prêt")'); if (pret) { await pret.click(); await g.waitForTimeout(1500); }
  q(1, `select hg_uno_lancer('${code}')`);
  await g.waitForTimeout(5000);
  await shot(g, 'i3-table', false);
  console.log('url', g.url());
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
