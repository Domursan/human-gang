// ===== Humane Gang — fonction edge « hg-support » =====
// Reçoit une demande d'assistance (avec ou sans compte), l'enregistre dans hg_support
// puis prévient l'admin en MP Discord via le bot (si configuré). verify_jwt = false.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatifs).
// Texte du MP : modèle « support_new » (hg_settings.bot_templates, défaut dans ../_shared/bot-templates.json).
// Limites par heure : 5 par compte ; pour un visiteur, 5 par contact et 5 par client (empreinte HMAC de l'adresse,
// colonne hg_support.client_hash) ; plafond global de 200 visiteurs (garde-fou seulement).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom } from '../_shared/templates.ts';
import { CORS, jsonResponse, sendDM } from '../_shared/discord.ts';

const json = (body: unknown, status = 200) => jsonResponse(body, status);

const SUBJECTS = [
  'Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre',
];
const MAX_PER_HOUR = 5;              // par compte, ou par contact pour les visiteurs
const MAX_ANON_CLIENT_PER_HOUR = 5;  // visiteurs : par client (empreinte de l'adresse), et non plus pour tous à la fois
const MAX_ANON_TOTAL_PER_HOUR = 200; // garde-fou global, seulement contre une attaque répartie sur beaucoup de clients

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '';
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Adresse du client : dernière adresse ajoutée par le relais (x-forwarded-for), sinon cf-connecting-ip. */
function clientIp(req: Request): string {
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] ?? req.headers.get('cf-connecting-ip')?.trim() ?? '';
}
/** Empreinte HMAC de l'adresse (clé = secret serveur) : l'adresse IP n'est jamais stockée en clair. */
async function clientHash(ip: string): Promise<string | null> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ip || !secret) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide' }, 400); }

  // Pot de miel : un robot remplit tous les champs. On répond « ok » sans rien enregistrer.
  if (clean(body.website, 200) !== '') return json({ ok: true });

  // Utilisateur connecté ? (le client envoie la clé publique si pas de session : ce n'est pas un JWT)
  let userId: string | null = null;
  let realPseudo: string | null = null;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.split('.').length === 3) {
    const { data } = await admin.auth.getUser(token);
    if (data?.user) {
      userId = data.user.id;
      const { data: prof } = await admin.from('hg_profiles').select('pseudo').eq('id', userId).maybeSingle();
      realPseudo = prof?.pseudo ?? null;
    }
  }

  // Validation
  const pseudo = realPseudo ?? clean(body.pseudo, 40);
  const subject = clean(body.subject, 80);
  const message = clean(body.message, 4000);
  const contact = clean(body.contact, 100);
  if (pseudo.length < 2) return json({ error: 'Pseudo manquant (2 caractères minimum).' }, 400);
  if (!SUBJECTS.includes(subject)) return json({ error: 'Sujet invalide.' }, 400);
  if (message.length < 10) return json({ error: 'Message trop court (10 caractères minimum).' }, 400);
  if (!userId && contact.length < 2) return json({ error: 'Indique ton pseudo Discord pour la réponse.' }, 400);

  // Limites anti-abus (sur l'heure qui vient de s'écouler)
  const since = new Date(Date.now() - 3600_000).toISOString();
  // deno-lint-ignore no-explicit-any
  const countSince = async (build: (q: any) => any): Promise<number> => {
    const { count, error: err } = await build(admin.from('hg_support').select('id', { count: 'exact', head: true }).gte('created_at', since));
    if (err) throw new Error(err.message);
    return count ?? 0;
  };
  // Membre connecté : 5 demandes / heure. Visiteur : 5 par contact et 5 par client (et un plafond global large).
  let hash: string | null = null;
  try {
    if (userId) {
      if (await countSince((q) => q.eq('user_id', userId)) >= MAX_PER_HOUR) return json({ error: 'Trop de demandes envoyées. Réessaie dans une heure.' }, 429);
    } else {
      if (await countSince((q) => q.is('user_id', null).ilike('contact', contact.replace(/[\\%_]/g, (c) => '\\' + c))) >= MAX_PER_HOUR) {
        return json({ error: 'Trop de demandes envoyées. Réessaie dans une heure.' }, 429);
      }
      hash = await clientHash(clientIp(req));
      if (hash && await countSince((q) => q.eq('client_hash', hash!)) >= MAX_ANON_CLIENT_PER_HOUR) {
        return json({ error: 'Trop de demandes depuis ta connexion. Réessaie dans une heure.' }, 429);
      }
      if (await countSince((q) => q.is('user_id', null)) >= MAX_ANON_TOTAL_PER_HOUR) {
        return json({ error: 'Trop de demandes en ce moment. Réessaie plus tard.' }, 429);
      }
    }
  } catch (e) {
    console.error('[hg-support] limite', e);
    return json({ error: 'Erreur serveur, réessaie plus tard.' }, 500);
  }

  // Enregistrement. Visiteur : client_hash (empreinte) ; membre connecté : pas d'empreinte, user_id suffit.
  const { data: row, error } = await admin.from('hg_support')
    .insert({ user_id: userId, pseudo, subject, message, contact: contact || null, client_hash: userId ? null : hash })
    .select('id').single();
  if (error) { console.error(error); return json({ error: 'Impossible d\'enregistrer la demande.' }, 500); }

  // MP Discord à l'admin (ne fait jamais échouer la demande)
  let discordSent = false;
  try {
    const { data: s } = await admin.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
    const bot = (s?.value ?? {}) as { admin_discord_id?: string | null; notify?: Record<string, boolean> };
    if (bot.notify?.support !== false && bot.admin_discord_id && Deno.env.get('DISCORD_BOT_TOKEN')) {
      const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
      const rendered = renderTemplate('support_new', {
        sujet: subject, message: truncate(message, 1500), pseudo: truncate(pseudo, 100),
        contact: truncate(contact || 'non précisé', 100), compte: userId ? 'Membre connecté' : 'Visiteur',
        lien: site ? `${site}/admin.html#assistance` : '',
      }, await loadTemplates(admin));
      await sendDM(bot.admin_discord_id, {
        content: 'Nouvelle demande d\'assistance',
        embeds: [{
          ...embedFrom(rendered),
          color: 0x9e3543,
          url: site ? `${site}/admin.html#assistance` : undefined,
          fields: [
            { name: 'Pseudo', value: truncate(pseudo, 100), inline: true },
            { name: 'Compte', value: userId ? 'Membre connecté' : 'Visiteur', inline: true },
            { name: 'Contact', value: truncate(contact || 'non précisé', 100), inline: true },
            ...(site ? [{ name: 'Traiter', value: `${site}/admin.html#assistance` }] : []),
          ],
          timestamp: new Date().toISOString(),
          footer: { text: 'Humane Gang · assistance' },
        }],
      });
      discordSent = true;
      await admin.from('hg_support').update({ discord_sent: true }).eq('id', row.id);
    }
  } catch (e) {
    console.error('[hg-support] Discord', e);
  }

  return json({ ok: true, id: row.id, discord_sent: discordSent });
});
