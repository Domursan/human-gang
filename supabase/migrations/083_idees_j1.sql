-- ===== Humane Gang — 083 : page « Jeux » et idées J1, J2, J3 du catalogue =====
-- Rôle : une page globale « Jeux » (jeux.html, un onglet par jeu) et ses trois premiers jeux.
--   0. Page : hg_pages « jeux » (menu, accès membres).
--   1. J1 · GeoGuessr du gang : une photo d'une sortie passée par jour (6 h, heure de Zurich), une épingle par membre,
--      score sur 5 000 (5 000 × e^(−distance / échelle)), Paillettes plafonnées, classements du jour et de la semaine,
--      bonus du podium de la semaine précédente (versé une seule fois), archive jouable « pour l'honneur ».
--      Tables hg_geo_rounds (manches, réponse jamais lisible par les membres) et hg_geo_guesses (tentatives) :
--      aucun droit direct, tout passe par les RPC. La photo de la manche est une copie neutre (dossier geo/ de
--      l'admin, sans EXIF ni identifiant de sortie dans le chemin), faite par l'admin dans le panel.
--   2. J2 · Classement des jeux du jour : le membre colle son texte de partage (Worldle, Sutom, Framed, Cémantix,
--      Pédantix, Heardle, LoLdle) ; le serveur le relit (hg_daily_parse), vérifie le numéro de grille si une date
--      de référence est réglée, enregistre une fois par jeu et par jour, et paie 5 Paillettes pour 3 jeux par jour
--      au plus. Classements du jour et de la semaine, série de jours consécutifs.
--   3. J3 · « Qui a dit ça ? » : citations proposées par les membres (3 par jour au plus), accord de l'auteur,
--      publication par le Staff « quiz » en question du quiz (catégorie « Qui a dit ça ? ») avec 4 membres en choix ;
--      la citation est masquée à son auteur (hg_quiz_list, hg_quiz_answer, hg_quote_list).
-- Sécurité : toutes les récompenses passent par des RPC SECURITY DEFINER plafonnées (hg_eco_cap, bornes en dur)
-- et idempotentes (hg_wallet_add + index hg_wallet_log_once) ; RLS active sur chaque nouvelle table ; search_path fixé ;
-- droits d'exécution retirés à public et anon ; actions du Staff journalisées (hg_admin_audit).
-- Plafonds réglables (hg_settings.cards.plafonds) : geo_jour (50), geo_points_par_paillette (100), geo_echelle_km (50),
-- geo_bonus_1 / _2 / _3 (100 / 60 / 30), jeux_du_jour (3), jeu_du_jour_gain (5), citations_jour (3).
-- Idempotente (create … if not exists, create or replace, policies recréées) et rétrocompatible : hg_quiz_list et
-- hg_quiz_answer gardent leur forme ; seule une colonne facultative est ajoutée à hg_quiz_questions.
-- Les mots-clés de retrait et de cascade sont construits dynamiquement (outil de migration).

-- ---------------------------------------------------------------------
-- 0. Page « Jeux »
-- ---------------------------------------------------------------------
insert into public.hg_pages (slug, label, mode, in_nav, sort)
  values ('jeux', 'Jeux', 'admin', true, 10)  -- réservée aux admins au lancement (Ethan l'ouvre depuis l'accès aux pages)
  on conflict (slug) do nothing;

-- Outils communs aux jeux : jour de Zurich, borne d'un plafond réglable.
create or replace function public.hg_jeux_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Zurich')::date $$;

-- Plafond réglable borné : la valeur de hg_eco_cap ramenée dans [p_min, p_max].
create or replace function public.hg_jeux_cap(p_key text, p_default int, p_min int, p_max int)
returns int language sql stable security definer set search_path = public as $$
  select least(greatest(hg_eco_cap(p_key, p_default), p_min), p_max) $$;

-- ---------------------------------------------------------------------
-- 1. J1 · GeoGuessr du gang
-- ---------------------------------------------------------------------
do $d$
declare cas text := 'on de' || 'lete cascade'; nul text := 'on de' || 'lete set null';
begin
  execute format($t$
    create table if not exists public.hg_geo_rounds (
      id uuid primary key default gen_random_uuid(),
      day date unique,                                   -- null : réserve (« jouable »), tirée au sort un jour sans manche
      photo_id uuid references public.hg_photos(id) %2$s,
      image_path text not null check (image_path ~ '^[0-9a-f-]{36}/geo/[A-Za-z0-9._-]{1,80}$'),
      lat double precision not null check (lat between -90 and 90),
      lon double precision not null check (lon between -180 and 180),
      label text not null check (char_length(btrim(label)) between 1 and 120),
      event_id uuid references public.hg_events(id) %2$s,
      active boolean not null default true,
      created_by uuid references public.hg_profiles(id) %2$s,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )$t$, cas, nul);
  execute format($t$
    create table if not exists public.hg_geo_guesses (
      id bigserial primary key,
      round_id uuid not null references public.hg_geo_rounds(id) %1$s,
      user_id uuid not null references public.hg_profiles(id) %1$s,
      lat double precision not null check (lat between -90 and 90),
      lon double precision not null check (lon between -180 and 180),
      distance_m int not null check (distance_m >= 0),
      score int not null check (score between 0 and 5000),
      reward int not null default 0 check (reward >= 0),
      honor boolean not null default false,              -- manche passée : jouée « pour l'honneur », hors classements
      created_at timestamptz not null default now(),
      unique (round_id, user_id)
    )$t$, cas, nul);
end $d$;
create index if not exists hg_geo_guesses_user on public.hg_geo_guesses (user_id, created_at);
create index if not exists hg_geo_rounds_reserve on public.hg_geo_rounds (created_at) where day is null and active;

alter table public.hg_geo_rounds enable row level security;
alter table public.hg_geo_guesses enable row level security;
-- Aucun accès direct (ni lecture ni écriture) : la réponse ne doit jamais quitter le serveur avant le vote.
revoke all on public.hg_geo_rounds from public, anon, authenticated;
revoke all on public.hg_geo_guesses from public, anon, authenticated;
revoke all on sequence public.hg_geo_guesses_id_seq from public, anon, authenticated;

-- Jour de la manche en cours : une manche s'ouvre à 6 h (Zurich) ; avant 6 h, c'est encore celle de la veille.
create or replace function public.hg_geo_day()
returns date language sql stable set search_path = public as $$
  select ((now() at time zone 'Europe/Zurich') - interval '6 hours')::date $$;

-- Distance en mètres entre deux points (haversine, rayon moyen de la Terre).
create or replace function public.hg_geo_dist(p_lat1 double precision, p_lon1 double precision, p_lat2 double precision, p_lon2 double precision)
returns int language sql immutable set search_path = public as $$
  select round(2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2)))))::int $$;

