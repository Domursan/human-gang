-- Tests de Shadow Hunters (moteur 127) : règles, secrets, pouvoirs, cartes, simulations complètes.
\set ON_ERROR_STOP 1
-- Robot de test : joue un pas pour le joueur attendu (attaque toujours si possible).
create or replace function t_sh_pas(c text) returns void language plpgsql as $$
declare p hg_plat_parties; e jsonb; u uuid; ph text; v jsonb; cible uuid; l text;
begin
  select * into p from hg_plat_parties where id = t_pid(c);
  e := p.etat; ph := e->>'phase'; u := coalesce(p.tour, (e->>'actif')::uuid);
  if ph = 'vision' then perform t_agir(u, c, 'repondre', '{"mentir":false}'); return; end if;
  v := t_etat(u, c)->'jeu';
  cible := (select user_id from hg_plat_joueurs where partie = p.id and user_id <> u and not elimine order by random() limit 1);
  if ph = 'debut' then perform t_agir(u, c, 'lancer');
  elsif ph = 'choisir_zone' then perform t_agir(u, c, 'aller', jsonb_build_object('lieu', e->'options'->>0));
  elsif ph = 'zone' then
    l := hg_plat__sh_j(p.id, u)->>'lieu';
    if l = 'porte' then perform t_agir(u, c, 'lieu', jsonb_build_object('pioche', (array['vision','lumiere','tenebres'])[1 + floor(random()*3)::int]));
    elsif l = 'foret' then perform t_agir(u, c, 'lieu', jsonb_build_object('cible', cible, 'mode', 'blesser'));
    elsif l = 'sanctuaire' then
      cible := (select user_id from hg_plat_joueurs where partie = p.id and user_id <> u and not elimine and jsonb_array_length(etat->'equip') > 0 limit 1);
      if cible is null then perform t_agir(u, c, 'passer'); else perform t_agir(u, c, 'lieu', jsonb_build_object('cible', cible)); end if;
    else perform t_agir(u, c, 'lieu'); end if;
  elsif ph = 'vision_donner' then perform t_agir(u, c, 'donner_vision', jsonb_build_object('cible', cible));
  elsif ph = 'carte' then
    if t_agir_err(u, c, 'jouer_carte', jsonb_build_object('cible', cible, 'utiliser', true)) is not null then
      if t_agir_err(u, c, 'jouer_carte', jsonb_build_object('cible', (select user_id from hg_plat_joueurs where partie = p.id and user_id <> u and not elimine and jsonb_array_length(etat->'equip') > 0 limit 1), 'utiliser', false)) is not null then
        perform t_agir(u, c, 'jouer_carte', jsonb_build_object('cible', u, 'utiliser', false));
      end if;
    end if;
  elsif ph = 'attaque' then
    if (e->>'attaques')::int = 0 and jsonb_array_length(v->'moi'->'portee') > 0 then perform t_agir(u, c, 'attaquer', jsonb_build_object('cible', v->'moi'->'portee'->>0));
    else perform t_agir(u, c, 'finir'); end if;
  end if;
end $$;

