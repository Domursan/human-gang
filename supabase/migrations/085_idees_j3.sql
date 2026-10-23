-- =====================================================================
-- 085 : idées J9 (Framed du ciné-club), J10 (Heardle du gang), J11 (quêtes à preuve validées par le Staff),
--       J15 (Bataille de cartes). Paquet xJ3 de la page « Jeux ».
--
-- S'applique après 075. Idempotent (create … if not exists, create or replace, policies recréées dans des blocs do ;
-- les mots-clés de retrait sont construits dynamiquement). Rétrocompatible : les RPC existantes gardent leur signature
-- et leur réponse (hg_card_quests_me ajoute seulement des champs).
--
-- Règles de sécurité communes (audit du 23/10) :
--   - toute récompense passe par une RPC security definer plafonnée et idempotente (hg_wallet_add + hg_wallet_log_once,
--     ref unique par jour / bataille / quête), jamais par un trigger ;
--   - RLS activée sur chaque nouvelle table, aucun accès direct des clients (tout passe par les RPC) ;
--   - search_path fixé, execute retiré à anon et public ;
--   - droits Staff par hg_has_perm (souvenirs : Framed et Heardle ; preuves : validation des preuves ; cartes : Bataille),
--     réglages bornés, journal admin (hg_admin_audit) pour chaque action Staff.
--
-- Contenu :
--   0. Outils communs (jour de Zurich), page « Jeux » dans le menu, permission Staff « preuves ».
--   1. Moteur commun des jeux « devine en 6 essais » (hg_daily_games) : Framed et Heardle.
--   2. J9 Framed : films du ciné-club (images privées dans le bucket hg-jeux), manches, RPC membre et Staff.
--   3. J10 Heardle : morceaux du gang (identifiant YouTube), propositions des membres, manches, RPC membre et Staff.
--   4. J11 Quêtes à preuve : colonnes des modèles, table hg_quest_proofs, bucket privé hg-proofs, tirage (2 par
--      semaine en plus des quêtes habituelles), progression, envoi, validation, nettoyage après 60 jours, 6 modèles.
--   5. J15 Bataille de cartes : decks de défense, batailles résolues côté serveur, gains (désactivés par défaut : bêta).
--   6. Droits d'exécution.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Outils communs, page « Jeux », permission « preuves »
-- ---------------------------------------------------------------------
-- Jour courant à l'heure de Zurich.
create or replace function public.hg_jeux_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Europe/Zurich')::date $$;

-- Page « Jeux » dans le menu (le paquet xJ1 livre la page ; la ligne est idempotente).
insert into public.hg_pages (slug, label, mode, in_nav, sort)
  values ('jeux', 'Jeux', 'admin', true, 10)
  on conflict (slug) do nothing;

-- Nouvelle permission Staff : valider les preuves des quêtes.
insert into public.hg_perm_catalog (key, label, description, sort)
  values ('preuves', 'Preuves de quêtes', 'Voir et valider (ou refuser) les captures envoyées pour les quêtes à preuve.', 96)
  on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Moteur commun : une partie par membre, jeu et jour
-- ---------------------------------------------------------------------
-- guesses : identifiants proposés dans l'ordre (texte ; '' = « passer »). Écrite seulement par les RPC.
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_daily_games (
  game text not null check (game in ('framed', 'heardle')),
  day date not null,
  user_id uuid not null references public.hg_profiles(id) @CASC,
  guesses text[] not null default '{}' check (cardinality(guesses) <= 6),
  solved boolean not null default false,
  finished boolean not null default false,
  score smallint not null default 0 check (score between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (game, day, user_id)
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
create index if not exists hg_daily_games_day on public.hg_daily_games (game, day);
alter table public.hg_daily_games enable row level security;
revoke all on public.hg_daily_games from anon, authenticated;

-- Gain d'une partie (réglable, borné à 200) : gagné ou consolation.
create or replace function public.hg_daily_reward(p_game text, p_solved boolean)
returns int language sql stable security definer set search_path = public as $$
  select least(200, greatest(0, case when p_solved then hg_eco_cap(p_game || '_gain', 10) else hg_eco_cap(p_game || '_consolation', 3) end)) $$;

-- Applique un essai à la partie du jour (interne). p_guess = identifiant proposé, null = « passer ».
-- Renvoie la partie à jour. Paie à la fin (gagné ou 6e essai), une seule fois par jour (ref <jeu>:<jour>).
create or replace function public.hg_daily_apply(p_game text, p_day date, p_answer text, p_guess text)
returns public.hg_daily_games language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g hg_daily_games; n int; ok boolean;
begin
  insert into hg_daily_games (game, day, user_id) values (p_game, p_day, me) on conflict do nothing;
  select * into g from hg_daily_games where game = p_game and day = p_day and user_id = me for update;
  if g.finished then raise exception 'Tu as déjà terminé la partie du jour. Reviens demain !'; end if;
  if p_guess is not null and p_guess = any(g.guesses) then raise exception 'Tu as déjà proposé cette réponse.'; end if;
  ok := p_guess is not null and p_guess = p_answer;
  g.guesses := g.guesses || coalesce(p_guess, '');
  n := cardinality(g.guesses);
  if ok then
    g.solved := true; g.finished := true; g.score := 7 - n;
  elsif n >= 6 then
    g.finished := true; g.score := 0;
  end if;
  update hg_daily_games set guesses = g.guesses, solved = g.solved, finished = g.finished, score = g.score, updated_at = now()
    where game = p_game and day = p_day and user_id = me;
  if g.finished then
    perform hg_wallet_add(me, hg_daily_reward(p_game, g.solved), p_game, p_game || ':' || p_day::text);
  end if;
  return g;
end $$;

-- Classement de la semaine (lundi, Zurich) d'un jeu : points cumulés, parties gagnées.
create or replace function public.hg_daily_week_board(p_game text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.points desc, x.wins desc, x.pseudo), '[]'::jsonb) from (
    select p.id as user_id, p.pseudo, p.color, sum(g.score)::int as points, count(*) filter (where g.solved)::int as wins
    from hg_daily_games g join hg_profiles p on p.id = g.user_id
    where g.game = p_game and g.day >= hg_quest_week(now()) and g.finished and not p.is_ghost
    group by p.id, p.pseudo, p.color order by points desc limit 10) x $$;

-- ---------------------------------------------------------------------
-- 2. J9 Framed du ciné-club
-- ---------------------------------------------------------------------
-- Films vus en séance (à relier à hg_cine_films quand V9 existera). frames : chemins dans le bucket privé hg-jeux,
-- framed/<id du film>/<n>.<ext>, 6 au plus, dans l'ordre de dévoilement.
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_framed_films (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  year smallint check (year between 1890 and 2100),
  seen_on date,
  viewers smallint check (viewers between 0 and 500),
  frames text[] not null default '{}' check (cardinality(frames) <= 6),
  active boolean not null default true,
  created_by uuid references public.hg_profiles(id) @SETNULL,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_framed_rounds (
  day date primary key,
  film_id uuid not null references public.hg_framed_films(id) @CASC,
  created_by uuid references public.hg_profiles(id) @SETNULL,
  created_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
create unique index if not exists hg_framed_rounds_film on public.hg_framed_rounds (film_id);
alter table public.hg_framed_films enable row level security;
alter table public.hg_framed_rounds enable row level security;
revoke all on public.hg_framed_films, public.hg_framed_rounds from anon, authenticated;

-- Nombre d'images visibles pour un membre : toutes si la partie est finie, sinon essais + 1.
create or replace function public.hg_framed_unlocked(p_day date, p_user uuid, p_total int)
returns int language sql stable security definer set search_path = public as $$
  select least(greatest(p_total, 0), coalesce((select case when g.finished then 6 else cardinality(g.guesses) + 1 end
    from hg_daily_games g where g.game = 'framed' and g.day = p_day and g.user_id = p_user), 1)) $$;

-- Une image du bucket hg-jeux est-elle lisible par le membre connecté ? Staff « souvenirs » : toujours.
-- Membre : image d'une manche passée, ou image déjà dévoilée de la manche du jour. Jamais une manche à venir.
create or replace function public.hg_jeux_obj_visible(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select hg_has_perm('souvenirs') or (hg_is_member() and exists (
    select 1 from hg_framed_rounds r join hg_framed_films f on f.id = r.film_id
    cross join lateral (select array_position(f.frames, p_name) as pos) x
    where x.pos is not null and r.day <= hg_jeux_today()
      and (r.day < hg_jeux_today() or x.pos <= hg_framed_unlocked(r.day, auth.uid(), cardinality(f.frames))))) $$;

-- Bucket privé des images de jeux (jamais public, jamais indexé).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hg-jeux', 'hg-jeux', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;
do $d$
begin
  execute 'dr' || 'op policy if exists hg_jeux_obj_read on storage.objects';
  execute 'dr' || 'op policy if exists hg_jeux_obj_write on storage.objects';
  execute 'dr' || 'op policy if exists hg_jeux_obj_update on storage.objects';
  execute 'dr' || 'op policy if exists hg_jeux_obj_remove on storage.objects';
  create policy hg_jeux_obj_read on storage.objects for select to authenticated
    using (bucket_id = 'hg-jeux' and public.hg_jeux_obj_visible(name));
  create policy hg_jeux_obj_write on storage.objects for insert to authenticated
    with check (bucket_id = 'hg-jeux' and public.hg_has_perm('souvenirs') and name ~ '^framed/[0-9a-f-]{36}/[1-6]\.(webp|jpg|png)$');
  create policy hg_jeux_obj_update on storage.objects for update to authenticated
    using (bucket_id = 'hg-jeux' and public.hg_has_perm('souvenirs'));
  execute 'create policy hg_jeux_obj_remove on storage.objects for ' || 'del' || 'ete to authenticated '
    || 'using (bucket_id = ''hg-jeux'' and public.hg_has_perm(''souvenirs''))';
end $d$;

-- État du membre : manche du jour, images dévoilées, essais, suggestions (films du ciné-club), classement.
create or replace function public.hg_framed_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_framed_rounds; f hg_framed_films; g hg_daily_games; k int; num int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into r from hg_framed_rounds where day = d;
  if not found then
    return jsonb_build_object('day', d, 'round', null,
      'next_day', (select min(day) from hg_framed_rounds where day > d),
      'board', hg_daily_week_board('framed'), 'hier', hg_daily_hier('framed'));
  end if;
  select * into f from hg_framed_films where id = r.film_id;
  select * into g from hg_daily_games where game = 'framed' and day = d and user_id = auth.uid();
  k := hg_framed_unlocked(d, auth.uid(), cardinality(f.frames));
  select count(*) into num from hg_framed_rounds where day <= d;
  return jsonb_build_object('day', d, 'round', num, 'total_frames', cardinality(f.frames),
    'frames', to_jsonb(f.frames[1:k]),
    'guesses', coalesce((select jsonb_agg(jsonb_build_object('id', x.gid, 'title', ff.title, 'year', ff.year) order by x.i)
      from unnest(coalesce(g.guesses, '{}')) with ordinality x(gid, i) left join hg_framed_films ff on ff.id::text = x.gid), '[]'::jsonb),
    'solved', coalesce(g.solved, false), 'finished', coalesce(g.finished, false), 'score', coalesce(g.score, 0),
    'reward', case when g.finished then hg_daily_reward('framed', g.solved) else null end,
    'gain', hg_daily_reward('framed', true), 'consolation', hg_daily_reward('framed', false),
    'film', case when g.finished then jsonb_build_object('id', f.id, 'title', f.title, 'year', f.year, 'seen_on', f.seen_on, 'viewers', f.viewers) else null end,
    'films', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'year', x.year, 'seen_on', x.seen_on) order by x.title)
      from hg_framed_films x where x.active), '[]'::jsonb),
    'board', hg_daily_week_board('framed'), 'hier', hg_daily_hier('framed'));
