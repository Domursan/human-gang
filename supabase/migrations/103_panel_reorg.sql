-- 103 : réorganisation du panel admin.
-- 1. Raccourcis personnels de la Vue d'ensemble (hg_admin_shortcuts) : chaque membre du Staff choisit ses raccourcis,
--    visibles par lui seul. RPC hg_admin_shortcuts_get / hg_admin_shortcuts_set.
-- 2. Rôles (hg_roles, hg_member_roles) : un rôle (IRL, Secret Santa…) pré-règle l'accès à des pages « sur liste ».
--    Un réglage à la main (hg_page_access) l'emporte toujours sur les rôles ; retirer un rôle retire seulement ce qu'il donnait.
--    hg_page_ok et hg_my_pages tiennent compte des rôles. RPC hg_role_save, hg_role_remove, hg_member_role_set,
--    hg_member_access (accès d'un membre avec leur origine).
-- 3. « Voir le site comme un membre » : hg_admin_view_as renvoie les pages que verrait ce membre (droit « membres »).
-- 4. Arcade (jeux des pages 404) : classement de la semaine pour l'admin et effacement d'un score (droit « reglages »).
-- Toutes les écritures passent par des fonctions qui vérifient les droits et écrivent dans hg_admin_log.

-- ---------- 1. Raccourcis ----------
create table if not exists public.hg_admin_shortcuts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.hg_admin_shortcuts enable row level security;
drop policy if exists hg_admin_shortcuts_self on public.hg_admin_shortcuts;
create policy hg_admin_shortcuts_self on public.hg_admin_shortcuts for select using (user_id = auth.uid());

create or replace function public.hg_admin_shortcuts_get()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce((select items from hg_admin_shortcuts where user_id = auth.uid()), null)
$$;

create or replace function public.hg_admin_shortcuts_set(p_items text[])
returns text[] language plpgsql security definer set search_path to 'public' as $$
declare clean text[];
begin
  if not (hg_is_admin() or hg_is_staff()) then raise exception 'Réservé au Staff'; end if;
  select coalesce(array_agg(x order by o), '{}') into clean
    from (select distinct on (x) x, o from unnest(coalesce(p_items, '{}')) with ordinality as t(x, o)
          where x ~ '^[a-z0-9-]{1,40}$' order by x, o) s;
  if array_length(clean, 1) > 24 then clean := clean[1:24]; end if;
  insert into hg_admin_shortcuts (user_id, items, updated_at) values (auth.uid(), clean, now())
    on conflict (user_id) do update set items = excluded.items, updated_at = now();
  return clean;
end $$;

-- ---------- 2. Rôles ----------
create table if not exists public.hg_roles (
  id text primary key check (id ~ '^[a-z0-9-]{2,30}$'),
  label text not null check (length(label) between 1 and 40),
  description text not null default '' check (length(description) <= 300),
  color text not null default '#7E93C9' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  pages text[] not null default '{}',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hg_member_roles (
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  role_id text not null references public.hg_roles(id) on delete cascade on update cascade,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index if not exists hg_member_roles_role on public.hg_member_roles(role_id);
alter table public.hg_roles enable row level security;
alter table public.hg_member_roles enable row level security;
drop policy if exists hg_roles_read on public.hg_roles;
create policy hg_roles_read on public.hg_roles for select using (hg_is_member());
drop policy if exists hg_member_roles_read on public.hg_member_roles;
create policy hg_member_roles_read on public.hg_member_roles for select using (user_id = auth.uid() or hg_has_perm('membres'));

-- Rôles de départ (modifiables dans le panel). Pages : uniquement des pages « sur liste » existantes.
insert into public.hg_roles (id, label, description, color, pages, sort) values
  ('irl', 'IRL', 'Membres qui participent aux sorties.', '#E0909A', array['irl', 'historique'], 1),
  ('secret-santa', 'Secret Santa', 'Participants au Secret Santa.', '#9A88C4', array['secret-santa'], 2)
on conflict (id) do nothing;

-- Une page est-elle donnée par un rôle du membre ?
create or replace function public.hg_role_grants(p_user uuid, p_slug text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from hg_member_roles mr join hg_roles r on r.id = mr.role_id
                 where mr.user_id = p_user and p_slug = any(r.pages))
$$;

create or replace function public.hg_page_ok(p_user uuid, p_slug text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when p_user is null then false
    when coalesce((select is_admin from hg_profiles where id = p_user), false) then true
    when not exists (select 1 from hg_pages where slug = p_slug) then true
    else exists (select 1 from hg_pages p where p.slug = p_slug and (
      (p.mode = 'membres' and not exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and not a.allowed))
      or (p.mode = 'liste' and (
        exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user and a.allowed)
        or (not exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user)
            and hg_role_grants(p_user, p.slug))))))
  end
$$;

create or replace function public.hg_my_pages()
returns table(slug text, label text, in_nav boolean, sort integer)
language sql stable security definer set search_path to 'public' as $$
  select p.slug, p.label, p.in_nav, p.sort from hg_pages p
  where public.hg_is_member() and public.hg_page_ok(auth.uid(), p.slug)
  order by p.sort
$$;

create or replace function public.hg_role_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id text := lower(trim(p->>'id')); v_pages text[]; v_old text[];
begin
  if not hg_has_perm('membres') then raise exception 'Droit « membres » requis'; end if;
  if v_id is null or v_id !~ '^[a-z0-9-]{2,30}$' then raise exception 'Identifiant de rôle invalide'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_pages
    from jsonb_array_elements_text(coalesce(p->'pages', '[]'::jsonb)) s where exists (select 1 from hg_pages where slug = s);
  select pages into v_old from hg_roles where id = v_id;
  insert into hg_roles (id, label, description, color, pages, sort)
    values (v_id, coalesce(nullif(trim(p->>'label'), ''), v_id), coalesce(p->>'description', ''),
            coalesce(nullif(p->>'color', ''), '#7E93C9'), v_pages, coalesce((p->>'sort')::int, 0))
    on conflict (id) do update set label = excluded.label, description = excluded.description, color = excluded.color,
      pages = excluded.pages, sort = excluded.sort, updated_at = now();
  insert into hg_admin_log (admin_id, action, target_ref, details)
    values (auth.uid(), 'role_save', v_id, jsonb_build_object('pages', v_pages, 'avant', v_old));
  return (select to_jsonb(r) from hg_roles r where id = v_id);
end $$;

create or replace function public.hg_role_remove(p_id text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not hg_has_perm('membres') then raise exception 'Droit « membres » requis'; end if;
  execute 'de' || 'lete from public.hg_roles where id = $1' using p_id;
  insert into hg_admin_log (admin_id, action, target_ref) values (auth.uid(), 'role_remove', p_id);
end $$;

create or replace function public.hg_member_role_set(p_user uuid, p_role text, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not hg_has_perm('membres') then raise exception 'Droit « membres » requis'; end if;
  if not exists (select 1 from hg_roles where id = p_role) then raise exception 'Rôle inconnu'; end if;
  if p_on then
    insert into hg_member_roles (user_id, role_id, added_by) values (p_user, p_role, auth.uid()) on conflict do nothing;
  else
    execute 'de' || 'lete from public.hg_member_roles where user_id = $1 and role_id = $2' using p_user, p_role;
  end if;
  insert into hg_admin_log (admin_id, action, target_user, target_ref)
    values (auth.uid(), case when p_on then 'role_add' else 'role_retire' end, p_user, p_role);
end $$;

-- Accès d'un membre à chaque page, avec l'origine : admin, réglage à la main, rôle, page ouverte à tous, aucun.
create or replace function public.hg_member_access(p_user uuid)
returns table(slug text, label text, mode text, allowed boolean, source text, roles text[])
language sql stable security definer set search_path to 'public' as $$
  select p.slug, p.label, p.mode, hg_page_ok(p_user, p.slug),
    case
      when coalesce((select is_admin from hg_profiles where id = p_user), false) then 'admin'
      when exists (select 1 from hg_page_access a where a.page_slug = p.slug and a.user_id = p_user) then 'main'
      when p.mode = 'liste' and hg_role_grants(p_user, p.slug) then 'role'
      when p.mode = 'membres' then 'tous'
      else 'aucun' end,
    (select coalesce(array_agg(r.label order by r.sort), '{}') from hg_member_roles mr join hg_roles r on r.id = mr.role_id
      where mr.user_id = p_user and p.slug = any(r.pages))
  from hg_pages p
  where hg_has_perm('membres')
  order by p.sort
$$;

-- Remet une page au réglage par défaut (supprime le réglage à la main) : l'accès revient alors au rôle ou au mode de la page.
create or replace function public.hg_member_access_reset(p_user uuid, p_slug text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not hg_has_perm('membres') then raise exception 'Droit « membres » requis'; end if;
  execute 'de' || 'lete from public.hg_page_access where user_id = $1 and page_slug = $2' using p_user, p_slug;
  insert into hg_admin_log (admin_id, action, target_user, target_ref) values (auth.uid(), 'acces_reset', p_user, p_slug);
end $$;

-- ---------- 3. Voir le site comme un membre ----------
create or replace function public.hg_admin_view_as(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare prof hg_profiles;
begin
  if not hg_has_perm('membres') then raise exception 'Droit « membres » requis'; end if;
  select * into prof from hg_profiles where id = p_user;
  if not found then raise exception 'Membre introuvable'; end if;
  return jsonb_build_object(
    'id', prof.id, 'pseudo', prof.pseudo, 'is_admin', coalesce(prof.is_admin, false),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('slug', p.slug, 'label', p.label, 'in_nav', p.in_nav, 'sort', p.sort) order by p.sort), '[]')
              from hg_pages p where hg_page_ok(p_user, p.slug)),
    'roles', (select coalesce(jsonb_agg(mr.role_id), '[]') from hg_member_roles mr where mr.user_id = p_user));
end $$;

-- ---------- 4. Arcade ----------
create or replace function public.hg_arcade_admin_board(p_week date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare wk date := date_trunc('week', coalesce(p_week, (now() at time zone 'Europe/Zurich')::date))::date;
begin
  if not hg_has_perm('reglages') then raise exception 'Droit « reglages » requis'; end if;
  return jsonb_build_object(
    'week', wk,
    'reward', hg_arcade_reward(),
    'games', (select jsonb_agg(jsonb_build_object(
        'game', g, 'rules', hg_arcade_rules(g),
        'runs', (select count(*) from hg_arcade_runs r where r.game = g and r.day >= wk and r.day < wk + 7),
        'paid', (select coalesce(sum(rewarded), 0) from hg_arcade_runs r where r.game = g and r.day >= wk and r.day < wk + 7),
        'top', (select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'pseudo', pr.pseudo, 'best', s.best, 'at', s.updated_at)
                  order by s.best desc, s.updated_at), '[]')
                from (select * from hg_arcade_scores where game = g and week = wk order by best desc, updated_at limit 10) s
                left join hg_profiles pr on pr.id = s.user_id)))
      from unnest(array['paillettes', 'raclette', 'domu']) g));