do $$
declare c text; pid uuid; e jsonb; u uuid; v jsonb; i int; k int; n_fin int := 0; r record; v_txt text;
begin
  perform t_ok(t_err(1, $q$hg_plat_creer('{"jeu":"shadow","nb_places":3}'::jsonb)$q$) like '%entre 4 et 8%', 'shadow : 4 joueurs minimum');
  -- Composition
  for k in 4 .. 8 loop
    c := t_partie('shadow', k); pid := t_pid(c);
    perform t_ok((select count(*) filter (where hg_plat__sh_camp(prive->>'perso') = 'hunter') = case when k = 8 then 3 else 2 end
      and count(*) filter (where hg_plat__sh_camp(prive->>'perso') = 'shadow') = case when k = 8 then 3 else 2 end
      and count(distinct prive->>'perso') = k from hg_plat_joueurs where partie = pid), 'composition à ' || k || ' joueurs');
  end loop;
  perform t_ok((select jsonb_array_length(etat->'zones') = 3 from hg_plat_parties where id = pid), '3 groupes de lieux');
  perform t_ok((select jsonb_array_length(secret->'pioches'->'lumiere') = 16 and jsonb_array_length(secret->'pioches'->'tenebres') = 16 and jsonb_array_length(secret->'pioches'->'vision') = 16 from hg_plat_parties where id = pid), 'pioches de 16 cartes');
  -- Secrets
  select etat into e from hg_plat_parties where id = pid; u := (e->>'actif')::uuid;
  v := t_etat(u, c);
  perform t_ok(v->'jeu'->'moi'->>'perso' is not null, 'je connais mon personnage');
  perform t_ok((select bool_and(x->'etat'->>'perso' is null) from jsonb_array_elements(v->'joueurs') x), 'personnages des autres cachés');
  perform t_ok(not (v::text like '%V:v%') and not (v::text like '%"pioches": {"vision": [%') and not (v::text like '%connus": {"0%'), 'aucun secret dans la vue');
  -- Tour
  perform t_ok(t_agir_err(t_uid(case when t_num(u) = 1 then 2 else 1 end), c, 'lancer') like '%pas ton tour%', 'un autre ne joue pas');
  perform t_ok(t_agir_err(u, c, 'attaquer', jsonb_build_object('cible', t_uid(2))) like '%pas attaquer maintenant%', 'pas d''attaque avant de bouger');
  perform t_ok(t_agir_err(u, c, 'pouvoir') like '%Révèle-toi%', 'pouvoir : révélé seulement');
  perform t_agir(u, c, 'lancer');
  select etat into e from hg_plat_parties where id = pid;
  perform t_ok(e->>'phase' in ('zone', 'choisir_zone'), 'lancer → lieu');
  perform t_ok(e->'des'->>'d6' is not null, 'dés visibles');
  -- Révéler
  perform t_agir(u, c, 'reveler');
  v := t_etat(t_uid(case when t_num(u) = 1 then 2 else 1 end), c);
  perform t_ok((select x->'etat'->>'perso' from jsonb_array_elements(v->'joueurs') x where (x->>'user_id')::uuid = u) is not null, 'révélé : visible des autres');

  -- Cartes Vision : vérité et mensonge
  pid := t_pid(c);
  update hg_plat_joueurs set prive = prive || '{"perso":"vampire"}', etat = etat || '{"degats":0}' where partie = pid and user_id = t_uid(2);
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'vision', 'vision', jsonb_build_object('carte', 'V:v12', 'de', u, 'pour', t_uid(2))), tour = t_uid(2) where id = pid;
  perform t_ok(t_agir_err(t_uid(2), c, 'repondre', '{"mentir":true}') like '%Seul l''Inconnu%', 'seul l''Inconnu ment');
  perform t_agir(t_uid(2), c, 'repondre', '{"mentir":false}');
  perform t_ok((hg_plat__sh_j(pid, t_uid(2))->>'degats')::int = 1, 'Vision : un Shadow subit 1 Blessure');
  perform t_ok(exists (select 1 from hg_plat_coups where partie = pid and pour = u and texte like 'Carte Vision pour%'), 'le donneur voit la carte en privé');
  update hg_plat_joueurs set prive = prive || '{"perso":"inconnu"}' where partie = pid and user_id = t_uid(2);
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'vision', 'vision', jsonb_build_object('carte', 'V:v12', 'de', u, 'pour', t_uid(2))), tour = t_uid(2) where id = pid;
  perform t_agir(t_uid(2), c, 'repondre', '{"mentir":true}');
  perform t_ok((hg_plat__sh_j(pid, t_uid(2))->>'degats')::int = 1, 'Inconnu : peut mentir');
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'vision', 'vision', jsonb_build_object('carte', 'V:v16', 'de', u, 'pour', t_uid(2))), tour = t_uid(2) where id = pid;
  perform t_agir(t_uid(2), c, 'repondre', '{}');
  perform t_ok(t_etat(u, c)->'jeu'->'moi'->'connus'->>(t_uid(2)::text) = 'inconnu', 'Vision suprême : personnage connu en secret');

  -- Mort et équipement
  update hg_plat_joueurs set etat = etat || '{"equip":["T:hachoir"]}' where partie = pid and user_id = t_uid(2);
  perform hg_plat__sh_blesser(pid, t_uid(2), 20, u);
  perform t_ok((select elimine from hg_plat_joueurs where partie = pid and user_id = t_uid(2)), 'mort à 0 PV');
  perform t_ok(hg_plat__sh_a(pid, u, 'T:hachoir'), 'le tueur prend un équipement');
  perform t_ok(hg_plat__sh_revele(pid, t_uid(2)), 'mort : révélé');

  -- Victoire des Hunters
  c := t_partie('shadow', 4); pid := t_pid(c);
  update hg_plat_parties set started_at = now() - interval '30 minutes' where id = pid;
  for r in select user_id from hg_plat_joueurs where partie = pid and hg_plat__sh_camp(prive->>'perso') = 'shadow' loop
    perform hg_plat__sh_blesser(pid, r.user_id, 20, null);
  end loop;
  perform hg_plat__sh_verifier(pid);
  perform t_ok((select statut from hg_plat_parties where id = pid) = 'terminee', 'Shadows morts : fin');
  perform t_ok((select bool_and(gagne = (hg_plat__sh_camp(prive->>'perso') = 'hunter')) from hg_plat_joueurs where partie = pid), 'les Hunters gagnent');
  perform t_ok((select bool_and((etat->>'revele')::boolean) from hg_plat_joueurs where partie = pid), 'fin : tous révélés');
  perform t_ok(exists (select 1 from hg_user_badges where badge_code = 'plat_shadow_hunter'), 'badge Lumière éternelle');

  -- Daniel premier mort
  c := t_partie('shadow', 5); pid := t_pid(c);
  update hg_plat_joueurs set prive = prive || '{"perso":"daniel"}' where partie = pid and hg_plat__sh_camp(prive->>'perso') = 'neutre';
  perform hg_plat__sh_blesser(pid, (select user_id from hg_plat_joueurs where partie = pid and prive->>'perso' = 'daniel'), 20, null);
  perform hg_plat__sh_verifier(pid);
  perform t_ok((select gagne from hg_plat_joueurs where partie = pid and prive->>'perso' = 'daniel'), 'Daniel premier mort : gagne');

  -- Simulations complètes
  for k in 1 .. 30 loop
    c := t_partie('shadow', 4 + (k % 5)); pid := t_pid(c);
    i := 0;
    while (select statut from hg_plat_parties where id = pid) = 'en_cours' and i < 1500 loop
      perform t_sh_pas(c); i := i + 1;
      if i % 7 = 0 then perform t_expirer(c); end if;
    end loop;
    if (select statut from hg_plat_parties where id = pid) = 'terminee' then n_fin := n_fin + 1; end if;
    perform t_ok(not exists (select 1 from hg_plat_joueurs where partie = pid and (etat->>'degats')::int > hg_plat__sh_pv(prive->>'perso')), 'simulation ' || k || ' : blessures ≤ PV');
    perform t_ok(not exists (select 1 from hg_plat_joueurs where partie = pid and elimine <> ((etat->>'degats')::int >= hg_plat__sh_pv(prive->>'perso'))), 'simulation ' || k || ' : morts cohérents');
  end loop;
  perform t_ok(n_fin = 30, 'simulations : ' || n_fin || '/30 parties terminées');
end $$;
