// Rapatrie dans le site les images de cartes stockées ailleurs (Deezer, Apple, stockage Supabase…)
// (lancé par .github/workflows/rapatrier-cartes.yml).
// Étape « telecharger » : lit en base les cartes (hg_cards) dont image_url n'est pas une adresse /assets/cartes/…, télécharge
// chaque image, la convertit en .webp (500 px de large au plus) dans site/assets/cartes/<série>/<numéro>.webp, et écrit
// outils/images/rapatriement.json (carte → ancienne et nouvelle adresse, échecs).
// Étape « basculer » (après la publication des fichiers) : met à jour image_url en base, seulement pour les cartes dont
// l'adresse n'a pas changé entre-temps. Les cartes sans image restent sans image.
// API de gestion Supabase (secret SUPABASE_ACCESS_TOKEN), comme outils/appliquer-sql.mjs.
import fs from 'node:fs';
import path from 'node:path';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(ICI, '../..');
const SORTIE = path.join(ICI, 'rapatriement.json');
const jeton = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.PROJECT_REF;
if (!jeton) { console.error('Secret SUPABASE_ACCESS_TOKEN manquant'); process.exit(1); }

/** Exécute une requête SQL en tant que propriétaire de la base et renvoie les lignes. */
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`SQL : ${r.status} ${txt.slice(0, 400)}`);
  return JSON.parse(txt);
}

/** Nom de dossier à partir du nom de la série : minuscules, sans accents ni ponctuation (« La ménagerie » → la-menagerie). */
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'serie';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function telecharger() {
  const { default: sharp } = await import('sharp');
  const cartes = await sql(`select c.id, c.number, c.image_url, s.name as serie
    from public.hg_cards c join public.hg_card_sets s on s.id = c.set_id
    where c.image_url is not null and c.image_url <> '' and c.image_url not like '/assets/cartes/%'
    order by s.name, c.number`);
  console.log(`${cartes.length} carte(s) à rapatrier`);
  const faits = [], echecs = [], memo = new Map();
  for (const c of cartes) {
    const dossier = slug(c.serie);
    const nom = c.number != null ? String(c.number).padStart(3, '0') : c.id;
    const rel = `assets/cartes/${dossier}/${nom}.webp`;
    const dest = path.join(RACINE, 'site', rel);
    try {
      let buf = memo.get(c.image_url);
      if (!buf) {
        const r = await fetch(c.image_url, { headers: { 'User-Agent': 'HumaneGangImport/1.0 (+https://humane-gang.com)' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = await sharp(Buffer.from(await r.arrayBuffer())).rotate()
          .resize({ width: 500, height: 500, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        memo.set(c.image_url, buf);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      faits.push({ id: c.id, avant: c.image_url, apres: `/${rel}` });
    } catch (e) {
      echecs.push({ id: c.id, serie: c.serie, numero: c.number, adresse: c.image_url, erreur: String(e.message || e) });
    }
  }
  fs.writeFileSync(SORTIE, JSON.stringify({ date: new Date().toISOString(), faits, echecs }, null, 2) + '\n');
  console.log(`${faits.length} image(s) rapatriée(s), ${echecs.length} échec(s)`);
  for (const e of echecs) console.log(`  échec : ${e.serie} n° ${e.numero} (${e.erreur}) ${e.adresse}`);
}

async function basculer() {
  const { faits = [] } = JSON.parse(fs.readFileSync(SORTIE, 'utf8'));
  if (!faits.length) { console.log('Rien à basculer.'); return; }
  const valeurs = faits.map((f) => `(${q(f.id)}::uuid, ${q(f.avant)}, ${q(f.apres)})`).join(',\n');
  const r = await sql(`with v(id, avant, apres) as (values ${valeurs})
    update public.hg_cards c set image_url = v.apres from v where c.id = v.id and c.image_url = v.avant returning c.id`);
  console.log(`${r.length} carte(s) pointent maintenant vers le site (sur ${faits.length}).`);
}

const etape = process.argv[2];
if (etape === 'telecharger') await telecharger();
else if (etape === 'basculer') await basculer();
else { console.error('Usage : node rapatrier-cartes.mjs telecharger|basculer'); process.exit(1); }
