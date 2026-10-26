-- ===== Humane Gang — migration 153 : statut « en ligne / hors ligne » et notifications sur le site =====
-- Présence : chaque page ouverte et visible d'un membre appelle hg_presence_ping() toutes les 50 s (core/presence.js).
--   En ligne = dernier signal il y a moins de 2 minutes. Un membre peut masquer son statut (hg_presence_masquer) :
--   les autres le voient alors toujours « hors ligne » (le bot, lui, sait qu'il est là).
-- Notifications du site (hg_site_notifs) : écrites par les fonctions edge (clé service) à chaque MP du bot ; si le
--   membre est en ligne, le MP Discord n'est PAS envoyé (la notification du site suffit). Le membre les lit dans la
--   cloche de l'en-tête (core/notifs.js) ; chaque nouvelle notification est poussée en direct sur le canal privé
--   « notif:<user_id> » (Realtime Broadcast, même principe que la messagerie, migration 025).
-- Idempotente. Aucun « drop policy » ni effacement de lignes.

create table if not exists public.hg_presence (
  user_id uuid primary key references public.hg_profiles(id) on update cascade,
  seen_at timestamptz not null default now(),
  masque boolean not null default false
);
alter table public.hg_presence enable row level security;
comment on table public.hg_presence is 'Dernier signal de vie de chaque membre (page ouverte et visible). En ligne = moins de 2 minutes (migration 153).';

create table if not exists public.hg_site_notifs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.hg_profiles(id) on update cascade,
  cat text not null default 'info',
  titre text not null,
  texte text,
  lien text,
  par_discord boolean not null default false,
  created_at timestamptz not null default now(),
  lu_at timestamptz
);
create index if not exists hg_site_notifs_user_idx on public.hg_site_notifs (user_id, created_at desc);
alter table public.hg_site_notifs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_site_notifs' and policyname = 'hg_site_notifs_own_read') then
    create policy hg_site_notifs_own_read on public.hg_site_notifs for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
comment on column public.hg_site_notifs.par_discord is 'Vrai si le MP Discord a aussi été envoyé (membre hors ligne).';

-- Signal de vie : le membre connecté est là (page visible). Renvoie le nombre de notifications non lues.
create or replace function public.hg_presence_ping()
returns int language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from hg_profiles where id = me) then return 0; end if;
  insert into hg_presence (user_id, seen_at) values (me, now())
    on conflict (user_id) do update set seen_at = now();
  return (select count(*) from hg_site_notifs where user_id = me and lu_at is null)::int;
end $$;

-- Vrai si le membre est en ligne (signal de moins de 2 minutes). Usage interne et fonctions edge.
create or replace function public.hg_en_ligne_interne(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_presence where user_id = p_user and seen_at > now() - interval '2 minutes') $$;

-- Statuts visibles par un membre : en ligne seulement si le membre ne masque pas son statut (soi-même : toujours vrai).
create or replace function public.hg_en_ligne(p_ids uuid[])
returns table (user_id uuid, en_ligne boolean, vu_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.id,
    coalesce(p.seen_at > now() - interval '2 minutes' and (not p.masque or x.id = auth.uid()), false),
    case when p.masque and x.id <> auth.uid() then null else p.seen_at end
  from unnest(coalesce(p_ids, '{}')) x(id)
  left join hg_presence p on p.user_id = x.id
  where public.hg_is_member() and cardinality(p_ids) <= 500 $$;

-- Masquer (ou montrer) son statut en ligne aux autres membres.
create or replace function public.hg_presence_masquer(p_masque boolean)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from hg_profiles where id = me) then raise exception 'Connexion requise'; end if;
  insert into hg_presence (user_id, seen_at, masque) values (me, now(), coalesce(p_masque, false))
    on conflict (user_id) do update set masque = coalesce(p_masque, false);
  return coalesce(p_masque, false);
end $$;

-- Mes notifications (les plus récentes d'abord) et le nombre de non lues.
create or replace function public.hg_mes_notifs(p_limite int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'non_lues', (select count(*) from hg_site_notifs where user_id = auth.uid() and lu_at is null),
    'masque', coalesce((select masque from hg_presence where user_id = auth.uid()), false),
    'liste', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'cat', n.cat, 'titre', n.titre, 'texte', n.texte,
        'lien', n.lien, 'created_at', n.created_at, 'lu', n.lu_at is not null) order by n.created_at desc)
      from (select * from hg_site_notifs where user_id = auth.uid() order by created_at desc limit least(greatest(coalesce(p_limite, 30), 1), 100)) n), '[]'::jsonb)) $$;

-- Marque mes notifications comme lues (toutes si p_ids est null).
create or replace function public.hg_notifs_lues(p_ids bigint[] default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update hg_site_notifs set lu_at = now()
    where user_id = auth.uid() and lu_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Écrit une notification du site (fonctions edge, clé service ; ou fonctions SQL internes).
create or replace function public.hg_site_notif(p_user uuid, p_cat text, p_titre text, p_texte text default null,
  p_lien text default null, p_par_discord boolean default false)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_user is null or nullif(btrim(coalesce(p_titre, '')), '') is null then return null; end if;
  insert into hg_site_notifs (user_id, cat, titre, texte, lien, par_discord)
    values (p_user, left(coalesce(nullif(p_cat, ''), 'info'), 30), left(btrim(p_titre), 200), left(p_texte, 1000),
      case when p_lien ~ '^https?://' or p_lien ~ '^[a-z0-9-]+\.html' then left(p_lien, 500) end, coalesce(p_par_discord, false))
    returning id into v_id;
  return v_id;
end $$;

-- Temps réel : chaque nouvelle notification est annoncée sur « notif:<user_id> » (contenu minimal, relu par la RPC).
create or replace function public.hg_site_notif_rt_trg()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id), 'notif', 'notif:' || new.user_id::text, true);
  return null;
exception when others then
  raise warning 'hg_site_notif_rt_trg : %', sqlerrm;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_site_notif_rt' and tgrelid = 'public.hg_site_notifs'::regclass) then
    create trigger hg_site_notif_rt after insert on public.hg_site_notifs for each row execute function public.hg_site_notif_rt_trg();
  end if;
end $$;

-- Lecture du canal « notif:<uuid> » : seulement le membre concerné.
create or replace function public.hg_notif_topic_ok(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic !~ '^notif:[0-9a-fA-F-]{36}$' then return false; end if;
  return substr(p_topic, 7)::uuid = auth.uid();
exception when others then return false;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hg_notif_broadcast_read') then
    create policy hg_notif_broadcast_read on realtime.messages for select to authenticated
      using (extension = 'broadcast' and public.hg_notif_topic_ok(realtime.topic()));
  end if;
end $$;

revoke all on function public.hg_presence_ping(), public.hg_en_ligne(uuid[]), public.hg_presence_masquer(boolean),
  public.hg_mes_notifs(int), public.hg_notifs_lues(bigint[]), public.hg_notif_topic_ok(text) from public, anon;
grant execute on function public.hg_presence_ping(), public.hg_en_ligne(uuid[]), public.hg_presence_masquer(boolean),
  public.hg_mes_notifs(int), public.hg_notifs_lues(bigint[]), public.hg_notif_topic_ok(text) to authenticated;
revoke all on function public.hg_en_ligne_interne(uuid), public.hg_site_notif(uuid, text, text, text, text, boolean),
  public.hg_site_notif_rt_trg() from public, anon, authenticated;
