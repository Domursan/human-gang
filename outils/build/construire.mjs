// Construit le site publié : copie site/ dans _site/, puis regroupe et compresse le JS et le CSS au moment de la publication.
// Le code source de site/ ne change pas : seul _site/ est modifié.
//
// Lancer : node outils/build/construire.mjs [dossier de sortie]   (défaut : _site/ à la racine du dépôt)
//
// Ce qui est fait :
// - JS : chaque module de page (<script type="module" src>) devient une « entrée » esbuild. Les entrées d'un même
//   site partagent leurs morceaux communs (splitting), les imports dynamiques restent des morceaux séparés.
//   Sorties dans _site/assets/_b/ (sous /assets/ pour que le service worker les traite comme du code).
// - Imports calculés (import(variable), import(`./${id}.js`)) : leur cible reste chargée par son adresse d'origine.
//   Ces cibles sont donc aussi des entrées, et leur fichier d'origine dans _site/ devient un relais vers la version
//   regroupée : une seule instance de chaque module par page (les états partagés restent uniques).
// - import.meta.url est remplacé par l'adresse d'origine du fichier : les URL relatives (feuilles, images) restent justes.
// - Chemins relatifs des littéraux « ./x.js » et « ../x.js » ramenés à des chemins absolus du site : un module
//   regroupé n'a plus son adresse d'origine, et le chemin doit rester juste pour les imports calculés.
// - Préchargements : chaque page reçoit un <link rel="modulepreload"> pour tout le graphe d'imports statiques de ses modules
//   (version regroupée). Sans eux, le navigateur découvre chaque niveau de la chaîne après le précédent (cascade d'allers-retours).
// - CSS : chaque feuille est minifiée ; les feuilles locales d'une page sont regroupées en un seul fichier quand
//   c'est sûr (ordre conservé, pas d'@import, pas d'url() relative). Fichiers dans _site/assets/_b/css/.
// - Scripts classiques (theme-boot.js…) : minifiés sur place, sans renommer les variables (ils sont globaux).
// - sw.js : PRECACHE est réécrit (fichiers regroupés ajoutés, scripts d'origine devenus inutiles retirés) et
//   CACHE_VERSION est incrémentée dans la copie publiée seulement. site/sw.js reste tel quel.
// - Les autres fichiers (JSON, images, affiches, pages) sont copiés tels quels.

import * as esbuild from 'esbuild';
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(HERE, '..', '..');
const SRC = join(RACINE, 'site');
const OUT = resolve(process.argv[2] || join(RACINE, '_site'));

const journal = [];
const dire = (ligne) => { journal.push(ligne); console.log(ligne); };

/** Liste récursive des fichiers d'un dossier (chemins absolus). */
function parcourir(dossier) {
  const fichiers = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) fichiers.push(...parcourir(chemin));
    else fichiers.push(chemin);
  }
  return fichiers;
}

/** Chemin relatif à site/, en barres obliques (ex. « assets/commun/site-boot.js »). */
const relSrc = (abs) => relative(SRC, abs).split(sep).join('/');
const dossierRel = (abs) => posix.dirname(relSrc(abs));
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tailleKo = (n) => `${(n / 1024).toFixed(1)} Ko`;
const sha8 = (texte) => createHash('sha1').update(texte).digest('hex').slice(0, 8);

// ---------- 1. Copie de site/ vers la sortie ----------
rmSync(OUT, { recursive: true, force: true });
cpSync(SRC, OUT, { recursive: true });
dire(`Copie de site/ vers ${relative(RACINE, OUT)}/`);

const tousFichiers = parcourir(SRC);
const pagesHtml = tousFichiers.filter((f) => f.endsWith('.html'));
const fichiersJs = tousFichiers.filter((f) => /\.m?js$/.test(f));
const fichiersCss = tousFichiers.filter((f) => f.endsWith('.css'));

// ---------- 2. Entrées : modules de page, puis cibles des imports calculés ----------
const entrees = new Set();   // chemins absolus des modules de page
const cibles = new Set();    // modules chargés par adresse calculée (ils deviennent des relais)
const motifsCalcules = [];   // motifs (regex) des imports en modèle de texte, ex. ./${id}.js

