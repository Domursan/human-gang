const { ouvrir, shot, fermer } = require('./lib.js');
(async () => {
  const p = await ouvrir(1, '#creer');
  await p.fill('#lg-nombre', '6'); await p.press('#lg-nombre', 'Tab');
  await p.waitForTimeout(300);
  await shot(p, 'creer-6');
  await p.click('#lg-creer');
  await p.waitForTimeout(2000);
  console.log('url', p.url());
  await shot(p, 'salle-hote');
  await fermer();
})();