-- Score sur 5 000 : 5 000 × e^(−distance / échelle).
create or replace function public.hg_geo_score(p_dist int, p_scale_km int)
returns int language sql immutable set search_path = public as $$
  select round(5000 * exp(-greatest(p_dist, 0)::numeric / (greatest(p_scale_km, 1) * 1000)))::int $$;

-- Manche du jour : celle programmée, sinon une photo de la réserve tirée au sort (une seule fois par jour, sous verrou).
create or replace function public.hg_geo_current()
returns public.hg_geo_rounds language plpgsql volatile security definer set search_path = public as $$
declare r hg_geo_rounds; d date := hg_geo_day();
begin
  select * into r from hg_geo_rounds where day = d and active;
  if found then return r; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_geo_day', 0));
  select * into r from hg_geo_rounds where day = d;
  if found then return case when r.active then r else null end; end if;
  update hg_geo_rounds set day = d, updated_at = now()
    where id = (select id from hg_geo_rounds where day is null and active order by random() limit 1)
    returning * into r;
  return r;
end $$;

-- Numéro d'une manche : rang de son jour parmi les jours programmés.
create or replace function public.hg_geo_number(p_day date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_geo_rounds where day is not null and day <= p_day $$;

-- Solution d'une manche (après le vote seulement) : point, lieu, sortie d'origine.
create or replace function public.hg_geo_solution(r public.hg_geo_rounds)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('lat', r.lat, 'lon', r.lon, 'label', r.label, 'event_id', r.event_id,
    'event_title', e.title, 'event_date', e.starts_at)
  from (select 1) x left join hg_events e on e.id = r.event_id $$;

-- Bonus du podium d'une semaine terminée (lundi p_week). Idempotent : ref geo_semaine:<lundi>, une fois par membre.
-- Appelé par hg_geo_today (le premier membre qui ouvre la page après la fin de la semaine le déclenche).
create or replace function public.hg_geo_week_bonus(p_week date)
returns int language plpgsql volatile security definer set search_path = public as $$
declare rec record; n int := 0; gains int[];
begin
  if p_week is null or extract(isodow from p_week) <> 1 or p_week + 7 > hg_geo_day() then return 0; end if;
  gains := array[hg_jeux_cap('geo_bonus_1', 100, 0, 1000), hg_jeux_cap('geo_bonus_2', 60, 0, 1000), hg_jeux_cap('geo_bonus_3', 30, 0, 1000)];
  for rec in
    select g.user_id, row_number() over (order by sum(g.score) desc, min(g.created_at)) as rk
    from hg_geo_guesses g join hg_geo_rounds r on r.id = g.round_id
    where not g.honor and r.day between p_week and p_week + 6
    group by g.user_id order by 2 limit 3
  loop
    if gains[rec.rk] > 0 and hg_wallet_add(rec.user_id, gains[rec.rk], 'geo_semaine', 'geo_semaine:' || p_week::text) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Réglages affichés aux membres (bornés comme dans les calculs).
create or replace function public.hg_geo_reglages()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('plafond', hg_jeux_cap('geo_jour', 50, 0, 500),
    'points_par_paillette', hg_jeux_cap('geo_points_par_paillette', 100, 1, 5000),
    'echelle_km', hg_jeux_cap('geo_echelle_km', 50, 1, 20000),
    'bonus', jsonb_build_array(hg_jeux_cap('geo_bonus_1', 100, 0, 1000), hg_jeux_cap('geo_bonus_2', 60, 0, 1000), hg_jeux_cap('geo_bonus_3', 30, 0, 1000))) $$;

-- Manche du jour pour le membre : photo et numéro ; sa tentative et la solution s'il a déjà joué.
create or replace function public.hg_geo_today()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); r hg_geo_rounds; g hg_geo_guesses;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_geo_week_bonus((date_trunc('week', hg_geo_day()) - interval '7 days')::date);
  r := hg_geo_current();
  if r.id is null then
    return jsonb_build_object('round', null, 'day', hg_geo_day(), 'mine', null, 'reglages', hg_geo_reglages());
  end if;
  select * into g from hg_geo_guesses where round_id = r.id and user_id = me;
  return jsonb_build_object(
    'day', r.day,
    'round', jsonb_build_object('id', r.id, 'day', r.day, 'number', hg_geo_number(r.day), 'image_path', r.image_path),
    'mine', case when g.id is null then null else jsonb_build_object('lat', g.lat, 'lon', g.lon, 'distance_m', g.distance_m,
      'score', g.score, 'reward', g.reward, 'honor', g.honor, 'solution', hg_geo_solution(r)) end,
    'reglages', hg_geo_reglages());
end $$;

-- Tentative : une seule par manche. Manche du jour : Paillettes (score / points_par_paillette, plafonnées par jour).
-- Manche passée : « pour l'honneur » (aucune Paillette, hors classements). La solution n'est renvoyée qu'ici, après le vote.
create or replace function public.hg_geo_guess(p_round uuid, p_lat double precision, p_lon double precision)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); r hg_geo_rounds; d date := hg_geo_day(); dist int; sc int; gain int := 0; honor boolean;
  cap int; deja int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180
     or p_lat = 'NaN'::double precision or p_lon = 'NaN'::double precision then
    raise exception 'Pose ton épingle sur la carte';
  end if;
  select * into r from hg_geo_rounds where id = p_round;
  if not found or not r.active or r.day is null or r.day > d then raise exception 'Cette manche n''est pas ouverte'; end if;
  honor := r.day < d;
  perform hg_eco_lock(me);
  if exists (select 1 from hg_geo_guesses where round_id = r.id and user_id = me) then
    raise exception 'Tu as déjà joué cette manche';
  end if;
  dist := hg_geo_dist(p_lat, p_lon, r.lat, r.lon);
  sc := hg_geo_score(dist, hg_jeux_cap('geo_echelle_km', 50, 1, 20000));
  if not honor then
    cap := hg_jeux_cap('geo_jour', 50, 0, 500);
    select coalesce(sum(delta), 0) into deja from hg_wallet_log
      where user_id = me and reason = 'geo' and created_at >= hg_eco_day_start();
    gain := greatest(0, least(sc / hg_jeux_cap('geo_points_par_paillette', 100, 1, 5000), cap - deja));
  end if;
  insert into hg_geo_guesses (round_id, user_id, lat, lon, distance_m, score, reward, honor)
    values (r.id, me, p_lat, p_lon, dist, sc, gain, honor);
  if gain > 0 and not hg_wallet_add(me, gain, 'geo', 'geo:' || r.id::text) then
    gain := 0;
    update hg_geo_guesses set reward = 0 where round_id = r.id and user_id = me;
  end if;
  return jsonb_build_object('round_id', r.id, 'distance_m', dist, 'score', sc, 'reward', gain, 'honor', honor,
    'lat', p_lat, 'lon', p_lon, 'solution', hg_geo_solution(r));
