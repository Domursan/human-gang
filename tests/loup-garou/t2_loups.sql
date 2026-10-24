-- Scénario 2 : Voleur (2 cartes au centre), égalité sans Bouc émissaire, victoire des loups, Capitaine et succession.
\set ON_ERROR_STOP 1
select t_call(1, $$hg_lg_creer('{"nom":"Test loups","nb_joueurs":6,"composition":{"loup-garou":2,"voleur":1,"capitaine":1,"villageois":4}}'::jsonb)$$) #>> '{}' as code \gset
select t_call(i, format('hg_lg_rejoindre(%L)', :'code')) from generate_series(2, 6) i;
select t_call(i, format('hg_lg_pret(%L, true)', :'code')) from generate_series(2, 6) i;
select t_call(1, format('hg_lg_lancer(%L)', :'code'));
select t_ok((select count(*) from hg_lg_centre where partie = t_pid(:'code')) = 2, '2 cartes au centre');
select t_call(i, format('hg_lg_vu(%L)', :'code')) from generate_series(1, 6) i;
-- Le Voleur a-t-il été distribué ? Sinon la nuit 1 est sautée.
\if :{?dummy}
\endif
select case when t_role(:'code', 'voleur') is not null then 'oui' else 'non' end as voleur_present \gset
\if :'voleur_present' = 'oui'
\endif
select t_ok(t_phase(:'code') in ('en_cours/nuit_1/1', 'en_cours/nuit/1'), 'nuit 1 ouverte (avec ou sans Voleur)');
-- Si le Voleur est en jeu : il prend la carte 0
select t_call(t_n(:'code', t_role(:'code', 'voleur')), format('hg_lg_agir(%L, %L, null, null, %L)', :'code', 'voleur', '0'))
  where t_role(:'code', 'voleur') is not null and t_phase(:'code') = 'en_cours/nuit_1/1';
select t_ok(t_phase(:'code') = 'en_cours/nuit/1', 'nuit principale');
select t_ok((select count(*) from hg_lg_cartes where partie = t_pid(:'code') and role = 'voleur') = 0 or
            (select count(*) from hg_lg_centre where partie = t_pid(:'code') and role = 'voleur') = 1 or
            (select count(*) from hg_lg_cartes where partie = t_pid(:'code') and role_initial = 'voleur') = 0, 'le Voleur a échangé sa carte');

-- Les loups (camp loups) dévorent un villageois non capitaine
select t_call(t_n(:'code', c.user_id), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'devorer',
  (select k.user_id from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id) where k.partie = t_pid(:'code') and k.camp <> 'loups' and j.vivant and not j.capitaine order by k.user_id limit 1)))
  from hg_lg_cartes c where c.partie = t_pid(:'code') and c.camp = 'loups';
select t_ok(t_phase(:'code') = 'en_cours/debat/1', 'jour 1');
select t_ok(t_vivants(:'code') = 5, '5 survivants');

-- Vote à égalité 2-2 (+1 abstention) : personne n'est éliminé (pas de Bouc émissaire)
select t_expirer(:'code'); select t_call(1, format('hg_lg_avancer(%L)', :'code'));
with v as (select j.user_id, row_number() over (order by j.user_id) rn from hg_lg_joueurs j where j.partie = t_pid(:'code') and j.vivant and not j.capitaine)
select t_call(t_n(:'code', v.user_id), format('hg_lg_voter(%L, %L::uuid)', :'code',
  case when v.rn % 2 = 0 then (select user_id from v where rn = 1) else (select user_id from v where rn = 2) end)) from v where v.rn <= 4;
select t_expirer(:'code'); select t_call(1, format('hg_lg_avancer(%L)', :'code'));
select t_ok(t_vivants(:'code') = 5 and t_phase(:'code') = 'en_cours/nuit/2', 'égalité : personne n''est éliminé, nuit 2');

-- Nuits suivantes : les loups dévorent le Capitaine (s'il est villageois) → succession
select t_call(t_n(:'code', c.user_id), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'devorer',
  coalesce((select j.user_id from hg_lg_joueurs j join hg_lg_cartes k using (partie, user_id) where j.partie = t_pid(:'code') and j.capitaine and j.vivant and k.camp <> 'loups'),
           (select k.user_id from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id) where k.partie = t_pid(:'code') and k.camp <> 'loups' and j.vivant order by k.user_id limit 1))))
  from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id) where c.partie = t_pid(:'code') and c.camp = 'loups' and j.vivant;
select t_ok(t_phase(:'code') in ('en_cours/succession/2', 'en_cours/debat/2', 'terminee/fin/2'), 'après la nuit 2 : succession ou jour 2 : ' || t_phase(:'code'));
-- Si succession : le successeur est tiré au sort à l'expiration
select t_expirer(:'code') where t_phase(:'code') = 'en_cours/succession/2';
select t_call(1, format('hg_lg_avancer(%L)', :'code'));
select t_ok((select count(*) from hg_lg_joueurs where partie = t_pid(:'code') and capitaine and vivant) <= 1, 'au plus un Capitaine vivant');

-- On boucle : chaque nuit les loups dévorent un villageois, chaque jour on vote contre un villageois, jusqu'à la fin
do $$
declare v_code text := (select code from hg_lg_parties order by created_at desc limit 1); i int := 0; v_ph text; r record; v_cible uuid;
begin
  loop
    i := i + 1; exit when i > 30;
    v_ph := t_phase(v_code);
    exit when v_ph like 'terminee%';
    if v_ph like 'en_cours/nuit/%' then
      select k.user_id into v_cible from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id) where k.partie = t_pid(v_code) and k.camp <> 'loups' and j.vivant order by k.user_id limit 1;
      for r in select c.user_id from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id) where c.partie = t_pid(v_code) and c.camp = 'loups' and j.vivant loop
        perform t_call(t_n(v_code, r.user_id), format('hg_lg_agir(%L, %L, %L::uuid)', v_code, 'devorer', v_cible));
      end loop;
    elsif v_ph like 'en_cours/vote/%' then
      select k.user_id into v_cible from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id) where k.partie = t_pid(v_code) and k.camp <> 'loups' and j.vivant order by k.user_id desc limit 1;
      for r in select j.user_id from hg_lg_joueurs j where j.partie = t_pid(v_code) and j.vivant and j.peut_voter loop
        perform t_call(t_n(v_code, r.user_id), format('hg_lg_voter(%L, %L::uuid)', v_code, v_cible));  -- vote unanime (la cible vote contre elle-même)
      end loop;
    else
      perform t_expirer(v_code);
      perform t_call(1, format('hg_lg_avancer(%L)', v_code));
    end if;
  end loop;
end $$;
select t_ok(t_phase(:'code') like 'terminee%', 'partie terminée : ' || t_phase(:'code'));
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'code')) = 'loups', 'les loups gagnent (vainqueur : ' || (select vainqueur from hg_lg_parties where id = t_pid(:'code')) || ', cartes : ' || (select string_agg(role || '/' || camp || case when j.vivant then '+' else '-' end, ' ') from hg_lg_cartes k join hg_lg_joueurs j using (partie, user_id) where k.partie = t_pid(:'code')) || ')');
select t_ok(not exists (select 1 from hg_lg_joueurs j join hg_lg_cartes k using (partie, user_id) where j.partie = t_pid(:'code') and k.camp = 'loups' and not j.gagne), 'tous les loups sont gagnants');
select t_ok(exists (select 1 from hg_user_badges b join hg_lg_cartes k on k.user_id = b.user_id and k.partie = t_pid(:'code') and k.camp = 'loups' where b.badge_code = 'lg_meute_soudee'), 'badge Meute soudée');
