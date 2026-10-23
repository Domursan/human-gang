// ===== Humane Gang — fonction edge « hg-archive » (idée A8) =====
// Rôle : donner à l'administrateur une année complète du gang en ZIP (Site › Archives, assets/js/admin-archive.js).
// verify_jwt = true. Le client Supabase agit avec le JWT de l'appelant : aucune clé de service.
// Entrée : POST { year, parts: ['moments'|'sorties'|'secret_santa'|'cartes'|'recap'], part: 1.. }.
// Sortie : application/zip (flux, mode « stocké ») ; en-tête X-Archive-Parts = nombre total de parties ; erreurs en JSON.
// Les données viennent de la RPC hg_archive_year (migration 093), réservée à l'admin et déjà filtrée (exclusions :
// messages privés, souhaits et messages du Secret Santa, e-mails, anniversaires, RSVP détaillés, contenus masqués).
// La partie 1 journalise l'export (hg_admin_log « archive_annuelle ») et contient index.html, donnees/*.json,
// LISEZ-MOI.txt, les images des moments et les premières sorties ; les parties suivantes, les sorties restantes.
// Plafond par partie : hg_settings.albums.max_mo (300 Mo par défaut), sorties entières.
// Dépendances : npm:fflate, npm:@supabase/supabase-js, ./lib.ts, ../_shared/discord.ts (CORS). Bucket hg-photos.
// Déploiement : supabase/functions/DEPLOY.md (comme hg-album). Exporte : rien (Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { Zip, ZipPassThrough } from 'npm:fflate@0.8.2';
import { CORS, jsonResponse } from '../_shared/discord.ts';
import { type Archive, type Photo, partition, photoName, momentImageName, indexHtml, readme, sortieDir } from './lib.ts';

const BUCKET = 'hg-photos';
const DEFAUT_MAX_MO = 300;
const PARTS = ['moments', 'sorties', 'secret_santa', 'cartes', 'recap'];
const json = (body: unknown, status = 200) => jsonResponse(body, status);
const enc = new TextEncoder();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Connexion requise' }, 401);

  let year = 0, part = 1, parts: string[] = PARTS;
  try {
    const b = await req.json();
    year = Number(b?.year);
    part = Number(b?.part ?? 1);
    if (Array.isArray(b?.parts)) parts = b.parts.filter((x: unknown) => typeof x === 'string' && PARTS.includes(x as string));
  } catch { return json({ error: 'Requête invalide' }, 400); }
  if (!Number.isInteger(year) || year < 2015 || year > new Date().getFullYear()) return json({ error: 'Année hors limites' }, 400);
  if (!Number.isInteger(part) || part < 1 || part > 50) return json({ error: 'Partie inconnue' }, 400);
  if (!parts.length) return json({ error: 'Choisis au moins une partie' }, 400);

  const apiKey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, apiKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: admErr } = await db.rpc('hg_is_admin');
  if (admErr) return json({ error: 'Vérification impossible' }, 500);
  if (!isAdmin) return json({ error: 'Réservé à l’administrateur' }, 403);

  // Données de l'année (filtrées en base) ; la partie 1 journalise l'export
  const { data, error } = await db.rpc('hg_archive_year', { p_year: year, p_parts: parts, p_log: part === 1 });
  if (error || !data) return json({ error: 'Lecture de l’année impossible' }, 500);
  const a = data as Archive;
  const sorties = a.sorties || [];

  // Plafond par partie
  let maxMo = DEFAUT_MAX_MO;
  try {
    const { data: s } = await db.from('hg_settings').select('value').eq('key', 'albums').maybeSingle();
    const v = Number((s?.value as Record<string, unknown> | undefined)?.max_mo);
    if (Number.isFinite(v) && v >= 1) maxMo = Math.min(1000, v);
  } catch { /* défaut */ }
  const maxBytes = maxMo * 1024 * 1024;

  // Tailles des photos (dossier par dossier), pour découper par sorties entières
  const sizes = new Map<string, number>();
  const allPaths = [...sorties.flatMap((s) => (s.photos || []).map((p) => p.path)), ...(a.moments || []).map((m) => m.image_path).filter(Boolean) as string[]];
  for (const folder of new Set(allPaths.map((p) => p.split('/').slice(0, -1).join('/')))) {
    const { data: files } = await db.storage.from(BUCKET).list(folder, { limit: 1000 });
    for (const f of files ?? []) { const n = Number(f.metadata?.size); if (Number.isFinite(n)) sizes.set(`${folder}/${f.name}`, n); }
  }
  const momentBytes = (a.moments || []).reduce((n, m) => n + (m.image_path ? sizes.get(m.image_path) ?? 0 : 0), 0);
  const plan = partition(sorties, (p: Photo) => sizes.get(p.path) ?? 0, maxBytes, momentBytes);
  const total = plan.length;
  if (part > total) return json({ error: 'Partie inconnue' }, 400);
  const partOf = new Map<string, number>();
  plan.forEach((ids, i) => ids.forEach((id) => partOf.set(id, i + 1)));

  // Fichiers de la partie demandée : textes d'abord, puis les images (téléchargées une à une)
  const texts: [string, string][] = [['LISEZ-MOI.txt', readme(year, part, total)]];
  const images: [string, string][] = [];
  if (part === 1) {
    texts.push(['index.html', indexHtml(a, partOf, total)]);
    texts.push(['donnees/annee.json', JSON.stringify(a, null, 2)]);
    if (a.recap) texts.push(['donnees/recap.json', JSON.stringify(a.recap, null, 2)]);
    for (const m of a.moments || []) if (m.image_path) images.push([momentImageName(m), m.image_path]);
  }
  for (const s of sorties) {
    if (partOf.get(s.id) !== part) continue;
    texts.push([`${sortieDir(s)}/sortie.json`, JSON.stringify({ ...s, photos: undefined, nb_photos: (s.photos || []).length }, null, 2)]);
    (s.photos || []).forEach((p, i) => images.push([photoName(s, i, p), p.path]));
  }

  let next = 0, written = 0;
  let zip: Zip;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      for (const [name, body] of texts) { const f = new ZipPassThrough(name); zip.add(f); f.push(enc.encode(body), true); }
    },
    async pull(controller) {
      if (next >= images.length) { zip.end(); return; }
      const [name, path] = images[next++];
      const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(path);
      if (dlErr || !blob) return; // photo illisible (supprimée entre-temps) : on passe à la suivante
      written += blob.size;
      if (written > maxBytes * 1.2) { controller.error(new Error('plafond de taille dépassé')); return; }
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(new Uint8Array(await blob.arrayBuffer()), true);
    },
    cancel() { /* le client a coupé */ },
  });

  const fname = total > 1 ? `humane-gang-${year}-partie-${part}-sur-${total}.zip` : `humane-gang-${year}.zip`;
  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
      'X-Archive-Parts': String(total),
      'Access-Control-Expose-Headers': 'X-Archive-Parts, Content-Disposition',
    },
  });
});
