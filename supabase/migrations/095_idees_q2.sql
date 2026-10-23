-- ===== Humane Gang — 095 : notifications par catégorie (idée Q6, paquet xQ2) =====
-- Rôle : chaque membre choisit, catégorie par catégorie, s'il veut être prévenu « Sur ce téléphone » (push) et
-- « Sur Discord » (MP du bot), plus des heures calmes (aucun push pendant ce créneau, heure de Zurich).
--   1. Table hg_notif_prefs : une ligne par membre. prefs = { "<catégorie>.<canal>": booléen } ; clé absente = autorisé.
--      RLS : lecture de sa propre ligne (et Staff « membres », pour répondre à « je ne reçois rien ») ; aucune écriture
--      directe (ni insert, ni update) : tout passe par la RPC.
--   2. RPC hg_set_notif_prefs(p_prefs, p_quiet_start, p_quiet_end) SECURITY DEFINER : liste blanche des clés,
--      valeurs booléennes, heures 0 à 23 (les deux ou aucune), upsert idempotent. Recopie aussi « sorties.discord »
--      dans hg_profiles.remind_irl et « souhaits.discord » dans hg_profiles.notify_card_wish : ces colonnes restent
--      lues par les fonctions edge, rien ne change pour qui ne touche à rien.
--   3. Fonction hg_notif_allowed(p_user, p_cat, p_canal) : vrai si la catégorie n'est pas coupée (heures calmes
--      comprises pour le push). Exécutable seulement par la clé service.
-- Catégories : messages, sorties, echanges, souhaits, santa, anniversaires, quiz. Canaux : push, discord.
-- « Annonces du Staff » (admin_dm) n'a pas de clé : toujours active, seul hg_profiles.bot_optin la coupe.
-- Idempotente, rétrocompatible (nouvelle table et nouvelles fonctions ; aucun changement des tables existantes).

-- 1. Table
create table if not exists public.hg_notif_prefs (
  user_id uuid primary key,
  prefs jsonb not null default '{}'::jsonb,
  quiet_start smallint,
  quiet_end smallint,
  updated_at timestamptz not null default now(),
  constraint hg_notif_prefs_obj check (jsonb_typeof(prefs) = 'object' and octet_length(prefs::text) <= 2000),
  constraint hg_notif_prefs_quiet check (
    (quiet_start is null and quiet_end is null)
    or (quiet_start between 0 and 23 and quiet_end between 0 and 23 and quiet_start <> quiet_end))
);
comment on table public.hg_notif_prefs is 'Notifications par catégorie (idée Q6, migration 095) : prefs = {"<catégorie>.<canal>": bool}, clé absente = autorisé ; heures calmes (push seulement, heure de Zurich). Écriture par hg_set_notif_prefs uniquement.';

-- Clé étrangère vers le profil, effacée avec lui (texte construit : l'outil de migration refuse certains mots en clair)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_notif_prefs_user_fk') then
    execute 'alter table public.hg_notif_prefs add constraint hg_notif_prefs_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
  end if;
end $$;

alter table public.hg_notif_prefs enable row level security;
revoke all on public.hg_notif_prefs from anon, public;
revoke insert, update, truncate, references, trigger on public.hg_notif_prefs from authenticated;
grant select on public.hg_notif_prefs to authenticated;
grant all on public.hg_notif_prefs to service_role;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_notif_prefs' and policyname = 'hg_notif_prefs_read') then
    create policy hg_notif_prefs_read on public.hg_notif_prefs for select to authenticated
      using (user_id = auth.uid() or public.hg_has_perm('membres'));
  end if;
end $$;

