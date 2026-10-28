// Contrôle des migrations SQL (supabase/migrations/) et de leur application (supabase/appliquer.txt). Trois volets :
// 1. Numéros : aucun numéro en double à partir de la 165 (les doublons antérieurs sont listés dans DOUBLONS_CONNUS).
// 2. Application : chaque migration numérotée 138 et plus figure dans supabase/appliquer.txt (une ligne commentée
//    par « # » compte : une migration relancée reste journalisée).
// 3. Fonctions internes : une fonction SECURITY DEFINER dont le nom suit la convention hg_<jeu>__… (hors
//    hg_plat__droits) créée par une migration doit être refermée par cette migration : par un appel à
//    hg_plat__droits() placé après sa création (préfixes hg_plat, hg_bj, hg_pk, hg_ct, hg_pi), par une refermeture en
//    boucle (« revoke all on function %s ») placée après elle, ou par une instruction « revoke … on function » qui la
//    nomme. Sans cela, PostgreSQL l'accorde à PUBLIC (donc à anon et authenticated) à sa création : c'est la faille S0.
//    Les dettes antérieures sont listées dans DETTES_CONNUES (fichier -> motifs), avec leur traitement.
//
// Lancer : node tests/controles/check-migrations.cjs   (ou via run-all.cjs et ci.yml « Vérifications »)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');
const APPLIQUER = path.join(ROOT, 'supabase', 'appliquer.txt');

/** Premier numéro à partir duquel un doublon est une erreur. */
const DEBUT_UNICITE = 165;
/** Premier numéro dont l'application doit être journalisée dans appliquer.txt. */
const DEBUT_APPLIQUEE = 138;
/** Doublons historiques (numéros antérieurs à 165), acceptés. */
const DOUBLONS_CONNUS = new Set(['018', '131', '134']);
/**
 * Fonctions internes non refermées dans leur propre migration, acceptées. Motifs par fichier : une fonction qui
 * correspond est signalée en « dette » et n'échoue pas. Elles sont refermées par la migration 165 (hg_plat__droits,
 * qui couvre hg_plat*, hg_bj__, hg_pk__, hg_ct__, hg_pi__) et la 166 (préfixes hg_bj/pk/ct/pi). Un motif qui ne
 * correspond plus à rien est signalé pour être retiré.
 */
const DETTES_CONNUES = {
  '143_plateaux_cartes.sql': [/^hg_plat__(poker|blackjack)_/, /^hg_(bj|pk|cartes)__/],
  '144_catan.sql': [/^hg_plat__catan_/, /^hg_ct__/],
  '145_pictionary.sql': [/^hg_plat__pictionary_/],
};

/** Préfixes de fonctions refermées par hg_plat__droits() (reprise de sa définition, migration 166). */
const COUVERT_PAR_DROITS = /^hg_(plat|bj|pk|ct|pi)(_|__)/;
const NOM_INTERNE = /^hg_[a-z0-9]+__[a-z0-9_]*$/;
const NOM_DROITS = 'hg_plat__droits';

const erreurs = [];
const avis = [];
const utilisees = new Set();

const fichiers = fs.readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const numero = (f) => f.slice(0, f.indexOf('_'));

// 1. Numéros en double.
const parNumero = new Map();
for (const f of fichiers) {
  const n = numero(f);
  parNumero.set(n, [...(parNumero.get(n) || []), f]);
}
for (const [n, liste] of parNumero) {
  if (liste.length < 2) continue;
  if (Number(n) < DEBUT_UNICITE) {
    if (!DOUBLONS_CONNUS.has(n)) erreurs.push(`numéro ${n} en double (${liste.join(', ')}) : absent de DOUBLONS_CONNUS`);
  } else {
    erreurs.push(`numéro ${n} en double : ${liste.join(', ')}`);
  }
}
for (const n of DOUBLONS_CONNUS) {
  if (!parNumero.has(n) || parNumero.get(n).length < 2) avis.push(`doublon ${n} : plus en double, à retirer de DOUBLONS_CONNUS`);
}

