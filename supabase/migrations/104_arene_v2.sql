-- ---------------------------------------------------------------------
-- 104 · Arène v2 (règles dans docs/ARENE.md)
-- ---------------------------------------------------------------------
-- S'applique après 103. Idempotente (create … if not exists, create or replace, policies absentes : toutes les
-- tables sont fermées aux clients, l'accès passe par les RPC security definer).
-- Visible seulement des administrateurs tant que hg_settings.arena.v2_public n'est pas vrai : les RPC « membre »
-- refusent les autres (hg_arena_gate). Les RPC de l'Arène actuelle (hg_battle_*) ne sont pas modifiées ; le deck
-- de défense (hg_battle_decks) et la main (hg_battle_hand) sont partagés.
-- Gains : raisons de hg_wallet_log « arene » (victoire du jour), « arene_def » (défense), « arene_saison » (fin de
-- saison), « arene_booster » (boosters, delta 0). Aucune ne compte dans la saison trimestrielle (hg_season_raw).
-- Verrous : hg_eco_lock sur les deux membres, toujours dans le même ordre (pas d'interblocage).
-- Journal : hg_admin_audit pour les réglages et la clôture de saison.

-- ---------------------------------------------------------------------
-- 1. Tables (fermées aux clients ; @CASC et @SETNULL remplacés pour la suppression en cascade des comptes)
-- ---------------------------------------------------------------------
create table if not exists public.hg_arena_seasons (
  id serial primary key,
  label text not null check (char_length(label) between 3 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'en_cours' check (status in ('en_cours', 'close')),
  closed_at timestamptz,
  closed_by uuid,
  check (ends_at > starts_at)
);

do $d$ begin execute replace(replace($t$
create table if not exists public.hg_arena_ratings (
  user_id uuid primary key references public.hg_profiles(id) @CASC,
  rating int not null,
  peak int not null,
  matches int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  updated_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;

do $d$ begin execute replace(replace($t$
create table if not exists public.hg_arena_fights (
  id uuid primary key default gen_random_uuid(),
  season_id int not null references public.hg_arena_seasons(id),
  attacker_id uuid not null references public.hg_profiles(id) @CASC,
  defender_id uuid not null references public.hg_profiles(id) @CASC,
  attack jsonb not null,
  defense jsonb not null,
  duels jsonb not null,
  wins_a smallint not null,
  wins_d smallint not null,
  result text not null check (result in ('victoire', 'defaite', 'egalite')),
  rating_a int not null,
  rating_d int not null,
  delta_a int not null,
  delta_d int not null,
  paid_a int not null default 0,
  paid_d int not null default 0,
  seen_at timestamptz,
  created_at timestamptz not null default now()
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;

do $d$ begin execute replace(replace($t$
create table if not exists public.hg_arena_results (
  season_id int not null references public.hg_arena_seasons(id) @CASC,
  user_id uuid not null references public.hg_profiles(id) @CASC,
  rating int not null,
  league text not null,
  rank int,
  matches int not null,
  wins int not null,
  losses int not null,
  draws int not null,
  paid int not null default 0,
  boosters int not null default 0,
  primary key (season_id, user_id)
)
$t$, '@CASC', 'on de' || 'lete cascade'), '@SETNULL', 'on de' || 'lete set null'); end $d$;

create index if not exists hg_arena_fights_attacker on public.hg_arena_fights (attacker_id, created_at desc);
create index if not exists hg_arena_fights_defender on public.hg_arena_fights (defender_id, created_at desc);
create index if not exists hg_arena_ratings_rating on public.hg_arena_ratings (rating desc);

alter table public.hg_arena_seasons enable row level security;
alter table public.hg_arena_ratings enable row level security;
alter table public.hg_arena_fights enable row level security;
alter table public.hg_arena_results enable row level security;
revoke all on public.hg_arena_seasons, public.hg_arena_ratings, public.hg_arena_fights, public.hg_arena_results from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Réglages : hg_settings.arena, lus avec bornes et valeurs par défaut
-- ---------------------------------------------------------------------
-- Nombre lu dans un objet jsonb : valeur par défaut si absente ou invalide, bornée sinon.
create or replace function public.hg_arena_num(p jsonb, k text, d int, lo int, hi int)
returns int language sql immutable set search_path = public as $$
  select case when coalesce(p->>k, '') ~ '^\d{1,9}$' then least(hi, greatest(lo, (p->>k)::int)) else d end $$;

create or replace function public.hg_arena_cfg()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'arena'), '{}'::jsonb);
  s jsonb := coalesce(v->'seuils', '{}'::jsonb);
  r jsonb := coalesce(v->'recompenses', '{}'::jsonb);
  b jsonb := coalesce(v->'boosters', '{}'::jsonb);
  po jsonb := coalesce(v->'podium', '{}'::jsonb);
begin
  return jsonb_build_object(
    'v2_public', coalesce((v->>'v2_public') = 'true', false),
    'actif', coalesce(v->>'actif', 'true') <> 'false',
    'gains', coalesce(v->>'gains', 'true') <> 'false',
    'depart', hg_arena_num(v, 'depart', 1000, 100, 3000),
    'plancher', hg_arena_num(v, 'plancher', 500, 0, 2000),
    'k', hg_arena_num(v, 'k', 32, 4, 64),
    'reset_pct', hg_arena_num(v, 'reset_pct', 50, 0, 100),
    'duree_jours', hg_arena_num(v, 'duree_jours', 30, 7, 120),
    'min_combats', hg_arena_num(v, 'min_combats', 3, 0, 50),
    'attaques_jour', hg_arena_num(v, 'attaques_jour', 5, 1, 10),
    'meme_adversaire', hg_arena_num(v, 'meme_adversaire', 2, 1, 3),
    'defenses_recues_jour', hg_arena_num(v, 'defenses_recues_jour', 4, 1, 20),
    'gain_jour', hg_arena_num(v, 'gain_jour', 5, 0, 100),
    'gain_defense', hg_arena_num(v, 'gain_defense', 3, 0, 100),
    'defenses_jour', hg_arena_num(v, 'defenses_jour', 3, 0, 20),
    'plafond_jour', hg_arena_num(v, 'plafond_jour', 20, 0, 500),
    'plafond_saison', hg_arena_num(v, 'plafond_saison', 300, 0, 2000),
    'seuils', jsonb_build_object('argent', hg_arena_num(s, 'argent', 1050, 0, 5000), 'or', hg_arena_num(s, 'or', 1200, 0, 5000),
      'diamant', hg_arena_num(s, 'diamant', 1400, 0, 5000), 'legende', hg_arena_num(s, 'legende', 1600, 0, 5000)),
    'recompenses', jsonb_build_object('argent', hg_arena_num(r, 'argent', 10, 0, 1000), 'or', hg_arena_num(r, 'or', 25, 0, 1000),
      'diamant', hg_arena_num(r, 'diamant', 50, 0, 1000), 'legende', hg_arena_num(r, 'legende', 100, 0, 1000)),
    'boosters', jsonb_build_object('diamant', hg_arena_num(b, 'diamant', 1, 0, 10), 'legende', hg_arena_num(b, 'legende', 2, 0, 10)),
    'podium', jsonb_build_object('1', hg_arena_num(po, '1', 150, 0, 1000), '2', hg_arena_num(po, '2', 100, 0, 1000),
      '3', hg_arena_num(po, '3', 60, 0, 1000)));
end $$;

-- Ligue d'une cote (seuils de la configuration).
create or replace function public.hg_arena_league(p int, cfg jsonb)
returns text language sql immutable set search_path = public as $$
  select case when p >= (cfg->'seuils'->>'legende')::int then 'legende'
    when p >= (cfg->'seuils'->>'diamant')::int then 'diamant'
    when p >= (cfg->'seuils'->>'or')::int then 'or'
    when p >= (cfg->'seuils'->>'argent')::int then 'argent'
    else 'bronze' end $$;

-- Membre connecté, non fantôme, et Arène ouverte (v2_public) ou administrateur (aperçu).
create or replace function public.hg_arena_gate()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_member() or (select is_ghost from hg_profiles where id = auth.uid()) then raise exception 'Réservé aux membres'; end if;
  if not ((hg_arena_cfg()->>'v2_public')::boolean or hg_is_admin()) then
    raise exception 'L’Arène v2 n’est pas encore ouverte aux membres';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Saisons
-- ---------------------------------------------------------------------
-- Saison en cours (créée au besoin, d'une durée de hg_arena_cfg().duree_jours).
create or replace function public.hg_arena_season_ensure()
returns int language plpgsql security definer set search_path = public as $$
declare s int; cfg jsonb := hg_arena_cfg();
begin
  perform pg_advisory_xact_lock(hashtext('hg_arena_season'));
  select id into s from hg_arena_seasons where status = 'en_cours' order by id desc limit 1;
  if s is null then
    insert into hg_arena_seasons (label, starts_at, ends_at)
      values ('Saison ' || (select coalesce(max(id), 0) + 1 from hg_arena_seasons), now(),
        now() + make_interval(days => (cfg->>'duree_jours')::int))
      returning id into s;
  end if;
  return s;
end $$;

-- Cotes de la saison en cours, classées (au moins min_combats combats). rk est null pour les autres.
create or replace function public.hg_arena_standings()
returns table (user_id uuid, rating int, matches int, wins int, losses int, draws int, rk int)
language sql stable security definer set search_path = public as $$
  with q as (select r.user_id, r.rating, r.matches, r.wins, r.losses, r.draws
    from hg_arena_ratings r join hg_profiles p on p.id = r.user_id and not p.is_ghost
    where r.matches >= (hg_arena_cfg()->>'min_combats')::int)
  select q.user_id, q.rating, q.matches, q.wins, q.losses, q.draws,
    rank() over (order by q.rating desc, q.wins desc, q.user_id)::int
  from q $$;

-- Lignes de classement d'une saison : en cours (cotes actuelles) ou close (résultats figés).
create or replace function public.hg_arena_rows(p_season int)
returns table (user_id uuid, rating int, league text, rk int, matches int, wins int, losses int, draws int, paid int)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.rating, hg_arena_league(s.rating, hg_arena_cfg()), s.rk, s.matches, s.wins, s.losses, s.draws, null::int
  from hg_arena_standings() s
  where exists (select 1 from hg_arena_seasons z where z.id = p_season and z.status = 'en_cours')
  union all
  select x.user_id, x.rating, x.league, x.rank, x.matches, x.wins, x.losses, x.draws, x.paid
  from hg_arena_results x where x.season_id = p_season and x.rank is not null $$;

-- Clôture d'une saison (appelée par hg_arena_season_close, qui vérifie les droits) : résultats, récompenses,
-- remise à niveau des cotes, saison suivante. Les paiements passent par hg_wallet_add (idempotent par référence).
create or replace function public.hg_arena_close_core(p_season int, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb := hg_arena_cfg(); m record; lg text; tot int; bq int; n int := 0; paid_sum int := 0; boost_sum int := 0;
  dep int := (cfg->>'depart')::int; pl int := (cfg->>'plancher')::int; nxt int;
begin
  for m in select * from hg_arena_standings() s where s.rk is not null order by s.rk loop
    lg := hg_arena_league(m.rating, cfg);
    tot := coalesce((cfg->'recompenses'->>lg)::int, 0);
    if m.rk <= 3 then tot := tot + coalesce((cfg->'podium'->>(m.rk::text))::int, 0); end if;
    tot := least(tot, (cfg->>'plafond_saison')::int);
    bq := coalesce((cfg->'boosters'->>lg)::int, 0);
    perform hg_eco_lock(m.user_id);
    insert into hg_arena_results (season_id, user_id, rating, league, rank, matches, wins, losses, draws, paid, boosters)
      values (p_season, m.user_id, m.rating, lg, m.rk, m.matches, m.wins, m.losses, m.draws, tot, bq);
    if tot > 0 then perform hg_wallet_add(m.user_id, tot, 'arene_saison', 'arene_saison:' || p_season || ':' || m.user_id); end if;
    if bq > 0 then
      insert into hg_wallet_log (user_id, delta, reason, ref) values (m.user_id, 0, 'arene_booster', 'arene_booster:' || p_season || ':' || m.user_id)
        on conflict do nothing;
      if found then
        insert into hg_booster_stock (user_id, type_id, qty) values (m.user_id, 'classique', 0) on conflict do nothing;
        update hg_booster_stock set qty = qty + bq where user_id = m.user_id and type_id = 'classique';
      end if;
    end if;
    paid_sum := paid_sum + tot; boost_sum := boost_sum + bq; n := n + 1;
  end loop;
  -- Combats insuffisants : pas de rang, pas de récompense, mais une ligne dans l'historique.
  insert into hg_arena_results (season_id, user_id, rating, league, rank, matches, wins, losses, draws, paid, boosters)
    select p_season, r.user_id, r.rating, hg_arena_league(r.rating, cfg), null, r.matches, r.wins, r.losses, r.draws, 0, 0
    from hg_arena_ratings r join hg_profiles p on p.id = r.user_id and not p.is_ghost
    where r.matches > 0 and r.matches < (cfg->>'min_combats')::int;
  -- Remise à niveau des cotes pour la saison suivante.
  update hg_arena_ratings set rating = greatest(pl, dep + round((rating - dep) * (cfg->>'reset_pct')::int / 100.0)::int),
    matches = 0, wins = 0, losses = 0, draws = 0, updated_at = now();
  update hg_arena_seasons set status = 'close', closed_at = now(), closed_by = p_by where id = p_season;
  nxt := hg_arena_season_ensure();
  return jsonb_build_object('season', p_season, 'classes', n, 'paillettes', paid_sum, 'boosters', boost_sum, 'suivante', nxt);
end $$;

-- ---------------------------------------------------------------------
-- 4. Combat
-- ---------------------------------------------------------------------
-- Paillettes d'Arène versées aujourd'hui à un membre (victoire du jour et défenses).
create or replace function public.hg_arena_paid_today(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from hg_wallet_log
  where user_id = p_user and reason in ('arene', 'arene_def') and delta > 0 and created_at >= hg_eco_day_start() $$;

-- Un combat vu par un membre (sens attaquant ou défenseur), même forme que l'Arène actuelle, plus cotes et variations.
create or replace function public.hg_arena_fight_view(f hg_arena_fights, p_me uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', f.id, 'created_at', f.created_at, 'season_id', f.season_id,
    'role', case when f.attacker_id = p_me then 'attaque' else 'defense' end,
    'attacker', jsonb_build_object('id', f.attacker_id, 'pseudo', pa.pseudo, 'color', pa.color),
    'defender', jsonb_build_object('id', f.defender_id, 'pseudo', pd.pseudo, 'color', pd.color),
    'attack', f.attack, 'defense', f.defense, 'duels', f.duels, 'wins_a', f.wins_a, 'wins_d', f.wins_d, 'result', f.result,
    'paid', case when f.attacker_id = p_me then f.paid_a else f.paid_d end,
    'rating', case when f.attacker_id = p_me then f.rating_a else f.rating_d end,
    'delta', case when f.attacker_id = p_me then f.delta_a else f.delta_d end,
    'seen', f.seen_at is not null)
  from hg_profiles pa, hg_profiles pd where pa.id = f.attacker_id and pd.id = f.defender_id $$;

-- Membre : attaque le deck de défense d'un membre avec 5 cartes. Résolu tout de suite, sans aléa.
create or replace function public.hg_arena_attack(p_defender uuid, p_copies bigint[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg jsonb := hg_arena_cfg(); d0 timestamptz := hg_eco_day_start(); sid int;
  ha jsonb; hd jsonb; dk hg_battle_decks; duels jsonb := '[]'::jsonb; i int; a jsonb; d jsonb; pa int; pd int; adv text;
  wa int := 0; wd int := 0; res text; f hg_arena_fights; ra int; rd int; ea numeric; sa numeric; dl int; nra int; nrd int;
  ga int := 0; gd int := 0; first_win boolean; dep int := (cfg->>'depart')::int; pl int := (cfg->>'plancher')::int; kf int := (cfg->>'k')::int;
begin
  perform hg_arena_gate();
  if not (cfg->>'actif')::boolean then raise exception 'L’Arène est en pause'; end if;
  if p_defender is null or p_defender = me then raise exception 'Choisis un autre membre'; end if;
  if not exists (select 1 from hg_profiles where id = p_defender and not is_ghost) then raise exception 'Membre inconnu'; end if;
  perform hg_eco_lock(least(me, p_defender));
  perform hg_eco_lock(greatest(me, p_defender));
  sid := hg_arena_season_ensure();
  if (select count(*) from hg_arena_fights where attacker_id = me and created_at >= d0) >= (cfg->>'attaques_jour')::int then
    raise exception 'Assez de combats pour aujourd’hui (% au plus). Reviens demain !', cfg->>'attaques_jour';
  end if;
  if (select count(*) from hg_arena_fights where attacker_id = me and defender_id = p_defender and created_at >= d0) >= (cfg->>'meme_adversaire')::int then
    raise exception 'Tu as déjà attaqué ce membre % fois aujourd’hui', cfg->>'meme_adversaire';
  end if;
  if (select count(*) from hg_arena_fights where defender_id = p_defender and created_at >= d0) >= (cfg->>'defenses_recues_jour')::int then
    raise exception 'Ce membre a déjà reçu assez d’attaques aujourd’hui. Reviens demain !';
  end if;
  select * into dk from hg_battle_decks where user_id = p_defender;
  if not found then raise exception 'Ce membre n''a pas encore de deck de défense'; end if;
  begin hd := hg_battle_hand(p_defender, dk.copy_ids);
  exception when others then raise exception 'Le deck de défense de ce membre n''est plus complet'; end;
  ha := hg_battle_hand(me, p_copies);
  first_win := false;
  for i in 0..4 loop
    a := ha->i; d := hd->i;
    pa := (a->>'power')::int; pd := (d->>'power')::int; adv := null;
    if hg_battle_beats(a->>'family', d->>'family') then pa := pa + 2; adv := 'a';
    elsif hg_battle_beats(d->>'family', a->>'family') then pd := pd + 2; adv := 'd'; end if;
    if pa > pd then wa := wa + 1; elsif pd > pa then wd := wd + 1; end if;
    duels := duels || jsonb_build_object('a', pa, 'd', pd, 'adv', adv, 'win', case when pa > pd then 'a' when pd > pa then 'd' else 'nul' end);
  end loop;
  res := case when wa > wd then 'victoire' when wd > wa then 'defaite' else 'egalite' end;

  -- Cotes : Elo à deux joueurs, ce que gagne l'un, l'autre le perd (plancher pour le défenseur).
  insert into hg_arena_ratings (user_id, rating, peak) values (me, dep, dep), (p_defender, dep, dep) on conflict (user_id) do nothing;
  select rating into ra from hg_arena_ratings where user_id = me;
  select rating into rd from hg_arena_ratings where user_id = p_defender;
  sa := case res when 'victoire' then 1 when 'defaite' then 0 else 0.5 end;
  ea := 1 / (1 + power(10, (rd - ra) / 400.0));
  dl := round(kf * (sa - ea))::int;
  nra := ra + dl;
  nrd := greatest(pl, rd - dl);
  update hg_arena_ratings set rating = nra, matches = matches + 1, wins = wins + (res = 'victoire')::int,
    losses = losses + (res = 'defaite')::int, draws = draws + (res = 'egalite')::int, peak = greatest(peak, nra), updated_at = now()
    where user_id = me;
  update hg_arena_ratings set rating = nrd, matches = matches + 1, wins = wins + (res = 'defaite')::int,
    losses = losses + (res = 'victoire')::int, draws = draws + (res = 'egalite')::int, peak = greatest(peak, nrd), updated_at = now()
    where user_id = p_defender;

  insert into hg_arena_fights (season_id, attacker_id, defender_id, attack, defense, duels, wins_a, wins_d, result, rating_a, rating_d, delta_a, delta_d)
    values (sid, me, p_defender, ha, hd, duels, wa, wd, res, ra, rd, nra - ra, nrd - rd) returning * into f;

  -- Paillettes : victoire du jour (1re seulement), défense tenue (3 par jour au plus), plafond Arène par jour.
  if (cfg->>'gains')::boolean then
    first_win := res = 'victoire' and not exists (select 1 from hg_arena_fights x
      where x.attacker_id = me and x.result = 'victoire' and x.created_at >= d0 and x.id <> f.id);
    if first_win and (cfg->>'gain_jour')::int > 0 and hg_arena_paid_today(me) + (cfg->>'gain_jour')::int <= (cfg->>'plafond_jour')::int then
      if hg_wallet_add(me, (cfg->>'gain_jour')::int, 'arene', 'arene:' || f.id) then ga := (cfg->>'gain_jour')::int; end if;
    end if;
    if res = 'defaite' and (cfg->>'gain_defense')::int > 0 and hg_eco_count(p_defender, 'arene_def', d0) < (cfg->>'defenses_jour')::int
       and hg_arena_paid_today(p_defender) + (cfg->>'gain_defense')::int <= (cfg->>'plafond_jour')::int then
      if hg_wallet_add(p_defender, (cfg->>'gain_defense')::int, 'arene_def', 'arene_def:' || f.id) then gd := (cfg->>'gain_defense')::int; end if;
    end if;
    update hg_arena_fights set paid_a = ga, paid_d = gd where id = f.id returning * into f;
  end if;
  return hg_arena_fight_view(f, me);
end $$;

-- Membre : marque comme vus les combats reçus.
create or replace function public.hg_arena_seen()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform hg_arena_gate();
  update hg_arena_fights set seen_at = now() where defender_id = auth.uid() and seen_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Membre : tout l'écran (réglages visibles, cote, ligue, rang, compteurs du jour, deck, cartes, adversaires,
-- historique, saisons passées). Aperçu : admin = true quand l'Arène n'est pas encore ouverte aux membres.
create or replace function public.hg_arena_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg jsonb := hg_arena_cfg(); d0 timestamptz := hg_eco_day_start(); sid int; s hg_arena_seasons;
  my hg_arena_ratings; rk int; dk hg_battle_decks; deck jsonb; ma_cote int; lg text; dk_att int; dk_rec int;
begin
  perform hg_arena_gate();
  sid := hg_arena_season_ensure();
  select * into s from hg_arena_seasons where id = sid;
  select * into my from hg_arena_ratings where user_id = me;
  ma_cote := coalesce(my.rating, (cfg->>'depart')::int);
  lg := hg_arena_league(ma_cote, cfg);
  select st.rk into rk from hg_arena_standings() st where st.user_id = me;
  select * into dk from hg_battle_decks where user_id = me;
  if found then begin deck := hg_battle_hand(me, dk.copy_ids); exception when others then deck := null; end; end if;
  dk_att := (select count(*) from hg_arena_fights where attacker_id = me and created_at >= d0);
  dk_rec := (select count(*) from hg_arena_fights where defender_id = me and created_at >= d0);
  return jsonb_build_object(
    'admin', hg_is_admin(), 'me_id', me, 'preview', not (cfg->>'v2_public')::boolean, 'cfg', cfg,
    'season', jsonb_build_object('id', s.id, 'label', s.label, 'starts_at', s.starts_at, 'ends_at', s.ends_at),
    'me', jsonb_build_object('rating', ma_cote, 'league', lg, 'rank', rk, 'matches', coalesce(my.matches, 0),
      'wins', coalesce(my.wins, 0), 'losses', coalesce(my.losses, 0), 'draws', coalesce(my.draws, 0),
      'peak', coalesce(my.peak, ma_cote), 'qualified', coalesce(my.matches, 0) >= (cfg->>'min_combats')::int,
      'attacks_today', dk_att, 'attacks_left', greatest(0, (cfg->>'attaques_jour')::int - dk_att),
      'paid_today', hg_arena_paid_today(me), 'defenses_today', hg_eco_count(me, 'arene_def', d0), 'received_today', dk_rec,
      'unseen', (select count(*) from hg_arena_fights where defender_id = me and seen_at is null)),
    'deck', deck, 'deck_ids', to_jsonb(dk.copy_ids),
    'copies', coalesce((select jsonb_agg(jsonb_build_object('copy_id', x.id, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity,
        'family', k.family, 'shiny', x.shiny, 'image_url', k.image_url, 'number', k.number,
        'power', hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end)
        order by hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end desc, k.name, x.id)
      from hg_card_copies x join hg_cards k on k.id = x.card_id
      where x.owner_id = me and x.recycled_at is null and x.locked_trade is null), '[]'::jsonb),
    'opponents', coalesce((select jsonb_agg(o.j order by o.dist, o.pseudo) from (
        select jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'color', p.color, 'avatar_url', p.avatar_url,
            'rating', coalesce(r.rating, (cfg->>'depart')::int), 'league', hg_arena_league(coalesce(r.rating, (cfg->>'depart')::int), cfg),
            'has_deck', exists (select 1 from hg_battle_decks z where z.user_id = p.id),
            'attacks_today', (select count(*) from hg_arena_fights f where f.attacker_id = me and f.defender_id = p.id and f.created_at >= d0),
            'received_today', (select count(*) from hg_arena_fights f where f.defender_id = p.id and f.created_at >= d0)) as j,
          abs(coalesce(r.rating, (cfg->>'depart')::int) - ma_cote) as dist, p.pseudo
        from hg_profiles p left join hg_arena_ratings r on r.user_id = p.id
        where p.id <> me and not p.is_ghost
        order by abs(coalesce(r.rating, (cfg->>'depart')::int) - ma_cote), p.pseudo
        limit 8) o), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(hg_arena_fight_view(f, me) order by f.created_at desc)
      from (select * from hg_arena_fights where attacker_id = me or defender_id = me order by created_at desc limit 30) f), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'season', t.label, 'ends_at', t.ends_at, 'rating', x.rating, 'league', x.league,
        'rank', x.rank, 'matches', x.matches, 'wins', x.wins, 'losses', x.losses, 'draws', x.draws, 'paid', x.paid, 'boosters', x.boosters)
        order by t.id desc)
      from (select * from hg_arena_results where user_id = me order by season_id desc limit 5) x
      join hg_arena_seasons t on t.id = x.season_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- 5. Classement
-- ---------------------------------------------------------------------
-- Classement d'une saison (en cours par défaut) : top 20, rang du membre. Gardée par hg_arena_gate.
create or replace function public.hg_arena_board_core(p_season int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); s hg_arena_seasons; res jsonb;
begin
  select * into s from hg_arena_seasons where id = p_season;
  if not found then raise exception 'Saison introuvable'; end if;
  select jsonb_build_object(
    'season', jsonb_build_object('id', s.id, 'label', s.label, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'status', s.status),
    'participants', (select count(*) from hg_arena_rows(s.id)),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', x.rk, 'user_id', x.user_id, 'pseudo', pr.pseudo, 'avatar_url', pr.avatar_url,
        'color', pr.color, 'rating', x.rating, 'league', x.league, 'wins', x.wins, 'matches', x.matches, 'paid', x.paid) order by x.rk)
      from (select * from hg_arena_rows(s.id) where rk is not null order by rk limit 20) x
      join hg_profiles pr on pr.id = x.user_id), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', x.rk, 'rating', x.rating, 'league', x.league, 'wins', x.wins, 'matches', x.matches)
      from hg_arena_rows(s.id) x where x.user_id = me))
  into res;
  return res;
end $$;

create or replace function public.hg_arena_board(p_season int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform hg_arena_gate();
  return hg_arena_board_core(coalesce(p_season, hg_arena_season_ensure()));
end $$;

-- ---------------------------------------------------------------------
-- 6. Staff « cartes » : aperçu, réglages, clôture de saison
-- ---------------------------------------------------------------------
create or replace function public.hg_arena_admin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  sid := hg_arena_season_ensure();
  return jsonb_build_object('admin', hg_is_admin(), 'cfg', hg_arena_cfg(), 'board', hg_arena_board_core(sid),
    'fights_today', (select count(*) from hg_arena_fights where created_at >= hg_eco_day_start()),
    'seasons', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
        'closed_at', t.closed_at, 'status', t.status,
        'participants', (select count(*) from hg_arena_results r where r.season_id = t.id and r.rank is not null),
        'paid', (select coalesce(sum(r.paid), 0) from hg_arena_results r where r.season_id = t.id))
      order by t.id desc) from (select * from hg_arena_seasons order by id desc limit 10) t), '[]'::jsonb));
end $$;

-- Staff « cartes » : réglages (bornés, journalisés). v2_public se change seulement par l'administrateur.
create or replace function public.hg_arena_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'arena'), '{}'::jsonb);
  before jsonb := hg_arena_cfg(); sp record; n int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglages invalides'; end if;
  for sp in select * from (values
      ('attaques_jour', '', 'attaques_jour', 1, 10), ('meme_adversaire', '', 'meme_adversaire', 1, 3),
      ('defenses_recues_jour', '', 'defenses_recues_jour', 1, 20), ('gain_jour', '', 'gain_jour', 0, 100),
      ('gain_defense', '', 'gain_defense', 0, 100), ('defenses_jour', '', 'defenses_jour', 0, 20),
      ('plafond_jour', '', 'plafond_jour', 0, 500), ('plafond_saison', '', 'plafond_saison', 0, 2000),
      ('depart', '', 'depart', 100, 3000), ('plancher', '', 'plancher', 0, 2000), ('k', '', 'k', 4, 64),
      ('reset_pct', '', 'reset_pct', 0, 100), ('duree_jours', '', 'duree_jours', 7, 120), ('min_combats', '', 'min_combats', 0, 50),
      ('seuils_argent', 'seuils', 'argent', 0, 5000), ('seuils_or', 'seuils', 'or', 0, 5000),
      ('seuils_diamant', 'seuils', 'diamant', 0, 5000), ('seuils_legende', 'seuils', 'legende', 0, 5000),
      ('recompenses_argent', 'recompenses', 'argent', 0, 1000), ('recompenses_or', 'recompenses', 'or', 0, 1000),
      ('recompenses_diamant', 'recompenses', 'diamant', 0, 1000), ('recompenses_legende', 'recompenses', 'legende', 0, 1000),
      ('boosters_diamant', 'boosters', 'diamant', 0, 10), ('boosters_legende', 'boosters', 'legende', 0, 10),
      ('podium_1', 'podium', '1', 0, 1000), ('podium_2', 'podium', '2', 0, 1000), ('podium_3', 'podium', '3', 0, 1000)
    ) as t(key, g, k, lo, hi) loop
    if p ? sp.key then
      if coalesce(p->>sp.key, '') !~ '^\d{1,9}$' then raise exception 'Valeur invalide pour %', sp.key; end if;
      n := (p->>sp.key)::int;
      if n < sp.lo or n > sp.hi then raise exception 'Valeur hors limites pour % (de % à %)', sp.key, sp.lo, sp.hi; end if;
      if sp.g = '' then
        v := jsonb_set(v, array[sp.k], to_jsonb(n), true);
      else
        if jsonb_typeof(v->sp.g) is distinct from 'object' then v := jsonb_set(v, array[sp.g], '{}'::jsonb, true); end if;
        v := jsonb_set(v, array[sp.g, sp.k], to_jsonb(n), true);
      end if;
    end if;
  end loop;
  if p ? 'actif' then
    if jsonb_typeof(p->'actif') <> 'boolean' then raise exception 'Valeur invalide pour actif'; end if;
    v := jsonb_set(v, '{actif}', p->'actif', true);
  end if;
  if p ? 'gains' then
    if jsonb_typeof(p->'gains') <> 'boolean' then raise exception 'Valeur invalide pour gains'; end if;
    v := jsonb_set(v, '{gains}', p->'gains', true);
  end if;
  if p ? 'v2_public' then
    if not hg_is_admin() then raise exception 'Seul l’administrateur peut ouvrir l’Arène aux membres'; end if;
    if jsonb_typeof(p->'v2_public') <> 'boolean' then raise exception 'Valeur invalide pour v2_public'; end if;
    v := jsonb_set(v, '{v2_public}', p->'v2_public', true);
  end if;
  insert into hg_settings (key, value) values ('arena', v) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('arene_reglages', null, null, jsonb_build_object('avant', before, 'apres', hg_arena_cfg()));
  return hg_arena_cfg();