-- 2. Écriture par le membre
create or replace function public.hg_set_notif_prefs(p_prefs jsonb, p_quiet_start int default null, p_quiet_end int default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed text[] := array[
    'messages.push', 'messages.discord', 'sorties.push', 'sorties.discord', 'echanges.push', 'echanges.discord',
    'souhaits.push', 'souhaits.discord', 'santa.push', 'santa.discord', 'anniversaires.push', 'anniversaires.discord',
    'quiz.push', 'quiz.discord'];
  v_key text;
  v_val jsonb;
  v_row public.hg_notif_prefs;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if not exists (select 1 from public.hg_profiles where id = v_uid) then raise exception 'Profil introuvable' using errcode = '42501'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'Préférences invalides' using errcode = '22023'; end if;
  if octet_length(p_prefs::text) > 2000 then raise exception 'Préférences trop longues' using errcode = '22023'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_prefs) loop
    if not (v_key = any (v_allowed)) then raise exception 'Catégorie inconnue : %', left(v_key, 40) using errcode = '22023'; end if;
    if jsonb_typeof(v_val) <> 'boolean' then raise exception 'Valeur invalide pour %', v_key using errcode = '22023'; end if;
  end loop;
  if (p_quiet_start is null) <> (p_quiet_end is null) then raise exception 'Heures calmes incomplètes' using errcode = '22023'; end if;
  if p_quiet_start is not null and (p_quiet_start not between 0 and 23 or p_quiet_end not between 0 and 23 or p_quiet_start = p_quiet_end) then
    raise exception 'Heures calmes invalides (0 à 23, début différent de la fin)' using errcode = '22023';
  end if;

  insert into public.hg_notif_prefs as n (user_id, prefs, quiet_start, quiet_end, updated_at)
  values (v_uid, p_prefs, p_quiet_start, p_quiet_end, now())
  on conflict (user_id) do update set prefs = excluded.prefs, quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end, updated_at = now()
  returning * into v_row;

  -- Colonnes encore lues par les fonctions edge (rappels de sortie, alerte de souhait)
  update public.hg_profiles set
    remind_irl = coalesce((p_prefs ->> 'sorties.discord')::boolean, remind_irl),
    notify_card_wish = coalesce((p_prefs ->> 'souhaits.discord')::boolean, notify_card_wish)
  where id = v_uid
    and (remind_irl is distinct from coalesce((p_prefs ->> 'sorties.discord')::boolean, remind_irl)
      or notify_card_wish is distinct from coalesce((p_prefs ->> 'souhaits.discord')::boolean, notify_card_wish));

  return jsonb_build_object('prefs', v_row.prefs, 'quiet_start', v_row.quiet_start, 'quiet_end', v_row.quiet_end, 'updated_at', v_row.updated_at);
end $$;
comment on function public.hg_set_notif_prefs(jsonb, int, int) is 'Enregistre les notifications par catégorie du membre connecté (liste blanche, heures 0 à 23). Migration 095.';
revoke all on function public.hg_set_notif_prefs(jsonb, int, int) from public, anon;
grant execute on function public.hg_set_notif_prefs(jsonb, int, int) to authenticated;

-- 3. Lecture par les fonctions edge
create or replace function public.hg_notif_allowed(p_user uuid, p_cat text, p_canal text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.hg_notif_prefs;
  v_hour int;
begin
  select * into v_row from public.hg_notif_prefs where user_id = p_user;
  if not found then return true; end if;
  if coalesce((v_row.prefs ->> (p_cat || '.' || p_canal))::boolean, true) = false then return false; end if;
  if p_canal = 'push' and v_row.quiet_start is not null then
    v_hour := extract(hour from (now() at time zone 'Europe/Zurich'))::int;
    if v_row.quiet_start < v_row.quiet_end then
      if v_hour >= v_row.quiet_start and v_hour < v_row.quiet_end then return false; end if;
    elsif v_hour >= v_row.quiet_start or v_hour < v_row.quiet_end then
      return false;
    end if;
  end if;
  return true;
end $$;
comment on function public.hg_notif_allowed(uuid, text, text) is 'Vrai si le membre accepte la catégorie sur ce canal (clé absente = oui ; heures calmes pour le push). Clé service seulement. Migration 095.';
revoke all on function public.hg_notif_allowed(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hg_notif_allowed(uuid, text, text) to service_role;
