-- Tests du Monopoly (moteur 129) : achat, loyers, constructions, hypothèques, prison, échanges, faillite, fin au temps.
\set ON_ERROR_STOP 1
do $$
declare c text; pid uuid; e jsonb; u uuid; u2 uuid; i int; k int; n_fin int := 0; v jsonb;
begin
  perform t_ok(t_err(1, $q$hg_plat_creer('{"jeu":"monopoly","options":{"duree":30}}'::jsonb)$q$) like '%Durée invalide%', 'durée vérifiée');
  c := t_partie('monopoly', 3, '{"duree": 45}'); pid := t_pid(c);
  perform t_ok((select options->>'duree' from hg_plat_parties where id = pid) = '45', 'option durée');
  select etat into e from hg_plat_parties where id = pid; u := (e->>'actif')::uuid;
  select user_id into u2 from hg_plat_joueurs where partie = pid and user_id <> u order by place limit 1;
  perform t_ok((hg_plat__mo_j(pid, u)->>'argent')::int = 1500, '1 500 au départ');
  -- Achat forcé : on place le joueur avant la Rue de la Paix
  perform hg_plat__mo_set(pid, u, '{"pos": 39}');
  update hg_plat_parties set etat = etat || '{"phase": "achat"}' where id = pid;
  perform t_agir(u, c, 'acheter');
  perform t_ok(hg_plat__mo_proprio(pid, 39) = u and (hg_plat__mo_j(pid, u)->>'argent')::int = 1100, 'achat Rue de la Paix');
  -- Loyer simple, puis doublé avec le groupe
  perform t_ok(hg_plat__mo_loyer(pid, 39, 7) = 50, 'loyer nu 50');
  perform hg_plat__mo_setp(pid, 37, jsonb_build_object('proprio', u, 'maisons', 0, 'hypotheque', false));
  perform t_ok(hg_plat__mo_loyer(pid, 39, 7) = 100, 'groupe complet : loyer doublé');
  -- Construire
  update hg_plat_parties set etat = etat || '{"phase": "gestion"}' where id = pid;
  perform t_agir(u, c, 'construire', '{"case": 39}');
  perform t_ok(t_agir_err(u, c, 'construire', '{"case": 39}') like '%égale%', 'construction égale');
  perform t_agir(u, c, 'construire', '{"case": 37}');
  perform t_ok(hg_plat__mo_loyer(pid, 39, 7) = 200, 'loyer avec 1 maison');
  perform t_ok(t_agir_err(u, c, 'hypothequer', '{"case": 37}') like '%maisons%', 'pas d''hypothèque avec des maisons');
  perform t_agir(u, c, 'vendre_maison', '{"case": 39}');
  perform t_agir(u, c, 'vendre_maison', '{"case": 37}');
  perform t_agir(u, c, 'hypothequer', '{"case": 37}');
  perform t_ok(hg_plat__mo_loyer(pid, 37, 7) = 0, 'hypothéqué : pas de loyer');
  perform t_agir(u, c, 'lever_hypotheque', '{"case": 37}');
  -- Gares et compagnies
  perform hg_plat__mo_setp(pid, 5, jsonb_build_object('proprio', u2)); perform hg_plat__mo_setp(pid, 15, jsonb_build_object('proprio', u2));
  perform t_ok(hg_plat__mo_loyer(pid, 5, 7) = 50, '2 gares : 50');
  perform hg_plat__mo_setp(pid, 12, jsonb_build_object('proprio', u2));
  perform t_ok(hg_plat__mo_loyer(pid, 12, 7) = 28, 'compagnie : 4 × dés');
  -- Échange
  perform t_agir(u, c, 'proposer_echange', jsonb_build_object('a', u2, 'donne', '{"argent": 100}'::jsonb, 'recoit', '{"proprietes": [5]}'::jsonb));
  perform t_ok(t_agir_err(u, c, 'accepter_echange') like '%Aucune%', 'seul le destinataire accepte');
  perform t_agir(u2, c, 'accepter_echange');
  perform t_ok(hg_plat__mo_proprio(pid, 5) = u, 'échange : gare transférée');
  -- Prison
  perform hg_plat__mo_prison(pid, u);
  update hg_plat_parties set etat = etat || '{"phase": "lancer"}' where id = pid;
  perform t_agir(u, c, 'payer_prison');
  perform t_ok(not (hg_plat__mo_j(pid, u)->>'prison')::boolean, 'sortie de prison en payant');
  -- Dette et faillite
  update hg_plat_parties set etat = etat || '{"phase": "gestion"}' where id = pid;
  perform hg_plat__mo_set(pid, u, '{"argent": 10}');
  perform hg_plat__mo_payer(pid, u, 5000, u2);
  perform t_ok((select etat->>'phase' from hg_plat_parties where id = pid) = 'dette', 'découvert : phase dette');
  perform t_ok(t_agir_err(u, c, 'regler') like '%manque%', 'régler impossible à découvert');
  perform t_agir(u, c, 'faillite');
  perform t_ok((select elimine from hg_plat_joueurs where partie = pid and user_id = u) and hg_plat__mo_proprio(pid, 39) = u2, 'faillite : biens au créancier');
  -- Simulations
  for k in 1 .. 20 loop
    c := t_partie('monopoly', 2 + (k % 5)); pid := t_pid(c);
    for i in 1 .. 250 loop exit when (select statut from hg_plat_parties where id = pid) <> 'en_cours'; perform t_expirer(c); end loop;
    perform t_ok(not exists (select 1 from hg_plat_joueurs where partie = pid and not elimine and (etat->>'argent')::bigint < 0 and pid is not null
      and (select etat->>'phase' from hg_plat_parties where id = pid) <> 'dette'), 'simulation ' || k || ' : pas d''argent négatif');
    update hg_plat_parties set started_at = now() - interval '3 hours' where id = pid;
    for i in 1 .. 20 loop exit when (select statut from hg_plat_parties where id = pid) <> 'en_cours'; perform t_expirer(c); end loop;
    if (select statut from hg_plat_parties where id = pid) = 'terminee' then n_fin := n_fin + 1; end if;
    perform t_ok((select count(*) from hg_plat_joueurs where partie = pid and gagne) >= 1, 'simulation ' || k || ' : un gagnant');
    perform t_ok((select count(*) from jsonb_object_keys((select etat->'proprietes' from hg_plat_parties where id = pid))) > 0, 'simulation ' || k || ' : des terrains achetés');
  end loop;
  perform t_ok(n_fin = 20, 'simulations : ' || n_fin || '/20 terminées');
  v := t_etat(t_uid(1), c);
  perform t_ok(jsonb_array_length(v->'jeu'->'plateau') = 40, 'vue : 40 cases');
end $$;
