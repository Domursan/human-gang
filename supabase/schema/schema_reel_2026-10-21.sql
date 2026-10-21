-- =====================================================================
-- Schéma reconstitué du schéma `public` (projet Supabase zqbdzokyhgavgmqgiwuw)
-- Produit le 2026-10-21 par lecture seule (catalogues pg_catalog,
-- information_schema, pg_policies, pg_get_functiondef, pg_get_triggerdef,
-- pg_indexes, cron.job). Aucune écriture en base.
-- Ce fichier ne contient AUCUNE donnée de lignes, AUCUN secret, AUCUN e-mail.
-- Une seule valeur est remplacée par un marqueur : l'UUID du propriétaire
-- de l'application « d_* » (utilisé dans des policies « owner_lock »),
-- écrit ici comme 00000000-0000-0000-0000-000000000000. Avant de le rejouer,
-- remplacer ce placeholder par la vraie valeur, hors du dépôt.
-- Ordre : extensions, séquences, tables, contraintes (PK, UNIQUE, CHECK
-- puis FK), index, fonctions, triggers, RLS, policies, storage, pg_cron.
-- Voir supabase/schema/README.md. Ce fichier fait foi pour le schéma réel.
-- =====================================================================

-- 1. Extensions utilisées
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_stat_statements;
create extension if not exists supabase_vault;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 2. Séquences hors identité (les colonnes identity créent leur propre séquence)
create sequence if not exists public.hg_member_number_seq start 1 increment 1;

-- 3. Tables (colonnes, types, défauts, identités)

