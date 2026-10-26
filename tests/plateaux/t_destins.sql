-- Tests de Destins (moteur 128) : départ, roue, cases, prêts, retraite, simulations.
\set ON_ERROR_STOP 1
do $$
declare c text; pid uuid; e jsonb; u uuid; i int; k int; n_fin int := 0; v jsonb;
begin
  perform t_ok(hg_plat__de_case(0) = 'depart' and hg_plat__de_case(90) = 'retraite' and hg_plat__de_case(51) = 'choix' and hg_plat__de_case(10) = 'diplome', 'plateau : cases clés');
  c := t_partie('destins', 3); pid := t_pid(c);
  select etat into e from hg_plat_parties where id = pid; u := (e->>'actif')::uuid;
  perform t_ok(e->>'phase' = 'depart', 'phase départ');
  perform t_ok(t_agir_err(u, c, 'tourner') like '%impossible%', 'choisir un chemin avant de tourner');
  perform t_agir(u, c, 'voie', '{"voie":"universite"}');
  perform t_ok((hg_plat__de_j(pid, u)->>'prets')::int = 5, 'université : prêt de 100 000 €');
  perform t_agir(u, c, 'tourner');
  perform t_ok((hg_plat__de_j(pid, u)->>'case')::int between 1 and 10, 'université : sur le chemin des études');
  -- Carrière
  select etat into e from hg_plat_parties where id = pid;
  if e->>'phase' <> 'depart' then perform t_expirer(c); select etat into e from hg_plat_parties where id = pid; end if;
  u := (e->>'actif')::uuid;
  perform t_agir(u, c, 'voie', '{"voie":"carriere"}');
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->>'phase' = 'metier' and jsonb_array_length(e->'choix'->'metiers') = 2, 'carrière : 2 métiers proposés');
  perform t_ok(t_agir_err(u, c, 'metier', '{"metier":"medecin"}') like '%proposés%', 'métier hors choix refusé');
  perform t_agir(u, c, 'metier', jsonb_build_object('metier', e->'choix'->'metiers'->>0));
  perform t_ok((hg_plat__de_j(pid, u)->>'salaire')::int > 0 and (hg_plat__de_j(pid, u)->>'salaire')::int <= 60000, 'métier sans diplôme et salaire');
  -- Prêts automatiques
  perform hg_plat__de_argent(pid, u, -50000);
  perform t_ok((hg_plat__de_j(pid, u)->>'argent')::int >= 0 and (hg_plat__de_j(pid, u)->>'prets')::int = 2, 'découvert : prêts automatiques');
  -- Le contenu modifié en admin ne change pas les nombres
  perform t_call(1, format('hg_plat_admin_contenu(%L, %L, %L::jsonb)', 'destins', 'metiers',
    (select jsonb_agg(x || '{"salaire": 999999999, "nom": "Docteur"}') from jsonb_array_elements(hg_plat__c('destins','metiers')) x)::text));
  perform t_ok(hg_plat__de_defaut('metiers', 'medecin', 'salaire') = 100000 and (hg_plat__c('destins','metiers')->0->>'salaire')::int = 100000, 'admin : salaires non modifiables');
  perform t_call(1, $q$hg_plat_admin_contenu('destins', 'metiers', null)$q$);
  -- Vue
  v := t_etat(u, c);
  perform t_ok(jsonb_array_length(v->'jeu'->'plateau') = 91, 'vue : plateau de 91 cases');
  -- Simulations : le jeu joue seul jusqu'à la retraite de tous
  for k in 1 .. 25 loop
    c := t_partie('destins', 2 + (k % 5)); pid := t_pid(c);
    update hg_plat_parties set started_at = now() - interval '1 hour' where id = pid;
    i := 0;
    while (select statut from hg_plat_parties where id = pid) = 'en_cours' and i < 600 loop perform t_expirer(c); i := i + 1; end loop;
    if (select statut from hg_plat_parties where id = pid) = 'terminee' then n_fin := n_fin + 1; end if;
    perform t_ok(not exists (select 1 from hg_plat_joueurs where partie = pid and (etat->>'argent')::bigint < 0), 'simulation ' || k || ' : jamais d''argent négatif');
    perform t_ok((select count(*) from hg_plat_joueurs where partie = pid and gagne) >= 1, 'simulation ' || k || ' : un gagnant');
    perform t_ok((select bool_and((etat->>'case')::int = 90) from hg_plat_joueurs where partie = pid), 'simulation ' || k || ' : tous à la retraite');
  end loop;
  perform t_ok(n_fin = 25, 'simulations : ' || n_fin || '/25 terminées');
  perform t_ok(exists (select 1 from hg_user_badges where badge_code = 'plat_destins_victoire'), 'badge Belle vie');
end $$;
