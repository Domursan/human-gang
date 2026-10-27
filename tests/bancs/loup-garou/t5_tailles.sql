-- Scénario 5 : parties complètes de 6 à 50 joueurs (répartition automatique du site, puis composition riche en rôles),
-- jouées jusqu'au bout par un pilote automatique. Vérifie : fin de partie, vainqueur, cartes, état lisible, Paillettes.
\set ON_ERROR_STOP 1
insert into hg_profiles(id, pseudo, color, is_admin) select t_uid(i), 'Joueur' || i, '#ABCDEF', false from generate_series(14, 60) i on conflict do nothing;
update hg_settings set value = jsonb_set(value, '{testeurs}', (select jsonb_agg(t_uid(i)::text) from generate_series(2, 60) i where i <> 13)) where key = 'loup_garou';
-- joueur i de la partie : 1..12 puis 14..
create or replace function t_j(i int) returns int language sql immutable as $$ select case when i < 13 then i else i + 1 end $$;

-- Répartition automatique identique à creer.js (repartitionAuto)
create or replace function t_compo_auto(n int) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('loup-garou', greatest(1, n / 4), 'voyante', case when n >= 6 then 1 end, 'sorciere', case when n >= 8 then 1 end,
    'chasseur', case when n >= 10 then 1 end, 'cupidon', case when n >= 12 then 1 end,
    'villageois', n - greatest(1, n / 4) - (n >= 6)::int - (n >= 8)::int - (n >= 10)::int - (n >= 12)::int)) $$;

-- Composition riche : loups spéciaux + un maximum de rôles du moteur, le reste en villageois (Voleur exclu : +2 cartes)
create or replace function t_compo_riche(n int) returns jsonb language plpgsql as $$
declare c jsonb := '{}'; reste int := n; loups int := greatest(1, n / 4); r text;
  speciaux text[] := array['voyante','sorciere','chasseur','cupidon','salvateur','petite-fille','ancien','idiot-du-village','bouc-emissaire','corbeau',
    'renard','chevalier-epee-rouillee','enfant-sauvage','ange','joueur-de-flute','montreur-ours','capitaine','chien-loup','servante-devouee','villageois-villageois'];
  loups_sp text[] := array['loup-blanc','grand-mechant-loup','infect-pere-des-loups'];
begin
  foreach r in array loups_sp loop
    if loups > 1 and exists (select 1 from hg_lg_roles where id = r and actif and not mj_seul) then c := c || jsonb_build_object(r, 1); loups := loups - 1; reste := reste - 1; end if;
  end loop;
  c := c || jsonb_build_object('loup-garou', loups); reste := reste - loups;
  foreach r in array speciaux loop
    exit when reste <= 2;
    if exists (select 1 from hg_lg_roles where id = r and actif and not mj_seul) then c := c || jsonb_build_object(r, 1); reste := reste - 1; end if;
  end loop;
  if reste >= 4 and exists (select 1 from hg_lg_roles where id = 'deux-soeurs' and actif) then c := c || '{"deux-soeurs":2}'; reste := reste - 2; end if;
  if reste >= 5 and exists (select 1 from hg_lg_roles where id = 'trois-freres' and actif) then c := c || '{"trois-freres":3}'; reste := reste - 3; end if;
  if reste > 0 then c := c || jsonb_build_object('villageois', reste); end if;
  return c;
end $$;

