// ===== Humane Gang — fonction edge « hg-album » =====
// Rôle : donner à un membre un ZIP de toutes les photos d'une sortie. Appelée par downloadAlbum (assets/js/photos.js).
// Assemble en ZIP, en flux, les photos d'une sortie (bucket privé hg-photos).
// verify_jwt = true. Le client Supabase agit avec le JWT de l'appelant : la RLS s'applique
// (lecture des photos, des sorties et du stockage réservée aux membres). Aucun secret, aucune clé de service.
// Entrée : POST { event_id: uuid }. Sortie : application/zip (flux) ; erreurs en JSON { error }.
// Plafonds par défaut : 400 photos et 300 Mo par ZIP (réglables : hg_settings.albums). La taille est lue dans le stockage avant l'envoi ;
// si elle est illisible, le plafond est vérifié au fil de l'envoi (le flux est alors interrompu).
// Le ZIP est en mode « stocké » (sans compression) : les images sont déjà compressées.
// Dépendances : npm:fflate (ZIP en flux), npm:@supabase/supabase-js. Tables : hg_events, hg_photos, hg_settings ;
//   fonction SQL hg_is_member() ; bucket de stockage hg-photos.
// Exporte : rien (point d'entrée Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { Zip, ZipPassThrough } from 'npm:fflate@0.8.2';
import { CORS, jsonResponse } from '../_shared/discord.ts';

/** Bucket privé qui contient les photos des sorties. */
const BUCKET = 'hg-photos';
// Plafonds par défaut : lus dans hg_settings.albums (clés max_photos, max_mo) quand elles existent.
const DEFAUT_MAX_PHOTOS = 400;
const DEFAUT_MAX_MO = 300;
/** Identifiant de sortie attendu : un UUID. Toute autre valeur est refusée avant toute requête. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Plafonds du ZIP (hg_settings.albums) avec repli sur les défauts ; une lecture en échec garde les défauts.
 * @param {ReturnType<typeof createClient>} db Client Supabase de l'appelant (RLS active).
 * @returns {Promise<{maxPhotos: number, maxBytes: number}>} Nombre maximal de photos et taille maximale en octets.
 */
async function lireLimites(db: ReturnType<typeof createClient>): Promise<{ maxPhotos: number; maxBytes: number }> {
  let maxPhotos = DEFAUT_MAX_PHOTOS, maxMo = DEFAUT_MAX_MO;
  try {
    const { data } = await db.from('hg_settings').select('value').eq('key', 'albums').maybeSingle();
    const v = (data?.value ?? {}) as Record<string, unknown>;
    if (typeof v.max_photos === 'number' && Number.isFinite(v.max_photos) && v.max_photos >= 1) maxPhotos = Math.floor(v.max_photos);
    if (typeof v.max_mo === 'number' && Number.isFinite(v.max_mo) && v.max_mo >= 1) maxMo = v.max_mo;
  } catch (_e) { /* repli */ }
  return { maxPhotos, maxBytes: maxMo * 1024 * 1024 };
}

/**
 * Réponse JSON d'erreur ou de succès (en-têtes CORS inclus).
 * @param {unknown} body Contenu JSON.
 * @param {number} [status] Code HTTP (200 par défaut).
 * @returns {Response} La réponse prête à renvoyer.
 */
const json = (body: unknown, status = 200) => jsonResponse(body, status);

/**
 * Transforme un titre en nom de fichier simple : sans accents, sans espaces, en minuscules, 60 caractères au plus.
 * @param {string} s Titre de la sortie.
 * @returns {string} Nom sûr pour Content-Disposition (« sortie » si rien ne reste).
 */
const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'sortie';

/**
 * Point d'entrée : vérifie l'appelant (membre), contrôle la taille de l'album, puis renvoie le ZIP en flux.
 * Les photos sont lues une à une dans l'ordre chronologique pour ne pas tout charger en mémoire.
 * @param {Request} req Requête POST avec l'en-tête Authorization et le corps { event_id }.
 * @returns {Promise<Response>} Le ZIP en flux, ou une erreur JSON.
 */
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
  // Le JWT de l'appelant est transmis : c'est la RLS qui décide ce qu'il peut lire.
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
  const { maxPhotos, maxBytes } = await lireLimites(db);
  if (paths.length > maxPhotos) {
    return json({ error: `Trop de photos (${paths.length}, maximum ${maxPhotos}). Télécharge les photos par lots.` }, 413);
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
  // Contrôle global avant l'envoi : si la taille connue dépasse le plafond, on refuse sans rien streamer.
  const knownTotal = paths.reduce((sum: number, p: string) => sum + (sizes.get(p) ?? 0), 0);
  if (knownTotal > maxBytes) {
    return json({ error: `Album trop lourd pour un seul ZIP (maximum ${Math.round(maxBytes / 1048576)} Mo). Télécharge les photos par lots.` }, 413);
  }

  // Flux ZIP : une photo à la fois, dans l'ordre chronologique
  let next = 0;
  let written = 0;
  let zip: Zip;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Chaque morceau produit par fflate part dans le flux ; la fin du ZIP ferme le flux.
      zip = new Zip((err, chunk, final) => {
        if (err) { controller.error(err); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull(controller) {
      // Appelée par le flux quand il attend des données : on ajoute la photo suivante, ou on termine le ZIP.
      if (next >= paths.length) { zip.end(); return; }
      const index = next++;
      const path: string = paths[index];
      const { data: blob, error } = await db.storage.from(BUCKET).download(path);
      if (error || !blob) { controller.error(new Error(`photo ${index + 1} illisible`)); return; }
      // Second contrôle de taille, sur le contenu réel (la taille du stockage peut avoir été inconnue).
      written += blob.size;
      if (written > maxBytes) { controller.error(new Error('plafond de taille dépassé')); return; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Numéro en tête du nom pour garder l'ordre chronologique dans le ZIP.
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
