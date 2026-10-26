-- ===== Humane Gang — migration 142 : correctif des nouveaux duels (échecs : noms de variables ambigus) =====
create or replace function public.hg_duel__appliquer2(p_id uuid, p_user uuid, p_coup int, p_action text, p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; c text; o text; v_autre uuid; g text; res jsonb; ok boolean; v_texte text; ec jsonb; s text; v_de int; v_a int; pr text;
  cs text[]; n1 int; n2 int; nom text; coups_adv int; calme int;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' then raise exception 'La partie n''est pas en cours.'; end if;
  v_autre := hg_duel__autre(p_id, p_user); nom := hg_duel__nom(p_id, p_user);

  if p.jeu = 'pfc' then
    if p_action not in ('pierre', 'feuille', 'ciseaux') then raise exception 'Choisis pierre, feuille ou ciseaux.'; end if;
    if p.etat->'pfc'->'choix' ? p_user::text then raise exception 'Tu as déjà choisi pour ce lancer.'; end if;
    p.etat := jsonb_set(p.etat, '{pfc,choix}', coalesce(p.etat->'pfc'->'choix', '{}'::jsonb) || jsonb_build_object(p_user::text, p_action), true);
    update hg_duel_parties set etat = p.etat where id = p_id;
    update hg_duel_joueurs set fin = null, coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
    perform hg_duel__pfc_resoudre(p_id);
    return;
  end if;

  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  c := hg_duel__pion2(p, p_user); o := (case c when '1' then '2' else '1' end);

  if p.jeu = 'othello' then
    if p_coup is null or p_coup not between 0 and 63 or cardinality(hg_ot__retournes(p.grille, p_coup, c)) = 0 then
      raise exception 'Coup impossible : il faut encadrer au moins un pion adverse.';
    end if;
    g := hg_ot__jouer(p.grille, p_coup, c);
    v_texte := nom || ' joue en ' || chr(97 + p_coup % 8) || (8 - p_coup / 8) || ' et retourne ' || cardinality(hg_ot__retournes(p.grille, p_coup, c)) || ' pion(s).';
  elsif p.jeu = 'dames' then
    if p_action is null or p_action !~ '^chemin:\d{1,2}(,\d{1,2})+$' then raise exception 'Coup invalide.'; end if;
    cs := hg_dm__coups(p.grille, c);
    if not (substr(p_action, 8) = any (cs)) then
      if exists (select 1 from unnest(cs) x where cardinality(string_to_array(x, ',')) > 2
                 or abs(split_part(x, ',', 1)::int / 10 - split_part(x, ',', 2)::int / 10) > 1) and not (substr(p_action, 8) = any (cs)) then
        raise exception 'Coup impossible : la prise est obligatoire, et il faut prendre le plus de pièces possible.';
      end if;
      raise exception 'Coup impossible.';
    end if;
    res := hg_dm__jouer(p.grille, substr(p_action, 8), c);
    g := res->>'grille';
    calme := case when (res->>'prises')::int > 0 or (res->>'pion')::boolean then 0 else coalesce((p.etat->'dames'->>'calme')::int, 0) + 1 end;
    update hg_duel_parties set etat = jsonb_set(etat, '{dames}', jsonb_build_object('calme', calme), true) where id = p_id;
    v_texte := nom || case when (res->>'prises')::int > 0 then ' prend ' || (res->>'prises') || ' pièce' || case when (res->>'prises')::int > 1 then 's' else '' end || '.'
      else ' avance.' end;
  else -- echecs
    ec := coalesce(p.etat->'echecs', '{}'::jsonb);
    s := (case c when '1' then 'w' else 'b' end);
    if p_coup is null then raise exception 'Coup invalide.'; end if;
    v_de := p_coup / 64; v_a := p_coup % 64; pr := case when p_action in ('q', 'r', 'b', 'n') then p_action else '' end;
    if not exists (select 1 from hg_ec__coups(p.grille, s, coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1)) m
                   where m.de = v_de and m.a = v_a and (m.promo = pr or (m.promo = 'q' and pr = ''))) then
      raise exception 'Coup impossible.';
    end if;
    if pr = '' and upper(substr(p.grille, v_de + 1, 1)) = 'P' and (v_a / 8 = 0 or v_a / 8 = 7) then pr := 'q'; end if;
    g := hg_ec__appliquer(p.grille, v_de, v_a, pr, coalesce((ec->>'ep')::int, -1));
    ec := ec || hg_ec__suite(p.grille, v_de, v_a, coalesce(ec->>'roque', ''), coalesce((ec->>'demi')::int, 0));
    update hg_duel_parties set etat = jsonb_set(etat, '{echecs}', ec, true) where id = p_id;
    v_texte := nom || ' joue ' || chr(97 + v_de % 8) || (8 - v_de / 8) || '-' || chr(97 + v_a % 8) || (8 - v_a / 8)
      || case when pr <> '' then ' (promotion)' else '' end || '.';
  end if;

  update hg_duel_parties set grille = g, nb_coups = nb_coups + 1,
    dernier = jsonb_build_object('user_id', p_user, 'case', p_coup, 'action', coalesce(p_action, 'pose')) where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'coup', v_texte);
  select * into p from hg_duel_parties where id = p_id;

  -- Fin de manche ?
  if p.jeu = 'othello' then
    if cardinality(hg_ot__coups(g, o)) > 0 then perform hg_duel__donner_tour(p_id, v_autre); return; end if;
    if cardinality(hg_ot__coups(g, c)) > 0 then
      perform hg_duel__log(p_id, v_autre, 'info', hg_duel__nom(p_id, v_autre) || ' ne peut pas jouer : il passe son tour.');
      perform hg_duel__donner_tour(p_id, p_user); return;
    end if;
    n1 := char_length(g) - char_length(replace(g, c, '')); n2 := char_length(g) - char_length(replace(g, o, ''));
    perform hg_duel__log(p_id, null, 'info', 'Plus aucun coup possible : ' || n1 || ' pions contre ' || n2 || '.');
    perform hg_duel__fin_manche(p_id, case when n1 > n2 then p_user when n2 > n1 then v_autre end);
  elsif p.jeu = 'dames' then
    if cardinality(hg_dm__coups(g, o)) = 0 then perform hg_duel__fin_manche(p_id, p_user); return; end if;
    if coalesce((p.etat->'dames'->>'calme')::int, 0) >= 50 then
      perform hg_duel__log(p_id, null, 'info', '25 coups de chaque côté sans prise ni mouvement de pion : partie nulle.');
      perform hg_duel__fin_manche(p_id, null); return;
    end if;
    perform hg_duel__donner_tour(p_id, v_autre);
  else
    s := (case o when '1' then 'w' else 'b' end);
    ec := p.etat->'echecs';
    select count(*) into coups_adv from hg_ec__coups(g, s, coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1));
    if coups_adv = 0 then
      if hg_ec__attaque(g, position(case s when 'w' then 'K' else 'k' end in g) - 1, (case s when 'w' then 'b' else 'w' end)) then
        perform hg_duel__log(p_id, p_user, 'info', 'Échec et mat !');
        perform hg_duel__fin_manche(p_id, p_user);
      else
        perform hg_duel__log(p_id, null, 'info', 'Pat : partie nulle.');
        perform hg_duel__fin_manche(p_id, null);
      end if;
      return;
    end if;
    if coalesce((ec->>'demi')::int, 0) >= 100 or hg_ec__insuffisant(g) then
      perform hg_duel__log(p_id, null, 'info', case when hg_ec__insuffisant(g) then 'Matériel insuffisant pour mater : partie nulle.' else 'Règle des 50 coups : partie nulle.' end);
      perform hg_duel__fin_manche(p_id, null); return;
    end if;
    if hg_ec__attaque(g, position(case s when 'w' then 'K' else 'k' end in g) - 1, (case s when 'w' then 'b' else 'w' end)) then
      perform hg_duel__log(p_id, v_autre, 'info', 'Échec !');
    end if;
    perform hg_duel__donner_tour(p_id, v_autre);
  end if;
end $$;