end $$;

-- Un essai : p_film = film proposé, null = « passer » (dévoile l'image suivante).
create or replace function public.hg_framed_guess(p_film uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_framed_rounds;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into r from hg_framed_rounds where day = d;
  if not found then raise exception 'Pas de Framed aujourd''hui.'; end if;
  if p_film is not null and not exists (select 1 from hg_framed_films where id = p_film) then raise exception 'Film inconnu'; end if;
  perform hg_daily_apply('framed', d, r.film_id::text, p_film::text);
  return hg_framed_state();
end $$;

-- Staff « souvenirs » : films et manches (30 jours passés, 90 à venir), avec le nombre de joueurs.
create or replace function public.hg_framed_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  return jsonb_build_object('today', hg_jeux_today(),
    'films', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'year', f.year, 'seen_on', f.seen_on,
        'viewers', f.viewers, 'frames', to_jsonb(f.frames), 'active', f.active,
        'day', (select r.day from hg_framed_rounds r where r.film_id = f.id)) order by f.title) from hg_framed_films f), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'film_id', r.film_id, 'title', f.title,
        'players', (select count(*) from hg_daily_games g where g.game = 'framed' and g.day = r.day)) order by r.day)
      from hg_framed_rounds r join hg_framed_films f on f.id = r.film_id
      where r.day between hg_jeux_today() - 30 and hg_jeux_today() + 90), '[]'::jsonb));
end $$;

-- Staff « souvenirs » : crée ou modifie un film. p = { id?, title, year?, seen_on?, viewers?, frames?, active? }.
-- Un nouvel identifiant peut être fourni (les images sont envoyées avant l'enregistrement, sous framed/<id>/).
create or replace function public.hg_framed_film_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_new boolean; v_title text := btrim(coalesce(p->>'title', '')); v_frames text[]; x text; f hg_framed_films;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  begin v_id := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()); exception when others then raise exception 'Identifiant invalide'; end;
  v_new := not exists (select 1 from hg_framed_films where id = v_id);
  if char_length(v_title) not between 1 and 120 then raise exception 'Le titre fait de 1 à 120 caractères'; end if;
  if p ? 'frames' then
    select coalesce(array_agg(e order by i), '{}') into v_frames from jsonb_array_elements_text(p->'frames') with ordinality t(e, i);
    if cardinality(v_frames) > 6 then raise exception '6 images au plus'; end if;
    foreach x in array v_frames loop
      if x !~ ('^framed/' || v_id::text || '/[1-6]\.(webp|jpg|png)$') then raise exception 'Chemin d''image invalide : %', x; end if;
    end loop;
  end if;
  if v_new then
    insert into hg_framed_films (id, title, year, seen_on, viewers, frames, active, created_by)
    values (v_id, v_title, nullif(p->>'year', '')::smallint, nullif(p->>'seen_on', '')::date, nullif(p->>'viewers', '')::smallint,
      coalesce(v_frames, '{}'), coalesce((p->>'active')::boolean, true), auth.uid())
    returning * into f;
  else
    update hg_framed_films set title = v_title,
      year = case when p ? 'year' then nullif(p->>'year', '')::smallint else year end,
      seen_on = case when p ? 'seen_on' then nullif(p->>'seen_on', '')::date else seen_on end,
      viewers = case when p ? 'viewers' then nullif(p->>'viewers', '')::smallint else viewers end,
      frames = coalesce(v_frames, frames), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = v_id returning * into f;
  end if;
  perform hg_admin_audit(case when v_new then 'framed_film_cree' else 'framed_film_modifie' end, null, v_id::text,
    jsonb_build_object('titre', f.title, 'images', cardinality(f.frames)));
  return to_jsonb(f);
end $$;

