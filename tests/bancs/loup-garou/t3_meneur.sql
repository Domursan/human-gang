-- Scénario 3 : meneur humain (ne joue pas, voit tout, force les étapes, élimine, pause), chat et sécurité des salons.
\set ON_ERROR_STOP 1
select t_call(1, $$hg_lg_creer('{"nom":"Test meneur","mode":"mj","nb_joueurs":5,"composition":{"loup-garou":1,"voyante":1,"petite-fille":1,"villageois":1,"juge-begue":1}}'::jsonb)$$) #>> '{}' as code \gset
select t_ok((select count(*) from hg_lg_joueurs where partie = t_pid(:'code')) = 0, 'le meneur n''est pas joueur');
select t_call(i, format('hg_lg_rejoindre(%L)', :'code')) from generate_series(2, 6) i;
select t_call(i, format('hg_lg_pret(%L, true)', :'code')) from generate_series(2, 6) i;
select t_call(1, format('hg_lg_lancer(%L)', :'code'));
select t_ok(jsonb_array_length(t_call(1, format('hg_lg_etat(%L)', :'code'))->'joueurs') = 5, 'le meneur voit 5 joueurs');
select t_ok((select count(*) from jsonb_array_elements(t_call(1, format('hg_lg_etat(%L)', :'code'))->'joueurs') j where j->>'role' is null) = 0, 'le meneur voit tous les rôles');
select t_ok(t_err(2, format('hg_lg_avancer(%L, true)', :'code')) like 'Seul le meneur%', 'un joueur ne peut pas forcer l''étape');
select t_call(1, format('hg_lg_avancer(%L, true)', :'code'));
select t_ok(t_phase(:'code') = 'en_cours/nuit/1', 'le meneur passe la révélation');

-- Chat des loups : le loup écrit, la Petite fille lit, le villageois ne lit pas
select t_call(t_n(:'code', t_role(:'code', 'loup-garou')), format('hg_lg_message(%L, %L, %L)', :'code', 'loups', 'on mange qui ?'));
select t_ok(t_err(t_n(:'code', t_role(:'code', 'villageois')), format('hg_lg_message(%L, %L, %L)', :'code', 'loups', 'coucou')) is not null, 'un villageois ne peut pas écrire chez les loups');
select t_ok(t_err(t_n(:'code', t_role(:'code', 'villageois')), format('hg_lg_message(%L, %L, %L)', :'code', 'general', 'il fait nuit')) is not null, 'personne ne parle dans le général la nuit');
select t_ok((t_call(t_n(:'code', t_role(:'code', 'villageois')), format('(select count(*) from hg_lg_messages where partie = %L and canal = %L)', t_pid(:'code'), 'loups')))::int = 0, 'le villageois ne voit pas le chat des loups');
select t_ok((t_call(t_n(:'code', t_role(:'code', 'petite-fille')), format('(select count(*) from hg_lg_messages where partie = %L and canal = %L)', t_pid(:'code'), 'loups')))::int = 1, 'la Petite fille espionne le chat des loups');
select t_ok((t_call(1, format('(select count(*) from hg_lg_messages where partie = %L and canal = %L)', t_pid(:'code'), 'loups')))::int = 1, 'le meneur lit le chat des loups');
select t_ok((t_call(13, format('(select count(*) from hg_lg_messages where partie = %L)', t_pid(:'code'))))::int = 0, 'un membre extérieur ne lit rien');
select t_ok((t_call(13, format('(select count(*) from hg_lg_joueurs where partie = %L)', t_pid(:'code'))))::int = 0, 'un membre extérieur ne voit pas les joueurs');

-- Pause, +30 s, reprise
select t_call(1, format('hg_lg_mj(%L, %L)', :'code', 'pause'));
select t_ok((select phase_fin is null and pause_reste > 0 from hg_lg_parties where id = t_pid(:'code')), 'pause');
select t_call(1, format('hg_lg_mj(%L, %L)', :'code', 'reprendre'));
select t_call(1, format('hg_lg_mj(%L, %L, null, null, 30)', :'code', 'plus'));
select t_ok((select phase_fin > now() + interval '60 seconds' from hg_lg_parties where id = t_pid(:'code')), 'reprise et +30 s');
select t_call(1, format('hg_lg_mj(%L, %L, null, %L)', :'code', 'message', 'Le village s''endort.'));
select t_ok(exists (select 1 from hg_lg_journal where partie = t_pid(:'code') and type = 'meneur'), 'message du meneur au journal');

-- Le meneur élimine le loup : le village gagne
select t_call(1, format('hg_lg_mj(%L, %L, %L::uuid)', :'code', 'eliminer', t_role(:'code', 'loup-garou')));
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'code')) = 'village', 'le village gagne après l''élimination par le meneur');
select t_ok((select paillettes from hg_lg_joueurs where partie = t_pid(:'code') limit 1) = 0, 'pas de Paillettes sous 6 joueurs');
select t_ok((t_call(t_n(:'code', t_role(:'code', 'villageois')), format('(select count(*) from hg_lg_messages where partie = %L and canal = %L)', t_pid(:'code'), 'loups')))::int = 1, 'fin : tous les salons deviennent lisibles');
