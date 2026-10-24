-- Scénario 1 : partie classique à 8, victoire du village (Cupidon, Voyante, Sorcière, Chasseur, amoureux).
\set ON_ERROR_STOP 1
select t_call(1, $$hg_lg_creer('{"nom":"Test classique","nb_joueurs":8,"composition":{"loup-garou":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"villageois":2}}'::jsonb)$$) #>> '{}' as code \gset
select t_ok(:'code' ~ '^HGLG-[0-9]{4}$', 'code au format HGLG-####');
select t_ok(t_err(13, $$hg_lg_creer('{"nb_joueurs":8,"composition":{"loup-garou":8}}'::jsonb)$$) like 'Accès réservé%', 'un membre sans accès ne peut pas créer');
select t_ok(t_err(2, $$hg_lg_creer('{"nb_joueurs":8,"composition":{"loup-garou":2,"villageois":2}}'::jsonb)$$) like 'La composition compte%', 'composition incohérente refusée');
select t_ok(t_err(2, $$hg_lg_creer('{"nb_joueurs":6,"composition":{"loup-garou":2,"comedien":1,"villageois":3}}'::jsonb)$$) like '%meneur humain%', 'Comédien refusé en mode automatique');
select t_call(i, format('hg_lg_rejoindre(%L)', :'code')) from generate_series(2, 8) i;
select t_ok(t_err(9, format('hg_lg_rejoindre(%L)', :'code')) like '%complète%', 'partie complète refusée');
select t_ok(t_err(1, format('hg_lg_lancer(%L)', :'code')) like '%prêt%', 'lancement refusé si personne n''est prêt');
select t_call(i, format('hg_lg_pret(%L, true)', :'code')) from generate_series(2, 8) i;
select t_ok(t_err(3, format('hg_lg_lancer(%L)', :'code')) like 'Seul l''hôte%', 'seul l''hôte lance');
select t_call(1, format('hg_lg_lancer(%L)', :'code'));
select t_ok(t_phase(:'code') = 'revelation/revelation/0', 'révélation ouverte');
select t_ok((select count(*) from hg_lg_cartes where partie = t_pid(:'code')) = 8, '8 cartes distribuées');
select t_ok((select count(distinct place) from hg_lg_joueurs where partie = t_pid(:'code')) = 8, 'places distinctes');

-- Secret des rôles
select t_ok(t_err(2, 'select count(*) from hg_lg_cartes') like '%permission denied%', 'hg_lg_cartes illisible pour un joueur');
select t_ok((select count(*) from jsonb_array_elements(t_call(t_n(:'code', t_role(:'code', 'villageois')), format('hg_lg_etat(%L)', :'code'))->'joueurs') j
             where j->>'role' is not null) = 1, 'un villageois ne voit que son propre rôle');
select t_ok(jsonb_array_length(t_call(t_n(:'code', t_role(:'code', 'loup-garou')), format('hg_lg_etat(%L)', :'code'))->'moi'->'allies') = 1, 'un loup voit son allié');

select t_call(i, format('hg_lg_vu(%L)', :'code')) from generate_series(1, 8) i;
select t_ok(t_phase(:'code') = 'en_cours/nuit_1/1', 'première nuit : étape Cupidon');

-- Cupidon lie le Chasseur et le villageois 1
select t_call(t_n(:'code', t_role(:'code', 'cupidon')), format('hg_lg_agir(%L, %L, %L::uuid, %L::uuid)', :'code', 'cupidon', t_role(:'code', 'chasseur'), t_role(:'code', 'villageois', 1)));
select t_ok(t_phase(:'code') = 'en_cours/nuit/1', 'nuit principale ouverte');
-- Les loups visent le villageois 2 ; la Voyante sonde le loup 1 ; un loup ne peut pas viser un loup
select t_ok(t_err(t_n(:'code', t_role(:'code', 'loup-garou', 1)), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'devorer', t_role(:'code', 'loup-garou', 2))) like '%dévorer un loup%', 'un loup ne peut pas viser un loup');
select t_call(t_n(:'code', t_role(:'code', 'loup-garou', r)), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'devorer', t_role(:'code', 'villageois', 2))) from generate_series(1, 2) r;
select t_call(t_n(:'code', t_role(:'code', 'voyante')), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'sonder', t_role(:'code', 'loup-garou', 1)));
select t_ok(t_phase(:'code') = 'en_cours/reveil/1', 'réveil de la Sorcière');
select t_ok((t_call(t_n(:'code', t_role(:'code', 'sorciere')), format('hg_lg_etat(%L)', :'code'))->'moi'->'action'->>'victime')::uuid = t_role(:'code', 'villageois', 2), 'la Sorcière voit la victime');
select t_call(t_n(:'code', t_role(:'code', 'sorciere')), format('hg_lg_agir(%L, %L, null, null, %L)', :'code', 'sorciere', 'rien'));
select t_ok(t_phase(:'code') = 'en_cours/debat/1', 'jour 1 : débat');
select t_ok(not t_vivant(:'code', t_role(:'code', 'villageois', 2)), 'le villageois 2 est mort');
select t_ok((select count(*) from hg_lg_journal where partie = t_pid(:'code') and pour = t_role(:'code', 'voyante') and data->>'decouvert' = 'loups') = 1, 'la Voyante a découvert un loup');