-- Staff « souvenirs » : programme (ou retire, p_film null) le film d'un jour. Pas de jour passé ; la manche du jour ne
-- change plus dès qu'un membre a joué ; un film ne revient jamais (ses images seraient déjà visibles) ; 3 images au moins.
create or replace function public.hg_framed_round_save(p_day date, p_film uuid)
returns void language plpgsql security definer set search_path = public as $$
declare f hg_framed_films;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  if p_day is null or p_day < hg_jeux_today() then raise exception 'Choisis aujourd''hui ou un jour à venir'; end if;
  if p_day > hg_jeux_today() + 365 then raise exception 'Un an à l''avance au plus'; end if;
  if exists (select 1 from hg_daily_games where game = 'framed' and day = p_day) then
    raise exception 'Des membres ont déjà joué cette manche : elle ne change plus';
  end if;
  if p_film is null then
    execute 'de' || 'lete from public.hg_framed_rounds where day = $1' using p_day;
  else
    select * into f from hg_framed_films where id = p_film;
    if not found then raise exception 'Film inconnu'; end if;
    if cardinality(f.frames) < 3 then raise exception 'Ce film a besoin d''au moins 3 images'; end if;
    if exists (select 1 from hg_framed_rounds where film_id = p_film and day <> p_day) then
      raise exception 'Ce film a déjà sa manche (un film ne revient pas)';
    end if;
    insert into hg_framed_rounds (day, film_id, created_by) values (p_day, p_film, auth.uid())
      on conflict (day) do update set film_id = excluded.film_id, created_by = excluded.created_by, created_at = now();
  end if;
  perform hg_admin_audit('framed_manche', null, p_day::text, jsonb_build_object('film', f.title));
end $$;

-- ---------------------------------------------------------------------
-- 3. J10 Heardle du gang
-- ---------------------------------------------------------------------
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_heardle_tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  artist text not null check (char_length(btrim(artist)) between 1 and 120),
  youtube_id text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  start_s int not null default 0 check (start_s between 0 and 36000),
  proposed_by uuid references public.hg_profiles(id) @SETNULL,
  shared_on text check (char_length(shared_on) <= 60),
  status text not null default 'propose' check (status in ('propose', 'valide', 'retire')),
  created_by uuid references public.hg_profiles(id) @SETNULL,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_heardle_rounds (
  day date primary key,
  track_id uuid not null references public.hg_heardle_tracks(id) @CASC,
  cancelled boolean not null default false,
  created_by uuid references public.hg_profiles(id) @SETNULL,
  created_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
create unique index if not exists hg_heardle_rounds_track on public.hg_heardle_rounds (track_id);
alter table public.hg_heardle_tracks enable row level security;
alter table public.hg_heardle_rounds enable row level security;
revoke all on public.hg_heardle_tracks, public.hg_heardle_rounds from anon, authenticated;

-- Durées d'écoute débloquées : 1, 2, 4, 7, 11, 16 secondes.
create or replace function public.hg_heardle_seconds(p_tries int)
returns int language sql immutable set search_path = public as $$
  select (array[1, 2, 4, 7, 11, 16])[least(greatest(p_tries, 0), 5) + 1] $$;

create or replace function public.hg_heardle_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_heardle_rounds; t hg_heardle_tracks; g hg_daily_games; num int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into r from hg_heardle_rounds where day = d;
  if not found or r.cancelled then
    return jsonb_build_object('day', d, 'round', null, 'cancelled', coalesce(r.cancelled, false),
      'next_day', (select min(day) from hg_heardle_rounds where day > d and not cancelled),
      'board', hg_daily_week_board('heardle'), 'hier', hg_daily_hier('heardle'));
  end if;
  select * into t from hg_heardle_tracks where id = r.track_id;
  select * into g from hg_daily_games where game = 'heardle' and day = d and user_id = auth.uid();
  select count(*) into num from hg_heardle_rounds where day <= d and not cancelled;
  return jsonb_build_object('day', d, 'round', num, 'youtube_id', t.youtube_id, 'start_s', t.start_s,
    'seconds', case when g.finished then 16 else hg_heardle_seconds(cardinality(coalesce(g.guesses, '{}'))) end,
    'steps', jsonb_build_array(1, 2, 4, 7, 11, 16),
    'guesses', coalesce((select jsonb_agg(jsonb_build_object('id', x.gid, 'title', tt.title, 'artist', tt.artist) order by x.i)
      from unnest(coalesce(g.guesses, '{}')) with ordinality x(gid, i) left join hg_heardle_tracks tt on tt.id::text = x.gid), '[]'::jsonb),
    'solved', coalesce(g.solved, false), 'finished', coalesce(g.finished, false), 'score', coalesce(g.score, 0),
    'reward', case when g.finished then hg_daily_reward('heardle', g.solved) else null end,
    'gain', hg_daily_reward('heardle', true), 'consolation', hg_daily_reward('heardle', false),
    'track', case when g.finished then jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist, 'shared_on', t.shared_on,
      'proposed_by', (select p.pseudo from hg_profiles p where p.id = t.proposed_by and not p.is_ghost)) else null end,
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'artist', x.artist) order by x.title)
      from hg_heardle_tracks x where x.status = 'valide'), '[]'::jsonb),
    'board', hg_daily_week_board('heardle'), 'hier', hg_daily_hier('heardle'));
end $$;

create or replace function public.hg_heardle_guess(p_track uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_heardle_rounds;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into r from hg_heardle_rounds where day = d and not cancelled;
  if not found then raise exception 'Pas de Heardle aujourd''hui.'; end if;
  if p_track is not null and not exists (select 1 from hg_heardle_tracks where id = p_track) then raise exception 'Morceau inconnu'; end if;
  perform hg_daily_apply('heardle', d, r.track_id::text, p_track::text);
  return hg_heardle_state();
end $$;

-- Membre : propose un morceau (lien ou identifiant YouTube). 5 propositions par jour au plus. Le Staff valide.
create or replace function public.hg_heardle_propose(p_title text, p_artist text, p_youtube text, p_start int default 0, p_shared_on text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id text; v_new uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  v_id := substring(coalesce(p_youtube, '') from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})');
  if v_id is null and btrim(coalesce(p_youtube, '')) ~ '^[A-Za-z0-9_-]{11}$' then v_id := btrim(p_youtube); end if;
  if v_id is null then raise exception 'Lien YouTube non reconnu'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 or char_length(btrim(coalesce(p_artist, ''))) not between 1 and 120 then
    raise exception 'Titre et artiste : de 1 à 120 caractères';
  end if;
  perform hg_eco_lock(auth.uid());
  if (select count(*) from hg_heardle_tracks where created_by = auth.uid() and created_at >= hg_eco_day_start()) >= 5
     and not hg_has_perm('souvenirs') then
    raise exception 'Limite atteinte : 5 propositions par jour. Réessaie demain.';
  end if;
  insert into hg_heardle_tracks (title, artist, youtube_id, start_s, proposed_by, shared_on, status, created_by)
    values (btrim(p_title), btrim(p_artist), v_id, least(greatest(coalesce(p_start, 0), 0), 36000), auth.uid(),
      nullif(left(btrim(coalesce(p_shared_on, '')), 60), ''), 'propose', auth.uid())
    returning id into v_new;
  return v_new;
end $$;

create or replace function public.hg_heardle_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  return jsonb_build_object('today', hg_jeux_today(),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist, 'youtube_id', t.youtube_id,
        'start_s', t.start_s, 'shared_on', t.shared_on, 'status', t.status, 'proposed_by', t.proposed_by,
        'proposed_pseudo', (select p.pseudo from hg_profiles p where p.id = t.proposed_by),
        'day', (select r.day from hg_heardle_rounds r where r.track_id = t.id)) order by t.status, t.title) from hg_heardle_tracks t), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'track_id', r.track_id, 'title', t.title, 'artist', t.artist,
        'cancelled', r.cancelled, 'players', (select count(*) from hg_daily_games g where g.game = 'heardle' and g.day = r.day)) order by r.day)
      from hg_heardle_rounds r join hg_heardle_tracks t on t.id = r.track_id
      where r.day between hg_jeux_today() - 30 and hg_jeux_today() + 90), '[]'::jsonb));
