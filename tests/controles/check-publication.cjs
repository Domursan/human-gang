// Vérifie que le site publié est bien tout site/ et seulement site/ (GitHub Pages sert le dossier site/ ;
// le reste du dépôt — supabase/, docs/, tests/, impression/ — n'est jamais publié).
// Contrôles :
// - aucun fichier .sql, .md ou .ts dans site/ ;
// - le dossier impression/ n'est pas dans site/ (ni aucun dossier impression/ sous site/) ;
// - aucun dossier de développement (supabase, docs, tests, impression, qa) sous site/ ;
// - les fichiers précachés par site/sw.js et les fichiers indispensables existent dans site/ ;
// - les outils internes (simulateur, affiche des solutions des secrets) : signalés, pas bloquants (voir plus bas).
// Lancer : node tests/controles/check-publication.cjs   (ou npm run check, depuis tests/)
'use strict';
const fs = require('fs');
const path = require('path');

const DEPOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(DEPOT, 'site');
const errors = [];
const warnings = [];

/** Tous les fichiers de site/ (chemins relatifs à site/). */
function listSite(dir = SITE, rel = '', out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listSite(path.join(dir, e.name), r, out); else out.push(r);
  }
  return out;
}

if (!fs.existsSync(SITE)) errors.push('site/ absent du dépôt');
const files = listSite();
const pub = new Set(files);

// 1. Types de fichiers qui n'ont rien à faire dans le site publié.
for (const f of files) {
  if (/\.(sql|md|ts)$/.test(f)) errors.push(`${f} est dans site/ (fichier de développement, jamais publié)`);
}

// 2. Impression et dossiers de développement : jamais sous site/.
for (const f of files) {
  const seg = f.split('/');
  if (seg.includes('impression')) errors.push(`${f} : le dossier impression/ ne doit pas être dans site/`);
  if (seg.some((s) => ['supabase', 'docs', 'tests', 'qa', 'outils'].includes(s))) errors.push(`${f} : dossier de développement sous site/`);
}

// 3. Fichiers précachés par le service worker et fichiers indispensables : présents dans site/.
const swPath = path.join(SITE, 'sw.js');
if (!fs.existsSync(swPath)) errors.push('site/sw.js absent');
else {
  const sw = fs.readFileSync(swPath, 'utf8');
  const debut = sw.indexOf('const PRECACHE = [');
  const fin = sw.indexOf('];', debut);
  if (debut < 0 || fin < 0) errors.push('site/sw.js : liste PRECACHE introuvable');
  else {
    for (const m of sw.slice(debut, fin).matchAll(/'([^']+)'/g)) {
      const cible = m[1].replace(/^\//, '');
      if (cible && !/^https?:/.test(cible) && !pub.has(cible)) errors.push(`précache sw.js : fichier absent de site/ : ${m[1]}`);
    }
  }
}
for (const f of ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', 'offline.html']) {
  if (!pub.has(f)) errors.push(`fichier indispensable absent de site/ : ${f}`);
}

// 4. Outils internes : simulateur (outil de développement) et affiche des solutions des secrets.
// Ils restent dans site/ pour l'usage local ; le workflow de publication doit les retirer avant la mise en ligne.
const workflow = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'publier-site.yml'), 'utf8');
for (const f of ['pages/jeux/simulateur.html', 'assets/espaces/jeux/simulateur.js']) {
  if (pub.has(f) && !workflow.includes(`site/${f}`)) errors.push(`outil interne publié : ${f} (à retirer dans publier-site.yml)`);
}

if (errors.length) {
  console.error(`Publication : ${errors.length} problème(s)`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  for (const w of warnings) console.error(`  ! ${w}`);
  process.exit(1);
}
console.log(`Publication : ${files.length} fichiers dans site/, aucun problème.`);
for (const w of warnings) console.log(`  ! ${w}`);