-- Débat écoulé → vote contre le loup 1
select t_expirer(:'code'); select t_call(1, format('hg_lg_avancer(%L)', :'code'));
select t_ok(t_phase(:'code') = 'en_cours/vote/1', 'jour 1 : vote');
select t_call(t_n(:'code', j.user_id), format('hg_lg_voter(%L, %L::uuid)', :'code', case when j.user_id = t_role(:'code', 'loup-garou', 1) then t_role(:'code', 'voyante') else t_role(:'code', 'loup-garou', 1) end))
  from hg_lg_joueurs j where j.partie = t_pid(:'code') and j.vivant;
select t_ok(not t_vivant(:'code', t_role(:'code', 'loup-garou', 1)), 'le loup 1 est éliminé au vote');
select t_ok(t_phase(:'code') = 'en_cours/nuit/2', 'nuit 2');

-- Nuit 2 : le loup restant dévore le Chasseur (amoureux du villageois 1)
select t_call(t_n(:'code', t_role(:'code', 'loup-garou', 2)), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'devorer', t_role(:'code', 'chasseur')));
select t_call(t_n(:'code', t_role(:'code', 'voyante')), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'sonder', t_role(:'code', 'loup-garou', 2)));
select t_call(t_n(:'code', t_role(:'code', 'sorciere')), format('hg_lg_agir(%L, %L, null, null, %L)', :'code', 'sorciere', 'rien'));
select t_ok(not t_vivant(:'code', t_role(:'code', 'chasseur')), 'le Chasseur est mort');
select t_ok(not t_vivant(:'code', t_role(:'code', 'villageois', 1)), 'son amoureux meurt de chagrin');
select t_ok(t_phase(:'code') = 'en_cours/chasseur/2', 'le Chasseur doit tirer');
select t_call(t_n(:'code', t_role(:'code', 'chasseur')), format('hg_lg_agir(%L, %L, %L::uuid)', :'code', 'chasseur', t_role(:'code', 'loup-garou', 2)));
select t_ok(t_phase(:'code') = 'terminee/fin/2', 'partie terminée');
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'code')) = 'village', 'le village gagne');
select t_ok((select count(*) from hg_lg_joueurs where partie = t_pid(:'code') and gagne) = 6, '6 gagnants (le village)');
select t_ok((select paillettes from hg_lg_joueurs where partie = t_pid(:'code') and user_id = t_role(:'code', 'voyante')) >= 50, 'la Voyante gagne des Paillettes');
select t_ok(exists (select 1 from hg_user_badges where user_id = t_role(:'code', 'voyante') and badge_code = 'lg_premiere_victoire'), 'badge Première victoire');
select t_ok((select count(*) from jsonb_array_elements(t_call(t_n(:'code', t_role(:'code', 'villageois', 1)), format('hg_lg_etat(%L)', :'code'))->'joueurs') j where j->>'role' is null) = 0, 'fin : tous les rôles sont révélés');
select t_ok((t_call(t_n(:'code', t_role(:'code', 'voyante')), 'hg_lg_stats()')->>'victoires')::int = 1, 'statistiques : 1 victoire');
-- Rejouer le versement ne paie pas deux fois
select t_ok(not hg_wallet_add(t_role(:'code', 'voyante'), 5, 'loup_garou', 'lg:' || t_pid(:'code') || ':' || t_role(:'code', 'voyante')), 'Paillettes versées une seule fois');
