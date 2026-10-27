// Parcours navigateur : section « Jeux de plateau » de l'administration, montée seule dans une page.
const { ouvrir, shot, fermer, su } = require('./lib.js');
(async () => {
  su(`select t_partie('risk', 3)`);
  const a = await ouvrir(1, '/pages/jeux/cluedo.html');
  await a.evaluate(async () => {
    const main = document.querySelector('main') || document.body;
    main.innerHTML = '<div id="plateaux-root" style="max-width:1100px;margin:24px auto"></div>';
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/espaces/admin/admin-plateaux.css'; document.head.appendChild(l);
    const m = await import('/assets/espaces/admin/admin-plateaux.js');
    await m.mountPlateauxSection(document.querySelector('#plateaux-root'));
  });
  await a.waitForTimeout(2500);
  await shot(a, 'admin_cluedo');
  // Onglet Risk, ouvrir la liste des territoires, modifier un nom, enregistrer
  await a.getByRole('tab', { name: 'Risk' }).click(); await a.waitForTimeout(1500);
  const det = a.locator('details', { hasText: 'Territoires' }).first();
  await det.locator('summary').click(); await a.waitForTimeout(500);
  const champ = det.locator('input[type="text"]').first();
  await champ.fill('Alaska du Nord');
  await det.getByRole('button', { name: /Enregistrer/ }).first().click(); await a.waitForTimeout(1500);
  console.log('nom en base :', su(`select hg_plat__n('risk', 'territoires', 'alaska')`));
  await shot(a, 'admin_risk');
  su(`select hg_plat_admin_contenu('risk', 'territoires', null) from (select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false)) s`);
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