end $$;

-- Staff « cartes » : clôture la saison en cours (récompenses, remise à niveau, saison suivante), journalisée.
create or replace function public.hg_arena_season_close()
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid int; res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  sid := hg_arena_season_ensure();
  res := hg_arena_close_core(sid, auth.uid());
  perform hg_admin_audit('arene_saison_cloturee', null, sid::text, res);
  return res;
end $$;

-- ---------------------------------------------------------------------
-- 7. Droits d'exécution
-- ---------------------------------------------------------------------
do $d$
declare f text;
begin
  -- Fonctions internes : jamais appelées directement par un client.
  foreach f in array array['hg_arena_num(jsonb, text, integer, integer, integer)', 'hg_arena_cfg()', 'hg_arena_league(integer, jsonb)',
    'hg_arena_gate()', 'hg_arena_season_ensure()', 'hg_arena_standings()', 'hg_arena_rows(integer)', 'hg_arena_close_core(integer, uuid)',
    'hg_arena_paid_today(uuid)', 'hg_arena_fight_view(hg_arena_fights, uuid)', 'hg_arena_board_core(integer)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  -- RPC des membres (gardées par hg_arena_gate) et du Staff (droits contrôlés dans chaque fonction).
  foreach f in array array['hg_arena_me()', 'hg_arena_attack(uuid, bigint[])', 'hg_arena_seen()', 'hg_arena_board(integer)',
    'hg_arena_admin()', 'hg_arena_settings_save(jsonb)', 'hg_arena_season_close()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $d$;

-- Première saison (créée une fois, si aucune n'existe).
do $$ begin perform public.hg_arena_season_ensure(); end $$;
