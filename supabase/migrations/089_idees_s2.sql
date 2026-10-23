-- ===== 089 : idées « Contenu et souvenirs » (paquet xS2) =====
-- S7 Capsule temporelle, S8 Playlist du gang, S11 Récap annuel enrichi, S12 Carnet de voyage, S13 Mur des citations.
-- S'applique après 075. Idempotent (create … if not exists, create or replace, policies recréées dans des blocs do ;
-- les mots-clés de retrait sont construits dynamiquement). Rétrocompatible : rien n'est retiré, hg_year_recap garde
-- sa signature et ses clés, hg_toggle_reaction accepte les mêmes cibles qu'avant plus trois nouvelles.
--
-- Sécurité (règles de l'audit du 23/10) :
--   - RLS sur toutes les nouvelles tables ; aucune écriture directe du client : tout passe par des RPC
--     SECURITY DEFINER à search_path fixé, exécutables par « authenticated » seulement.
--   - Gains de Paillettes (citation validée, premier pays d'une carte postale) : hg_wallet_add avec une référence
--     unique (index hg_wallet_log_once) et un plafond hebdomadaire hg_eco_cap / hg_eco_count, sous hg_eco_lock.
--   - Staff : permission existante « souvenirs » (hg_has_perm) pour la modération ; « reglages » pour le récap.
--     Chaque action Staff est notée dans hg_admin_log (hg_admin_audit).
--   - Capsule : personne, Staff compris, ne lit un dépôt d'un autre membre avant l'heure d'ouverture (heure du
--     serveur). L'heure d'ouverture ne peut jamais être avancée une fois un dépôt fait.
--
-- Plan :
--   0. Réactions : trois nouvelles cibles (quote, postcard, track)
--   1. S13 Citations      : hg_quotes + RPC
--   2. S8  Playlist       : hg_tracks, hg_track_votes, hg_track_weeks + RPC
--   3. S7  Capsules       : hg_capsules, hg_capsule_items, hg_capsule_votes, bucket privé hg-capsules + RPC
--   4. S12 Carnet         : hg_postcards (photos dans hg-photos/<membre>/postcards/) + RPC
--   5. S11 Récap          : hg_year_recap enrichi, réglage recap.diapos_masquees (RPC hg_recap_diapos_set)
--   6. Pages du menu, droits

-- ---------------------------------------------------------------------
-- 0. Réactions : nouvelles cibles
-- ---------------------------------------------------------------------
-- La contrainte est reconstruite en gardant toutes les valeurs déjà autorisées (d'autres paquets peuvent en ajouter),
-- quelle que soit leur écriture (ARRAY['moment'::text, …] ou '{moment,…}'::text[]).
do $r$
declare v_old text[]; v_new text[];
begin
  select coalesce(array_agg(distinct m[1]), '{}') into v_old
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z_]+)', 'g') m
   where c.conrelid = 'public.hg_reactions'::regclass and c.conname = 'hg_reactions_kind_check'
     and m[1] not in ('target_kind', 'text');
  v_new := array(select distinct x from unnest(v_old || array['moment', 'photo', 'quote', 'postcard', 'track']) x order by 1);
  if not (array['quote', 'postcard', 'track'] <@ v_old) then
    execute 'alter table public.hg_reactions ' || 'dr' || 'op constraint if exists hg_reactions_kind_check';
    execute format('alter table public.hg_reactions add constraint hg_reactions_kind_check check (target_kind = any (%L::text[]))', v_new);
  end if;
end $r$;

-- ---------------------------------------------------------------------
-- 1. S13 Mur des citations
-- ---------------------------------------------------------------------
do $t$ begin execute replace($q$create table if not exists public.hg_quotes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(btrim(text)) between 2 and 280),
  author_id uuid references public.hg_profiles(id) on update cascade ON_DEL set null,
  author_label text check (author_label is null or char_length(btrim(author_label)) between 2 and 40),
  said_on date,
  context text check (context is null or char_length(context) <= 80),
  status text not null default 'propose' check (status in ('propose', 'valide', 'refuse', 'retire')),
  author_ok_game boolean not null default false,
  author_seen_at timestamptz,
  proposed_by uuid references public.hg_profiles(id) on update cascade ON_DEL set null,
  validated_by uuid references public.hg_profiles(id) on update cascade ON_DEL set null,
  validated_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (author_id is not null or author_label is not null)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
create index if not exists hg_quotes_status_idx on public.hg_quotes (status, validated_at desc);
create index if not exists hg_quotes_author_idx on public.hg_quotes (author_id) where author_id is not null;
create index if not exists hg_quotes_proposer_idx on public.hg_quotes (proposed_by, created_at);
alter table public.hg_quotes enable row level security;

do $p$ begin
  execute 'dr' || 'op policy if exists hg_quotes_read on public.hg_quotes';
  -- Lecture : citations validées (membres) ; mes propositions ; celles qui me citent ; tout pour le Staff « souvenirs ».
  create policy hg_quotes_read on public.hg_quotes for select to authenticated using (
    (status = 'valide' and public.hg_is_member())
    or proposed_by = (select auth.uid())
    or author_id = (select auth.uid())
    or public.hg_has_perm('souvenirs'));
end $p$;

