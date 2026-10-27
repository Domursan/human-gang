// ===== Humane Gang — fonction edge « hg-support » =====
// Rôle : recevoir le formulaire d'assistance du site (avec ou sans compte), l'enregistrer, puis prévenir l'admin.
// Reçoit une demande d'assistance (avec ou sans compte), l'enregistre dans hg_support
// puis prévient l'admin en MP Discord via le bot (si configuré). verify_jwt = false.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), 
// DISCORD_BOT_TOKEN, SITE_URL (facultatifs).
// Texte du MP : modèle « support_new » (hg_settings.bot_templates, défaut dans ../_shared/bot-templates.json).
// Réglages (hg_settings.support, lus ici avec repli sur les défauts de _shared/reglages.ts) : sujets, limites par heure
// (compte ; visiteur par contact et par client, empreinte HMAC de l'adresse dans hg_support.client_hash ; plafond global),
// longueurs du message et taille du MP envoyé à l'admin.
// Protection : un champ « website » caché pour les robots (pot de miel), et les limites ci-dessus contre le spam.
// Seul un compte qui a un profil (hg_profiles) est traité en membre ; un compte d'authentification sans profil
// (inscription sans code d'invitation) suit le chemin des visiteurs. Le plafond global des visiteurs ne bloque pas
// l'assistance : au-delà, les demandes sont enregistrées sans MP à l'admin ; refus seulement au-delà de
// HARD_CAP_FACTOR fois ce plafond. Le texte libre est mis dans le MP sans Markdown actif (pas de lien masqué).
// Pièces jointes (membres connectés seulement) : le client dépose ses fichiers dans son dossier du bucket privé
// « hg-support-files » puis envoie leurs chemins (files: [{path, name}], 3 au plus). La RPC hg_support_add (migration 078)
// crée la demande et ses pièces jointes dans une seule transaction, et vérifie chaque fichier (dossier, type, taille).
// Le MP Discord n'envoie jamais le fichier : il indique seulement le nombre de pièces jointes.
// Dépendances : ../_shared/templates.ts, ../_shared/discord.ts, ../_shared/reglages.ts ; tables hg_support,
//   hg_settings, hg_profiles.
// Exporte : rien (point d'entrée Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom, mdSafe } from '../_shared/templates.ts';
import { CORS, jsonResponse, sendDM } from '../_shared/discord.ts';
import { supportRules } from '../_shared/reglages.ts';

/** Réponse JSON avec les en-têtes CORS (raccourci vers jsonResponse). */
const json = (body: unknown, status = 200) => jsonResponse(body, status);

// Client avec la clé service role : l'écriture dans hg_support se fait sans RLS.
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Nettoie une valeur texte venue du client : chaîne seulement, sans caractère NUL, sans espaces autour, longueur bornée.
 * @param {unknown} v Valeur brute.
 * @param {number} max Longueur maximale.
 * @returns {string} Texte nettoyé, ou '' si ce n'est pas une chaîne.
 */
const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '';
/**
 * Coupe un texte à `n` caractères, avec « … » si on a coupé (pour le MP Discord).
 * @param {string} s Texte.
 * @param {number} n Longueur maximale.
 * @returns {string} Texte coupé ou inchangé.
 */
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Au-delà de visiteurs_total_par_heure × HARD_CAP_FACTOR demandes de visiteurs dans l'heure, refus (protection du stockage). */
const HARD_CAP_FACTOR = 5;

/**
 * Adresse du client. Sur Supabase, la requête passe par Cloudflare puis par la passerelle :
 * - cf-connecting-ip est posé par Cloudflare (une valeur envoyée par le client est remplacée) : il est préféré ;
 * - sinon la PREMIÈRE entrée de x-forwarded-for, adresse du client vue par le premier relais (exemple officiel de
 *   Supabase pour les fonctions edge). Les dernières entrées sont celles de l'infrastructure : avec elles, tous
 *   les visiteurs auraient la même empreinte.
 * @param {Request} req Requête entrante.
 * @returns {string} Adresse IP, ou '' si introuvable.
 */
function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff[0] ?? '';
}
let HASH_KEY: string | null = null;
/** Clé d'empreinte, lue une fois dans le coffre puis gardée en mémoire. */
async function hashKey(): Promise<string | null> {
  if (HASH_KEY) return HASH_KEY;
  const { data, error } = await admin.rpc('hg_support_hash_key');
  if (error || !data) { console.warn('[hg-support] clé d’empreinte indisponible', error?.message); return null; }
  HASH_KEY = String(data);
  return HASH_KEY;
}
/**
 * Empreinte HMAC de l'adresse : l'adresse IP n'est jamais stockée en clair. La clé est dédiée (coffre chiffré de la base,
 * lue par hg_support_hash_key, migration 110) : on ne réutilise plus la clé de service.
 * Renvoie les 16 premiers octets en hexadécimal (32 caractères).
 * @param {string} ip Adresse du client.
 * @returns {Promise<string | null>} Empreinte, ou null si pas d'adresse ou pas de secret.
 */