end $$;

-- Classements : « jour » (manche du jour, ou p_round pour une manche de l'archive) et « semaine » (somme des manches
-- de la semaine en cours, du lundi au dimanche). Tentatives « pour l'honneur » exclues. Le membre ne voit le classement
-- d'une manche de l'archive qu'après l'avoir jouée (sinon les distances aident à deviner).
create or replace function public.hg_geo_board(p_scope text default 'jour', p_round uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_geo_day(); rid uuid; w date := date_trunc('week', hg_geo_day())::date;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_scope = 'semaine' then
    return coalesce((select jsonb_agg(x order by x.rank) from (
      select g.user_id, p.pseudo, p.color, p.avatar_url, sum(g.score)::int as score, count(*)::int as manches,
        rank() over (order by sum(g.score) desc)::int as rank
      from hg_geo_guesses g join hg_geo_rounds r on r.id = g.round_id join hg_profiles p on p.id = g.user_id
      where not g.honor and r.day between w and w + 6
      group by g.user_id, p.pseudo, p.color, p.avatar_url
      order by 5 desc limit 50) x), '[]'::jsonb);
  end if;
  rid := coalesce(p_round, (select id from hg_geo_rounds where day = d and active));
  if rid is null then return '[]'::jsonb; end if;
  if p_round is not null and not exists (select 1 from hg_geo_guesses where round_id = rid and user_id = me)
     and not hg_has_perm('souvenirs') then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(x order by x.rank) from (
    select g.user_id, p.pseudo, p.color, p.avatar_url, g.score, g.distance_m,
      rank() over (order by g.score desc, g.distance_m)::int as rank
    from hg_geo_guesses g join hg_profiles p on p.id = g.user_id
    where g.round_id = rid and not g.honor
    order by g.score desc, g.distance_m limit 50) x), '[]'::jsonb);
end $$;