for (const page of pagesHtml) {
  const texte = readFileSync(page, 'utf8');
  for (const [balise] of texte.matchAll(/<script\b[^>]*>/gi)) {
    if (!/type\s*=\s*["']module["']/i.test(balise)) continue;
    const src = balise.match(/\ssrc\s*=\s*"([^"]+)"/i);
    if (!src) continue;
    if (!src[1].startsWith('/')) throw new Error(`Script module à adresse relative dans ${relSrc(page)} : ${src[1]}`);
    const abs = join(SRC, src[1]);
    if (!existsSync(abs)) throw new Error(`Module introuvable : ${src[1]} (page ${relSrc(page)})`);
    entrees.add(abs);
  }
}
dire(`Pages : ${pagesHtml.length} · modules de page (entrées) : ${entrees.size}`);

/**
 * Réécrit un fichier JS avant regroupement :
 * - import.meta.url devient l'adresse d'origine du fichier ;
 * - les littéraux « ./x.js » / « ../x.js » deviennent des chemins absolus (vers le site) ;
 * - les modèles « ./${x}.js » deviennent des chemins absolus, et leur motif est retenu pour trouver les cibles.
 * Les cibles des littéraux (hors imports statiques) sont retenues dans « cibles ».
 */
function reecrire(texte, fichier) {
  const dossier = dossierRel(fichier);
  const adresse = '/' + relSrc(fichier);
  let t = texte;
  if (t.includes('import.meta.url')) {
    t = t.replaceAll('import.meta.url', `(self.location.origin + ${JSON.stringify(adresse)})`);
  }
  // Les bibliothèques vendorées (assets/vendor) sont des fichiers complets : pas de réécriture de littéraux.
  if (relSrc(fichier).startsWith('assets/vendor/')) return t;
  // Littéraux entre guillemets simples ou doubles.
  t = t.replace(/(['"])(\.{1,2}\/[^'"\n]*?\.m?js)\1/g, (m, q, spec, decalage, entier) => {
    const abs = '/' + posix.normalize(posix.join(dossier, spec));
    // Import statique (« import x from './y.js' », « import './y.js' », « export * from ») : pas une cible calculée.
    // Un import dynamique « import(… './y.js') » est précédé d'une parenthèse ou d'une virgule, pas de « from ».
    const statique = /(\bfrom|\bimport)\s*$/.test(entier.slice(0, decalage));
    if (!statique && existsSync(join(SRC, abs.slice(1)))) cibles.add(join(SRC, abs.slice(1)));
    return `${q}${abs}${q}`;
  });
  // Modèles de texte : `./${id}.js`
  t = t.replace(/`(\.{1,2}\/[^`\n]*?\$\{[^`\n]*?\.m?js)`/g, (m, spec) => {
    const avant = spec.slice(0, spec.indexOf('${'));
    const reste = spec.slice(avant.length);
    const abs = '/' + posix.join(dossier, avant) + reste;
    const morceaux = abs.split(/\$\{[^}]*\}/).map(echapper);
    motifsCalcules.push(new RegExp('^' + morceaux.join('[^/]+') + '$'));
    return '`' + abs + '`';
  });
  return t;
}

// ---------- 3. Regroupement JS (esbuild) ----------
const plugin = {
  name: 'site-hg',
  setup(build) {
    // Adresses absolues du site (/assets/…) : résolues dans site/.
    build.onResolve({ filter: /^\// }, (args) => {
      const abs = join(SRC, args.path);
      return existsSync(abs) ? { path: abs } : undefined;
    });
    build.onLoad({ filter: /\.m?js$/ }, async (args) => {
      const texte = readFileSync(args.path, 'utf8');
      return { contents: reecrire(texte, args.path), loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

// Les cibles des littéraux sont trouvées pendant la réécriture : on les complète avec les motifs de modèle.
// Première passe : réécriture à vide, pour remplir les cibles (les modules sont lus une seule fois par esbuild ensuite).
for (const f of fichiersJs) reecrire(readFileSync(f, 'utf8'), f);
for (const f of fichiersJs) {
  const adresse = '/' + relSrc(f);
  if (motifsCalcules.some((re) => re.test(adresse))) cibles.add(f);
}
dire(`Imports calculés : ${cibles.size} module(s) relayé(s)`);

const toutesEntrees = [...new Set([...entrees, ...cibles])];
const resultat = await esbuild.build({
  absWorkingDir: RACINE,
  entryPoints: toutesEntrees,
  outdir: OUT,
  outbase: SRC,
  entryNames: 'assets/_b/[dir]/[name]',
  chunkNames: 'assets/_b/chunks/[name]-[hash]',
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  keepNames: true,
  write: true,
  metafile: true,
  logLevel: 'warning',
  plugins: [plugin],
});

// Adresse publiée de chaque entrée (module de page ou cible relayée).
const adresseSortie = new Map();
for (const [cle, info] of Object.entries(resultat.metafile.outputs)) {
  if (!info.entryPoint) continue;
  adresseSortie.set(resolve(RACINE, info.entryPoint), '/' + relative(OUT, resolve(RACINE, cle)).split(sep).join('/'));
}
// Dépendances statiques de chaque sortie (« import … from » ; pas les imports dynamiques) : servent aux préchargements.
const importsStatiques = new Map();
for (const [cle, info] of Object.entries(resultat.metafile.outputs)) {
  importsStatiques.set(resolve(RACINE, cle), info.imports.filter((i) => i.kind === 'import-statement').map((i) => resolve(RACINE, i.path)));
}
const morceaux = parcourir(join(OUT, 'assets', '_b', 'chunks')).length;
dire(`JS regroupé : ${toutesEntrees.length} entrée(s), ${morceaux} morceau(x) partagé(s)`);

// Relais : le fichier d'origine d'une cible renvoie vers la version regroupée (même instance de module).
for (const cible of cibles) {
  const url = adresseSortie.get(cible);
  if (!url) throw new Error(`Pas de sortie pour la cible ${relSrc(cible)}`);
  writeFileSync(join(OUT, relSrc(cible)),
    `export * from ${JSON.stringify(url)};\nimport * as __m from ${JSON.stringify(url)};\nexport default __m.default;\n`);
}

// ---------- 4. Scripts classiques et CSS : minification sur place ----------
const classiques = new Set();
for (const page of pagesHtml) {
  for (const [balise] of readFileSync(page, 'utf8').matchAll(/<script\b[^>]*>/gi)) {
    if (/type\s*=\s*["']module["']/i.test(balise)) continue;
    const src = balise.match(/\ssrc\s*=\s*"(\/[^"]+\.js)"/i);
    if (src) classiques.add(src[1]);
  }
}
let octetsAvant = 0;
let octetsApres = 0;
for (const adresse of classiques) {
  const f = join(OUT, adresse);
  if (!existsSync(f)) continue;
  const avant = readFileSync(join(SRC, adresse), 'utf8');
  const apres = (await esbuild.transform(avant, { loader: 'js', minifyWhitespace: true, minifySyntax: true })).code;
  writeFileSync(f, apres);
  octetsAvant += Buffer.byteLength(avant);
  octetsApres += Buffer.byteLength(apres);
}
dire(`Scripts classiques minifiés : ${classiques.size} (${tailleKo(octetsAvant)} → ${tailleKo(octetsApres)})`);

let cssAvant = 0;
let cssApres = 0;
for (const css of fichiersCss) {
  const rel = relSrc(css);
  const avant = readFileSync(css, 'utf8');
  const apres = (await esbuild.transform(avant, { loader: 'css', minify: true })).code;
  writeFileSync(join(OUT, rel), apres);
  cssAvant += Buffer.byteLength(avant);
  cssApres += Buffer.byteLength(apres);
}
dire(`CSS minifié : ${fichiersCss.length} feuille(s) (${tailleKo(cssAvant)} → ${tailleKo(cssApres)})`);

// ---------- 5. Pages : modules réécrits, feuilles regroupées ----------
const LIEN = /<link\b[^>]*>/gi;
const SANS_RISQUE = /url\(\s*(?!["']?(?:data:|https?:|\/\/|#|\/))/i; // url() relative : ne suit pas le fichier regroupé
let feuillesFusionnees = 0;
let lienSupprimes = 0;
let preloadsAjoutes = 0;
const pagesModifiees = [];

for (const page of pagesHtml) {
  const rel = relSrc(page);
  let texte = readFileSync(page, 'utf8');

  // Modules : adresse vers la version regroupée. Préchargements vers des fichiers d'origine : retirés (remplacés ci-dessous).
  const entreesPage = [];
  texte = texte.replace(/<script\b[^>]*>/gi, (balise) => {
    if (!/type\s*=\s*["']module["']/i.test(balise)) return balise;
    const src = balise.match(/\ssrc\s*=\s*"([^"]+)"/i);
    if (!src) return balise;
    const url = adresseSortie.get(join(SRC, src[1]));
    entreesPage.push(join(OUT, url.slice(1)));
    return balise.replace(src[0], ` src="${url}"`);
  });
  // Préchargements d'origine (ex. supabase-js, chargé par un import() dans core/supabase.js) : leur version regroupée est
  // demandée dès le HTML ; ceux qui n'ont pas de version regroupée sont retirés.
  const prechargesOrigine = [];
  texte = texte.replace(/<link\b[^>]*rel\s*=\s*["']modulepreload["'][^>]*>\s*/gi, (lien) => {
    lienSupprimes++;
    const href = lien.match(/href\s*=\s*"([^"]+)"/);
    const abs = href && adresseSortie.get(join(SRC, href[1]));
    if (abs) prechargesOrigine.push(join(OUT, abs.slice(1)));
    return '';
  });

  // Préchargements : les dépendances statiques des modules de la page (regroupées) sont demandées dès le HTML, comme
  // les <link rel="modulepreload"> d'origine. Sans eux, chaque niveau de la chaîne d'imports attend le précédent.
  // Imports dynamiques et entrées elles-mêmes exclus (sauf les préchargements d'origine). Insérés avant le premier module.
  const vus = new Set(entreesPage);
  const aTraiter = [...entreesPage];
  const preloads = [];
  for (const abs of prechargesOrigine) {
    if (vus.has(abs)) continue;
    vus.add(abs);
    aTraiter.push(abs);
    preloads.push(`<link rel="modulepreload" href="/${relative(OUT, abs).split(sep).join('/')}">`);
  }
  for (let i = 0; i < aTraiter.length; i++) {
    for (const dep of importsStatiques.get(aTraiter[i]) || []) {
      if (vus.has(dep)) continue;
      vus.add(dep);
      aTraiter.push(dep);
      preloads.push(`<link rel="modulepreload" href="/${relative(OUT, dep).split(sep).join('/')}">`);
    }
  }
  if (preloads.length) {
    const premier = texte.search(/<script\b[^>]*type\s*=\s*["']module["']/i);
    if (premier >= 0) texte = texte.slice(0, premier) + preloads.join('\n  ') + '\n  ' + texte.slice(premier);
    preloadsAjoutes += preloads.length;
  }

  // Feuilles locales « rel + href » seulement : regroupées si l'ordre le permet.
  const liens = [...texte.matchAll(LIEN)].filter((m) => /rel\s*=\s*["']stylesheet["']/i.test(m[0]));
  const locales = liens.map((m, i) => {
    // Lien « rel + href » local et rien d'autre (pas de media, data-*, etc.).
    const ok = /^<link\s+rel="stylesheet"\s+href="\/[^"]+\.css"\s*\/?>$/.test(m[0]);
    return { i, m, ok };
  });
  const indices = locales.map((l, k) => (l.ok ? k : -1)).filter((k) => k >= 0);
  if (indices.length >= 2) {
    const premier = indices[0];
    const dernier = indices[indices.length - 1];
    const entre = locales.slice(premier, dernier + 1);
    const tousOk = entre.every((l) => l.ok);
    const sansStyle = !/<style\b/i.test(texte.slice(liens[premier].index, liens[dernier].index));
    const morceaux = [];
    if (tousOk && sansStyle) {
      for (const l of entre) {
        const href = l.m[0].match(/href="(\/[^"]+\.css)"/)[1];
        const contenu = readFileSync(join(OUT, href.slice(1)), 'utf8');
        if (/@import/i.test(contenu) || SANS_RISQUE.test(contenu)) { morceaux.length = 0; break; }
        morceaux.push(contenu);
      }
    }
    if (morceaux.length) {
      const fusion = morceaux.join('\n');
      const nom = `assets/_b/css/${sha8(fusion)}.css`;
      mkdirSync(dirname(join(OUT, nom)), { recursive: true });
      writeFileSync(join(OUT, nom), fusion);
      // Remplacement de la première feuille, suppression des autres (entre elles, il n'y a que des feuilles).
      let t2 = texte;
      const debut = liens[premier].index;
      const fin = liens[dernier].index + liens[dernier][0].length;
      const bloc = t2.slice(debut, fin);
      const nouveau = bloc.replace(/<link\b[^>]*>/gi, (l, offset) => (offset === 0 ? `<link rel="stylesheet" href="/${nom}">` : ''));
      t2 = t2.slice(0, debut) + nouveau + t2.slice(fin);
      texte = t2;
      feuillesFusionnees += entre.length - 1;
    }
  }

  writeFileSync(join(OUT, rel), texte);
  pagesModifiees.push(rel);
}
dire(`Feuilles regroupées : ${feuillesFusionnees} lien(s) évité(s) · préchargements de modules retirés : ${lienSupprimes}, ajoutés : ${preloadsAjoutes}`);

// ---------- 6. Service worker : liste de précache et version ----------
const swSrc = readFileSync(join(SRC, 'sw.js'), 'utf8');
const bloc = swSrc.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!bloc) throw new Error('PRECACHE introuvable dans site/sw.js');
const ancienne = [...bloc[1].matchAll(/'(\/[^']+)'/g)].map((m) => m[1]);
const cibleUrls = new Set([...cibles].map((c) => '/' + relSrc(c)));
const classiquesSet = new Set(classiques);
const gardees = ancienne.filter((p) => {
  if (!/\.m?js$/.test(p)) return existsSync(join(OUT, p));
  return existsSync(join(SRC, p)) && (cibleUrls.has(p) || classiquesSet.has(p));
});
const regroupes = parcourir(join(OUT, 'assets', '_b')).map((f) => '/' + relative(OUT, f).split(sep).join('/'));
const liste = [...new Set([...gardees, ...regroupes])].sort();
const lignes = [];
for (let i = 0; i < liste.length; i += 4) lignes.push('  ' + liste.slice(i, i + 4).map((p) => `'${p}'`).join(', ') + ',');
const nouveauBloc = `const PRECACHE = [\n  // Généré par outils/build/construire.mjs : fichiers regroupés (assets/_b) et fichiers d'origine encore servis.\n${lignes.join('\n')}\n];`;
let swOut = swSrc.replace(bloc[0], () => nouveauBloc);
swOut = swOut.replace(/const CACHE_VERSION = 'v(\d+)';/, (_, n) => `const CACHE_VERSION = 'v${Number(n) + 1}';`);
writeFileSync(join(OUT, 'sw.js'), swOut);
dire(`Précache : ${ancienne.length} → ${liste.length} fichier(s) ; CACHE_VERSION incrémentée (copie publiée seulement)`);

// ---------- 7. Bilan ----------
const poids = (dossier, motif) => parcourir(dossier).filter((f) => motif.test(f)).reduce((s, f) => s + statSync(f).size, 0);
const nbFichiers = (dossier, motif) => parcourir(dossier).filter((f) => motif.test(f)).length;
dire(`Sortie : ${nbFichiers(OUT, /\.m?js$/)} fichiers JS (${tailleKo(poids(OUT, /\.m?js$/))}), ${nbFichiers(OUT, /\.css$/)} CSS (${tailleKo(poids(OUT, /\.css$/))}), ${pagesModifiees.length} pages`);
