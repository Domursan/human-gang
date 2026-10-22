/**
 * Lance toute la suite de tests, l'un après l'autre : vérifications statiques, tests de fumée,
 * puis chaque tests/parcours-*.cjs et composants-admin-ui.cjs. S'arrête au premier échec.
 * Lancer : npm test   (ou : node tests/run-all.cjs)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const parcours = fs.readdirSync(dir).filter((f) => /^parcours-.*\.cjs$/.test(f)).sort();
const suite = ['check-js.cjs', 'check-rpc.mjs', 'smoke.cjs', 'smoke-admin.cjs', 'composants-admin-ui.cjs', ...parcours];

for (const f of suite) {
  process.stdout.write(`\n=== ${f}\n`);
  try {
    execFileSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  } catch {
    console.error(`\nÉchec : ${f}`);
    process.exit(1);
  }
}
console.log(`\nSuite complète : ${suite.length} fichiers, tous OK.`);
