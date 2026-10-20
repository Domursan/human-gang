-- ===== Human Gang : schéma principal =====
create table public.hg_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudo text not null unique check (char_length(pseudo) between 2 and 32),
  avatar_url text,
  color text default '#9E3543',
  birthday date,
  share_birthday boolean not null default false,
  discord_id text,
  bot_optin boolean not null default true,
  is_admin boolean not null default false,
  intro_seen boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hg_invites (
  code text primary key,
  created_by uuid references auth.users(id) on delete set null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.hg_is_member() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.hg_profiles where id = auth.uid()) $$;

create or replace function public.hg_is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.hg_profiles where id = auth.uid()), false) $$;

-- Annuaire (entre membres) : uniquement les champs non sensibles
create or replace function public.hg_members()
returns table(id uuid, pseudo text, avatar_url text, color text, member_since timestamptz, birthday_dm text)
language sql stable security definer set search_path = public as
$$ select p.id, p.pseudo, p.avatar_url, p.color, p.created_at,
          case when p.share_birthday and p.birthday is not null then to_char(p.birthday,'DD.MM') end
   from public.hg_profiles p where public.hg_is_member() order by p.pseudo $$;

-- Rejoindre le gang avec un code d'invitation
create or replace function public.hg_join(p_code text, p_pseudo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inviter uuid;
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  if exists(select 1 from hg_profiles where id = v_uid) then return; end if;
  update hg_invites set used_by = v_uid, used_at = now()
   where upper(code) = upper(trim(p_code)) and used_by is null
   returning created_by into v_inviter;
  if not found then raise exception 'Code d''invitation invalide ou déjà utilisé'; end if;
  insert into hg_profiles(id, pseudo) values (v_uid, trim(p_pseudo));
  insert into hg_activity(user_id, kind, text) values (v_uid, 'join', trim(p_pseudo) || ' a rejoint le gang');
  if v_inviter is not null and exists(select 1 from hg_profiles where id = v_inviter) then
    insert into hg_user_badges(user_id, badge_code) values (v_inviter, 'cupidon') on conflict do nothing;
  end if;
end $$;

-- Empêcher un membre de s'auto-promouvoir admin
create or replace function public.hg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.hg_is_admin() then
    new.is_admin := old.is_admin;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hg_profiles_guard before update on public.hg_profiles
for each row execute function public.hg_profiles_guard();

-- ===== Paramètres (thème, bot) =====
create table public.hg_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.hg_settings(key, value) values
 ('theme', '{"mode":"auto","forced":null}'),
 ('bot', '{"announce_channel_id":null,"admin_discord_id":null,"notify":{"draw":true,"gift":true,"irl":true,"birthday":true,"support":true}}');

-- ===== Fil d'activité =====
create table public.hg_activity (
  id bigint generated always as identity primary key,
  user_id uuid references public.hg_profiles(id) on delete cascade,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- ===== Secret Santa =====
create table public.hg_ss_editions (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  status text not null default 'inscriptions' check (status in ('inscriptions','tirage','envoi','revelation','termine')),
  budget text,
  send_deadline date,
  exchange_date date,
  card_base_url text,
  drawn_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.hg_ss_participants (
  edition_id uuid not null references public.hg_ss_editions(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  sent_at timestamptz,
  received_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (edition_id, user_id)
);
create table public.hg_ss_wishes (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.hg_ss_editions(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 200),
  url text,
  created_at timestamptz not null default now()
);
create table public.hg_ss_exclusions (
  edition_id uuid not null references public.hg_ss_editions(id) on delete cascade,
  user_a uuid not null references public.hg_profiles(id) on delete cascade,
  user_b uuid not null references public.hg_profiles(id) on delete cascade,
  primary key (edition_id, user_a, user_b)
);
create table public.hg_ss_assignments (
  edition_id uuid not null references public.hg_ss_editions(id) on delete cascade,
  giver_id uuid not null references public.hg_profiles(id) on delete cascade,
  receiver_id uuid not null references public.hg_profiles(id) on delete cascade,
  primary key (edition_id, giver_id),
  unique (edition_id, receiver_id)
);

create or replace function public.hg_ss_is_santa_of(p_edition uuid, p_receiver uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from hg_ss_assignments a where a.edition_id = p_edition and a.giver_id = auth.uid() and a.receiver_id = p_receiver) $$;

-- Ma cible pour une édition
create or replace function public.hg_ss_my_target(p_edition uuid)
returns table(receiver_id uuid, pseudo text, avatar_url text)
language sql stable security definer set search_path = public as
$$ select a.receiver_id, p.pseudo, p.avatar_url from hg_ss_assignments a join hg_profiles p on p.id = a.receiver_id
   where a.edition_id = p_edition and a.giver_id = auth.uid() $$;

-- Avancement (compteurs uniquement)
create or replace function public.hg_ss_progress(p_edition uuid)
returns table(participants int, sent int, received int)
language sql stable security definer set search_path = public as
$$ select count(*)::int, count(sent_at)::int, count(received_at)::int from hg_ss_participants
   where edition_id = p_edition and public.hg_is_member() $$;

-- Révélation : visible par tous une fois l'édition révélée
create or replace function public.hg_ss_reveal(p_edition uuid)
returns table(giver text, receiver text)
language sql stable security definer set search_path = public as
$$ select g.pseudo, r.pseudo from hg_ss_assignments a
   join hg_ss_editions e on e.id = a.edition_id and e.status in ('revelation','termine')
   join hg_profiles g on g.id = a.giver_id join hg_profiles r on r.id = a.receiver_id
   where a.edition_id = p_edition and public.hg_is_member() order by g.pseudo $$;

-- Tirage (admin) : dérangement aléatoire avec exclusions + pas la même cible que l'an dernier.
-- L'admin ne reçoit que le nombre de participants, jamais les paires.
create or replace function public.hg_ss_draw(p_edition uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_perm uuid[]; v_n int; v_try int := 0; v_ok boolean; i int;
  v_year int; v_prev uuid;
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  if exists(select 1 from hg_ss_assignments where edition_id = p_edition) then raise exception 'Le tirage a déjà été fait pour cette édition'; end if;
  select year into v_year from hg_ss_editions where id = p_edition;
  select id into v_prev from hg_ss_editions where year = v_year - 1;
  select array_agg(user_id) into v_ids from hg_ss_participants where edition_id = p_edition;
  v_n := coalesce(array_length(v_ids,1),0);
  if v_n < 3 then raise exception 'Il faut au moins 3 participants'; end if;
  loop
    v_try := v_try + 1;
    if v_try > 2000 then raise exception 'Impossible de trouver un tirage avec ces exclusions'; end if;
    select array_agg(x order by random()) into v_perm from unnest(v_ids) x;
    v_ok := true;
    for i in 1..v_n loop
      if v_ids[i] = v_perm[i]
         or exists(select 1 from hg_ss_exclusions e where e.edition_id = p_edition
                   and ((e.user_a = v_ids[i] and e.user_b = v_perm[i]) or (e.user_b = v_ids[i] and e.user_a = v_perm[i])))
         or (v_prev is not null and exists(select 1 from hg_ss_assignments pa where pa.edition_id = v_prev
                   and pa.giver_id = v_ids[i] and pa.receiver_id = v_perm[i])) then
        v_ok := false; exit;
      end if;
    end loop;
    exit when v_ok;
  end loop;
  for i in 1..v_n loop
    insert into hg_ss_assignments(edition_id, giver_id, receiver_id) values (p_edition, v_ids[i], v_perm[i]);
  end loop;
  update hg_ss_editions set status = 'envoi', drawn_at = now() where id = p_edition;
  insert into hg_activity(user_id, kind, text) values (null, 'ss_draw', 'Le tirage du Secret Santa ' || v_year || ' est fait !');
  return v_n;
end $$;

-- ===== IRL =====
create table public.hg_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz,
  cover_path text,
  created_by uuid references public.hg_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.hg_event_rsvps (
  event_id uuid not null references public.hg_events(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  status text not null check (status in ('oui','peut-etre','non')),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table public.hg_event_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.hg_events(id) on delete cascade,
  proposed_at timestamptz not null
);
create table public.hg_event_date_votes (
  date_id uuid not null references public.hg_event_dates(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  primary key (date_id, user_id)
);
create table public.hg_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.hg_events(id) on delete cascade,
  user_id uuid references public.hg_profiles(id) on delete set null,
  path text not null,
  caption text,
  created_at timestamptz not null default now()
);

-- ===== Historique =====
create table public.hg_moments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  happened_on date not null default current_date,
  image_path text,
  created_by uuid references public.hg_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== Badges =====
create table public.hg_badges (
  code text primary key,
  name text not null,
  description text not null,
  image_url text,
  sort int not null default 0
);
create table public.hg_user_badges (
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  badge_code text not null references public.hg_badges(code) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);
insert into public.hg_badges(code, name, description, sort) values
 ('premier_noel','Premier Noël','Premier Secret Santa terminé',1),
 ('veteran','Vétéran','5 Secret Santa',2),
 ('lutin_express','Lutin express','Cadeau envoyé en premier',3),
 ('sur_le_fil','Sur le fil','Cadeau envoyé le dernier jour',4),
 ('liste_parfaite','Liste parfaite','Liste de souhaits remplie avant le tirage',5),
 ('toujours_la','Toujours là','Présent à 5 sorties IRL',6),
 ('organisateur','Organisateur','A créé une sortie',7),
 ('globe_trotter','Globe-trotter','Sorties dans 3 lieux différents',8),
 ('paparazzi','Paparazzi','50 photos ajoutées aux albums',9),
 ('boite_a_idees','Boîte à idées','Idée retenue par l''admin',10),
 ('fondateur','Membre fondateur','Inscrit la première année',11),
 ('fidele','Fidèle','Membre depuis 3 ans',12),
 ('chasseur_bugs','Chasseur de bugs','Bug signalé via l''assistance',13),
 ('saisonnier','Saisonnier','Connecté pendant les 7 thèmes',14),
 ('cupidon','Cupidon du gang','A recruté un membre avec son code d''invitation',15);

-- ===== Boîte à idées & assistance =====
create table public.hg_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.hg_profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'nouvelle' check (status in ('nouvelle','retenue','ecartee')),
  created_at timestamptz not null default now()
);
create table public.hg_support (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  pseudo text not null,
  subject text not null,
  message text not null check (char_length(message) between 1 and 4000),
  contact text,
  status text not null default 'ouverte' check (status in ('ouverte','traitee')),
  discord_sent boolean not null default false,
  created_at timestamptz not null default now()
);

-- ===== Export / suppression de ses données =====
create or replace function public.hg_export_my_data() returns jsonb
language sql stable security definer set search_path = public as $$
select jsonb_build_object(
  'profil', (select to_jsonb(p) from hg_profiles p where id = auth.uid()),
  'secret_santa_participations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_participants x where user_id = auth.uid()),
  'souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_wishes x where user_id = auth.uid()),
  'reponses_irl', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_rsvps x where user_id = auth.uid()),
  'photos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_photos x where user_id = auth.uid()),
  'idees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ideas x where user_id = auth.uid()),
  'assistance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_support x where user_id = auth.uid()),
  'badges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_user_badges x where user_id = auth.uid())
) $$;

create or replace function public.hg_delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from hg_profiles where id = auth.uid();
end $$;