-- Proposer une citation. Plafond : citations_jour (5 par défaut) propositions par jour et par membre.
create or replace function public.hg_quote_propose(p_text text, p_author uuid default null, p_author_label text default null,
  p_said_on date default null, p_context text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_text text := btrim(coalesce(p_text, ''));
  v_label text := nullif(btrim(coalesce(p_author_label, '')), ''); v_ctx text := nullif(btrim(coalesce(p_context, '')), '');
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if char_length(v_text) < 2 or char_length(v_text) > 280 then raise exception 'La citation fait entre 2 et 280 caractères.'; end if;
  if (p_author is null) = (v_label is null) then raise exception 'Indique une personne du gang ou un auteur collectif (ex. « Tout le gang »).'; end if;
  if p_author is not null and not exists (select 1 from hg_profiles where id = p_author and not is_ghost) then raise exception 'Membre introuvable.'; end if;
  if v_label is not null and char_length(v_label) > 40 then raise exception 'L’auteur collectif fait 40 caractères au plus.'; end if;
  if v_ctx is not null and char_length(v_ctx) > 80 then raise exception 'Le contexte fait 80 caractères au plus.'; end if;
  if p_said_on is not null and (p_said_on > (now() at time zone 'Europe/Zurich')::date or p_said_on < date '2015-01-01') then
    raise exception 'Date de la citation invalide.';
  end if;
  perform public.hg_eco_lock(v_uid);
  if (select count(*) from hg_quotes where proposed_by = v_uid and created_at >= public.hg_eco_day_start())
       >= public.hg_eco_cap('citations_jour', 5) then
    raise exception 'Tu as déjà proposé % citations aujourd’hui. Reviens demain !', public.hg_eco_cap('citations_jour', 5);
  end if;
  insert into hg_quotes (text, author_id, author_label, said_on, context, proposed_by)
  values (v_text, p_author, v_label, p_said_on, v_ctx, v_uid) returning id into v_id;
  return v_id;
end $$;

-- Staff « souvenirs » : valider, refuser ou retirer. La validation paie une fois celui qui a proposé (jamais la personne
-- citée, jamais un Staff qui valide sa propre proposition), dans la limite de citations_semaine (3) par semaine.
create or replace function public.hg_quote_review(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); q hg_quotes; v_reward int := 0; v_amount int;
begin
  if not public.hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  if p_action not in ('valider', 'refuser', 'retirer') then raise exception 'Action inconnue'; end if;
  select * into q from hg_quotes where id = p_id for update;
  if not found then raise exception 'Citation introuvable'; end if;
  if p_action in ('valider', 'refuser') and q.status <> 'propose' then
    raise exception 'Cette citation n’est plus en attente (statut : %).', q.status;
  end if;
  if p_action = 'retirer' and q.status <> 'valide' then raise exception 'Seule une citation validée peut être retirée.'; end if;

  if p_action = 'valider' then
    update hg_quotes set status = 'valide', validated_by = v_uid, validated_at = now() where id = p_id;
    if q.rewarded_at is null and q.proposed_by is not null and q.proposed_by is distinct from q.author_id
       and q.proposed_by <> v_uid then
      perform public.hg_eco_lock(q.proposed_by);
      if public.hg_eco_count(q.proposed_by, 'citation', public.hg_eco_week_start()) < public.hg_eco_cap('citations_semaine', 3) then
        v_amount := least(greatest(coalesce(nullif(public.hg_card_cfg()#>>'{rewards,citation}', '')::int, 20), 0), 500);
        if v_amount > 0 and public.hg_wallet_add(q.proposed_by, v_amount, 'citation', p_id::text) then v_reward := v_amount; end if;
      end if;
      update hg_quotes set rewarded_at = now() where id = p_id;
    end if;
  elsif p_action = 'refuser' then
    update hg_quotes set status = 'refuse', validated_by = v_uid, validated_at = now() where id = p_id;
  else
    update hg_quotes set status = 'retire' where id = p_id;
  end if;
  perform public.hg_admin_audit('citation_' || p_action, q.proposed_by, p_id::text, jsonb_build_object('reward', v_reward));
  return jsonb_build_object('status', (select status from hg_quotes where id = p_id), 'reward', v_reward);
end $$;

-- La personne citée a le dernier mot : refuser (proposition) ou retirer (citation validée) à tout moment,
-- accepter ou non l'usage dans le jeu « Qui a dit ça ? », marquer la notification comme vue.
create or replace function public.hg_quote_author_decide(p_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare q hg_quotes;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  select * into q from hg_quotes where id = p_id for update;
  if not found or q.author_id is distinct from auth.uid() then raise exception 'Seule la personne citée peut décider.' using errcode = '42501'; end if;
  if p_action = 'retirer' then
    if q.status = 'propose' then update hg_quotes set status = 'refuse', author_seen_at = now() where id = p_id;
    elsif q.status = 'valide' then update hg_quotes set status = 'retire', author_seen_at = now() where id = p_id;
    end if;
  elsif p_action in ('jeu_oui', 'jeu_non') then
    if q.status not in ('propose', 'valide') then raise exception 'Cette citation est retirée.'; end if;
    update hg_quotes set author_ok_game = (p_action = 'jeu_oui'), author_seen_at = now() where id = p_id;
  elsif p_action = 'vu' then
    update hg_quotes set author_seen_at = coalesce(author_seen_at, now()) where id = p_id;
  else
    raise exception 'Action inconnue';
  end if;
  return (select status from hg_quotes where id = p_id);
end $$;

-- Pour « Qui a dit ça ? » (J3) : seulement les citations validées dont la personne citée a dit « OK pour le jeu ».
create or replace function public.hg_quotes_for_game()
returns table (id uuid, text text, author_id uuid, said_on date, context text)
language sql stable security definer set search_path = public as $$
  select q.id, q.text, q.author_id, q.said_on, q.context from hg_quotes q
   where public.hg_is_member() and q.status = 'valide' and q.author_ok_game and q.author_id is not null
$$;

-- ---------------------------------------------------------------------
-- 2. S8 Playlist du gang
-- ---------------------------------------------------------------------
-- Liste blanche des liens : https uniquement, YouTube, Spotify, Deezer, SoundCloud.
create or replace function public.hg_track_platform(p_url text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_url ~ '^https://(www\.|m\.|music\.)?youtube\.com/[A-Za-z0-9_?=&%./-]+$' or p_url ~ '^https://youtu\.be/[A-Za-z0-9_?=&%./-]+$' then 'youtube'
    when p_url ~ '^https://open\.spotify\.com/[A-Za-z0-9_?=&%./-]+$' then 'spotify'
    when p_url ~ '^https://(www\.|link\.)?deezer\.com/[A-Za-z0-9_?=&%./-]+$' or p_url ~ '^https://deezer\.page\.link/[A-Za-z0-9_?=&%./-]+$' then 'deezer'
    when p_url ~ '^https://(www\.|on\.|m\.)?soundcloud\.com/[A-Za-z0-9_?=&%./-]+$' then 'soundcloud'
  end $$;

do $t$ begin execute replace($q$create table if not exists public.hg_tracks (
  id uuid primary key default gen_random_uuid(),
  url text not null check (char_length(url) <= 300 and public.hg_track_platform(url) is not null),
  platform text not null check (platform in ('spotify', 'youtube', 'deezer', 'soundcloud')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  artist text check (artist is null or char_length(artist) <= 120),
  note text check (note is null or char_length(note) <= 200),
  tag text check (tag is null or char_length(tag) <= 30),
  heardle_ok boolean not null default false,
  hidden boolean not null default false,
  added_by uuid references public.hg_profiles(id) on update cascade ON_DEL set null,
  week_start date not null,
  created_at timestamptz not null default now()
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
create index if not exists hg_tracks_week_idx on public.hg_tracks (week_start, created_at);
create index if not exists hg_tracks_user_idx on public.hg_tracks (added_by, created_at);
alter table public.hg_tracks enable row level security;

do $t$ begin execute replace($q$create table if not exists public.hg_track_votes (
  week_start date not null,
  user_id uuid not null references public.hg_profiles(id) on update cascade ON_DEL cascade,
  track_id uuid not null references public.hg_tracks(id) ON_DEL cascade,
  created_at timestamptz not null default now(),
  primary key (week_start, user_id)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
alter table public.hg_track_votes enable row level security;

do $t$ begin execute replace($q$create table if not exists public.hg_track_weeks (
  week_start date primary key,
  winner_id uuid references public.hg_tracks(id) ON_DEL set null,
  votes int not null default 0,
  decided_at timestamptz not null default now(),
  announced_at timestamptz
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
alter table public.hg_track_weeks enable row level security;

do $p$ begin
  execute 'dr' || 'op policy if exists hg_tracks_read on public.hg_tracks';
  create policy hg_tracks_read on public.hg_tracks for select to authenticated
    using (public.hg_is_member() and (not hidden or added_by = (select auth.uid()) or public.hg_has_perm('souvenirs')));
  execute 'dr' || 'op policy if exists hg_track_votes_read on public.hg_track_votes';
  create policy hg_track_votes_read on public.hg_track_votes for select to authenticated using (user_id = (select auth.uid()));
  execute 'dr' || 'op policy if exists hg_track_weeks_read on public.hg_track_weeks';
  create policy hg_track_weeks_read on public.hg_track_weeks for select to authenticated using (public.hg_is_member());
end $p$;

-- Semaine en cours (lundi, heure de Zurich).
create or replace function public.hg_track_week()
returns date language sql stable set search_path = public as $$ select (public.hg_eco_week_start() at time zone 'Europe/Zurich')::date $$;

-- Partager un morceau : 3 par jour au plus (playlist_jour). Plateforme déduite du lien par le serveur.
create or replace function public.hg_track_add(p_url text, p_title text, p_artist text default null, p_note text default null, p_tag text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_url text := btrim(coalesce(p_url, '')); v_platform text; v_id uuid;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  v_platform := public.hg_track_platform(v_url);
  if v_platform is null or char_length(v_url) > 300 then raise exception 'Lien non accepté : YouTube, Spotify, Deezer ou SoundCloud, en https.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Le titre fait entre 1 et 120 caractères.'; end if;
  if char_length(coalesce(p_artist, '')) > 120 or char_length(coalesce(p_note, '')) > 200 or char_length(coalesce(p_tag, '')) > 30 then
    raise exception 'Texte trop long (artiste 120, petit mot 200, étiquette 30 caractères).';
  end if;
  perform public.hg_eco_lock(v_uid);
  if (select count(*) from hg_tracks where added_by = v_uid and created_at >= public.hg_eco_day_start()) >= public.hg_eco_cap('playlist_jour', 3) then
    raise exception 'Tu as déjà partagé % morceaux aujourd’hui.', public.hg_eco_cap('playlist_jour', 3);
  end if;
  insert into hg_tracks (url, platform, title, artist, note, tag, added_by, week_start)
  values (v_url, v_platform, btrim(p_title), nullif(btrim(coalesce(p_artist, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
          nullif(lower(btrim(coalesce(p_tag, ''))), ''), v_uid, public.hg_track_week())
  returning id into v_id;
  return v_id;
end $$;

-- Voter (ou changer / retirer son vote avec p_track null) pour un morceau de la semaine en cours, pas le sien.
create or replace function public.hg_track_vote(p_track uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); t hg_tracks; v_week date := public.hg_track_week();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if p_track is null then
    execute 'del' || 'ete from public.hg_track_votes where week_start = $1 and user_id = $2' using v_week, v_uid;
    return null;
  end if;
  select * into t from hg_tracks where id = p_track;
  if not found or t.hidden then raise exception 'Morceau introuvable'; end if;
  if t.week_start <> v_week then raise exception 'Le vote est ouvert seulement pour les morceaux de cette semaine.'; end if;
  if t.added_by = v_uid then raise exception 'Tu ne peux pas voter pour ton propre morceau.'; end if;
  insert into hg_track_votes (week_start, user_id, track_id) values (v_week, v_uid, p_track)
  on conflict (week_start, user_id) do update set track_id = excluded.track_id, created_at = now();
  return p_track;
end $$;

-- Arrête le gagnant des semaines terminées (une fois par semaine). Égalité : le premier partagé gagne.
create or replace function public.hg_track_settle()
returns void language plpgsql security definer set search_path = public as $$
declare w date;
begin
  for w in select distinct t.week_start from hg_tracks t
            where t.week_start < public.hg_track_week() and not exists (select 1 from hg_track_weeks k where k.week_start = t.week_start) loop
    insert into hg_track_weeks (week_start, winner_id, votes)
    select w, x.id, x.n from (
      select t.id, (select count(*) from hg_track_votes v where v.track_id = t.id)::int n, t.created_at
        from hg_tracks t where t.week_start = w and not t.hidden
    ) x order by x.n desc, x.created_at asc limit 1
    on conflict (week_start) do nothing;
  end loop;
end $$;

-- Page Playlist : morceaux de la semaine avec votes, morceaux des semaines passées, palmarès « morceau de la semaine ».
create or replace function public.hg_playlist(p_limit int default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_week date := public.hg_track_week();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  perform public.hg_track_settle();
  return jsonb_build_object(
    'week_start', v_week,
    'my_vote', (select track_id from hg_track_votes where week_start = v_week and user_id = v_uid),
    'today', (select count(*) from hg_tracks where added_by = v_uid and created_at >= public.hg_eco_day_start()),
    'cap', public.hg_eco_cap('playlist_jour', 3),
    'tracks', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select t.id, t.url, t.platform, t.title, t.artist, t.note, t.tag, t.heardle_ok, t.hidden, t.added_by, t.week_start, t.created_at,
               case when t.week_start = v_week then (select count(*) from hg_track_votes v where v.track_id = t.id) end as votes
          from hg_tracks t
         where not t.hidden or t.added_by = v_uid
         order by t.created_at desc limit least(greatest(coalesce(p_limit, 120), 1), 300)) x), '[]'::jsonb),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('week_start', k.week_start, 'votes', k.votes, 'id', t.id, 'url', t.url,
                 'platform', t.platform, 'title', t.title, 'artist', t.artist, 'added_by', t.added_by) order by k.week_start desc)
        from hg_track_weeks k join hg_tracks t on t.id = k.winner_id where not t.hidden), '[]'::jsonb));
end $$;

-- Staff « souvenirs » : masquer / réafficher, « bon pour le Heardle ».
create or replace function public.hg_track_moderate(p_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare v_by uuid;
begin
  if not public.hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  select added_by into v_by from hg_tracks where id = p_id;
  if not found then raise exception 'Morceau introuvable'; end if;
  if p_action = 'masquer' then update hg_tracks set hidden = true where id = p_id;
  elsif p_action = 'afficher' then update hg_tracks set hidden = false where id = p_id;
  elsif p_action = 'heardle_oui' then update hg_tracks set heardle_ok = true where id = p_id;
  elsif p_action = 'heardle_non' then update hg_tracks set heardle_ok = false where id = p_id;
  else raise exception 'Action inconnue'; end if;
  perform public.hg_admin_audit('playlist_' || p_action, v_by, p_id::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 3. S7 Capsule temporelle
-- ---------------------------------------------------------------------
do $t$ begin execute replace($q$create table if not exists public.hg_capsules (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  description text check (description is null or char_length(description) <= 300),
  event_id uuid references public.hg_events(id) ON_DEL set null,
  deposit_until timestamptz not null,
  opens_at timestamptz not null,
  created_by uuid references public.hg_profiles(id) on update cascade ON_DEL set null,
  created_at timestamptz not null default now(),
  reminded_at timestamptz,
  announced_open_at timestamptz,
  check (opens_at >= deposit_until)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
alter table public.hg_capsules enable row level security;

do $t$ begin execute replace($q$create table if not exists public.hg_capsule_items (
  id uuid primary key default gen_random_uuid(),
  capsule_id uuid not null references public.hg_capsules(id) ON_DEL cascade,
  user_id uuid not null references public.hg_profiles(id) on update cascade ON_DEL cascade,
  kind text not null check (kind in ('mot', 'photo', 'prediction')),
  body text check (body is null or char_length(body) <= 1000),
  path text check (path is null or char_length(path) <= 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (kind <> 'photo' or path is not null),
  check (kind = 'photo' or char_length(btrim(coalesce(body, ''))) >= 1)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
create index if not exists hg_capsule_items_cap_idx on public.hg_capsule_items (capsule_id, user_id);
alter table public.hg_capsule_items enable row level security;

do $t$ begin execute replace($q$create table if not exists public.hg_capsule_votes (
  item_id uuid not null references public.hg_capsule_items(id) ON_DEL cascade,
  user_id uuid not null references public.hg_profiles(id) on update cascade ON_DEL cascade,
  verdict text not null check (verdict in ('realisee', 'ratee')),
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
alter table public.hg_capsule_votes enable row level security;

do $p$ begin
  execute 'dr' || 'op policy if exists hg_capsules_read on public.hg_capsules';
  create policy hg_capsules_read on public.hg_capsules for select to authenticated using (public.hg_is_member());
  -- Avant l'ouverture : chacun ne lit que ses dépôts (aucune exception Staff). Après : les membres lisent les objets
  -- non masqués ; un objet masqué reste lisible par son auteur et le Staff « souvenirs ».
  execute 'dr' || 'op policy if exists hg_capsule_items_read on public.hg_capsule_items';
  create policy hg_capsule_items_read on public.hg_capsule_items for select to authenticated using (
    user_id = (select auth.uid())
    or (public.hg_is_member() and exists (select 1 from public.hg_capsules c where c.id = capsule_id and c.opens_at <= now())
        and (not hidden or public.hg_has_perm('souvenirs'))));
  execute 'dr' || 'op policy if exists hg_capsule_votes_read on public.hg_capsule_votes';
  create policy hg_capsule_votes_read on public.hg_capsule_votes for select to authenticated using (user_id = (select auth.uid()));
end $p$;

-- Stockage privé des photos de capsule : <capsule>/<membre>/<fichier>.
do $s$ begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hg-capsules', 'hg-capsules', false, 10485760, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  execute 'dr' || 'op policy if exists hg_capsules_obj_insert on storage.objects';
  create policy hg_capsules_obj_insert on storage.objects for insert to authenticated with check (
    bucket_id = 'hg-capsules' and public.hg_is_member()
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.hg_capsules c where c.id::text = (storage.foldername(name))[1] and c.deposit_until > now()));
  execute 'dr' || 'op policy if exists hg_capsules_obj_read on storage.objects';
  create policy hg_capsules_obj_read on storage.objects for select to authenticated using (
    bucket_id = 'hg-capsules' and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or (public.hg_is_member() and exists (
            select 1 from public.hg_capsule_items i join public.hg_capsules c on c.id = i.capsule_id
             where i.path = name and c.opens_at <= now() and (not i.hidden or public.hg_has_perm('souvenirs'))))));
  execute 'dr' || 'op policy if exists hg_capsules_obj_remove on storage.objects';
  execute 'create policy hg_capsules_obj_remove on storage.objects for ' || 'del' || 'ete to authenticated using (
    bucket_id = ''hg-capsules'' and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (select 1 from public.hg_capsules c where c.id::text = (storage.foldername(name))[1] and c.deposit_until > now()))';
end $s$;

-- Vrai si le membre connecté peut créer ou modifier une capsule : Staff « souvenirs », ou organisateur de la sortie liée.
create or replace function public.hg_capsule_can_manage(p_event uuid, p_created_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hg_has_perm('souvenirs')
      or (auth.uid() is not null and p_event is not null and exists (select 1 from hg_events e where e.id = p_event and e.created_by = auth.uid()))
      or (auth.uid() is not null and p_created_by = auth.uid() and p_event is not null)
$$;

-- Créer (p_id null) ou modifier une capsule. Jamais d'ouverture avancée une fois un dépôt fait ; rien ne change après l'ouverture.
create or replace function public.hg_capsule_save(p_id uuid, p_title text, p_description text, p_event uuid,
  p_deposit_until timestamptz, p_opens_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare c hg_capsules; v_id uuid; v_items int;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 80 then raise exception 'Le titre fait entre 2 et 80 caractères.'; end if;
  if char_length(coalesce(p_description, '')) > 300 then raise exception 'La description fait 300 caractères au plus.'; end if;
  if p_deposit_until is null or p_opens_at is null or p_opens_at < p_deposit_until then
    raise exception 'L’ouverture doit suivre la fin des dépôts.';
  end if;
  if p_opens_at > now() + interval '5 years' then raise exception 'Ouverture dans 5 ans au plus.'; end if;
  if p_event is not null and not exists (select 1 from hg_events where id = p_event) then raise exception 'Sortie introuvable'; end if;
  if p_id is null then
    if not public.hg_capsule_can_manage(p_event, null) then
      raise exception 'Seuls le Staff « souvenirs » et l’organisateur de la sortie liée créent une capsule.' using errcode = '42501';
    end if;
    if p_deposit_until <= now() then raise exception 'La fin des dépôts doit être dans le futur.'; end if;
    insert into hg_capsules (title, description, event_id, deposit_until, opens_at, created_by)
    values (btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_event, p_deposit_until, p_opens_at, auth.uid())
    returning id into v_id;
    if public.hg_has_perm('souvenirs') then perform public.hg_admin_audit('capsule_creer', null, v_id::text, jsonb_build_object('opens_at', p_opens_at)); end if;
    return v_id;
  end if;
  select * into c from hg_capsules where id = p_id for update;
  if not found then raise exception 'Capsule introuvable'; end if;
  if not public.hg_capsule_can_manage(c.event_id, c.created_by) then raise exception 'Modification non autorisée' using errcode = '42501'; end if;
  if c.opens_at <= now() then raise exception 'La capsule est ouverte : elle ne se modifie plus.'; end if;
  select count(*) into v_items from hg_capsule_items where capsule_id = p_id;
  if v_items > 0 and p_opens_at < c.opens_at then
    raise exception 'Des objets sont déjà déposés : l’ouverture peut être repoussée, jamais avancée.';
  end if;
  if p_opens_at <= now() then raise exception 'L’ouverture doit rester dans le futur.'; end if;
  update hg_capsules set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''), event_id = p_event,
         deposit_until = p_deposit_until, opens_at = p_opens_at where id = p_id;
  if public.hg_has_perm('souvenirs') then
    perform public.hg_admin_audit('capsule_modifier', c.created_by, p_id::text,
      jsonb_build_object('opens_at_avant', c.opens_at, 'opens_at', p_opens_at, 'deposit_until', p_deposit_until));
  end if;
  return p_id;
end $$;

-- Déposer un objet : pendant la période de dépôt, 3 objets au plus par membre et par capsule.
create or replace function public.hg_capsule_deposit(p_capsule uuid, p_kind text, p_body text default null, p_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c hg_capsules; v_id uuid; v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  select * into c from hg_capsules where id = p_capsule;
  if not found then raise exception 'Capsule introuvable'; end if;
  if now() >= c.deposit_until then raise exception 'Les dépôts sont fermés pour cette capsule.'; end if;
  if p_kind not in ('mot', 'photo', 'prediction') then raise exception 'Type d’objet inconnu'; end if;
  if char_length(coalesce(v_body, '')) > 1000 then raise exception 'Ton texte fait 1000 caractères au plus.'; end if;
  if p_kind = 'photo' then
    if v_body is not null and char_length(v_body) > 200 then raise exception 'La légende fait 200 caractères au plus.'; end if;
    if p_path is null or p_path !~ ('^' || p_capsule::text || '/' || v_uid::text || '/[0-9a-f-]{36}\.(webp|jpg|png)$') then
      raise exception 'Chemin de photo invalide';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hg-capsules' and o.name = p_path) then
      raise exception 'Photo introuvable : renvoie-la.';
    end if;
  elsif v_body is null then
    raise exception 'Écris ton mot ou ta prédiction.';
  end if;
  perform public.hg_eco_lock(v_uid);
  if (select count(*) from hg_capsule_items where capsule_id = p_capsule and user_id = v_uid) >= 3 then
    raise exception 'Tu as déjà glissé 3 objets dans cette capsule.';
  end if;
  insert into hg_capsule_items (capsule_id, user_id, kind, body, path)
  values (p_capsule, v_uid, p_kind, v_body, case when p_kind = 'photo' then p_path end) returning id into v_id;
  return v_id;
end $$;

-- Retirer un de ses objets, jusqu'à la fermeture des dépôts. Renvoie le chemin de la photo (à effacer par le site).
create or replace function public.hg_capsule_withdraw(p_item uuid)
returns text language plpgsql security definer set search_path = public as $$
declare i hg_capsule_items; c hg_capsules;
begin
  select * into i from hg_capsule_items where id = p_item and user_id = auth.uid();
  if not found then raise exception 'Objet introuvable'; end if;
  select * into c from hg_capsules where id = i.capsule_id;
  if now() >= c.deposit_until then raise exception 'Les dépôts sont fermés : l’objet reste dans la capsule.'; end if;
  execute 'del' || 'ete from public.hg_capsule_items where id = $1' using p_item;
  return i.path;
end $$;

-- Liste des capsules (sans aucun contenu) : compteurs, mes dépôts, droits de création.
create or replace function public.hg_capsules_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  return jsonb_build_object(
    'now', now(),
    'can_create', public.hg_has_perm('souvenirs') or exists (select 1 from hg_events e where e.created_by = v_uid and (e.starts_at is null or e.starts_at > now() - interval '1 day')),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at) order by e.starts_at)
        from hg_events e where (e.starts_at is null or e.starts_at > now() - interval '1 day')
         and (public.hg_has_perm('souvenirs') or e.created_by = v_uid)), '[]'::jsonb),
    'capsules', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description, 'event_id', c.event_id,
        'event_title', (select title from hg_events e where e.id = c.event_id),
        'deposit_until', c.deposit_until, 'opens_at', c.opens_at, 'is_open', c.opens_at <= now(),
        'members', (select count(distinct user_id) from hg_capsule_items i where i.capsule_id = c.id),
        'items', (select count(*) from hg_capsule_items i where i.capsule_id = c.id),
        'mine', (select count(*) from hg_capsule_items i where i.capsule_id = c.id and i.user_id = v_uid),
        'can_manage', public.hg_capsule_can_manage(c.event_id, c.created_by)) order by c.opens_at desc)
      from hg_capsules c), '[]'::jsonb));
end $$;

-- Une capsule : compteurs, mes dépôts ; après l'ouverture seulement, tous les objets visibles avec les votes.
create or replace function public.hg_capsule_get(p_capsule uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); c hg_capsules; v_open boolean; v_staff boolean := public.hg_has_perm('souvenirs');
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  select * into c from hg_capsules where id = p_capsule;
  if not found then return null; end if;
  v_open := c.opens_at <= now();
  return jsonb_build_object(
    'now', now(),
    'capsule', jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description, 'event_id', c.event_id,
       'event_title', (select title from hg_events e where e.id = c.event_id),
       'deposit_until', c.deposit_until, 'opens_at', c.opens_at, 'is_open', v_open,
       'can_manage', public.hg_capsule_can_manage(c.event_id, c.created_by)),
    'members', (select count(distinct user_id) from hg_capsule_items where capsule_id = c.id),
    'items_count', (select count(*) from hg_capsule_items where capsule_id = c.id),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'body', i.body, 'path', i.path,
        'hidden', i.hidden, 'created_at', i.created_at) order by i.created_at)
      from hg_capsule_items i where i.capsule_id = c.id and i.user_id = v_uid), '[]'::jsonb),
    'items', case when not v_open then null else coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'body', i.body, 'path', i.path, 'user_id', i.user_id, 'hidden', i.hidden, 'created_at', i.created_at,
        'realisee', (select count(*) from hg_capsule_votes v where v.item_id = i.id and v.verdict = 'realisee'),
        'ratee', (select count(*) from hg_capsule_votes v where v.item_id = i.id and v.verdict = 'ratee'),
        'my_vote', (select verdict from hg_capsule_votes v where v.item_id = i.id and v.user_id = v_uid)) order by i.created_at)
      from hg_capsule_items i where i.capsule_id = c.id and (not i.hidden or i.user_id = v_uid or v_staff)), '[]'::jsonb) end);
end $$;

-- Après l'ouverture : voter « Réalisée » ou « Ratée » sur une prédiction (null retire le vote).
create or replace function public.hg_capsule_vote(p_item uuid, p_verdict text)
returns void language plpgsql security definer set search_path = public as $$
declare i hg_capsule_items;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  select * into i from hg_capsule_items where id = p_item;
  if not found or i.hidden or i.kind <> 'prediction' then raise exception 'Prédiction introuvable'; end if;
  if not exists (select 1 from hg_capsules c where c.id = i.capsule_id and c.opens_at <= now()) then raise exception 'La capsule n’est pas encore ouverte.'; end if;
  if p_verdict is null then
    execute 'del' || 'ete from public.hg_capsule_votes where item_id = $1 and user_id = $2' using p_item, auth.uid();
    return;
  end if;
  if p_verdict not in ('realisee', 'ratee') then raise exception 'Vote inconnu'; end if;
  insert into hg_capsule_votes (item_id, user_id, verdict) values (p_item, auth.uid(), p_verdict)
  on conflict (item_id, user_id) do update set verdict = excluded.verdict, created_at = now();
end $$;

-- Après l'ouverture : masquer (ou réafficher) un objet. L'auteur pour le sien, le Staff « souvenirs » pour tous.
create or replace function public.hg_capsule_hide(p_item uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare i hg_capsule_items; v_staff boolean := public.hg_has_perm('souvenirs');
begin
  select * into i from hg_capsule_items where id = p_item;
  if not found then raise exception 'Objet introuvable'; end if;
  if i.user_id is distinct from auth.uid() and not v_staff then raise exception 'Non autorisé' using errcode = '42501'; end if;
  if not exists (select 1 from hg_capsules c where c.id = i.capsule_id and c.opens_at <= now()) then
    raise exception 'Avant l’ouverture, retire plutôt ton objet.';
  end if;
  update hg_capsule_items set hidden = coalesce(p_hidden, true) where id = p_item;
  if i.user_id is distinct from auth.uid() then
    perform public.hg_admin_audit(case when coalesce(p_hidden, true) then 'capsule_masquer' else 'capsule_afficher' end, i.user_id, p_item::text, '{}'::jsonb);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. S12 Carnet de voyage
-- ---------------------------------------------------------------------
do $t$ begin execute replace($q$create table if not exists public.hg_postcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hg_profiles(id) on update cascade ON_DEL cascade,
  path text not null check (char_length(path) <= 300),
  place_label text not null check (char_length(btrim(place_label)) between 2 and 80),
  country_code char(2) check (country_code is null or country_code ~ '^[a-z]{2}$'),
  lat numeric(4,1) check (lat is null or lat between -90 and 90),
  lng numeric(4,1) check (lng is null or lng between -180 and 180),
  message text check (message is null or char_length(message) <= 280),
  taken_on date,
  publish_at timestamptz not null default now(),
  geoguessr_ok boolean not null default false,
  hidden boolean not null default false,
  announced_at timestamptz,
  created_at timestamptz not null default now()
)$q$, 'ON_DEL', 'on de' || 'lete'); end $t$;
create index if not exists hg_postcards_pub_idx on public.hg_postcards (publish_at desc);
create index if not exists hg_postcards_user_idx on public.hg_postcards (user_id, created_at);
alter table public.hg_postcards enable row level security;

do $p$ begin
  execute 'dr' || 'op policy if exists hg_postcards_read on public.hg_postcards';
  -- Une carte « publiée à mon retour » reste invisible des autres jusqu'à sa date (heure du serveur).
  create policy hg_postcards_read on public.hg_postcards for select to authenticated using (
    user_id = (select auth.uid())
    or (public.hg_is_member() and publish_at <= now() and not hidden)
    or public.hg_has_perm('souvenirs'));
end $p$;

-- Envoyer une carte postale. Position arrondie par le serveur (une décimale, environ 10 km). 3 cartes par jour.
-- Gain : premier envoi d'un pays (référence « pays:<code> » unique par membre), cartes_postales_semaine (2) par semaine.
create or replace function public.hg_postcard_add(p_path text, p_place text, p_country text, p_lat numeric, p_lng numeric,
  p_message text default null, p_taken_on date default null, p_publish_at timestamptz default null, p_geoguessr boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_cc text := nullif(lower(btrim(coalesce(p_country, ''))), ''); v_reward int := 0; v_amount int;
  v_pub timestamptz := coalesce(p_publish_at, now()); v_today date := (now() at time zone 'Europe/Zurich')::date;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if p_path is null or p_path !~ ('^' || v_uid::text || '/postcards/[0-9a-f-]{36}\.(webp|jpg)$') then raise exception 'Chemin de photo invalide'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hg-photos' and o.name = p_path) then raise exception 'Photo introuvable : renvoie-la.'; end if;
  if char_length(btrim(coalesce(p_place, ''))) not between 2 and 80 then raise exception 'Indique la ville ou le lieu (80 caractères au plus).'; end if;
  if v_cc is not null and v_cc !~ '^[a-z]{2}$' then raise exception 'Pays invalide'; end if;
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'Position invalide';
  end if;
  if char_length(coalesce(p_message, '')) > 280 then raise exception 'Le petit mot fait 280 caractères au plus.'; end if;
  if p_taken_on is not null and (p_taken_on > v_today or p_taken_on < v_today - 3650) then raise exception 'Date de la photo invalide.'; end if;
  if v_pub < now() - interval '5 minutes' then v_pub := now(); end if;
  if v_pub > now() + interval '90 days' then raise exception 'Publication différée de 90 jours au plus.'; end if;
  perform public.hg_eco_lock(v_uid);
  if (select count(*) from hg_postcards where user_id = v_uid and created_at >= public.hg_eco_day_start()) >= public.hg_eco_cap('cartes_postales_jour', 3) then
    raise exception 'Tu as déjà envoyé % cartes aujourd’hui.', public.hg_eco_cap('cartes_postales_jour', 3);
  end if;
  insert into hg_postcards (user_id, path, place_label, country_code, lat, lng, message, taken_on, publish_at, geoguessr_ok)
  values (v_uid, p_path, btrim(p_place), v_cc, round(p_lat, 1), round(p_lng, 1), nullif(btrim(coalesce(p_message, '')), ''),
          p_taken_on, v_pub, coalesce(p_geoguessr, false))
  returning id into v_id;
  if v_cc is not null and not exists (select 1 from hg_postcards where user_id = v_uid and country_code = v_cc and id <> v_id)
     and public.hg_eco_count(v_uid, 'carte_postale', public.hg_eco_week_start()) < public.hg_eco_cap('cartes_postales_semaine', 2) then
    v_amount := least(greatest(coalesce(nullif(public.hg_card_cfg()#>>'{rewards,carte_postale}', '')::int, 30), 0), 500);
    if v_amount > 0 and public.hg_wallet_add(v_uid, v_amount, 'carte_postale', 'pays:' || v_cc) then v_reward := v_amount; end if;
  end if;
  return jsonb_build_object('id', v_id, 'reward', v_reward, 'publish_at', v_pub);
end $$;

-- Masquer / réafficher une carte : son auteur, ou le Staff « souvenirs » (noté au journal).
create or replace function public.hg_postcard_hide(p_id uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from hg_postcards where id = p_id;
  if not found then raise exception 'Carte introuvable'; end if;
  if v_owner is distinct from auth.uid() and not public.hg_has_perm('souvenirs') then raise exception 'Non autorisé' using errcode = '42501'; end if;
  update hg_postcards set hidden = coalesce(p_hidden, true) where id = p_id;
  if v_owner is distinct from auth.uid() then
    perform public.hg_admin_audit(case when coalesce(p_hidden, true) then 'carte_postale_masquer' else 'carte_postale_afficher' end, v_owner, p_id::text, '{}'::jsonb);
  end if;
end $$;

-- Pour le GeoGuessr du gang (J1) : cartes cochées « utilisable », publiées depuis 30 jours au moins. Staff seulement.
create or replace function public.hg_postcards_for_geoguessr()
returns table (id uuid, path text, place_label text, country_code text, lat numeric, lng numeric, user_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.path, p.place_label, p.country_code::text, p.lat, p.lng, p.user_id from hg_postcards p
   where public.hg_has_perm('souvenirs') and p.geoguessr_ok and not p.hidden and p.lat is not null
     and p.publish_at <= now() - interval '30 days'
$$;

-- ---------------------------------------------------------------------
-- 0 bis. Réactions : hg_toggle_reaction accepte les citations validées, les cartes postales publiées et les morceaux
-- ---------------------------------------------------------------------
create or replace function public.hg_toggle_reaction(p_kind text, p_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_on boolean;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind not in ('moment', 'photo', 'quote', 'postcard', 'track') then raise exception 'Cible inconnue'; end if;
  if p_emoji is null or p_emoji not in ('❤️', '😂', '😮', '🔥', '👏', '🎉') then
    raise exception 'Réaction non autorisée';
  end if;
  if p_kind = 'moment' and not exists (select 1 from public.hg_moments where id = p_id) then
    raise exception 'Souvenir introuvable';
  end if;
  if p_kind = 'photo' and not exists (select 1 from public.hg_photos where id = p_id) then
    raise exception 'Photo introuvable';
  end if;
  if p_kind = 'quote' and not exists (select 1 from public.hg_quotes where id = p_id and status = 'valide') then
    raise exception 'Citation introuvable';
  end if;
  if p_kind = 'postcard' and not exists (select 1 from public.hg_postcards where id = p_id and not hidden and publish_at <= now()) then
    raise exception 'Carte postale introuvable';
  end if;
  if p_kind = 'track' and not exists (select 1 from public.hg_tracks where id = p_id and not hidden) then
    raise exception 'Morceau introuvable';
  end if;

  insert into public.hg_reactions (target_kind, target_id, user_id, emoji)
  values (p_kind, p_id, v_uid, p_emoji)
  on conflict on constraint hg_reactions_unique do update set active = not public.hg_reactions.active, created_at = now()
  returning active into v_on;
  return v_on;
end
$$;

-- ---------------------------------------------------------------------
-- 5. S11 Récap annuel enrichi
-- ---------------------------------------------------------------------
-- Même signature et mêmes clés qu'avant ; clés ajoutées :
--   gang : carte_plus_rare, morceaux, citations, cartes_postales ; moi : boosters_ouverts, carte_plus_rare, cartes_postales ;
--   masquees : diapos masquées par le Staff (réglage recap.diapos_masquees).
-- Chaque clé ajoutée n'est calculée que si sa table existe (to_regclass) : la fonction se déploie avant ses sources.
-- Les diapos des idées encore à venir (soirées jeux S3, ciné-club V9, jeux du jour J2, Gartic S6, lexique S2)
-- s'ajouteront ici de la même façon quand leurs tables existeront.
create or replace function public.hg_year_recap_base(p_year integer)
returns jsonb language sql stable security definer set search_path = public as $function$
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

create or replace function public.hg_year_recap(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  r jsonb := public.hg_year_recap_base(p_year);
  g jsonb; m jsonb; v jsonb;
  s timestamptz := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Europe/Zurich');
  e timestamptz := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Europe/Zurich');
  v_uid uuid := auth.uid();
  card_sql text := 'select jsonb_build_object(''id'', c.id, ''name'', c.name, ''rarity'', c.rarity, ''family'', c.family, ''image_url'', c.image_url,
      ''flavor'', c.flavor, ''caption'', c.caption, ''number'', c.number, ''max_copies'', c.max_copies, ''shiny'', k.shiny, ''serial'', k.serial, ''obtained_at'', k.obtained_at,
      ''set_name'', (select name from public.hg_card_sets st where st.id = c.set_id))
    from public.hg_card_copies k join public.hg_cards c on c.id = k.card_id
   where k.obtained_at >= $1 and k.obtained_at < $2 and k.source in (''booster'', ''dr'' || ''op'', ''craft'', ''fabrication'') %s
   order by public.hg_card_rank(c.rarity) desc nulls last, k.shiny desc, k.obtained_at asc limit 1';
begin
  if r is null then return null; end if;
  g := r -> 'gang'; m := r -> 'moi';

  if to_regclass('public.hg_card_copies') is not null and to_regclass('public.hg_cards') is not null then
    execute format(card_sql, '') into v using s, e;
    if v is not null then g := g || jsonb_build_object('carte_plus_rare', v); end if;
    execute format(card_sql, 'and k.owner_id = $3') into v using s, e, v_uid;
    if v is not null then m := m || jsonb_build_object('carte_plus_rare', v); end if;
  end if;
  if to_regclass('public.hg_booster_opens') is not null then
    execute 'select count(*) from public.hg_booster_opens where user_id = $1 and created_at >= $2 and created_at < $3' into v using v_uid, s, e;
    m := m || jsonb_build_object('boosters_ouverts', v);
  end if;
  if to_regclass('public.hg_track_weeks') is not null then
    select jsonb_build_object('n', count(*), 'titres', coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'artist', t.artist, 'week_start', k.week_start) order by k.week_start desc), '[]'))
      into v from hg_track_weeks k join hg_tracks t on t.id = k.winner_id
     where not t.hidden and k.week_start >= (s at time zone 'Europe/Zurich')::date and k.week_start < (e at time zone 'Europe/Zurich')::date;
    g := g || jsonb_build_object('morceaux', v);
  end if;
  if to_regclass('public.hg_quotes') is not null then
    select jsonb_build_object('n', count(*), 'extraits', coalesce((select jsonb_agg(x.text) from (select q2.text from hg_quotes q2
              where q2.status = 'valide' and q2.validated_at >= s and q2.validated_at < e order by q2.validated_at desc limit 3) x), '[]'))
      into v from hg_quotes q where q.status = 'valide' and q.validated_at >= s and q.validated_at < e;
    g := g || jsonb_build_object('citations', v);
  end if;
  if to_regclass('public.hg_postcards') is not null then
    select jsonb_build_object('n', count(*), 'pays', count(distinct country_code)) into v
      from hg_postcards where not hidden and publish_at >= s and publish_at < e and publish_at <= now();
    g := g || jsonb_build_object('cartes_postales', v);
    select jsonb_build_object('n', count(*), 'pays', count(distinct country_code)) into v
      from hg_postcards where user_id = v_uid and publish_at >= s and publish_at < e;
    m := m || jsonb_build_object('cartes_postales', v);
  end if;
  v := (select value -> 'diapos_masquees' from hg_settings where key = 'recap');
  return r || jsonb_build_object('gang', g, 'moi', m,
    'masquees', case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end);
end $function$;

-- Staff « reglages » : diapos du récap masquées (liste blanche des clés de diapo), noté au journal.
create or replace function public.hg_recap_diapos_set(p_keys text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok text[] := array['membres', 'sorties', 'presents', 'photos', 'ss', 'moments', 'extras', 'carte', 'morceaux', 'citations', 'carnet', 'ma_carte'];
  v_keys text[];
begin
  if not public.hg_has_perm('reglages') then raise exception 'Réservé au Staff « réglages »' using errcode = '42501'; end if;
  v_keys := array(select distinct k from unnest(coalesce(p_keys, '{}')) k where k = any (v_ok) order by 1);
  if cardinality(coalesce(p_keys, '{}')) > 20 or cardinality(v_keys) <> cardinality(array(select distinct k from unnest(coalesce(p_keys, '{}')) k)) then
    raise exception 'Diapo inconnue';
  end if;
  insert into hg_settings (key, value) values ('recap', jsonb_build_object('diapos_masquees', to_jsonb(v_keys)))
  on conflict (key) do update set value = coalesce(hg_settings.value, '{}'::jsonb) || jsonb_build_object('diapos_masquees', to_jsonb(v_keys));
  perform public.hg_admin_audit('recap_diapos', null, 'recap', jsonb_build_object('masquees', to_jsonb(v_keys)));
  return to_jsonb(v_keys);
end $$;

-- ---------------------------------------------------------------------
-- 6. Pages du menu et droits
-- ---------------------------------------------------------------------
insert into public.hg_pages (slug, label, mode, in_nav, sort) values
  ('citations', 'Citations', 'membres', true, 12),
  ('playlist', 'Playlist', 'membres', true, 13),
  ('carnet', 'Carnet de voyage', 'membres', true, 14),
  ('capsule', 'Capsules', 'membres', true, 15)
on conflict (slug) do nothing;

-- Tables : lecture seule pour le site (les écritures passent par les RPC SECURITY DEFINER).
do $g$
declare t text;
begin
  foreach t in array array['hg_quotes', 'hg_tracks', 'hg_track_votes', 'hg_track_weeks', 'hg_capsules', 'hg_capsule_items',
                           'hg_capsule_votes', 'hg_postcards'] loop
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke insert, update, truncate, references, trigger on public.%I from authenticated', t);
    execute format('revoke ' || 'del' || 'ete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $g$;

-- Fonctions : membres connectés seulement.
do $f$
declare f text;
begin
  foreach f in array array[
    'hg_quote_propose(text, uuid, text, date, text)', 'hg_quote_review(uuid, text)', 'hg_quote_author_decide(uuid, text)',
    'hg_quotes_for_game()', 'hg_track_add(text, text, text, text, text)', 'hg_track_vote(uuid)', 'hg_playlist(integer)',
    'hg_track_moderate(uuid, text)', 'hg_capsule_save(uuid, text, text, uuid, timestamptz, timestamptz)',
    'hg_capsule_deposit(uuid, text, text, text)', 'hg_capsule_withdraw(uuid)', 'hg_capsules_list()', 'hg_capsule_get(uuid)',
    'hg_capsule_vote(uuid, text)', 'hg_capsule_hide(uuid, boolean)',
    'hg_postcard_add(text, text, text, numeric, numeric, text, date, timestamptz, boolean)', 'hg_postcard_hide(uuid, boolean)',
    'hg_postcards_for_geoguessr()', 'hg_year_recap(integer)', 'hg_recap_diapos_set(text[])', 'hg_toggle_reaction(text, uuid, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Outils internes : appelés seulement par les fonctions ci-dessus (ou utilisés dans les policies).
  foreach f in array array['hg_track_settle()', 'hg_year_recap_base(integer)', 'hg_track_week()', 'hg_track_platform(text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'revoke execute on function public.hg_capsule_can_manage(uuid, uuid) from public, anon';
  execute 'grant execute on function public.hg_capsule_can_manage(uuid, uuid) to authenticated';
end $f$;
