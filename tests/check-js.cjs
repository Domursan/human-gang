// Analyse statique : `node --check` sur chaque fichier JavaScript du dépôt.
// Les modules ES (import/export) sont vérifiés comme tels, en copiant le fichier en .mjs dans un dossier
// temporaire, ce qui ne dépend pas de la détection automatique de modules de la version de Node.
// Les fonctions edge Deno (supabase/functions/**/*.ts) ne sont pas couvertes : pas de Deno en CI.
// Lancer : node tests/check-js.cjs   (ou npm run check)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'shots']);
const ESM = /^\s*(import\s|export\s)/m;

/** Liste récursivement les fichiers .js, .mjs et .cjs d'un dossier (sans node_modules, .git ni shots). */
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (/\.(c|m)?js$/.test(ent.name)) out.push(full);
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-check-'));
let bad = 0, n = 0;
try {
  for (const file of walk(ROOT)) {
    n++;
    const rel = path.relative(ROOT, file);
    let target = file;
    if (file.endsWith('.js') && ESM.test(fs.readFileSync(file, 'utf8'))) {
      target = path.join(tmp, rel.replace(/[\\/]/g, '__').replace(/\.js$/, '.mjs'));
      fs.copyFileSync(file, target);
    }
    try { execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' }); }
    catch (e) { bad++; console.log(`ECHEC ${rel}\n${String(e.stderr || e.message).trim()}`); }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`${n} fichiers JavaScript vérifiés, ${bad} en erreur.`);
process.exitCode = bad ? 1 : 0;