-- Archive : les 30 dernières manches passées, avec mon résultat (et le lieu si je l'ai jouée).
create or replace function public.hg_geo_archive()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((select jsonb_agg(x order by x.day desc) from (
    select r.id, r.day, hg_geo_number(r.day) as number, r.image_path,
      g.score, g.distance_m, g.honor,
      case when g.id is not null then r.label end as label,
      case when g.id is not null then jsonb_build_object('lat', g.lat, 'lon', g.lon, 'distance_m', g.distance_m, 'score', g.score,
        'reward', g.reward, 'honor', g.honor, 'solution', hg_geo_solution(r)) end as mine
    from hg_geo_rounds r left join hg_geo_guesses g on g.round_id = r.id and g.user_id = me
    where r.active and r.day is not null and r.day < hg_geo_day()
    order by r.day desc limit 30) x), '[]'::jsonb);
end $$;

-- Panel (permission « souvenirs ») : toutes les manches, avec la réponse et le nombre de tentatives.
create or replace function public.hg_geo_admin_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  return coalesce((select jsonb_agg(x order by x.day desc nulls last, x.created_at desc) from (
    select r.id, r.day, r.photo_id, r.image_path, r.lat, r.lon, r.label, r.event_id, e.title as event_title, r.active,
      r.created_at, (select count(*) from hg_geo_guesses g where g.round_id = r.id)::int as guesses
    from hg_geo_rounds r left join hg_events e on e.id = r.event_id
    order by r.day desc nulls last, r.created_at desc limit 300) x), '[]'::jsonb);
end $$;

-- Panel : créer (p_id null) ou modifier une manche. Une manche déjà jouée ne change plus de point ni de jour.
-- Jour passé refusé (l'archive ne se réécrit pas) ; jour null = réserve. Journalisé.
create or replace function public.hg_geo_round_save(p_id uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare rid uuid; v_day date; v_lat double precision; v_lon double precision; v_label text; v_path text;
  v_photo uuid; v_event uuid; v_active boolean; old hg_geo_rounds; played boolean := false;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Données manquantes'; end if;
  begin
    v_day := nullif(p->>'day', '')::date;
    v_lat := (p->>'lat')::double precision;
    v_lon := (p->>'lon')::double precision;
    v_photo := nullif(p->>'photo_id', '')::uuid;
    v_event := nullif(p->>'event_id', '')::uuid;
  exception when others then raise exception 'Valeur illisible (date, position ou identifiant)';
  end;
  v_label := btrim(coalesce(p->>'label', ''));
  v_path := btrim(coalesce(p->>'image_path', ''));
  v_active := coalesce((p->>'active')::boolean, true);
  if v_lat is null or v_lon is null or v_lat not between -90 and 90 or v_lon not between -180 and 180 then
    raise exception 'Place le vrai lieu sur la carte';
  end if;
  if char_length(v_label) not between 1 and 120 then raise exception 'Nomme le lieu (120 caractères au plus)'; end if;
  if v_path !~ '^[0-9a-f-]{36}/geo/[A-Za-z0-9._-]{1,80}$' then raise exception 'Photo de la manche manquante'; end if;
  if v_photo is not null and not exists (select 1 from hg_photos where id = v_photo) then raise exception 'Photo introuvable'; end if;
  if v_event is not null and not exists (select 1 from hg_events where id = v_event) then raise exception 'Sortie introuvable'; end if;
  if p_id is not null then
    select * into old from hg_geo_rounds where id = p_id for update;
    if not found then raise exception 'Manche introuvable'; end if;
    played := exists (select 1 from hg_geo_guesses where round_id = p_id);
    if played and (old.lat <> v_lat or old.lon <> v_lon or old.day is distinct from v_day or old.image_path <> v_path) then
      raise exception 'Cette manche a déjà été jouée : seuls le nom du lieu et l''activation peuvent changer';
    end if;
  end if;
  if v_day is not null and v_day < hg_geo_day() and not played then raise exception 'Choisis aujourd''hui ou un jour à venir'; end if;
  if v_day is not null and exists (select 1 from hg_geo_rounds where day = v_day and id is distinct from p_id) then
    raise exception 'Une manche est déjà programmée ce jour-là';
  end if;
  if p_id is null then
    insert into hg_geo_rounds (day, photo_id, image_path, lat, lon, label, event_id, active, created_by)
      values (v_day, v_photo, v_path, v_lat, v_lon, v_label, v_event, v_active, auth.uid()) returning id into rid;
  else
    update hg_geo_rounds set day = v_day, photo_id = v_photo, image_path = v_path, lat = v_lat, lon = v_lon,
      label = v_label, event_id = v_event, active = v_active, updated_at = now()
      where id = p_id returning id into rid;
  end if;
  perform hg_admin_audit(case when p_id is null then 'geo_manche_creee' else 'geo_manche_modifiee' end, null, rid::text,
    jsonb_build_object('jour', v_day, 'lieu', v_label, 'active', v_active));
  return rid;
end $$;

-- ---------------------------------------------------------------------
-- 2. J2 · Classement des jeux du jour
-- ---------------------------------------------------------------------
do $d$
declare cas text := 'on de' || 'lete cascade';
begin
  execute format($t$
    create table if not exists public.hg_daily_results (
      id bigserial primary key,
      user_id uuid not null references public.hg_profiles(id) %1$s,
      game text not null check (game in ('worldle', 'sutom', 'framed', 'cemantix', 'pedantix', 'heardle', 'loldle')),
      grid_no int not null check (grid_no between 0 and 1000000),
      score int not null check (score between 0 and 100000),   -- essais ou coups ; 0 = grille ratée
      max int check (max is null or max between 1 and 20),     -- 6 pour « x/6 », null pour un nombre de coups
      raw text not null check (char_length(raw) <= 600),
      played_on date not null,
      reward int not null default 0 check (reward >= 0),
      created_at timestamptz not null default now(),
      unique (user_id, game, grid_no),
      unique (user_id, game, played_on)
    )$t$, cas);
end $d$;
create index if not exists hg_daily_results_day on public.hg_daily_results (played_on, game);
alter table public.hg_daily_results enable row level security;
revoke all on public.hg_daily_results from public, anon, authenticated;
revoke all on sequence public.hg_daily_results_id_seq from public, anon, authenticated;

-- Réglages : hg_settings « jeux_du_jour » = { actifs: [jeux], ref: { jeu: { date, n } }, paillettes: bool }.
-- ref : numéro de la grille à une date, pour vérifier la vraisemblance d'un numéro (sans ref : pas de contrôle).
insert into public.hg_settings (key, value)
  values ('jeux_du_jour', '{"actifs":["worldle","sutom","framed","cemantix","pedantix","heardle","loldle"],"ref":{},"paillettes":true}'::jsonb)
  on conflict (key) do nothing;

create or replace function public.hg_daily_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from hg_settings where key = 'jeux_du_jour'), '{}'::jsonb) $$;

-- Lecture d'un texte de partage : { game, grid, score, max } ou null si le format n'est pas reconnu.
-- score = essais (1..max) ou coups ; 0 = grille ratée. LoLdle n'a pas de numéro : grid null (calculé par l'appelant).
-- Mêmes règles que assets/js/jeux/jdj-parse.js (aperçu du front).
create or replace function public.hg_daily_parse(p_raw text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare t text := coalesce(p_raw, ''); m text[]; sq text; pos int;
begin
  if char_length(t) > 600 then return null; end if;
  m := regexp_match(t, '#\s*worldle\s*#\s*(\d{1,6})\s*(?:\([^)]{0,20}\)\s*)?([1-6xX])\s*/\s*6', 'i');
  if m is not null then
    return jsonb_build_object('game', 'worldle', 'grid', m[1]::int, 'score', case when upper(m[2]) = 'X' then 0 else m[2]::int end, 'max', 6);
  end if;
  m := regexp_match(t, 'sutom\s*#?\s*(\d{1,6})\s+([1-6xX-])\s*/\s*6', 'i');
  if m is not null then
    return jsonb_build_object('game', 'sutom', 'grid', m[1]::int, 'score', case when m[2] ~ '^[0-9]$' then m[2]::int else 0 end, 'max', 6);
  end if;
  m := regexp_match(t, '#?\s*c[ée]mantix\s*n?\s*[º°o]?\s*(\d{1,6})\D{0,40}?\s(\d{1,5})\s*coups?', 'i');
  if m is not null then
    return jsonb_build_object('game', 'cemantix', 'grid', m[1]::int, 'score', m[2]::int, 'max', null);
  end if;
  m := regexp_match(t, '#?\s*p[ée]dantix\s*n?\s*[º°o]?\s*(\d{1,6})\D{0,40}?\s(\d{1,5})\s*coups?', 'i');
  if m is not null then
    return jsonb_build_object('game', 'pedantix', 'grid', m[1]::int, 'score', m[2]::int, 'max', null);
  end if;
  m := regexp_match(t, 'framed\s*#\s*(\d{1,6})(.*)$', 'i');
  if m is not null then
    sq := regexp_replace(m[2], '[^🟥🟩⬛⬜🟨]', '', 'g');
    if char_length(sq) = 0 then return null; end if;
    pos := position('🟩' in sq);
    return jsonb_build_object('game', 'framed', 'grid', m[1]::int, 'score', pos, 'max', 6);
  end if;
  m := regexp_match(t, '#\s*heardle\s*#\s*(\d{1,6})(.*)$', 'i');
  if m is not null then
    sq := regexp_replace(m[2], '[^🟥🟩⬛⬜🟨]', '', 'g');
    if char_length(sq) = 0 then return null; end if;
    pos := position('🟩' in sq);
    return jsonb_build_object('game', 'heardle', 'grid', m[1]::int, 'score', pos, 'max', 6);
  end if;
  m := regexp_match(t, '#\s*loldle.*?(?:classic|classique)\s*:\s*(\d{1,3})', 'i');
  if m is not null then
    return jsonb_build_object('game', 'loldle', 'grid', null, 'score', m[1]::int, 'max', null);
  end if;
  return null;
end $$;

-- Points de la semaine : 6 pour une réussite du premier coup … 1 au plus lent, 0 pour une grille ratée.
create or replace function public.hg_daily_points(p_game text, p_score int, p_max int)
returns int language sql immutable set search_path = public as $$
  select case
    when coalesce(p_score, 0) <= 0 then 0
    when p_game in ('cemantix', 'pedantix') then
      case when p_score <= 10 then 6 when p_score <= 25 then 5 when p_score <= 50 then 4
           when p_score <= 100 then 3 when p_score <= 200 then 2 else 1 end
    else greatest(1, least(6, 7 - p_score)) end $$;

-- Série : jours consécutifs (Zurich) avec au moins un jeu déclaré, jusqu'à aujourd'hui ou hier.
create or replace function public.hg_daily_streak(p_user uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare d date := hg_jeux_today(); n int := 0;
begin
  if not exists (select 1 from hg_daily_results where user_id = p_user and played_on = d) then d := d - 1; end if;
  while exists (select 1 from hg_daily_results where user_id = p_user and played_on = d) loop
    n := n + 1; d := d - 1;
    exit when n >= 3660;
  end loop;
  return n;
end $$;

-- Déclaration d'un résultat : relu par le serveur, une fois par jeu et par jour, Paillettes plafonnées.
create or replace function public.hg_daily_submit(p_raw text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); r jsonb; cfg jsonb := hg_daily_cfg(); g text; grid int; expected int; ref jsonb;
  today date := hg_jeux_today(); played date; gain int := 0; cap int; payes int; heure int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_raw is null or btrim(p_raw) = '' then raise exception 'Colle le texte de partage de ton jeu'; end if;
  if char_length(p_raw) > 600 then raise exception 'Texte trop long (600 caractères au plus)'; end if;
  r := hg_daily_parse(p_raw);
  if r is null then
    raise exception 'Format non reconnu. Jeux pris en charge : Worldle, Sutom, Framed, Cémantix, Pédantix, Heardle, LoLdle.';
  end if;
  g := r->>'game';
  if jsonb_typeof(cfg->'actifs') = 'array' and not (cfg->'actifs') ? g then raise exception 'Ce jeu n''est pas ouvert sur le site'; end if;
  ref := cfg->'ref'->g;
  if jsonb_typeof(ref) = 'object' and (ref->>'date') ~ '^\d{4}-\d{2}-\d{2}$' and (ref->>'n') ~ '^\d{1,6}$' then
    expected := (ref->>'n')::int + (today - (ref->>'date')::date);
  end if;
  grid := coalesce((r->>'grid')::int, expected, today - date '2020-01-01');
  heure := extract(hour from now() at time zone 'Europe/Zurich')::int;
  played := today;
  if expected is not null and r->>'grid' is not null then
    if grid = expected or grid = expected + 1 then played := today;
    elsif grid = expected - 1 and heure < 12 then played := today - 1;
    elsif grid = expected - 1 then raise exception 'La grille d''hier n''est plus acceptée après midi';
    else raise exception 'Ce numéro de grille (n°%) ne correspond pas au jeu du jour (n°%)', grid, expected;
    end if;
  end if;
  perform hg_eco_lock(me);
  if exists (select 1 from hg_daily_results where user_id = me and game = g and (grid_no = grid or played_on = played)) then
    raise exception 'Tu as déjà déclaré ce jeu pour ce jour';
  end if;
  cap := hg_jeux_cap('jeux_du_jour', 3, 0, 10);
  payes := hg_eco_count(me, 'jeu_du_jour', hg_eco_day_start());
  if coalesce((cfg->>'paillettes')::boolean, true) and payes < cap then gain := hg_jeux_cap('jeu_du_jour_gain', 5, 0, 50); end if;
  insert into hg_daily_results (user_id, game, grid_no, score, max, raw, played_on, reward)
    values (me, g, grid, (r->>'score')::int, (r->>'max')::int, btrim(p_raw), played, gain);
  if gain > 0 and not hg_wallet_add(me, gain, 'jeu_du_jour', 'jdj:' || g || ':' || grid::text) then
    gain := 0;
    update hg_daily_results set reward = 0 where user_id = me and game = g and grid_no = grid;
  end if;
  return jsonb_build_object('game', g, 'grid', grid, 'score', (r->>'score')::int, 'max', (r->>'max')::int, 'played_on', played,
    'reward', gain, 'payes', payes + case when gain > 0 then 1 else 0 end, 'plafond', cap,
    'points', hg_daily_points(g, (r->>'score')::int, (r->>'max')::int), 'streak', hg_daily_streak(me));
end $$;

-- Classement d'un jour (par défaut aujourd'hui) par jeu : score et nombre d'essais, jamais le texte brut (solution).
create or replace function public.hg_daily_board(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := coalesce(p_day, hg_jeux_today()); cfg jsonb := hg_daily_cfg(); cap int := hg_jeux_cap('jeux_du_jour', 3, 0, 10);
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if d > hg_jeux_today() or d < hg_jeux_today() - 60 then raise exception 'Jour hors de portée'; end if;
  return jsonb_build_object(
    'day', d,
    'actifs', coalesce(cfg->'actifs', '[]'::jsonb),
    'paillettes', coalesce((cfg->>'paillettes')::boolean, true),
    'gain', hg_jeux_cap('jeu_du_jour_gain', 5, 0, 50), 'plafond', cap,
    'payes', hg_eco_count(me, 'jeu_du_jour', hg_eco_day_start()),
    'streak', hg_daily_streak(me),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('game', game, 'grid', grid_no, 'score', score, 'max', max, 'reward', reward))
                      from hg_daily_results where user_id = me and played_on = d), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'pseudo', p.pseudo, 'color', p.color,
        'avatar_url', p.avatar_url, 'game', x.game, 'grid', x.grid_no, 'score', x.score, 'max', x.max,
        'points', hg_daily_points(x.game, x.score, x.max))
        order by x.game, hg_daily_points(x.game, x.score, x.max) desc, (case when x.score = 0 then 1 else 0 end), x.score, x.created_at)
      from hg_daily_results x join hg_profiles p on p.id = x.user_id where x.played_on = d), '[]'::jsonb));
