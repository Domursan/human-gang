-- Environnement Supabase minimal pour tester le moteur Loup-Garou hors production.
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth; create schema cron;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;

create table public.hg_profiles (id uuid primary key, pseudo text, avatar_url text, color text, birthday date, share_birthday boolean default false,
  discord_id text, bot_optin boolean default false, is_admin boolean default false, intro_seen boolean default true, created_at timestamptz default now(),
  updated_at timestamptz default now(), member_number integer, joined_on date, account_created_at timestamptz default now(), is_ghost boolean default false,
  ghost_note text, remind_irl boolean default false, notify_card_wish boolean default false, tour_done_at timestamptz default now(), eco_public boolean default false,
  show_generation boolean default false, trade_board boolean default false, trade_board_note text, hide_friendship boolean default false, mentor_volunteer boolean default false);
create table public.hg_pages (slug text primary key, label text not null, mode text default 'membres', in_nav boolean default true, sort integer default 0, updated_at timestamptz default now());
create table public.hg_page_access (page_slug text not null, user_id uuid not null, allowed boolean not null, primary key (page_slug, user_id));
create table public.hg_settings (key text primary key, value jsonb not null, updated_at timestamptz default now());
create table public.hg_wallets (user_id uuid primary key, paillettes integer default 0, updated_at timestamptz default now());
create table public.hg_wallet_log (id bigint generated always as identity primary key, user_id uuid not null, delta integer not null, reason text not null, ref text, created_at timestamptz default now());
create unique index hg_wallet_log_once on public.hg_wallet_log (user_id, reason, ref) where ref is not null;
create table public.hg_badges (code text primary key, name text not null, description text not null, image_url text, sort integer default 0, levels_enabled boolean default false, levels jsonb);
create table public.hg_user_badges (user_id uuid not null, badge_code text not null, awarded_at timestamptz default now(), level integer default 1, primary key (user_id, badge_code));
create table public.hg_admin_log (id bigint generated always as identity primary key, admin_id uuid, action text not null, target_user uuid, target_ref text, details jsonb default '{}', created_at timestamptz default now());

create function public.hg_is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.hg_profiles where id = auth.uid()), false) $$;
create function public.hg_page_ok(p_user uuid, p_slug text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then false
    when coalesce((select is_admin from hg_profiles where id = p_user), false) then true
    when not exists (select 1 from hg_pages where slug = p_slug) then true
    else exists (select 1 from hg_pages p where p.slug = p_slug and (
      (p.mode = 'membres' and not exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and not a.allowed))
      or (p.mode = 'liste' and exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and a.allowed))))
  end $$;
create function public.hg_wallet_add(p_user uuid, p_delta integer, p_reason text, p_ref text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_user is null or coalesce(p_delta, 0) = 0 then return false; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  insert into hg_wallet_log(user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update hg_wallets set paillettes = paillettes + p_delta, updated_at = now() where user_id = p_user;
  return true;
end $$;
grant all on all tables in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Pages accessibles (simulation de hg_my_pages pour les tests d'interface)
create or replace function public.hg_my_pages() returns table (slug text, label text, in_nav boolean, sort integer)
language sql stable security definer set search_path = public as $$
  select p.slug, p.label, p.in_nav, p.sort from hg_pages p where hg_page_ok(auth.uid(), p.slug) $$;
grant execute on function public.hg_my_pages() to authenticated;
