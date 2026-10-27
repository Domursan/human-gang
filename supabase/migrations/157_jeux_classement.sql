-- ===== Humane Gang — migration 157 : classement des jeux du jour, récompenses à paliers, bonus « tous les jeux » =====
-- Demande d'Ethan (27.10.2026), pour 16 jeux : Sutom HG, Framed, Heardle, Code du jour, Carte mystère, Jeu vidéo du jour,
-- Pochette du jour, Réplique du jour, Pays du jour, Plat du jour, Connexions, Mots croisés, Mot mêlé, Anagramme,
-- Nerdle du gang, Sudoku du jour.
-- 1. Récompense par jeu et par jour selon la performance : réussi au palier 1 = 150 ✦, puis −10 ✦ par palier
--    (au moins 10 ✦) ; raté = 10 ✦. Palier = numéro de l'essai (Sutom, Framed, Heardle, jeux « devine », Nerdle + indices,
--    Code du jour), nombre d'erreurs + 1 (Connexions, Mots croisés), mots manqués + 1 (Anagramme), tranches de 2 minutes
--    au-delà de 3 minutes (Mot mêlé) ou de 5 minutes (Sudoku). Réglable : hg_eco_cap('jeux_gain_max', 150),
--    'jeux_gain_pas' (10), 'jeux_gain_rate' (10).
-- 2. Chaque fin de partie est notée dans hg_jeux_resultats (une ligne par jeu, jour et membre) par hg_jeux_fin, qui paie
--    la récompense (une seule fois) et, quand les 16 jeux sont terminés le même jour (réussis ou non), le bonus de 250 ✦
--    (hg_eco_cap('jeux_bonus_tous', 250), une fois par jour : hg_jeux_bonus).
-- 3. Classements : hg_jeux_classement(p_jeu) → du jour (points, puis temps) et de la semaine (somme des points, lundi à
--    dimanche) ; p_jeu null = classement général (tous les jeux).
-- Les anciennes récompenses (10 / 3 ✦, Code du jour 30 ✦) sont remplacées dans les fonctions de fin de partie.

create table if not exists public.hg_jeux_resultats (
  jeu text not null,
  day date not null,
  user_id uuid not null references public.hg_profiles(id) on update cascade,
  reussi boolean not null default false,
  palier int not null default 1,
  points int not null default 0,
  secondes numeric(9, 2),
  created_at timestamptz not null default now(),
  primary key (jeu, day, user_id)
);
create index if not exists hg_jeux_resultats_day_idx on public.hg_jeux_resultats (day, user_id);
alter table public.hg_jeux_resultats enable row level security;