end $$;

-- Staff « souvenirs » : crée ou modifie un morceau (validation d'une proposition comprise).
-- p = { id?, title, artist, youtube_id, start_s?, shared_on?, status?, proposed_by? }
create or replace function public.hg_heardle_track_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t hg_heardle_tracks; v_new boolean := nullif(p->>'id', '') is null; v_yt text := btrim(coalesce(p->>'youtube_id', ''));
  v_status text := coalesce(p->>'status', 'valide'); v_prop uuid;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  if v_yt !~ '^[A-Za-z0-9_-]{11}$' then
    v_yt := substring(v_yt from '(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})');
    if v_yt is null then raise exception 'Lien YouTube non reconnu'; end if;
  end if;
  if v_status not in ('propose', 'valide', 'retire') then raise exception 'Statut inconnu'; end if;
  if char_length(btrim(coalesce(p->>'title', ''))) not between 1 and 120 or char_length(btrim(coalesce(p->>'artist', ''))) not between 1 and 120 then
    raise exception 'Titre et artiste : de 1 à 120 caractères';
  end if;
  begin v_prop := nullif(p->>'proposed_by', '')::uuid; exception when others then raise exception 'Membre inconnu'; end;
  if v_prop is not null and not exists (select 1 from hg_profiles where id = v_prop) then raise exception 'Membre inconnu'; end if;
  if v_new then
    insert into hg_heardle_tracks (title, artist, youtube_id, start_s, proposed_by, shared_on, status, created_by)
    values (btrim(p->>'title'), btrim(p->>'artist'), v_yt, least(greatest(coalesce((p->>'start_s')::int, 0), 0), 36000), v_prop,
      nullif(left(btrim(coalesce(p->>'shared_on', '')), 60), ''), v_status, auth.uid())
    returning * into t;
  else
    update hg_heardle_tracks set title = btrim(p->>'title'), artist = btrim(p->>'artist'), youtube_id = v_yt,
      start_s = least(greatest(coalesce((p->>'start_s')::int, start_s), 0), 36000),
      proposed_by = case when p ? 'proposed_by' then v_prop else proposed_by end,
      shared_on = case when p ? 'shared_on' then nullif(left(btrim(coalesce(p->>'shared_on', '')), 60), '') else shared_on end,
      status = v_status, updated_at = now()
    where id = (p->>'id')::uuid returning * into t;
    if not found then raise exception 'Morceau inconnu'; end if;
  end if;
  perform hg_admin_audit(case when v_new then 'heardle_morceau_cree' else 'heardle_morceau_modifie' end, t.proposed_by, t.id::text,
    jsonb_build_object('titre', t.title, 'statut', t.status));
  return to_jsonb(t);
end $$;

-- Staff « souvenirs » : programme un morceau validé pour un jour (p_track null = retire), ou annule la manche
-- (vidéo supprimée ou bloquée : p_cancel = true, même le jour même).
create or replace function public.hg_heardle_round_save(p_day date, p_track uuid, p_cancel boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare t hg_heardle_tracks;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »'; end if;
  if p_day is null or p_day < hg_jeux_today() then raise exception 'Choisis aujourd''hui ou un jour à venir'; end if;
  if p_day > hg_jeux_today() + 365 then raise exception 'Un an à l''avance au plus'; end if;
  if coalesce(p_cancel, false) then
    update hg_heardle_rounds set cancelled = true where day = p_day;
    if not found then raise exception 'Pas de manche ce jour-là'; end if;
    perform hg_admin_audit('heardle_manche_annulee', null, p_day::text, '{}'::jsonb);
    return;
  end if;
  if exists (select 1 from hg_daily_games where game = 'heardle' and day = p_day) then
    raise exception 'Des membres ont déjà joué cette manche : elle ne change plus';
  end if;
  if p_track is null then
    execute 'de' || 'lete from public.hg_heardle_rounds where day = $1' using p_day;
  else
    select * into t from hg_heardle_tracks where id = p_track;
    if not found or t.status <> 'valide' then raise exception 'Choisis un morceau validé'; end if;
    if exists (select 1 from hg_heardle_rounds where track_id = p_track and day <> p_day) then
      raise exception 'Ce morceau a déjà sa manche';
    end if;
    insert into hg_heardle_rounds (day, track_id, created_by) values (p_day, p_track, auth.uid())
      on conflict (day) do update set track_id = excluded.track_id, cancelled = false, created_by = excluded.created_by, created_at = now();
  end if;
  perform hg_admin_audit('heardle_manche', null, p_day::text, jsonb_build_object('morceau', t.title));
end $$;


-- Manche de la veille (résumé : numéro, réponse, trouvée par combien, moyenne des essais des gagnants).
create or replace function public.hg_daily_hier(p_game text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when x.ans is null then null else jsonb_build_object('round', x.num, 'title', x.ans,
    'solvers', (select count(*) from hg_daily_games g where g.game = p_game and g.day = x.d and g.solved),
    'avg', (select round(avg(cardinality(g.guesses)), 1) from hg_daily_games g where g.game = p_game and g.day = x.d and g.solved)) end
  from (select hg_jeux_today() - 1 as d,
    case p_game when 'framed' then (select f.title from hg_framed_rounds r join hg_framed_films f on f.id = r.film_id where r.day = hg_jeux_today() - 1)
      else (select t.artist || ' — ' || t.title from hg_heardle_rounds r join hg_heardle_tracks t on t.id = r.track_id where r.day = hg_jeux_today() - 1 and not r.cancelled) end as ans,
    case p_game when 'framed' then (select count(*) from hg_framed_rounds where day <= hg_jeux_today() - 1)
      else (select count(*) from hg_heardle_rounds where day <= hg_jeux_today() - 1 and not cancelled) end as num) x $$;

-- ---------------------------------------------------------------------
-- 4. J11 Quêtes à preuve validées par le Staff
-- ---------------------------------------------------------------------
alter table public.hg_card_quests_templates add column if not exists proof boolean not null default false;
alter table public.hg_card_quests_templates add column if not exists proof_game text;
alter table public.hg_card_quests_templates add column if not exists validator_perm text not null default 'preuves';
do $d$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_card_quests_templates_proof_game_len') then
    alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_proof_game_len check (proof_game is null or char_length(proof_game) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_card_quests_templates_validator_perm_fmt') then
    alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_validator_perm_fmt check (validator_perm ~ '^[a-z_]{2,30}$');
  end if;
end $d$;

-- Métrique « preuve_validee » ajoutée à la liste fermée sans la réécrire (d'autres migrations peuvent l'avoir élargie).
do $d$
declare def text; vals text[];
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'hg_card_quests_templates_metric_check';
  if def is null or def ~ '\mpreuve_validee\M' then return; end if;
  -- Deux écritures possibles : ARRAY['a'::text, …] ou '{a,b,…}'::text[].
  select array_agg(m[1]) into vals from regexp_matches(def, '''([a-z0-9_]+)''::text', 'g') m;
  if vals is null then
    vals := string_to_array(substring(def from '\{([a-z0-9_,]*)\}'), ',');
  end if;
  if vals is null or cardinality(vals) = 0 then raise exception 'Contrainte des métriques illisible : %', def; end if;
  vals := vals || 'preuve_validee'::text;
  execute 'alter table public.hg_card_quests_templates dr' || 'op constraint hg_card_quests_templates_metric_check';
  execute 'alter table public.hg_card_quests_templates add constraint hg_card_quests_templates_metric_check check (metric in ('
    || (select string_agg(quote_literal(v), ', ') from unnest(vals) v) || '))';
end $d$;

-- Le type « à preuve » découle de la métrique (l'éditeur de quêtes de l'admin n'a qu'à choisir l'action).
create or replace function public.hg_quest_template_proof_trg()
returns trigger language plpgsql set search_path = public as $$
begin
  new.proof := (new.metric = 'preuve_validee');
  return new;
end $$;
do $d$ begin execute 'dr' || 'op trigger if exists hg_quest_template_proof on public.hg_card_quests_templates'; end $d$;
create trigger hg_quest_template_proof before insert or update on public.hg_card_quests_templates
  for each row execute function public.hg_quest_template_proof_trg();
revoke execute on function public.hg_quest_template_proof_trg() from public, anon, authenticated;

do $d$ begin execute replace(replace($t$
create table if not exists public.hg_quest_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hg_profiles(id) @CASC,
  quest_code text not null references public.hg_card_quests_templates(code) @CASC on update cascade,
  week date not null,
  paths text[] not null check (cardinality(paths) <= 3),
  note text check (char_length(note) <= 300),
  share boolean not null default false,
  status text not null default 'en_attente' check (status in ('en_attente', 'validee', 'refusee')),
  reviewed_by uuid references public.hg_profiles(id) @SETNULL,
  reviewed_at timestamptz,
  reason text check (char_length(reason) <= 200),
  attempts smallint not null default 1 check (attempts between 1 and 2),
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quest_code, week)
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
create index if not exists hg_quest_proofs_status on public.hg_quest_proofs (status, updated_at);
alter table public.hg_quest_proofs enable row level security;
revoke all on public.hg_quest_proofs from anon, authenticated;

-- Peut-on valider (ou voir) cette preuve ? Permission « preuves » ou celle du modèle de quête.
create or replace function public.hg_proof_can_review(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select hg_has_perm('preuves') or exists (select 1 from hg_card_quests_templates t where t.code = p_code and hg_has_perm(t.validator_perm)) $$;

-- Capture visible par le Staff qui peut valider la preuve correspondante.
create or replace function public.hg_proof_obj_visible(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_quest_proofs q where p_name = any(q.paths) and hg_proof_can_review(q.quest_code)) $$;

-- Bucket privé des captures : chacun dans son dossier ; lecture par l'auteur et le Staff qui valide.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hg-proofs', 'hg-proofs', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;
do $d$
begin
  execute 'dr' || 'op policy if exists hg_proofs_obj_read on storage.objects';
  execute 'dr' || 'op policy if exists hg_proofs_obj_write on storage.objects';
  execute 'dr' || 'op policy if exists hg_proofs_obj_remove on storage.objects';
  create policy hg_proofs_obj_read on storage.objects for select to authenticated
    using (bucket_id = 'hg-proofs' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.hg_proof_obj_visible(name)));
  create policy hg_proofs_obj_write on storage.objects for insert to authenticated
    with check (bucket_id = 'hg-proofs' and public.hg_is_member() and (storage.foldername(name))[1] = (select auth.uid())::text
      and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,60}\.(webp|jpg|png)$');
  execute 'create policy hg_proofs_obj_remove on storage.objects for ' || 'del' || 'ete to authenticated '
    || 'using (bucket_id = ''hg-proofs'' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.hg_has_perm(''preuves'')))';
end $d$;

-- Valeur d'une quête : preuves validées de la semaine pour une quête à preuve, sinon la métrique habituelle.
create or replace function public.hg_quest_value(p_code text, p_metric text, p_proof boolean, p_user uuid, p_start timestamptz, p_end timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_proof then (select count(*)::numeric from hg_quest_proofs q
      where q.user_id = p_user and q.quest_code = p_code and q.status = 'validee' and q.week = hg_quest_week(p_start))
    else hg_challenge_value(p_metric, p_user, p_start, p_end) end $$;

-- Tirage de la semaine (060) : les quêtes à preuve ne sont plus tirées parmi les quêtes habituelles ; elles ont leur
-- propre tirage (réglage cards.quetes_preuve_par_semaine, 2 par défaut, 0 à 5), ajouté aussi à une semaine déjà figée.
create or replace function public.hg_quest_week_ensure(p_week date)
returns void language plpgsql security definer set search_path = public as $$
declare n int := greatest(0, coalesce((hg_card_cfg()->>'quetes_par_semaine')::int, 3));
  np int := least(5, greatest(0, coalesce((hg_card_cfg()->>'quetes_preuve_par_semaine')::int, 2)));
begin
  if not exists (select 1 from hg_quest_week_picks where week = p_week) then
    perform pg_advisory_xact_lock(hashtext('hg_quest_week:' || p_week::text));
    if not exists (select 1 from hg_quest_week_picks where week = p_week) then
      insert into hg_quest_rank_snapshot (week, user_id, rnk)
        select p_week, r.user_id, r.rnk from hg_card_ranks() r
        on conflict (week, user_id) do nothing;
      insert into hg_quest_week_picks (week, code)
        select p_week, t.code from hg_card_quests_templates t
        where t.active and not t.proof and hg_quest_metric_available(t.metric, p_week)
        order by md5(p_week::text || t.code), t.code
        limit n
        on conflict do nothing;
    end if;
  end if;
  if np > 0 and p_week >= hg_quest_week()
     and not exists (select 1 from hg_quest_week_picks w join hg_card_quests_templates t on t.code = w.code where w.week = p_week and t.proof)
     and exists (select 1 from hg_card_quests_templates where active and proof) then
    perform pg_advisory_xact_lock(hashtext('hg_quest_week_proof:' || p_week::text));
    if not exists (select 1 from hg_quest_week_picks w join hg_card_quests_templates t on t.code = w.code where w.week = p_week and t.proof) then
      insert into hg_quest_week_picks (week, code)
        select p_week, t.code from hg_card_quests_templates t
        where t.active and t.proof
        order by md5('preuve:' || p_week::text || t.code), t.code
        limit np
        on conflict do nothing;
    end if;
  end if;
end $$;
revoke execute on function public.hg_quest_week_ensure(date) from public, anon, authenticated;

-- Progression du membre (060) + champs des quêtes à preuve (proof, proof_game, proof_status, proof_reason,
-- proof_attempts). Même signature et mêmes champs qu'avant.
create or replace function public.hg_card_quests_me()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare wk date := hg_quest_week();
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
            where l.user_id = auth.uid() and l.reason = 'quete' and l.ref = 'quete:' || wk::text || ':' || t.code),
          'proof', t.proof, 'proof_game', t.proof_game,
          'proof_status', pr.status, 'proof_reason', pr.reason, 'proof_attempts', coalesce(pr.attempts, 0))
        order by t.proof, t.sort, t.code)
      from hg_card_quests_pick(wk) t
      cross join lateral (select hg_quest_value(t.code, t.metric, t.proof, auth.uid(), ws, least(we, now())) as value) v
      left join hg_quest_proofs pr on pr.user_id = auth.uid() and pr.quest_code = t.code and pr.week = wk
    ), '[]'::jsonb));
end $$;

create or replace function public.hg_card_quest_claim(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wk date := hg_quest_week();
  ws timestamptz := (wk::timestamp) at time zone 'Europe/Zurich';
  we timestamptz := ((wk + 7)::timestamp) at time zone 'Europe/Zurich';
  q hg_card_quests_templates; v numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select t.* into q from hg_card_quests_pick(wk) t where t.code = p_code;
  if not found then raise exception 'Cette quête ne fait pas partie des quêtes de la semaine'; end if;
  v := hg_quest_value(q.code, q.metric, q.proof, auth.uid(), ws, least(we, now()));
  if v < q.target then raise exception 'Quête pas encore terminée (% sur %)', v, q.target; end if;
  if not hg_wallet_add(auth.uid(), q.reward, 'quete', 'quete:' || wk::text || ':' || q.code) then
    raise exception 'Cette quête a déjà été récompensée cette semaine';
  end if;
  return jsonb_build_object('code', q.code, 'reward', q.reward);
end $$;

-- Membre : envoie (ou renvoie après un refus, une fois) la preuve d'une quête à preuve de la semaine.
-- p_paths : 1 à 3 captures déjà envoyées dans hg-proofs/<moi>/… ; p_note : 300 caractères au plus.
create or replace function public.hg_proof_submit(p_quest text, p_paths text[], p_note text default null, p_share boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); wk date := hg_quest_week(); q hg_card_quests_templates; pr hg_quest_proofs; x text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select t.* into q from hg_card_quests_pick(wk) t where t.code = p_quest;
  if not found or not q.proof then raise exception 'Cette quête à preuve ne fait pas partie des quêtes de la semaine'; end if;
  if coalesce(cardinality(p_paths), 0) not between 1 and 3 then raise exception 'Joins de 1 à 3 captures'; end if;
  if (select count(distinct e) from unnest(p_paths) e) <> cardinality(p_paths) then raise exception 'Capture en double'; end if;
  if char_length(v_note) > 300 then raise exception 'Ton mot fait 300 caractères au plus'; end if;
  foreach x in array p_paths loop
    if x !~ ('^' || me::text || '/[A-Za-z0-9_-]{1,60}\.(webp|jpg|png)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'hg-proofs' and o.name = x) then
      raise exception 'Capture introuvable : envoie-la d''abord';
    end if;
  end loop;
  perform hg_eco_lock(me);
  select * into pr from hg_quest_proofs where user_id = me and quest_code = q.code and week = wk for update;
  if found then
    if pr.status = 'validee' then raise exception 'Ta preuve est déjà validée'; end if;
    if pr.status = 'en_attente' then raise exception 'Ta preuve attend déjà la validation du Staff'; end if;
    if pr.attempts >= 2 then raise exception 'Tu as déjà utilisé tes 2 tentatives pour cette quête'; end if;
    update hg_quest_proofs set paths = p_paths, note = v_note, share = coalesce(p_share, false), status = 'en_attente',
      reviewed_by = null, reviewed_at = null, reason = null, attempts = attempts + 1, updated_at = now()
      where id = pr.id returning * into pr;
  else
    insert into hg_quest_proofs (user_id, quest_code, week, paths, note, share)
      values (me, q.code, wk, p_paths, v_note, coalesce(p_share, false)) returning * into pr;
  end if;
  return jsonb_build_object('id', pr.id, 'status', pr.status, 'attempts', pr.attempts);
end $$;

-- Staff : file des preuves (en attente, validées ou refusées), celles que la personne peut valider.
create or replace function public.hg_proof_queue(p_status text default 'en_attente')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_status not in ('en_attente', 'validee', 'refusee') then raise exception 'Statut inconnu'; end if;
  if not (hg_has_perm('preuves') or exists (select 1 from hg_card_quests_templates t where t.proof and hg_has_perm(t.validator_perm))) then
    raise exception 'Réservé au Staff « preuves »';
  end if;
  return jsonb_build_object('me', auth.uid(),
    'counts', (select jsonb_object_agg(s, (select count(*) from hg_quest_proofs q where q.status = s and hg_proof_can_review(q.quest_code)))
      from unnest(array['en_attente', 'validee', 'refusee']) s),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'user_id', q.user_id, 'pseudo', p.pseudo, 'color', p.color, 'avatar_url', p.avatar_url,
        'quest_code', q.quest_code, 'label', t.label, 'game', t.proof_game, 'reward', t.reward, 'week', q.week,
        'paths', to_jsonb(q.paths), 'note', q.note, 'share', q.share, 'status', q.status, 'attempts', q.attempts,
        'reason', q.reason, 'reviewed_at', q.reviewed_at, 'reviewer', (select r.pseudo from hg_profiles r where r.id = q.reviewed_by),
        'created_at', q.created_at, 'updated_at', q.updated_at, 'own', q.user_id = auth.uid(), 'purged', q.purged_at is not null)
        order by case when p_status = 'en_attente' then q.updated_at end asc, q.updated_at desc)
      from hg_quest_proofs q join hg_profiles p on p.id = q.user_id join hg_card_quests_templates t on t.code = q.quest_code
      where q.status = p_status and hg_proof_can_review(q.quest_code)
        and (p_status = 'en_attente' or q.updated_at > now() - interval '60 days')), '[]'::jsonb));
end $$;

-- Staff : valide (verse la récompense de la quête, une fois) ou refuse avec un motif. Jamais sa propre preuve.
create or replace function public.hg_proof_review(p_id uuid, p_ok boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr hg_quest_proofs; t hg_card_quests_templates; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); paid boolean := false;
begin
  select * into pr from hg_quest_proofs where id = p_id for update;
  if not found then raise exception 'Preuve introuvable'; end if;
  if not hg_proof_can_review(pr.quest_code) then raise exception 'Réservé au Staff « preuves »'; end if;
  if pr.user_id = auth.uid() then raise exception 'Tu ne peux pas valider ta propre preuve'; end if;
  if pr.status <> 'en_attente' then raise exception 'Cette preuve a déjà été traitée'; end if;
  select * into t from hg_card_quests_templates where code = pr.quest_code;
  if p_ok then
    update hg_quest_proofs set status = 'validee', reviewed_by = auth.uid(), reviewed_at = now(), reason = null, updated_at = now() where id = p_id;
    paid := hg_wallet_add(pr.user_id, t.reward, 'quete', 'quete:' || pr.week::text || ':' || pr.quest_code);
    if pr.share then
      insert into hg_activity (user_id, kind, text)
        select pr.user_id, 'preuve', p.pseudo || ' a validé « ' || t.label || ' »' from hg_profiles p where p.id = pr.user_id;
    end if;
  else
    if v_reason is null or char_length(v_reason) > 200 then raise exception 'Indique un motif (200 caractères au plus)'; end if;
    update hg_quest_proofs set status = 'refusee', reviewed_by = auth.uid(), reviewed_at = now(), reason = v_reason, updated_at = now() where id = p_id;
  end if;
  perform hg_admin_audit(case when p_ok then 'preuve_validee' else 'preuve_refusee' end, pr.user_id, pr.id::text,
    jsonb_build_object('quete', t.label, 'motif', v_reason, 'paye', paid));
  return jsonb_build_object('id', p_id, 'status', case when p_ok then 'validee' else 'refusee' end, 'paid', paid);
end $$;

-- Nettoyage (vie privée) : captures des preuves traitées depuis plus de 60 jours. Le Staff « preuves » obtient la liste,
-- supprime les fichiers par l'API de stockage, puis marque les preuves nettoyées.
create or replace function public.hg_proofs_purge_due()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('preuves') then raise exception 'Réservé au Staff « preuves »'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'paths', to_jsonb(q.paths)))
    from hg_quest_proofs q where q.purged_at is null and q.status <> 'en_attente' and q.updated_at < now() - interval '60 days'
      and cardinality(q.paths) > 0), '[]'::jsonb);
end $$;
create or replace function public.hg_proofs_mark_purged(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not hg_has_perm('preuves') then raise exception 'Réservé au Staff « preuves »'; end if;
  update hg_quest_proofs set paths = '{}', purged_at = now()
    where id = any(p_ids) and purged_at is null and status <> 'en_attente' and updated_at < now() - interval '60 days';
  get diagnostics n = row_count;
  if n > 0 then perform hg_admin_audit('preuves_nettoyees', null, null, jsonb_build_object('nombre', n)); end if;
  return n;
end $$;

-- Les 6 quêtes à preuve de départ.
insert into public.hg_card_quests_templates (code, label, metric, target, reward, sort, proof_game) values
  ('p_aoe_classee',    'Gagne une partie classée d''Age of Empires 2',           'preuve_validee', 1, 400, 301, 'Age of Empires 2'),
  ('p_mc_ferme',       'Construis une ferme automatique sur le serveur Minecraft', 'preuve_validee', 1, 400, 302, 'Minecraft'),
  ('p_worldle_1',      'Termine un Worldle en 1/6',                              'preuve_validee', 1, 300, 303, 'Worldle'),
  ('p_satisfactory',   'Montre ta plus belle base Satisfactory',                 'preuve_validee', 1, 300, 304, 'Satisfactory'),
  ('p_ck3_couronne',   'Fais-toi couronner dans la campagne CK3',                'preuve_validee', 1, 400, 305, 'Crusader Kings 3'),
  ('p_lol_victoire',   'Gagne une partie de LoL avec le gang',                   'preuve_validee', 1, 300, 306, 'League of Legends')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 5. J15 Bataille de cartes
-- ---------------------------------------------------------------------
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_battle_decks (
  user_id uuid primary key references public.hg_profiles(id) @CASC,
  copy_ids bigint[] not null check (cardinality(copy_ids) = 5),
  updated_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
do $d$ begin execute replace(replace($t$
create table if not exists public.hg_battles (
  id uuid primary key default gen_random_uuid(),
  attacker_id uuid not null references public.hg_profiles(id) @CASC,
  defender_id uuid not null references public.hg_profiles(id) @CASC,
  attack jsonb not null,
  defense jsonb not null,
  duels jsonb not null,
  wins_a smallint not null,
  wins_d smallint not null,
  result text not null check (result in ('victoire', 'defaite', 'egalite')),
  paid_a int not null default 0,
  paid_d int not null default 0,
  seen_at timestamptz,
  created_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;
create index if not exists hg_battles_attacker on public.hg_battles (attacker_id, created_at desc);
create index if not exists hg_battles_defender on public.hg_battles (defender_id, created_at desc);
alter table public.hg_battle_decks enable row level security;
alter table public.hg_battles enable row level security;
revoke all on public.hg_battle_decks, public.hg_battles from anon, authenticated;

-- Réglages : cards.bataille = { actif (vrai par défaut), gains (faux par défaut : bêta sans Paillettes) } ;
-- montants et plafonds dans cards.plafonds (hg_eco_cap) : bataille_gain 10, defense_gain 5, batailles_jour 3,
-- defenses_jour 3, bataille_meme_adversaire 2, batailles_max_jour 20.
create or replace function public.hg_battle_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'actif', coalesce((hg_card_cfg()#>>'{bataille,actif}')::boolean, true),
    'gains', coalesce((hg_card_cfg()#>>'{bataille,gains}')::boolean, false),
    'gain', least(100, hg_eco_cap('bataille_gain', 10)), 'defense_gain', least(100, hg_eco_cap('defense_gain', 5)),
    'cap_jour', least(20, hg_eco_cap('batailles_jour', 3)), 'cap_defense', least(20, hg_eco_cap('defenses_jour', 3)),
    'meme_adversaire', least(10, greatest(1, hg_eco_cap('bataille_meme_adversaire', 2))),
    'max_jour', least(100, greatest(1, hg_eco_cap('batailles_max_jour', 20)))) $$;

-- Puissance de base d'une rareté : commune 1 → mythique 6 ; identité et unique 6.
create or replace function public.hg_battle_rank(p_rarity text)
returns int language sql immutable set search_path = public as $$
  select coalesce(array_position(array['commune','peu_commune','rare','epique','legendaire','mythique'], p_rarity),
    case when p_rarity in ('identite', 'unique') then 6 else 1 end) $$;

-- Avantage de famille : membre bat objet, objet bat lieu, lieu bat moment, moment bat membre.
create or replace function public.hg_battle_beats(a text, b text)
returns boolean language sql immutable set search_path = public as $$
  select (a, b) in (('membre', 'objet'), ('objet', 'lieu'), ('lieu', 'moment'), ('moment', 'membre')) $$;

-- Instantané d'une main de 5 cartes d'un membre, dans l'ordre, après contrôle : copies distinctes, possédées, non
-- recyclées, hors échange en cours, une seule carte de puissance 6 (mythique, identité ou unique).
create or replace function public.hg_battle_hand(p_user uuid, p_copies bigint[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h jsonb;
begin
  if coalesce(cardinality(p_copies), 0) <> 5 then raise exception 'Choisis exactement 5 cartes'; end if;
  if (select count(distinct c) from unnest(p_copies) c) <> 5 then raise exception 'Une même carte ne peut pas servir deux fois'; end if;
  select jsonb_agg(jsonb_build_object('copy_id', x.id, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
      'shiny', x.shiny, 'image_url', k.image_url, 'number', k.number, 'power', hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end)
      order by a.i) into h
    from unnest(p_copies) with ordinality a(cid, i)
    join hg_card_copies x on x.id = a.cid and x.owner_id = p_user and x.recycled_at is null and x.locked_trade is null
    join hg_cards k on k.id = x.card_id;
  if coalesce(jsonb_array_length(h), 0) <> 5 then raise exception 'Une des cartes n''est pas (ou plus) disponible dans la collection'; end if;
  if (select count(*) from jsonb_array_elements(h) e where hg_battle_rank(e->>'rarity') >= 6) > 1 then
    raise exception 'Une seule carte mythique, identité ou unique par main';
  end if;
  return h;
end $$;

-- Membre : enregistre son deck de défense.
create or replace function public.hg_battle_set_deck(p_copies bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare h jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if (select is_ghost from hg_profiles where id = auth.uid()) then raise exception 'Réservé aux membres'; end if;
  h := hg_battle_hand(auth.uid(), p_copies);
  insert into hg_battle_decks (user_id, copy_ids) values (auth.uid(), p_copies)
    on conflict (user_id) do update set copy_ids = excluded.copy_ids, updated_at = now();
  return h;
end $$;

-- Une bataille vue par un membre (sens attaquant / défenseur).
create or replace function public.hg_battle_view(b hg_battles, p_me uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'created_at', b.created_at, 'role', case when b.attacker_id = p_me then 'attaque' else 'defense' end,
    'attacker', jsonb_build_object('id', b.attacker_id, 'pseudo', pa.pseudo, 'color', pa.color),
    'defender', jsonb_build_object('id', b.defender_id, 'pseudo', pd.pseudo, 'color', pd.color),
    'attack', b.attack, 'defense', b.defense, 'duels', b.duels, 'wins_a', b.wins_a, 'wins_d', b.wins_d, 'result', b.result,
    'paid', case when b.attacker_id = p_me then b.paid_a else b.paid_d end, 'seen', b.seen_at is not null)
  from hg_profiles pa, hg_profiles pd where pa.id = b.attacker_id and pd.id = b.defender_id $$;

-- Membre : attaque le deck de défense d'un membre avec 5 cartes. Résolu tout de suite, côté serveur, sans aléa.
create or replace function public.hg_battle_attack(p_defender uuid, p_copies bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg jsonb := hg_battle_cfg(); d0 timestamptz := hg_eco_day_start();
  ha jsonb; hd jsonb; dk hg_battle_decks; duels jsonb := '[]'::jsonb; i int; a jsonb; d jsonb; pa int; pd int; adv text;
  wa int := 0; wd int := 0; res text; b hg_battles; ga int := 0; gd int := 0;
begin
  if not hg_is_member() or (select is_ghost from hg_profiles where id = me) then raise exception 'Réservé aux membres'; end if;
  if not (cfg->>'actif')::boolean then raise exception 'La Bataille de cartes est en pause'; end if;
  if p_defender is null or p_defender = me then raise exception 'Choisis un autre membre'; end if;
  if not exists (select 1 from hg_profiles where id = p_defender and not is_ghost) then raise exception 'Membre inconnu'; end if;
  perform hg_eco_lock(me);
  if (select count(*) from hg_battles where attacker_id = me and created_at >= d0) >= (cfg->>'max_jour')::int then
    raise exception 'Assez de batailles pour aujourd''hui (% au plus). Reviens demain !', cfg->>'max_jour';
  end if;
  if (select count(*) from hg_battles where attacker_id = me and defender_id = p_defender and created_at >= d0) >= (cfg->>'meme_adversaire')::int then
    raise exception 'Tu as déjà attaqué ce membre % fois aujourd''hui', cfg->>'meme_adversaire';
  end if;
  select * into dk from hg_battle_decks where user_id = p_defender;
  if not found then raise exception 'Ce membre n''a pas encore de deck de défense'; end if;
  begin hd := hg_battle_hand(p_defender, dk.copy_ids);
  exception when others then raise exception 'Le deck de défense de ce membre n''est plus complet'; end;
  ha := hg_battle_hand(me, p_copies);
  for i in 0..4 loop
    a := ha->i; d := hd->i;
    pa := (a->>'power')::int; pd := (d->>'power')::int; adv := null;
    if hg_battle_beats(a->>'family', d->>'family') then pa := pa + 2; adv := 'a';
    elsif hg_battle_beats(d->>'family', a->>'family') then pd := pd + 2; adv := 'd'; end if;
    if pa > pd then wa := wa + 1; elsif pd > pa then wd := wd + 1; end if;
    duels := duels || jsonb_build_object('a', pa, 'd', pd, 'adv', adv, 'win', case when pa > pd then 'a' when pd > pa then 'd' else 'nul' end);
  end loop;
  res := case when wa > wd then 'victoire' when wd > wa then 'defaite' else 'egalite' end;
  insert into hg_battles (attacker_id, defender_id, attack, defense, duels, wins_a, wins_d, result)
    values (me, p_defender, ha, hd, duels, wa, wd, res) returning * into b;
  if (cfg->>'gains')::boolean then
    if res = 'victoire' and hg_eco_count(me, 'bataille', d0) < (cfg->>'cap_jour')::int then
      if hg_wallet_add(me, (cfg->>'gain')::int, 'bataille', 'bataille:' || b.id) then ga := (cfg->>'gain')::int; end if;
    elsif res = 'defaite' then
      perform hg_eco_lock(p_defender);
      if hg_eco_count(p_defender, 'bataille_def', d0) < (cfg->>'cap_defense')::int then
        if hg_wallet_add(p_defender, (cfg->>'defense_gain')::int, 'bataille_def', 'bataille_def:' || b.id) then gd := (cfg->>'defense_gain')::int; end if;
      end if;
    end if;
    update hg_battles set paid_a = ga, paid_d = gd where id = b.id returning * into b;
  end if;
  return hg_battle_view(b, me);
end $$;

-- Membre : tout l'écran Bataille (réglages, deck, cartes disponibles, adversaires, historique).
create or replace function public.hg_battle_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d0 timestamptz := hg_eco_day_start(); dk hg_battle_decks; deck jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into dk from hg_battle_decks where user_id = me;
  if found then begin deck := hg_battle_hand(me, dk.copy_ids); exception when others then deck := null; end; end if;
  return jsonb_build_object('cfg', hg_battle_cfg(),
    'paid_today', hg_eco_count(me, 'bataille', d0), 'defenses_today', hg_eco_count(me, 'bataille_def', d0),
    'deck', deck, 'deck_ids', to_jsonb(dk.copy_ids),
    'copies', coalesce((select jsonb_agg(jsonb_build_object('copy_id', x.id, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity,
        'family', k.family, 'shiny', x.shiny, 'image_url', k.image_url, 'number', k.number,
        'power', hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end)
        order by hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end desc, k.name, x.id)
      from hg_card_copies x join hg_cards k on k.id = x.card_id
      where x.owner_id = me and x.recycled_at is null and x.locked_trade is null), '[]'::jsonb),
    'opponents', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'color', p.color, 'avatar_url', p.avatar_url,
        'has_deck', exists (select 1 from hg_battle_decks z where z.user_id = p.id),
        'attacks_today', (select count(*) from hg_battles b where b.attacker_id = me and b.defender_id = p.id and b.created_at >= d0))
        order by p.pseudo)
      from hg_profiles p where p.id <> me and not p.is_ghost), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(hg_battle_view(b, me) order by b.created_at desc)
      from (select * from hg_battles where attacker_id = me or defender_id = me order by created_at desc limit 20) b), '[]'::jsonb),
    'unseen', (select count(*) from hg_battles where defender_id = me and seen_at is null));
end $$;

-- Membre : marque comme vues les attaques reçues.
create or replace function public.hg_battle_seen()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  update hg_battles set seen_at = now() where defender_id = auth.uid() and seen_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Staff « cartes » : réglages de la Bataille (activation, gains, montants et plafonds bornés), journalisés.
create or replace function public.hg_battle_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'cards'), '{}'::jsonb); k text;
  lim jsonb := '{"bataille_gain":[0,100],"defense_gain":[0,100],"batailles_jour":[0,20],"defenses_jour":[0,20],"bataille_meme_adversaire":[1,10],"batailles_max_jour":[1,100]}';
  before jsonb := hg_battle_cfg(); n int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if p ? 'actif' then v := jsonb_set(v, '{bataille}', coalesce(v->'bataille', '{}') || jsonb_build_object('actif', (p->>'actif')::boolean)); end if;
  if p ? 'gains' then v := jsonb_set(v, '{bataille}', coalesce(v->'bataille', '{}') || jsonb_build_object('gains', (p->>'gains')::boolean)); end if;
  for k in select jsonb_object_keys(lim) loop
    if p ? k then
      if (p->>k) !~ '^\d{1,6}$' then raise exception 'Valeur invalide pour %', k; end if;
      n := (p->>k)::int;
      if n < (lim->k->>0)::int or n > (lim->k->>1)::int then
        raise exception 'Valeur hors limites pour % (de % à %)', k, lim->k->>0, lim->k->>1;
      end if;
      v := jsonb_set(v, '{plafonds}', coalesce(v->'plafonds', '{}') || jsonb_build_object(k, n::text));
    end if;
  end loop;
  insert into hg_settings (key, value) values ('cards', v) on conflict (key) do update set value = excluded.value;
  perform hg_admin_audit('bataille_reglages', null, null, jsonb_build_object('avant', before, 'apres', hg_battle_cfg()));
  return hg_battle_cfg();
end $$;

-- ---------------------------------------------------------------------
-- 6. Droits d'exécution
-- ---------------------------------------------------------------------
do $d$
declare f text;
begin
  -- Fonctions internes : jamais appelées par un client.
  foreach f in array array[
    'hg_daily_reward(text, boolean)', 'hg_daily_apply(text, date, text, text)', 'hg_daily_week_board(text)',
    'hg_framed_unlocked(date, uuid, integer)', 'hg_quest_value(text, text, boolean, uuid, timestamptz, timestamptz)',
    'hg_battle_cfg()', 'hg_battle_hand(uuid, bigint[])', 'hg_battle_view(hg_battles, uuid)', 'hg_heardle_seconds(integer)',
    'hg_battle_rank(text)', 'hg_battle_beats(text, text)', 'hg_daily_hier(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Utilisées par les politiques de stockage : appelables par les membres connectés (lecture seule, sans donnée renvoyée).
  foreach f in array array['hg_jeux_obj_visible(text)', 'hg_proof_obj_visible(text)', 'hg_proof_can_review(text)', 'hg_jeux_today()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- RPC des membres et du Staff (les droits Staff sont contrôlés dans chaque fonction).
  foreach f in array array[
    'hg_framed_state()', 'hg_framed_guess(uuid)', 'hg_framed_admin()', 'hg_framed_film_save(jsonb)', 'hg_framed_round_save(date, uuid)',
    'hg_heardle_state()', 'hg_heardle_guess(uuid)', 'hg_heardle_propose(text, text, text, integer, text)', 'hg_heardle_admin()',
    'hg_heardle_track_save(jsonb)', 'hg_heardle_round_save(date, uuid, boolean)',
    'hg_card_quests_me()', 'hg_card_quest_claim(text)', 'hg_proof_submit(text, text[], text, boolean)', 'hg_proof_queue(text)',
    'hg_proof_review(uuid, boolean, text)', 'hg_proofs_purge_due()', 'hg_proofs_mark_purged(uuid[])',
    'hg_battle_set_deck(bigint[])', 'hg_battle_attack(uuid, bigint[])', 'hg_battle_me()', 'hg_battle_seen()',
    'hg_battle_settings_save(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $d$;
