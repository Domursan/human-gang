-- 026 — Membres « Staff » et permissions par domaine du panel admin.
-- L'admin (hg_profiles.is_admin) garde tous les droits. Un membre Staff reçoit une liste de clés
-- de permission ; hg_has_perm(clé) remplace hg_is_admin() dans les règles des tables du domaine
-- (voir 027_staff_regles.sql). Les droits eux-mêmes (is_admin, Staff, mode dieu) restent réservés à l'admin.

create table if not exists public.hg_perm_catalog (
  key text primary key check (key ~ '^[a-z_]{2,32}$'),
  label text not null,
  description text not null default '',
  sort int not null default 0
);
alter table public.hg_perm_catalog enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_perm_catalog' and policyname='hg_perm_catalog_read') then
    create policy hg_perm_catalog_read on public.hg_perm_catalog for select to authenticated using (true);
  end if;
end $$;

insert into public.hg_perm_catalog(key, label, description, sort) values
  ('membres',      'Membres',            'Comptes, profils, fantômes, invitations, accès aux pages', 10),
  ('evenements',   'Sorties IRL',        'Sorties, dates, votes, inscriptions', 20),
  ('souvenirs',    'Souvenirs et photos','Historique, moments, photos, réactions', 30),
  ('secret_santa', 'Secret Santa',       'Éditions, participants, exclusions, tirages, vœux', 40),
  ('cartes',       'Jeu de cartes',      'Collections, cartes, paillettes, échanges, défis, quêtes', 50),
  ('badges',       'Badges',             'Badges et attribution', 60),
  ('themes',       'Thèmes et événements','Thèmes du site, événements dynamiques', 70),
  ('messages',     'Messagerie',         'Lecture des conversations (journalisée)', 80),
  ('support',      'Assistance et idées','Demandes d''assistance, boîte à idées', 90),
  ('bot',          'Bot Discord',        'Modèles, journal du bot, anniversaires', 100),
  ('reglages',     'Réglages du site',   'Réglages généraux, pages', 110),
  ('journal',      'Journal admin',      'Consultation du journal des actions et des accès', 120)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort = excluded.sort;

create table if not exists public.hg_staff (
  user_id uuid primary key references public.hg_profiles(id) on delete cascade,
  perms text[] not null default '{}',
  active boolean not null default true,
  note text not null default '',
  added_by uuid references public.hg_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hg_staff enable row level security;
revoke all on public.hg_staff from anon;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_staff' and policyname='hg_staff_read') then
    create policy hg_staff_read on public.hg_staff for select to authenticated
      using (user_id = (select auth.uid()) or public.hg_is_admin());
  end if;
end $$;

-- Vrai si l'utilisateur courant est admin, ou Staff actif avec cette permission.
create or replace function public.hg_has_perm(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hg_is_admin() or exists (
    select 1 from public.hg_staff s
    where s.user_id = auth.uid() and s.active and p_perm = any(s.perms)
  )
$$;

-- Vrai si l'utilisateur courant peut ouvrir le panel (admin, ou Staff actif avec au moins une permission).
create or replace function public.hg_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.hg_is_admin() or exists (
    select 1 from public.hg_staff s
    where s.user_id = auth.uid() and s.active and cardinality(s.perms) > 0
  )
$$;

-- Mes droits : { is_admin, perms[] } (admin = toutes les clés du catalogue).
create or replace function public.hg_my_perms()
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then jsonb_build_object('is_admin', false, 'perms', '[]'::jsonb)
    when public.hg_is_admin() then jsonb_build_object('is_admin', true,
      'perms', coalesce((select jsonb_agg(key order by sort) from public.hg_perm_catalog), '[]'::jsonb))
    else jsonb_build_object('is_admin', false, 'perms', coalesce((
      select to_jsonb(s.perms) from public.hg_staff s where s.user_id = auth.uid() and s.active), '[]'::jsonb))
  end
$$;

-- Liste du Staff (admin seulement).
create or replace function public.hg_staff_list()
returns table(user_id uuid, pseudo text, avatar_url text, color text, perms text[], active boolean, note text,
              added_by_pseudo text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin' using errcode = '42501'; end if;
  return query
    select s.user_id, p.pseudo, p.avatar_url, p.color, s.perms, s.active, s.note,
           a.pseudo, s.created_at, s.updated_at
    from public.hg_staff s
    join public.hg_profiles p on p.id = s.user_id
    left join public.hg_profiles a on a.id = s.added_by
    order by s.active desc, p.pseudo;
end $$;

-- Ajoute ou met à jour un membre Staff (admin seulement). Journalisé dans hg_admin_log.
create or replace function public.hg_staff_set(p_user uuid, p_perms text[], p_active boolean default true, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
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
end $$;

revoke all on function public.hg_staff_list() from public, anon;
revoke all on function public.hg_staff_set(uuid, text[], boolean, text) from public, anon;
revoke all on function public.hg_my_perms() from public, anon;
grant execute on function public.hg_has_perm(text) to authenticated;
grant execute on function public.hg_is_staff() to authenticated;
grant execute on function public.hg_my_perms() to authenticated;
grant execute on function public.hg_staff_list() to authenticated;
grant execute on function public.hg_staff_set(uuid, text[], boolean, text) to authenticated;