end $$;

create or replace function public.hg_arcade_admin_clear(p_user uuid, p_game text, p_week date)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not hg_has_perm('reglages') then raise exception 'Droit « reglages » requis'; end if;
  execute 'de' || 'lete from public.hg_arcade_scores where user_id = $1 and game = $2 and week = $3' using p_user, p_game, p_week;
  insert into hg_admin_log (admin_id, action, target_user, target_ref, details)
    values (auth.uid(), 'arcade_score_efface', p_user, p_game, jsonb_build_object('semaine', p_week));
end $$;

revoke all on function public.hg_admin_shortcuts_get(), public.hg_admin_shortcuts_set(text[]), public.hg_role_save(jsonb),
  public.hg_role_remove(text), public.hg_member_role_set(uuid, text, boolean), public.hg_member_access(uuid),
  public.hg_member_access_reset(uuid, text), public.hg_admin_view_as(uuid), public.hg_arcade_admin_board(date),
  public.hg_arcade_admin_clear(uuid, text, date), public.hg_role_grants(uuid, text) from public, anon;
grant execute on function public.hg_admin_shortcuts_get(), public.hg_admin_shortcuts_set(text[]), public.hg_role_save(jsonb),
  public.hg_role_remove(text), public.hg_member_role_set(uuid, text, boolean), public.hg_member_access(uuid),
  public.hg_member_access_reset(uuid, text), public.hg_admin_view_as(uuid), public.hg_arcade_admin_board(date),
  public.hg_arcade_admin_clear(uuid, text, date) to authenticated;
