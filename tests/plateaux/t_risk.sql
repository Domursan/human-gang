-- Tests du Risk (moteur 130) : carte, mise en place, renforts, cartes, combats, conquête, manœuvre, missions, simulations.
\set ON_ERROR_STOP 1
-- Robot de test agressif : place tout sur le plus gros territoire en contact, attaque tant qu'il peut (avec limite).
create or replace function t_rk_tour(c text) returns void language plpgsql as $$
declare pid uuid := t_pid(c); e jsonb; u uuid; t text; v text; k int := 0; m text[];
begin
  select etat into e from hg_plat_parties where id = pid;
  if e->>'phase' = 'placement' then perform t_expirer(c); return; end if;
  u := (e->>'actif')::uuid;
  if e->>'phase' = 'renforts' then
    while cardinality(hg_plat__rk_cartes(pid, u)) >= 3 and hg_plat__rk_trouver(hg_plat__rk_cartes(pid, u)) is not null and k < 3 loop
      perform t_agir(u, c, 'echanger', jsonb_build_object('cartes', to_jsonb(hg_plat__rk_trouver(hg_plat__rk_cartes(pid, u))))); k := k + 1;
    end loop;
    select x into t from unnest(hg_plat__rk_mes(pid, u)) x where exists (select 1 from unnest(hg_plat__rk_voisins(x)) y where hg_plat__rk_proprio(pid, y) <> u)
      order by hg_plat__rk_armees(pid, x) desc limit 1;
    perform t_agir(u, c, 'placer', jsonb_build_object('placements', jsonb_build_object(t, (select (etat->>'renforts')::int from hg_plat_parties where id = pid))));
  end if;
  k := 0;
  loop
    select etat into e from hg_plat_parties where id = pid;
    exit when (select statut from hg_plat_parties where id = pid) <> 'en_cours' or k > 60;
    if e->>'phase' = 'conquete' then perform t_agir(u, c, 'avancer', jsonb_build_object('armees', hg_plat__rk_armees(pid, e->'conquete'->>'de') - 1)); k := k + 1; continue; end if;
    if e->>'phase' = 'renforts' then
      perform t_agir(u, c, 'echanger', jsonb_build_object('cartes', to_jsonb(hg_plat__rk_trouver(hg_plat__rk_cartes(pid, u)))));
      select x into t from unnest(hg_plat__rk_mes(pid, u)) x order by hg_plat__rk_armees(pid, x) desc limit 1;
      perform t_agir(u, c, 'placer', jsonb_build_object('placements', jsonb_build_object(t, (select (etat->>'renforts')::int from hg_plat_parties where id = pid))));
      continue;
    end if;
    exit when e->>'phase' <> 'attaque';
    select x, y into t, v from unnest(hg_plat__rk_mes(pid, u)) x, unnest(hg_plat__rk_voisins(x)) y
      where hg_plat__rk_armees(pid, x) >= 3 and hg_plat__rk_proprio(pid, y) <> u order by hg_plat__rk_armees(pid, x) - hg_plat__rk_armees(pid, y) desc limit 1;
    exit when t is null;
    perform t_agir(u, c, 'attaquer', jsonb_build_object('de', t, 'vers', v, 'des', 3)); k := k + 1;
  end loop;
  if (select statut from hg_plat_parties where id = pid) = 'en_cours' and (select etat->>'phase' from hg_plat_parties where id = pid) in ('attaque', 'manoeuvre') then
    perform t_agir(u, c, 'finir');
  end if;
end $$;