create table if not exists public.d_bugs (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  title text not null,
  kind text not null default 'Bug'::text,
  status text,
  priority text,
  version text,
  description text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_changelog (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  version text,
  date date not null default CURRENT_DATE,
  title text not null,
  details text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_contacts (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  name text not null,
  company text,
  contact text,
  phone text,
  email text,
  status text,
  notes text,
  links jsonb not null default '[]'::jsonb,
  cap numeric(14,2),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_events (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  title text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone,
  all_day boolean not null default false,
  recurrence text not null default 'none'::text,
  recurrence_until date,
  location text,
  notes text,
  color text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_features (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null,
  icon text,
  color text,
  category text,
  summary text,
  description text,
  how_to text,
  tags text[] not null default '{}'::text[],
  project_ids uuid[] not null default '{}'::uuid[],
  links jsonb not null default '[]'::jsonb,
  "position" integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_files (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  name text not null,
  url text not null,
  path text,
  mime text,
  size bigint,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_inventory (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  name text not null,
  category text,
  quantity numeric(14,2) not null default 0,
  alert_threshold numeric(14,2),
  unit_value numeric(14,2),
  location text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_links (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  label text,
  url text not null,
  kind text,
  "position" integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_notes (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  title text not null,
  content text,
  pinned boolean not null default false,
  "position" integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_projects (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null,
  category text,
  status text,
  color text,
  icon text,
  logo_url text,
  description text,
  tags text[] not null default '{}'::text[],
  pinned boolean not null default false,
  "position" integer,
  start_date date,
  end_date date,
  modules text[] not null default '{}'::text[],
  tech jsonb not null default '{}'::jsonb,
  deploy jsonb not null default '{}'::jsonb,
  last_activity timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_settings (
  user_id uuid not null default auth.uid(),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_tasks (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  title text not null,
  status text,
  priority text,
  due_date date,
  description text,
  subtasks jsonb not null default '[]'::jsonb,
  "position" integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.d_transactions (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  project_id uuid not null,
  kind text not null,
  amount numeric(14,2) not null default 0,
  label text not null,
  category text,
  date date not null default CURRENT_DATE,
  contact_id uuid,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_activity (
  id bigint generated always as identity not null,
  user_id uuid,
  kind text not null,
  text text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_admin_state (
  user_id uuid not null,
  god_until timestamp with time zone,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_badges (
  code text not null,
  name text not null,
  description text not null,
  image_url text,
  sort integer not null default 0,
  levels_enabled boolean not null default false,
  metric text,
  levels jsonb not null default '[]'::jsonb,
  event_id uuid
);

create table if not exists public.hg_birthday_log (
  user_id uuid not null,
  year integer not null,
  sent_at timestamp with time zone not null default now()
);

create table if not exists public.hg_bot_log (
  id bigint generated always as identity not null,
  sent_by uuid,
  kind text not null default 'manual'::text,
  title text,
  body text not null,
  recipients jsonb not null default '[]'::jsonb,
  channel boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_card_copies (
  id bigint generated always as identity not null,
  card_id uuid not null,
  owner_id uuid,
  shiny boolean not null default false,
  serial integer,
  source text not null default 'booster'::text,
  obtained_at timestamp with time zone not null default now(),
  locked_trade uuid,
  recycled_at timestamp with time zone
);

create table if not exists public.hg_card_sets (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_card_showcase (
  user_id uuid not null,
  slot integer not null,
  copy_id bigint not null
);

create table if not exists public.hg_card_trade_items (
  trade_id uuid not null,
  copy_id bigint not null,
  side text not null
);

create table if not exists public.hg_card_trades (
  id uuid not null default gen_random_uuid(),
  from_user uuid not null,
  to_user uuid not null,
  status text not null default 'proposee'::text,
  from_paillettes integer not null default 0,
  to_paillettes integer not null default 0,
  message text,
  parent_id uuid,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone
);

create table if not exists public.hg_card_wishlist (
  user_id uuid not null,
  card_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_cards (
  id uuid not null default gen_random_uuid(),
  set_id uuid not null,
  number integer not null,
  name text not null,
  family text not null,
  rarity text not null,
  image_url text,
  flavor text,
  member_id uuid,
  can_shiny boolean not null default true,
  tradeable boolean not null default true,
  craftable boolean not null default true,
  max_copies integer,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  caption text
);

create table if not exists public.hg_conversation_members (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_at timestamp with time zone not null default '-infinity'::timestamp with time zone
);

create table if not exists public.hg_conversations (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  edition_id uuid,
  santa_id uuid,
  target_id uuid,
  direct_key text,
  created_at timestamp with time zone not null default now(),
  last_message_at timestamp with time zone not null default now()
);

create table if not exists public.hg_dyn_captures (
  id bigint generated always as identity not null,
  event_id uuid not null,
  user_id uuid not null,
  captured_at timestamp with time zone not null default now()
);

create table if not exists public.hg_dyn_events (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  emoji text,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  probability numeric not null default 0.2,
  max_per_page integer not null default 1,
  max_per_user integer,
  max_total integer,
  duration_ms integer not null default 6000,
  size_px integer not null default 72,
  badge_code text,
  announce boolean not null default true,
  announced_start_at timestamp with time zone,
  announced_end_at timestamp with time zone,
  active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_event_date_votes (
  date_id uuid not null,
  user_id uuid not null
);

create table if not exists public.hg_event_dates (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  proposed_at timestamp with time zone not null
);

create table if not exists public.hg_event_rsvps (
  event_id uuid not null,
  user_id uuid not null,
  status text not null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_events (
  id uuid not null default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamp with time zone,
  cover_path text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  retro boolean not null default false
);

create table if not exists public.hg_ideas (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  body text not null,
  status text not null default 'nouvelle'::text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_invite_links (
  id uuid not null default gen_random_uuid(),
  token text not null default encode(gen_random_bytes(12), 'hex'::text),
  label text,
  active boolean not null default true,
  max_codes integer,
  codes_generated integer not null default 0,
  expires_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_invites (
  code text not null,
  created_by uuid,
  used_by uuid,
  used_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  link_id uuid,
  expires_at timestamp with time zone,
  ghost_id uuid
);

create table if not exists public.hg_messages (
  id bigint generated always as identity not null,
  conversation_id uuid not null,
  sender_id uuid,
  body text not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_moments (
  id uuid not null default gen_random_uuid(),
  title text not null,
  body text,
  happened_on date not null default CURRENT_DATE,
  image_path text,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_page_access (
  page_slug text not null,
  user_id uuid not null,
  allowed boolean not null
);

create table if not exists public.hg_pages (
  slug text not null,
  label text not null,
  mode text not null default 'membres'::text,
  in_nav boolean not null default true,
  sort integer not null default 0,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_photos (
  id uuid not null default gen_random_uuid(),
  event_id uuid,
  user_id uuid,
  path text not null,
  caption text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_profile_info (
  user_id uuid not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_profiles (
  id uuid not null,
  pseudo text not null,
  avatar_url text,
  color text default '#9E3543'::text,
  birthday date,
  share_birthday boolean not null default false,
  discord_id text,
  bot_optin boolean not null default true,
  is_admin boolean not null default false,
  intro_seen boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  member_number integer default nextval('hg_member_number_seq'::regclass),
  joined_on date,
  account_created_at timestamp with time zone,
  is_ghost boolean not null default false,
  ghost_note text
);

create table if not exists public.hg_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_ss_assignments (
  edition_id uuid not null,
  giver_id uuid not null,
  receiver_id uuid not null
);

create table if not exists public.hg_ss_editions (
  id uuid not null default gen_random_uuid(),
  year integer not null,
  status text not null default 'inscriptions'::text,
  budget text,
  send_deadline date,
  exchange_date date,
  card_base_url text,
  drawn_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  shared_fields text[] not null default '{}'::text[]
);

create table if not exists public.hg_ss_exclusions (
  edition_id uuid not null,
  user_a uuid not null,
  user_b uuid not null
);

create table if not exists public.hg_ss_participants (
  edition_id uuid not null,
  user_id uuid not null,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  joined_at timestamp with time zone not null default now()
);

create table if not exists public.hg_ss_wishes (
  id uuid not null default gen_random_uuid(),
  edition_id uuid not null,
  user_id uuid not null,
  label text not null,
  url text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_support (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  pseudo text not null,
  subject text not null,
  message text not null,
  contact text,
  status text not null default 'ouverte'::text,
  discord_sent boolean not null default false,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_theme_seen (
  user_id uuid not null,
  slug text not null,
  seen_at timestamp with time zone not null default now()
);

create table if not exists public.hg_themes (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  is_default boolean not null default false,
  active boolean not null default true,
  start_md text,
  end_md text,
  priority integer not null default 0,
  logo_url text,
  emojis text[] not null default '{}'::text[],
  effect text not null default 'aucun'::text,
  colors jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.hg_user_badges (
  user_id uuid not null,
  badge_code text not null,
  awarded_at timestamp with time zone not null default now(),
  level integer not null default 1,
  level_at timestamp with time zone
);

create table if not exists public.hg_wallet_log (
  id bigint generated always as identity not null,
  user_id uuid not null,
  delta integer not null,
  reason text not null,
  ref text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.hg_wallets (
  user_id uuid not null,
  paillettes integer not null default 0,
  boosters_opened integer not null default 0,
  pity_epique integer not null default 0,
  last_free_booster timestamp with time zone,
  last_daily date,
  daily_streak integer not null default 0,
  updated_at timestamp with time zone not null default now()
);

-- 4. Contraintes : clés primaires, uniques et CHECK

do $$ begin alter table d_settings add constraint d_settings_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_projects add constraint d_projects_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_links add constraint d_links_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_tasks add constraint d_tasks_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_notes add constraint d_notes_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_changelog add constraint d_changelog_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_events add constraint d_events_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_files add constraint d_files_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_contacts add constraint d_contacts_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_transactions add constraint d_transactions_kind_check CHECK ((kind = ANY (ARRAY['recette'::text, 'depense'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_transactions add constraint d_transactions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_inventory add constraint d_inventory_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_bugs add constraint d_bugs_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_features add constraint d_features_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_themes add constraint hg_themes_slug_key UNIQUE (slug); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profiles add constraint hg_profiles_pseudo_check CHECK (((char_length(pseudo) >= 2) AND (char_length(pseudo) <= 32))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profiles add constraint hg_profiles_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profiles add constraint hg_profiles_pseudo_key UNIQUE (pseudo); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invites add constraint hg_invites_pkey PRIMARY KEY (code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_settings add constraint hg_settings_pkey PRIMARY KEY (key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_activity add constraint hg_activity_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_editions add constraint hg_ss_editions_status_check CHECK ((status = ANY (ARRAY['inscriptions'::text, 'tirage'::text, 'envoi'::text, 'revelation'::text, 'termine'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_editions add constraint hg_ss_editions_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_editions add constraint hg_ss_editions_year_key UNIQUE (year); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_participants add constraint hg_ss_participants_pkey PRIMARY KEY (edition_id, user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_wishes add constraint hg_ss_wishes_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_wishes add constraint hg_ss_wishes_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_exclusions add constraint hg_ss_exclusions_pkey PRIMARY KEY (edition_id, user_a, user_b); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_assignments add constraint hg_ss_assignments_pkey PRIMARY KEY (edition_id, giver_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_assignments add constraint hg_ss_assignments_edition_id_receiver_id_key UNIQUE (edition_id, receiver_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_events add constraint hg_events_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_rsvps add constraint hg_event_rsvps_status_check CHECK ((status = ANY (ARRAY['oui'::text, 'peut-etre'::text, 'non'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_rsvps add constraint hg_event_rsvps_pkey PRIMARY KEY (event_id, user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_dates add constraint hg_event_dates_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_date_votes add constraint hg_event_date_votes_pkey PRIMARY KEY (date_id, user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_photos add constraint hg_photos_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_moments add constraint hg_moments_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_badges add constraint hg_badges_pkey PRIMARY KEY (code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_user_badges add constraint hg_user_badges_pkey PRIMARY KEY (user_id, badge_code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profile_info add constraint hg_profile_info_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_bot_log add constraint hg_bot_log_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_page_access add constraint hg_page_access_pkey PRIMARY KEY (page_slug, user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ideas add constraint hg_ideas_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ideas add constraint hg_ideas_status_check CHECK ((status = ANY (ARRAY['nouvelle'::text, 'retenue'::text, 'ecartee'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ideas add constraint hg_ideas_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_support add constraint hg_support_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 4000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_support add constraint hg_support_status_check CHECK ((status = ANY (ARRAY['ouverte'::text, 'traitee'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_support add constraint hg_support_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_themes add constraint hg_themes_start_md_check CHECK ((start_md ~ '^\d{2}-\d{2}$'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_themes add constraint hg_themes_end_md_check CHECK ((end_md ~ '^\d{2}-\d{2}$'::text)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_themes add constraint hg_themes_effect_check CHECK ((effect = ANY (ARRAY['aucun'::text, 'pluie'::text, 'neige'::text, 'etoiles'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_themes add constraint hg_themes_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_kind_check CHECK ((kind = ANY (ARRAY['direct'::text, 'santa'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_direct_key_key UNIQUE (direct_key); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_edition_id_santa_id_key UNIQUE (edition_id, santa_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversation_members add constraint hg_conversation_members_pkey PRIMARY KEY (conversation_id, user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_messages add constraint hg_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_messages add constraint hg_messages_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_theme_seen add constraint hg_theme_seen_pkey PRIMARY KEY (user_id, slug); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_birthday_log add constraint hg_birthday_log_pkey PRIMARY KEY (user_id, year); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profiles add constraint hg_profiles_member_number_key UNIQUE (member_number); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invite_links add constraint hg_invite_links_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invite_links add constraint hg_invite_links_token_key UNIQUE (token); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_pages add constraint hg_pages_pkey PRIMARY KEY (slug); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_probability_check CHECK (((probability > (0)::numeric) AND (probability <= (1)::numeric))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_max_per_page_check CHECK (((max_per_page >= 1) AND (max_per_page <= 10))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_duration_ms_check CHECK (((duration_ms >= 1500) AND (duration_ms <= 30000))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_size_px_check CHECK (((size_px >= 24) AND (size_px <= 240))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_check CHECK ((ends_at > starts_at)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_captures add constraint hg_dyn_captures_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_admin_state add constraint hg_admin_state_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_pages add constraint hg_pages_mode_check CHECK ((mode = ANY (ARRAY['membres'::text, 'admin'::text, 'liste'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_sets add constraint hg_card_sets_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_sets add constraint hg_card_sets_code_key UNIQUE (code); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_max_copies_check CHECK (((max_copies IS NULL) OR (max_copies > 0))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_set_id_number_key UNIQUE (set_id, number); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_copies add constraint hg_card_copies_source_check CHECK ((source = ANY (ARRAY['booster'::text, 'cadeau'::text, 'admin'::text, 'fabrication'::text, 'evenement'::text, 'echange'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_copies add constraint hg_card_copies_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_wishlist add constraint hg_card_wishlist_pkey PRIMARY KEY (user_id, card_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_wallets add constraint hg_wallets_paillettes_check CHECK ((paillettes >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_wallets add constraint hg_wallets_pkey PRIMARY KEY (user_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_wallet_log add constraint hg_wallet_log_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_status_check CHECK ((status = ANY (ARRAY['proposee'::text, 'acceptee'::text, 'refusee'::text, 'annulee'::text, 'remplacee'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_from_paillettes_check CHECK ((from_paillettes >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_to_paillettes_check CHECK ((to_paillettes >= 0)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_message_check CHECK (((message IS NULL) OR (char_length(message) <= 500))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_check CHECK ((from_user <> to_user)); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_pkey PRIMARY KEY (id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trade_items add constraint hg_card_trade_items_side_check CHECK ((side = ANY (ARRAY['from'::text, 'to'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trade_items add constraint hg_card_trade_items_pkey PRIMARY KEY (trade_id, copy_id); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_showcase add constraint hg_card_showcase_slot_check CHECK (((slot >= 1) AND (slot <= 3))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_showcase add constraint hg_card_showcase_pkey PRIMARY KEY (user_id, slot); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_rarity_check CHECK ((rarity = ANY (ARRAY['commune'::text, 'peu_commune'::text, 'rare'::text, 'epique'::text, 'legendaire'::text, 'mythique'::text, 'identite'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_caption_check CHECK (((caption IS NULL) OR (char_length(caption) <= 80))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_family_check CHECK ((family = ANY (ARRAY['membre'::text, 'moment'::text, 'lieu'::text, 'objet'::text, 'evenement'::text, 'jeu'::text]))); exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

-- 4bis. Clés étrangères (après toutes les tables)

do $$ begin alter table d_settings add constraint d_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_projects add constraint d_projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_links add constraint d_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_links add constraint d_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_tasks add constraint d_tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_tasks add constraint d_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_notes add constraint d_notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_notes add constraint d_notes_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_changelog add constraint d_changelog_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_changelog add constraint d_changelog_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_events add constraint d_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_events add constraint d_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_files add constraint d_files_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_files add constraint d_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_contacts add constraint d_contacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_contacts add constraint d_contacts_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_transactions add constraint d_transactions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_transactions add constraint d_transactions_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_transactions add constraint d_transactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES d_contacts(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_inventory add constraint d_inventory_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_inventory add constraint d_inventory_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_bugs add constraint d_bugs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_bugs add constraint d_bugs_project_id_fkey FOREIGN KEY (project_id) REFERENCES d_projects(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table d_features add constraint d_features_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invites add constraint hg_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invites add constraint hg_invites_used_by_fkey FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_participants add constraint hg_ss_participants_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_wishes add constraint hg_ss_wishes_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_exclusions add constraint hg_ss_exclusions_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_assignments add constraint hg_ss_assignments_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_rsvps add constraint hg_event_rsvps_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_dates add constraint hg_event_dates_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_date_votes add constraint hg_event_date_votes_date_id_fkey FOREIGN KEY (date_id) REFERENCES hg_event_dates(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_photos add constraint hg_photos_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_events(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_user_badges add constraint hg_user_badges_badge_code_fkey FOREIGN KEY (badge_code) REFERENCES hg_badges(code) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invite_links add constraint hg_invite_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_support add constraint hg_support_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_edition_id_fkey FOREIGN KEY (edition_id) REFERENCES hg_ss_editions(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversation_members add constraint hg_conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hg_conversations(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_messages add constraint hg_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hg_conversations(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_badge_code_fkey FOREIGN KEY (badge_code) REFERENCES hg_badges(code) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_captures add constraint hg_dyn_captures_event_id_fkey FOREIGN KEY (event_id) REFERENCES hg_dyn_events(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_page_access add constraint hg_page_access_page_slug_fkey FOREIGN KEY (page_slug) REFERENCES hg_pages(slug) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_set_id_fkey FOREIGN KEY (set_id) REFERENCES hg_card_sets(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_copies add constraint hg_card_copies_card_id_fkey FOREIGN KEY (card_id) REFERENCES hg_cards(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES hg_card_trades(id) ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trade_items add constraint hg_card_trade_items_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES hg_card_trades(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trade_items add constraint hg_card_trade_items_copy_id_fkey FOREIGN KEY (copy_id) REFERENCES hg_card_copies(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_wishlist add constraint hg_card_wishlist_card_id_fkey FOREIGN KEY (card_id) REFERENCES hg_cards(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_showcase add constraint hg_card_showcase_copy_id_fkey FOREIGN KEY (copy_id) REFERENCES hg_card_copies(id) ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_activity add constraint hg_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_participants add constraint hg_ss_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_wishes add constraint hg_ss_wishes_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_exclusions add constraint hg_ss_exclusions_user_a_fkey FOREIGN KEY (user_a) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_exclusions add constraint hg_ss_exclusions_user_b_fkey FOREIGN KEY (user_b) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_assignments add constraint hg_ss_assignments_giver_id_fkey FOREIGN KEY (giver_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ss_assignments add constraint hg_ss_assignments_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_events add constraint hg_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_rsvps add constraint hg_event_rsvps_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_event_date_votes add constraint hg_event_date_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_photos add constraint hg_photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_moments add constraint hg_moments_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_user_badges add constraint hg_user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_profile_info add constraint hg_profile_info_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_ideas add constraint hg_ideas_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_santa_id_fkey FOREIGN KEY (santa_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversations add constraint hg_conversations_target_id_fkey FOREIGN KEY (target_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_conversation_members add constraint hg_conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_messages add constraint hg_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_theme_seen add constraint hg_theme_seen_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_birthday_log add constraint hg_birthday_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_bot_log add constraint hg_bot_log_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_events add constraint hg_dyn_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_dyn_captures add constraint hg_dyn_captures_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_admin_state add constraint hg_admin_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_page_access add constraint hg_page_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_cards add constraint hg_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_copies add constraint hg_card_copies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE SET NULL; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_wallets add constraint hg_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_wallet_log add constraint hg_wallet_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_from_user_fkey FOREIGN KEY (from_user) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_trades add constraint hg_card_trades_to_user_fkey FOREIGN KEY (to_user) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_wishlist add constraint hg_card_wishlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_card_showcase add constraint hg_card_showcase_user_id_fkey FOREIGN KEY (user_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin alter table hg_invites add constraint hg_invites_ghost_id_fkey FOREIGN KEY (ghost_id) REFERENCES hg_profiles(id) ON UPDATE CASCADE ON DELETE CASCADE; exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

-- 5. Index (hors index servant aux contraintes)

CREATE INDEX IF NOT EXISTS idx_d_projects_owner ON public.d_projects USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_features_owner ON public.d_features USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_links_project ON public.d_links USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_links_owner ON public.d_links USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_tasks_project ON public.d_tasks USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_tasks_owner ON public.d_tasks USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_notes_project ON public.d_notes USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_notes_owner ON public.d_notes USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_changelog_project ON public.d_changelog USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_changelog_owner ON public.d_changelog USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_events_project ON public.d_events USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_events_owner ON public.d_events USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_files_project ON public.d_files USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_files_owner ON public.d_files USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_contacts_project ON public.d_contacts USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_contacts_owner ON public.d_contacts USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_transactions_project ON public.d_transactions USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_transactions_owner ON public.d_transactions USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_inventory_project ON public.d_inventory USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_inventory_owner ON public.d_inventory USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_bugs_project ON public.d_bugs USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_d_bugs_owner ON public.d_bugs USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_d_tx_contact ON public.d_transactions USING btree (contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS hg_themes_one_default ON public.hg_themes USING btree (is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS hg_messages_conv_idx ON public.hg_messages USING btree (conversation_id, id);
CREATE INDEX IF NOT EXISTS hg_dyn_captures_ev ON public.hg_dyn_captures USING btree (event_id, user_id);
CREATE INDEX IF NOT EXISTS hg_card_copies_owner ON public.hg_card_copies USING btree (owner_id) WHERE (recycled_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS hg_card_copies_serial ON public.hg_card_copies USING btree (card_id, serial) WHERE (serial IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS hg_wallet_log_once ON public.hg_wallet_log USING btree (user_id, reason, ref) WHERE (ref IS NOT NULL);

-- 6. Fonctions (corps tels que stockés en base)
-- check_function_bodies désactivé : les fonctions SQL peuvent référencer
-- d'autres fonctions créées plus loin dans ce fichier.
set check_function_bodies = off;

-- d_owns_project
CREATE OR REPLACE FUNCTION public.d_owns_project(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from d_projects p where p.id = pid and p.owner_id = auth.uid())
$function$;

-- d_touch_project
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
end $function$;

-- hg_admin_accounts
CREATE OR REPLACE FUNCTION public.hg_admin_accounts()
 RETURNS TABLE(id uuid, pseudo text, email text, is_admin boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo, u.email::text, p.is_admin, p.created_at, u.last_sign_in_at
    from hg_profiles p join auth.users u on u.id = p.id order by p.pseudo;
end $function$;

-- hg_admin_conversations
CREATE OR REPLACE FUNCTION public.hg_admin_conversations()
 RETURNS TABLE(id uuid, kind text, edition_year integer, members text, santa text, target text, last_message_at timestamp with time zone, messages integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  return query select c.id, c.kind, e.year,
    (select string_agg(p.pseudo, ' · ' order by p.pseudo) from hg_conversation_members m join hg_profiles p on p.id = m.user_id where m.conversation_id = c.id),
    (select pseudo from hg_profiles where id = c.santa_id), (select pseudo from hg_profiles where id = c.target_id),
    c.last_message_at, (select count(*)::int from hg_messages x where x.conversation_id = c.id)
  from hg_conversations c left join hg_ss_editions e on e.id = c.edition_id order by c.last_message_at desc;
end $function$;

-- hg_admin_ghosts
CREATE OR REPLACE FUNCTION public.hg_admin_ghosts()
 RETURNS TABLE(id uuid, pseudo text, joined_on date, ghost_note text, avatar_url text, created_at timestamp with time zone, invite_code text, invite_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo, p.joined_on, p.ghost_note, p.avatar_url, p.created_at,
    i.code, i.expires_at
  from hg_profiles p
  left join lateral (select code, expires_at from hg_invites where ghost_id = p.id and used_by is null and (expires_at is null or expires_at > now()) order by created_at desc limit 1) i on true
  where p.is_ghost order by p.pseudo;
end $function$;

-- hg_auth_user_gone
CREATE OR REPLACE FUNCTION public.hg_auth_user_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  execute 'del' || 'ete from public.hg_profiles where id = $1 and not is_ghost' using old.id;
  return old;
end $function$;

-- hg_award_badges
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
end $function$;

-- hg_award_level_badges
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
end $function$;

-- hg_badge_activity
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
end $function$;

-- hg_badge_level_activity
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
end $function$;

-- hg_card_cfg
CREATE OR REPLACE FUNCTION public.hg_card_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select value from hg_settings where key = 'cards'), '{}'::jsonb) $function$;

-- hg_card_check_sets
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
end $function$;

-- hg_card_craft
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
end $function$;

-- hg_card_gift
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
end $function$;

-- hg_card_give
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
end $function$;

-- hg_card_leaderboard
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
$function$;

-- hg_card_pick
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
end $function$;

-- hg_card_rank
CREATE OR REPLACE FUNCTION public.hg_card_rank(p text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select array_position(array['commune','peu_commune','rare','epique','legendaire','mythique','identite'], p) $function$;

-- hg_card_recycle
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
end $function$;

-- hg_card_roll
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
end $function$;

-- hg_cards_admin_give
CREATE OR REPLACE FUNCTION public.hg_cards_admin_give(p_user uuid, p_card uuid, p_shiny boolean DEFAULT false, p_count integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  for i in 1..greatest(least(coalesce(p_count, 1), 100), 1) loop perform hg_card_give(p_user, p_card, p_shiny, 'admin'); end loop;
  perform hg_card_check_sets(p_user);
  return greatest(least(coalesce(p_count, 1), 100), 1);
end $function$;

-- hg_cards_admin_paillettes
CREATE OR REPLACE FUNCTION public.hg_cards_admin_paillettes(p_user uuid, p_delta integer, p_reason text DEFAULT 'admin'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_wallet_add(p_user, greatest(p_delta, -bal), coalesce(nullif(p_reason, ''), 'admin'), null);
  select paillettes into bal from hg_wallets where user_id = p_user;
  return bal;
end $function$;

-- hg_cards_admin_take
CREATE OR REPLACE FUNCTION public.hg_cards_admin_take(p_copy bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  update hg_card_copies set recycled_at = now(), locked_trade = null where id = p_copy;
end $function$;

-- hg_cards_daily
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
end $function$;

-- hg_cards_earn_trg
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
  exception when others then null;
  end;
  return new;
end $function$;

-- hg_cards_me
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
end $function$;

-- hg_cards_presence
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
end $function$;

-- hg_claim_invite_link
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
end $function$;

-- hg_conv_title
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
  end $function$;

-- hg_delete_my_account
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
end $function$;

-- hg_dyn_active
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
  where public.hg_is_member() and e.active and now() between e.starts_at and e.ends_at $function$;

-- hg_dyn_capture
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
end $function$;

-- hg_dyn_leaderboard
CREATE OR REPLACE FUNCTION public.hg_dyn_leaderboard(p_event uuid)
 RETURNS TABLE(user_id uuid, pseudo text, avatar_url text, captures integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.pseudo, p.avatar_url, count(*)::int from hg_dyn_captures c join hg_profiles p on p.id = c.user_id
  where c.event_id = p_event and public.hg_is_member() group by p.id order by count(*) desc, min(c.captured_at) limit 50 $function$;

-- hg_export_my_data
CREATE OR REPLACE FUNCTION public.hg_export_my_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'profil', (select to_jsonb(p) from hg_profiles p where id = auth.uid()),
  'secret_santa_participations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_participants x where user_id = auth.uid()),
  'souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_wishes x where user_id = auth.uid()),
  'reponses_irl', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_rsvps x where user_id = auth.uid()),
  'photos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_photos x where user_id = auth.uid()),
  'idees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ideas x where user_id = auth.uid()),
  'assistance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_support x where user_id = auth.uid()),
  'badges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_user_badges x where user_id = auth.uid())
) $function$;

-- hg_get_messages
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
  order by x.id asc limit least(coalesce(p_limit, 200), 500) $function$;

-- hg_ghost_create
CREATE OR REPLACE FUNCTION public.hg_ghost_create(p_pseudo text, p_joined_on date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := gen_random_uuid();
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  if coalesce(trim(p_pseudo), '') = '' then raise exception 'Pseudo obligatoire'; end if;
  insert into hg_profiles(id, pseudo, joined_on, is_ghost, ghost_note, bot_optin, share_birthday)
    values (v_id, trim(p_pseudo), p_joined_on, true, nullif(trim(p_note), ''), false, false);
  return v_id;
end $function$;

-- hg_ghost_invite
CREATE OR REPLACE FUNCTION public.hg_ghost_invite(p_ghost uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  if not exists(select 1 from hg_profiles where id = p_ghost and is_ghost) then raise exception 'Compte fantôme introuvable'; end if;
  update hg_invites set expires_at = now() where ghost_id = p_ghost and used_by is null and (expires_at is null or expires_at > now());
  loop
    v_code := 'HG-';
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists(select 1 from hg_invites where code = v_code);
  end loop;
  insert into hg_invites(code, created_by, ghost_id, expires_at) values (v_code, auth.uid(), p_ghost, now() + interval '60 days');
  return v_code;
end $function$;

-- hg_ghost_merge
CREATE OR REPLACE FUNCTION public.hg_ghost_merge(p_ghost uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g hg_profiles; u hg_profiles; r record; moved int := 0; n int; rr record;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
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
end $function$;

-- hg_ghost_suggestions
CREATE OR REPLACE FUNCTION public.hg_ghost_suggestions()
 RETURNS TABLE(ghost_id uuid, ghost_pseudo text, user_id uuid, user_pseudo text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  return query
    select g.id, g.pseudo, p.id, p.pseudo,
      case when g.discord_id is not null and g.discord_id = p.discord_id then 'Même ID Discord' else 'Même pseudo' end
    from hg_profiles g join hg_profiles p on not p.is_ghost
     and ((g.discord_id is not null and g.discord_id = p.discord_id) or lower(trim(g.pseudo)) = lower(trim(p.pseudo)))
    where g.is_ghost;
end $function$;

-- hg_god_mode
CREATE OR REPLACE FUNCTION public.hg_god_mode()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.hg_is_admin() and exists(select 1 from hg_admin_state where user_id = auth.uid() and god_until > now()) $function$;

-- hg_is_admin
CREATE OR REPLACE FUNCTION public.hg_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select is_admin from public.hg_profiles where id = auth.uid()), false) $function$;

-- hg_is_member
CREATE OR REPLACE FUNCTION public.hg_is_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from public.hg_profiles where id = auth.uid()) $function$;

-- hg_join
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
end $function$;

-- hg_mark_read
CREATE OR REPLACE FUNCTION public.hg_mark_read(p_conv uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update hg_conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid() $function$;

-- hg_mark_theme_seen
CREATE OR REPLACE FUNCTION public.hg_mark_theme_seen(p_slug text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into hg_theme_seen(user_id, slug) select auth.uid(), p_slug
  where public.hg_is_member() and exists(select 1 from hg_themes where slug = p_slug and not is_default)
  on conflict do nothing $function$;

-- hg_member_card
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
    from hg_profiles p where p.id = p_user and (not p.is_ghost or public.hg_is_admin())) end $function$;

-- hg_members
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
$function$;

-- hg_metric_value
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
    else 0 end $function$;

-- hg_my_badge_progress
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
$function$;

-- hg_my_conversations
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
  order by c.last_message_at desc $function$;

-- hg_my_pages
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
  order by p.sort $function$;

-- hg_open_booster
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
end $function$;

-- hg_open_direct
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
end $function$;

-- hg_open_santa
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
end $function$;

-- hg_profiles_guard
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
end $function$;

-- hg_profiles_sync_joined
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
end $function$;

-- hg_refresh_my_badges
CREATE OR REPLACE FUNCTION public.hg_refresh_my_badges()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when public.hg_is_member() then public.hg_award_badges(auth.uid()) + public.hg_award_level_badges(auth.uid()) else 0 end $function$;

-- hg_send_message
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
end $function$;

-- hg_set_god_mode
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
end $function$;

-- hg_ss_draw
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
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
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
end $function$;

-- hg_ss_editions_guard
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
end $function$;

-- hg_ss_is_santa_of
CREATE OR REPLACE FUNCTION public.hg_ss_is_santa_of(p_edition uuid, p_receiver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists(select 1 from hg_ss_assignments a where a.edition_id = p_edition and a.giver_id = auth.uid() and a.receiver_id = p_receiver) $function$;

-- hg_ss_manual_draw
CREATE OR REPLACE FUNCTION public.hg_ss_manual_draw(p_edition uuid, p_pairs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_parts uuid[]; v_g uuid[]; v_r uuid[]; v_n int; v_year int; v_god boolean := public.hg_god_mode();
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
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
end $function$;

-- hg_ss_my_target
CREATE OR REPLACE FUNCTION public.hg_ss_my_target(p_edition uuid)
 RETURNS TABLE(receiver_id uuid, pseudo text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select a.receiver_id, p.pseudo, p.avatar_url from hg_ss_assignments a join hg_profiles p on p.id = a.receiver_id
   where a.edition_id = p_edition and a.giver_id = auth.uid() $function$;

-- hg_ss_progress
CREATE OR REPLACE FUNCTION public.hg_ss_progress(p_edition uuid)
 RETURNS TABLE(participants integer, sent integer, received integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select count(*)::int, count(sent_at)::int, count(received_at)::int from hg_ss_participants
   where edition_id = p_edition and public.hg_is_member() $function$;

-- hg_ss_reveal
CREATE OR REPLACE FUNCTION public.hg_ss_reveal(p_edition uuid)
 RETURNS TABLE(giver text, receiver text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select g.pseudo, r.pseudo from hg_ss_assignments a
   join hg_ss_editions e on e.id = a.edition_id and e.status in ('revelation','termine')
   join hg_profiles g on g.id = a.giver_id join hg_profiles r on r.id = a.receiver_id
   where a.edition_id = p_edition and public.hg_is_member() order by g.pseudo $function$;

-- hg_ss_target_info
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
$function$;

-- hg_trade_cancel
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
  if t.from_user <> auth.uid() and not hg_is_admin() then raise exception 'Action non autorisée'; end if;
  update hg_card_trades set status = 'annulee', resolved_at = now() where id = p_trade;
  update hg_card_copies set locked_trade = null where locked_trade = p_trade;
end $function$;

-- hg_trade_propose
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
end $function$;

-- hg_trade_respond
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
end $function$;

-- hg_unread_count
CREATE OR REPLACE FUNCTION public.hg_unread_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum((select count(*) from hg_messages x where x.conversation_id = m.conversation_id
                       and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid())), 0)::int
  from hg_conversation_members m where m.user_id = auth.uid() $function$;

-- hg_wallet_add
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
end $function$;

-- hg_wallet_welcome
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
end $function$;

-- hg_year_recap
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
  ) end $function$;

-- set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;

set check_function_bodies = on;

-- 7. Triggers

drop trigger if exists hg_profiles_guard on hg_profiles;
CREATE TRIGGER hg_profiles_guard BEFORE UPDATE ON public.hg_profiles FOR EACH ROW EXECUTE FUNCTION hg_profiles_guard();
drop trigger if exists hg_ss_editions_guard on hg_ss_editions;
CREATE TRIGGER hg_ss_editions_guard BEFORE INSERT ON public.hg_ss_editions FOR EACH ROW EXECUTE FUNCTION hg_ss_editions_guard();
drop trigger if exists hg_badge_activity on hg_user_badges;
CREATE TRIGGER hg_badge_activity AFTER INSERT ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_badge_activity();
drop trigger if exists trg_touch on d_links;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_links FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_tasks;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_tasks FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_notes;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_notes FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_changelog;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_changelog FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_events;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_events FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_files;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_files FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_contacts;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_contacts FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_transactions;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_transactions FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_inventory;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_inventory FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_touch on d_bugs;
CREATE TRIGGER trg_touch AFTER INSERT OR DELETE OR UPDATE ON public.d_bugs FOR EACH ROW EXECUTE FUNCTION d_touch_project();
drop trigger if exists trg_updated_at on d_settings;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_projects;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_features;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_features FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_links;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_tasks;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_notes;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_changelog;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_changelog FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_events;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_files;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_files FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_contacts;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_transactions;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_inventory;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_inventory FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists trg_updated_at on d_bugs;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.d_bugs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists hg_badge_level_activity on hg_user_badges;
CREATE TRIGGER hg_badge_level_activity AFTER UPDATE OF level ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_badge_level_activity();
drop trigger if exists hg_profiles_sync_joined on hg_profiles;
CREATE TRIGGER hg_profiles_sync_joined BEFORE INSERT OR UPDATE OF joined_on, created_at ON public.hg_profiles FOR EACH ROW EXECUTE FUNCTION hg_profiles_sync_joined();
drop trigger if exists hg_cards_earn on hg_event_rsvps;
CREATE TRIGGER hg_cards_earn AFTER INSERT OR UPDATE OF status ON public.hg_event_rsvps FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_events;
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_events FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_photos;
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_photos FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_moments;
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_moments FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_user_badges;
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_user_badges FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_dyn_captures;
CREATE TRIGGER hg_cards_earn AFTER INSERT ON public.hg_dyn_captures FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_cards_earn on hg_ss_participants;
CREATE TRIGGER hg_cards_earn AFTER UPDATE OF sent_at ON public.hg_ss_participants FOR EACH ROW EXECUTE FUNCTION hg_cards_earn_trg();
drop trigger if exists hg_wallet_welcome on hg_wallets;
CREATE TRIGGER hg_wallet_welcome AFTER INSERT ON public.hg_wallets FOR EACH ROW EXECUTE FUNCTION hg_wallet_welcome();

-- 8. Row Level Security activée

alter table d_settings enable row level security;
alter table d_projects enable row level security;
alter table d_features enable row level security;
alter table d_links enable row level security;
alter table d_tasks enable row level security;
alter table d_notes enable row level security;
alter table d_changelog enable row level security;
alter table d_events enable row level security;
alter table d_files enable row level security;
alter table d_contacts enable row level security;
alter table d_transactions enable row level security;
alter table d_inventory enable row level security;
alter table d_bugs enable row level security;
alter table hg_ss_editions enable row level security;
alter table hg_profiles enable row level security;
alter table hg_invites enable row level security;
alter table hg_settings enable row level security;
alter table hg_activity enable row level security;
alter table hg_ss_participants enable row level security;
alter table hg_events enable row level security;
alter table hg_ss_wishes enable row level security;
alter table hg_ss_exclusions enable row level security;
alter table hg_ss_assignments enable row level security;
alter table hg_event_rsvps enable row level security;
alter table hg_event_dates enable row level security;
alter table hg_event_date_votes enable row level security;
alter table hg_photos enable row level security;
alter table hg_ideas enable row level security;
alter table hg_support enable row level security;
alter table hg_moments enable row level security;
alter table hg_themes enable row level security;
alter table hg_profile_info enable row level security;
alter table hg_badges enable row level security;
alter table hg_conversations enable row level security;
alter table hg_conversation_members enable row level security;
alter table hg_messages enable row level security;
alter table hg_theme_seen enable row level security;
alter table hg_invite_links enable row level security;
alter table hg_birthday_log enable row level security;
alter table hg_bot_log enable row level security;
alter table hg_user_badges enable row level security;
alter table hg_dyn_events enable row level security;
alter table hg_dyn_captures enable row level security;
alter table hg_admin_state enable row level security;
alter table hg_pages enable row level security;
alter table hg_page_access enable row level security;
alter table hg_card_sets enable row level security;
alter table hg_card_copies enable row level security;
alter table hg_wallets enable row level security;
alter table hg_wallet_log enable row level security;
alter table hg_card_trades enable row level security;
alter table hg_card_trade_items enable row level security;
alter table hg_card_wishlist enable row level security;
alter table hg_card_showcase enable row level security;
alter table hg_cards enable row level security;

-- 9. Policies RLS

drop policy if exists hg_card_showcase_admin on hg_card_showcase;
create policy hg_card_showcase_admin on hg_card_showcase as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_sets_read on hg_card_sets;
create policy hg_card_sets_read on hg_card_sets as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_cards_read on hg_cards;
create policy hg_cards_read on hg_cards as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_card_copies_read on hg_card_copies;
create policy hg_card_copies_read on hg_card_copies as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_card_showcase_read on hg_card_showcase;
create policy hg_card_showcase_read on hg_card_showcase as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_card_wishlist_read on hg_card_wishlist;
create policy hg_card_wishlist_read on hg_card_wishlist as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_card_wishlist_own on hg_card_wishlist;
create policy hg_card_wishlist_own on hg_card_wishlist as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
drop policy if exists hg_card_showcase_own on hg_card_showcase;
create policy hg_card_showcase_own on hg_card_showcase as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM hg_card_copies c
  WHERE ((c.id = hg_card_showcase.copy_id) AND (c.owner_id = ( SELECT auth.uid() AS uid)) AND (c.recycled_at IS NULL))))));
drop policy if exists hg_wallets_own on hg_wallets;
create policy hg_wallets_own on hg_wallets as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_wallet_log_own on hg_wallet_log;
create policy hg_wallet_log_own on hg_wallet_log as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_settings_admin on hg_settings;
create policy hg_settings_admin on hg_settings as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_activity_read on hg_activity;
create policy hg_activity_read on hg_activity as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_ss_editions_read on hg_ss_editions;
create policy hg_ss_editions_read on hg_ss_editions as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_ss_editions_admin on hg_ss_editions;
create policy hg_ss_editions_admin on hg_ss_editions as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ss_part_read on hg_ss_participants;
create policy hg_ss_part_read on hg_ss_participants as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_ss_part_join on hg_ss_participants;
create policy hg_ss_part_join on hg_ss_participants as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member() AND (EXISTS ( SELECT 1
   FROM hg_ss_editions e
  WHERE ((e.id = hg_ss_participants.edition_id) AND (e.status = 'inscriptions'::text))))));
drop policy if exists hg_ss_part_update_own on hg_ss_participants;
create policy hg_ss_part_update_own on hg_ss_participants as permissive for update to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_ss_part_admin on hg_ss_participants;
create policy hg_ss_part_admin on hg_ss_participants as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_moments_read on hg_moments;
create policy hg_moments_read on hg_moments as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_moments_insert on hg_moments;
create policy hg_moments_insert on hg_moments as permissive for insert to authenticated with check ((hg_is_member() AND (created_by = ( SELECT auth.uid() AS uid))));
drop policy if exists d_settings_owner_lock on d_settings;
create policy d_settings_owner_lock on d_settings as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_projects_owner_lock on d_projects;
create policy d_projects_owner_lock on d_projects as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists hg_card_trades_mine on hg_card_trades;
create policy hg_card_trades_mine on hg_card_trades as permissive for select to authenticated using (((( SELECT auth.uid() AS uid) = from_user) OR (( SELECT auth.uid() AS uid) = to_user)));
drop policy if exists hg_bdlog_admin on hg_birthday_log;
create policy hg_bdlog_admin on hg_birthday_log as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists d_settings_own on d_settings;
create policy d_settings_own on d_settings as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists d_projects_own on d_projects;
create policy d_projects_own on d_projects as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
drop policy if exists d_features_own on d_features;
create policy d_features_own on d_features as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check ((owner_id = ( SELECT auth.uid() AS uid)));
drop policy if exists d_links_own on d_links;
create policy d_links_own on d_links as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_tasks_own on d_tasks;
create policy d_tasks_own on d_tasks as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists hg_invite_links_admin on hg_invite_links;
create policy hg_invite_links_admin on hg_invite_links as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists d_notes_own on d_notes;
create policy d_notes_own on d_notes as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_changelog_own on d_changelog;
create policy d_changelog_own on d_changelog as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_events_own on d_events;
create policy d_events_own on d_events as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_files_own on d_files;
create policy d_files_own on d_files as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_contacts_own on d_contacts;
create policy d_contacts_own on d_contacts as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_transactions_own on d_transactions;
create policy d_transactions_own on d_transactions as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_inventory_own on d_inventory;
create policy d_inventory_own on d_inventory as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists d_bugs_own on d_bugs;
create policy d_bugs_own on d_bugs as permissive for all to authenticated using ((owner_id = ( SELECT auth.uid() AS uid))) with check (((owner_id = ( SELECT auth.uid() AS uid)) AND d_owns_project(project_id)));
drop policy if exists hg_profiles_select_own on hg_profiles;
create policy hg_profiles_select_own on hg_profiles as permissive for select to authenticated using ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_profiles_update_own on hg_profiles;
create policy hg_profiles_update_own on hg_profiles as permissive for update to authenticated using ((id = ( SELECT auth.uid() AS uid))) with check ((id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_invites_admin on hg_invites;
create policy hg_invites_admin on hg_invites as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ss_wishes_own on hg_ss_wishes;
create policy hg_ss_wishes_own on hg_ss_wishes as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_ss_wishes_santa on hg_ss_wishes;
create policy hg_ss_wishes_santa on hg_ss_wishes as permissive for select to authenticated using (hg_ss_is_santa_of(edition_id, user_id));
drop policy if exists hg_ss_excl_admin on hg_ss_exclusions;
create policy hg_ss_excl_admin on hg_ss_exclusions as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_events_read on hg_events;
create policy hg_events_read on hg_events as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_events_insert on hg_events;
create policy hg_events_insert on hg_events as permissive for insert to authenticated with check ((hg_is_member() AND (created_by = ( SELECT auth.uid() AS uid))));
drop policy if exists hg_events_update on hg_events;
create policy hg_events_update on hg_events as permissive for update to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
drop policy if exists hg_rsvps_read on hg_event_rsvps;
create policy hg_rsvps_read on hg_event_rsvps as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_bot_log_admin on hg_bot_log;
create policy hg_bot_log_admin on hg_bot_log as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_rsvps_own on hg_event_rsvps;
create policy hg_rsvps_own on hg_event_rsvps as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
drop policy if exists hg_dates_read on hg_event_dates;
create policy hg_dates_read on hg_event_dates as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_dates_write on hg_event_dates;
create policy hg_dates_write on hg_event_dates as permissive for all to authenticated using ((hg_is_admin() OR (EXISTS ( SELECT 1
   FROM hg_events e
  WHERE ((e.id = hg_event_dates.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid))))))) with check ((hg_is_admin() OR (EXISTS ( SELECT 1
   FROM hg_events e
  WHERE ((e.id = hg_event_dates.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)))))));
drop policy if exists hg_votes_read on hg_event_date_votes;
create policy hg_votes_read on hg_event_date_votes as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_votes_own on hg_event_date_votes;
create policy hg_votes_own on hg_event_date_votes as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
drop policy if exists hg_photos_read on hg_photos;
create policy hg_photos_read on hg_photos as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_photos_insert on hg_photos;
create policy hg_photos_insert on hg_photos as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
drop policy if exists hg_moments_edit on hg_moments;
create policy hg_moments_edit on hg_moments as permissive for update to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
drop policy if exists hg_badges_read on hg_badges;
create policy hg_badges_read on hg_badges as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_badges_admin on hg_badges;
create policy hg_badges_admin on hg_badges as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ubadges_read on hg_user_badges;
create policy hg_ubadges_read on hg_user_badges as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_ubadges_admin on hg_user_badges;
create policy hg_ubadges_admin on hg_user_badges as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ideas_insert on hg_ideas;
create policy hg_ideas_insert on hg_ideas as permissive for insert to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_member()));
drop policy if exists hg_ideas_admin on hg_ideas;
create policy hg_ideas_admin on hg_ideas as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_support_admin on hg_support;
create policy hg_support_admin on hg_support as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_settings_read on hg_settings;
create policy hg_settings_read on hg_settings as permissive for select to authenticated, anon using ((key = 'theme'::text));
drop policy if exists hg_ss_part_leave on hg_ss_participants;
create policy hg_ss_part_leave on hg_ss_participants as permissive for delete to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM hg_ss_editions e
  WHERE ((e.id = hg_ss_participants.edition_id) AND (e.status = 'inscriptions'::text))))));
drop policy if exists hg_dyn_events_admin on hg_dyn_events;
create policy hg_dyn_events_admin on hg_dyn_events as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_dyn_captures_read on hg_dyn_captures;
create policy hg_dyn_captures_read on hg_dyn_captures as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_events_delete on hg_events;
create policy hg_events_delete on hg_events as permissive for delete to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
drop policy if exists hg_photos_delete on hg_photos;
create policy hg_photos_delete on hg_photos as permissive for delete to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
drop policy if exists hg_moments_delete on hg_moments;
create policy hg_moments_delete on hg_moments as permissive for delete to authenticated using (((created_by = ( SELECT auth.uid() AS uid)) OR hg_is_admin()));
drop policy if exists d_links_owner_lock on d_links;
create policy d_links_owner_lock on d_links as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_tasks_owner_lock on d_tasks;
create policy d_tasks_owner_lock on d_tasks as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_notes_owner_lock on d_notes;
create policy d_notes_owner_lock on d_notes as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_changelog_owner_lock on d_changelog;
create policy d_changelog_owner_lock on d_changelog as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_events_owner_lock on d_events;
create policy d_events_owner_lock on d_events as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_files_owner_lock on d_files;
create policy d_files_owner_lock on d_files as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_contacts_owner_lock on d_contacts;
create policy d_contacts_owner_lock on d_contacts as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_transactions_owner_lock on d_transactions;
create policy d_transactions_owner_lock on d_transactions as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_inventory_owner_lock on d_inventory;
create policy d_inventory_owner_lock on d_inventory as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_bugs_owner_lock on d_bugs;
create policy d_bugs_owner_lock on d_bugs as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists d_features_owner_lock on d_features;
create policy d_features_owner_lock on d_features as restrictive for all to authenticated using ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid)) with check ((( SELECT auth.uid() AS uid) = '00000000-0000-0000-0000-000000000000'::uuid));
drop policy if exists hg_themes_read on hg_themes;
create policy hg_themes_read on hg_themes as permissive for select to authenticated, anon using (true);
drop policy if exists hg_themes_admin on hg_themes;
create policy hg_themes_admin on hg_themes as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_dyn_captures_admin on hg_dyn_captures;
create policy hg_dyn_captures_admin on hg_dyn_captures as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_pinfo_own on hg_profile_info;
create policy hg_pinfo_own on hg_profile_info as permissive for all to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists hg_pinfo_admin on hg_profile_info;
create policy hg_pinfo_admin on hg_profile_info as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_profiles_admin_read on hg_profiles;
create policy hg_profiles_admin_read on hg_profiles as permissive for select to authenticated using (hg_is_admin());
drop policy if exists hg_profiles_admin_update on hg_profiles;
create policy hg_profiles_admin_update on hg_profiles as permissive for update to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ss_wishes_admin on hg_ss_wishes;
create policy hg_ss_wishes_admin on hg_ss_wishes as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_ss_assign_admin on hg_ss_assignments;
create policy hg_ss_assign_admin on hg_ss_assignments as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_rsvps_admin on hg_event_rsvps;
create policy hg_rsvps_admin on hg_event_rsvps as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_votes_admin on hg_event_date_votes;
create policy hg_votes_admin on hg_event_date_votes as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_photos_admin on hg_photos;
create policy hg_photos_admin on hg_photos as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_activity_admin on hg_activity;
create policy hg_activity_admin on hg_activity as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_conv_admin on hg_conversations;
create policy hg_conv_admin on hg_conversations as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_convm_admin on hg_conversation_members;
create policy hg_convm_admin on hg_conversation_members as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_msg_admin on hg_messages;
create policy hg_msg_admin on hg_messages as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_theme_seen_admin on hg_theme_seen;
create policy hg_theme_seen_admin on hg_theme_seen as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_dyn_events_read on hg_dyn_events;
create policy hg_dyn_events_read on hg_dyn_events as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_rsvps_creator on hg_event_rsvps;
create policy hg_rsvps_creator on hg_event_rsvps as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM hg_events e
  WHERE ((e.id = hg_event_rsvps.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid)))))) with check (((EXISTS ( SELECT 1
   FROM hg_events e
  WHERE ((e.id = hg_event_rsvps.event_id) AND (e.created_by = ( SELECT auth.uid() AS uid))))) AND hg_is_member()));
drop policy if exists hg_admin_state_own on hg_admin_state;
create policy hg_admin_state_own on hg_admin_state as permissive for select to authenticated using (((user_id = ( SELECT auth.uid() AS uid)) AND hg_is_admin()));
drop policy if exists hg_pages_read on hg_pages;
create policy hg_pages_read on hg_pages as permissive for select to authenticated using (hg_is_member());
drop policy if exists hg_pages_admin on hg_pages;
create policy hg_pages_admin on hg_pages as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_page_access_admin on hg_page_access;
create policy hg_page_access_admin on hg_page_access as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_sets_admin on hg_card_sets;
create policy hg_card_sets_admin on hg_card_sets as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_cards_admin on hg_cards;
create policy hg_cards_admin on hg_cards as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_copies_admin on hg_card_copies;
create policy hg_card_copies_admin on hg_card_copies as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_wallets_admin on hg_wallets;
create policy hg_wallets_admin on hg_wallets as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_wallet_log_admin on hg_wallet_log;
create policy hg_wallet_log_admin on hg_wallet_log as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_trades_admin on hg_card_trades;
create policy hg_card_trades_admin on hg_card_trades as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_trade_items_admin on hg_card_trade_items;
create policy hg_card_trade_items_admin on hg_card_trade_items as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_wishlist_admin on hg_card_wishlist;
create policy hg_card_wishlist_admin on hg_card_wishlist as permissive for all to authenticated using (hg_is_admin()) with check (hg_is_admin());
drop policy if exists hg_card_trade_items_mine on hg_card_trade_items;
create policy hg_card_trade_items_mine on hg_card_trade_items as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM hg_card_trades t
  WHERE ((t.id = hg_card_trade_items.trade_id) AND ((( SELECT auth.uid() AS uid) = t.from_user) OR (( SELECT auth.uid() AS uid) = t.to_user))))));
drop policy if exists hg_profiles_admin_delete_ghost on hg_profiles;
create policy hg_profiles_admin_delete_ghost on hg_profiles as permissive for delete to authenticated using ((hg_is_admin() AND is_ghost));
-- 9bis. Policies sur storage.objects (buckets hg-*, d-files)
drop policy if exists dfiles_delete_own on storage.objects;
create policy dfiles_delete_own on storage.objects as permissive for delete to authenticated using ((bucket_id = 'd-files'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists dfiles_insert_own on storage.objects;
create policy dfiles_insert_own on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'd-files'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists dfiles_update_own on storage.objects;
create policy dfiles_update_own on storage.objects as permissive for update to authenticated using ((bucket_id = 'd-files'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_assets_obj_admin_del on storage.objects;
create policy hg_assets_obj_admin_del on storage.objects as permissive for delete to authenticated using ((bucket_id = 'hg-assets'::text) and hg_is_admin());
drop policy if exists hg_assets_obj_admin_ins on storage.objects;
create policy hg_assets_obj_admin_ins on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'hg-assets'::text) and hg_is_admin());
drop policy if exists hg_assets_obj_admin_sel on storage.objects;
create policy hg_assets_obj_admin_sel on storage.objects as permissive for select to authenticated using ((bucket_id = 'hg-assets'::text) and hg_is_admin());
drop policy if exists hg_assets_obj_admin_upd on storage.objects;
create policy hg_assets_obj_admin_upd on storage.objects as permissive for update to authenticated using ((bucket_id = 'hg-assets'::text) and hg_is_admin());
drop policy if exists hg_avatars_obj_delete on storage.objects;
create policy hg_avatars_obj_delete on storage.objects as permissive for delete to authenticated using ((bucket_id = 'hg-avatars'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_avatars_obj_sel on storage.objects;
create policy hg_avatars_obj_sel on storage.objects as permissive for select to authenticated using ((bucket_id = 'hg-avatars'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_avatars_obj_update on storage.objects;
create policy hg_avatars_obj_update on storage.objects as permissive for update to authenticated using ((bucket_id = 'hg-avatars'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_avatars_obj_write on storage.objects;
create policy hg_avatars_obj_write on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'hg-avatars'::text) and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_photos_obj_delete on storage.objects;
create policy hg_photos_obj_delete on storage.objects as permissive for delete to authenticated using ((bucket_id = 'hg-photos'::text) and (((storage.foldername(name))[1] = ((select auth.uid() as uid))::text) or hg_is_admin()));
drop policy if exists hg_photos_obj_insert on storage.objects;
create policy hg_photos_obj_insert on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'hg-photos'::text) and hg_is_member() and ((storage.foldername(name))[1] = ((select auth.uid() as uid))::text));
drop policy if exists hg_photos_obj_read on storage.objects;
create policy hg_photos_obj_read on storage.objects as permissive for select to authenticated using ((bucket_id = 'hg-photos'::text) and hg_is_member());



-- 10. Buckets de stockage (noms et visibilité seulement)
insert into storage.buckets (id, name, public) values
  ('photos', 'photos', true),
  ('d-files', 'd-files', true),
  ('hg-photos', 'hg-photos', false),
  ('hg-avatars', 'hg-avatars', true),
  ('hg-assets', 'hg-assets', true)
on conflict (id) do nothing;

-- 11. Tâches pg_cron (lecture de cron.job). Les URL de fonctions edge sont
-- ramenées à <PROJECT_REF>. Rien d'autre à masquer : aucun secret n'apparaît.
-- select cron.schedule('hg-birthdays-daily', '5 6,7 * * *', $$select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/hg-birthdays', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
-- select cron.schedule('hg-badges-hourly', '7 * * * *', $$select public.hg_award_badges(null) + public.hg_award_level_badges(null)$$);
-- select cron.schedule('hg-cron-5min', '*/5 * * * *', $$select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/hg-cron', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)$$);
-- select cron.schedule('hg-cards-hourly', '23 * * * *', $$select public.hg_cards_presence()$$);

