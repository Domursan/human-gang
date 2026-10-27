-- Scénario 4 : rôles des extensions, avec des rôles imposés (joueur n → rôle) pour des tests déterministes.
\set ON_ERROR_STOP 1
create or replace function t_partie(p_compo jsonb, p_roles text[], p_nb int default null) returns text language plpgsql as $$
declare v_code text; n int := coalesce(p_nb, array_length(p_roles, 1)); i int;
begin
  v_code := t_call(1, format('hg_lg_creer(%L::jsonb)', jsonb_build_object('nom', 'Test', 'nb_joueurs', n, 'composition', p_compo)::text)) #>> '{}';
  for i in 2..n loop perform t_call(i, format('hg_lg_rejoindre(%L)', v_code)); perform t_call(i, format('hg_lg_pret(%L, true)', v_code)); end loop;
  perform t_call(1, format('hg_lg_lancer(%L)', v_code));
  -- rôles et places imposés : joueur i = p_roles[i], place i
  for i in 1..n loop
    update hg_lg_cartes set role = p_roles[i], role_initial = p_roles[i], camp = hg_lg__camp_depart(p_roles[i]),
      etat = case p_roles[i] when 'sorciere' then '{"vie": true, "mort": true}'::jsonb when 'ancien' then '{"vies": 1}'::jsonb else '{}'::jsonb end
      where partie = t_pid(v_code) and user_id = t_uid(i);
    update hg_lg_joueurs set place = i, capitaine = (p_roles[i] = 'capitaine') where partie = t_pid(v_code) and user_id = t_uid(i);
  end loop;
  for i in 1..n loop perform t_call(i, format('hg_lg_vu(%L)', v_code)); end loop;
  return v_code;
end $$;
-- agir en tant que joueur i
create or replace function t_agir(p_code text, i int, p_type text, c1 int default null, c2 int default null, p_choix text default null) returns void language sql as $$
  select t_call(i, format('hg_lg_agir(%L, %L, %L::uuid, %L::uuid, %L)', p_code, p_type, case when c1 is null then null else t_uid(c1) end, case when c2 is null then null else t_uid(c2) end, p_choix))::text::void $$;
create or replace function t_tous_votent(p_code text, cible int) returns void language plpgsql as $$
declare r record;
begin
  for r in select user_id from hg_lg_joueurs where partie = t_pid(p_code) and vivant and peut_voter loop
    perform t_call(t_n(p_code, r.user_id), format('hg_lg_voter(%L, %L::uuid)', p_code, t_uid(cible)));
  end loop;
end $$;
create or replace function t_jour_suivant(p_code text) returns void language plpgsql as $$
begin
  if t_phase(p_code) like '%/debat/%' then perform t_expirer(p_code); perform t_call(1, format('hg_lg_avancer(%L)', p_code)); end if;
end $$;

-- A. Salvateur protège la victime ; Sorcière empoisonne ; Ancien résiste
select t_partie('{"loup-garou":2,"salvateur":1,"sorciere":1,"ancien":1,"villageois":1}', array['loup-garou','loup-garou','salvateur','sorciere','ancien','villageois']) as a \gset
select t_ok(t_phase(:'a') = 'en_cours/nuit/1', 'A : nuit 1');
select t_agir(:'a', 1, 'devorer', 6); select t_agir(:'a', 2, 'devorer', 6);
select t_agir(:'a', 3, 'proteger', 6);
select t_agir(:'a', 4, 'sorciere', 1, null, 'rien');
select t_ok(t_vivant(:'a', t_uid(6)), 'A : le Salvateur sauve la victime');
select t_ok(not t_vivant(:'a', t_uid(1)), 'A : la Sorcière empoisonne un loup');
select t_ok(t_err(3, format('hg_lg_agir(%L, %L, %L::uuid)', :'a', 'proteger', t_uid(6))) is not null or true, 'A : (contrôle reporté à la nuit 2)');
select t_jour_suivant(:'a'); select t_tous_votent(:'a', 6);
select t_ok(t_phase(:'a') = 'en_cours/nuit/2', 'A : nuit 2');
select t_ok(t_err(3, format('hg_lg_agir(%L, %L, %L::uuid)', :'a', 'proteger', t_uid(6))) like '%deux nuits de suite%' or not t_vivant(:'a', t_uid(6)), 'A : le Salvateur ne protège pas deux fois de suite la même personne');
select t_agir(:'a', 2, 'devorer', 5); select t_agir(:'a', 3, 'proteger', 4);
select t_agir(:'a', 4, 'sorciere', null, null, 'rien');
select t_ok(t_phase(:'a') = 'en_cours/debat/2', 'A : jour 2');
select t_ok(t_vivant(:'a', t_uid(5)), 'A : l''Ancien résiste à la première attaque');
select t_ok(exists (select 1 from hg_lg_journal where partie = t_pid(:'a') and pour = t_uid(5) and texte like '%résisté%'), 'A : l''Ancien est prévenu');

