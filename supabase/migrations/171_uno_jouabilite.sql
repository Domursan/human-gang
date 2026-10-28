-- ===== Humane Gang — migration 171 : Uno, corrections de jouabilité =====
-- 1. Sept-zéro : poser un 0 échouait (erreur « requires a WHERE clause ») : la rotation des mains n'utilise plus de table
--    temporaire vidée par une suppression sans condition (refusée par Supabase).
-- 2. UNO : on le dit APRÈS avoir posé son avant-dernière carte (plus avant, à 2 cartes). Le joueur a 3 secondes pour cliquer
--    avant de pouvoir être contré (colonne uno_depuis). Un joueur qui repasse à plusieurs cartes perd son UNO.
-- 3. Salle d'attente : l'hôte peut modifier les règles (hg_uno_regles) ; chaque changement remet les autres joueurs « pas prêts ».
-- Rejouable.

alter table public.hg_uno_parties add column if not exists uno_depuis timestamptz;

-- UNO perdu dès qu'on a plus d'une carte (on ne peut le dire qu'avec une seule carte).
create or replace function public.hg_uno__compter(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_uno_joueurs j set nb_cartes = x.n, max_cartes = greatest(j.max_cartes, x.n),
    uno = case when x.n <> 1 then false else j.uno end
  from (select jj.user_id, (select count(*)::int from hg_uno_cartes c where c.partie = p_id and c.lieu = 'main' and c.user_id = jj.user_id) n
        from hg_uno_joueurs jj where jj.partie = p_id) x
  where j.partie = p_id and j.user_id = x.user_id
$$;

create or replace function public.hg_uno__poser(p_id uuid, p_user uuid, p_carte bigint, p_couleur text, p_cible uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; c hg_uno_cartes; v_ordre int; v_reste int; v_suiv uuid; v_txt text; v_avant text; v_legal boolean;
  r record; arr uuid[]; mains bigint[][]; i int; n int;
begin
  select * into p from hg_uno_parties where id = p_id;
  select * into c from hg_uno_cartes where id = p_carte;
  v_avant := p.couleur;
  -- Légalité du +4 : le poseur n'avait aucune carte de la couleur demandée (avant de poser).
  v_legal := not exists (select 1 from hg_uno_cartes where partie = p_id and lieu = 'main' and user_id = p_user and couleur = v_avant and id <> p_carte);

  select coalesce(max(ordre), 0) + 1 into v_ordre from hg_uno_cartes where partie = p_id and lieu = 'defausse';
  update hg_uno_cartes set lieu = 'defausse', user_id = null, ordre = v_ordre where id = p_carte;
  update hg_uno_joueurs set cartes_jouees = cartes_jouees + 1, manques = 0 where partie = p_id and user_id = p_user;
  perform hg_uno__compter(p_id);
  select nb_cartes into v_reste from hg_uno_joueurs where partie = p_id and user_id = p_user;

  update hg_uno_parties set couleur = case when c.couleur = 'k' then p_couleur else c.couleur end, a_pioche = false, pioche_carte = null,
    uno_attente = case when v_reste = 1 and not (select uno from hg_uno_joueurs where partie = p_id and user_id = p_user) then p_user
                       when uno_attente = p_user then null else uno_attente end,
    uno_depuis = case when v_reste = 1 and not (select uno from hg_uno_joueurs where partie = p_id and user_id = p_user) then now() else uno_depuis end
  where id = p_id;
  if v_reste = 1 and not (select uno from hg_uno_joueurs where partie = p_id and user_id = p_user) then
    update hg_uno_joueurs set oublis_uno = oublis_uno + 1 where partie = p_id and user_id = p_user;
  end if;
  if v_reste = 0 then update hg_uno_parties set uno_attente = null where id = p_id; end if;

  v_txt := hg_uno__nom(p_id, p_user) || ' pose ' || hg_uno__carte_nom(c.couleur, c.valeur)
    || case when c.couleur = 'k' then ' et choisit le ' || hg_uno__couleur_nom(p_couleur) else '' end || '.';
  perform hg_uno__log(p_id, p_user, 'jouer', v_txt);

  -- Effets
  if c.valeur = '+2' or c.valeur = '+4' then
    v_suiv := hg_uno__suivant(p_id, p_user, 1);
    if coalesce((p.variantes->>'cumul')::boolean, false) then
      update hg_uno_parties set cumul = cumul + case when c.valeur = '+2' then 2 else 4 end where id = p_id;
      if v_reste = 0 then
        -- Dernière carte : le suivant pioche tout de suite le cumul, puis la manche s'arrête.
        perform hg_uno__piocher_n(p_id, v_suiv, (select cumul from hg_uno_parties where id = p_id));
        update hg_uno_parties set cumul = 0 where id = p_id;
      else
        perform hg_uno__donner_tour(p_id, v_suiv);
      end if;
    elsif c.valeur = '+2' then
      perform hg_uno__piocher_n(p_id, v_suiv, 2);
      perform hg_uno__log(p_id, v_suiv, 'pioche', hg_uno__nom(p_id, v_suiv) || ' pioche 2 cartes et passe son tour.');
      if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 2)); end if;
    else
      if v_reste = 0 then
        perform hg_uno__piocher_n(p_id, v_suiv, 4);
      else
        -- Joker +4 : la cible peut contester.
        update hg_uno_parties set defi = jsonb_build_object('poseur', p_user, 'cible', v_suiv, 'legal', v_legal) where id = p_id;
        perform hg_uno__donner_tour(p_id, v_suiv);
      end if;
    end if;
  elsif c.valeur = 'inv' then
    update hg_uno_parties set sens = -sens where id = p_id;
    if v_reste > 0 then
      if hg_uno__actifs(p_id) = 2 then perform hg_uno__donner_tour(p_id, p_user);
      else perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1)); end if;
    end if;
  elsif c.valeur = 'passe' then
    v_suiv := hg_uno__suivant(p_id, p_user, 1);
    perform hg_uno__log(p_id, v_suiv, 'info', hg_uno__nom(p_id, v_suiv) || ' passe son tour.');
    if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 2)); end if;
  elsif c.valeur = '7' and coalesce((p.variantes->>'sept_zero')::boolean, false) and p_cible is not null and v_reste > 0 then
    -- Sept : échange de mains avec la cible.
    update hg_uno_cartes set user_id = case when user_id = p_user then p_cible else p_user end
      where partie = p_id and lieu = 'main' and user_id in (p_user, p_cible);
    perform hg_uno__compter(p_id);
    update hg_uno_joueurs set uno = false where partie = p_id and user_id in (p_user, p_cible);
    perform hg_uno__log(p_id, p_user, 'info', hg_uno__nom(p_id, p_user) || ' échange sa main avec ' || hg_uno__nom(p_id, p_cible) || '.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
  elsif c.valeur = '0' and coalesce((p.variantes->>'sept_zero')::boolean, false) and v_reste > 0 then
    -- Zéro : toutes les mains tournent dans le sens du jeu.
    -- (sans table temporaire : Supabase refuse une suppression sans condition, ce qui bloquait la pose du 0)
    update hg_uno_cartes c2 set user_id = r2.vers
      from (select user_id as de, hg_uno__suivant(p_id, user_id, 1) as vers from hg_uno_joueurs where partie = p_id and not exclu) r2
      where c2.partie = p_id and c2.lieu = 'main' and c2.user_id = r2.de;
    perform hg_uno__compter(p_id);
    update hg_uno_joueurs set uno = false where partie = p_id;
    perform hg_uno__log(p_id, p_user, 'info', 'Toutes les mains tournent dans le sens du jeu.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
  else
    if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1)); end if;
  end if;

  -- Après un échange ou une rotation, la règle UNO s'applique aux nouvelles mains.
  if c.valeur in ('0', '7') and coalesce((p.variantes->>'sept_zero')::boolean, false) then
    update hg_uno_parties set uno_attente = null where id = p_id;
  end if;

  if v_reste = 0 then
    perform hg_uno__fin_manche(p_id, p_user);
  end if;
