// Applique les fichiers SQL de supabase/appliquer.txt pas encore notés dans supabase/appliquees.txt
// (lancé par .github/workflows/appliquer-sql.yml). API de gestion Supabase : POST /v1/projects/<ref>/database/query.
// Chaque fichier est envoyé en une seule requête (une transaction : tout ou rien). Résultat noté ligne par ligne :
// « <date> ok <chemin> » ou « <date> ERREUR <chemin> : <message> ». Un fichier en erreur peut être relancé en le retirant
// de appliquees.txt (ou en le corrigeant sous un autre nom).
import fs from 'node:fs';

const jeton = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.PROJECT_REF;
if (!jeton) { console.error('Secret SUPABASE_ACCESS_TOKEN manquant'); process.exit(1); }
const lire = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
const liste = lire('supabase/appliquer.txt').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const faits = new Set(lire('supabase/appliquees.txt').split('\n').filter((l) => / ok /.test(l)).map((l) => l.split(' ok ')[1]?.trim()));
let journal = lire('supabase/appliquees.txt');
for (const f of liste) {
  if (faits.has(f)) continue;
  if (!fs.existsSync(f)) { journal += `${new Date().toISOString()} ERREUR ${f} : fichier introuvable\n`; continue; }
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: fs.readFileSync(f, 'utf8') }),
  });
  const txt = await r.text();
  const ligne = r.ok ? `${new Date().toISOString()} ok ${f}` : `${new Date().toISOString()} ERREUR ${f} : ${txt.replace(/\s+/g, ' ').slice(0, 600)}`;
  console.log(ligne);
  journal += ligne + '\n';
  if (!r.ok) break; // les suivants dépendent souvent de celui-ci
}
fs.writeFileSync('supabase/appliquees.txt', journal);
