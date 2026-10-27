// ===== Humane Gang — fonction edge « hg-calendar » : abonnement d'agenda personnel (flux ICS) =====
// Rôle : GET /functions/v1/hg-calendar?t=<jeton> renvoie le calendrier du gang (60 jours passés, 365 à venir) au format
// text/calendar, pour Google Agenda, Calendrier (Apple), Outlook… Le jeton est personnel (hg_calendar_tokens, migration 087),
// régénérable par le membre sur pages/irl/calendrier.html : l'ancienne adresse cesse alors de fonctionner.
// Sécurité : lecture seule par la clé service (RPC hg_calendar_feed, refusée aux clients) ; jeton inconnu ou mal formé : 404 ;
// le flux ne contient ni lieu, ni participants ; il respecte les accès aux pages du membre. Cache 30 minutes.
// verify_jwt = false (les applications d'agenda n'envoient pas de JWT).
// Secrets : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (fournis), SITE_URL (facultatif : liens vers les pages).
// Dépendances : ./feed.ts. Exporte : rien (Deno.serve).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildFeed, type FeedItem } from './feed.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SITE = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');

/** Réponse texte brut avec un statut. */
const text = (body: string, status: number) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('Méthode non permise', 405);
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!/^[0-9a-f]{64}$/.test(token)) return text('Agenda introuvable', 404);
  const { data, error } = await db.rpc('hg_calendar_feed', { p_token: token });
  if (error) {
    console.error('[hg-calendar]', error.message);
    return text('Agenda indisponible pour le moment', 503);
  }
  if (!data) return text('Agenda introuvable (adresse régénérée ?)', 404);
  const body = buildFeed(data as FeedItem[], SITE);
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="humane-gang.ics"',
      'Cache-Control': 'private, max-age=1800',
      'X-Robots-Tag': 'noindex',
    },
  });
});
