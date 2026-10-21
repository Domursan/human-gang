-- =====================================================================
-- Schéma reconstitué du schéma `public` — Humane Gang
-- Projet Supabase : zqbdzokyhgavgmqgiwuw
-- Produit le 2026-10-21 par lecture seule à partir des catalogues Postgres :
--   - tables et colonnes : pg_class, pg_attribute, pg_attrdef (format_type, pg_get_expr)
--   - contraintes : pg_constraint (pg_get_constraintdef)
--   - index : pg_indexes (hors index portés par une contrainte)
--   - RLS : pg_class.relrowsecurity ; politiques : pg_policies
--   - fonctions : pg_proc (pg_get_functiondef), triggers : pg_trigger (pg_get_triggerdef)
--   - publication : pg_publication_tables (supabase_realtime)
--   - tâches planifiées : cron.job (jobname, schedule ; commandes masquées)
-- Aucune écriture en base. Aucune ligne de donnée. Aucune valeur de secret,
-- de clé ou de hg_private : la table hg_private n'apparaît que par sa structure.
-- Les commandes pg_cron sont remplacées par <commande masquée> (elles peuvent
-- contenir des secrets ou des en-têtes d'autorisation).
-- L'UUID du propriétaire des tables d_* (policies « owner_lock ») est remplacé
-- par 00000000-0000-0000-0000-000000000000 : à remplacer hors dépôt avant rejeu.
-- Ce fichier ne remplace pas les migrations : il décrit l'état réel à date.
-- Périmètre : schéma public uniquement. Les politiques du schéma storage
-- (buckets hg-photos, hg-avatars…) ne sont pas incluses : à relever dans le
-- tableau de bord Storage ou par une requête dédiée.
-- Point d'attention signalé, non corrigé ici : la table public.hg_backup_027
-- (copie de sauvegarde de la migration 027) est toujours présente en base.
-- Ordre de rejeu sur une base vierge : extensions, séquence, tables, contraintes
-- (PK/UNIQUE/CHECK puis FK), index, fonctions, triggers, policies, publication,
-- tâches cron. Les fonctions précèdent les triggers et les policies qui les appellent.
-- Ancien dump (périmé) : supabase/schema/schema_reel_2026-10-21.sql
-- =====================================================================

-- 1. Extensions utilisées
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_stat_statements;
create extension if not exists supabase_vault;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 2. Séquences hors identité
create sequence if not exists public.hg_member_number_seq start 1 increment 1;

-- 3. Tables (colonnes, types, défauts, identités, NOT NULL)

create table if not exists public.d_bugs (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  title text not null,
  kind text default 'Bug'::text not null,
  status text,
  priority text,
  version text,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_bugs enable row level security;

create table if not exists public.d_changelog (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  version text,
  date date default CURRENT_DATE not null,
  title text not null,
  details text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_changelog enable row level security;

create table if not exists public.d_contacts (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  name text not null,
  company text,
  contact text,
  phone text,
  email text,
  status text,
  notes text,
  links jsonb default '[]'::jsonb not null,
  cap numeric(14,2),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_contacts enable row level security;

create table if not exists public.d_events (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  title text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  all_day boolean default false not null,
  recurrence text default 'none'::text not null,
  recurrence_until date,
  location text,
  notes text,
  color text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_events enable row level security;

create table if not exists public.d_features (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  icon text,
  color text,
  category text,
  summary text,
  description text,
  how_to text,
  tags text[] default '{}'::text[] not null,
  project_ids uuid[] default '{}'::uuid[] not null,
  links jsonb default '[]'::jsonb not null,
  "position" integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_features enable row level security;

create table if not exists public.d_files (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  name text not null,
  url text not null,
  path text,
  mime text,
  size bigint,
  note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_files enable row level security;

create table if not exists public.d_inventory (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  name text not null,
  category text,
  quantity numeric(14,2) default 0 not null,
  alert_threshold numeric(14,2),
  unit_value numeric(14,2),
  location text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_inventory enable row level security;

create table if not exists public.d_links (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  label text,
  url text not null,
  kind text,
  "position" integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_links enable row level security;

create table if not exists public.d_notes (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  title text not null,
  content text,
  pinned boolean default false not null,
  "position" integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_notes enable row level security;

create table if not exists public.d_projects (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  category text,
  status text,
  color text,
  icon text,
  logo_url text,
  description text,
  tags text[] default '{}'::text[] not null,
  pinned boolean default false not null,
  "position" integer,
  start_date date,
  end_date date,
  modules text[] default '{}'::text[] not null,
  tech jsonb default '{}'::jsonb not null,
  deploy jsonb default '{}'::jsonb not null,
  last_activity timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_projects enable row level security;

create table if not exists public.d_settings (
  user_id uuid default auth.uid() not null,
  settings jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_settings enable row level security;

create table if not exists public.d_tasks (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  title text not null,
  status text,
  priority text,
  due_date date,
  description text,
  subtasks jsonb default '[]'::jsonb not null,
  "position" integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_tasks enable row level security;

create table if not exists public.d_transactions (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  project_id uuid not null,
  kind text not null,
  amount numeric(14,2) default 0 not null,
  label text not null,
  category text,
  date date default CURRENT_DATE not null,
  contact_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.d_transactions enable row level security;

create table if not exists public.hg_activity (
  id bigint generated always as identity not null,
  user_id uuid,
  kind text not null,
  text text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_activity enable row level security;

create table if not exists public.hg_admin_access_log (
  id bigint generated always as identity not null,
  admin_id uuid,
  conversation_id uuid,
  conversation_kind text,
  accessed_at timestamp with time zone default now() not null
);
alter table public.hg_admin_access_log enable row level security;

create table if not exists public.hg_admin_log (
  id bigint generated always as identity not null,
  admin_id uuid,
  action text not null,
  target_user uuid,
  target_ref text,
  details jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_admin_log enable row level security;

create table if not exists public.hg_admin_state (
  user_id uuid not null,
  god_until timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_admin_state enable row level security;

create table if not exists public.hg_backup_027 (
  k text,
  name text,
  a text,
  b text
);
alter table public.hg_backup_027 enable row level security;

create table if not exists public.hg_badges (
  code text not null,
  name text not null,
  description text not null,
  image_url text,
  sort integer default 0 not null,
  levels_enabled boolean default false not null,
  metric text,
  levels jsonb default '[]'::jsonb not null,
  event_id uuid
);
alter table public.hg_badges enable row level security;

create table if not exists public.hg_birthday_log (
  user_id uuid not null,
  year integer not null,
  sent_at timestamp with time zone default now() not null,
  dm_sent_at timestamp with time zone,
  announce_sent_at timestamp with time zone
);
alter table public.hg_birthday_log enable row level security;

create table if not exists public.hg_bot_log (
  id bigint generated always as identity not null,
  sent_by uuid,
  kind text default 'manual'::text not null,
  title text,
  body text not null,
  recipients jsonb default '[]'::jsonb not null,
  channel boolean default false not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_bot_log enable row level security;

create table if not exists public.hg_card_copies (
  id bigint generated always as identity not null,
  card_id uuid not null,
  owner_id uuid,
  shiny boolean default false not null,
  serial integer,
  source text default 'booster'::text not null,
  obtained_at timestamp with time zone default now() not null,
  locked_trade uuid,
  recycled_at timestamp with time zone,
  wish_notified_at timestamp with time zone,
  announced_at timestamp with time zone
);
alter table public.hg_card_copies enable row level security;

create table if not exists public.hg_card_quests_templates (
  code text not null,
  label text not null,
  metric text not null,
  target integer not null,
  reward integer not null,
  active boolean default true not null,
  sort integer default 0 not null
);
alter table public.hg_card_quests_templates enable row level security;

create table if not exists public.hg_card_sets (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  description text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  active boolean default true not null,
  sort integer default 0 not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_card_sets enable row level security;

create table if not exists public.hg_card_showcase (
  user_id uuid not null,
  slot integer not null,
  copy_id bigint not null
);
alter table public.hg_card_showcase enable row level security;

create table if not exists public.hg_card_trade_items (
  trade_id uuid not null,
  copy_id bigint not null,
  side text not null
);
alter table public.hg_card_trade_items enable row level security;

create table if not exists public.hg_card_trades (
  id uuid default gen_random_uuid() not null,
  from_user uuid not null,
  to_user uuid not null,
  status text default 'proposee'::text not null,
  from_paillettes integer default 0 not null,
  to_paillettes integer default 0 not null,
  message text,
  parent_id uuid,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);
alter table public.hg_card_trades enable row level security;

create table if not exists public.hg_card_wishlist (
  user_id uuid not null,
  card_id uuid not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_card_wishlist enable row level security;

create table if not exists public.hg_cards (
  id uuid default gen_random_uuid() not null,
  set_id uuid not null,
  number integer not null,
  name text not null,
  family text not null,
  rarity text not null,
  image_url text,
  flavor text,
  member_id uuid,
  can_shiny boolean default true not null,
  tradeable boolean default true not null,
  craftable boolean default true not null,
  max_copies integer,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  caption text
);
alter table public.hg_cards enable row level security;

create table if not exists public.hg_challenges (
  id uuid default gen_random_uuid() not null,
  title text not null,
  description text,
  metric text not null,
  target integer not null,
  reward integer not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  active boolean default false not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_challenges enable row level security;

create table if not exists public.hg_conversation_members (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamp with time zone default '-infinity'::timestamp with time zone not null
);
alter table public.hg_conversation_members enable row level security;

create table if not exists public.hg_conversations (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  edition_id uuid,
  santa_id uuid,
  target_id uuid,
  direct_key text,
  created_at timestamp with time zone default now() not null,
  last_message_at timestamp with time zone default now() not null
);
alter table public.hg_conversations enable row level security;

create table if not exists public.hg_dyn_captures (
  id bigint generated always as identity not null,
  event_id uuid not null,
  user_id uuid not null,
  captured_at timestamp with time zone default now() not null
);
alter table public.hg_dyn_captures enable row level security;

create table if not exists public.hg_dyn_events (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  image_url text,
  emoji text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  probability numeric default 0.2 not null,
  max_per_page integer default 1 not null,
  max_per_user integer,
  max_total integer,
  duration_ms integer default 6000 not null,
  size_px integer default 72 not null,
  badge_code text,
  announce boolean default true not null,
  announced_start_at timestamp with time zone,
  announced_end_at timestamp with time zone,
  active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_dyn_events enable row level security;

create table if not exists public.hg_event_date_votes (
  date_id uuid not null,
  user_id uuid not null
);
alter table public.hg_event_date_votes enable row level security;

create table if not exists public.hg_event_dates (
  id uuid default gen_random_uuid() not null,
  event_id uuid not null,
  proposed_at timestamp with time zone not null
);
alter table public.hg_event_dates enable row level security;

create table if not exists public.hg_event_rsvps (
  event_id uuid not null,
  user_id uuid not null,
  status text not null,
  updated_at timestamp with time zone default now() not null,
  remind_24h_at timestamp with time zone,
  remind_2h_at timestamp with time zone
);
alter table public.hg_event_rsvps enable row level security;

create table if not exists public.hg_events (
  id uuid default gen_random_uuid() not null,
  title text not null,
  description text,
  location text,
  starts_at timestamp with time zone,
  cover_path text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  retro boolean default false not null
);
alter table public.hg_events enable row level security;

create table if not exists public.hg_ideas (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  body text not null,
  status text default 'nouvelle'::text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_ideas enable row level security;

create table if not exists public.hg_invite_links (
  id uuid default gen_random_uuid() not null,
  token text default encode(gen_random_bytes(12), 'hex'::text) not null,
  label text,
  active boolean default true not null,
  max_codes integer,
  codes_generated integer default 0 not null,
  expires_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_invite_links enable row level security;

create table if not exists public.hg_invites (
  code text not null,
  created_by uuid,
  used_by uuid,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  link_id uuid,
  expires_at timestamp with time zone,
  ghost_id uuid
);
alter table public.hg_invites enable row level security;

create table if not exists public.hg_messages (
  id bigint generated always as identity not null,
  conversation_id uuid not null,
  sender_id uuid,
  body text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_messages enable row level security;

create table if not exists public.hg_moments (
  id uuid default gen_random_uuid() not null,
  title text not null,
  body text,
  happened_on date default CURRENT_DATE not null,
  image_path text,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_moments enable row level security;

create table if not exists public.hg_page_access (
  page_slug text not null,
  user_id uuid not null,
  allowed boolean not null
);
alter table public.hg_page_access enable row level security;

create table if not exists public.hg_pages (
  slug text not null,
  label text not null,
  mode text default 'membres'::text not null,
  in_nav boolean default true not null,
  sort integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_pages enable row level security;

create table if not exists public.hg_perm_catalog (
  key text not null,
  label text not null,
  description text default ''::text not null,
  sort integer default 0 not null
);
alter table public.hg_perm_catalog enable row level security;

create table if not exists public.hg_perm_tables (
  tbl text not null,
  perm text not null
);
alter table public.hg_perm_tables enable row level security;

create table if not exists public.hg_photos (
  id uuid default gen_random_uuid() not null,
  event_id uuid,
  user_id uuid,
  path text not null,
  caption text,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_photos enable row level security;

-- Structure seulement : les valeurs de hg_private sont des secrets et ne sont jamais dumpées.
create table if not exists public.hg_private (
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_private enable row level security;

create table if not exists public.hg_profile_info (
  user_id uuid not null,
  data jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_profile_info enable row level security;

create table if not exists public.hg_profiles (
  id uuid not null,
  pseudo text not null,
  avatar_url text,
  color text default '#9E3543'::text,
  birthday date,
  share_birthday boolean default false not null,
  discord_id text,
  bot_optin boolean default true not null,
  is_admin boolean default false not null,
  intro_seen boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  member_number integer default nextval('hg_member_number_seq'::regclass),
  joined_on date,
  account_created_at timestamp with time zone,
  is_ghost boolean default false not null,
  ghost_note text,
  remind_irl boolean default false not null,
  notify_card_wish boolean default false not null
);
alter table public.hg_profiles enable row level security;

create table if not exists public.hg_push_subscriptions (
  id bigint generated always as identity not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_push_subscriptions enable row level security;

create table if not exists public.hg_reactions (
  id uuid default gen_random_uuid() not null,
  target_kind text not null,
  target_id uuid not null,
  user_id uuid not null,
  emoji text not null,
  created_at timestamp with time zone default now() not null,
  active boolean default true not null
);
alter table public.hg_reactions enable row level security;

create table if not exists public.hg_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_settings enable row level security;

create table if not exists public.hg_ss_assignments (
  edition_id uuid not null,
  giver_id uuid not null,
  receiver_id uuid not null
);
alter table public.hg_ss_assignments enable row level security;

create table if not exists public.hg_ss_editions (
  id uuid default gen_random_uuid() not null,
  year integer not null,
  status text default 'inscriptions'::text not null,
  budget text,
  send_deadline date,
  exchange_date date,
  card_base_url text,
  drawn_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  shared_fields text[] default '{}'::text[] not null
);
alter table public.hg_ss_editions enable row level security;

create table if not exists public.hg_ss_exclusions (
  edition_id uuid not null,
  user_a uuid not null,
  user_b uuid not null
);
alter table public.hg_ss_exclusions enable row level security;

create table if not exists public.hg_ss_participants (
  edition_id uuid not null,
  user_id uuid not null,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  joined_at timestamp with time zone default now() not null,
  send_reminder_at timestamp with time zone
);
alter table public.hg_ss_participants enable row level security;

create table if not exists public.hg_ss_wishes (
  id uuid default gen_random_uuid() not null,
  edition_id uuid not null,
  user_id uuid not null,
  label text not null,
  url text,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_ss_wishes enable row level security;

create table if not exists public.hg_staff (
  user_id uuid not null,
  perms text[] default '{}'::text[] not null,
  active boolean default true not null,
  note text default ''::text not null,
  added_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_staff enable row level security;

create table if not exists public.hg_support (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  pseudo text not null,
  subject text not null,
  message text not null,
  contact text,
  status text default 'ouverte'::text not null,
  discord_sent boolean default false not null,
  created_at timestamp with time zone default now() not null,
  client_hash text,
  taken_by uuid,
  taken_at timestamp with time zone,
  read_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_support enable row level security;

create table if not exists public.hg_support_replies (
  id uuid default gen_random_uuid() not null,
  support_id uuid not null,
  author_id uuid,
  body text not null,
  internal boolean default false not null,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_support_replies enable row level security;

create table if not exists public.hg_theme_seen (
  user_id uuid not null,
  slug text not null,
  seen_at timestamp with time zone default now() not null
);
alter table public.hg_theme_seen enable row level security;

create table if not exists public.hg_themes (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  is_default boolean default false not null,
  active boolean default true not null,
  start_md text,
  end_md text,
  priority integer default 0 not null,
  logo_url text,
  emojis text[] default '{}'::text[] not null,
  effect text default 'aucun'::text not null,
  colors jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_themes enable row level security;

create table if not exists public.hg_user_badges (
  user_id uuid not null,
  badge_code text not null,
  awarded_at timestamp with time zone default now() not null,
  level integer default 1 not null,
  level_at timestamp with time zone
);
alter table public.hg_user_badges enable row level security;

create table if not exists public.hg_wallet_log (
  id bigint generated always as identity not null,
  user_id uuid not null,
  delta integer not null,
  reason text not null,
  ref text,
  created_at timestamp with time zone default now() not null
);
alter table public.hg_wallet_log enable row level security;

create table if not exists public.hg_wallets (
  user_id uuid not null,
  paillettes integer default 0 not null,
  boosters_opened integer default 0 not null,
  pity_epique integer default 0 not null,
  last_free_booster timestamp with time zone,
  last_daily date,
  daily_streak integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);
alter table public.hg_wallets enable row level security;

-- 4. Contraintes : clés primaires, uniques et CHECK d'abord, clés étrangères ensuite
alter table public.d_bugs add constraint d_bugs_pkey PRIMARY KEY (id);
alter table public.d_changelog add constraint d_changelog_pkey PRIMARY KEY (id);
alter table public.d_contacts add constraint d_contacts_pkey PRIMARY KEY (id);
alter table public.d_events add constraint d_events_pkey PRIMARY KEY (id);
alter table public.d_features add constraint d_features_pkey PRIMARY KEY (id);
alter table public.d_files add constraint d_files_pkey PRIMARY KEY (id);
alter table public.d_inventory add constraint d_inventory_pkey PRIMARY KEY (id);
alter table public.d_links add constraint d_links_pkey PRIMARY KEY (id);
alter table public.d_notes add constraint d_notes_pkey PRIMARY KEY (id);
alter table public.d_projects add constraint d_projects_pkey PRIMARY KEY (id);
alter table public.d_settings add constraint d_settings_pkey PRIMARY KEY (user_id);
alter table public.d_tasks add constraint d_tasks_pkey PRIMARY KEY (id);
alter table public.d_transactions add constraint d_transactions_kind_check CHECK ((kind = ANY (ARRAY['recette'::text, 'depense'::text])));
alter table public.d_transactions add constraint d_transactions_pkey PRIMARY KEY (id);
alter table public.hg_activity add constraint hg_activity_pkey PRIMARY KEY (id);
alter table public.hg_admin_access_log add constraint hg_admin_access_log_pkey PRIMARY KEY (id);
alter table public.hg_admin_log add constraint hg_admin_log_pkey PRIMARY KEY (id);
alter table public.hg_admin_state add constraint hg_admin_state_pkey PRIMARY KEY (user_id);
alter table public.hg_badges add constraint hg_badges_pkey PRIMARY KEY (code);
alter table public.hg_birthday_log add constraint hg_birthday_log_pkey PRIMARY KEY (user_id, year);
alter table public.hg_bot_log add constraint hg_bot_log_pkey PRIMARY KEY (id);
alter table public.hg_card_copies add constraint hg_card_copies_pkey PRIMARY KEY (id);
alter table public.hg_card_copies add constraint hg_card_copies_source_check CHECK ((source = ANY (ARRAY['booster'::text, 'cadeau'::text, 'admin'::text, 'fabrication'::text, 'evenement'::text, 'echange'::text])));
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_code_check CHECK ((code ~ '^[a-z0-9_]{2,40}$'::text));
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 120)));
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_metric_check CHECK ((metric = ANY (ARRAY['boosters_ouverts'::text, 'echanges_conclus'::text, 'photos_ajoutees'::text, 'cartes_recyclees'::text, 'passages_du_jour'::text])));
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_pkey PRIMARY KEY (code);
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_reward_check CHECK (((reward >= 1) AND (reward <= 10000)));
alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_target_check CHECK ((target > 0));
alter table public.hg_card_sets add constraint hg_card_sets_code_key UNIQUE (code);
alter table public.hg_card_sets add constraint hg_card_sets_pkey PRIMARY KEY (id);
alter table public.hg_card_showcase add constraint hg_card_showcase_pkey PRIMARY KEY (user_id, slot);
alter table public.hg_card_showcase add constraint hg_card_showcase_slot_check CHECK (((slot >= 1) AND (slot <= 3)));
alter table public.hg_card_trade_items add constraint hg_card_trade_items_pkey PRIMARY KEY (trade_id, copy_id);
alter table public.hg_card_trade_items add constraint hg_card_trade_items_side_check CHECK ((side = ANY (ARRAY['from'::text, 'to'::text])));
alter table public.hg_card_trades add constraint hg_card_trades_check CHECK ((from_user <> to_user));
alter table public.hg_card_trades add constraint hg_card_trades_from_paillettes_check CHECK ((from_paillettes >= 0));
alter table public.hg_card_trades add constraint hg_card_trades_message_check CHECK (((message IS NULL) OR (char_length(message) <= 500)));
alter table public.hg_card_trades add constraint hg_card_trades_pkey PRIMARY KEY (id);
alter table public.hg_card_trades add constraint hg_card_trades_status_check CHECK ((status = ANY (ARRAY['proposee'::text, 'acceptee'::text, 'refusee'::text, 'annulee'::text, 'remplacee'::text])));
alter table public.hg_card_trades add constraint hg_card_trades_to_paillettes_check CHECK ((to_paillettes >= 0));
alter table public.hg_card_wishlist add constraint hg_card_wishlist_pkey PRIMARY KEY (user_id, card_id);
alter table public.hg_cards add constraint hg_cards_caption_check CHECK (((caption IS NULL) OR (char_length(caption) <= 80)));
alter table public.hg_cards add constraint hg_cards_family_check CHECK ((family = ANY (ARRAY['membre'::text, 'moment'::text, 'lieu'::text, 'objet'::text, 'evenement'::text, 'jeu'::text])));
alter table public.hg_cards add constraint hg_cards_max_copies_check CHECK (((max_copies IS NULL) OR (max_copies > 0)));
alter table public.hg_cards add constraint hg_cards_pkey PRIMARY KEY (id);
alter table public.hg_cards add constraint hg_cards_rarity_check CHECK ((rarity = ANY (ARRAY['commune'::text, 'peu_commune'::text, 'rare'::text, 'epique'::text, 'legendaire'::text, 'mythique'::text, 'identite'::text])));
alter table public.hg_cards add constraint hg_cards_set_id_number_key UNIQUE (set_id, number);
alter table public.hg_challenges add constraint hg_challenges_check CHECK ((ends_at > starts_at));
alter table public.hg_challenges add constraint hg_challenges_description_check CHECK (((description IS NULL) OR (char_length(description) <= 500)));
alter table public.hg_challenges add constraint hg_challenges_metric_check CHECK ((metric = ANY (ARRAY['sorties_tenues'::text, 'participations'::text, 'photos_ajoutees'::text, 'souvenirs_publies'::text, 'boosters_ouverts'::text, 'cartes_recyclees'::text, 'echanges_conclus'::text])));
alter table public.hg_challenges add constraint hg_challenges_pkey PRIMARY KEY (id);
alter table public.hg_challenges add constraint hg_challenges_reward_check CHECK (((reward >= 1) AND (reward <= 100000)));
alter table public.hg_challenges add constraint hg_challenges_target_check CHECK ((target > 0));
alter table public.hg_challenges add constraint hg_challenges_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 120)));
alter table public.hg_conversation_members add constraint hg_conversation_members_pkey PRIMARY KEY (conversation_id, user_id);
alter table public.hg_conversations add constraint hg_conversations_direct_key_key UNIQUE (direct_key);
alter table public.hg_conversations add constraint hg_conversations_edition_id_santa_id_key UNIQUE (edition_id, santa_id);
alter table public.hg_conversations add constraint hg_conversations_kind_check CHECK ((kind = ANY (ARRAY['direct'::text, 'santa'::text])));
alter table public.hg_conversations add constraint hg_conversations_pkey PRIMARY KEY (id);
alter table public.hg_dyn_captures add constraint hg_dyn_captures_pkey PRIMARY KEY (id);
alter table public.hg_dyn_events add constraint hg_dyn_events_check CHECK ((ends_at > starts_at));
alter table public.hg_dyn_events add constraint hg_dyn_events_duration_ms_check CHECK (((duration_ms >= 1500) AND (duration_ms <= 30000)));
alter table public.hg_dyn_events add constraint hg_dyn_events_max_per_page_check CHECK (((max_per_page >= 1) AND (max_per_page <= 10)));
alter table public.hg_dyn_events add constraint hg_dyn_events_pkey PRIMARY KEY (id);
alter table public.hg_dyn_events add constraint hg_dyn_events_probability_check CHECK (((probability > (0)::numeric) AND (probability <= (1)::numeric)));
alter table public.hg_dyn_events add constraint hg_dyn_events_size_px_check CHECK (((size_px >= 24) AND (size_px <= 240)));
alter table public.hg_event_date_votes add constraint hg_event_date_votes_pkey PRIMARY KEY (date_id, user_id);
alter table public.hg_event_dates add constraint hg_event_dates_pkey PRIMARY KEY (id);
alter table public.hg_event_rsvps add constraint hg_event_rsvps_pkey PRIMARY KEY (event_id, user_id);
alter table public.hg_event_rsvps add constraint hg_event_rsvps_status_check CHECK ((status = ANY (ARRAY['oui'::text, 'peut-etre'::text, 'non'::text])));
alter table public.hg_events add constraint hg_events_pkey PRIMARY KEY (id);
alter table public.hg_ideas add constraint hg_ideas_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)));
alter table public.hg_ideas add constraint hg_ideas_pkey PRIMARY KEY (id);
alter table public.hg_ideas add constraint hg_ideas_status_check CHECK ((status = ANY (ARRAY['nouvelle'::text, 'retenue'::text, 'ecartee'::text])));
alter table public.hg_invite_links add constraint hg_invite_links_pkey PRIMARY KEY (id);
alter table public.hg_invite_links add constraint hg_invite_links_token_key UNIQUE (token);
alter table public.hg_invites add constraint hg_invites_pkey PRIMARY KEY (code);
alter table public.hg_messages add constraint hg_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));
alter table public.hg_messages add constraint hg_messages_pkey PRIMARY KEY (id);
alter table public.hg_moments add constraint hg_moments_pkey PRIMARY KEY (id);
alter table public.hg_page_access add constraint hg_page_access_pkey PRIMARY KEY (page_slug, user_id);
alter table public.hg_pages add constraint hg_pages_mode_check CHECK ((mode = ANY (ARRAY['membres'::text, 'admin'::text, 'liste'::text])));
alter table public.hg_pages add constraint hg_pages_pkey PRIMARY KEY (slug);
alter table public.hg_perm_catalog add constraint hg_perm_catalog_key_check CHECK ((key ~ '^[a-z_]{2,32}$'::text));
alter table public.hg_perm_catalog add constraint hg_perm_catalog_pkey PRIMARY KEY (key);
alter table public.hg_perm_tables add constraint hg_perm_tables_pkey PRIMARY KEY (tbl);
alter table public.hg_photos add constraint hg_photos_pkey PRIMARY KEY (id);
alter table public.hg_private add constraint hg_private_pkey PRIMARY KEY (key);
alter table public.hg_profile_info add constraint hg_profile_info_pkey PRIMARY KEY (user_id);
alter table public.hg_profiles add constraint hg_profiles_avatar_bucket CHECK (((avatar_url IS NULL) OR (avatar_url ~ '^https://[a-z0-9]+\\.supabase\\.co/storage/v1/object/public/hg-avatars/[^[:space:]\"''<>]+$'::text)));
alter table public.hg_profiles add constraint hg_profiles_color_format CHECK (((color IS NULL) OR (color ~ '^#[0-9A-Fa-f]{6}$'::text)));
alter table public.hg_profiles add constraint hg_profiles_discord_format CHECK (((discord_id IS NULL) OR (discord_id ~ '^[0-9]{15,21}$'::text)));
alter table public.hg_profiles add constraint hg_profiles_member_number_key UNIQUE (member_number);
alter table public.hg_profiles add constraint hg_profiles_pkey PRIMARY KEY (id);
alter table public.hg_profiles add constraint hg_profiles_pseudo_check CHECK (((char_length(pseudo) >= 2) AND (char_length(pseudo) <= 32)));
alter table public.hg_profiles add constraint hg_profiles_pseudo_key UNIQUE (pseudo);
alter table public.hg_push_subscriptions add constraint hg_push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.hg_push_subscriptions add constraint hg_push_subscriptions_pkey PRIMARY KEY (id);
alter table public.hg_reactions add constraint hg_reactions_emoji_check CHECK ((emoji = ANY (ARRAY['❤️'::text, '😂'::text, '😮'::text, '🔥'::text, '👏'::text, '🎉'::text])));
alter table public.hg_reactions add constraint hg_reactions_kind_check CHECK ((target_kind = ANY (ARRAY['moment'::text, 'photo'::text])));
alter table public.hg_reactions add constraint hg_reactions_pkey PRIMARY KEY (id);
alter table public.hg_reactions add constraint hg_reactions_unique UNIQUE (target_kind, target_id, user_id, emoji);
alter table public.hg_settings add constraint hg_settings_pkey PRIMARY KEY (key);
alter table public.hg_ss_assignments add constraint hg_ss_assignments_edition_id_receiver_id_key UNIQUE (edition_id, receiver_id);
alter table public.hg_ss_assignments add constraint hg_ss_assignments_pkey PRIMARY KEY (edition_id, giver_id);
alter table public.hg_ss_editions add constraint hg_ss_editions_pkey PRIMARY KEY (id);
alter table public.hg_ss_editions add constraint hg_ss_editions_status_check CHECK ((status = ANY (ARRAY['inscriptions'::text, 'tirage'::text, 'envoi'::text, 'revelation'::text, 'termine'::text])));
alter table public.hg_ss_editions add constraint hg_ss_editions_year_key UNIQUE (year);
alter table public.hg_ss_exclusions add constraint hg_ss_exclusions_pkey PRIMARY KEY (edition_id, user_a, user_b);
alter table public.hg_ss_participants add constraint hg_ss_participants_pkey PRIMARY KEY (edition_id, user_id);
alter table public.hg_ss_wishes add constraint hg_ss_wishes_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200)));
alter table public.hg_ss_wishes add constraint hg_ss_wishes_pkey PRIMARY KEY (id);
alter table public.hg_staff add constraint hg_staff_pkey PRIMARY KEY (user_id);
alter table public.hg_support add constraint hg_support_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 4000)));
alter table public.hg_support add constraint hg_support_pkey PRIMARY KEY (id);
alter table public.hg_support add constraint hg_support_status_check CHECK ((status = ANY (ARRAY['ouverte'::text, 'traitee'::text])));
alter table public.hg_support_replies add constraint hg_support_replies_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));
alter table public.hg_support_replies add constraint hg_support_replies_pkey PRIMARY KEY (id);
alter table public.hg_theme_seen add constraint hg_theme_seen_pkey PRIMARY KEY (user_id, slug);
alter table public.hg_themes add constraint hg_themes_effect_check CHECK ((effect = ANY (ARRAY['aucun'::text, 'pluie'::text, 'neige'::text, 'etoiles'::text])));
alter table public.hg_themes add constraint hg_themes_end_md_check CHECK ((end_md ~ '^\\d{2}-\\d{2}$'::text));
alter table public.hg_themes add constraint hg_themes_pkey PRIMARY KEY (id);
alter table public.hg_themes add constraint hg_themes_slug_key UNIQUE (slug);
alter table public.hg_themes add constraint hg_themes_start_md_check CHECK ((start_md ~ '^\\d{2}-\\d{2}$'::text));
alter table public.hg_user_badges add constraint hg_user_badges_pkey PRIMARY KEY (user_id, badge_code);
alter table public.hg_wallet_log add constraint hg_wallet_log_pkey PRIMARY KEY (id);
alter table public.hg_wallets add constraint hg_wallets_paillettes_check CHECK ((paillettes >= 0));
alter table public.hg_wallets add constraint hg_wallets_pkey PRIMARY KEY (user_id);

-- 5. Clés étrangères
alter table public.d_bugs add constraint d_bugs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_bugs add constraint d_bugs_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_changelog add constraint d_changelog_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_changelog add constraint d_changelog_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_contacts add constraint d_contacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_contacts add constraint d_contacts_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_events add constraint d_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_events add constraint d_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_features add constraint d_features_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_files add constraint d_files_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_files add constraint d_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_inventory add constraint d_inventory_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_inventory add constraint d_inventory_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_links add constraint d_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_links add constraint d_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_notes add constraint d_notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_notes add constraint d_notes_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_projects add constraint d_projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_settings add constraint d_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_tasks add constraint d_tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_tasks add constraint d_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.d_transactions add constraint d_transactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES d_contacts(id) ON DELETE SET NULL;
alter table public.d_transactions add constraint d_transactions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.d_transactions add constraint d_transactions_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE;
alter table public.hg_activity add constraint hg_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_admin_access_log add constraint hg_admin_access_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_admin_access_log add constraint hg_admin_access_log_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hg_conversations(id) ON DELETE SET NULL;
alter table public.hg_admin_log add constraint hg_admin_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_admin_state add constraint hg_admin_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_birthday_log add constraint hg_birthday_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_bot_log add constraint hg_bot_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_card_copies add constraint hg_card_copies_card_id_fkey FOREIGN KEY (card_id) REFERENCES hg_cards(id) ON DELETE CASCADE;
alter table public.hg_card_copies add constraint hg_card_copies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_card_showcase add constraint hg_card_showcase_copy_id_fkey FOREIGN KEY (copy_id) REFERENCES hg_card_copies(id) ON DELETE CASCADE;
alter table public.hg_card_showcase add constraint hg_card_showcase_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_card_trade_items add constraint hg_card_trade_items_copy_id_fkey FOREIGN KEY (copy_id) REFERENCES hg_card_copies(id) ON DELETE CASCADE;
alter table public.hg_card_trade_items add constraint hg_card_trade_items_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES hg_card_trades(id) ON DELETE CASCADE;
alter table public.hg_card_trades add constraint hg_card_trades_from_user_fkey FOREIGN KEY (from_user) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_card_trades add constraint hg_card_trades_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES hg_card_trades(id) ON DELETE SET NULL;
alter table public.hg_card_trades add constraint hg_card_trades_to_user_fkey FOREIGN KEY (to_user) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_card_wishlist add constraint hg_card_wishlist_card_id_fkey FOREIGN KEY (card_id) REFERENCES hg_cards(id) ON DELETE CASCADE;
alter table public.hg_card_wishlist add constraint hg_card_wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_cards add constraint hg_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_cards add constraint hg_cards_set_id_fkey FOREIGN KEY (set_id) REFERENCES hg_card_sets(id) ON DELETE CASCADE;
alter table public.hg_challenges add constraint hg_challenges_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON DELETE SET NULL;
alter table public.hg_conversation_members add constraint hg_conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hg_conversations(id) ON DELETE CASCADE;
alter table public.hg_conversation_members add constraint hg_conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_conversations add constraint hg_conversations_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE;
alter table public.hg_conversations add constraint hg_conversations_santa_id_fkey FOREIGN KEY (santa_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_conversations add constraint hg_conversations_target_id_fkey FOREIGN KEY (target_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_dyn_captures add constraint hg_dyn_captures_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_dyn_events(id) ON DELETE CASCADE;
alter table public.hg_dyn_captures add constraint hg_dyn_captures_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_dyn_events add constraint hg_dyn_events_badge_code_fkey FOREIGN KEY (badge_code) REFERENCES hg_badges(code) ON DELETE SET NULL;
alter table public.hg_dyn_events add constraint hg_dyn_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_event_date_votes add constraint hg_event_date_votes_date_id_fkey FOREIGN KEY (date_id) REFERENCES hg_event_dates(id) ON DELETE CASCADE;
alter table public.hg_event_date_votes add constraint hg_event_date_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_event_dates add constraint hg_event_dates_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE;
alter table public.hg_event_rsvps add constraint hg_event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE;
alter table public.hg_event_rsvps add constraint hg_event_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_events add constraint hg_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_ideas add constraint hg_ideas_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_invite_links add constraint hg_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.hg_invites add constraint hg_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.hg_invites add constraint hg_invites_ghost_id_fkey FOREIGN KEY (ghost_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_invites add constraint hg_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.hg_messages add constraint hg_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hg_conversations(id) ON DELETE CASCADE;
alter table public.hg_messages add constraint hg_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_moments add constraint hg_moments_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_page_access add constraint hg_page_access_page_slug_fkey FOREIGN KEY (page_slug) REFERENCES hg_pages(slug) ON DELETE CASCADE;
alter table public.hg_page_access add constraint hg_page_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_perm_tables add constraint hg_perm_tables_perm_fkey FOREIGN KEY (perm) REFERENCES hg_perm_catalog(key);
alter table public.hg_photos add constraint hg_photos_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE;
alter table public.hg_photos add constraint hg_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL;
alter table public.hg_profile_info add constraint hg_profile_info_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_push_subscriptions add constraint hg_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON DELETE CASCADE;
alter table public.hg_reactions add constraint hg_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_assignments add constraint hg_ss_assignments_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE;
alter table public.hg_ss_assignments add constraint hg_ss_assignments_giver_id_fkey FOREIGN KEY (giver_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_assignments add constraint hg_ss_assignments_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_exclusions add constraint hg_ss_exclusions_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE;
alter table public.hg_ss_exclusions add constraint hg_ss_exclusions_user_a_fkey FOREIGN KEY (user_a) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_exclusions add constraint hg_ss_exclusions_user_b_fkey FOREIGN KEY (user_b) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_participants add constraint hg_ss_participants_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE;
alter table public.hg_ss_participants add constraint hg_ss_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_ss_wishes add constraint hg_ss_wishes_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE;
alter table public.hg_ss_wishes add constraint hg_ss_wishes_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_staff add constraint hg_staff_added_by_fkey FOREIGN KEY (added_by) REFERENCES hg_profiles(id) ON DELETE SET NULL;
alter table public.hg_staff add constraint hg_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON DELETE CASCADE;
alter table public.hg_support add constraint hg_support_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES hg_profiles(id) ON DELETE SET NULL;
alter table public.hg_support add constraint hg_support_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.hg_support_replies add constraint hg_support_replies_author_id_fkey FOREIGN KEY (author_id) REFERENCES hg_profiles(id) ON DELETE SET NULL;
alter table public.hg_support_replies add constraint hg_support_replies_support_id_fkey FOREIGN KEY (support_id) REFERENCES hg_support(id) ON DELETE CASCADE;
alter table public.hg_theme_seen add constraint hg_theme_seen_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_user_badges add constraint hg_user_badges_badge_code_fkey FOREIGN KEY (badge_code) REFERENCES hg_badges(code) ON DELETE CASCADE;
alter table public.hg_user_badges add constraint hg_user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_wallet_log add constraint hg_wallet_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;
alter table public.hg_wallets add constraint hg_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE;

-- 6. Index (hors index portés par une contrainte)
CREATE INDEX idx_d_bugs_owner ON public.d_bugs USING btree (owner_id);
CREATE INDEX idx_d_bugs_project ON public.d_bugs USING btree (project_id);
CREATE INDEX idx_d_changelog_owner ON public.d_changelog USING btree (owner_id);
CREATE INDEX idx_d_changelog_project ON public.d_changelog USING btree (project_id);
CREATE INDEX idx_d_contacts_owner ON public.d_contacts USING btree (owner_id);
CREATE INDEX idx_d_contacts_project ON public.d_contacts USING btree (project_id);
CREATE INDEX idx_d_events_owner ON public.d_events USING btree (owner_id);
CREATE INDEX idx_d_events_project ON public.d_events USING btree (project_id);
CREATE INDEX idx_d_features_owner ON public.d_features USING btree (owner_id);
CREATE INDEX idx_d_files_owner ON public.d_files USING btree (owner_id);
CREATE INDEX idx_d_files_project ON public.d_files USING btree (project_id);
CREATE INDEX idx_d_inventory_owner ON public.d_inventory USING btree (owner_id);
CREATE INDEX idx_d_inventory_project ON public.d_inventory USING btree (project_id);
CREATE INDEX idx_d_links_owner ON public.d_links USING btree (owner_id);
CREATE INDEX idx_d_links_project ON public.d_links USING btree (project_id);
CREATE INDEX idx_d_notes_owner ON public.d_notes USING btree (owner_id);
CREATE INDEX idx_d_notes_project ON public.d_notes USING btree (project_id);
CREATE INDEX idx_d_projects_owner ON public.d_projects USING btree (owner_id);
CREATE INDEX idx_d_tasks_owner ON public.d_tasks USING btree (owner_id);
CREATE INDEX idx_d_tasks_project ON public.d_tasks USING btree (project_id);
CREATE INDEX idx_d_transactions_owner ON public.d_transactions USING btree (owner_id);
CREATE INDEX idx_d_transactions_project ON public.d_transactions USING btree (project_id);
CREATE INDEX idx_d_tx_contact ON public.d_transactions USING btree (contact_id);
CREATE INDEX hg_admin_access_log_conv_idx ON public.hg_admin_access_log USING btree (conversation_id, accessed_at DESC);
CREATE INDEX hg_admin_log_created_idx ON public.hg_admin_log USING btree (created_at DESC);
CREATE INDEX hg_card_copies_owner ON public.hg_card_copies USING btree (owner_id) WHERE (recycled_at IS NULL);
CREATE UNIQUE INDEX hg_card_copies_serial ON public.hg_card_copies USING btree (card_id, serial) WHERE (serial IS NOT NULL);
CREATE INDEX hg_card_wishlist_card_idx ON public.hg_card_wishlist USING btree (card_id);
CREATE INDEX hg_dyn_captures_ev ON public.hg_dyn_captures USING btree (event_id, user_id);
CREATE INDEX hg_events_starts_idx ON public.hg_events USING btree (starts_at);
CREATE INDEX hg_messages_conv_idx ON public.hg_messages USING btree (conversation_id, id);
CREATE INDEX hg_push_subscriptions_user_idx ON public.hg_push_subscriptions USING btree (user_id);
CREATE INDEX hg_support_client_hash_idx ON public.hg_support USING btree (client_hash, created_at) WHERE (client_hash IS NOT NULL);
CREATE INDEX hg_support_replies_support_idx ON public.hg_support_replies USING btree (support_id, created_at);
CREATE UNIQUE INDEX hg_themes_one_default ON public.hg_themes USING btree (is_default) WHERE is_default;
CREATE UNIQUE INDEX hg_wallet_log_once ON public.hg_wallet_log USING btree (user_id, reason, ref) WHERE (ref IS NOT NULL);

-- 7. Fonctions (pg_get_functiondef), par ordre alphabétique

CREATE OR REPLACE FUNCTION public.d_owns_project(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from d_projects p where p.id = pid and p.owner_id = auth.uid())
$function$
;

CREATE OR REPLACE FUNCTION public.d_touch_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pid uuid;
begin
  pid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  update d_projects set last_activity = now() where id = pid;
  return case when tg_op = 'DELETE' then old else new end;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_admin_accounts()
 RETURNS TABLE(id uuid, pseudo text, email text, is_admin boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not (public.hg_has_perm('membres') or public.hg_has_perm('messages')) then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo,
      case when public.hg_is_admin() then u.email::text else null end,
      p.is_admin, p.created_at, u.last_sign_in_at
    from hg_profiles p join auth.users u on u.id = p.id order by p.pseudo;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_admin_audit(p_action text, p_user uuid, p_ref text, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.hg_admin_log(admin_id, action, target_user, target_ref, details)
  values (auth.uid(), p_action, p_user, p_ref, coalesce(p_details, '{}'::jsonb));
$function$
;

CREATE OR REPLACE FUNCTION public.hg_admin_conversations()
 RETURNS TABLE(id uuid, kind text, edition_year integer, members text, santa text, target text, last_message_at timestamp with time zone, messages integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  return query select c.id, c.kind, e.year,
    (select string_agg(p.pseudo, ' · ' order by p.pseudo) from hg_conversation_members m join hg_profiles p on p.id = m.user_id where m.conversation_id = c.id),
    (select ps.pseudo from hg_profiles ps where ps.id = c.santa_id), (select pt.pseudo from hg_profiles pt where pt.id = c.target_id),
    c.last_message_at, (select count(*)::int from hg_messages x where x.conversation_id = c.id)
  from hg_conversations c left join hg_ss_editions e on e.id = c.edition_id order by c.last_message_at desc;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_admin_ghosts()
 RETURNS TABLE(id uuid, pseudo text, joined_on date, ghost_note text, avatar_url text, created_at timestamp with time zone, invite_code text, invite_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo, p.joined_on, p.ghost_note, p.avatar_url, p.created_at,
    i.code, i.expires_at
  from hg_profiles p
  left join lateral (select v.code, v.expires_at from hg_invites v where v.ghost_id = p.id and v.used_by is null and (v.expires_at is null or v.expires_at > now()) order by v.created_at desc limit 1) i on true
  where p.is_ghost order by p.pseudo;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_admin_read_conversation(p_conv uuid, p_after bigint DEFAULT 0, p_limit integer DEFAULT 100)
 RETURNS SETOF hg_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_kind text;
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  select kind into v_kind from public.hg_conversations where id = p_conv;
  if not found then raise exception 'Conversation introuvable'; end if;
  insert into public.hg_admin_access_log(admin_id, conversation_id, conversation_kind) values (auth.uid(), p_conv, v_kind);
  return query select m.* from public.hg_messages m where m.conversation_id = p_conv and m.id > coalesce(p_after, 0)
    order by m.id limit greatest(least(coalesce(p_limit, 100), 500), 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_auth_user_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  execute 'del' || 'ete from public.hg_profiles where id = $1 and not is_ghost' using old.id;
  return old;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_award_badges(p_user uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c int; v_first_year int := (select min(extract(year from created_at))::int from hg_profiles);
begin
  with aw(user_id, code) as (
    select pt.user_id, 'premier_noel' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') and pt.sent_at is not null group by pt.user_id
    union all select pt.user_id, 'veteran' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') and pt.sent_at is not null group by pt.user_id having count(*) >= 5
    union all select * from (select distinct on (edition_id) user_id, 'lutin_express' from hg_ss_participants where sent_at is not null order by edition_id, sent_at) le
    union all select pt.user_id, 'sur_le_fil' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.send_deadline is not null and (pt.sent_at at time zone 'Europe/Zurich')::date = e.send_deadline
    union all select w.user_id, 'liste_parfaite' from hg_ss_wishes w join hg_ss_editions e on e.id = w.edition_id
      where e.drawn_at is not null and w.created_at < e.drawn_at
    union all select r.user_id, 'toujours_la' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() group by r.user_id having count(*) >= 5
    union all select created_by, 'organisateur' from hg_events where created_by is not null
    union all select r.user_id, 'globe_trotter' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() and coalesce(trim(ev.location), '') <> ''
      group by r.user_id having count(distinct lower(trim(ev.location))) >= 3
    union all select user_id, 'paparazzi' from hg_photos where user_id is not null group by user_id having count(*) >= 50
    union all select user_id, 'boite_a_idees' from hg_ideas where status = 'retenue' and user_id is not null
    union all select id, 'fondateur' from hg_profiles where extract(year from created_at)::int = v_first_year
    union all select id, 'fidele' from hg_profiles where created_at <= now() - interval '3 years'
    union all select user_id, 'chasseur_bugs' from hg_support where subject = 'Bug sur le site' and status = 'traitee' and user_id is not null
    union all select user_id, 'saisonnier' from hg_theme_seen group by user_id having count(distinct slug) >= 7
  )
  insert into hg_user_badges(user_id, badge_code)
  select distinct a.user_id, a.code from aw a
  where a.user_id is not null and (p_user is null or a.user_id = p_user)
    and exists(select 1 from hg_profiles p where p.id = a.user_id)
    and exists(select 1 from hg_badges b where b.code = a.code)
  on conflict do nothing;
  get diagnostics c = row_count;
  return c;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_award_level_badges(p_user uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; u record; v numeric; lvl int; n int := 0;
begin
  for b in select * from hg_badges where levels_enabled and metric is not null and jsonb_array_length(levels) > 0 loop
    for u in select id from hg_profiles where p_user is null or id = p_user loop
      v := public.hg_metric_value(u.id, b.metric, b.event_id);
      select max((l->>'level')::int) into lvl from jsonb_array_elements(b.levels) l where v >= (l->>'threshold')::numeric;
      if lvl is not null then
        insert into hg_user_badges(user_id, badge_code, level, level_at) values (u.id, b.code, lvl, now())
        on conflict (user_id, badge_code) do update set level = excluded.level, level_at = now()
          where hg_user_badges.level < excluded.level;
        if found then n := n + 1; end if;
      end if;
    end loop;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_badge_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into hg_activity(user_id, kind, text)
  select new.user_id, 'badge', p.pseudo || ' a débloqué le badge « ' || b.name || ' »'
  from hg_profiles p, hg_badges b where p.id = new.user_id and b.code = new.badge_code;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_badge_level_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.level > old.level then
    insert into hg_activity(user_id, kind, text)
    select new.user_id, 'badge', p.pseudo || ' passe au niveau ' || new.level || ' du badge « ' || b.name || ' »'
    from hg_profiles p, hg_badges b where p.id = new.user_id and b.code = new.badge_code;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select value from hg_settings where key = 'cards'), '{}'::jsonb) $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_check_sets(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s record; bonus int := coalesce((hg_card_cfg()#>>'{rewards,set_complete}')::int, 300);
begin
  for s in select st.id, st.name from hg_card_sets st
    where exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity <> 'identite')
      and not exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity <> 'identite'
        and not exists (select 1 from hg_card_copies x where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
  loop
    if hg_wallet_add(p_user, bonus, 'serie_complete', 'set:' || s.id) then
      insert into hg_activity(user_id, kind, text)
        select p_user, 'cartes', p.pseudo || ' a complété la série « ' || s.name || ' » !' from hg_profiles p where p.id = p_user;
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_craft(p_card uuid, p_shiny boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb := hg_card_cfg(); k hg_cards; cost int; bal int; cp bigint; god boolean := hg_god_mode();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable'; end if;
  cost := (c#>>array['craft', k.rarity])::int;
  if not god and (not k.craftable or k.rarity in ('mythique', 'identite') or cost is null) then raise exception 'Cette carte ne peut pas être fabriquée'; end if;
  cost := coalesce(cost, 0) * case when p_shiny then coalesce((c#>>'{craft,shiny_multiplier}')::int, 4) else 1 end;
  if not god then
    insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
    select paillettes into bal from hg_wallets where user_id = auth.uid() for update;
    if bal < cost then raise exception 'Pas assez de Paillettes (il en faut %)', cost; end if;
    perform hg_wallet_add(auth.uid(), -cost, 'fabrication', null);
  end if;
  cp := hg_card_give(auth.uid(), p_card, p_shiny, 'fabrication');
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('copy_id', cp, 'cost', cost);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_gift(p_to uuid, p_copies bigint[], p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); t uuid; n int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me or not exists (select 1 from hg_profiles where id = p_to) then raise exception 'Destinataire invalide'; end if;
  if coalesce(cardinality(p_copies), 0) = 0 then raise exception 'Aucune carte choisie'; end if;
  select count(*) into n from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if n <> cardinality(p_copies) then raise exception 'Certaines cartes ne peuvent pas être offertes'; end if;
  insert into hg_card_trades(from_user, to_user, status, message, resolved_at) values (me, p_to, 'acceptee', left(coalesce(p_message, 'Cadeau'), 500), now()) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_copies), 'from';
  update hg_card_copies set owner_id = p_to, source = 'cadeau' where id = any(p_copies);
  perform hg_card_check_sets(p_to);
  return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_give(p_user uuid, p_card uuid, p_shiny boolean, p_source text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k hg_cards; s int; cid bigint;
begin
  select * into k from hg_cards where id = p_card for update;
  if not found then raise exception 'Carte introuvable'; end if;
  if k.max_copies is not null then
    select coalesce(max(serial), 0) + 1 into s from hg_card_copies where card_id = p_card;
    if s > k.max_copies then raise exception 'Plus aucun exemplaire disponible pour « % »', k.name; end if;
  end if;
  insert into hg_card_copies(card_id, owner_id, shiny, serial, source)
    values (p_card, p_user, coalesce(p_shiny, false) and k.can_shiny, s, p_source) returning id into cid;
  return cid;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_leaderboard()
 RETURNS TABLE(user_id uuid, pseudo text, avatar_url text, uniques bigint, copies bigint, shinies bigint, identites bigint, series bigint, score bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.pseudo, p.avatar_url,
    count(distinct x.card_id), count(x.id), count(x.id) filter (where x.shiny),
    count(x.id) filter (where k.rarity = 'identite'),
    (select count(*) from hg_wallet_log l where l.user_id = p.id and l.reason = 'serie_complete'),
    coalesce(sum(case k.rarity when 'commune' then 1 when 'peu_commune' then 2 when 'rare' then 5 when 'epique' then 12
      when 'legendaire' then 30 when 'mythique' then 80 when 'identite' then 200 else 0 end * case when x.shiny then 2 else 1 end), 0)::bigint
  from hg_profiles p
  left join hg_card_copies x on x.owner_id = p.id and x.recycled_at is null
  left join hg_cards k on k.id = x.card_id
  where public.hg_is_member() and not p.is_ghost
  group by p.id, p.pseudo, p.avatar_url
  order by 9 desc, 4 desc
$function$
;

CREATE OR REPLACE FUNCTION public.hg_card_pick(p_rarity text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite']; i int; cid uuid;
begin
  i := array_position(ord, p_rarity);
  while i >= 1 loop
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id
     where k.active and s.active and k.rarity = ord[i]
       and (s.starts_at is null or s.starts_at <= now()) and (s.ends_at is null or s.ends_at > now())
       and (k.max_copies is null or (select count(*) from hg_card_copies x where x.card_id = k.id) < k.max_copies)
     order by random() limit 1;
    if cid is not null then return cid; end if;
    i := i - 1;
  end loop;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_quest_claim(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare wk date := date_trunc('week', now() at time zone 'Europe/Zurich')::date;
  ws timestamptz := (wk::timestamp) at time zone 'Europe/Zurich';
  we timestamptz := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
  q hg_card_quests_templates; v numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select t.* into q from hg_card_quests_pick(wk) t where t.code = p_code;
  if not found then raise exception 'Cette quête ne fait pas partie des quêtes de la semaine'; end if;
  v := hg_challenge_value(q.metric, auth.uid(), ws, least(we, now()));
  if v < q.target then raise exception 'Quête pas encore terminée (% sur %)', v, q.target; end if;
  if not hg_wallet_add(auth.uid(), q.reward, 'quete', 'quete:' || wk::text || ':' || q.code) then
    raise exception 'Cette quête a déjà été récompensée cette semaine';
  end if;
  return jsonb_build_object('code', q.code, 'reward', q.reward);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_quests_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare wk date := date_trunc('week', now() at time zone 'Europe/Zurich')::date;
  ws timestamptz := (wk::timestamp) at time zone 'Europe/Zurich';
  we timestamptz := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('week', wk, 'ends_at', we,
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', t.code, 'label', t.label, 'metric', t.metric, 'target', t.target, 'reward', t.reward,
          'progress', v.value, 'done', v.value >= t.target,
          'claimed', exists (select 1 from hg_wallet_log l
            where l.user_id = auth.uid() and l.reason = 'quete' and l.ref = 'quete:' || wk::text || ':' || t.code))
        order by t.sort, t.code)
      from hg_card_quests_pick(wk) t
      cross join lateral (select hg_challenge_value(t.metric, auth.uid(), ws, least(we, now())) as value) v
    ), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_quests_pick(p_week date)
 RETURNS SETOF hg_card_quests_templates
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select t.* from hg_card_quests_templates t
  where t.active
  order by md5(p_week::text || t.code), t.code
  limit 3
$function$
;

CREATE OR REPLACE FUNCTION public.hg_card_rank(p text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select array_position(array['commune','peu_commune','rare','epique','legendaire','mythique','identite'], p) $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_recycle(p_copies bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb := hg_card_cfg(); total int := 0; cnt int := 0; r record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  for r in select x.id, x.shiny, k.rarity from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = auth.uid() and x.recycled_at is null and x.locked_trade is null for update of x
  loop
    if r.rarity = 'identite' then raise exception 'Les cartes Identité ne se recyclent pas'; end if;
    total := total + coalesce((c#>>array['recycle', r.rarity])::int, 0)
      * case when r.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end;
    update hg_card_copies set recycled_at = now() where id = r.id;
    cnt := cnt + 1;
  end loop;
  if cnt <> coalesce(array_length(p_copies, 1), 0) then raise exception 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)'; end if;
  perform hg_wallet_add(auth.uid(), total, 'recyclage', null);
  return total;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_card_roll(p_rates jsonb, p_min integer DEFAULT 1)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  total numeric := 0; acc numeric := 0; r numeric; i int;
begin
  for i in p_min..7 loop total := total + greatest(coalesce((p_rates->>ord[i])::numeric, 0), 0); end loop;
  if total <= 0 then return ord[p_min]; end if;
  r := random() * total;
  for i in p_min..7 loop
    acc := acc + greatest(coalesce((p_rates->>ord[i])::numeric, 0), 0);
    if r < acc then return ord[i]; end if;
  end loop;
  return ord[p_min];
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_admin_audit_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.hg_admin_log(admin_id, action, target_ref, details)
  values (auth.uid(), 'carte_supprimee', old.id::text,
          jsonb_build_object('nom', old.name, 'numero', old.number, 'set_id', old.set_id));
  return old;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_admin_give(p_user uuid, p_card uuid, p_shiny boolean DEFAULT false, p_count integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i int;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  for i in 1..greatest(least(coalesce(p_count, 1), 100), 1) loop perform hg_card_give(p_user, p_card, p_shiny, 'admin'); end loop;
  perform hg_card_check_sets(p_user);
  perform hg_admin_audit('carte_donnee', p_user, p_card::text,
    jsonb_build_object('exemplaires', greatest(least(coalesce(p_count, 1), 100), 1), 'brillante', coalesce(p_shiny, false)));
  return greatest(least(coalesce(p_count, 1), 100), 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_admin_paillettes(p_user uuid, p_delta integer, p_reason text DEFAULT 'admin'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal int;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_wallet_add(p_user, greatest(p_delta, -bal), coalesce(nullif(p_reason, ''), 'admin'), null);
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_admin_audit('ajustement_paillettes', p_user, null,
    jsonb_build_object('demande', p_delta, 'motif', coalesce(nullif(p_reason, ''), 'admin'), 'solde_apres', bal));
  return bal;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_admin_take(p_copy bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  select owner_id into v_owner from hg_card_copies where id = p_copy;
  update hg_card_copies set recycled_at = now(), locked_trade = null where id = p_copy;
  perform hg_admin_audit('exemplaire_retire', v_owner, p_copy::text, '{}'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_daily()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w hg_wallets; c jsonb := hg_card_cfg(); today date := (now() at time zone 'Europe/Zurich')::date; streak int; gain int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  if w.last_daily = today then raise exception 'Déjà récupéré aujourd''hui'; end if;
  streak := case when w.last_daily = today - 1 then least(w.daily_streak + 1, coalesce((c#>>'{rewards,streak_max}')::int, 7)) else 1 end;
  gain := coalesce((c#>>'{rewards,daily}')::int, 20) + (streak - 1) * coalesce((c#>>'{rewards,streak_bonus}')::int, 5);
  update hg_wallets set last_daily = today, daily_streak = streak where user_id = auth.uid();
  perform hg_wallet_add(auth.uid(), gain, 'quotidien', today::text);
  return jsonb_build_object('gain', gain, 'streak', streak);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_earn_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb := hg_card_cfg()->'rewards';
begin
  begin
    if tg_table_name = 'hg_event_rsvps' then
      if new.status = 'oui' then perform hg_wallet_add(new.user_id, coalesce((r->>'rsvp')::int, 15), 'reponse_sortie', 'rsvp:' || new.event_id); end if;
    elsif tg_table_name = 'hg_events' then
      if not coalesce(new.retro, false) then perform hg_wallet_add(new.created_by, coalesce((r->>'event_created')::int, 25), 'sortie_creee', 'event:' || new.id); end if;
    elsif tg_table_name = 'hg_photos' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'photo')::int, 2), 'photo', 'photo:' || new.id);
    elsif tg_table_name = 'hg_moments' then
      perform hg_wallet_add(new.created_by, coalesce((r->>'moment')::int, 15), 'moment', 'moment:' || new.id);
    elsif tg_table_name = 'hg_user_badges' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'badge')::int, 40), 'badge', 'badge:' || new.badge_code);
    elsif tg_table_name = 'hg_dyn_captures' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'capture')::int, 10), 'capture', 'capture:' || new.event_id);
    elsif tg_table_name = 'hg_ss_participants' then
      if new.sent_at is not null then perform hg_wallet_add(new.user_id, coalesce((r->>'gift_sent')::int, 50), 'cadeau_santa', 'santa:' || new.edition_id); end if;
    end if;
  exception when others then
    -- Ne plus avaler l'erreur : elle reste visible dans les journaux Supabase.
    raise warning 'hg_cards_earn_trg (%) : %', tg_table_name, sqlerrm;
  end;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w hg_wallets; c jsonb := hg_card_cfg(); hrs numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid();
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  return jsonb_build_object(
    'paillettes', w.paillettes, 'boosters_opened', w.boosters_opened, 'pity', w.pity_epique,
    'daily_streak', w.daily_streak,
    'daily_available', w.last_daily is distinct from (now() at time zone 'Europe/Zurich')::date,
    'free_booster_at', case when w.last_free_booster is null then now() else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'god', hg_god_mode(), 'config', c);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_cards_presence()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n int := 0; g int := coalesce((hg_card_cfg()#>>'{rewards,presence}')::int, 30);
begin
  for r in select v.user_id, v.event_id from hg_event_rsvps v join hg_events e on e.id = v.event_id
    where v.status = 'oui' and e.starts_at < now() and e.starts_at > now() - interval '60 days'
  loop
    if hg_wallet_add(r.user_id, g, 'presence', 'presence:' || r.event_id) then n := n + 1; end if;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_challenge_value(p_metric text, p_user uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (case p_metric
    when 'sorties_tenues' then (select count(*) from hg_events e
      where e.starts_at >= p_start and e.starts_at < p_end
        and (p_user is null or exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user and r.status = 'oui')))
    when 'participations' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and e.starts_at >= p_start and e.starts_at < p_end and (p_user is null or r.user_id = p_user))
    when 'photos_ajoutees' then (select count(*) from hg_photos x
      where x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'souvenirs_publies' then (select count(*) from hg_moments x
      where x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.created_by = p_user))
    when 'boosters_ouverts' then (select count(*) from hg_wallet_log x
      where x.reason = 'booster_requete' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'cartes_recyclees' then (select count(*) from hg_card_copies x
      where x.recycled_at >= p_start and x.recycled_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'echanges_conclus' then (select count(*) from hg_card_trades x
      where x.status = 'acceptee' and x.resolved_at >= p_start and x.resolved_at < p_end
        and (p_user is null or p_user in (x.from_user, x.to_user)))
    when 'passages_du_jour' then (select count(*) from hg_wallet_log x
      where x.reason = 'quotidien' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    else 0 end)::numeric
$function$
;

CREATE OR REPLACE FUNCTION public.hg_challenges_active()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description, 'metric', c.metric,
        'target', c.target, 'reward', c.reward, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
        'progress', v.value, 'done', v.value >= c.target, 'ended', c.ends_at <= now(),
        'credited', exists (select 1 from hg_wallet_log l
          where l.user_id = auth.uid() and l.reason = 'defi' and l.ref = 'defi:' || c.id::text))
      order by c.ends_at)
    from hg_challenges c
    cross join lateral (select hg_challenge_value(c.metric, null, c.starts_at, least(c.ends_at, now())) as value) v
    where c.active and c.ends_at > now() - interval '1 day'
  ), '[]'::jsonb);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_challenges_award()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c hg_challenges; r record; v numeric; n int := 0;
begin
  for c in select * from hg_challenges where active loop
    v := hg_challenge_value(c.metric, null, c.starts_at, least(c.ends_at, now()));
    continue when v < c.target;
    for r in select p.id from hg_profiles p
      where not p.is_ghost
        and not exists (select 1 from hg_wallet_log l where l.user_id = p.id and l.reason = 'defi' and l.ref = 'defi:' || c.id::text)
    loop
      if hg_wallet_add(r.id, c.reward, 'defi', 'defi:' || c.id::text) then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_claim_invite_link(p_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare l hg_invite_links; v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; v_recent int;
begin
  select * into l from hg_invite_links where token = p_token for update;
  if l.id is null or not l.active or (l.expires_at is not null and l.expires_at < now())
     or (l.max_codes is not null and l.codes_generated >= l.max_codes) then
    raise exception 'Lien d''invitation invalide ou expiré';
  end if;
  -- garde-fou anti-abus : 30 codes non utilisés max par heure et par lien
  select count(*) into v_recent from hg_invites where link_id = l.id and used_by is null and created_at > now() - interval '1 hour';
  if v_recent >= 30 then raise exception 'Trop de demandes, réessaie plus tard'; end if;
  loop
    v_code := 'HG-';
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists(select 1 from hg_invites where code = v_code);
  end loop;
  insert into hg_invites(code, created_by, link_id, expires_at) values (v_code, l.created_by, l.id, now() + interval '48 hours');
  update hg_invite_links set codes_generated = codes_generated + 1 where id = l.id;
  return v_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_conv_member(p_conv uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.hg_conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid()
  )
$function$
;

CREATE OR REPLACE FUNCTION public.hg_conv_title(c hg_conversations, me uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when c.kind = 'santa' and me = c.target_id then 'Ton Santa ' || coalesce((select year::text from hg_ss_editions where id = c.edition_id), '')
    when c.kind = 'santa' and me = c.santa_id then 'Ta cible : ' || coalesce((select pseudo from hg_profiles where id = c.target_id), '?')
    else coalesce((select p.pseudo from hg_conversation_members m join hg_profiles p on p.id = m.user_id
                   where m.conversation_id = c.id and m.user_id <> me limit 1), 'Conversation')
  end $function$
;

CREATE OR REPLACE FUNCTION public.hg_conv_topic_member(p_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_topic is null or p_topic !~ '^conv:[0-9a-fA-F-]{36}$' then return false; end if;
  return public.hg_conv_member(substr(p_topic, 6)::uuid);
exception when others then
  return false;
end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  delete from public.hg_profiles where id = v_uid;
  if not exists (select 1 from public.d_projects where owner_id = v_uid)
     and not exists (select 1 from public.d_settings where user_id = v_uid) then
    delete from auth.users where id = v_uid;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_dyn_active()
 RETURNS TABLE(id uuid, name text, description text, image_url text, emoji text, ends_at timestamp with time zone, probability numeric, max_per_page integer, duration_ms integer, size_px integer, my_captures integer, max_per_user integer, remaining_total integer, badge_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.id, e.name, e.description, e.image_url, e.emoji, e.ends_at, e.probability, e.max_per_page, e.duration_ms, e.size_px,
         (select count(*)::int from hg_dyn_captures c where c.event_id = e.id and c.user_id = auth.uid()),
         e.max_per_user,
         case when e.max_total is null then null else e.max_total - (select count(*)::int from hg_dyn_captures c where c.event_id = e.id) end,
         e.badge_code
  from hg_dyn_events e
  where public.hg_is_member() and e.active and now() between e.starts_at and e.ends_at $function$
;

CREATE OR REPLACE FUNCTION public.hg_dyn_capture(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e hg_dyn_events; mine int; total int; v_badge_new boolean := false; v_god boolean := public.hg_god_mode();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into e from hg_dyn_events where id = p_event and (v_god or (active and now() between starts_at and ends_at));
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'termine'); end if;
  select count(*) into mine from hg_dyn_captures where event_id = e.id and user_id = auth.uid();
  if not v_god and e.max_per_user is not null and mine >= e.max_per_user then return jsonb_build_object('ok', false, 'reason', 'limite_perso', 'mine', mine); end if;
  select count(*) into total from hg_dyn_captures where event_id = e.id;
  if not v_god and e.max_total is not null and total >= e.max_total then return jsonb_build_object('ok', false, 'reason', 'epuise', 'mine', mine); end if;
  insert into hg_dyn_captures(event_id, user_id) values (e.id, auth.uid());
  mine := mine + 1;
  if e.badge_code is not null and exists(select 1 from hg_badges where code = e.badge_code and not levels_enabled) then
    insert into hg_user_badges(user_id, badge_code) values (auth.uid(), e.badge_code) on conflict do nothing;
    v_badge_new := found;
  end if;
  perform public.hg_award_level_badges(auth.uid());
  return jsonb_build_object('ok', true, 'mine', mine, 'badge_new', v_badge_new);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_dyn_leaderboard(p_event uuid)
 RETURNS TABLE(user_id uuid, pseudo text, avatar_url text, captures integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.pseudo, p.avatar_url, count(*)::int from hg_dyn_captures c join hg_profiles p on p.id = c.user_id
  where c.event_id = p_event and public.hg_is_member() group by p.id order by count(*) desc, min(c.captured_at) limit 50 $function$
;

CREATE OR REPLACE FUNCTION public.hg_export_my_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'profil', (select to_jsonb(p) from hg_profiles p where id = auth.uid()),
  'infos_profil', (select to_jsonb(x) from hg_profile_info x where user_id = auth.uid()),
  'secret_santa_participations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_participants x where user_id = auth.uid()),
  'souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_wishes x where user_id = auth.uid()),
  'reponses_irl', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_rsvps x where user_id = auth.uid()),
  'sorties_creees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_events x where created_by = auth.uid()),
  'votes_dates', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_date_votes x where user_id = auth.uid()),
  'photos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_photos x where user_id = auth.uid()),
  'moments_crees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_moments x where created_by = auth.uid()),
  'messages_envoyes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from hg_messages x where sender_id = auth.uid()),
  'conversations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_conversation_members x where user_id = auth.uid()),
  'idees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ideas x where user_id = auth.uid()),
  'assistance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_support x where user_id = auth.uid()),
  'badges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_user_badges x where user_id = auth.uid()),
  'captures_evenements', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_dyn_captures x where user_id = auth.uid()),
  'jeu_de_cartes', jsonb_build_object(
    'portefeuille', (select to_jsonb(w) from hg_wallets w where user_id = auth.uid()),
    'journal', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from hg_wallet_log x where user_id = auth.uid()),
    'exemplaires', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_copies x where owner_id = auth.uid()),
    'echanges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_trades x where from_user = auth.uid() or to_user = auth.uid()),
    'liste_souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_wishlist x where user_id = auth.uid()),
    'vitrine', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_showcase x where user_id = auth.uid())
  )
);
$function$
;

CREATE OR REPLACE FUNCTION public.hg_get_messages(p_conv uuid, p_after bigint DEFAULT 0, p_limit integer DEFAULT 200)
 RETURNS TABLE(id bigint, mine boolean, sender_label text, body text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select x.id, x.sender_id = auth.uid(),
         case when x.sender_id = auth.uid() then 'Moi'
              when c.kind = 'santa' and x.sender_id = c.santa_id then 'Ton Santa'
              else coalesce(p.pseudo, 'Ancien membre') end,
         x.body, x.created_at
  from hg_messages x join hg_conversations c on c.id = x.conversation_id
  left join hg_profiles p on p.id = x.sender_id
  where x.conversation_id = p_conv and x.id > coalesce(p_after, 0)
    and exists(select 1 from hg_conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid())
  order by x.id asc limit least(coalesce(p_limit, 200), 500) $function$
;

CREATE OR REPLACE FUNCTION public.hg_ghost_create(p_pseudo text, p_joined_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := gen_random_uuid();
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  if coalesce(trim(p_pseudo), '') = '' then raise exception 'Pseudo obligatoire'; end if;
  insert into hg_profiles(id, pseudo, joined_on, is_ghost, ghost_note, bot_optin, share_birthday)
    values (v_id, trim(p_pseudo), p_joined_on, true, nullif(trim(p_note), ''), false, false);
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ghost_invite(p_ghost uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  if not exists(select 1 from hg_profiles where id = p_ghost and is_ghost) then raise exception 'Compte fantôme introuvable'; end if;
  update hg_invites set expires_at = now() where ghost_id = p_ghost and used_by is null and (expires_at is null or expires_at > now());
  loop
    v_code := 'HG-';
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists(select 1 from hg_invites where code = v_code);
  end loop;
  insert into hg_invites(code, created_by, ghost_id, expires_at) values (v_code, auth.uid(), p_ghost, now() + interval '60 days');
  return v_code;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ghost_merge(p_ghost uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g hg_profiles; u hg_profiles; r record; moved int := 0; n int; rr record;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  select * into g from hg_profiles where id = p_ghost and is_ghost for update;
  if not found then raise exception 'Compte fantôme introuvable'; end if;
  select * into u from hg_profiles where id = p_user and not is_ghost for update;
  if not found then raise exception 'Compte inscrit introuvable'; end if;
  for r in select c.conrelid::regclass as tbl, a.attname as col
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.hg_profiles'::regclass and array_length(c.conkey, 1) = 1
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_user, p_ghost;
      get diagnostics n = row_count; moved := moved + n;
    exception when unique_violation then
      -- doublon (ex. même badge des deux côtés) : on déplace ligne par ligne et on laisse les doublons au fantôme
      for rr in execute format('select ctid from %s where %I = $1', r.tbl, r.col) using p_ghost loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using p_user, rr.ctid;
          moved := moved + 1;
        exception when unique_violation then null;
        end;
      end loop;
    end;
  end loop;
  -- Champs du profil : on complète ce qui est vide côté compte inscrit
  update hg_profiles set
    joined_on = coalesce(g.joined_on, joined_on),
    birthday = coalesce(birthday, g.birthday),
    discord_id = coalesce(discord_id, g.discord_id),
    avatar_url = coalesce(avatar_url, g.avatar_url)
  where id = p_user;
  execute 'del' || 'ete from public.hg_profiles where id = $1 and is_ghost' using p_ghost;
  insert into hg_activity(user_id, kind, text) values (p_user, 'join', u.pseudo || ' a récupéré son histoire dans le gang');
  return jsonb_build_object('moved', moved);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ghost_suggestions()
 RETURNS TABLE(ghost_id uuid, ghost_pseudo text, user_id uuid, user_pseudo text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  return query
    select g.id, g.pseudo, p.id, p.pseudo,
      case when g.discord_id is not null and g.discord_id = p.discord_id then 'Même ID Discord' else 'Même pseudo' end
    from hg_profiles g join hg_profiles p on not p.is_ghost
     and ((g.discord_id is not null and g.discord_id = p.discord_id) or lower(trim(g.pseudo)) = lower(trim(p.pseudo)))
    where g.is_ghost;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_god_mode()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.hg_is_admin() and exists(select 1 from hg_admin_state where user_id = auth.uid() and god_until > now()) $function$
;

CREATE OR REPLACE FUNCTION public.hg_has_perm(p_perm text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.hg_is_admin() or exists (
    select 1 from public.hg_staff s
    where s.user_id = auth.uid() and s.active and p_perm = any(s.perms)
  )
$function$
;

CREATE OR REPLACE FUNCTION public.hg_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select is_admin from public.hg_profiles where id = auth.uid()), false) $function$
;

CREATE OR REPLACE FUNCTION public.hg_is_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from public.hg_profiles where id = auth.uid()) $function$
;

CREATE OR REPLACE FUNCTION public.hg_is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.hg_is_admin() or exists (
    select 1 from public.hg_staff s
    where s.user_id = auth.uid() and s.active and cardinality(s.perms) > 0
  )
$function$
;

CREATE OR REPLACE FUNCTION public.hg_join(p_code text, p_pseudo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_inviter uuid; v_ghost uuid; v_pseudo text;
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  if exists(select 1 from hg_profiles where id = v_uid) then return; end if;
  update hg_invites set used_by = v_uid, used_at = now()
   where upper(code) = upper(trim(p_code)) and used_by is null and (expires_at is null or expires_at > now())
   returning created_by, ghost_id into v_inviter, v_ghost;
  if not found then raise exception 'Code d''invitation invalide, expiré ou déjà utilisé'; end if;
  -- Lien général : si le pseudo choisi est celui d'un compte fantôme, la personne récupère ce fantôme
  if v_ghost is null then
    select id into v_ghost from hg_profiles where is_ghost and lower(trim(pseudo)) = lower(trim(p_pseudo)) limit 1;
  end if;
  if v_ghost is not null and exists(select 1 from hg_profiles where id = v_ghost and is_ghost) then
    update hg_profiles set id = v_uid, is_ghost = false where id = v_ghost returning pseudo into v_pseudo;
  else
    v_pseudo := trim(p_pseudo);
    insert into hg_profiles(id, pseudo) values (v_uid, v_pseudo);
  end if;
  insert into hg_activity(user_id, kind, text) values (v_uid, 'join', v_pseudo || ' a rejoint le gang');
  if v_inviter is not null and exists(select 1 from hg_profiles where id = v_inviter) then
    insert into hg_user_badges(user_id, badge_code) values (v_inviter, 'cupidon') on conflict do nothing;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_mark_read(p_conv uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update hg_conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION public.hg_mark_theme_seen(p_slug text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into hg_theme_seen(user_id, slug) select auth.uid(), p_slug
  where public.hg_is_member() and exists(select 1 from hg_themes where slug = p_slug and not is_default)
  on conflict do nothing $function$
;

CREATE OR REPLACE FUNCTION public.hg_member_card(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not public.hg_is_member() then null else (
    select jsonb_build_object(
      'id', p.id, 'pseudo', p.pseudo, 'avatar_url', p.avatar_url, 'color', p.color,
      'member_since', coalesce(p.joined_on::timestamptz, p.created_at), 'joined_on', p.joined_on,
      'birthday_dm', case when p.share_birthday and p.birthday is not null then to_char(p.birthday, 'DD.MM') end,
      'member_number', p.member_number, 'is_ghost', p.is_ghost,
      'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'description', b.description, 'image_url', b.image_url, 'awarded_at', ub.awarded_at) order by b.sort)
                          from hg_user_badges ub join hg_badges b on b.code = ub.badge_code where ub.user_id = p.id), '[]'),
      'stats', jsonb_build_object(
        'secret_santa', (select count(*) from hg_ss_participants where user_id = p.id),
        'sorties', (select count(*) from hg_event_rsvps r join hg_events ev on ev.id = r.event_id where r.user_id = p.id and r.status = 'oui' and ev.starts_at < now()),
        'organisees', (select count(*) from hg_events where created_by = p.id),
        'photos', (select count(*) from hg_photos where user_id = p.id),
        'moments', (select count(*) from hg_moments where created_by = p.id)))
    from hg_profiles p where p.id = p_user and (not p.is_ghost or public.hg_is_admin())) end $function$
;

CREATE OR REPLACE FUNCTION public.hg_members()
 RETURNS TABLE(id uuid, pseudo text, avatar_url text, color text, member_since timestamp with time zone, birthday_dm text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.pseudo, p.avatar_url, p.color, coalesce(p.joined_on::timestamptz, p.created_at),
         case when p.share_birthday and p.birthday is not null then to_char(p.birthday, 'DD.MM') end
    from public.hg_profiles p
   where public.hg_is_member() and not p.is_ghost
   order by p.pseudo
$function$
;

CREATE OR REPLACE FUNCTION public.hg_metric_value(p_user uuid, p_metric text, p_event uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_metric
    when 'anciennete_annees' then (select floor(extract(epoch from (now() - coalesce(joined_on::timestamptz, created_at))) / 31557600) from hg_profiles where id = p_user)
    when 'secret_santa' then (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = p_user and e.status in ('revelation','termine') and pt.sent_at is not null)
    when 'sorties' then (select count(*) from hg_event_rsvps r join hg_events ev on ev.id = r.event_id where r.user_id = p_user and r.status = 'oui' and ev.starts_at < now())
    when 'sorties_organisees' then (select count(*) from hg_events where created_by = p_user)
    when 'photos' then (select count(*) from hg_photos where user_id = p_user)
    when 'moments' then (select count(*) from hg_moments where created_by = p_user)
    when 'messages' then (select count(*) from hg_messages where sender_id = p_user)
    when 'idees_retenues' then (select count(*) from hg_ideas where user_id = p_user and status = 'retenue')
    when 'event_captures' then (select count(*) from hg_dyn_captures where user_id = p_user and (p_event is null or event_id = p_event))
    when 'events_dynamiques' then (select count(distinct event_id) from hg_dyn_captures where user_id = p_user)
    else 0 end $function$
;

CREATE OR REPLACE FUNCTION public.hg_msg_push_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_secret text;
begin
  select value into v_secret from public.hg_private where key = 'cron_secret';
  if v_secret is null or v_secret = '' then return null; end if;
  perform net.http_post(
    url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
  );
  return null;
exception when others then
  raise warning 'hg_msg_push_trg : %', sqlerrm;
  return null;
end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_msg_realtime_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'realtime'
AS $function$
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id, 'id', new.id, 'created_at', new.created_at),
    'new_message',
    'conv:' || new.conversation_id::text,
    true
  );
  return null;
exception when others then
  raise warning 'hg_msg_realtime_trg : %', sqlerrm;
  return null;
end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_my_badge_progress()
 RETURNS TABLE(badge_code text, metric text, value numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.code, b.metric, public.hg_metric_value(auth.uid(), b.metric, b.event_id)
    from public.hg_badges b
   where public.hg_is_member() and auth.uid() is not null
     and b.levels_enabled and b.metric is not null
$function$
;

CREATE OR REPLACE FUNCTION public.hg_my_conversations()
 RETURNS TABLE(id uuid, kind text, title text, other_id uuid, last_message_at timestamp with time zone, last_body text, last_mine boolean, unread integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.kind, hg_conv_title(c, auth.uid()),
         case when c.kind = 'santa' and auth.uid() = c.target_id then null
              else (select m2.user_id from hg_conversation_members m2 where m2.conversation_id = c.id and m2.user_id <> auth.uid() limit 1) end,
         c.last_message_at,
         (select left(body, 140) from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select x.sender_id = auth.uid() from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select count(*)::int from hg_messages x where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid())
  from hg_conversation_members m join hg_conversations c on c.id = m.conversation_id
  where m.user_id = auth.uid() and public.hg_is_member()
  order by c.last_message_at desc $function$
;

CREATE OR REPLACE FUNCTION public.hg_my_pages()
 RETURNS TABLE(slug text, label text, in_nav boolean, sort integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.slug, p.label, p.in_nav, p.sort from hg_pages p
  where public.hg_is_member() and (
    public.hg_is_admin()
    or (p.mode = 'membres' and not exists(select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = auth.uid() and not a.allowed))
    or (p.mode = 'liste' and exists(select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = auth.uid() and a.allowed)))
  order by p.sort $function$
;

CREATE OR REPLACE FUNCTION public.hg_my_perms()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null then jsonb_build_object('is_admin', false, 'perms', '[]'::jsonb)
    when public.hg_is_admin() then jsonb_build_object('is_admin', true,
      'perms', coalesce((select jsonb_agg(key order by sort) from public.hg_perm_catalog), '[]'::jsonb))
    else jsonb_build_object('is_admin', false, 'perms', coalesce((
      select to_jsonb(s.perms) from public.hg_staff s where s.user_id = auth.uid() and s.active), '[]'::jsonb))
  end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_open_booster(p_free boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; price int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  n := greatest(coalesce((c->>'booster_size')::int, 5), 1);
  price := coalesce((c->>'booster_price')::int, 100);
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  pity := coalesce((c->>'pity_epique')::int, 10);
  if not god then
    if p_free then
      if w.last_free_booster is not null and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
        raise exception 'Le booster gratuit n''est pas encore disponible';
      end if;
      update hg_wallets set last_free_booster = now() where user_id = auth.uid();
    else
      if w.paillettes < price then raise exception 'Pas assez de Paillettes (il en faut %)', price; end if;
      perform hg_wallet_add(auth.uid(), -price, 'booster', null);
    end if;
  end if;
  for i in 1..n loop
    if i = n and best < 4 and pity > 0 and w.pity_epique + 1 >= pity then rar := hg_card_roll(c->'rates', 4);
    else rar := hg_card_roll(c->'rates', 1); end if;
    cid := hg_card_pick(rar);
    continue when cid is null;
    sh := random() * 100 < coalesce((c->>'shiny_rate')::numeric, 3);
    cp := hg_card_give(auth.uid(), cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
      'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select shiny from hg_card_copies where id = cp), 'serial', (select serial from hg_card_copies where id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select auth.uid(), 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !' from hg_profiles p where p.id = auth.uid();
    end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;
  update hg_wallets set boosters_opened = boosters_opened + 1,
    pity_epique = case when best >= 4 then 0 else pity_epique + 1 end, updated_at = now() where user_id = auth.uid();
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('cards', out, 'best', ord[best]);
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_open_booster_req(p_free boolean DEFAULT false, p_request text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; price int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  -- Idempotence : le verrou ci-dessus sérialise les appels ; une même requête ne peut
  -- ouvrir qu'un seul booster. Un second envoi (réseau coupé, double clic) lève cette erreur.
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = auth.uid() and ref = 'booster:' || p_request) then
      raise exception 'booster_deja_ouvert' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref)
      values (auth.uid(), 0, 'booster_requete', 'booster:' || p_request);
  end if;
  n := greatest(coalesce((c->>'booster_size')::int, 5), 1);
  price := coalesce((c->>'booster_price')::int, 100);
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  pity := coalesce((c->>'pity_epique')::int, 10);
  if not god then
    if p_free then
      if w.last_free_booster is not null and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
        raise exception 'Le booster gratuit n''est pas encore disponible';
      end if;
      update hg_wallets set last_free_booster = now() where user_id = auth.uid();
    else
      if w.paillettes < price then raise exception 'Pas assez de Paillettes (il en faut %)', price; end if;
      perform hg_wallet_add(auth.uid(), -price, 'booster', null);
    end if;
  end if;
  for i in 1..n loop
    if i = n and best < 4 and pity > 0 and w.pity_epique + 1 >= pity then rar := hg_card_roll(c->'rates', 4);
    else rar := hg_card_roll(c->'rates', 1); end if;
    cid := hg_card_pick(rar);
    continue when cid is null;
    sh := random() * 100 < coalesce((c->>'shiny_rate')::numeric, 3);
    cp := hg_card_give(auth.uid(), cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
      'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select shiny from hg_card_copies where id = cp), 'serial', (select serial from hg_card_copies where id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select auth.uid(), 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !' from hg_profiles p where p.id = auth.uid();
    end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;
  update hg_wallets set boosters_opened = boosters_opened + 1,
    pity_epique = case when best >= 4 then 0 else pity_epique + 1 end, updated_at = now() where user_id = auth.uid();
  perform hg_card_check_sets(auth.uid());
  -- J3 : le client affiche le nombre réellement livré au lieu du nombre payé.
  return jsonb_build_object('cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out));
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_open_direct(p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := auth.uid(); v_key text; v_id uuid;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_user = v_me or not exists(select 1 from hg_profiles where id = p_user and not is_ghost) then raise exception 'Destinataire invalide'; end if;
  v_key := least(v_me::text, p_user::text) || ':' || greatest(v_me::text, p_user::text);
  select id into v_id from hg_conversations where direct_key = v_key;
  if v_id is null then
    insert into hg_conversations(kind, direct_key) values ('direct', v_key) returning id into v_id;
    insert into hg_conversation_members(conversation_id, user_id) values (v_id, v_me), (v_id, p_user);
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_open_santa(p_edition uuid, p_role text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_me uuid := auth.uid(); v_santa uuid; v_target uuid; v_id uuid;
begin
  if p_role = 'target' then
    select giver_id, receiver_id into v_santa, v_target from hg_ss_assignments where edition_id = p_edition and giver_id = v_me;
  elsif p_role = 'santa' then
    select giver_id, receiver_id into v_santa, v_target from hg_ss_assignments where edition_id = p_edition and receiver_id = v_me;
  else raise exception 'Rôle invalide'; end if;
  if v_santa is null then raise exception 'Pas d''attribution pour cette édition'; end if;
  select id into v_id from hg_conversations where edition_id = p_edition and santa_id = v_santa;
  if v_id is null then
    insert into hg_conversations(kind, edition_id, santa_id, target_id) values ('santa', p_edition, v_santa, v_target) returning id into v_id;
    insert into hg_conversation_members(conversation_id, user_id) values (v_id, v_santa), (v_id, v_target);
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_profiles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.is_admin is distinct from old.is_admin and not public.hg_is_admin() then
    new.is_admin := old.is_admin;
  end if;
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_profiles_sync_joined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    new.account_created_at := coalesce(new.account_created_at, now());
    new.joined_on := coalesce(new.joined_on, (now() at time zone 'Europe/Zurich')::date);
  elsif new.joined_on is null then
    new.joined_on := coalesce(old.joined_on, (new.created_at at time zone 'Europe/Zurich')::date);
  end if;
  new.created_at := make_timestamptz(extract(year from new.joined_on)::int, extract(month from new.joined_on)::int, extract(day from new.joined_on)::int, 12, 0, 0, 'Europe/Zurich');
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_refresh_my_badges()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.hg_is_member() then public.hg_award_badges(auth.uid()) + public.hg_award_level_badges(auth.uid()) else 0 end $function$
;

CREATE OR REPLACE FUNCTION public.hg_send_message(p_conv uuid, p_body text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint; v_body text := trim(p_body);
begin
  if not exists(select 1 from hg_conversation_members where conversation_id = p_conv and user_id = auth.uid()) then
    raise exception 'Conversation introuvable'; end if;
  if char_length(v_body) = 0 then raise exception 'Message vide'; end if;
  insert into hg_messages(conversation_id, sender_id, body) values (p_conv, auth.uid(), left(v_body, 4000)) returning id into v_id;
  update hg_conversations set last_message_at = now() where id = p_conv;
  update hg_conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_set_god_mode(p_on boolean, p_minutes integer DEFAULT 30)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_until timestamptz;
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  v_until := case when p_on then now() + make_interval(mins => greatest(5, least(coalesce(p_minutes, 30), 240))) else null end;
  insert into hg_admin_state(user_id, god_until, updated_at) values (auth.uid(), v_until, now())
  on conflict (user_id) do update set god_until = excluded.god_until, updated_at = now();
  return v_until;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_settings_perm(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_key
    when 'cards' then 'cartes'
    when 'bot' then 'bot'
    when 'bot_templates' then 'bot'
    when 'theme' then 'themes'
    when 'push_vapid_public' then null
    when 'domursan_owner' then null
    when 'admin_initial' then null
    else 'reglages'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_draw(p_edition uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[]; v_perm uuid[]; v_n int; v_try int := 0; v_ok boolean; i int;
  v_year int; v_prev uuid; v_god boolean := public.hg_god_mode();
begin
  if not public.hg_has_perm('secret_santa') then raise exception 'Réservé à l''admin'; end if;
  if exists(select 1 from hg_ss_assignments where edition_id = p_edition) then
    raise exception 'Le tirage a déjà été fait pour cette édition%', case when v_god then ' (mode sans limite : efface d''abord les attributions)' else '' end;
  end if;
  select year into v_year from hg_ss_editions where id = p_edition;
  select id into v_prev from hg_ss_editions where year = v_year - 1;
  select array_agg(user_id) into v_ids from hg_ss_participants where edition_id = p_edition;
  v_n := coalesce(array_length(v_ids,1),0);
  if v_n < (case when v_god then 1 else 3 end) then
    raise exception 'Il faut au moins % participant(s)', case when v_god then 1 else 3 end;
  end if;
  if v_god and v_n = 1 then
    v_perm := v_ids;  -- mode sans limite : un seul participant s'offre à lui-même (tests)
  else
    loop
      v_try := v_try + 1;
      if v_try > 2000 then raise exception 'Impossible de trouver un tirage avec ces exclusions'; end if;
      select array_agg(x order by random()) into v_perm from unnest(v_ids) x;
      v_ok := true;
      for i in 1..v_n loop
        if v_ids[i] = v_perm[i]
           or (not v_god and exists(select 1 from hg_ss_exclusions e where e.edition_id = p_edition
                     and ((e.user_a = v_ids[i] and e.user_b = v_perm[i]) or (e.user_b = v_ids[i] and e.user_a = v_perm[i]))))
           or (not v_god and v_prev is not null and exists(select 1 from hg_ss_assignments pa where pa.edition_id = v_prev
                     and pa.giver_id = v_ids[i] and pa.receiver_id = v_perm[i])) then
          v_ok := false; exit;
        end if;
      end loop;
      exit when v_ok;
    end loop;
  end if;
  for i in 1..v_n loop
    insert into hg_ss_assignments(edition_id, giver_id, receiver_id) values (p_edition, v_ids[i], v_perm[i]);
  end loop;
  update hg_ss_editions set status = 'envoi', drawn_at = now() where id = p_edition;
  insert into hg_activity(user_id, kind, text) values (null, 'ss_draw', 'Le tirage du Secret Santa ' || v_year || ' est fait !');
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_editions_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_god_mode() and exists(select 1 from hg_ss_editions where status <> 'termine') then
    raise exception 'Termine d''abord l''édition en cours avant d''en créer une nouvelle';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_is_santa_of(p_edition uuid, p_receiver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from hg_ss_assignments a where a.edition_id = p_edition and a.giver_id = auth.uid() and a.receiver_id = p_receiver) $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_manual_draw(p_edition uuid, p_pairs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_parts uuid[]; v_g uuid[]; v_r uuid[]; v_n int; v_year int; v_god boolean := public.hg_god_mode();
begin
  if not public.hg_has_perm('secret_santa') then raise exception 'Réservé à l''admin'; end if;
  if exists(select 1 from hg_ss_assignments where edition_id = p_edition) then raise exception 'Le tirage a déjà été fait pour cette édition'; end if;
  select array_agg(user_id order by user_id) into v_parts from hg_ss_participants where edition_id = p_edition;
  v_n := coalesce(array_length(v_parts, 1), 0);
  if v_n < (case when v_god then 1 else 2 end) then raise exception 'Il faut au moins % participant(s)', case when v_god then 1 else 2 end; end if;
  select array_agg((e->>'giver')::uuid order by (e->>'giver')::uuid), array_agg((e->>'receiver')::uuid order by (e->>'receiver')::uuid)
    into v_g, v_r from jsonb_array_elements(p_pairs) e;
  if v_g is distinct from v_parts then raise exception 'Chaque participant doit offrir exactement une fois'; end if;
  if v_r is distinct from v_parts then raise exception 'Chaque participant doit recevoir exactement une fois'; end if;
  if not v_god and exists(select 1 from jsonb_array_elements(p_pairs) e where e->>'giver' = e->>'receiver') then raise exception 'Personne ne peut s''offrir à soi-même'; end if;
  insert into hg_ss_assignments(edition_id, giver_id, receiver_id)
    select p_edition, (e->>'giver')::uuid, (e->>'receiver')::uuid from jsonb_array_elements(p_pairs) e;
  select year into v_year from hg_ss_editions where id = p_edition;
  update hg_ss_editions set status = 'envoi', drawn_at = now() where id = p_edition;
  insert into hg_activity(user_id, kind, text) values (null, 'ss_draw', 'Le tirage du Secret Santa ' || v_year || ' est fait !');
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_my_target(p_edition uuid)
 RETURNS TABLE(receiver_id uuid, pseudo text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select a.receiver_id, p.pseudo, p.avatar_url from hg_ss_assignments a join hg_profiles p on p.id = a.receiver_id
   where a.edition_id = p_edition and a.giver_id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_progress(p_edition uuid)
 RETURNS TABLE(participants integer, sent integer, received integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select count(*)::int, count(sent_at)::int, count(received_at)::int from hg_ss_participants
   where edition_id = p_edition and public.hg_is_member() $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_reveal(p_edition uuid)
 RETURNS TABLE(giver text, receiver text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select g.pseudo, r.pseudo from hg_ss_assignments a
   join hg_ss_editions e on e.id = a.edition_id and e.status in ('revelation','termine')
   join hg_profiles g on g.id = a.giver_id join hg_profiles r on r.id = a.receiver_id
   where a.edition_id = p_edition and public.hg_is_member() order by g.pseudo $function$
;

CREATE OR REPLACE FUNCTION public.hg_ss_target_info(p_edition uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_object_agg(k, i.data -> k)
    from hg_ss_assignments a
    join hg_ss_editions e on e.id = a.edition_id
    join hg_profile_info i on i.user_id = a.receiver_id
    cross join lateral unnest(e.shared_fields) k
    where a.edition_id = p_edition and a.giver_id = auth.uid() and i.data ? k
  ), '{}'::jsonb)
$function$
;

CREATE OR REPLACE FUNCTION public.hg_staff_list()
 RETURNS TABLE(user_id uuid, pseudo text, avatar_url text, color text, perms text[], active boolean, note text, added_by_pseudo text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin' using errcode = '42501'; end if;
  return query
    select s.user_id, p.pseudo, p.avatar_url, p.color, s.perms, s.active, s.note,
           a.pseudo, s.created_at, s.updated_at
    from public.hg_staff s
    join public.hg_profiles p on p.id = s.user_id
    left join public.hg_profiles a on a.id = s.added_by
    order by s.active desc, p.pseudo;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_staff_set(p_user uuid, p_perms text[], p_active boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_bad text[];
  v_perms text[];
  v_before jsonb;
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin' using errcode = '42501'; end if;
  if not exists (select 1 from public.hg_profiles where id = p_user and not coalesce(is_ghost, false)) then
    raise exception 'Membre introuvable';
  end if;
  if p_user = auth.uid() then raise exception 'Tu es déjà admin'; end if;
  v_perms := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_perms, '{}')) x), '{}');
  select array_agg(x) into v_bad from unnest(v_perms) x where not exists (select 1 from public.hg_perm_catalog c where c.key = x);
  if v_bad is not null then raise exception 'Permission inconnue : %', array_to_string(v_bad, ', '); end if;

  select to_jsonb(s) - 'user_id' into v_before from public.hg_staff s where s.user_id = p_user;
  insert into public.hg_staff(user_id, perms, active, note, added_by)
    values (p_user, v_perms, coalesce(p_active, true), coalesce(p_note, ''), auth.uid())
  on conflict (user_id) do update
    set perms = excluded.perms, active = excluded.active,
        note = coalesce(p_note, public.hg_staff.note), updated_at = now();

  insert into public.hg_admin_log(admin_id, action, target_user, details)
    values (auth.uid(), case when v_before is null then 'staff_ajout' else 'staff_modif' end, p_user,
            jsonb_build_object('avant', v_before, 'perms', v_perms, 'active', coalesce(p_active, true)));
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_support_reply_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.hg_support
     set updated_at = now(),
         taken_by = coalesce(taken_by, new.author_id),
         taken_at = coalesce(taken_at, now())
   where id = new.support_id;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_toggle_reaction(p_kind text, p_id uuid, p_emoji text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_on boolean;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind not in ('moment', 'photo') then raise exception 'Cible inconnue'; end if;
  if p_emoji is null or p_emoji not in ('❤️', '😂', '😮', '🔥', '👏', '🎉') then
    raise exception 'Réaction non autorisée';
  end if;
  if p_kind = 'moment' and not exists (select 1 from public.hg_moments where id = p_id) then
    raise exception 'Souvenir introuvable';
  end if;
  if p_kind = 'photo' and not exists (select 1 from public.hg_photos where id = p_id) then
    raise exception 'Photo introuvable';
  end if;

  insert into public.hg_reactions (target_kind, target_id, user_id, emoji)
  values (p_kind, p_id, v_uid, p_emoji)
  on conflict on constraint hg_reactions_unique do update set active = not public.hg_reactions.active, created_at = now()
  returning active into v_on;
  return v_on;
end
$function$
;

CREATE OR REPLACE FUNCTION public.hg_trade_cancel(p_trade uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t hg_card_trades;
begin
  select * into t from hg_card_trades where id = p_trade for update;
  if not found or t.status <> 'proposee' then raise exception 'Offre introuvable ou déjà traitée'; end if;
  if t.from_user <> auth.uid() and not public.hg_has_perm('cartes') then raise exception 'Action non autorisée'; end if;
  update hg_card_trades set status = 'annulee', resolved_at = now() where id = p_trade;
  update hg_card_copies set locked_trade = null where locked_trade = p_trade;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_trade_propose(p_to uuid, p_give bigint[], p_want bigint[], p_give_p integer DEFAULT 0, p_want_p integer DEFAULT 0, p_message text DEFAULT NULL::text, p_parent uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); t uuid; par hg_card_trades; c jsonb := hg_card_cfg(); bal int; ng int; nw int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me then raise exception 'Destinataire invalide'; end if;
  if not exists (select 1 from hg_profiles where id = p_to) then raise exception 'Membre introuvable'; end if;
  p_give := coalesce(p_give, '{}'); p_want := coalesce(p_want, '{}');
  p_give_p := greatest(coalesce(p_give_p, 0), 0); p_want_p := greatest(coalesce(p_want_p, 0), 0);
  if cardinality(p_give) + cardinality(p_want) = 0 and p_give_p + p_want_p = 0 then raise exception 'L''offre est vide'; end if;
  if (select count(*) from hg_card_trades where from_user = me and status = 'proposee') >= coalesce((c->>'max_open_trades')::int, 10) then
    raise exception 'Trop d''offres en cours'; end if;
  if p_parent is not null then
    select * into par from hg_card_trades where id = p_parent for update;
    if not found or par.status <> 'proposee' or par.to_user <> me or par.from_user <> p_to then raise exception 'Offre d''origine invalide'; end if;
    update hg_card_trades set status = 'remplacee', resolved_at = now() where id = p_parent;
    update hg_card_copies set locked_trade = null where locked_trade = p_parent;
  end if;
  select count(*) into ng from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_give) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  select count(*) into nw from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_want) and x.owner_id = p_to and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if ng <> cardinality(p_give) or nw <> cardinality(p_want) then raise exception 'Certaines cartes ne sont pas échangeables'; end if;
  select paillettes into bal from hg_wallets where user_id = me;
  if coalesce(bal, 0) < p_give_p then raise exception 'Pas assez de Paillettes'; end if;
  insert into hg_card_trades(from_user, to_user, from_paillettes, to_paillettes, message, parent_id)
    values (me, p_to, p_give_p, p_want_p, left(p_message, 500), p_parent) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_give), 'from';
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_want), 'to';
  update hg_card_copies set locked_trade = t where id = any(p_give);
  return t;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_trade_respond(p_trade uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t hg_card_trades; nf int; nt int; ef int; et int; bf int; bt int;
begin
  select * into t from hg_card_trades where id = p_trade for update;
  if not found or t.status <> 'proposee' then raise exception 'Offre introuvable ou déjà traitée'; end if;
  if t.to_user <> auth.uid() then raise exception 'Seul le destinataire peut répondre'; end if;
  if not p_accept then
    update hg_card_trades set status = 'refusee', resolved_at = now() where id = p_trade;
    update hg_card_copies set locked_trade = null where locked_trade = p_trade;
    return 'refusee';
  end if;
  -- J1 : verrou sur les deux portefeuilles, toujours dans le même ordre (user_id),
  -- pour que deux opérations simultanées ne voient pas un solde périmé.
  perform 1 from hg_wallets where user_id in (t.from_user, t.to_user) order by user_id for update;
  select count(*) filter (where side = 'from'), count(*) filter (where side = 'to') into ef, et from hg_card_trade_items where trade_id = p_trade;
  select count(*) into nf from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'from' and x.owner_id = t.from_user and x.locked_trade = p_trade and x.recycled_at is null;
  select count(*) into nt from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'to' and x.owner_id = t.to_user and x.locked_trade is null and x.recycled_at is null;
  if nf <> ef or nt <> et then raise exception 'Les cartes ont changé depuis l''offre : elle n''est plus valable'; end if;
  select coalesce(paillettes, 0) into bf from hg_wallets where user_id = t.from_user;
  select coalesce(paillettes, 0) into bt from hg_wallets where user_id = t.to_user;
  if coalesce(bf, 0) < t.from_paillettes or coalesce(bt, 0) < t.to_paillettes then raise exception 'Paillettes insuffisantes pour conclure'; end if;
  update hg_card_copies x set owner_id = t.to_user, locked_trade = null, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'from' and i.copy_id = x.id;
  update hg_card_copies x set owner_id = t.from_user, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'to' and i.copy_id = x.id;
  if t.from_paillettes > 0 then
    perform hg_wallet_add(t.from_user, -t.from_paillettes, 'echange', 'trade:' || p_trade || ':a');
    perform hg_wallet_add(t.to_user, t.from_paillettes, 'echange', 'trade:' || p_trade || ':b');
  end if;
  if t.to_paillettes > 0 then
    perform hg_wallet_add(t.to_user, -t.to_paillettes, 'echange', 'trade:' || p_trade || ':c');
    perform hg_wallet_add(t.from_user, t.to_paillettes, 'echange', 'trade:' || p_trade || ':d');
  end if;
  update hg_card_trades set status = 'acceptee', resolved_at = now() where id = p_trade;
  insert into hg_activity(user_id, kind, text)
    select t.from_user, 'cartes', a.pseudo || ' et ' || b.pseudo || ' ont conclu un échange de cartes'
    from hg_profiles a, hg_profiles b where a.id = t.from_user and b.id = t.to_user;
  perform hg_card_check_sets(t.from_user); perform hg_card_check_sets(t.to_user);
  return 'acceptee';
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_unread_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum((select count(*) from hg_messages x where x.conversation_id = m.conversation_id
                       and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid())), 0)::int
  from hg_conversation_members m where m.user_id = auth.uid() $function$
;

CREATE OR REPLACE FUNCTION public.hg_wallet_add(p_user uuid, p_delta integer, p_reason text, p_ref text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if p_user is null or coalesce(p_delta, 0) = 0 then return false; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  insert into hg_wallet_log(user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update hg_wallets set paillettes = paillettes + p_delta, updated_at = now() where user_id = p_user;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_wallet_welcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g int := coalesce((hg_card_cfg()->>'starting_paillettes')::int, 1000);
begin
  if g > 0 then
    insert into hg_wallet_log(user_id, delta, reason, ref) values (new.user_id, g, 'bienvenue', 'bienvenue') on conflict do nothing;
    if found then update hg_wallets set paillettes = paillettes + g where user_id = new.user_id; end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.hg_year_recap(p_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with b as (select make_timestamptz(p_year,1,1,0,0,0,'Europe/Zurich') s, make_timestamptz(p_year+1,1,1,0,0,0,'Europe/Zurich') e),
  ev as (select ev.* from hg_events ev, b where ev.starts_at >= b.s and ev.starts_at < b.e and ev.starts_at < now()),
  ph as (select x.* from hg_photos x, b where x.created_at >= b.s and x.created_at < b.e)
  select case when not public.hg_is_member() then null else jsonb_build_object(
    'year', p_year,
    'gang', jsonb_build_object(
      'membres_total', (select count(*) from hg_profiles, b where created_at < b.e),
      'nouveaux_membres', (select coalesce(jsonb_agg(pseudo order by created_at), '[]') from hg_profiles, b where created_at >= b.s and created_at < b.e),
      'sorties', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'location', location, 'starts_at', starts_at,
                    'presents', (select count(*) from hg_event_rsvps r where r.event_id = ev.id and r.status = 'oui')) order by starts_at), '[]') from ev),
      'photos', (select count(*) from ph),
      'top_photographes', (select coalesce(jsonb_agg(t), '[]') from (select p.pseudo, count(*) n from ph join hg_profiles p on p.id = ph.user_id group by p.pseudo order by n desc limit 3) t),
      'plus_presents', (select coalesce(jsonb_agg(t), '[]') from (select p.pseudo, count(*) n from hg_event_rsvps r join ev on ev.id = r.event_id join hg_profiles p on p.id = r.user_id where r.status = 'oui' group by p.pseudo order by n desc limit 3) t),
      'secret_santa', (select jsonb_build_object('participants', (select count(*) from hg_ss_participants where edition_id = e.id),
                         'envoyes', (select count(sent_at) from hg_ss_participants where edition_id = e.id), 'status', e.status)
                       from hg_ss_editions e where e.year = p_year),
      'moments', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'happened_on', happened_on) order by happened_on), '[]') from hg_moments, b where happened_on >= b.s::date and happened_on < b.e::date),
      'badges_debloques', (select count(*) from hg_user_badges, b where awarded_at >= b.s and awarded_at < b.e),
      'messages', (select count(*) from hg_messages, b where created_at >= b.s and created_at < b.e)),
    'moi', jsonb_build_object(
      'sorties', (select count(*) from hg_event_rsvps r join ev on ev.id = r.event_id where r.user_id = auth.uid() and r.status = 'oui'),
      'photos', (select count(*) from ph where user_id = auth.uid()),
      'badges', (select coalesce(jsonb_agg(bd.name), '[]') from hg_user_badges ub join hg_badges bd on bd.code = ub.badge_code, b where ub.user_id = auth.uid() and ub.awarded_at >= b.s and ub.awarded_at < b.e),
      'secret_santa', (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = auth.uid() and e.year = p_year),
      'messages_envoyes', (select count(*) from hg_messages, b where sender_id = auth.uid() and created_at >= b.s and created_at < b.e))
  ) end $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;


-- 8. Triggers
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_bugs FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_bugs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_changelog FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_changelog FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_contacts FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_events FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_features FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_files FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_inventory FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_links FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_notes FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_tasks FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_transactions FOR EACH ROW EXECUTE FUNCTION d_touch_project();
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER hg_cards_admin_audit_del AFTER DELETE ON public.hg_cards FOR EACH ROW EXECUTE FUNCTION hg_cards_admin_audit_del();
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_dyn_captures FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_cards_earn AFTER INSERT OR UPDATE OF status ON public.hg_event_rsvps FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_events FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_msg_push AFTER INSERT ON public.hg_messages FOR EACH ROW EXECUTE FUNCTION hg_msg_push_trg();
CREATE TRIGGER hg_msg_realtime AFTER INSERT ON public.hg_messages FOR EACH ROW EXECUTE FUNCTION hg_msg_realtime_trg();
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_moments FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_photos FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_profiles_guard BEFORE UPDATE ON public.hg_profiles FOR EACH ROW EXECUTE FUNCTION hg_profiles_guard();
CREATE TRIGGER hg_profiles_sync_joined BEFORE INSERT OR UPDATE OF joined_on, created_at ON public.hg_profiles FOR EACH ROW EXECUTE FUNCTION hg_profiles_sync_joined();
CREATE TRIGGER hg_ss_editions_guard BEFORE INSERT ON public.hg_ss_editions FOR EACH ROW EXECUTE FUNCTION hg_ss_editions_guard();
CREATE TRIGGER hg_cards_earn AFTER UPDATE OF sent_at ON public.hg_ss_participants FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_support_reply_touch_trg AFTER INSERT ON public.hg_support_replies FOR EACH ROW EXECUTE FUNCTION hg_support_reply_touch();
CREATE TRIGGER hg_badge_activity AFTER INSERT ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_badge_activity();
CREATE TRIGGER hg_badge_level_activity AFTER UPDATE OF level ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_badge_level_activity();
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
CREATE TRIGGER hg_wallet_welcome AFTER INSERT ON public.hg_wallets FOR EACH ROW EXECUTE FUNCTION hg_wallet_welcome();

-- 9. Politiques RLS (pg_policies). Le UUID du propriétaire des tables d_* est masqué.
create policy d_bugs_own on public.d_bugs as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_bugs_owner_lock on public.d_bugs as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_changelog_own on public.d_changelog as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_changelog_owner_lock on public.d_changelog as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_contacts_own on public.d_contacts as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_contacts_owner_lock on public.d_contacts as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_events_own on public.d_events as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_events_owner_lock on public.d_events as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_features_own on public.d_features as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy d_features_owner_lock on public.d_features as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_files_own on public.d_files as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_files_owner_lock on public.d_files as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_inventory_own on public.d_inventory as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_inventory_owner_lock on public.d_inventory as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_links_own on public.d_links as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_links_owner_lock on public.d_links as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_notes_own on public.d_notes as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_notes_owner_lock on public.d_notes as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_projects_own on public.d_projects as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy d_projects_owner_lock on public.d_projects as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_settings_own on public.d_settings as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy d_settings_owner_lock on public.d_settings as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_tasks_own on public.d_tasks as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_tasks_owner_lock on public.d_tasks as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy d_transactions_own on public.d_transactions as permissive for ALL to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
create policy d_transactions_owner_lock on public.d_transactions as restrictive for ALL to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
create policy hg_activity_admin on public.hg_activity as permissive for ALL to authenticated using (hg_has_perm('reglages'::text)) with check (hg_has_perm('reglages'::text));
create policy hg_activity_read on public.hg_activity as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_admin_access_log_admin_read on public.hg_admin_access_log as permissive for SELECT to authenticated using (hg_is_admin());
create policy hg_admin_log_admin_read on public.hg_admin_log as permissive for SELECT to authenticated using (hg_has_perm('journal'::text));
create policy hg_admin_state_own on public.hg_admin_state as permissive for SELECT to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_staff()));
create policy hg_badges_admin on public.hg_badges as permissive for ALL to authenticated using (hg_has_perm('badges'::text)) with check (hg_has_perm('badges'::text));
create policy hg_badges_read on public.hg_badges as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_bdlog_admin on public.hg_birthday_log as permissive for ALL to authenticated using (hg_has_perm('bot'::text)) with check (hg_has_perm('bot'::text));
create policy hg_bot_log_admin on public.hg_bot_log as permissive for ALL to authenticated using (hg_has_perm('bot'::text)) with check (hg_has_perm('bot'::text));
create policy hg_card_copies_admin on public.hg_card_copies as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_copies_read on public.hg_card_copies as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_card_quests_templates_admin on public.hg_card_quests_templates as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_quests_templates_read on public.hg_card_quests_templates as permissive for SELECT to authenticated using ((hg_is_member() AND active));
create policy hg_card_sets_admin on public.hg_card_sets as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_sets_read on public.hg_card_sets as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_card_showcase_admin on public.hg_card_showcase as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_showcase_own on public.hg_card_showcase as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM hg_card_copies c WHERE ((c.id = hg_card_showcase.copy_id) AND (c.owner_id = ( SELECT auth.uid() AS uid)) AND (c.recycled_at IS NULL))))));
create policy hg_card_showcase_read on public.hg_card_showcase as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_card_trade_items_admin on public.hg_card_trade_items as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_trade_items_mine on public.hg_card_trade_items as permissive for SELECT to authenticated using ((EXISTS ( SELECT 1 FROM hg_card_trades t WHERE ((t.id = hg_card_trade_items.trade_id) AND ((( SELECT auth.uid() AS uid) = t.from_user) OR (( SELECT auth.uid() AS uid) = t.to_user))))));
create policy hg_card_trades_admin on public.hg_card_trades as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_trades_mine on public.hg_card_trades as permissive for SELECT to authenticated using (((( SELECT auth.uid() AS uid) = from_user) OR (( SELECT auth.uid() AS uid) = to_user)));
create policy hg_card_wishlist_admin on public.hg_card_wishlist as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_card_wishlist_own on public.hg_card_wishlist as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_card_wishlist_read on public.hg_card_wishlist as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_cards_admin on public.hg_cards as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_cards_read on public.hg_cards as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_challenges_admin on public.hg_challenges as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_challenges_read on public.hg_challenges as permissive for SELECT to authenticated using ((hg_is_member() AND active));
create policy hg_convm_admin on public.hg_conversation_members as permissive for ALL to authenticated using (hg_has_perm('messages'::text)) with check (hg_has_perm('messages'::text));
create policy hg_conv_admin on public.hg_conversations as permissive for ALL to authenticated using (hg_has_perm('messages'::text)) with check (hg_has_perm('messages'::text));
create policy hg_dyn_captures_admin on public.hg_dyn_captures as permissive for ALL to authenticated using (hg_has_perm('themes'::text)) with check (hg_has_perm('themes'::text));
create policy hg_dyn_captures_read on public.hg_dyn_captures as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_dyn_events_admin on public.hg_dyn_events as permissive for ALL to authenticated using (hg_has_perm('themes'::text)) with check (hg_has_perm('themes'::text));
create policy hg_dyn_events_read on public.hg_dyn_events as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_votes_admin on public.hg_event_date_votes as permissive for ALL to authenticated using (hg_has_perm('evenements'::text)) with check (hg_has_perm('evenements'::text));
create policy hg_votes_own on public.hg_event_date_votes as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_votes_read on public.hg_event_date_votes as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_dates_read on public.hg_event_dates as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_dates_write on public.hg_event_dates as permissive for ALL to authenticated using ((hg_has_perm('evenements'::text) OR (EXISTS ( SELECT 1 FROM hg_events e WHERE ((e.id = hg_event_dates.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)))))) with check ((hg_has_perm('evenements'::text) OR (EXISTS ( SELECT 1 FROM hg_events e WHERE ((e.id = hg_event_dates.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)))))));
create policy hg_rsvps_admin on public.hg_event_rsvps as permissive for ALL to authenticated using (hg_has_perm('evenements'::text)) with check (hg_has_perm('evenements'::text));
create policy hg_rsvps_creator on public.hg_event_rsvps as permissive for ALL to authenticated using ((EXISTS ( SELECT 1 FROM hg_events e WHERE ((e.id = hg_event_rsvps.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)))))) with check (((EXISTS ( SELECT 1 FROM hg_events e WHERE ((e.id = hg_event_rsvps.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid))))) AND hg_is_member()));
create policy hg_rsvps_own on public.hg_event_rsvps as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_rsvps_read on public.hg_event_rsvps as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_events_delete on public.hg_events as permissive for DELETE to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_has_perm('evenements'::text)));
create policy hg_events_insert on public.hg_events as permissive for INSERT to authenticated with check ((hg_is_member() AND (created_by = ( SELECT auth.uid() AS uid))));
create policy hg_events_read on public.hg_events as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_events_update on public.hg_events as permissive for UPDATE to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_has_perm('evenements'::text)));
create policy hg_ideas_admin on public.hg_ideas as permissive for ALL to authenticated using (hg_has_perm('support'::text)) with check (hg_has_perm('support'::text));
create policy hg_ideas_insert on public.hg_ideas as permissive for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_invite_links_admin on public.hg_invite_links as permissive for ALL to authenticated using (hg_has_perm('membres'::text)) with check (hg_has_perm('membres'::text));
create policy hg_invites_admin on public.hg_invites as permissive for ALL to authenticated using (hg_has_perm('membres'::text)) with check (hg_has_perm('membres'::text));
create policy hg_msg_admin on public.hg_messages as permissive for ALL to authenticated using (hg_has_perm('messages'::text)) with check (hg_has_perm('messages'::text));
create policy hg_moments_delete on public.hg_moments as permissive for DELETE to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_has_perm('souvenirs'::text)));
create policy hg_moments_edit on public.hg_moments as permissive for UPDATE to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_has_perm('souvenirs'::text)));
create policy hg_moments_insert on public.hg_moments as permissive for INSERT to authenticated with check ((hg_is_member() AND (created_by = ( SELECT auth.uid() AS uid))));
create policy hg_moments_read on public.hg_moments as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_page_access_admin on public.hg_page_access as permissive for ALL to authenticated using (hg_has_perm('membres'::text)) with check (hg_has_perm('membres'::text));
create policy hg_pages_admin on public.hg_pages as permissive for ALL to authenticated using (hg_has_perm('reglages'::text)) with check (hg_has_perm('reglages'::text));
create policy hg_pages_read on public.hg_pages as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_perm_catalog_read on public.hg_perm_catalog as permissive for SELECT to authenticated using (true);
create policy hg_perm_tables_read on public.hg_perm_tables as permissive for SELECT to authenticated using (true);
create policy hg_photos_admin on public.hg_photos as permissive for ALL to authenticated using (hg_has_perm('souvenirs'::text)) with check (hg_has_perm('souvenirs'::text));
create policy hg_photos_delete on public.hg_photos as permissive for DELETE to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR hg_has_perm('souvenirs'::text)));
create policy hg_photos_insert on public.hg_photos as permissive for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_photos_read on public.hg_photos as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_pinfo_admin on public.hg_profile_info as permissive for ALL to authenticated using (hg_has_perm('membres'::text)) with check (hg_has_perm('membres'::text));
create policy hg_pinfo_own on public.hg_profile_info as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy hg_profiles_admin_delete_ghost on public.hg_profiles as permissive for DELETE to authenticated using ((hg_has_perm('membres'::text) AND is_ghost));
create policy hg_profiles_admin_read on public.hg_profiles as permissive for SELECT to authenticated using (hg_is_staff());
create policy hg_profiles_admin_update on public.hg_profiles as permissive for UPDATE to authenticated using (hg_has_perm('membres'::text)) with check (hg_has_perm('membres'::text));
create policy hg_profiles_select_own on public.hg_profiles as permissive for SELECT to authenticated using ((id = ( SELECT auth.uid() AS uid)));
create policy hg_profiles_update_own on public.hg_profiles as permissive for UPDATE to authenticated using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
create policy hg_push_own on public.hg_push_subscriptions as permissive for ALL to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy hg_reactions_insert_own on public.hg_reactions as permissive for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
create policy hg_reactions_moderation on public.hg_reactions as permissive for UPDATE to authenticated using (hg_has_perm('souvenirs'::text)) with check (hg_has_perm('souvenirs'::text));
create policy hg_reactions_read on public.hg_reactions as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_settings_admin on public.hg_settings as permissive for ALL to authenticated using ((hg_is_admin() OR hg_has_perm(hg_settings_perm(key)))) with check ((hg_is_admin() OR hg_has_perm(hg_settings_perm(key))));
create policy hg_settings_push_public on public.hg_settings as permissive for SELECT to anon, authenticated using ((key = 'push_vapid_public'::text));
create policy hg_settings_read on public.hg_settings as permissive for SELECT to anon, authenticated using ((key = 'theme'::text));
create policy hg_ss_assign_admin on public.hg_ss_assignments as permissive for ALL to authenticated using (hg_has_perm('secret_santa'::text)) with check (hg_has_perm('secret_santa'::text));
create policy hg_ss_editions_admin on public.hg_ss_editions as permissive for ALL to authenticated using (hg_has_perm('secret_santa'::text)) with check (hg_has_perm('secret_santa'::text));
create policy hg_ss_editions_read on public.hg_ss_editions as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_ss_excl_admin on public.hg_ss_exclusions as permissive for ALL to authenticated using (hg_has_perm('secret_santa'::text)) with check (hg_has_perm('secret_santa'::text));
create policy hg_ss_part_admin on public.hg_ss_participants as permissive for ALL to authenticated using (hg_has_perm('secret_santa'::text)) with check (hg_has_perm('secret_santa'::text));
create policy hg_ss_part_join on public.hg_ss_participants as permissive for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member() AND (EXISTS ( SELECT 1 FROM hg_ss_editions e WHERE ((e.id = hg_ss_participants.edition_id) AND (e.status = 'inscriptions'::text))))));
create policy hg_ss_part_leave on public.hg_ss_participants as permissive for DELETE to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM hg_ss_editions e WHERE ((e.id = hg_ss_participants.edition_id) AND (e.status = 'inscriptions'::text))))));
create policy hg_ss_part_read on public.hg_ss_participants as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_ss_part_update_own on public.hg_ss_participants as permissive for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy hg_ss_wishes_admin on public.hg_ss_wishes as permissive for ALL to authenticated using (hg_has_perm('secret_santa'::text)) with check (hg_has_perm('secret_santa'::text));
create policy hg_ss_wishes_own on public.hg_ss_wishes as permissive for ALL to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy hg_ss_wishes_santa on public.hg_ss_wishes as permissive for SELECT to authenticated using (hg_ss_is_santa_of(edition_id, user_id));
create policy hg_staff_read on public.hg_staff as permissive for SELECT to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
create policy hg_support_admin on public.hg_support as permissive for ALL to authenticated using (hg_has_perm('support'::text)) with check (hg_has_perm('support'::text));
create policy hg_support_member_read on public.hg_support as permissive for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy hg_support_replies_member_read on public.hg_support_replies as permissive for SELECT to authenticated using (((NOT internal) AND (EXISTS ( SELECT 1 FROM hg_support s WHERE ((s.id = hg_support_replies.support_id) AND (s.user_id = ( SELECT auth.uid() AS uid)))))));
create policy hg_support_replies_staff on public.hg_support_replies as permissive for ALL to authenticated using (hg_has_perm('support'::text)) with check ((hg_has_perm('support'::text) AND (author_id = ( SELECT auth.uid() AS uid))));
create policy hg_theme_seen_admin on public.hg_theme_seen as permissive for ALL to authenticated using (hg_has_perm('themes'::text)) with check (hg_has_perm('themes'::text));
create policy hg_themes_admin on public.hg_themes as permissive for ALL to authenticated using (hg_has_perm('themes'::text)) with check (hg_has_perm('themes'::text));
create policy hg_themes_read on public.hg_themes as permissive for SELECT to anon, authenticated using (true);
create policy hg_ubadges_admin on public.hg_user_badges as permissive for ALL to authenticated using (hg_has_perm('badges'::text)) with check (hg_has_perm('badges'::text));
create policy hg_ubadges_read on public.hg_user_badges as permissive for SELECT to authenticated using (hg_is_member());
create policy hg_wallet_log_admin on public.hg_wallet_log as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_wallet_log_own on public.hg_wallet_log as permissive for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy hg_wallets_admin on public.hg_wallets as permissive for ALL to authenticated using (hg_has_perm('cartes'::text)) with check (hg_has_perm('cartes'::text));
create policy hg_wallets_own on public.hg_wallets as permissive for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));

-- 10. Publication temps réel (supabase_realtime)
alter publication supabase_realtime add table public.hg_admin_log, public.hg_card_trades, public.hg_event_rsvps, public.hg_events, public.hg_ideas, public.hg_moments, public.hg_photos, public.hg_profiles, public.hg_ss_participants, public.hg_staff, public.hg_support, public.hg_support_replies;

-- 11. Séquences hors identité : hg_member_number_seq (déclarée en section 2).

-- 12. Tâches pg_cron (commandes masquées : elles peuvent contenir des secrets)
-- hg-badges-hourly        schedule '7 * * * *'        commande <commande masquée>
-- hg-birthdays-daily      schedule '5 6,7 * * *'      commande <commande masquée>
-- hg-cards-hourly         schedule '23 * * * *'       commande <commande masquée>
-- hg-challenges-hourly    schedule '17 * * * *'       commande <commande masquée>
-- hg-cron-5min            schedule '*/5 * * * *'      commande <commande masquée>

