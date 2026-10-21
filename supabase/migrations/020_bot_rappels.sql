-- ===== Humane Gang — migration 020 : rappels du bot, anti-doublons, limites d'assistance =====
-- Idempotente : add column / create index « if not exists », update sans effet à la reprise.
-- À APPLIQUER AVANT de déployer hg-cron, hg-birthdays, hg-notify et hg-support.
-- Aucune nouvelle table : seulement des colonnes et des index. Les politiques RLS existantes s'appliquent.

-- ----- F1 : rappels de sortie IRL (opt-in) -----
alter table public.hg_profiles add column if not exists remind_irl boolean not null default false;
alter table public.hg_event_rsvps add column if not exists remind_24h_at timestamptz;
alter table public.hg_event_rsvps add column if not exists remind_2h_at timestamptz;
create index if not exists hg_events_starts_idx on public.hg_events(starts_at);

-- ----- F2 : rappel d'envoi de cadeau (Secret Santa) -----
alter table public.hg_ss_participants add column if not exists send_reminder_at timestamptz;

-- ----- F12 : alerte « carte souhaitée disponible » (opt-in) -----
alter table public.hg_profiles add column if not exists notify_card_wish boolean not null default false;
alter table public.hg_card_copies add column if not exists wish_notified_at timestamptz;
create index if not exists hg_card_wishlist_card_idx on public.hg_card_wishlist(card_id);

-- ----- S6 : annonce unique d'un exemplaire obtenu -----
alter table public.hg_card_copies add column if not exists announced_at timestamptz;

-- ----- C3 / C4 : anniversaires, un marquage par envoi (MP, annonce) au lieu d'un verrou unique -----
alter table public.hg_birthday_log add column if not exists dm_sent_at timestamptz;
alter table public.hg_birthday_log add column if not exists announce_sent_at timestamptz;
-- Reprise : les anniversaires déjà consommés avant cette migration sont considérés comme traités.
update public.hg_birthday_log
   set dm_sent_at = coalesce(dm_sent_at, sent_at),
       announce_sent_at = coalesce(announce_sent_at, sent_at)
 where dm_sent_at is null or announce_sent_at is null;

-- ----- S5 : limite par client pour l'assistance (empreinte HMAC de l'adresse IP, jamais l'IP en clair) -----
alter table public.hg_support add column if not exists client_hash text;
create index if not exists hg_support_client_hash_idx on public.hg_support(client_hash, created_at) where client_hash is not null;

-- ----- S4 : secret des fonctions planifiées, dans une table privée (aucune policy : service role et pg_cron seulement) -----
create table if not exists public.hg_private (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.hg_private enable row level security;
revoke all on public.hg_private from anon, authenticated;
-- La valeur est créée une fois, à la main (jamais dans le dépôt) :
--   insert into public.hg_private(key, value) values ('cron_secret', '<valeur aléatoire longue>') on conflict (key) do nothing;
-- Tâches pg_cron : l'en-tête lit la table au moment de l'appel.
--   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.hg_private where key = 'cron_secret'))