end $$;

-- Classement de la semaine (lundi à dimanche, Zurich) : somme des points, nombre de jeux déclarés.
create or replace function public.hg_daily_week(p_week date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w date := date_trunc('week', coalesce(p_week, hg_jeux_today()))::date;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('week', w, 'rows', coalesce((select jsonb_agg(x order by x.rank) from (
    select r.user_id, p.pseudo, p.color, p.avatar_url, sum(hg_daily_points(r.game, r.score, r.max))::int as points,
      count(*)::int as jeux, rank() over (order by sum(hg_daily_points(r.game, r.score, r.max)) desc)::int as rank
    from hg_daily_results r join hg_profiles p on p.id = r.user_id
    where r.played_on between w and w + 6
    group by r.user_id, p.pseudo, p.color, p.avatar_url
    order by 5 desc limit 50) x), '[]'::jsonb));
end $$;

-- Panel (permission « cartes ») : réglages bornés et retrait d'un résultat aberrant, journalisés.
create or replace function public.hg_daily_admin(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, hg_jeux_today());
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  return jsonb_build_object('reglages', hg_daily_cfg(), 'day', d, 'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'pseudo', p.pseudo, 'game', r.game, 'grid', r.grid_no, 'score', r.score,
      'max', r.max, 'raw', r.raw, 'reward', r.reward, 'created_at', r.created_at) order by r.created_at desc)
    from hg_daily_results r join hg_profiles p on p.id = r.user_id where r.played_on = d), '[]'::jsonb));
