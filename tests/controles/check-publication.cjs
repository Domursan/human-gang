// Vérifie la publication GitHub Pages (Jekyll + _config.yml, voir docs/PUBLICATION.md) :
// - pas de .nojekyll (sinon _config.yml est ignoré et supabase/, docs/, tests/ sont de nouveau publiés) ;
// - aucun fichier publié ne commence par « --- » (il serait traité comme un modèle Liquid) ;
// - aucun fichier publié dans un dossier ou sous un nom commençant par « _ » ou « . » sans être dans « include » ;
// - les fichiers précachés par sw.js et le fichier lu par l'admin (bot-templates.json) restent publiés.
// Les règles d'exclusion sont relues dans _config.yml et appliquées comme Jekyll 3 (préfixe ou motif où * couvre aussi « / »).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const errors = [];

/** Liste « include » ou « exclude » de _config.yml (format simple : une entrée « - valeur » par ligne). */
function yamlList(text, key) {
  const out = [];
  let on = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) on = line.startsWith(`${key}:`);
    else if (on) {
      const m = line.match(/^\s+-\s+"?([^"#]+?)"?\s*(#.*)?$/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}
/** Motif Jekyll (File.fnmatch sans FNM_PATHNAME : * couvre « / ») en expression régulière. */
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
/** Vrai si le chemin correspond à l'un des motifs (correspondance exacte, motif, ou préfixe comme Jekyll). */
const matches = (list, rel) => list.some((p) => globRe(p).test(rel) || rel.startsWith(p));

const cfgPath = path.join(ROOT, '_config.yml');
if (!fs.existsSync(cfgPath)) errors.push('_config.yml absent');
if (fs.existsSync(path.join(ROOT, '.nojekyll'))) errors.push('.nojekyll présent : _config.yml serait ignoré');
const cfg = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf8') : '';
const include = yamlList(cfg, 'include');
const exclude = yamlList(cfg, 'exclude');
if (!exclude.length) errors.push('_config.yml : liste « exclude » vide ou illisible');

/** Fichiers suivis par git, sinon parcours du dossier (hors node_modules et .git). */
function listFiles() {
  try { return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean); } catch { /* pas de git */ }
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel); else out.push(rel);
    }
  };
  walk('');
  return out;
}

/** Vrai si Jekyll publierait ce fichier : chaque segment du chemin est filtré comme par EntryFilter. */
function published(rel) {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i], sub = parts.slice(0, i + 1).join('/');
    if (matches(include, sub) || matches(include, seg)) continue;
    if (/^[._#~]/.test(seg) || seg.endsWith('~') || matches(exclude, sub)) return false;
  }
  return true;
}

const files = listFiles().filter((f) => fs.existsSync(path.join(ROOT, f)));
const pub = new Set(files.filter(published));

for (const f of pub) {
  const fd = fs.openSync(path.join(ROOT, f), 'r');
  const buf = Buffer.alloc(3);
  fs.readSync(fd, buf, 0, 3, 0);
  fs.closeSync(fd);
  if (buf.toString() === '---') errors.push(`${f} commence par « --- » : Jekyll le traiterait comme un modèle Liquid`);
  if (/^(supabase\/(migrations|schema)|docs|tests|qa)\//.test(f) || /\.(md|sql|ts)$/.test(f)) errors.push(`${f} serait publié`);
}

// Fichiers précachés par le service worker : tous doivent être publiés.
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const pre = sw.slice(sw.indexOf('const PRECACHE = ['), sw.indexOf('];', sw.indexOf('const PRECACHE = [')));
for (const m of pre.matchAll(/'([^']+)'/g)) if (!pub.has(m[1])) errors.push(`précache sw.js non publié : ${m[1]}`);
for (const f of ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', 'supabase/functions/_shared/bot-templates.json']) {
  if (!pub.has(f)) errors.push(`fichier nécessaire non publié : ${f}`);
}

// Outils de développement et affiche des solutions des secrets : jamais servis (ré-audit F7).
for (const f of ['/pages/jeux/simulateur.html', 'assets/espaces/jeux/simulateur.js', 'affiches/secrets-solutions-a3.html']) {
  if (pub.has(f)) errors.push(`fichier interne publié : ${f}`);
}

if (errors.length) {
  console.error(`Publication : ${errors.length} problème(s)`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Publication : ${pub.size} fichiers publiés sur ${files.length}, aucun problème.`);