create table if not exists public.hg_jeux_bonus (
  day date not null,
  user_id uuid not null references public.hg_profiles(id) on update cascade,
  points int not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table public.hg_jeux_bonus enable row level security;

-- Les 16 jeux comptés pour le bonus et le classement général (clés utilisées dans hg_jeux_resultats).
create or replace function public.hg_jeux_liste()
returns text[] language sql immutable as $$
  select array['sutom', 'framed', 'heardle', 'code_jour', 'nj_carte', 'nj_jv', 'nj_pochette', 'nj_replique', 'nj_pays',
    'nj_plat', 'nj_connexions', 'nj_motscroises', 'nj_motmele', 'nj_anagramme', 'nj_nerdle', 'nj_sudoku'] $$;

-- Récompense d'une partie : 150 au palier 1, −10 par palier (au moins 10) ; ratée : 10.
create or replace function public.hg_jeux_gain(p_reussi boolean, p_palier int)
returns int language sql stable security definer set search_path = public as $$
  select case when coalesce(p_reussi, false)
    then greatest(hg_eco_cap('jeux_gain_rate', 10),
      hg_eco_cap('jeux_gain_max', 150) - hg_eco_cap('jeux_gain_pas', 10) * (greatest(coalesce(p_palier, 1), 1) - 1))
    else hg_eco_cap('jeux_gain_rate', 10) end $$;

-- Fin de partie d'un des 16 jeux : note le résultat (une fois), paie la récompense, puis le bonus si les 16 sont faits.
-- Renvoie les Paillettes versées pour la partie (0 si le résultat était déjà noté).
create or replace function public.hg_jeux_fin(p_jeu text, p_day date, p_user uuid, p_reussi boolean, p_palier int, p_secondes numeric)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_points int; n int; v_bonus int;
begin
  if p_user is null or p_day is null or not (p_jeu = any (hg_jeux_liste())) then return 0; end if;
  v_points := hg_jeux_gain(p_reussi, p_palier);
  insert into hg_jeux_resultats (jeu, day, user_id, reussi, palier, points, secondes)
    values (p_jeu, p_day, p_user, coalesce(p_reussi, false), greatest(coalesce(p_palier, 1), 1), v_points, round(p_secondes, 2))
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;
  if v_points > 0 then perform hg_wallet_add(p_user, v_points, 'jeux', 'jeux:' || p_jeu || ':' || p_day::text); end if;
  -- Bonus : les 16 jeux terminés le même jour.
  if (select count(distinct jeu) from hg_jeux_resultats where user_id = p_user and day = p_day and jeu = any (hg_jeux_liste()))
     >= cardinality(hg_jeux_liste()) then
    v_bonus := hg_eco_cap('jeux_bonus_tous', 250);
    insert into hg_jeux_bonus (day, user_id, points) values (p_day, p_user, v_bonus) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 and v_bonus > 0 then perform hg_wallet_add(p_user, v_bonus, 'jeux_bonus', 'jeux_bonus:' || p_day::text); end if;
  end if;
  return v_points;
end $$;

-- Récompense affichée par les jeux « devine », Framed et Heardle : avant la fin, le maximum (150) ou la consolation (10) ;
-- une fois la partie du jour terminée, ce que le membre a vraiment gagné.
create or replace function public.hg_daily_reward(p_game text, p_solved boolean)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.points from hg_jeux_resultats r
      where r.jeu = p_game and r.user_id = auth.uid()
        and r.day = (select max(g.day) from hg_daily_games g where g.game = p_game and g.user_id = auth.uid() and g.finished)
        and r.reussi = coalesce(p_solved, false)),
    case when coalesce(p_solved, false) then hg_eco_cap('jeux_gain_max', 150) else hg_eco_cap('jeux_gain_rate', 10) end) $$;

