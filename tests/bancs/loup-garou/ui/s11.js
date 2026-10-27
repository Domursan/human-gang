const { ouvrir, shot, fermer } = require('./lib.js');
(async () => {
  const code = process.argv[2];
  for (const [n, w, nom] of [[1, 1280, 'theme-sorciere'], [5, 1280, 'theme-loup-garou'], [7, 390, 'theme-voyante-tel'], [6, 1280, 'theme-petite-fille']]) {
    const p = await ouvrir(n, '#partie/' + code, w); await p.waitForTimeout(1500); await shot(p, nom);
  }
  await fermer();
})();
