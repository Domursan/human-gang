/**
 * Lance toute la suite de tests, l'un après l'autre : vérifications statiques, tests de fumée,
 * puis chaque tests/parcours-*.cjs et composants-admin-ui.cjs.
 * Chaque fichier a une limite de temps (4 min) et, s'il échoue ou dépasse la limite, il est relancé une fois :
 * un navigateur lent ou bloqué (fréquent sur les machines de GitHub) ne fait pas échouer toute la suite.
 * S'arrête au premier fichier qui échoue deux fois.
 * Lancer : npm test   (ou : node tests/run-all.cjs)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
/** Limite de temps d'un fichier de test, en millisecondes. */
const LIMITE_MS = 4 * 60_000;
const parcours = fs.readdirSync(dir).filter((f) => /^parcours-.*\.cjs$/.test(f)).sort();
const suite = ['check-js.cjs', 'check-rpc.mjs', 'smoke.cjs', 'smoke-admin.cjs', 'composants-admin-ui.cjs', ...parcours];

/**
 * Lance un fichier de test et indique s'il a réussi dans le temps imparti.
 * @param {string} f Nom du fichier dans tests/.
 * @returns {boolean} true si le code de sortie vaut 0.
 */
function lancer(f) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', timeout: LIMITE_MS, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') console.error(`\nLimite de temps dépassée : ${f}`);
  return r.status === 0;
}

const relances = [];
for (const f of suite) {
  process.stdout.write(`\n=== ${f}\n`);
  if (lancer(f)) continue;
  console.error(`\nNouvel essai : ${f}`);
  relances.push(f);
  if (!lancer(f)) {
    console.error(`\nÉchec : ${f}`);
    process.exit(1);
  }
}
console.log(`\nSuite complète : ${suite.length} fichiers, tous OK.${relances.length ? ` Réussis au second essai : ${relances.join(', ')}.` : ''}`);
