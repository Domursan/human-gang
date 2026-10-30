-- ===== Humane Gang — migration 179 : jeux quotidiens sur 10 points, 200 ✦ au maximum =====
-- Demande d'Ethan (30.10.2026), pour les 19 jeux de la section « Jeux quotidiens » :
-- 1. Chaque jeu rapporte de 0 à 10 points : réussi au palier 1 = 10 points, puis −1 par palier (au moins 1) ; raté = 0.
--    Les paliers ne changent pas (numéro de l'essai, erreurs + 1, tranches de temps… : migration 157) ; un jeu en 6 essais
--    va donc de 10 (1er essai) à 5 (6e essai).
-- 2. Paillettes : 200 à 10 points, puis −15 par point manquant (1 point = 65, raté = 50).
--    Réglable : hg_eco_cap('jeux_gain_max', 200), 'jeux_gain_pas' (15).
-- 3. GeoGuessr, Qui a dit ça ? et la Question du jour passent aussi par hg_jeux_fin (classement, pastille « ✓ N pts ») :
--    GeoGuessr = score sur 5 000 ramené sur 10 (500 = 1 point), Question du jour = 10 si juste, Qui a dit ça ? = la
--    première citation répondue du jour, 10 si juste. Leur ancien gain du jour (1 ✦ par 100 points de GeoGuessr, bonus de
--    la Question du jour) est remplacé ; la récompense propre à chaque citation, les paliers de série de la Question du
--    jour et le podium du lundi de GeoGuessr ne changent pas.
-- 4. Le bonus « tous les jeux » (250 ✦) compte toujours les 16 mêmes jeux (hg_jeux_bonus_liste).
-- 5. hg_jeux_resultats garde les Paillettes dans « points » et reçoit « score » (0 à 10) ; les classements se font sur ce
--    score. Les parties déjà notées reçoivent le score calculé depuis leur palier (aucune autre valeur modifiée).
-- Rejouable.

-- ---------------------------------------------------------------------
-- 1. Score sur 10 et Paillettes
-- ---------------------------------------------------------------------
alter table public.hg_jeux_resultats add column if not exists score int;
update public.hg_jeux_resultats set score = case when reussi then greatest(1, 11 - palier) else 0 end where score is null;
alter table public.hg_jeux_resultats alter column score set default 0;
alter table public.hg_jeux_resultats alter column score set not null;

-- Les 19 jeux notés (classement général, pastilles) et les 16 du bonus « tous les jeux ».
create or replace function public.hg_jeux_liste()
returns text[] language sql immutable as $$
  select array['sutom', 'framed', 'heardle', 'code_jour', 'nj_carte', 'nj_jv', 'nj_pochette', 'nj_replique', 'nj_pays',
    'nj_plat', 'nj_connexions', 'nj_motscroises', 'nj_motmele', 'nj_anagramme', 'nj_nerdle', 'nj_sudoku',
    'geo', 'citations', 'quiz_jour'] $$;
create or replace function public.hg_jeux_bonus_liste()
returns text[] language sql immutable as $$
  select array['sutom', 'framed', 'heardle', 'code_jour', 'nj_carte', 'nj_jv', 'nj_pochette', 'nj_replique', 'nj_pays',
    'nj_plat', 'nj_connexions', 'nj_motscroises', 'nj_motmele', 'nj_anagramme', 'nj_nerdle', 'nj_sudoku'] $$;

-- Points d'une partie : 10 au palier 1, −1 par palier (au moins 1) ; ratée : 0.
create or replace function public.hg_jeux_score(p_reussi boolean, p_palier int)
returns int language sql immutable as $$
  select case when coalesce(p_reussi, false) then greatest(1, 11 - greatest(coalesce(p_palier, 1), 1)) else 0 end $$;

-- Paillettes selon les points : 200 à 10 points, −15 par point manquant (0 point = 50).
create or replace function public.hg_jeux_paillettes(p_score int)
returns int language sql stable security definer set search_path = public as $$
  select greatest(0, hg_eco_cap('jeux_gain_max', 200) - hg_eco_cap('jeux_gain_pas', 15) * (10 - least(10, greatest(0, coalesce(p_score, 0))))) $$;

create or replace function public.hg_jeux_gain(p_reussi boolean, p_palier int)
returns int language sql stable security definer set search_path = public as $$
  select hg_jeux_paillettes(hg_jeux_score(p_reussi, p_palier)) $$;

-- Fin de partie : note le résultat (une fois), paie les Paillettes, puis le bonus si les 16 jeux du bonus sont faits.
create or replace function public.hg_jeux_fin(p_jeu text, p_day date, p_user uuid, p_reussi boolean, p_palier int, p_secondes numeric)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_score int; v_points int; n int; v_bonus int;
begin
  if p_user is null or p_day is null or not (p_jeu = any (hg_jeux_liste())) then return 0; end if;
  v_score := hg_jeux_score(p_reussi, p_palier);
  v_points := hg_jeux_paillettes(v_score);
  insert into hg_jeux_resultats (jeu, day, user_id, reussi, palier, points, score, secondes)
    values (p_jeu, p_day, p_user, coalesce(p_reussi, false), greatest(coalesce(p_palier, 1), 1), v_points, v_score, round(p_secondes, 2))
    on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;
  if v_points > 0 then perform hg_wallet_add(p_user, v_points, 'jeux', 'jeux:' || p_jeu || ':' || p_day::text); end if;
  if p_jeu = any (hg_jeux_bonus_liste())
     and (select count(distinct jeu) from hg_jeux_resultats where user_id = p_user and day = p_day and jeu = any (hg_jeux_bonus_liste()))
       >= cardinality(hg_jeux_bonus_liste()) then
    v_bonus := hg_eco_cap('jeux_bonus_tous', 250);
    insert into hg_jeux_bonus (day, user_id, points) values (p_day, p_user, v_bonus) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 and v_bonus > 0 then perform hg_wallet_add(p_user, v_bonus, 'jeux_bonus', 'jeux_bonus:' || p_day::text); end if;
  end if;
  return v_points;
end $$;

-- Récompense affichée par les jeux « devine », Framed et Heardle : avant la fin, le maximum (200) ou ce que rapporte une
-- partie ratée (50) ; une fois la partie du jour terminée, ce que le membre a vraiment gagné.
create or replace function public.hg_daily_reward(p_game text, p_solved boolean)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select r.points from hg_jeux_resultats r
      where r.jeu = p_game and r.user_id = auth.uid()
        and r.day = (select max(g.day) from hg_daily_games g where g.game = p_game and g.user_id = auth.uid() and g.finished)
        and r.reussi = coalesce(p_solved, false)),
    case when coalesce(p_solved, false) then hg_jeux_paillettes(10) else hg_jeux_paillettes(0) end) $$;