end $$;

revoke all on function public.hg_uno__compter(uuid) from public, anon, authenticated;
revoke all on function public.hg_uno__poser(uuid, uuid, bigint, text, uuid) from public, anon, authenticated;

-- Dire UNO : seulement quand il ne reste qu'une carte (juste après avoir posé l'avant-dernière).
create or replace function public.hg_uno_uno(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_n int; v_deja boolean;
begin
  p := hg_uno__ma_partie(p_code);
  select nb_cartes, uno into v_n, v_deja from hg_uno_joueurs where partie = p.id and user_id = auth.uid();
  if v_n > 1 then raise exception 'Pose d''abord ton avant-dernière carte, puis clique sur UNO.'; end if;
  if v_n < 1 or v_deja then return; end if;
  update hg_uno_joueurs set uno = true where partie = p.id and user_id = auth.uid();
  if p.uno_attente = auth.uid() then
    update hg_uno_parties set uno_attente = null where id = p.id;
    update hg_uno_joueurs set oublis_uno = greatest(oublis_uno - 1, 0) where partie = p.id and user_id = auth.uid();
  end if;
  perform hg_uno__log(p.id, auth.uid(), 'uno', hg_uno__nom(p.id, auth.uid()) || ' crie UNO !');
  perform hg_uno__bump(p.id);
end $$;

-- Contre-UNO : possible 3 secondes après la pose, tant que le joueur n'a pas dit UNO et que le jeu n'a pas avancé.
create or replace function public.hg_uno_contrer(p_code text, p_cible uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__ma_partie(p_code);
  if p.uno_attente is null or p.uno_attente <> p_cible or p_cible = auth.uid() then
    raise exception 'Trop tard : ce joueur ne peut plus être contré.';
  end if;
  if p.uno_depuis is not null and now() < p.uno_depuis + interval '3 seconds' then
    raise exception 'Laisse-lui 3 secondes pour dire UNO avant de le contrer.';
  end if;
  update hg_uno_parties set uno_attente = null where id = p.id;
  perform hg_uno__piocher_n(p.id, p_cible, 2);
  perform hg_uno__log(p.id, auth.uid(), 'contre', hg_uno__nom(p.id, auth.uid()) || ' contre ' || hg_uno__nom(p.id, p_cible)
    || ' qui a oublié de dire UNO : 2 cartes de pénalité.');
  perform hg_uno__bump(p.id);
end $$;

-- Règles modifiables par l'hôte dans la salle d'attente (mêmes contrôles qu'à la création).
create or replace function public.hg_uno_regles(p_code text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v hg_uno_parties; v_t int; v_nb int; v_var jsonb; v_n int;
begin
  v := hg_uno__partie(p_code, true);
  if v.hote <> auth.uid() then raise exception 'Seul l''hôte peut changer les règles.'; end if;
  if v.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  v_t := coalesce((p->>'t_tour')::int, v.t_tour);
  if v_t not in (15, 30, 60) then raise exception 'Durée d''un tour invalide.'; end if;
  select count(*) into v_n from hg_uno_joueurs where partie = v.id;
  v_nb := coalesce((p->>'nb_places')::int, v.nb_places);
  if v_nb < greatest(2, v_n) or v_nb > 20 then raise exception 'Le nombre de places doit être entre % et 20.', greatest(2, v_n); end if;
  v_var := jsonb_build_object(
    'cumul', coalesce((p->'variantes'->>'cumul')::boolean, (v.variantes->>'cumul')::boolean, false),
    'pioche_jusqu', coalesce((p->'variantes'->>'pioche_jusqu')::boolean, (v.variantes->>'pioche_jusqu')::boolean, false),
    'sept_zero', coalesce((p->'variantes'->>'sept_zero')::boolean, (v.variantes->>'sept_zero')::boolean, false),
    'interception', coalesce((p->'variantes'->>'interception')::boolean, (v.variantes->>'interception')::boolean, false));
  update hg_uno_parties set t_tour = v_t, nb_places = v_nb, variantes = v_var,
    mode = case when p ? 'mode' then (case when p->>'mode' = 'points' then 'points' else 'manche' end) else mode end,
    visibilite = case when p ? 'visibilite' then (case when p->>'visibilite' = 'publique' then 'publique' else 'privee' end) else visibilite end,
    invites = coalesce((p->>'invites')::boolean, invites)
  where id = v.id;
  update hg_uno_joueurs set pret = false where partie = v.id and user_id <> v.hote and pret;
  perform hg_uno__log(v.id, auth.uid(), 'info', 'L''hôte a modifié les règles : chacun doit confirmer qu''il est prêt.');
  perform hg_uno__bump(v.id);
end $$;
revoke all on function public.hg_uno_regles(text, jsonb) from public, anon;
grant execute on function public.hg_uno_regles(text, jsonb) to authenticated;

create or replace function public.hg_uno_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; d hg_uno_cartes; v_moi uuid := auth.uid(); v_joue boolean; v_main jsonb; v_inter boolean;
begin
  p := hg_uno__partie(p_code);
  v_joue := hg_uno_dans(p.id);
  if not v_joue and not (p.visibilite = 'publique' and p.statut = 'attente' and hg_uno_peut()) then
    raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501';
  end if;
  -- Un tour expiré est joué avant de répondre.
  if p.statut = 'en_cours' and p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_uno__essayer(p.id);
    select * into p from hg_uno_parties where id = p.id;
  end if;
  d := hg_uno__dessus(p.id);
  v_inter := coalesce((p.variantes->>'interception')::boolean, false) and p.cumul = 0 and p.defi is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'couleur', c.couleur, 'valeur', c.valeur,
      'jouable', p.statut = 'en_cours' and (
        (p.tour = v_moi and p.defi is null and (not p.a_pioche or c.id = p.pioche_carte) and hg_uno__jouable(p, c))
        or (p.tour <> v_moi and v_inter and c.couleur <> 'k' and c.couleur = d.couleur and c.valeur = d.valeur)))
      order by position(c.couleur in 'rygbk'),
        case when c.valeur ~ '^[0-9]$' then c.valeur::int else 10 + position(c.valeur in '+2 inv passe joker +4') end, c.id), '[]'::jsonb)
    into v_main from hg_uno_cartes c where c.partie = p.id and c.lieu = 'main' and c.user_id = v_moi;

  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'code', p.code, 'nom', p.nom, 'statut', p.statut, 'hote', p.hote,
      'visibilite', p.visibilite, 'invites', p.invites, 'nb_places', p.nb_places, 't_tour', p.t_tour, 'mode', p.mode,
      'variantes', p.variantes, 'manche', p.manche, 'sens', p.sens, 'couleur', p.couleur, 'cumul', p.cumul, 'tour', p.tour,
      'tour_fin', p.tour_fin, 'pioche', (select count(*) from hg_uno_cartes where partie = p.id and lieu = 'pioche'),
      'dessus', case when d.id is null then null else jsonb_build_object('id', d.id, 'couleur', d.couleur, 'valeur', d.valeur) end,
      'version', p.version, 'uno_attente', p.uno_attente, 'uno_depuis', p.uno_depuis,
      'defi', case when p.defi is null then null else jsonb_build_object('poseur', p.defi->'poseur', 'cible', p.defi->'cible') end,
      'a_pioche', p.a_pioche, 'suite', p.etat->>'suite', 'vainqueur', p.vainqueur),
    'maintenant', now(),
    'moi', jsonb_build_object('user_id', v_moi, 'hote', p.hote = v_moi,
      'invite', exists (select 1 from hg_uno_invites where user_id = v_moi), 'joue', v_joue),
    'joueurs', coalesce((select jsonb_agg(jsonb_build_object('user_id', j.user_id, 'pseudo', j.pseudo, 'couleur', j.couleur,
        'avatar_url', j.avatar_url, 'invite', j.invite, 'place', j.place, 'pret', j.pret, 'nb_cartes', j.nb_cartes, 'uno', j.uno,
        'exclu', j.exclu, 'points', j.points, 'rang', j.rang, 'gagne', j.gagne, 'paillettes', j.paillettes,
        'main_points', j.main_points) order by j.place) from hg_uno_joueurs j where j.partie = p.id), '[]'::jsonb),
    'main', v_main,
    'pioche_carte', case when p.tour = v_moi and p.a_pioche then p.pioche_carte else null end,
    'journal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'type', x.type, 'texte', x.texte,
        'created_at', x.created_at) order by x.id desc)
      from (select * from hg_uno_coups where partie = p.id order by id desc limit 15) x), '[]'::jsonb),
    'badges', case when p.statut = 'terminee' and v_moi is not null then coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name))
        from hg_user_badges ub join hg_badges b on b.code = ub.badge_code
        where ub.user_id = v_moi and b.code like 'uno\_%' and ub.awarded_at >= coalesce(p.ended_at, now()) - interval '5 seconds'), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;
