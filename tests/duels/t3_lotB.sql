-- Règles du lot B : Bataille navale (placement, tirs, rejouer, salve, radar, fin) et Qui est-ce ? (questions, question libre, deviner, baisser).
-- À lancer sur une base neuve (tests/duels/rebuild.sh), après helpers.sql.
-- Erreur d'une expression évaluée sans changer de rôle (fonctions internes non accordées aux membres).
create or replace function t_err_su(p_sql text) returns text language plpgsql as $f$
begin execute 'select ' || p_sql; return null; exception when others then return sqlerrm; end $f$;
do $$
declare v_code text; v_id uuid; e jsonb; r text; i int; n int; u2 uuid := t_uid(2); u3 uuid := t_uid(3);
  f2 jsonb; f3 jsonb; cs int[]; c int; v_tour uuid; v_perso int; v_faux int;
begin
  /* ---------- Bataille navale : validation de la flotte ---------- */
  f2 := '[{"type":"porte_avions","cases":[0,1,2,3,4]},{"type":"cuirasse","cases":[20,21,22,23]},{"type":"croiseur","cases":[40,41,42]},
          {"type":"sous_marin","cases":[60,61,62]},{"type":"torpilleur","cases":[80,81]}]';
  perform t_ok(hg_duel__bn_valider(f2, false) is not null, 'flotte valide (une ligne d''écart)');
  perform t_ok(t_err_su(format('hg_duel__bn_valider(%L::jsonb, false)', (f2 - 4)::text)) like 'Place tes 5 navires%', 'flotte incomplète refusée');
  perform t_ok(t_err_su(format('hg_duel__bn_valider(%L::jsonb, false)',
    jsonb_set(f2, '{4,cases}', '[0,10]')::text)) like '%chevauchent%', 'chevauchement refusé');
  perform t_ok(t_err_su(format('hg_duel__bn_valider(%L::jsonb, false)',
    jsonb_set(f2, '{4,cases}', '[50,51]')::text)) like '%se touchent%', 'contact refusé sans l''option');
  perform t_ok(hg_duel__bn_valider(jsonb_set(f2, '{4,cases}', '[50,51]'), true) is not null, 'contact permis avec l''option');
  perform t_ok(t_err_su(format('hg_duel__bn_valider(%L::jsonb, false)',
    jsonb_set(f2, '{4,cases}', '[9,10]')::text)) like '%ligne droite%', 'navire à cheval sur deux lignes refusé');
  perform t_ok(t_err_su(format('hg_duel__bn_valider(%L::jsonb, false)',
    jsonb_set(f2, '{2,cases}', '[40,41,52]')::text)) like '%ligne droite%', 'navire tordu refusé');
  for i in 1 .. 20 loop
    perform hg_duel__bn_valider(hg_duel__bn_hasard(false), false);
  end loop;
  perform t_ok(true, 'flottes au hasard toujours valides (20 tirages)');

  /* ---------- Bataille classique entre deux membres ---------- */
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'bataille', 'adversaire', 'code', 'commence', 'moi', 'format', 1)::text)) #>> '{}';
  perform t_ok(v_code ~ '^HGBN-[0-9]{4}$', 'code au format HGBN-####');
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  v_id := t_pid(v_code);
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'partie'->>'phase' = 'placement' and (e->'joueurs'->0->>'fin') is not null, 'phase de placement avec échéance');
  perform t_ok(t_err(2, format('hg_duel_tirer(%L, 0)', v_code)) like '%pas le moment%', 'pas de tir pendant le placement');
  perform t_call(2, format('hg_duel_placer(%L, %L::jsonb)', v_code, f2::text));
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'partie'->>'phase' = 'placement' and jsonb_array_length(e->'bataille'->'ma_flotte') = 5, 'flotte posée, on attend l''autre');
  perform t_ok(jsonb_array_length(t_call(3, format('hg_duel_etat(%L)', v_code))->'bataille'->'ma_flotte') = 0, 'la flotte de l''autre reste cachée');
  f3 := '[{"type":"porte_avions","cases":[9,19,29,39,49]},{"type":"cuirasse","cases":[7,17,27,37]},{"type":"croiseur","cases":[5,15,25]},
          {"type":"sous_marin","cases":[3,13,23]},{"type":"torpilleur","cases":[99,98]}]';
  perform t_call(3, format('hg_duel_placer(%L, %L::jsonb)', v_code, f3::text));
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'partie'->>'phase' = 'jeu' and (e->'partie'->>'tour')::uuid = u2, 'les deux flottes posées : le premier tire');
  perform t_ok(t_err(3, format('hg_duel_tirer(%L, 0)', v_code)) like '%pas ton tour%', 'chacun son tour');
  r := t_call(2, format('hg_duel_tirer(%L, 50)', v_code)) #>> '{}';
  perform t_ok(r = 'eau' and (select tour from hg_duel_parties where id = v_id) = u3, 'à l''eau : le tour passe');
  r := t_call(3, format('hg_duel_tirer(%L, 0)', v_code)) #>> '{}';
  perform t_ok(r = 'touche' and (select tour from hg_duel_parties where id = v_id) = u3, 'touché : on rejoue');
  perform t_ok(t_err(3, format('hg_duel_tirer(%L, 0)', v_code)) like '%déjà tiré%', 'pas deux tirs sur la même case');
  r := t_call(3, format('hg_duel_tirer(%L, 55)', v_code)) #>> '{}';
  -- Radar : nombre de cases de navire autour de 18 chez u3 (8, 9, 19, 29... : colonne 9 porte-avions et 7 cuirassé) : 7,17,27,9,19,29 → 6.
  n := (t_call(2, format('hg_duel_radar(%L, 18)', v_code)) #>> '{}')::int;
  perform t_ok(n = 6, 'radar : 6 cases de navire dans le carré 3 × 3 (' || n || ')');
  perform t_ok((select tour from hg_duel_parties where id = v_id) = u3, 'le radar remplace le tir du tour');
  r := t_call(3, format('hg_duel_tirer(%L, 56)', v_code)) #>> '{}';
  perform t_ok(t_err(2, format('hg_duel_radar(%L, 44)', v_code)) like '%déjà utilisé%', 'un seul radar par manche');
  e := t_call(3, format('hg_duel_etat(%L)', v_code));
  perform t_ok(not exists (select 1 from jsonb_array_elements(e->'bataille'->'tirs'->(u2::text)) t where t->>'resultat' = 'radar'),
    'le radar de l''autre reste secret');
  -- u2 coule tout (rejoue à chaque touche)
  for c in select unnest(array[9,19,29,39,49,7,17,27,37,5,15,25,3,13,23]) loop
    r := t_call(2, format('hg_duel_tirer(%L, %s)', v_code, c)) #>> '{}';
  end loop;
  perform t_ok(r = 'coule', 'navire coulé');
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(jsonb_array_length(e->'bataille'->'coules'->(u3::text)) = 4, 'navires adverses coulés visibles');
  perform t_call(2, format('hg_duel_tirer(%L, 99)', v_code));
  r := t_call(2, format('hg_duel_tirer(%L, 98)', v_code)) #>> '{}';
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'partie'->>'statut' = 'terminee' and (e->'partie'->>'vainqueur')::uuid = u2, 'toute la flotte coulée : victoire');
  perform t_ok(jsonb_array_length(t_call(3, format('hg_duel_etat(%L)', v_code))->'bataille'->'coules'->(u2::text)) = 5,
    'à la fin, la flotte du gagnant est dévoilée');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = u2 and badge_code = 'duel_bn_premiere'), 'badge Amiral');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = u2 and badge_code = 'duel_bn_fantome'), 'badge Vaisseau fantôme (aucun navire perdu)');
  perform t_ok((select paillettes from hg_duel_joueurs where partie = v_id and user_id = u2) = 80, 'Paillettes de la bataille');

  /* ---------- Salve et option « rejouer » désactivée ---------- */
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'bataille', 'variante', 'salve', 'adversaire', 'code', 'commence', 'moi', 'format', 1)::text)) #>> '{}';
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_call(2, format('hg_duel_placer(%L, %L::jsonb)', v_code, f2::text));
  perform t_call(3, format('hg_duel_placer(%L, %L::jsonb)', v_code, f3::text));
  perform t_ok((select restant from hg_duel_parties where code = v_code and statut = 'en_cours') = 5, 'salve : 5 tirs avec 5 navires');
  perform t_call(2, format('hg_duel_tirer(%L, 50)', v_code));
  perform t_ok((select restant from hg_duel_parties where code = v_code and statut = 'en_cours') = 4
    and (select tour from hg_duel_parties where code = v_code and statut = 'en_cours') = u2, 'salve : on continue après un tir à l''eau');
  for c in select unnest(array[51, 52, 53, 54]) loop perform t_call(2, format('hg_duel_tirer(%L, %s)', v_code, c)); end loop;
  perform t_ok((select tour from hg_duel_parties where code = v_code and statut = 'en_cours') = u3, 'salve épuisée : le tour passe');
  perform t_call(2, format('hg_duel_quitter(%L)', v_code));

  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'bataille', 'adversaire', 'code', 'commence', 'moi', 'rejouer', false)::text)) #>> '{}';
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_call(2, format('hg_duel_placer(%L, %L::jsonb)', v_code, f2::text));
  perform t_call(3, format('hg_duel_placer(%L, %L::jsonb)', v_code, f3::text));
  r := t_call(2, format('hg_duel_tirer(%L, 9)', v_code)) #>> '{}';
  perform t_ok(r = 'touche' and (select tour from hg_duel_parties where code = v_code and statut = 'en_cours') = u3, 'sans « rejouer » : le tour passe même après une touche');
  perform t_call(3, format('hg_duel_quitter(%L)', v_code));

  -- Placement au hasard pour un absent
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'bataille', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  update hg_duel_joueurs set fin = now() - interval '1 second' where partie = t_pid(v_code);
  perform t_call(2, format('hg_duel_avancer(%L)', v_code));
  perform t_ok((select phase from hg_duel_parties where code = v_code and statut = 'en_cours') = 'jeu', 'temps de placement écoulé : flottes posées au hasard');
  perform t_call(2, format('hg_duel_quitter(%L)', v_code));

  -- Robot : place sa flotte tout seul et tire après moi
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'bataille', 'adversaire', 'robot', 'robot', 3, 'commence', 'moi', 'rejouer', false)::text)) #>> '{}';
  perform t_call(2, format('hg_duel_placer(%L, %L::jsonb)', v_code, f2::text));
  perform t_call(2, format('hg_duel_tirer(%L, 0)', v_code));
  perform t_ok((select count(*) from hg_duel_tirs where partie = t_pid(v_code)) = 2
    and (select tour from hg_duel_parties where code = v_code and statut = 'en_cours') = u2, 'le robot tire après moi');
  perform t_call(2, format('hg_duel_quitter(%L)', v_code));

  /* ---------- Qui est-ce ? ---------- */
  perform t_ok(jsonb_array_length(t_call(2, 'hg_duel_plateau()')->'persos') = 24 and jsonb_array_length(t_call(2, 'hg_duel_plateau()')->'questions') = 17,
    'plateau : 24 personnages, 17 questions');
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'quiestce', 'adversaire', 'code', 'commence', 'moi', 'format', 3)::text)) #>> '{}';
  perform t_ok(v_code ~ '^HGQE-[0-9]{4}$', 'code au format HGQE-####');
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  v_id := t_pid(v_code);
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok((e->'quiestce'->>'mon_perso') is not null and e->'quiestce'->'perso_adverse' = 'null'::jsonb, 'chacun voit son personnage, pas celui de l''autre');
  select perso into v_perso from hg_duel_qec_secrets where partie = v_id and user_id = u3;
  r := t_call(2, format('hg_duel_question(%L, %L, %L)', v_code, 'lunettes', 'oui')) #>> '{}';
  perform t_ok(r::boolean = coalesce(((select attributs from hg_duel_qec_persos where plateau = 'paleto' and id = v_perso)->>'lunettes')::boolean, false),
    'question toute prête : réponse exacte');
  perform t_ok((select tour from hg_duel_parties where id = v_id) = u3, 'après une question, le tour passe');
  perform t_ok(t_err(3, format('hg_duel_question(%L, %L, %L)', v_code, 'nez', 'oui')) like 'Question inconnue%', 'question inconnue refusée');
  perform t_call(3, format('hg_duel_question_libre(%L, %L)', v_code, 'Ton personnage sourit-il ?'));
  perform t_ok((select tour from hg_duel_parties where id = v_id) = u2 and (select etat ? 'question_libre' from hg_duel_parties where id = v_id),
    'question libre : l''autre doit répondre');
  perform t_ok(t_err(2, format('hg_duel_question(%L, %L, %L)', v_code, 'barbe', 'oui')) like '%attend sa réponse%', 'répondre avant de jouer');
  perform t_call(2, format('hg_duel_repondre(%L, true)', v_code));
  e := t_call(3, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'quiestce'->'question_en_attente' = 'null'::jsonb and (e->'partie'->>'tour')::uuid = u2
    and (select reponse from hg_duel_qec_questions where partie = v_id and type = 'libre'), 'réponse enregistrée, le répondant joue');
  perform t_call(2, format('hg_duel_baisser(%L, %L::int[])', v_code, '{3,1,1,7}'));
  perform t_ok(t_call(2, format('hg_duel_etat(%L)', v_code))->'quiestce'->'mes_baisses' = '[1,3,7]'::jsonb, 'personnages baissés gardés');
  perform t_ok((t_call(3, format('hg_duel_etat(%L)', v_code))->'quiestce'->'restants_adverses'->>(u2::text))::int = 21, 'l''autre voit combien il m''en reste');
  -- Mauvaise réponse : manche perdue
  select id into v_faux from hg_duel_qec_persos where plateau = 'paleto' and id <> v_perso order by id limit 1;
  r := t_call(2, format('hg_duel_deviner(%L, %s)', v_code, v_faux)) #>> '{}';
  perform t_ok(r = 'false' and (select manches from hg_duel_joueurs where partie = v_id and user_id = u3) = 1, 'mauvaise désignation : l''autre gagne la manche');
  perform t_ok((select manche from hg_duel_parties where id = v_id) = 2 and (select count(*) from hg_duel_qec_secrets where partie = v_id and manche = 2) = 2
    and t_call(2, format('hg_duel_etat(%L)', v_code))->'quiestce'->'mes_baisses' = '[]'::jsonb, 'nouvelle manche : nouveaux personnages, plateau relevé');
  -- Bonne réponse
  v_tour := (select tour from hg_duel_parties where id = v_id);
  select perso into v_perso from hg_duel_qec_secrets where partie = v_id and manche = 2 and user_id = hg_duel__autre(v_id, v_tour);
  r := t_callu(v_tour, format('hg_duel_deviner(%L, %s)', v_code, v_perso)) #>> '{}';
  perform t_ok(r = 'true', 'bonne désignation : manche gagnée');
  perform t_ok((select statut from hg_duel_parties where id = v_id) = 'terminee', 'deux manches gagnées : duel fini (au meilleur des 3)');
  -- Absent sur une question libre : pas de réponse, pas de pénalité
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'quiestce', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  v_id := t_pid(v_code);
  v_tour := (select tour from hg_duel_parties where id = v_id);
  perform t_callu(v_tour, format('hg_duel_question_libre(%L, %L)', v_code, 'Aime-t-il la raclette ?'));
  update hg_duel_parties set tour_fin = now() - interval '1 second' where id = v_id;
  perform t_callu(v_tour, format('hg_duel_avancer(%L)', v_code));
  perform t_ok(not (select etat ? 'question_libre' from hg_duel_parties where id = v_id)
    and (select reponse is null and repondu from hg_duel_qec_questions where partie = v_id and type = 'libre' order by id desc limit 1)
    and (select manques from hg_duel_joueurs where partie = v_id and user_id = hg_duel__autre(v_id, v_tour)) = 0, 'question libre sans réponse : pas de pénalité');
  perform t_call(2, format('hg_duel_quitter(%L)', v_code));

  -- Robot : pas de question libre ; il joue après moi
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'quiestce', 'adversaire', 'robot', 'robot', 2, 'commence', 'moi')::text)) #>> '{}';
  perform t_ok(t_err(2, format('hg_duel_question_libre(%L, %L)', v_code, 'Est-il gentil ?')) like '%désactivées%', 'pas de question libre contre le robot');
  perform t_call(2, format('hg_duel_question(%L, %L, %L)', v_code, 'barbe', 'oui'));
  perform t_ok((select count(*) from hg_duel_qec_questions where partie = t_pid(v_code)) >= 2
    or (select statut from hg_duel_parties where code = v_code order by created_at desc limit 1) <> 'en_cours', 'le robot joue après moi');
  perform t_call(2, format('hg_duel_quitter(%L)', v_code));
end $$;