-- ---------------------------------------------------------------------
-- 2. Points des jeux sur 10
-- ---------------------------------------------------------------------
-- Jeux « devine », Framed, Heardle : 10 au 1er essai, 5 au 6e.
alter table public.hg_daily_games drop constraint if exists hg_daily_games_score_check;
alter table public.hg_daily_games add constraint hg_daily_games_score_check check (score between 0 and 10);
select public.hg__patch('public.hg_daily_apply(text, date, text, text)'::regprocedure,
  $o$g.solved := true; g.finished := true; g.score := 7 - n;$o$,
  $n$g.solved := true; g.finished := true; g.score := hg_jeux_score(true, n);$n$);

-- Grilles (Connexions, Mots croisés, Mot mêlé, Nerdle) : le score de la partie devient les points notés ; Anagramme garde
-- son nombre de mots trouvés et donne ses points à part (hg_nj_grille_etat).
select public.hg__patch('public.hg_nj_grille_essai(text, jsonb)'::regprocedure,
  $o$        else 1 end,
      pa.secondes);$o$,
  $n$        else 1 end,
      pa.secondes);
    if p_jeu <> 'anagramme' then
      pa.score := coalesce((select r.score from hg_jeux_resultats r where r.jeu = 'nj_' || p_jeu and r.day = d and r.user_id = me), pa.score);
    end if;$n$);
select public.hg__patch('public.hg_nj_grille_etat(text)'::regprocedure,
  $o$'debut', p.started_at, 'reward', p.rewarded) end,$o$,
  $n$'debut', p.started_at, 'reward', p.rewarded,
      'points', (select r.score from hg_jeux_resultats r where r.jeu = 'nj_' || p_jeu and r.day = d and r.user_id = auth.uid())) end,$n$);

-- ---------------------------------------------------------------------
-- 3. GeoGuessr, Qui a dit ça ?, Question du jour
-- ---------------------------------------------------------------------
-- GeoGuessr : manche du jour notée sur 10 (score / 500, arrondi) ; les manches passées restent pour l'honneur.
select public.hg__patch('public.hg_geo_guess(uuid, double precision, double precision)'::regprocedure,
  $o$    gain := greatest(0, least(sc / hg_jeux_cap('geo_points_par_paillette', 100, 1, 5000), cap - deja));$o$,
  $n$    gain := hg_jeux_fin('geo', d, me, round(sc / 500.0) > 0, 11 - least(10, round(sc / 500.0))::int, null);$n$);
select public.hg__patch('public.hg_geo_guess(uuid, double precision, double precision)'::regprocedure,
  $o$  if gain > 0 and not hg_wallet_add(me, gain, 'geo', 'geo:' || r.id::text) then
    gain := 0;
    update hg_geo_guesses set reward = 0 where round_id = r.id and user_id = me;
  end if;$o$,
  $n$  -- Paillettes déjà versées par hg_jeux_fin (migration 179).$n$);