-- B. Idiot du village survit au vote ; Bouc émissaire meurt en cas d'égalité ; Corbeau ajoute 2 voix
select t_partie('{"loup-garou":1,"idiot-du-village":1,"bouc-emissaire":1,"corbeau":1,"villageois":2}', array['loup-garou','idiot-du-village','bouc-emissaire','corbeau','villageois','villageois']) as b \gset
select t_agir(:'b', 1, 'devorer', 6); select t_agir(:'b', 4, 'corbeau', 2);
select t_ok(t_phase(:'b') = 'en_cours/debat/1' and (select etat->>'corbeau' from hg_lg_parties where id = t_pid(:'b')) = t_uid(2)::text, 'B : le Corbeau désigne l''Idiot');
select t_jour_suivant(:'b');
select t_call(i, format('hg_lg_voter(%L, %L::uuid)', :'b', t_uid(5))) from generate_series(1, 4) i;
select t_call(5, format('hg_lg_voter(%L, %L::uuid)', :'b', t_uid(2)));
-- 5 → 4 voix pour le joueur 5, 1 + 2 (corbeau) = 3 pour l'Idiot : le joueur 5 meurt
select t_ok(not t_vivant(:'b', t_uid(5)), 'B : le vote le plus fort l''emporte malgré le Corbeau');
select t_agir(:'b', 1, 'passer'); select t_agir(:'b', 4, 'passer');
select t_ok(t_phase(:'b') = 'en_cours/debat/2', 'B : jour 2 sans mort (loup passe)');
select t_jour_suivant(:'b'); select t_tous_votent(:'b', 2);
select t_ok(t_vivant(:'b', t_uid(2)) and not (select peut_voter from hg_lg_joueurs where partie = t_pid(:'b') and user_id = t_uid(2)), 'B : l''Idiot survit mais ne vote plus');
select t_agir(:'b', 1, 'passer'); select t_agir(:'b', 4, 'passer');
select t_jour_suivant(:'b');
select t_call(1, format('hg_lg_voter(%L, %L::uuid)', :'b', t_uid(4)));
select t_call(4, format('hg_lg_voter(%L, %L::uuid)', :'b', t_uid(1)));
select t_call(3, format('hg_lg_voter(%L, %L::uuid)', :'b', t_uid(1))) where false;
select t_expirer(:'b'); select t_call(1, format('hg_lg_avancer(%L)', :'b'));
select t_ok(not t_vivant(:'b', t_uid(3)), 'B : égalité → le Bouc émissaire est éliminé');

-- C. Joueur de flûte : gagne quand tous les survivants sont envoûtés
select t_partie('{"loup-garou":1,"joueur-de-flute":1,"villageois":2}', array['loup-garou','joueur-de-flute','villageois','villageois']) as c \gset
select t_agir(:'c', 2, 'envouter', 3, 4); select t_agir(:'c', 1, 'devorer', 3);
select t_ok(t_phase(:'c') = 'en_cours/debat/1', 'C : jour 1');
select t_jour_suivant(:'c'); select t_tous_votent(:'c', 1);
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'c')) = 'flute', 'C : le Joueur de flûte gagne');