-- Pilote : joue toutes les actions attendues, vote, fait avancer le temps. Renvoie un résumé ; lève une erreur si la partie ne finit pas.
create or replace function t_jouer(p_code text, p_village_gagne boolean) returns text language plpgsql as $$
declare pid uuid := t_pid(p_code); i int := 0; v_ph text; v_av text; a record; v_c1 uuid; v_c2 uuid; v_hote int; v_err text; r record; n_etat int := 0;
begin
  select t_n(p_code, hote) into v_hote from hg_lg_parties where id = pid;
  loop
    i := i + 1;
    if i > 400 then raise exception 'partie % bloquée en phase %', p_code, t_phase(p_code); end if;
    v_ph := t_phase(p_code);
    exit when v_ph like 'terminee%';
    -- un joueur vivant lit son état à chaque tour (contrôle d'erreur)
    perform t_call(t_n(p_code, user_id), format('hg_lg_etat(%L)', p_code)) from hg_lg_joueurs where partie = pid and vivant order by md5(user_id::text || i) limit 1;
    if v_ph like 'en_cours/vote/%' then
      select k.user_id into v_c1 from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id)
        where k.partie = pid and j.vivant and (k.camp = 'loups') = p_village_gagne order by k.user_id limit 1;
      if v_c1 is null then select user_id into v_c1 from hg_lg_joueurs where partie = pid and vivant order by user_id limit 1; end if;
      for r in select user_id from hg_lg_joueurs where partie = pid and vivant and peut_voter loop
        v_err := t_err(t_n(p_code, r.user_id), format('hg_lg_voter(%L, %L::uuid)', p_code, v_c1));
      end loop;
      if t_phase(p_code) = v_ph then perform t_expirer(p_code); perform t_call(v_hote, format('hg_lg_avancer(%L)', p_code)); end if;
      continue;
    end if;
    if exists (select 1 from hg_lg__attendus(pid)) and v_ph not like '%/revelation/%' then
      for a in select * from hg_lg__attendus(pid) loop
        select user_id into v_c1 from hg_lg_joueurs j where partie = pid and vivant and user_id <> a.user_id
          and (a.type not in ('devorer', 'grand_mechant') or not exists (select 1 from hg_lg_cartes k where k.partie = pid and k.user_id = j.user_id and k.camp = 'loups'))
          and (a.type <> 'loup_blanc' or exists (select 1 from hg_lg_cartes k where k.partie = pid and k.user_id = j.user_id and k.camp = 'loups'))
          order by case when a.type = 'devorer' then user_id::text else md5(user_id::text || i || a.type) end limit 1;
        select user_id into v_c2 from hg_lg_joueurs where partie = pid and vivant and user_id not in (a.user_id, coalesce(v_c1, a.user_id)) order by md5(user_id::text || i) limit 1;
        v_err := t_err(t_n(p_code, a.user_id), format('hg_lg_agir(%L, %L, %L::uuid, %L::uuid, %L)', p_code, a.type,
          case when a.type in ('sorciere','voleur','chien','infecter') then null else v_c1 end,
          case when a.type in ('cupidon','envouter') then v_c2 end,
          case a.type when 'sorciere' then 'rien' when 'voleur' then '0' when 'chien' then 'village' when 'infecter' then 'non' end));
        if v_err is not null then
          v_err := t_err(t_n(p_code, a.user_id), format('hg_lg_agir(%L, %L)', p_code, 'passer'));
        end if;
      end loop;
    end if;
    if t_phase(p_code) = v_ph then perform t_expirer(p_code); perform t_call(v_hote, format('hg_lg_avancer(%L)', p_code)); end if;
  end loop;
  return v_ph;
end $$;

create or replace function t_taille(n int, p_compo jsonb, p_village boolean) returns text language plpgsql as $$
declare v_code text; i int; v_fin text; v_v text; pid uuid; v_nb int;
begin
  v_code := t_call(1, format('hg_lg_creer(%L::jsonb)', jsonb_build_object('nom', 'Taille ' || n, 'nb_joueurs', n, 'composition', p_compo)::text)) #>> '{}';
  for i in 2..n loop perform t_call(t_j(i), format('hg_lg_rejoindre(%L)', v_code)); perform t_call(t_j(i), format('hg_lg_pret(%L, true)', v_code)); end loop;
  perform t_call(1, format('hg_lg_lancer(%L)', v_code));
  pid := t_pid(v_code);
  select count(*) into v_nb from hg_lg_cartes where partie = pid;
  if v_nb <> n then raise exception '% joueurs : % cartes distribuées', n, v_nb; end if;
  v_fin := t_jouer(v_code, p_village);
  select vainqueur into v_v from hg_lg_parties where id = pid;
  if v_v is null then raise exception '% joueurs : pas de vainqueur', n; end if;
  if not exists (select 1 from hg_lg_joueurs where partie = pid and gagne) then raise exception '% joueurs : aucun gagnant', n; end if;
  if not exists (select 1 from hg_lg_joueurs where partie = pid and paillettes > 0) then raise exception '% joueurs : aucune Paillette', n; end if;
  -- chaque joueur peut lire l'état final
  perform t_call(t_n(v_code, user_id), format('hg_lg_etat(%L)', v_code)) from hg_lg_joueurs where partie = pid;
  return v_v || ' (manche ' || (select manche from hg_lg_parties where id = pid) || ')';
end $$;

do $$
declare n int; r1 text; r2 text; bilan text := '';
begin
  for n in 6..50 loop
    -- remise à zéro des plafonds de Paillettes du jour (sinon le plafond quotidien coupe les gains des parties suivantes)
    delete from hg_wallet_log; update hg_wallets set paillettes = 0;
    r1 := t_taille(n, t_compo_auto(n), n % 2 = 0);
    delete from hg_wallet_log;
    r2 := t_taille(n, t_compo_riche(n), n % 2 = 1);
    raise notice 'ok % joueurs : auto → %, riche (%) → %', n, r1, (select count(*) from jsonb_object_keys(t_compo_riche(n))), r2;
  end loop;
end $$;
