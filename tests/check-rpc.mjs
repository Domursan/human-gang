// Vérifie que chaque table, vue ou fonction RPC appelée par le site existe dans la base de référence.
//
// Source des appels : `.rpc('nom'` et `.from('nom'` dans assets/js/**/*.js, les pages *.html et sw.js,
// ainsi que les fonctions edge supabase/functions/**/*.ts (Deno).
// Source des définitions : supabase/schema/schema_reel_2026-10-21b.sql (état réel de la base) et les
// migrations supabase/migrations/NNN_*.sql numérotées 020 et plus (postérieures au schéma).
// Les buckets de stockage (`storage.from('…')`) ne sont pas des tables : ils sont ignorés.
//
// Un appel non trouvé fait échouer le script, sauf s'il figure dans EXCEPTIONS ci-dessous.
// Les appels dont le nom n'est pas une chaîne littérale (ex. sb.from(table)) sont listés pour information.
//
// Lancer : node tests/check-rpc.mjs   (ou npm run test:rpc)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = path.join(ROOT, 'supabase/schema/schema_reel_2026-10-21b.sql');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const MIGRATION_MIN = 20;

/**
 * Exceptions : appels volontairement non vérifiables ici. Chaque entrée doit dire pourquoi.
 * Format : 'rpc:nom' ou 'from:nom'. Ne rien ajouter sans raison écrite.
 */
const EXCEPTIONS = {
  // 'rpc:hg_exemple': 'Définie hors dépôt (extension Supabase), donc absente du schéma',
};

const JS_DIRS = ['assets/js'];
const EXTRA_FILES = ['sw.js'];
const SCAN_DIRS = ['supabase/functions'];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'node_modules' && !ent.name.startsWith('.')) walk(full, exts, out); }
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(full);
  }
  return out;
}

// Nettoie le SQL : commentaires et chaînes ne doivent pas fausser la recherche.
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** Noms définis (tables, vues, fonctions) dans un texte SQL. */
function definedNames(sql) {
  const names = new Set();
  const re = /create\s+(?:or\s+replace\s+|materialized\s+)?(?:table|view|function)\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][\w]*)"?/gi;
  let m;
  while ((m = re.exec(sql))) names.add(m[1].toLowerCase());
  return names;
}

// ---- 1. Ce qui existe ----
const schemaSql = stripSqlComments(fs.readFileSync(SCHEMA, 'utf8'));
const known = definedNames(schemaSql);
const schemaCount = known.size;
const migrationFiles = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .filter((f) => Number(f.slice(0, 3)) >= MIGRATION_MIN).sort();
for (const f of migrationFiles) for (const n of definedNames(stripSqlComments(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')))) known.add(n);

// ---- 2. Ce qui est appelé ----
const files = [
  ...JS_DIRS.flatMap((d) => walk(path.join(ROOT, d), ['.js'])),
  ...EXTRA_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, f)),
  ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d), ['.ts'])),
];

const LITERAL = /(?<![\w$])([A-Za-z_$][\w$]*)\s*\.\s*(rpc|from)\s*\(\s*(['"`])([^'"`$]+)\3/g;
const DYNAMIC = /(?<![\w$])([A-Za-z_$][\w$]*)\s*\.\s*(rpc|from)\s*\(\s*(?!['"`])([^)\s]+)/g;
const IGNORE_OBJECTS = new Set(['storage', 'Array', 'Uint8Array', 'Object', 'Promise']);

const calls = new Map(); // 'rpc:nom' ou 'from:nom' -> [où…]
const dynamic = [];
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(LITERAL)) {
    const [, obj, kind, , name] = m;
    if (IGNORE_OBJECTS.has(obj) || (kind === 'from' && obj === 'storage')) continue;
    const key = `${kind}:${name}`;
    if (!calls.has(key)) calls.set(key, []);
    calls.get(key).push(`${rel}:${lineOf(text, m.index)}`);
  }
  for (const m of text.matchAll(DYNAMIC)) {
    const [whole, obj, kind] = m;
    if (IGNORE_OBJECTS.has(obj) || obj === 'storage' || /^['"`]/.test(whole.slice(whole.indexOf('(') + 1).trim())) continue;
    dynamic.push(`${rel}:${lineOf(text, m.index)} ${obj}.${kind}(…)`);
  }
}

// ---- 3. Comparaison ----
let missing = 0, unlisted = 0;
const rows = [...calls.entries()].sort(([a], [b]) => a.localeCompare(b));
for (const [key, where] of rows) {
  const name = key.split(':')[1];
  const exc = EXCEPTIONS[key];
  if (known.has(name.toLowerCase())) continue;
  if (exc) { console.log(`EXCEPTION ${key} (${exc}) : ${where[0]}`); continue; }
  missing++;
  console.log(`MANQUANT ${key} : ${where.join(', ')}`);
}
for (const k of Object.keys(EXCEPTIONS)) if (!calls.has(k)) { unlisted++; console.log(`EXCEPTION inutile (plus appelée, à retirer) : ${k}`); }

console.log(`\n${calls.size} noms appelés, ${known.size} définis (schéma : ${schemaCount}, migrations >= ${String(MIGRATION_MIN).padStart(3, '0')} : ${migrationFiles.length} fichiers).`);
if (dynamic.length) { console.log(`Appels à nom non littéral (non vérifiés) :`); for (const d of dynamic) console.log('  ' + d); }
const ok = missing === 0 && unlisted === 0;
console.log(ok ? 'OK : tous les appels existent.' : `ECHEC : ${missing} appel(s) manquant(s), ${unlisted} exception(s) inutile(s).`);
process.exitCode = ok ? 0 : 1;