end $$;

create or replace function public.hg_daily_settings_save(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare jeux text[] := array['worldle', 'sutom', 'framed', 'cemantix', 'pedantix', 'heardle', 'loldle'];
  actifs jsonb; ref jsonb := '{}'::jsonb; k text; v jsonb; out jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglages illisibles'; end if;
  select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into actifs
    from jsonb_array_elements_text(case when jsonb_typeof(p->'actifs') = 'array' then p->'actifs' else '[]'::jsonb end) x
    where x = any(jeux);
  if jsonb_typeof(p->'ref') = 'object' then
    for k, v in select * from jsonb_each(p->'ref') loop
      if not (k = any(jeux)) then continue; end if;
      if jsonb_typeof(v) <> 'object' or (v->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (v->>'n') !~ '^\d{1,6}$' then
        raise exception 'Référence de % illisible : une date et un numéro de grille', k;
      end if;
      begin perform (v->>'date')::date; exception when others then raise exception 'Date de référence de % invalide', k; end;
      ref := ref || jsonb_build_object(k, jsonb_build_object('date', v->>'date', 'n', (v->>'n')::int));
    end loop;
  end if;
  out := jsonb_build_object('actifs', actifs, 'ref', ref, 'paillettes', coalesce((p->>'paillettes')::boolean, true));
  insert into hg_settings (key, value, updated_at) values ('jeux_du_jour', out, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('jeux_du_jour_reglages', null, 'jeux_du_jour', out);
  return out;
end $$;

-- Retrait d'un résultat aberrant : la ligne part (requête dynamique) ; les Paillettes versées restent (5 au plus).
create or replace function public.hg_daily_remove(p_id bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare r hg_daily_results;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select * into r from hg_daily_results where id = p_id;
  if not found then raise exception 'Résultat introuvable'; end if;
  execute 'de' || 'lete from public.hg_daily_results where id = $1' using p_id;
  perform hg_admin_audit('jeu_du_jour_retire', r.user_id, p_id::text,
    jsonb_build_object('jeu', r.game, 'grille', r.grid_no, 'score', r.score, 'texte', left(r.raw, 200)));
end $$;

-- ---------------------------------------------------------------------
-- 3. J3 · « Qui a dit ça ? »
-- ---------------------------------------------------------------------
do $d$
declare nul text := 'on de' || 'lete set null'; cas text := 'on de' || 'lete cascade';
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hg_quiz_questions' and column_name = 'subject_id') then
    execute format('alter table public.hg_quiz_questions add column subject_id uuid references public.hg_profiles(id) %s', nul);
  end if;
  execute format($t$
    create table if not exists public.hg_quote_proposals (
      id uuid primary key default gen_random_uuid(),
      proposed_by uuid not null references public.hg_profiles(id) %1$s,
      quote text not null check (char_length(btrim(quote)) between 3 and 280),
      author_id uuid not null references public.hg_profiles(id) %1$s,
      context text check (context is null or char_length(context) <= 200),
      status text not null default 'nouvelle' check (status in ('nouvelle', 'accord_auteur', 'refusee', 'publiee')),
      refused_by text check (refused_by is null or refused_by in ('auteur', 'staff')),
      question_id uuid references public.hg_quiz_questions(id) %2$s,
      created_at timestamptz not null default now(),
      decided_at timestamptz
    )$t$, cas, nul);
end $d$;
comment on column public.hg_quiz_questions.subject_id is 'Auteur d''une citation « Qui a dit ça ? » (migration 083) : la question lui est masquée.';
create index if not exists hg_quote_proposals_by on public.hg_quote_proposals (proposed_by, created_at);
create index if not exists hg_quote_proposals_author on public.hg_quote_proposals (author_id, status);
alter table public.hg_quote_proposals enable row level security;
revoke all on public.hg_quote_proposals from public, anon, authenticated;

-- Catégorie des citations dans le quiz.
create or replace function public.hg_quote_category()
returns text language sql immutable set search_path = public as $$ select 'Qui a dit ça ?'::text $$;

-- hg_quiz_list : version de 062, plus le masquage d'une citation à son auteur.
create or replace function public.hg_quiz_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare unlocked boolean := hg_eggs_count(auth.uid()) >= 3;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'type', q.qtype, 'difficulty', q.difficulty, 'category', q.category,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb)
                    from jsonb_array_elements(q.options) o),
        'image_url', q.image_url, 'reward', q.reward, 'starts_at', q.starts_at, 'ends_at', q.ends_at, 'secret', q.secret,
        'answered', a.id is not null,
        'my_response', a.response, 'correct', a.is_correct, 'earned', coalesce(a.reward, 0), 'answered_at', a.answered_at,
        'explanation', case when a.id is not null then q.explanation end,
        'solution', case when a.id is not null and a.is_correct is not null then
          case q.qtype when 'texte' then k.answer->'accepted' when 'nombre' then k.answer->'value' else k.answer->'correct' end end)
      order by (a.id is not null), q.secret desc, q.starts_at desc)
    from hg_quiz_questions q
    left join hg_quiz_keys k on k.question_id = q.id
    left join hg_quiz_answers a on a.question_id = q.id and a.user_id = auth.uid()
    where q.active and q.starts_at <= now() and (a.id is not null or q.ends_at is null or q.ends_at > now())
      and (not q.secret or unlocked or a.id is not null)
      and q.subject_id is distinct from auth.uid()
  ), '[]'::jsonb);
end $$;

