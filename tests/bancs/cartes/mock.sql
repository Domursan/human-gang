-- Environnement Supabase minimal pour le banc « économie des cartes » (hors production).
-- Ce qui n'existe pas en local : rôles anon/authenticated/service_role, schémas auth, storage, cron, vault, net,
-- realtime et extensions, avec les privilèges par défaut de Supabase (la RLS reste la seule barrière sur les lignes).
-- Les fonctions « amorces » ci-dessous sont remplacées par le schéma reconstitué, qui les redéfinit ensuite.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists realtime;
create schema if not exists extensions;
create schema if not exists public;
create extension if not exists pgcrypto schema extensions;

create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(),
  last_sign_in_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb->>'role', ''), 'anon') $$;

create table if not exists storage.buckets (id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;

create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
begin
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  return 1;
end $$;
create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$;

create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text,
  description text default '', created_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
  insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;

create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 2000) returns bigint language sql as $$ select 1::bigint $$;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;

-- Amorces des fonctions de rôle (le schéma reconstitué les remplace : create or replace).
create or replace function public.hg_is_admin() returns boolean language plpgsql stable as $$ begin return false; end $$;
create or replace function public.hg_is_member() returns boolean language plpgsql stable as $$ begin return false; end $$;
create or replace function public.hg_has_perm(text) returns boolean language plpgsql stable as $$ begin return false; end $$;

-- Privilèges par défaut de Supabase : les tables et fonctions sont accessibles aux rôles, la RLS filtre les lignes.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