-- Jeux « devine », Framed, Heardle : paiement par hg_jeux_fin (palier = numéro de l'essai).
select public.hg__patch('public.hg_daily_apply(text, date, text, text)'::regprocedure,
  $o$    perform hg_wallet_add(me, hg_daily_reward(p_game, g.solved), p_game, p_game || ':' || p_day::text);$o$,
  $n$    perform hg_jeux_fin(p_game, p_day, me, g.solved, n, extract(epoch from now() - g.created_at)::numeric);$n$);

-- Sutom HG.
select public.hg__patch('public.hg_sutom_guess(text)'::regprocedure,
  $o$    gain := case when v_solved then least(greatest(hg_eco_cap('sutom_trouve', 10), 0), 100)
                 else least(greatest(hg_eco_cap('sutom_perdu', 3), 0), 100) end;
    if gain > 0 and not hg_wallet_add(me, gain, 'sutom', 'sutom:' || dd::text) then gain := 0; end if;$o$,
  $n$    gain := hg_jeux_fin('sutom', dd, me, v_solved, cardinality(g.guesses) + 1, extract(epoch from now() - g.started_at)::numeric);$n$);

-- Code du jour : réussi (palier = essai) ou raté au 10e essai.
select public.hg__patch('public.hg_duel_jour_essayer(text)'::regprocedure,
  $o$v_gain := coalesce((cfg->'paillettes'->>'code_du_jour')::int, 30);
select coalesce(sum(delta), 0) into v_jour from hg_wallet_log where user_id = auth.uid() and reason = 'duels' and created_at >= v_debut;
v_gain := greatest(0, least(v_gain, coalesce((cfg->>'plafond_jour')::int, 500) - v_jour));
if v_gain > 0 then perform hg_wallet_add(auth.uid(), v_gain, 'duels', 'duel_jour:' || d || ':' || auth.uid()); end if;$o$,
  $n$v_gain := hg_jeux_fin('code_jour', d, auth.uid(), true, v_n + 1,
  extract(epoch from now() - (select min(created_at) from hg_duel_jour_essais where jour = d and user_id = auth.uid()))::numeric);$n$);
select public.hg__patch('public.hg_duel_jour_essayer(text)'::regprocedure,
  $o$return hg_duel_jour();
end$o$,
  $n$if sc.bien < 4 and v_n + 1 >= 10 and exists (select 1 from hg_profiles where id = auth.uid() and not is_ghost) then
perform hg_jeux_fin('code_jour', d, auth.uid(), false, 10, null);
end if;
return hg_duel_jour();
end$n$);

-- Grilles du jour (Connexions, Mots croisés, Mot mêlé, Anagramme, Nerdle).
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$    if pa.score > 0 then
      gain := least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10)));
      if gain > 0 then
        pa.rewarded := gain;
        perform hg_wallet_add(me, gain, 'nj_' || p_jeu, 'nj_' || p_jeu || ':' || d::text);
      end if;
    end if;$o$,
  $n$    pa.rewarded := hg_jeux_fin('nj_' || p_jeu, d, me,
      case when p_jeu = 'anagramme' then pa.score > 0 else pa.gagne end,
      case p_jeu
        when 'connexions' then pa.erreurs + 1
        when 'motscroises' then pa.erreurs + 1
        when 'nerdle' then jsonb_array_length(coalesce(pa.etat->'essais', '[]'::jsonb)) + jsonb_array_length(coalesce(pa.etat->'indices', '[]'::jsonb))
        when 'anagramme' then 1 + greatest(0, jsonb_array_length(g.secret->'mots') - pa.score)
        when 'motmele' then 1 + greatest(0, floor((coalesce(pa.secondes, 0) - 180) / 120))::int
        else 1 end,
      pa.secondes);$n$);

-- Sudoku du jour : réussi seulement (palier = tranches de 2 minutes au-delà de 5 minutes). Démineur et 2048 : inchangés.
select public.hg__patch('public.hg_nj_solo_fin(uuid, jsonb)'::regprocedure,
  $o$  if ok and not exists (select 1 from hg_nj_solo where user_id = me and jeu = r.jeu and day = r.day and rewarded > 0) then$o$,
  $n$  if r.jeu = 'sudoku' then
    if ok then
      gain := hg_jeux_fin('nj_sudoku', r.day, me, true, 1 + greatest(0, floor((secs - 300) / 120))::int, secs);
      if gain > 0 then update hg_nj_solo set rewarded = gain where id = r.id; end if;
    end if;
  elsif ok and not exists (select 1 from hg_nj_solo where user_id = me and jeu = r.jeu and day = r.day and rewarded > 0) then$n$);

-- Affichages : gain possible (grilles, Sudoku) et gain obtenu (Sutom) selon le nouveau barème.
select public.hg__patch('public.hg_nj_grille_etat(text)'::regprocedure,
  $o$    'gain', least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10))),$o$,
  $n$    'gain', hg_jeux_gain(true, 1),$n$);
select public.hg__patch('public.hg_nj_solo_etat(text, text)'::regprocedure,
  $o$    'gain', least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10))),$o$,
  $n$    'gain', case when p_jeu = 'sudoku' then hg_jeux_gain(true, 1) else least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10))) end,$n$);