do $$
declare c text; pid uuid; e jsonb; u uuid; u2 uuid; i int; k int; n_fin int := 0; v jsonb; t text; t2 text; r record;
begin
  -- Carte : 42 territoires, voisinages symétriques
  perform t_ok(cardinality(hg_plat__rk_tous()) = 42, '42 territoires');
  perform t_ok(not exists (select 1 from unnest(hg_plat__rk_tous()) a, unnest(hg_plat__rk_voisins(a)) b where not (a = any(hg_plat__rk_voisins(b)))), 'voisinages symétriques');
  perform t_ok((select count(*) from unnest(hg_plat__rk_tous()) a where hg_plat__rk_continent(a) = 'asi') = 12, 'Asie : 12 territoires');
  perform t_ok(hg_plat__rk_valeur(1) = 4 and hg_plat__rk_valeur(5) = 12 and hg_plat__rk_valeur(6) = 15 and hg_plat__rk_valeur(7) = 20, 'valeurs des échanges');
  perform t_ok(hg_plat__rk_combinaison(array['alaska','tno','groenland']) and not hg_plat__rk_combinaison(array['alaska','groenland','tno','x']), 'combinaisons');
  -- Mise en place
  c := t_partie('risk', 3); pid := t_pid(c);
  perform t_ok((select count(*) from jsonb_object_keys((select etat->'territoires' from hg_plat_parties where id = pid))) = 42, 'tous les territoires distribués');
  perform t_ok((select bool_and((etat->>'a_placer')::int = 35 - 14) from hg_plat_joueurs where partie = pid), '35 armées à 3 joueurs');
  v := t_etat(t_uid(1), c);
  perform t_ok(v->'jeu'->'moi'->'mission'->>'id' is not null and v->'jeu'->'missions_fin' = 'null'::jsonb, 'ma mission seulement');
  t := (hg_plat__rk_mes(pid, t_uid(1)))[1];
  t2 := (hg_plat__rk_mes(pid, t_uid(2)))[1];
  perform t_ok(t_agir_err(t_uid(1), c, 'placer', jsonb_build_object('placements', jsonb_build_object(t2, 3))) like '%appartient%', 'placer chez un autre refusé');
  perform t_ok(t_agir_err(t_uid(1), c, 'placer', jsonb_build_object('placements', jsonb_build_object(t, 99))) like '%armées à placer%', 'trop d''armées refusé');
  perform t_agir(t_uid(1), c, 'placer', jsonb_build_object('placements', jsonb_build_object(t, 21)));
  perform t_ok((select etat->>'phase' from hg_plat_parties where id = pid) = 'placement', 'on attend les autres');
  perform t_expirer(c);
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->>'phase' = 'renforts' and e->>'actif' is not null, 'chrono : placement automatique, la partie commence');
  u := (e->>'actif')::uuid;
  perform t_ok((e->>'renforts')::int = hg_plat__rk_renforts(pid, u) and (e->>'renforts')::int >= 3, 'renforts calculés');
  perform t_ok(t_agir_err(u, c, 'attaquer', '{}') like '%pas attaquer%', 'pas d''attaque avant les renforts');
  -- Combat contrôlé
  select x, y into t, t2 from unnest(hg_plat__rk_mes(pid, u)) x, unnest(hg_plat__rk_voisins(x)) y where hg_plat__rk_proprio(pid, y) <> u limit 1;
  perform t_agir(u, c, 'placer', jsonb_build_object('placements', jsonb_build_object(t, (e->>'renforts')::int)));
  perform t_ok((select etat->>'phase' from hg_plat_parties where id = pid) = 'attaque', 'renforts placés → attaque');
  perform hg_plat__rk_sett(pid, t, u, 30); perform hg_plat__rk_sett(pid, t2, hg_plat__rk_proprio(pid, t2), 1);
  for i in 1 .. 20 loop
    exit when hg_plat__rk_proprio(pid, t2) = u;
    perform t_agir(u, c, 'attaquer', jsonb_build_object('de', t, 'vers', t2, 'des', 3));
  end loop;
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->>'phase' = 'conquete' and (e->>'conquis')::boolean, 'conquête');
  perform t_ok(t_agir_err(u, c, 'avancer', '{"armees": 1}') like '%Déplace entre%', 'avancer au moins le nombre de dés');
  perform t_agir(u, c, 'avancer', '{"armees": 5}');
  perform t_ok(hg_plat__rk_armees(pid, t2) = 5, 'armées déplacées');
  perform t_agir(u, c, 'fin_attaque');
  perform t_ok(t_agir_err(u, c, 'manoeuvrer', jsonb_build_object('de', t, 'vers', t2, 'armees', 999)) like '%Déplace entre%', 'manœuvre limitée');
  perform t_agir(u, c, 'manoeuvrer', jsonb_build_object('de', t, 'vers', t2, 'armees', 2));
  perform t_ok(cardinality(hg_plat__rk_cartes(pid, u)) = 1, 'une carte après une conquête');
  perform t_ok((select (etat->>'actif')::uuid from hg_plat_parties where id = pid) <> u, 'tour suivant');
  -- Échange obligatoire à 5 cartes
  select etat into e from hg_plat_parties where id = pid; u2 := (e->>'actif')::uuid;
  perform hg_plat__rk_set_cartes(pid, u2, array['alaska','tno','groenland','alberta','ontario']);
  perform t_ok(t_agir_err(u2, c, 'placer', jsonb_build_object('placements', jsonb_build_object((hg_plat__rk_mes(pid, u2))[1], 1))) like '%5 cartes%', 'échange obligatoire à 5 cartes');
  k := (e->>'renforts')::int;
  perform t_agir(u2, c, 'echanger', '{"cartes": ["alaska","tno","groenland"]}');
  perform t_ok((select (etat->>'renforts')::int from hg_plat_parties where id = pid) = k + 4, 'premier échange : +4');
  -- Mission « 24 territoires »
  update hg_plat_joueurs set prive = jsonb_set(prive, '{mission}', '{"id":"m6","type":"m6"}') where partie = pid and user_id = u2;
  for r in select x from unnest(hg_plat__rk_tous()) x limit 24 loop perform hg_plat__rk_sett(pid, r.x, u2, 2); end loop;
  update hg_plat_parties set started_at = now() - interval '1 hour' where id = pid;
  perform t_agir(u2, c, 'placer', jsonb_build_object('placements', jsonb_build_object((hg_plat__rk_mes(pid, u2))[1], (select (etat->>'renforts')::int from hg_plat_parties where id = pid))));
  perform t_ok((select statut = 'terminee' and raison = 'mission' from hg_plat_parties where id = pid), 'mission remplie : victoire');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = u2 and badge_code = 'plat_risk_mission'), 'badge Mission accomplie');
  perform t_ok(t_etat(t_uid(1), c)->'jeu'->'missions_fin' <> 'null'::jsonb, 'fin : missions révélées');
  -- Simulations (sans missions : conquête du monde ; avec missions)
  for k in 1 .. 12 loop
    c := t_partie('risk', 2 + (k % 5), jsonb_build_object('missions', k % 2 = 0)); pid := t_pid(c);
    i := 0;
    while (select statut from hg_plat_parties where id = pid) = 'en_cours' and i < 400 loop perform t_rk_tour(c); i := i + 1; end loop;
    if (select statut from hg_plat_parties where id = pid) = 'terminee' then n_fin := n_fin + 1; end if;
    perform t_ok(not exists (select 1 from hg_plat_parties p, jsonb_each(p.etat->'territoires') x(k2, v2) where p.id = pid and ((v2->>'a')::int < 1 and p.etat->>'phase' <> 'conquete')), 'simulation ' || k || ' : jamais 0 armée');
    perform t_ok(not exists (select 1 from hg_plat_joueurs where partie = pid and elimine and cardinality(hg_plat__rk_mes(pid, user_id)) > 0), 'simulation ' || k || ' : éliminés sans territoire');
  end loop;
  perform t_ok(n_fin = 12, 'simulations : ' || n_fin || '/12 terminées');
end $$;
