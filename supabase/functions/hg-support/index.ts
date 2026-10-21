// ===== Humane Gang — fonction edge « hg-support » =====
// Reçoit une demande d'assistance (avec ou sans compte), l'enregistre dans hg_support
// puis prévient l'admin en MP Discord via le bot (si configuré). verify_jwt = false.
// Secrets : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (fournis), DISCORD_BOT_TOKEN, SITE_URL (facultatifs).
// Texte du MP : modèle « support_new » (hg_settings.bot_templates, défaut dans ../_shared/bot-templates.json).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { loadTemplates, renderTemplate, embedFrom } from '../_shared/templates.ts';
import { CORS, jsonResponse, sendDM } from '../_shared/discord.ts';

const json = (body: unknown, status = 200) => jsonResponse(body, status);

const SUBJECTS = [
  'Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre',
];
const MAX_PER_HOUR = 5;        // par compte ou par contact
const MAX_ANON_PER_HOUR = 30;  // garde-fou global pour les visiteurs sans compte

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '';
const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

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

  // Limite anti-abus : 5 demandes / heure par compte (ou par contact pour les visiteurs)
  const since = new Date(Date.now() - 3600_000).toISOString();
  let q = admin.from('hg_support').select('id', { count: 'exact', head: true }).gte('created_at', since);
  q = userId ? q.eq('user_id', userId) : q.is('user_id', null).ilike('contact', contact.replace(/[\\%_]/g, (c) => '\\' + c));
  const { count, error: countErr } = await q;
  if (countErr) return json({ error: 'Erreur serveur, réessaie plus tard.' }, 500);
  if ((count ?? 0) >= MAX_PER_HOUR) return json({ error: 'Trop de demandes envoyées. Réessaie dans une heure.' }, 429);
  if (!userId) {
    const { count: anon } = await admin.from('hg_support').select('id', { count: 'exact', head: true })
      .gte('created_at', since).is('user_id', null);
    if ((anon ?? 0) >= MAX_ANON_PER_HOUR) return json({ error: 'Trop de demandes en ce moment. Réessaie plus tard.' }, 429);
  }

  // Enregistrement
  const { data: row, error } = await admin.from('hg_support')
    .insert({ user_id: userId, pseudo, subject, message, contact: contact || null })
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