-- Qui a dit ça ? : la première citation répondue du jour compte comme partie du jour.
select public.hg__patch('public.hg_quiz_answer(uuid, jsonb)'::regprocedure,
  $o$  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;$o$,
  $n$  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  if q.category = hg_quote_category() then perform hg_jeux_fin('citations', hg_jeux_today(), me, ok, 1, null); end if;$n$);

-- Question du jour : 200 si juste, 50 sinon (à la place du bonus de réponse).
select public.hg__patch('public.hg_quiz_daily_answer(jsonb)'::regprocedure,
  $o$  bonus := (cfg->>'bonus')::int;
  if bonus > 0 and not hg_wallet_add(me, bonus, 'quiz_jour', 'quiz_jour:' || dd::text) then bonus := 0; end if;$o$,
  $n$  bonus := hg_jeux_fin('quiz_jour', dd, me, ok, 1, null);$n$);
select public.hg__patch('public.hg_quiz_daily_today()'::regprocedure,
  $o$return jsonb_build_object('day', dd, 'question', null, 'bonus', cfg->'bonus',$o$,
  $n$return jsonb_build_object('day', dd, 'question', null, 'bonus', hg_jeux_paillettes(10),$n$);
select public.hg__patch('public.hg_quiz_daily_today()'::regprocedure,
  $o$'bonus', cfg->'bonus', 'paliers', cfg->'paliers',$o$,
  $n$'bonus', hg_jeux_paillettes(10), 'paliers', cfg->'paliers',$n$);

-- ---------------------------------------------------------------------
-- 4. Classements sur les points (0 à 10 par jeu)
-- ---------------------------------------------------------------------
create or replace function public.hg_jeux_classement(p_jeu text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Zurich')::date; lundi date; jeux text[];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  lundi := d - (extract(isodow from d)::int - 1);
  jeux := case when p_jeu is null then hg_jeux_liste() when p_jeu = any (hg_jeux_liste()) then array[p_jeu] end;
  if jeux is null then raise exception 'Jeu inconnu'; end if;
  return jsonb_build_object(
    'jeu', p_jeu, 'day', d, 'lundi', lundi, 'total_jeux', cardinality(hg_jeux_bonus_liste()),
    'bonus', hg_eco_cap('jeux_bonus_tous', 250), 'max', hg_jeux_paillettes(10), 'pas', hg_eco_cap('jeux_gain_pas', 15),
    'rate', hg_jeux_paillettes(0),
    'jour', coalesce((select jsonb_agg(x order by x.points desc, x.secondes nulls last, x.pseudo) from (
      select r.user_id, p.pseudo, p.color, p.avatar_url, sum(r.score)::int as points, sum(r.points)::int as paillettes,
        count(*)::int as parties, count(*) filter (where r.reussi)::int as reussies, min(r.palier)::int as palier,
        sum(r.secondes)::numeric(10, 2) as secondes, bool_or(b.user_id is not null) as bonus
      from hg_jeux_resultats r join hg_profiles p on p.id = r.user_id
      left join hg_jeux_bonus b on b.user_id = r.user_id and b.day = r.day
      where r.day = d and r.jeu = any (jeux) and not coalesce(p.is_ghost, false)
      group by r.user_id, p.pseudo, p.color, p.avatar_url
      order by sum(r.score) desc, sum(r.secondes) nulls last limit 50) x), '[]'::jsonb),
    'semaine', coalesce((select jsonb_agg(x order by x.points desc, x.pseudo) from (
      select r.user_id, p.pseudo, p.color, p.avatar_url, sum(r.score)::int as points, sum(r.points)::int as paillettes,
        count(*)::int as parties, count(*) filter (where r.reussi)::int as reussies
      from hg_jeux_resultats r join hg_profiles p on p.id = r.user_id
      where r.day between lundi and d and r.jeu = any (jeux) and not coalesce(p.is_ghost, false)
      group by r.user_id, p.pseudo, p.color, p.avatar_url
      order by 5 desc limit 50) x), '[]'::jsonb),
    'moi', jsonb_build_object(
      'faits', (select count(distinct jeu) from hg_jeux_resultats where user_id = auth.uid() and day = d and jeu = any (hg_jeux_bonus_liste())),
      'bonus', exists (select 1 from hg_jeux_bonus where user_id = auth.uid() and day = d),
      'jeux', coalesce((select jsonb_object_agg(jeu, jsonb_build_object('points', points, 'score', score, 'reussi', reussi, 'palier', palier))
        from hg_jeux_resultats where user_id = auth.uid() and day = d), '{}'::jsonb)));
end $$;

revoke all on function public.hg_jeux_gain(boolean, int), public.hg_jeux_fin(text, date, uuid, boolean, int, numeric),
  public.hg_jeux_paillettes(int) from public, anon, authenticated;
revoke all on function public.hg_jeux_classement(text) from public, anon;
grant execute on function public.hg_jeux_classement(text) to authenticated;
grant execute on function public.hg_jeux_liste(), public.hg_jeux_bonus_liste(), public.hg_jeux_score(boolean, int) to authenticated;
