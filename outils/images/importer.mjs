// Importe des images du web dans le dépôt (lancé par .github/workflows/importer-images.yml).
// Entrée : a-importer.json = [{ dest, type, ... }] ; chaque entrée déjà présente sur le disque est sautée.
//   type 'steam' : { nom | appid, capture? (numéro, défaut 0) } → une capture d'écran Steam du jeu
//   type 'wiki'  : { article, langue? (défaut 'fr') } → image principale de l'article Wikipédia
//   type 'url'   : { url, brut? } → l'adresse telle quelle (brut : fichier copié sans conversion)
// Sortie : fichiers .webp (largeur max `largeur`, défaut 1024) + rapport.json (source réelle de chaque image, échecs).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(ICI, '../..');
const UA = 'HumaneGangImport/1.0 (+https://humane-gang.com)';
const liste = JSON.parse(fs.readFileSync(path.join(ICI, 'a-importer.json'), 'utf8'));
const rapportF = path.join(ICI, 'rapport.json');
const rapport = fs.existsSync(rapportF) ? JSON.parse(fs.readFileSync(rapportF, 'utf8')) : {};

async function json(u) {
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} sur ${u}`);
  return r.json();
}

async function source(e) {
  if (e.type === 'url') return e.url;
  if (e.type === 'wiki') {
    const j = await json(`https://${e.langue || 'fr'}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(e.article.replace(/ /g, '_'))}`);
    const s = j.originalimage?.source || j.thumbnail?.source;
    if (!s) throw new Error(`pas d'image pour l'article ${e.article}`);
    return s;
  }
  if (e.type === 'steam') {
    let id = e.appid;
    if (!id) {
      const s = await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(e.nom)}&cc=CH&l=french`);
      const exact = s.items?.find((i) => i.name.toLowerCase() === e.nom.toLowerCase()) || s.items?.[0];
      if (!exact) throw new Error(`jeu introuvable sur Steam : ${e.nom}`);
      id = exact.id;
    }
    const d = await json(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=screenshots`);
    const caps = d[id]?.data?.screenshots || [];
    const c = caps[e.capture || 0] || caps[0];
    if (!c) throw new Error(`pas de capture pour l'appid ${id}`);
    e.appid = id;
    return c.path_full;
  }
  throw new Error(`type inconnu : ${e.type}`);
}

let ok = 0, ko = 0;
for (const e of liste) {
  const dest = path.join(RACINE, e.dest);
  if (fs.existsSync(dest) && !e.forcer) continue;
  try {
    const u = await source(e);
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`${r.status} sur ${u}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (e.brut) fs.writeFileSync(dest, buf);
    else await sharp(buf).rotate().resize({ width: e.largeur || 1024, withoutEnlargement: true }).webp({ quality: 80 }).toFile(dest);
    rapport[e.dest] = { source: u, appid: e.appid, le: new Date().toISOString() };
    ok++;
    console.log('ok  ', e.dest, '←', u);
  } catch (err) {
    rapport[e.dest] = { erreur: String(err.message || err), le: new Date().toISOString() };
    ko++;
    console.log('ÉCHEC', e.dest, err.message || err);
  }
}
fs.writeFileSync(rapportF, JSON.stringify(rapport, null, 2) + '\n');
console.log(`${ok} importée(s), ${ko} échec(s)`);
