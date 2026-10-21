// ===== Humane Gang — fonction edge « hg-album » =====
// Assemble en ZIP, en flux, les photos d'une sortie (bucket privé hg-photos).
// verify_jwt = true. Le client Supabase agit avec le JWT de l'appelant : la RLS s'applique
// (lecture des photos, des sorties et du stockage réservée aux membres). Aucun secret, aucune clé de service.
// Entrée : POST { event_id: uuid }. Sortie : application/zip (flux) ; erreurs en JSON { error }.
// Plafonds : 400 photos et 300 Mo par ZIP. La taille est lue dans le stockage avant l'envoi ;
// si elle est illisible, le plafond est vérifié au fil de l'envoi (le flux est alors interrompu).
// Le ZIP est en mode « stocké » (sans compression) : les images sont déjà compressées.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { Zip, ZipPassThrough } from 'npm:fflate@0.8.2';

const BUCKET = 'hg-photos';
const MAX_PHOTOS = 400;
const MAX_BYTES = 300 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'sortie';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Connexion requise' }, 401);

  let eventId = '';
  try {
    const body = await req.json();
    eventId = String(body?.event_id ?? '');
  } catch {
    return json({ error: 'Requête invalide' }, 400);
  }
  if (!UUID_RE.test(eventId)) return json({ error: 'Sortie inconnue' }, 400);

  // Clé publique : celle envoyée par le site (apikey), sinon celle de l'environnement. Jamais de clé de service.
  const apiKey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, apiKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isMember, error: memberErr } = await db.rpc('hg_is_member');
  if (memberErr) return json({ error: 'Vérification impossible' }, 500);
  if (!isMember) return json({ error: 'Réservé aux membres' }, 403);

  const { data: ev, error: evErr } = await db.from('hg_events').select('id,title').eq('id', eventId).maybeSingle();
  if (evErr) return json({ error: 'Lecture de la sortie impossible' }, 500);
  if (!ev) return json({ error: 'Sortie introuvable' }, 404);

  const { data: rows, error: photoErr } = await db.from('hg_photos')
    .select('path').eq('event_id', eventId).order('created_at', { ascending: true });
  if (photoErr) return json({ error: 'Lecture des photos impossible' }, 500);
  const paths = (rows ?? []).map((r: { path: string }) => r.path).filter(Boolean);
  if (!paths.length) return json({ error: 'Cet album ne contient aucune photo' }, 404);
  if (paths.length > MAX_PHOTOS) {
    return json({ error: `Trop de photos (${paths.length}, maximum ${MAX_PHOTOS}). Télécharge les photos par lots.` }, 413);
  }

  // Tailles lues dans le stockage, dossier par dossier (un dossier par ajouteur)
  const sizes = new Map<string, number>();
  const folders = [...new Set(paths.map((p: string) => p.split('/').slice(0, -1).join('/')))];
  for (const folder of folders) {
    const { data: files } = await db.storage.from(BUCKET).list(folder, { limit: 1000 });
    for (const f of files ?? []) {
      const size = Number(f.metadata?.size);
      if (Number.isFinite(size)) sizes.set(`${folder}/${f.name}`, size);
    }
  }
  const knownTotal = paths.reduce((sum: number, p: string) => sum + (sizes.get(p) ?? 0), 0);
  if (knownTotal > MAX_BYTES) {
    return json({ error: "Album trop lourd pour un seul ZIP (maximum 300 Mo). Télécharge les photos par lots." }, 413);
  }

  // Flux ZIP : une photo à la fois, dans l'ordre chronologique
  let next = 0;
  let written = 0;
  let zip: Zip;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull(controller) {
      if (next >= paths.length) { zip.end(); return; }
      const index = next++;
      const path: string = paths[index];
      const { data: blob, error } = await db.storage.from(BUCKET).download(path);
      if (error || !blob) { controller.error(new Error(`photo ${index + 1} illisible`)); return; }
      written += blob.size;
      if (written > MAX_BYTES) { controller.error(new Error('plafond de 300 Mo dépassé')); return; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const name = `${String(index + 1).padStart(3, '0')}-${path.split('/').pop()}`;
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(bytes, true);
    },
    cancel() { /* le client a coupé : rien à libérer */ },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="album-${slugify(String(ev.title))}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
