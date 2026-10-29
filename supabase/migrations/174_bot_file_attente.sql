-- ===== Humane Gang — migration 174 : liste d'attente des annonces du bot =====
-- Quand plusieurs belles cartes sortent en même temps, Discord refuse une partie des annonces (« trop de requêtes »).
-- Les annonces refusées sont maintenant mises en attente ici par hg-notify, puis envoyées une par une, espacées, par
-- hg-cron (toutes les 5 minutes). Clé service seulement (aucun accès depuis le site). Rejouable.

create table if not exists public.hg_bot_file (
  id bigint generated always as identity primary key,
  kind text not null,                         -- ex. « carte »
  channel_id text not null,                   -- salon Discord
  message jsonb not null,                     -- message Discord prêt à envoyer
  titre text,                                 -- pour l'historique du bot
  created_at timestamptz not null default now(),
  essais int not null default 0,
  pris_at timestamptz,                        -- réservation par un passage de hg-cron
  sent_at timestamptz,
  error text
);
create index if not exists hg_bot_file_attente on public.hg_bot_file (created_at) where sent_at is null;
alter table public.hg_bot_file enable row level security;
revoke all on public.hg_bot_file from anon, authenticated;