-- hg_quiz_answer : version de 076 (auteur de la question, Staff « quiz », plafond 2 000), plus le refus pour
-- l'auteur d'une citation.
create or replace function public.hg_quiz_answer(p_question uuid, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q hg_quiz_questions; k jsonb; ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into q from hg_quiz_questions where id = p_question;
  if not found or not q.active or q.starts_at > now() or (q.ends_at is not null and q.ends_at <= now())
     or (q.secret and hg_eggs_count(me) < 3) or q.subject_id = me then
    raise exception 'Cette question n''est pas ouverte';
  end if;
  if q.created_by = me then raise exception 'Tu ne peux pas répondre à une question que tu as écrite.' using errcode = 'P0001'; end if;
  if p_response is null or (jsonb_typeof(p_response) = 'string' and btrim(p_response #>> '{}') = '')
     or (jsonb_typeof(p_response) = 'array' and jsonb_array_length(p_response) = 0) then
    raise exception 'Choisis ou écris une réponse';
  end if;
  if length(p_response::text) > 1000 then raise exception 'Réponse trop longue'; end if;
  if exists (select 1 from hg_quiz_answers where question_id = q.id and user_id = me) then
    raise exception 'Tu as déjà répondu à cette question';
  end if;
  select answer into k from hg_quiz_keys where question_id = q.id;
  ok := hg_quiz_check(q.qtype, coalesce(k, '{}'::jsonb), p_response);
  -- 076 (I2) : le Staff « quiz » connaît les réponses : il joue sans gagner de Paillettes.
  if ok and not hg_has_perm('quiz') then gain := least(greatest(q.reward, 0), 2000); end if;
  insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward)
    values (q.id, me, p_response, ok, gain);
  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  return jsonb_build_object('correct', ok, 'reward', gain, 'explanation', case when ok is not null then q.explanation end,
    'solution', case when ok is not null then
      case q.qtype when 'texte' then k->'accepted' when 'nombre' then k->'value' else k->'correct' end end);
end $$;

-- Citations jouables pour le membre (onglet « Qui a dit ça ? ») : choix avec pseudo, couleur et avatar actuels ;
-- après réponse : bonne réponse, contexte et part du gang qui a trouvé.
create or replace function public.hg_quote_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((select jsonb_agg(x.j order by x.done, x.starts_at desc) from (
    select (a.id is not null) as done, q.starts_at, jsonb_build_object(
      'id', q.id, 'quote', q.prompt, 'difficulty', q.difficulty, 'reward', q.reward, 'starts_at', q.starts_at,
      'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.v->>'id', 'text', coalesce(p.pseudo, o.v->>'text'),
          'user_id', p.id, 'color', p.color, 'avatar_url', p.avatar_url) order by o.n), '[]'::jsonb)
        from jsonb_array_elements(q.options) with ordinality o(v, n)
        left join hg_profiles p on p.id::text = (o.v->>'uid')),
      'answered', a.id is not null, 'my_response', a.response, 'correct', a.is_correct, 'earned', coalesce(a.reward, 0),
      'explanation', case when a.id is not null then q.explanation end,
      'solution', case when a.id is not null then k.answer->'correct' end,
      'rate', case when a.id is not null then (select round(100.0 * count(*) filter (where b.is_correct) / nullif(count(*), 0))
        from hg_quiz_answers b where b.question_id = q.id) end) as j
    from hg_quiz_questions q
    left join hg_quiz_keys k on k.question_id = q.id
    left join hg_quiz_answers a on a.question_id = q.id and a.user_id = me
    where q.category = hg_quote_category() and q.active and q.starts_at <= now()
      and (a.id is not null or q.ends_at is null or q.ends_at > now())
      and q.subject_id is distinct from me
    order by (a.id is not null), q.starts_at desc limit 60) x), '[]'::jsonb);
end $$;

-- Proposer une citation : 3 par jour au plus (Staff « quiz » : sans limite). L'auteur doit être un membre (pas un
-- fantôme). Si on propose sa propre phrase, l'accord de l'auteur est déjà donné.
create or replace function public.hg_quote_propose(p_quote text, p_author uuid, p_context text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); n int; cap int; pid uuid; q text := btrim(coalesce(p_quote, '')); c text := nullif(btrim(coalesce(p_context, '')), '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if char_length(q) not between 3 and 280 then raise exception 'La citation doit faire entre 3 et 280 caractères'; end if;
  if c is not null and char_length(c) > 200 then raise exception 'Contexte trop long (200 caractères au plus)'; end if;
  if p_author is null or not exists (select 1 from hg_profiles where id = p_author and not coalesce(is_ghost, false)) then
    raise exception 'Choisis l''auteur de la citation parmi les membres';
  end if;
  if not hg_has_perm('quiz') then
    perform hg_eco_lock(me);
    cap := hg_jeux_cap('citations_jour', 3, 0, 20);
    select count(*) into n from hg_quote_proposals where proposed_by = me and created_at >= hg_eco_day_start();
    if n >= cap then raise exception 'Limite atteinte : % citations proposées par jour. Réessaie demain.', cap; end if;
  end if;
  insert into hg_quote_proposals (proposed_by, quote, author_id, context, status)
    values (me, q, p_author, c, case when p_author = me then 'accord_auteur' else 'nouvelle' end)
    returning id into pid;
  return pid;
end $$;

-- Mes propositions et les citations qui attendent mon accord (je suis l'auteur).
create or replace function public.hg_quote_mine()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object(
    'proposees', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'quote', x.quote, 'author', p.pseudo,
        'status', x.status, 'created_at', x.created_at) order by x.created_at desc)
      from (select * from hg_quote_proposals where proposed_by = me order by created_at desc limit 20) x
      join hg_profiles p on p.id = x.author_id), '[]'::jsonb),
    'a_valider', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'quote', x.quote, 'context', x.context,
        'proposed_by', p.pseudo, 'created_at', x.created_at) order by x.created_at)
      from hg_quote_proposals x join hg_profiles p on p.id = x.proposed_by
      where x.author_id = me and x.status = 'nouvelle'), '[]'::jsonb),
    'restantes', case when hg_has_perm('quiz') then null else greatest(0, hg_jeux_cap('citations_jour', 3, 0, 20)
      - (select count(*) from hg_quote_proposals where proposed_by = me and created_at >= hg_eco_day_start())::int) end);
end $$;

-- Réponse de l'auteur : accord ou refus (définitif). Seulement tant que la citation n'est pas publiée.
create or replace function public.hg_quote_author_reply(p_id uuid, p_ok boolean)
returns text language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); x hg_quote_proposals;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into x from hg_quote_proposals where id = p_id for update;
  if not found or x.author_id is distinct from me then raise exception 'Citation introuvable'; end if;
  if x.status not in ('nouvelle', 'accord_auteur') then raise exception 'Cette citation n''attend plus ta réponse'; end if;
  update hg_quote_proposals set status = case when p_ok then 'accord_auteur' else 'refusee' end,
    refused_by = case when p_ok then null else 'auteur' end, decided_at = now() where id = p_id;
  return case when p_ok then 'accord_auteur' else 'refusee' end;
end $$;

-- File du Staff « quiz » : propositions en attente (nouvelle, accord_auteur), plus les 30 dernières traitées.
create or replace function public.hg_quote_queue()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé au Staff « quiz »'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'quote', x.quote, 'context', x.context, 'status', x.status,
      'refused_by', x.refused_by, 'author_id', x.author_id, 'author', a.pseudo, 'proposed_by', b.pseudo,
      'question_id', x.question_id, 'created_at', x.created_at, 'decided_at', x.decided_at,
      'publiable', x.status = 'accord_auteur' or (x.status = 'nouvelle' and x.created_at < now() - interval '3 days'))
      order by (x.status in ('nouvelle', 'accord_auteur')) desc, x.created_at desc)
    from (select * from hg_quote_proposals
          where status in ('nouvelle', 'accord_auteur') or id in (select id from hg_quote_proposals
            where status in ('refusee', 'publiee') order by coalesce(decided_at, created_at) desc limit 30)) x
    join hg_profiles a on a.id = x.author_id join hg_profiles b on b.id = x.proposed_by), '[]'::jsonb);
