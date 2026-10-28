-- Jouabilité (migration 171) : règles modifiables dans la salle, 0 du sept-zéro, UNO après la pose, donne équitable.
do $$
declare v_code text; v_id uuid; c bigint; u1 uuid := t_uid(1); u2 uuid := t_uid(2); u3 uuid := t_uid(3); a int; b int; d int;
begin
  -- Salle d'attente : l'hôte change les règles, les autres redeviennent « pas prêts »
  v_code := t_call(1, 'hg_uno_creer(''{"nb_places":4}''::jsonb)') #>> '{}';
  v_id := t_pid(v_code);
  perform t_call(2, format('hg_uno_rejoindre(%L)', v_code)); perform t_call(2, format('hg_uno_pret(%L, true)', v_code));
  perform t_call(3, format('hg_uno_rejoindre(%L)', v_code)); perform t_call(3, format('hg_uno_pret(%L, true)', v_code));
  perform t_ok(t_err(2, format('hg_uno_regles(%L, %L::jsonb)', v_code, '{"t_tour":60}')) like 'Seul l''hôte%', 'un joueur ne change pas les règles');
  perform t_ok(t_err(1, format('hg_uno_regles(%L, %L::jsonb)', v_code, '{"t_tour":45}')) like 'Durée%', 'durée invalide refusée');
  perform t_ok(t_err(1, format('hg_uno_regles(%L, %L::jsonb)', v_code, '{"nb_places":2}')) like 'Le nombre de places%', 'pas moins de places que de joueurs');
  perform t_call(1, format('hg_uno_regles(%L, %L::jsonb)', v_code, '{"t_tour":60,"mode":"points","variantes":{"sept_zero":true}}'));
  perform t_ok((select t_tour = 60 and mode = 'points' and (variantes->>'sept_zero')::boolean and not (variantes->>'cumul')::boolean
    from hg_uno_parties where id = v_id), 'règles enregistrées');
  perform t_ok(not exists (select 1 from hg_uno_joueurs where partie = v_id and user_id <> u1 and pret), 'les autres joueurs ne sont plus prêts');
  perform t_ok(t_err(1, format('hg_uno_lancer(%L)', v_code)) like 'Tous les joueurs%', 'il faut reconfirmer avant de lancer');
  perform t_call(2, format('hg_uno_pret(%L, true)', v_code)); perform t_call(3, format('hg_uno_pret(%L, true)', v_code));
  perform t_call(1, format('hg_uno_lancer(%L)', v_code));
  perform t_ok(t_err(1, format('hg_uno_regles(%L, %L::jsonb)', v_code, '{"t_tour":30}')) like 'La partie a déjà commencé%', 'règles figées une fois lancée');

  -- Sept-zéro : poser un 0 fait tourner toutes les mains
  update hg_uno_joueurs set place = right(user_id::text, 1)::int where partie = v_id;
  update hg_uno_cartes set lieu = 'pioche', user_id = null where partie = v_id and lieu in ('main', 'defausse');
  update hg_uno_cartes set lieu = 'defausse', ordre = 1 where id = (select id from hg_uno_cartes where partie = v_id and couleur = 'r' and valeur = '5' limit 1);
  update hg_uno_cartes set lieu = 'main', user_id = u1 where id in (select id from hg_uno_cartes where partie = v_id and lieu = 'pioche' and couleur = 'r' and valeur = '0' limit 1);
  update hg_uno_cartes set lieu = 'main', user_id = u1 where id in (select id from hg_uno_cartes where partie = v_id and lieu = 'pioche' and couleur = 'b' limit 2);
  update hg_uno_cartes set lieu = 'main', user_id = u2 where id in (select id from hg_uno_cartes where partie = v_id and lieu = 'pioche' and couleur = 'g' limit 4);
  update hg_uno_cartes set lieu = 'main', user_id = u3 where id in (select id from hg_uno_cartes where partie = v_id and lieu = 'pioche' and couleur = 'y' limit 5);
  update hg_uno_parties set tour = u1, sens = 1, couleur = 'r', defi = null, cumul = 0, a_pioche = false where id = v_id;
  perform hg_uno__compter(v_id);
  c := (select id from hg_uno_cartes where partie = v_id and user_id = u1 and valeur = '0' limit 1);
  perform t_call(1, format('hg_uno_jouer(%L, %s)', v_code, c));
  select count(*) filter (where couleur = 'b') into a from hg_uno_cartes where partie = v_id and lieu = 'main' and user_id = u2;
  select count(*) filter (where couleur = 'g') into b from hg_uno_cartes where partie = v_id and lieu = 'main' and user_id = u3;
  select count(*) filter (where couleur = 'y') into d from hg_uno_cartes where partie = v_id and lieu = 'main' and user_id = u1;
  perform t_ok(a = 2 and b = 4 and d = 5, 'le 0 fait passer chaque main au joueur suivant');
  perform t_ok(t_invariants(v_id) is null, 'cartes cohérentes après la rotation');
  perform t_ok(position('_uno_rot' in pg_get_functiondef('public.hg_uno__poser(uuid,uuid,bigint,text,uuid)'::regprocedure)) = 0,
    'plus de table temporaire dans la pose');
end $$;

-- Donne : 200 lancements de 4 joueurs, premier joueur et cartes au hasard
do $$
declare v_code text; v_id uuid; i int; v_prem int[] := array[0,0,0,0]; v_coul jsonb := '{}'; v_jok int := 0; v_tot int := 0; k int;
begin
  for i in 1..200 loop
    v_code := t_call(1, 'hg_uno_creer(''{"nb_places":4}''::jsonb)') #>> '{}';
    v_id := t_pid(v_code);
    for k in 2..4 loop perform t_call(k, format('hg_uno_rejoindre(%L)', v_code)); perform t_call(k, format('hg_uno_pret(%L, true)', v_code)); end loop;
    perform t_call(1, format('hg_uno_lancer(%L)', v_code));
    k := right((select tour from hg_uno_parties where id = v_id)::text, 1)::int;
    v_prem[k] := v_prem[k] + 1;
    v_jok := v_jok + (select count(*) from hg_uno_cartes where partie = v_id and lieu = 'main' and couleur = 'k');
    v_tot := v_tot + (select count(*) from hg_uno_cartes where partie = v_id and lieu = 'main');
    perform t_call(1, format('hg_uno_quitter(%L)', v_code));
    for k in 2..4 loop begin perform t_call(k, format('hg_uno_quitter(%L)', v_code)); exception when others then null; end; end loop;
  end loop;
  raise notice 'simu donne : premier joueur %, jokers en main %/% (attendu ≈ 7,4 %%)', v_prem, v_jok, v_tot;
  perform t_ok(v_prem[1] between 30 and 75 and v_prem[2] between 30 and 75 and v_prem[3] between 30 and 75 and v_prem[4] between 30 and 75,
    'premier joueur réparti au hasard');
  perform t_ok(v_jok::numeric / v_tot between 0.05 and 0.10, 'proportion de jokers conforme au paquet (8/108)');
end $$;
