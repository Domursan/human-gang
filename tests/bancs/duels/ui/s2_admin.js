// Parcours navigateur : section Duels de l'administration, montée seule dans une page (la coquille admin ne tourne pas sur le faux Supabase).
const { ouvrir, shot, fermer } = require('./lib.js');
(async () => {
  const a = await ouvrir(1, '');
  await a.evaluate(async () => {
    const main = document.querySelector('main') || document.body;
    main.innerHTML = '<div id="duels-root" style="max-width:1100px;margin:24px auto"></div>';
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/espaces/admin/admin-duels.css'; document.head.appendChild(l);
    const m = await import('/assets/espaces/admin/admin-duels.js');
    await m.mountDuelsSection(document.querySelector('#duels-root'));
  });
  await a.waitForTimeout(2500);
  await shot(a, '20-admin');
  await fermer();
})().catch(async (e) => { console.log('ERREUR', e.message); await fermer(); process.exit(1); });