select public.hg__patch('public.hg_sutom_state()'::regprocedure,
  $o$    'gain', case when fin then (select delta from hg_wallet_log where user_id = me and reason = 'sutom' and ref = 'sutom:' || dd::text) end);$o$,
  $n$    'gain', case when fin then coalesce((select points from hg_jeux_resultats where jeu = 'sutom' and day = dd and user_id = me),
      (select delta from hg_wallet_log where user_id = me and reason = 'sutom' and ref = 'sutom:' || dd::text)) end);$n$);

-- Classements (membres) : du jour et de la semaine, pour un jeu ou pour tous (p_jeu null).
create or replace function public.hg_jeux_classement(p_jeu text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Zurich')::date; lundi date; jeux text[];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  lundi := d - (extract(isodow from d)::int - 1);
  jeux := case when p_jeu is null then hg_jeux_liste() when p_jeu = any (hg_jeux_liste()) then array[p_jeu] end;
  if jeux is null then raise exception 'Jeu inconnu'; end if;
  return jsonb_build_object(
    'jeu', p_jeu, 'day', d, 'lundi', lundi, 'total_jeux', cardinality(hg_jeux_liste()),
    'bonus', hg_eco_cap('jeux_bonus_tous', 250), 'max', hg_eco_cap('jeux_gain_max', 150),
    'jour', coalesce((select jsonb_agg(x order by x.points desc, x.secondes nulls last, x.pseudo) from (
      select r.user_id, p.pseudo, p.color, p.avatar_url, sum(r.points)::int as points, count(*)::int as parties,
        count(*) filter (where r.reussi)::int as reussies, min(r.palier)::int as palier,
        sum(r.secondes)::numeric(10, 2) as secondes, bool_or(b.user_id is not null) as bonus
      from hg_jeux_resultats r join hg_profiles p on p.id = r.user_id
      left join hg_jeux_bonus b on b.user_id = r.user_id and b.day = r.day
      where r.day = d and r.jeu = any (jeux) and not coalesce(p.is_ghost, false)
      group by r.user_id, p.pseudo, p.color, p.avatar_url
      order by sum(r.points) desc, sum(r.secondes) nulls last limit 50) x), '[]'::jsonb),
    'semaine', coalesce((select jsonb_agg(x order by x.points desc, x.pseudo) from (
      select r.user_id, p.pseudo, p.color, p.avatar_url,
        (sum(r.points) + case when p_jeu is null then coalesce((select sum(b.points) from hg_jeux_bonus b
          where b.user_id = r.user_id and b.day between lundi and d), 0) else 0 end)::int as points,
        count(*)::int as parties, count(*) filter (where r.reussi)::int as reussies
      from hg_jeux_resultats r join hg_profiles p on p.id = r.user_id
      where r.day between lundi and d and r.jeu = any (jeux) and not coalesce(p.is_ghost, false)
      group by r.user_id, p.pseudo, p.color, p.avatar_url
      order by 5 desc limit 50) x), '[]'::jsonb),
    'moi', jsonb_build_object(
      'faits', (select count(distinct jeu) from hg_jeux_resultats where user_id = auth.uid() and day = d and jeu = any (hg_jeux_liste())),
      'bonus', exists (select 1 from hg_jeux_bonus where user_id = auth.uid() and day = d),
      'jeux', coalesce((select jsonb_object_agg(jeu, jsonb_build_object('points', points, 'reussi', reussi, 'palier', palier))
        from hg_jeux_resultats where user_id = auth.uid() and day = d), '{}'::jsonb)));
end $$;

revoke all on function public.hg_jeux_gain(boolean, int), public.hg_jeux_fin(text, date, uuid, boolean, int, numeric) from public, anon, authenticated;
revoke all on function public.hg_jeux_classement(text) from public, anon;
grant execute on function public.hg_jeux_classement(text) to authenticated;
grant execute on function public.hg_jeux_liste() to authenticated;
