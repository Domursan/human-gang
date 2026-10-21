// ===== Humane Gang — fonction edge « hg-push » : notifications Web Push des nouveaux messages =====
// Appelée par le trigger hg_msg_push (migration 025) via pg_net, après chaque message inséré dans hg_messages.
// Envoie une notification « Nouveau message » aux AUTRES membres de la conversation, qui ont un abonnement
// enregistré dans hg_push_subscriptions. Le texte ne contient ni le contenu du message, ni l'expéditeur
// quand la conversation est un Secret Santa (le nom affiché est alors « Secret Santa »).
// Sécurité : en-tête « x-cron-secret » égal au secret de hg_private (« cron_secret »), comme hg-cron et
// hg-birthdays. Sans ce secret, la fonction refuse tout (401). verify_jwt doit être false.
// Clés VAPID : publique dans hg_settings (« push_vapid_public », valeur JSON chaîne), privée dans hg_private
// (« push_vapid_private »). Jamais dans le dépôt. Secret facultatif : VAPID_SUBJECT (sinon SITE_URL).
// Abonnements expirés (404 / 410 du service push) : supprimés de hg_push_subscriptions.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { cronAuthorized } from '../_shared/cron-auth.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
const TTL_SECONDS = 24 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Clés VAPID : lues une seule fois par exécution. Null si l'une manque (la fonction ne peut alors rien envoyer). */
async function vapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  const [pub, priv] = await Promise.all([
    db.from('hg_settings').select('value').eq('key', 'push_vapid_public').maybeSingle(),
    db.from('hg_private').select('value').eq('key', 'push_vapid_private').maybeSingle(),
  ]);
  if (pub.error || priv.error) return null;
  const publicKey = typeof pub.data?.value === 'string' ? pub.data.value : '';
  const privateKey = priv.data?.value ? String(priv.data.value) : '';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  if (!(await cronAuthorized(req, db))) return json({ error: 'Non autorisé' }, 401);

  let body: { conversation_id?: string; message_id?: number | string; sender_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corps JSON invalide' }, 400);
  }
  const conv = String(body.conversation_id ?? '');
  const sender = body.sender_id ? String(body.sender_id) : null;
  if (!UUID.test(conv) || (sender && !UUID.test(sender))) return json({ error: 'Paramètres invalides' }, 400);

  const keys = await vapidKeys();
  if (!keys) return json({ sent: 0, reason: 'vapid_absent' });

  // Destinataires : les autres membres de la conversation.
  let membersQuery = db.from('hg_conversation_members').select('user_id').eq('conversation_id', conv);
  if (sender) membersQuery = membersQuery.neq('user_id', sender);
  const { data: members, error: membersErr } = await membersQuery;
  if (membersErr) return json({ error: 'Lecture des membres impossible' }, 500);
  const recipients = (members ?? []).map((m) => String(m.user_id));
  if (!recipients.length) return json({ sent: 0, reason: 'aucun_destinataire' });

  // Nom affiché : « Secret Santa » pour un Secret Santa, sinon le pseudo de l'expéditeur (conversation directe).
  const { data: conversation } = await db.from('hg_conversations').select('kind').eq('id', conv).maybeSingle();
  let name = 'Conversation';
  if (conversation?.kind === 'santa') {
    name = 'Secret Santa';
  } else if (sender) {
    const { data: profile } = await db.from('hg_profiles').select('pseudo').eq('id', sender).maybeSingle();
    if (profile?.pseudo) name = String(profile.pseudo);
  }

  const { data: subs, error: subsErr } = await db
    .from('hg_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', recipients);
  if (subsErr) return json({ error: 'Lecture des abonnements impossible' }, 500);
  if (!subs?.length) return json({ sent: 0, reason: 'aucun_abonnement' });

  const subject = Deno.env.get('VAPID_SUBJECT') || SITE;
  if (!subject) return json({ error: 'VAPID_SUBJECT ou SITE_URL requis' }, 500);
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  const payload = JSON.stringify({
    title: 'Nouveau message',
    body: name,
    conversation_id: conv,
    tag: `hg-conv-${conv}`,
  });

  let sent = 0, failed = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: TTL_SECONDS },
      );
      sent++;
    } catch (err) {
      const status = Number((err as { statusCode?: number })?.statusCode ?? 0);
      if (status === 404 || status === 410) {
        // Abonnement expiré ou révoqué par le navigateur : on le retire.
        const { error } = await db.from('hg_push_subscriptions').delete().eq('id', s.id);
        if (!error) removed++;
      } else {
        failed++;
        console.warn('[hg-push] envoi', status || 'erreur', String((err as Error)?.message ?? err).slice(0, 200));
      }
    }
  }));

  return json({ sent, failed, removed });
});