async function clientHash(ip: string): Promise<string | null> {
  if (!ip) return null;
  const secret = await hashKey();
  if (!secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Point d'entrée : valide la demande, applique les limites anti-abus, enregistre, puis prévient l'admin sur Discord.
 * L'échec de l'envoi Discord ne fait jamais échouer la demande : elle est déjà enregistrée.
 * @param {Request} req Requête POST avec le corps JSON du formulaire.
 * @returns {Promise<Response>} { ok, id, discord_sent } ou une erreur JSON.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }

  // Réglages : une lecture en échec donne les défauts (même comportement qu'avant les réglages)
  let rules: ReturnType<typeof supportRules>;
  try {
    const { data: st } = await admin.from('hg_settings').select('value').eq('key', 'support').maybeSingle();
    rules = supportRules(st?.value);
  } catch (e) {
    console.error('[hg-support] réglages', e);
    rules = supportRules(null);
  }

  // Pot de miel : un robot remplit tous les champs. On répond « ok » sans rien enregistrer.
  if (clean(body.website, 200) !== '') return json({ ok: true });

  // Utilisateur connecté ? (le client envoie la clé publique si pas de session : ce n'est pas un JWT)
  // Un vrai JWT a trois segments séparés par des points ; la clé publique n'en a qu'un.
  let userId: string | null = null;
  let realPseudo: string | null = null;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.split('.').length === 3) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) {
      const { data: prof } = await admin.from('hg_profiles').select('pseudo').eq('id', data.user.id).maybeSingle();
      // Membre seulement s'il a un profil : un compte sans profil est un visiteur (contact et plafonds des visiteurs).
      if (prof?.pseudo) { userId = data.user.id; realPseudo = prof.pseudo; }
    }
  }

  // Validation
  // Pour un membre connecté, le pseudo du profil prime sur celui du formulaire.
  const pseudo = realPseudo ?? clean(body.pseudo, 40);
  const subject = clean(body.subject, 80);
  const message = clean(body.message, rules.message_max);
  const contact = clean(body.contact, 100);
  // Pièces jointes : tableau de { path, name } (3 au plus). Le contrôle fin (dossier, type, taille) est fait en base.
  const rawFiles = Array.isArray(body.files) ? body.files.slice(0, 4) : [];
  const files = rawFiles.filter((f) => f && typeof f === 'object').map((f) => ({
    path: clean((f as Record<string, unknown>).path, 300),
    name: clean((f as Record<string, unknown>).name, 120),
  }));
  if (Array.isArray(body.files) && body.files.length > 3) return json({ error: 'Trois pièces jointes au maximum.' }, 400);
  if (files.length && !userId) return json({ error: 'Les pièces jointes sont réservées aux membres connectés.' }, 400);
  if (files.some((f) => !f.path)) return json({ error: 'Pièce jointe invalide.' }, 400);
  if (pseudo.length < 2) return json({ error: 'Pseudo manquant (2 caractères minimum).' }, 400);
  if (!rules.sujets.includes(subject)) return json({ error: 'Sujet invalide.' }, 400);
  if (message.length < rules.message_min) return json({ error: `Message trop court (${rules.message_min} caractères minimum).` }, 400);
  // Un visiteur doit laisser un moyen de le recontacter sur Discord.
  if (!userId && contact.length < 2) return json({ error: 'Indique ton pseudo Discord pour la réponse.' }, 400);

  // Limites anti-abus (sur l'heure qui vient de s'écouler)
  const since = new Date(Date.now() - 3600_000).toISOString();
  /**
   * Compte les demandes depuis une heure selon un filtre donné.
   * @param {(q: any) => any} build Ajoute les filtres à la requête de comptage.
   * @returns {Promise<number>} Nombre de demandes.
   * @throws {Error} Si le comptage échoue.
   */
  // deno-lint-ignore no-explicit-any
  const countSince = async (build: (q: any) => any): Promise<number> => {
    const { count, error: err } = await build(admin.from('hg_support').select('id', { count: 'exact', head: true }).gte('created_at', since));
    if (err) throw new Error(err.message);
    return count ?? 0;
  };
  // Membre connecté : 5 demandes / heure. Visiteur : 5 par contact et 5 par client ; au-delà du plafond global,
  // enregistrée sans MP (quiet), refus seulement au-delà de HARD_CAP_FACTOR fois ce plafond.
  let hash: string | null = null;
  let quiet = false;
  try {
    if (userId) {
      if (await countSince((q) => q.eq('user_id', userId)) >= rules.max_par_heure) return json({ error: 'Trop de demandes envoyées. Réessaie dans une heure.' }, 429);
    } else {
      // Le contact est recherché sans tenir compte de la casse ; les caractères jokers sont échappés.
      if (await countSince((q) => q.is('user_id', null).ilike('contact', contact.replace(/[\\%_]/g, (c) => '\\' + c))) >= rules.max_par_heure) {
        return json({ error: 'Trop de demandes envoyées. Réessaie dans une heure.' }, 429);
      }
      hash = await clientHash(clientIp(req));
      if (hash && await countSince((q) => q.eq('client_hash', hash!)) >= rules.visiteur_max_par_heure) {
        return json({ error: 'Trop de demandes depuis ta connexion. Réessaie dans une heure.' }, 429);
      }
      const visiteurs = await countSince((q) => q.is('user_id', null));
      if (visiteurs >= rules.visiteurs_total_par_heure * HARD_CAP_FACTOR) {
        return json({ error: 'Trop de demandes en ce moment. Réessaie plus tard.' }, 429);
      }
      quiet = visiteurs >= rules.visiteurs_total_par_heure;
    }
  } catch (e) {
    console.error('[hg-support] limite', e);
    return json({ error: 'Erreur serveur, réessaie plus tard.' }, 500);
  }

  // Enregistrement (demande et pièces jointes, une seule transaction). Visiteur : client_hash (empreinte) ;
  // membre connecté : pas d'empreinte, user_id suffit. Une erreur de la RPC est un refus (message en français).
  const { data: rowId, error } = await admin.rpc('hg_support_add', {
    p_user: userId, p_pseudo: pseudo, p_subject: subject, p_message: message,
    p_contact: contact || null, p_client_hash: userId ? null : hash, p_files: files,
  });
  if (error) {
    console.error('[hg-support] enregistrement', error);
    const refus = /pièce|Pièce|membres connectés|Trois/.test(error.message ?? '');
    return refus ? json({ error: error.message }, 400) : json({ error: 'Impossible d\'enregistrer la demande.' }, 500);
  }
  const requestId = rowId as string;

  // MP Discord à l'admin (ne fait jamais échouer la demande)
  let discordSent = false;
  try {
    const { data: s } = await admin.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const bot = (s?.value ?? {}) as { admin_discord_id?: string | null; notify?: Record<string, boolean> };
    // Le MP part seulement si l'admin a un ID Discord, si le bot a un jeton et si l'option n'est pas désactivée.
    // Pas de MP au-delà du plafond global des visiteurs (quiet) : la demande reste visible dans l'admin.
    if (!quiet && bot.notify?.support !== false && bot.admin_discord_id && Deno.env.get('DISCORD_BOT_TOKEN')) {
      const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
      // Texte libre (visiteur anonyme compris) : Markdown neutralisé, pas de lien masqué cliquable.
      const mdPseudo = mdSafe(truncate(pseudo, 100)), mdContact = mdSafe(truncate(contact || 'non précisé', 100));
      const rendered = renderTemplate('support_new', {
        sujet: subject, message: mdSafe(truncate(message, rules.mp_max)), pseudo: mdPseudo,
        contact: mdContact, compte: userId ? 'Membre connecté' : 'Visiteur',
        lien: site ? `${site}/pages/admin/admin.html#assistance` : '',
      }, await loadTemplates(admin));
      await sendDM(bot.admin_discord_id, {
        content: 'Nouvelle demande d\'assistance',
        embeds: [{
          ...embedFrom(rendered),
          color: 0x9e3543,
          url: site ? `${site}/pages/admin/admin.html#assistance` : undefined,
          fields: [
            { name: 'Pseudo', value: mdPseudo, inline: true },
            { name: 'Compte', value: userId ? 'Membre connecté' : 'Visiteur', inline: true },
            { name: 'Contact', value: mdContact, inline: true },
            ...(files.length ? [{ name: 'Pièces jointes', value: files.length === 1 ? '1 pièce jointe' : `${files.length} pièces jointes`, inline: true }] : []),
            ...(site ? [{ name: 'Traiter', value: `${site}/pages/admin/admin.html#assistance` }] : []),
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'Humane Gang · assistance' },
        }],
      });
      discordSent = true;
      // Marque la demande comme signalée à l'admin (affichage dans l'espace admin).
      await admin.from('hg_support').update({ discord_sent: true }).eq('id', requestId);
    }
  } catch (e) {
    console.error('[hg-support] Discord', e);
  }

  return json({ ok: true, id: requestId, discord_sent: discordSent });
});