end $$;

-- Publication (Staff « quiz ») : question du quiz, catégorie « Qui a dit ça ? », 4 choix (l'auteur + 3 membres actifs
-- tirés au sort), masquée à l'auteur. Exige l'accord de l'auteur, ou 3 jours sans réponse de sa part. Le texte et le
-- contexte peuvent être reformulés. Gain de la bonne réponse : hg_quiz_answer (une réponse par membre).
create or replace function public.hg_quote_publish(p_id uuid, p_quote text default null, p_context text default null,
  p_reward int default null, p_difficulty text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare x hg_quote_proposals; q text; c text; rw int; diff text; opts jsonb := '[]'::jsonb; ids text[] := array['a', 'b', 'c', 'd'];
  rec record; i int := 0; good text; qid uuid;
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé au Staff « quiz »'; end if;
  select * into x from hg_quote_proposals where id = p_id for update;
  if not found then raise exception 'Citation introuvable'; end if;
  if x.status = 'publiee' then raise exception 'Citation déjà publiée'; end if;
  if x.status = 'refusee' then raise exception 'Citation refusée : elle ne peut pas être publiée'; end if;
  if x.status = 'nouvelle' and x.created_at >= now() - interval '3 days' then
    raise exception 'L''auteur n''a pas encore donné son accord (publication possible 3 jours après la proposition)';
  end if;
  q := btrim(coalesce(nullif(btrim(coalesce(p_quote, '')), ''), x.quote));
  if char_length(q) not between 3 and 280 then raise exception 'La citation doit faire entre 3 et 280 caractères'; end if;
  c := nullif(btrim(coalesce(p_context, x.context, '')), '');
  if c is not null and char_length(c) > 200 then raise exception 'Contexte trop long (200 caractères au plus)'; end if;
  rw := least(greatest(coalesce(p_reward, 10), 0), 100);
  diff := coalesce(nullif(p_difficulty, ''), 'facile');
  if diff not in ('facile', 'moyen', 'difficile', 'expert') then raise exception 'Difficulté inconnue'; end if;
  for rec in
    select * from (
      select p.id, p.pseudo, (p.id = x.author_id) as good from hg_profiles p where p.id = x.author_id
      union all
      (select p.id, p.pseudo, false from hg_profiles p
        where p.id <> x.author_id and not coalesce(p.is_ghost, false)
          and (exists (select 1 from hg_wallet_log l where l.user_id = p.id and l.created_at > now() - interval '90 days')
               or p.created_at > now() - interval '90 days')
        order by random() limit 3)
    ) s order by random()
  loop
    i := i + 1;
    opts := opts || jsonb_build_array(jsonb_build_object('id', ids[i], 'text', left(rec.pseudo, 200), 'uid', rec.id));
    if rec.good then good := ids[i]; end if;
  end loop;
  if i < 2 then raise exception 'Pas assez de membres actifs pour proposer des choix'; end if;
  insert into hg_quiz_questions (prompt, qtype, difficulty, category, options, explanation, reward, starts_at, active, created_by, subject_id)
    values (q, 'choix_unique', diff, hg_quote_category(), opts, c, rw, now(), true, auth.uid(), x.author_id)
    returning id into qid;
  insert into hg_quiz_keys (question_id, answer) values (qid, jsonb_build_object('correct', jsonb_build_array(good)));
  update hg_quote_proposals set status = 'publiee', question_id = qid, quote = q, context = c, decided_at = now() where id = p_id;
  perform hg_admin_audit('citation_publiee', x.author_id, qid::text, jsonb_build_object('proposition', p_id, 'recompense', rw));
  return qid;
end $$;

-- Refus par le Staff (citation qui gêne, vise ou expose quelqu'un…). Journalisé.
create or replace function public.hg_quote_refuse(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare x hg_quote_proposals;
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé au Staff « quiz »'; end if;
  select * into x from hg_quote_proposals where id = p_id for update;
  if not found then raise exception 'Citation introuvable'; end if;
  if x.status not in ('nouvelle', 'accord_auteur') then raise exception 'Cette citation est déjà traitée'; end if;
  update hg_quote_proposals set status = 'refusee', refused_by = 'staff', decided_at = now() where id = p_id;
  perform hg_admin_audit('citation_refusee', x.author_id, p_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Droits d'exécution
-- ---------------------------------------------------------------------
do $d$
declare f text;
begin
  -- Outils internes : jamais appelés directement par le client.
  foreach f in array array[
    'public.hg_jeux_today()', 'public.hg_jeux_cap(text, integer, integer, integer)', 'public.hg_geo_day()',
    'public.hg_geo_dist(double precision, double precision, double precision, double precision)',
    'public.hg_geo_score(integer, integer)', 'public.hg_geo_current()', 'public.hg_geo_number(date)',
    'public.hg_geo_solution(public.hg_geo_rounds)', 'public.hg_geo_week_bonus(date)', 'public.hg_geo_reglages()',
    'public.hg_daily_cfg()', 'public.hg_daily_parse(text)', 'public.hg_daily_points(text, integer, integer)',
    'public.hg_daily_streak(uuid)', 'public.hg_quote_category()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- RPC des membres (et du Staff, qui contrôlent leurs droits eux-mêmes) : authenticated seulement.
  foreach f in array array[
    'public.hg_geo_today()', 'public.hg_geo_guess(uuid, double precision, double precision)',
    'public.hg_geo_board(text, uuid)', 'public.hg_geo_archive()', 'public.hg_geo_admin_list()',
    'public.hg_geo_round_save(uuid, jsonb)',
    'public.hg_daily_submit(text)', 'public.hg_daily_board(date)', 'public.hg_daily_week(date)',
    'public.hg_daily_admin(date)', 'public.hg_daily_settings_save(jsonb)', 'public.hg_daily_remove(bigint)',
    'public.hg_quiz_list()', 'public.hg_quiz_answer(uuid, jsonb)',
    'public.hg_quote_list()', 'public.hg_quote_propose(text, uuid, text)', 'public.hg_quote_mine()',
    'public.hg_quote_author_reply(uuid, boolean)', 'public.hg_quote_queue()',
    'public.hg_quote_publish(uuid, text, text, integer, text)', 'public.hg_quote_refuse(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $d$;