// 2. Migrations 138 et plus présentes dans appliquer.txt (lignes commentées comprises).
const applique = fs.readFileSync(APPLIQUER, 'utf8');
for (const f of fichiers) {
  if (Number(numero(f)) < DEBUT_APPLIQUEE) continue;
  if (!applique.includes(`supabase/migrations/${f}`)) erreurs.push(`${f} absente de supabase/appliquer.txt`);
}

// 3. Fonctions internes refermées par la migration qui les crée.
let horsControle = 0;
/** Noms de fonctions refermés par une migration antérieure : « create or replace » garde ces droits. */
const refermeesAvant = new Set();
for (const f of fichiers) {
  const texte = fs.readFileSync(path.join(DIR, f), 'utf8');
  // Commentaires SQL retirés pour ne pas compter une instruction citée dans un commentaire.
  const sql = texte.replace(/--[^\n]*/g, '');
  const creations = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(hg_[a-z0-9]+__[a-z0-9_]*)/gi)];
  if (!creations.length) continue;
  const revokes = [...sql.matchAll(/\brevoke\b[^;]*;/gi)].map((m) => m[0]);
  const appels = [...sql.matchAll(/(?:select|perform)\s+(?:public\.)?hg_plat__droits\s*\(/gi)].map((m) => m.index);
  // Refermeture en boucle sur pg_proc (« revoke all on function %s » dans un format), comme dans les migrations 119, 122, 123.
  const boucles = [...sql.matchAll(/revoke\s+all\s+on\s+function\s+%s/gi)].map((m) => m.index);
  for (const c of creations) {
    const nom = c[1].toLowerCase();
    if (!NOM_INTERNE.test(nom) || nom === NOM_DROITS) continue;
    // Seules les fonctions SECURITY DEFINER (droits du propriétaire) sont exigées ; les autres sont hors contrôle.
    const reste = sql.slice(c.index);
    const fin = reste.search(/\$\$|\bas\s+\$/i);
    const entete = reste.slice(0, fin > 0 ? fin : 400);
    if (!/security\s+definer/i.test(entete)) { horsControle++; continue; }
    const refermee = (COUVERT_PAR_DROITS.test(nom) && appels.some((i) => i > c.index))
      || boucles.some((i) => i > c.index)
      || revokes.some((r) => new RegExp(`\\b${nom}\\b`, 'i').test(r))
      || (/or\s+replace/i.test(c[0]) && refermeesAvant.has(nom));
    if (refermee) continue;
    const dette = (DETTES_CONNUES[f] || []).find((re) => re.test(nom));
    if (dette) { utilisees.add(f + ' ' + dette); horsControle++; continue; }
    erreurs.push(`${f} : fonction interne ${nom} (SECURITY DEFINER) créée sans hg_plat__droits() après elle, ni revoke … on function ni refermeture en boucle (accès PUBLIC par défaut)`);
  }
  for (const r of revokes) for (const m of r.matchAll(/\bhg_[a-z0-9]+__[a-z0-9_]*/gi)) refermeesAvant.add(m[0].toLowerCase());
}
for (const [f, motifs] of Object.entries(DETTES_CONNUES)) {
  if (!fichiers.includes(f)) avis.push(`dette ${f} : fichier absent, à retirer de DETTES_CONNUES`);
  for (const re of motifs) if (!utilisees.has(f + ' ' + re)) avis.push(`dette ${f} ${re} : plus utilisée, à retirer de DETTES_CONNUES`);
}

for (const a of avis) console.log('Note : ' + a);
for (const e of erreurs) console.log('ECHEC ' + e);
console.log(`\n${fichiers.length} migrations, ${horsControle} fonction(s) internes hors contrôle (dettes connues ou non SECURITY DEFINER), ${erreurs.length} ECHEC(S)`);
process.exitCode = erreurs.length ? 1 : 0;