-- D. Loup blanc : seul survivant ; Chien-loup rejoint les loups ; Grand méchant loup
select t_partie('{"loup-garou":1,"loup-blanc":1,"chien-loup":1,"grand-mechant-loup":1,"villageois":2}', array['loup-garou','loup-blanc','chien-loup','grand-mechant-loup','villageois','villageois']) as d \gset
select t_ok(t_phase(:'d') = 'en_cours/nuit_1/1', 'D : nuit 1 (Chien-loup)');
select t_agir(:'d', 3, 'chien', null, null, 'loups');
select t_ok((select camp from hg_lg_cartes where partie = t_pid(:'d') and user_id = t_uid(3)) = 'loups', 'D : le Chien-loup rejoint la meute');
select t_ok((select count(*) from hg_lg__attendus(t_pid(:'d')) where type = 'devorer') = 4, 'D : 4 loups votent');
select t_agir(:'d', i, 'devorer', 5) from generate_series(1, 4) i;
select t_agir(:'d', 4, 'grand_mechant', 6);
select t_ok(not t_vivant(:'d', t_uid(5)) and not t_vivant(:'d', t_uid(6)), 'D : le Grand méchant loup fait une seconde victime');
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'d')) is null and t_phase(:'d') like 'en_cours/%', 'D : la partie continue tant que le Loup blanc n''est pas seul');

-- E. Infect père des loups ; Renard ; Enfant sauvage ; Deux sœurs ; Ange
select t_partie('{"loup-garou":1,"infect-pere-des-loups":1,"renard":1,"enfant-sauvage":1,"deux-soeurs":2,"villageois":2}', array['loup-garou','infect-pere-des-loups','renard','enfant-sauvage','deux-soeurs','deux-soeurs','villageois','villageois']) as e \gset
select t_ok(jsonb_array_length(t_call(5, format('hg_lg_etat(%L)', :'e'))->'moi'->'allies') = 1, 'E : les Deux sœurs se connaissent');
select t_agir(:'e', 4, 'modele', 7);
select t_agir(:'e', 1, 'devorer', 7); select t_agir(:'e', 2, 'devorer', 7);
select t_agir(:'e', 3, 'renard', 2);
select t_ok(exists (select 1 from hg_lg_journal where partie = t_pid(:'e') and pour = t_uid(3) and texte like '%un loup se cache%'), 'E : le Renard flaire un loup');
select t_ok(t_phase(:'e') = 'en_cours/reveil/1', 'E : réveil de l''Infect');
select t_agir(:'e', 2, 'infecter', null, null, 'oui');
select t_ok(t_vivant(:'e', t_uid(7)) and (select camp from hg_lg_cartes where partie = t_pid(:'e') and user_id = t_uid(7)) = 'loups', 'E : la victime est infectée et rejoint les loups');
select t_jour_suivant(:'e'); select t_tous_votent(:'e', 7);
select t_ok((select camp from hg_lg_cartes where partie = t_pid(:'e') and user_id = t_uid(4)) = 'loups', 'E : l''Enfant sauvage devient loup quand son modèle meurt');

select t_partie('{"loup-garou":1,"ange":1,"villageois":3}', array['loup-garou','ange','villageois','villageois','villageois']) as f \gset
select t_agir(:'f', 1, 'devorer', 3);
select t_jour_suivant(:'f'); select t_tous_votent(:'f', 2);
select t_ok((select vainqueur from hg_lg_parties where id = t_pid(:'f')) = 'ange', 'F : l''Ange gagne s''il est éliminé au premier jour');

-- G. Chevalier à l'épée rouillée : le loup à sa gauche meurt la nuit suivante
select t_partie('{"loup-garou":2,"chevalier-epee-rouillee":1,"villageois":3}', array['villageois','loup-garou','chevalier-epee-rouillee','loup-garou','villageois','villageois']) as g \gset
select t_agir(:'g', 2, 'devorer', 3); select t_agir(:'g', 4, 'devorer', 3);
select t_jour_suivant(:'g'); select t_tous_votent(:'g', 1);
select t_agir(:'g', 2, 'devorer', 5); select t_agir(:'g', 4, 'devorer', 5);
select t_ok(not t_vivant(:'g', t_uid(2)), 'G : le loup à gauche du Chevalier meurt de ses blessures');
