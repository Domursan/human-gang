// Polices hébergées (controles/check-polices.cjs) : Archivo Black et Inter servies par le site (assets/fonts), sans Google Fonts.
// Contrôles :
// - aucune page (affiches comprises) ni feuille de style ne demande Archivo Black ou Inter à Google ;
// - chaque @font-face de base.css pointe vers un fichier existant dans assets/fonts/, et les fichiers sont des woff2 ;
// - les pages qui ne chargent plus aucune police Google n'autorisent plus fonts.googleapis.com ni fonts.gstatic.com dans leur CSP ;
// - sw.js précache les quatre fichiers de polices (hors ligne, le texte garde sa police) ;
// - la licence (assets/fonts/OFL.txt) accompagne les fichiers.
// Lancer : node tests/controles/check-polices.cjs   (ou npm run check, depuis tests/)
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..', '..', 'site');
const erreurs = [];
const lire = (f) => fs.readFileSync(f, 'utf8');
/** Tous les fichiers d'une extension sous un dossier (chemins absolus). */
function parcourir(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) parcourir(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(SITE, p).split(path.sep).join('/');
const POLICES_HEBERGEES = /family=(Archivo\+Black|Inter)(?![A-Za-z+])/;
const GOOGLE_LIEN = /<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/g;

// 1. Pages et feuilles : plus de demande de Archivo Black ni d'Inter à Google (les affiches gardent les leurs)
const pages = parcourir(SITE, '.html');
for (const p of pages) {
  const t = lire(p);
  for (const lien of t.match(GOOGLE_LIEN) || []) {
    if (POLICES_HEBERGEES.test(lien)) erreurs.push(`${rel(p)} : lien Google pour une police hébergée (${lien.slice(0, 90)}…)`);
  }
}
for (const f of parcourir(SITE, '.css')) {
  if (POLICES_HEBERGEES.test(lire(f)) && /fonts\.googleapis/.test(lire(f))) erreurs.push(`${rel(f)} : @import Google pour une police hébergée`);
}

// 2. base.css : chaque @font-face pointe vers un woff2 présent
const base = lire(path.join(SITE, 'assets', 'commun', 'base.css'));
const faces = [...base.matchAll(/@font-face\s*\{[^}]*src:\s*url\('([^']+)'\)\s*format\('woff2'\)/g)].map((m) => m[1]);
if (faces.length < 4) erreurs.push(`base.css : ${faces.length} @font-face trouvée(s), 4 attendues (Archivo Black, Inter 400/500/700)`);
// 2 bis. affiches : polices-affiches.css déclare les mêmes fichiers, plus Inter 600/800/900
const affiches = lire(path.join(SITE, 'assets', 'fonts', 'polices-affiches.css'));
for (const u of [...affiches.matchAll(/src: url\('([^']+)'\)/g)].map((m) => m[1])) {
  if (!fs.existsSync(path.join(SITE, u.replace(/^\//, '')))) erreurs.push(`polices-affiches.css : ${u} absent de site/`);
}
for (const u of faces) {
  const f = path.join(SITE, u.replace(/^\//, ''));
  if (!fs.existsSync(f)) erreurs.push(`base.css : ${u} absent de site/`);
  else if (fs.readFileSync(f).slice(0, 4).toString('latin1') !== 'wOF2') erreurs.push(`${u} : pas un fichier woff2`);
}

// 3. CSP : une page sans police Google n'ouvre plus fonts.googleapis.com ni fonts.gstatic.com
for (const p of pages) {
  const t = lire(p);
  const csp = (t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
  if (!csp) continue;
  const garde = (t.match(GOOGLE_LIEN) || []).length > 0;
  if (!garde && /fonts\.(googleapis|gstatic)\.com/.test(csp)) erreurs.push(`${rel(p)} : CSP autorise Google Fonts sans plus aucun lien Google`);
}

// 4. Service worker : polices précachées
const sw = lire(path.join(SITE, 'sw.js'));
for (const f of ['archivo-black-latin.woff2', 'inter-latin-400.woff2', 'inter-latin-500.woff2', 'inter-latin-700.woff2']) {
  if (!sw.includes(`/assets/fonts/${f}`)) erreurs.push(`sw.js : /assets/fonts/${f} absent de PRECACHE`);
}

// 5. Licence
if (!fs.existsSync(path.join(SITE, 'assets', 'fonts', 'OFL.txt'))) erreurs.push('assets/fonts/OFL.txt absent (licence SIL OFL)');

if (erreurs.length) {
  console.error(`Polices : ${erreurs.length} problème(s)`);
  for (const e of erreurs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Polices : ${pages.length} pages, ${faces.length} @font-face hébergées, aucun problème.`);
