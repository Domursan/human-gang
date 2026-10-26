// ===== Humane Gang — fonction edge « hg-nj-images » =====
// Rôle : alimenter les jeux du jour « devine » (migrations 137 et 139).
//   action 'charger' { jeu } : lit la réserve du dépôt (outils/nj/reserves/<fichier>.json, sur GitHub) et l'enregistre
//     en base (hg_nj_import_lot, par lots de 40). Les éléments déjà présents sont mis à jour (pas de doublon).
//   action 'images' { limite? } : prend un lot d'éléments sans image (hg_nj_images_a_faire), trouve l'image à sa source
//     (capture d'écran Steam, image principale d'un article Wikipédia, ou adresse directe), la télécharge, la dépose dans le
//     bucket public hg-nj sous un nom ALÉATOIRE (rien ne trahit la réponse) et note l'adresse (hg_nj_image_ok).
// Sécurité : en-tête x-cron-secret (pg_net, comme hg-cron) OU jeton d'un compte administrateur. verify_jwt = false.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), CRON_SECRET facultatif (sinon hg_private.cron_secret).
// Dépendances : npm:@supabase/supabase-js, ../_shared/cron-auth.ts.
// Exporte : rien (point d'entrée Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cronAuthorized } from '../_shared/cron-auth.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
/** Réponse JSON avec les en-têtes CORS. */
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
/** Réserves publiées dans le dépôt (branche main). */
const RESERVES = 'https://raw.githubusercontent.com/Domursan/human-gang/main/outils/nj/reserves/';
const FICHIERS: Record<string, string> = { jv: 'jv.json', pays: 'pays.json', plat: 'plats.json', pochette: 'pochettes.json', replique: 'repliques.json' };
const BUCKET = 'hg-nj';
const UA = 'HumaneGang/1.0 (+https://humane-gang.com; jeux du jour)';
/** Taille maximale d'une image téléchargée. */
const MAX_OCTETS = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Lecture JSON avec un délai maximal. */
async function json(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${r.status} sur ${new URL(url).hostname}`);
  return r.json();
}

/**
 * Adresse de l'image d'un élément selon sa source.
 * @param {Record<string, any>} s source { type: 'steam', nom, capture? } | { type: 'wiki', article, lang? } | { type: 'url', url }
 * @returns {Promise<string>} adresse de l'image à télécharger
 */
async function adresse(s: Record<string, any>): Promise<string> {
  if (s.type === 'url' && typeof s.url === 'string') return s.url;
  if (s.type === 'wiki') {
    const lang = /^[a-z]{2}$/.test(s.lang || '') ? s.lang : 'fr';
    const q = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail|name&pithumbsize=1280&titles=${encodeURIComponent(s.article)}`;
    const j = await json(q);
    const page: any = Object.values(j?.query?.pages || {})[0];
    const src = page?.thumbnail?.source;
    if (!src) throw new Error(`pas d'image pour l'article « ${s.article} » (${lang})`);
    if (/\.svg(\.png)?$/i.test(src) || /\.svg\//i.test(src)) throw new Error(`image dessinée (svg) pour « ${s.article} »`);
    return src;
  }
  if (s.type === 'steam') {
    let id = Number(s.appid) || 0;
    if (!id) {
      for (const cc of ['CH', 'US']) {
        const r = await json(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(s.nom)}&cc=${cc}&l=french`);
        const items: any[] = r?.items || [];
        const net = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
        const hit = items.find((i) => net(i.name) === net(s.nom)) || items[0];
        if (hit) { id = hit.id; break; }
      }
      if (!id) throw new Error(`jeu introuvable sur Steam : ${s.nom}`);
    }
    const d = await json(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=screenshots`);
    const caps: any[] = d?.[id]?.data?.screenshots || [];
    if (!caps.length) throw new Error(`pas de capture Steam pour ${s.nom} (${id})`);
    const c = caps[Math.min(Number(s.capture) || 0, caps.length - 1)];
    return c.path_full;
  }
  throw new Error('source inconnue');
}

/** Télécharge une image et la dépose dans le bucket sous un nom aléatoire ; renvoie son adresse publique. */
async function deposer(db: any, url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`téléchargement : ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  const ext = TYPES[type];
  if (!ext) throw new Error(`type refusé : ${type || 'inconnu'}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > MAX_OCTETS) throw new Error('image trop lourde');
  const nom = `${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(nom, buf, { contentType: type, upsert: false });
  if (error) throw new Error(`dépôt : ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(nom).data.publicUrl;
}

/** Vrai si l'appel vient de pg_net (secret) ou d'un compte administrateur. */
async function autorise(req: Request, db: any): Promise<boolean> {
  if (await cronAuthorized(req, db)) return true;
  const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jeton) return false;
  const { data } = await db.auth.getUser(jeton);
  if (!data?.user) return false;
  const { data: p } = await db.from('hg_profiles').select('is_admin').eq('id', data.user.id).maybeSingle();
  return !!p?.is_admin;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST seulement' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  if (!(await autorise(req, db))) return jsonResponse({ error: 'non autorisé' }, 401);
  const corps = await req.json().catch(() => ({}));
  try {
    if (corps.action === 'charger') {
      const f = FICHIERS[corps.jeu];
      if (!f) return jsonResponse({ error: 'jeu inconnu' }, 400);
      const liste: any[] = await json(`${RESERVES}${f}?t=${Date.now()}`);
      let n = 0;
      for (let i = 0; i < liste.length; i += 40) {
        const { data, error } = await db.rpc('hg_nj_import_lot', { p_jeu: corps.jeu, p_items: liste.slice(i, i + 40) });
        if (error) throw new Error(error.message);
        n += Number(data) || 0;
      }
      return jsonResponse({ ok: true, jeu: corps.jeu, charges: n });
    }
    if (corps.action === 'images') {
      const { data: lot, error } = await db.rpc('hg_nj_images_a_faire', { p_n: Math.min(Number(corps.limite) || 10, 20) });
      if (error) throw new Error(error.message);
      const res: any[] = [];
      for (const it of lot || []) {
        try {
          const url = await adresse(it.source || {});
          const pub = await deposer(db, url);
          await db.rpc('hg_nj_image_ok', { p_id: it.id, p_image: pub, p_erreur: null, p_media: null });
          res.push({ id: it.id, ok: true });
        } catch (e) {
          await db.rpc('hg_nj_image_ok', { p_id: it.id, p_image: null, p_erreur: String((e as Error)?.message || e), p_media: null });
          res.push({ id: it.id, ok: false, erreur: String((e as Error)?.message || e) });
        }
      }
      return jsonResponse({ ok: true, traites: res.length, reussis: res.filter((x) => x.ok).length, detail: res });
    }
    return jsonResponse({ error: 'action inconnue' }, 400);
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
