-- Règles précises des duels : alignements, variantes, Mastermind, défis, robot, récompenses, invités, accès, code du jour.
do $$
declare v_code text; v_id uuid; e jsonb; s record; r text; i int; u2 uuid := t_uid(2); u3 uuid := t_uid(3); g text;
begin
  delete from hg_wallet_log where reason = 'duels';
  -- Fonctions pures
  s := hg_duel__mm_score('rrgb', 'rgrb'); perform t_ok(s.bien = 2 and s.mal = 2, 'score Mastermind 2 bien 2 mal');
  s := hg_duel__mm_score('roygb', 'pppp'); s := hg_duel__mm_score('rogy', 'pppp'); perform t_ok(s.bien = 0 and s.mal = 0, 'score Mastermind 0 0');
  s := hg_duel__mm_score('rrrr', 'rrro'); perform t_ok(s.bien = 3 and s.mal = 0, 'score Mastermind doublons');
  perform t_ok((select count(*) from hg_duel__mm_possibles('[]'::jsonb)) = 1296, '1296 codes possibles au départ');
  perform t_ok((hg_duel__aligne('1111' || repeat('.', 38), 7, 6, 4)).qui = '1', 'alignement horizontal');
  perform t_ok((hg_duel__aligne(repeat('.', 15) || '2' || repeat('.', 15) || '2' || repeat('.', 15) || '2' || repeat('.', 15) || '2'
    || repeat('.', 15), 16, 5, 4)).qui = '2', 'alignement vertical');
  g := repeat('.', 225); for i in 0 .. 5 loop g := overlay(g placing '1' from i * 16 + 1 for 1); end loop;
  perform t_ok((hg_duel__aligne(g, 15, 15, 5, true)).qui is null, 'gomoku : 6 alignés ne gagnent pas');
  g := repeat('.', 225); for i in 0 .. 4 loop g := overlay(g placing '1' from i * 16 + 1 for 1); end loop;
  s := hg_duel__aligne(g, 15, 15, 5, true); perform t_ok(s.qui = '1' and s.diagonale, 'gomoku : 5 alignés en diagonale gagnent');

  -- Accès
  update hg_pages set mode = 'liste' where slug = 'duels';
  insert into hg_page_access(page_slug, user_id, allowed) select 'duels', t_uid(k), true from generate_series(2, 10) k on conflict do nothing;
  perform t_ok(t_err(11, 'hg_duel_creer(''{"jeu":"p4"}''::jsonb)') like 'Accès%', 'un membre sans accès ne peut pas créer');
  perform t_ok(t_err(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'adversaire', 'membre', 'membre', t_uid(11))::text))
    like '%n''a pas accès%', 'on ne défie pas un membre sans accès');

  -- Défi : réservé au membre défié, refus, puis défi accepté
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'adversaire', 'membre', 'membre', u3, 'commence', 'moi')::text)) #>> '{}';
  perform t_ok(v_code ~ '^HGP4-[0-9]{4}$', 'code au format HGP4-####');
  perform t_ok(jsonb_array_length(t_call(3, 'hg_duel_accueil()')->'defis_recus') = 1, 'le défi apparaît chez le membre défié');
  perform t_ok(t_err(4, format('hg_duel_rejoindre(%L)', v_code)) like '%réservé%', 'un autre membre ne prend pas le défi');
  perform t_call(3, format('hg_duel_refuser(%L)', v_code));
  perform t_ok((select statut from hg_duel_parties where id = t_pid(v_code)) = 'annulee', 'défi refusé : annulé');
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'adversaire', 'membre', 'membre', u3, 'commence', 'moi')::text)) #>> '{}';
  v_id := t_pid(v_code);
  perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_ok((select statut from hg_duel_parties where id = v_id) = 'en_cours' and (select tour from hg_duel_parties where id = v_id) = u2,
    'défi accepté : le duel démarre, l''hôte commence (« moi »)');
  perform t_ok(t_err(3, format('hg_duel_jouer(%L, 3)', v_code)) = 'Ce n''est pas ton tour.', 'hors de son tour : refusé');
  -- Colonne pleine, puis victoire verticale de 2 en colonne 0
  update hg_duel_parties set grille = overlay(grille placing '1' from 4 for 1) where id = v_id; -- (pas de gravité ici : cas fabriqué ci-dessous)
  update hg_duel_parties set grille = repeat('.', 42) where id = v_id;
  for i in 1 .. 3 loop
    perform t_call(2, format('hg_duel_jouer(%L, 0)', v_code));
    perform t_call(3, format('hg_duel_jouer(%L, 1)', v_code));
  end loop;
  perform t_call(2, format('hg_duel_jouer(%L, 0)', v_code));
  perform t_ok((select statut from hg_duel_parties where id = v_id) = 'terminee' and (select vainqueur from hg_duel_parties where id = v_id) = u2,
    'quatre pions verticaux : victoire');
  perform t_ok((select paillettes from hg_duel_joueurs where partie = v_id and user_id = u2) = 80
    and (select paillettes from hg_duel_joueurs where partie = v_id and user_id = u3) = 20, 'Paillettes : 80 au gagnant, 20 au perdant');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = u2 and badge_code = 'duel_p4_premiere'), 'badge Premier alignement');
  perform t_ok(exists (select 1 from hg_user_badges where user_id = u2 and badge_code = 'duel_p4_eclair'), 'badge Coup de foudre (moins de 10 jetons)');
  e := t_call(2, format('hg_duel_etat(%L)', v_code));
  perform t_ok(jsonb_array_length(e->'partie'->'historique') = 1 and jsonb_array_length(e->'partie'->'historique'->0->'ligne') = 4, 'historique de manche avec la ligne gagnante');
  -- Revanche : nouveau défi, l'autre commence
  r := t_call(2, format('hg_duel_rejouer(%L)', v_code)) #>> '{}';
  perform t_ok(r ~ '^HGP4-' and (select defie from hg_duel_parties where id = t_pid(r)) = u3, 'revanche : nouveau défi au même membre');
  perform t_call(3, format('hg_duel_refuser(%L)', r));

  -- Plafond « même adversaire » : 3 duels récompensés par jour
  for i in 1 .. 4 loop
    v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'morpion', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
    perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
    perform t_call(2, format('hg_duel_jouer(%L, 0)', v_code)); perform t_call(3, format('hg_duel_jouer(%L, 3)', v_code));
    perform t_call(2, format('hg_duel_jouer(%L, 1)', v_code)); perform t_call(3, format('hg_duel_jouer(%L, 4)', v_code));
    perform t_call(2, format('hg_duel_jouer(%L, 2)', v_code));
  end loop;
  perform t_ok((select paillettes from hg_duel_joueurs where partie = t_pid(v_code) and user_id = u2) = 0, '4e duel du jour contre le même membre : pas de Paillettes');

  -- Pop Out
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'variante', 'popout', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
  v_id := t_pid(v_code); perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_call(2, format('hg_duel_jouer(%L, 2)', v_code));
  perform t_ok(t_err(3, format('hg_duel_jouer(%L, 2, ''retire'')', v_code)) like 'Tu ne peux retirer%', 'Pop Out : on ne retire pas le pion de l''autre');
  perform t_call(3, format('hg_duel_jouer(%L, 2)', v_code));
  perform t_call(2, format('hg_duel_jouer(%L, 2, ''retire'')', v_code));
  perform t_ok(substr((select grille from hg_duel_parties where id = v_id), 5 * 7 + 3, 1) = '2', 'Pop Out : la colonne descend après le retrait');

  -- Morpion ultime : petite grille imposée
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'morpion', 'variante', 'ultime', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
  v_id := t_pid(v_code); perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_call(2, format('hg_duel_jouer(%L, 4)', v_code)); -- grille 0, case 4 : l'adversaire doit jouer en grille 4
  perform t_ok((select cible from hg_duel_parties where id = v_id) = 4, 'ultime : l''adversaire est envoyé en grille 5');
  perform t_ok(t_err(3, format('hg_duel_jouer(%L, 0)', v_code)) like 'Tu dois jouer%', 'ultime : hors de la grille imposée, refusé');
  perform t_call(3, format('hg_duel_jouer(%L, 36)', v_code));
  perform t_ok((select cible from hg_duel_parties where id = v_id) = 0, 'ultime : renvoi en grille 1');

  -- Mastermind : codes choisis, secrets illisibles, indices seulement pour l'adversaire
  v_code := t_call(2, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'mastermind', 'adversaire', 'code', 'codes', 'choisis', 'visibilite', 'publique')::text)) #>> '{}';
  v_id := t_pid(v_code); perform t_call(3, format('hg_duel_rejoindre(%L)', v_code));
  perform t_ok((select phase from hg_duel_parties where id = v_id) = 'codes', 'Mastermind : phase de choix des codes');
  perform t_ok(t_err(2, format('hg_duel_essayer(%L, ''rrrr'')', v_code)) like 'Les codes ne sont pas%', 'pas d''essai avant les codes');
  perform t_call(2, format('hg_duel_code_secret(%L, ''rgby'')', v_code));
  perform t_call(3, format('hg_duel_code_secret(%L, ''pppo'')', v_code));
  perform t_ok((select phase from hg_duel_parties where id = v_id) = 'jeu', 'les deux codes posés : la manche commence');
  perform t_ok(not has_table_privilege('authenticated', 'public.hg_duel_codes', 'select'), 'codes secrets illisibles en direct');
  perform t_ok(not has_table_privilege('authenticated', 'public.hg_duel_essais', 'select'), 'essais illisibles en direct');
  perform t_call(2, format('hg_duel_essayer(%L, ''pppp'')', v_code));
  e := t_call(3, format('hg_duel_etat(%L)', v_code));
  perform t_ok(e->'mastermind'->>'mon_code' = 'pppo' and (e->'mastermind'->'essais_adverses'->(u2::text)->0) ? 'bien'
    and not (e->'mastermind'->'essais_adverses'->(u2::text)->0) ? 'essai', 'l''adversaire voit les indices, pas les couleurs');
  e := t_call(5, format('hg_duel_etat(%L)', v_code));
  perform t_ok((e->'moi'->>'spectateur')::boolean and e->'mastermind'->>'mon_code' is null and jsonb_array_length(e->'mastermind'->'mes_essais') = 0,
    'un spectateur ne voit aucun code');
  perform t_call(2, format('hg_duel_essayer(%L, ''pppo'')', v_code)); -- trouvé en 2
  perform t_ok((select trouve_en from hg_duel_joueurs where partie = v_id and user_id = u2) = 2, 'code trouvé en 2 essais');
  perform t_call(3, format('hg_duel_essayer(%L, ''oooo'')', v_code)); -- 3 a fait 1 essai : il peut encore égaliser ? non (il faudrait 1 essai)
  perform t_ok((select statut from hg_duel_parties where id = v_id) = 'terminee' and (select vainqueur from hg_duel_parties where id = v_id) = u2,
    'Mastermind : fin dès que l''autre ne peut plus faire mieux');

  -- Robot : joue tout de suite, pas de Paillettes
  v_code := t_call(4, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'morpion', 'adversaire', 'robot', 'robot', 3, 'commence', 'lui')::text)) #>> '{}';
  v_id := t_pid(v_code);
  perform t_ok((select nb_coups from hg_duel_parties where id = v_id) = 1 and (select tour from hg_duel_parties where id = v_id) = t_uid(4),
    'robot : il a déjà joué son premier coup');
  for i in 1 .. 6 loop
    exit when (select statut from hg_duel_parties where id = v_id) <> 'en_cours';
    perform t_call(4, format('hg_duel_jouer(%L, %s)', v_code, (select position('.' in grille) - 1 from hg_duel_parties where id = v_id)));
  end loop;
  perform t_ok((select statut from hg_duel_parties where id = v_id) = 'terminee', 'robot : la partie va au bout');
  perform t_ok((select coalesce(sum(paillettes), 0) from hg_duel_joueurs where partie = v_id) = 0, 'robot : aucune Paillette');
  perform t_ok((select vainqueur from hg_duel_parties where id = v_id) is distinct from t_uid(4), 'robot difficile : imbattable avec un jeu naïf');

  -- Absent : 3 coups manqués = forfait
  v_code := t_call(5, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'variante', 'grande', 'adversaire', 'code', 'commence', 'moi')::text)) #>> '{}';
  v_id := t_pid(v_code); perform t_call(6, format('hg_duel_rejoindre(%L)', v_code));
  for i in 1 .. 3 loop
    update hg_duel_parties set tour_fin = now() - interval '1 second' where id = v_id;
    perform hg_duel__echeances(v_id);
    exit when (select statut from hg_duel_parties where id = v_id) <> 'en_cours';
    perform t_call(6, format('hg_duel_jouer(%L, %s)', v_code, i));
  end loop;
  perform t_ok((select vainqueur from hg_duel_parties where id = v_id) = t_uid(6) and (select etat->>'forfait' from hg_duel_parties where id = v_id) = t_uid(5)::text,
    'trois coups manqués : forfait');

  -- Abandon
  v_code := t_call(5, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'adversaire', 'code')::text)) #>> '{}';
  perform t_call(6, format('hg_duel_rejoindre(%L)', v_code));
  perform t_call(6, format('hg_duel_quitter(%L)', v_code));
  perform t_ok((select vainqueur from hg_duel_parties where id = t_pid(v_code)) = t_uid(5), 'abandon : l''adversaire gagne');
  perform t_ok((select coalesce(sum(paillettes), 0) from hg_duel_joueurs where partie = t_pid(v_code)) = 0
    and not exists (select 1 from hg_user_badges where user_id = t_uid(5) and badge_code = 'duel_p4_premiere'), 'abandon avant la fin de la 1re manche : ni Paillettes ni badge');

  -- Invités
  v_code := t_call(7, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'p4', 'adversaire', 'code', 'invites', true, 'commence', 'lui')::text)) #>> '{}';
  perform t_ok((hg_duel_invite('apercu', v_code) ->> 'invites')::boolean, 'aperçu public d''un duel ouvert aux invités');
  e := hg_duel_invite('rejoindre', v_code, null, '{"pseudo":"Mélo"}');
  perform set_config('request.jwt.claims', '', false);
  perform t_ok((select statut from hg_duel_parties where id = t_pid(v_code)) = 'en_cours', 'l''invité rejoint : le duel démarre');
  perform hg_duel_invite('jouer', v_code, e->>'jeton', '{"coup":3}');
  perform set_config('request.jwt.claims', '', false);
  perform t_ok((select nb_coups from hg_duel_parties where id = t_pid(v_code)) = 1, 'l''invité joue');
  begin
    perform hg_duel_invite('etat', v_code, 'mauvais');
    perform t_ok(false, 'jeton invalide refusé');
  exception when others then perform t_ok(sqlerrm like 'Invitation expirée%', 'jeton invalide refusé'); end;
  perform set_config('request.jwt.claims', '', false);
  perform t_ok(t_err(7, 'hg_duel_admin_reglages()') like 'Réservé%', 'réglages admin refusés à un membre');
  perform t_ok(t_err(1, 'hg_duel_admin_reglages()') is null, 'réglages admin pour l''admin');
  perform t_call(1, format('hg_duel_admin_arreter(%L)', v_code));
  perform t_ok((select statut from hg_duel_parties where id = t_pid(v_code)) = 'annulee', 'l''admin arrête un duel');

  -- Défi expiré
  v_code := t_call(8, format('hg_duel_creer(%L::jsonb)', jsonb_build_object('jeu', 'mastermind', 'adversaire', 'membre', 'membre', t_uid(9))::text)) #>> '{}';
  update hg_duel_parties set defi_expire = now() - interval '1 second' where id = t_pid(v_code);
  perform hg_duel_tick();
  perform t_ok((select statut from hg_duel_parties where id = t_pid(v_code)) = 'annulee', 'défi expiré : annulé par la tâche planifiée');

  -- Code du jour
  e := t_call(8, 'hg_duel_jour()');
  perform t_ok((e->>'fini')::boolean = false and jsonb_array_length(e->'essais') = 0 and e->>'secret' is null, 'code du jour : secret caché au départ');
  e := t_call(8, format('hg_duel_jour_essayer(%L)', (select secret from hg_duel_jour where jour = hg_duel__aujourdhui())));
  perform t_ok((e->>'trouve_en')::int = 1 and e->>'secret' is not null and jsonb_array_length(e->'classement') = 1, 'code du jour trouvé : classement');
  perform t_ok((select sum(delta) from hg_wallet_log where user_id = t_uid(8) and reason = 'duels') = 30, 'code du jour : 30 Paillettes');
  perform t_ok(t_err(8, 'hg_duel_jour_essayer(''rrrr'')') like 'Tu as déjà trouvé%', 'code du jour : une seule fois');
  for i in 1 .. 10 loop perform t_call(9, 'hg_duel_jour_essayer(''pppp'')'); end loop;
  perform t_ok(t_err(9, 'hg_duel_jour_essayer(''pppp'')') like '%10 essais%' or exists (select 1 from hg_duel_jour where secret = 'pppp'), 'code du jour : 10 essais au plus');

  -- Statistiques et accueil
  e := t_call(2, 'hg_duel_stats()');
  perform t_ok((e->>'duels')::int >= 5 and e->'rival'->>'pseudo' = 'Joueur3', 'statistiques et rival favori');
  perform t_ok(t_err(2, 'hg_duel_accueil()') is null and t_err(2, 'hg_duel_membres()') is null, 'accueil et liste des membres');
end $$;
