-- ===== Humane Gang — Loup-Garou (2/2) : moteur de jeu =====
-- Toute la logique est côté serveur : distribution des rôles, étapes de la nuit, votes, morts, victoires.
-- Le client n'envoie que des intentions (hg_lg_agir, hg_lg_voter) et relit son état personnalisé (hg_lg_etat).
-- Fonctions publiques (authenticated) : hg_lg_creer, hg_lg_rejoindre, hg_lg_quitter, hg_lg_pret, hg_lg_exclure,
--   hg_lg_lancer, hg_lg_vu, hg_lg_agir, hg_lg_voter, hg_lg_message, hg_lg_avancer, hg_lg_etat, hg_lg_mj,
--   hg_lg_publiques, hg_lg_mes_parties, hg_lg_stats, hg_lg_admin_reglages, hg_lg_admin_enregistrer.
-- Fonctions internes (hg_lg__*) : non exécutables par les clients.
-- Étapes : revelation → [nuit_1] → nuit → [reveil] → (aube) → debat → vote → (résultat) → nuit suivante...
--   chasseur et succession s'intercalent quand un Chasseur ou le Capitaine meurt.

/* =====================================================================
   0. Petits outils
   ===================================================================== */

create or replace function public.hg_lg__partie(p_code text, p_lock boolean default false)
returns public.hg_lg_parties language plpgsql security definer set search_path = public as $$
declare v hg_lg_parties;
begin
  -- Le même code peut avoir servi à d'anciennes parties : on prend la plus récente.
  select * into v from hg_lg_parties where code = upper(trim(p_code)) order by created_at desc limit 1;
  if found and p_lock then
    select * into v from hg_lg_parties where id = v.id for update;
  end if;
  if not found then raise exception 'Partie introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hg_lg__bump(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_lg_parties set version = version + 1 where id = p_id
$$;

create or replace function public.hg_lg__log(p_id uuid, p_type text, p_texte text, p_pour uuid default null, p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into hg_lg_journal(partie, manche, phase, type, texte, pour, data)
  select p_id, manche, phase, p_type, p_texte, p_pour, p_data from hg_lg_parties where id = p_id
$$;

-- Pseudo d'un joueur de la partie.
create or replace function public.hg_lg__nom(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from hg_lg_joueurs where partie = p_id and user_id = p_user), '?')
$$;

-- Nom affiché d'un rôle.
create or replace function public.hg_lg__role_nom(p_role text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nom from hg_lg_roles where id = p_role), p_role)
$$;

-- Le rôle fait-il partie du camp des loups « par nature » (au moment de la distribution) ?
create or replace function public.hg_lg__camp_depart(p_role text)
returns text language sql stable security definer set search_path = public as $$
  select case when p_role in ('ange', 'joueur-de-flute') then 'solo'
              else coalesce((select camp from hg_lg_roles where id = p_role), 'village') end
$$;

-- Vivant ?
create or replace function public.hg_lg__vivant(p_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select vivant from hg_lg_joueurs where partie = p_id and user_id = p_user), false)
$$;

-- Voisins vivants (gauche = place inférieure la plus proche, droite = supérieure), en cercle.
create or replace function public.hg_lg__voisins(p_id uuid, p_user uuid)
returns table(gauche uuid, droite uuid) language plpgsql stable security definer set search_path = public as $$
declare v_place int; v_n int;
begin
  select place into v_place from hg_lg_joueurs where partie = p_id and user_id = p_user;
  select max(place) into v_n from hg_lg_joueurs where partie = p_id;
  return query select
    (select j.user_id from hg_lg_joueurs j where j.partie = p_id and j.vivant and j.user_id <> p_user
      order by ((v_place - j.place + v_n) % v_n) limit 1),
    (select j.user_id from hg_lg_joueurs j where j.partie = p_id and j.vivant and j.user_id <> p_user
      order by ((j.place - v_place + v_n) % v_n) limit 1);
end $$;

-- Code de partie libre « HGLG-#### ».
create or replace function public.hg_lg__code()
returns text language plpgsql security definer set search_path = public as $$
declare v text; i int := 0;
begin
  loop
    v := 'HGLG-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from hg_lg_parties where code = v and statut in ('attente', 'revelation', 'en_cours'));
    i := i + 1;
    if i > 50 then raise exception 'Impossible de générer un code, réessaie.'; end if;
  end loop;
  return v;
end $$;

-- Durée d'une étape (secondes).
create or replace function public.hg_lg__duree(p hg_lg_parties, p_phase text)
returns int language sql immutable as $$
  select case p_phase
    when 'revelation' then 45
    when 'nuit_1' then least(p.t_nuit, 60)
    when 'nuit' then p.t_nuit
    when 'reveil' then greatest(20, least(p.t_nuit, 45))
    when 'debat' then p.t_jour
    when 'vote' then p.t_vote
    when 'chasseur' then 30
    when 'succession' then 30
    else 60 end
$$;

/* =====================================================================
   1. Qui doit agir à cette étape ?
   ===================================================================== */

-- Liste des actions attendues : (joueur, type). Une action « passer » compte comme faite.
create or replace function public.hg_lg__attendus(p_id uuid)
returns table(user_id uuid, type text) language plpgsql stable security definer set search_path = public as $$
declare p hg_lg_parties; v_perdu boolean; v_loup_mort boolean;
begin
  select * into p from hg_lg_parties where id = p_id;
  v_perdu := coalesce((p.etat->>'pouvoirs_perdus')::boolean, false);
  v_loup_mort := coalesce((p.etat->>'loup_mort')::boolean, false);
  if p.phase = 'revelation' then
    return query select j.user_id, 'vu'::text from hg_lg_joueurs j where j.partie = p_id and not j.vu_role;
  elsif p.phase = 'nuit_1' then
    return query
      select c.user_id, case c.role when 'voleur' then 'voleur' when 'cupidon' then 'cupidon'
                                    when 'chien-loup' then 'chien' when 'enfant-sauvage' then 'modele' end
      from hg_lg_cartes c join hg_lg_joueurs j on j.partie = c.partie and j.user_id = c.user_id
      where c.partie = p_id and j.vivant and c.role_initial = c.role
        and (c.role = 'cupidon' or c.role = 'chien-loup' or c.role = 'enfant-sauvage'
             or (c.role = 'voleur' and exists (select 1 from hg_lg_centre x where x.partie = p_id)));
  elsif p.phase = 'nuit' then
    return query
      select c.user_id, 'devorer'::text from hg_lg_cartes c join hg_lg_joueurs j on j.partie = c.partie and j.user_id = c.user_id
        where c.partie = p_id and j.vivant and c.camp = 'loups'
      union all
      select c.user_id, case when c.role = 'voyante' then 'sonder' when c.role = 'loup-garou-voyant' then 'sonder'
                             when c.role = 'salvateur' then 'proteger' when c.role = 'corbeau' then 'corbeau'
                             when c.role = 'joueur-de-flute' then 'envouter' when c.role = 'renard' then 'renard'
                             when c.role = 'loup-blanc' then 'loup_blanc' when c.role = 'grand-mechant-loup' then 'grand_mechant' end
        from hg_lg_cartes c join hg_lg_joueurs j on j.partie = c.partie and j.user_id = c.user_id
        where c.partie = p_id and j.vivant and (
             (c.role in ('voyante', 'salvateur', 'corbeau') and not v_perdu)
          or (c.role = 'renard' and not v_perdu and not coalesce((c.etat->>'pouvoir_perdu')::boolean, false))
          or c.role in ('loup-garou-voyant', 'joueur-de-flute')
          or (c.role = 'loup-blanc' and p.manche % 2 = 0)
          or (c.role = 'grand-mechant-loup' and not v_loup_mort));
  elsif p.phase = 'reveil' then
    return query
      select c.user_id, case c.role when 'sorciere' then 'sorciere' else 'infecter' end
        from hg_lg_cartes c join hg_lg_joueurs j on j.partie = c.partie and j.user_id = c.user_id
        where c.partie = p_id and j.vivant and (
             (c.role = 'sorciere' and not v_perdu and (coalesce((c.etat->>'vie')::boolean, true) or coalesce((c.etat->>'mort')::boolean, true)))
          or (c.role = 'infect-pere-des-loups' and not coalesce((c.etat->>'infect_utilise')::boolean, false) and (p.etat->>'victime') is not null));
  elsif p.phase = 'vote' then
    return query select j.user_id, 'vote'::text from hg_lg_joueurs j where j.partie = p_id and j.vivant and j.peut_voter;
  elsif p.phase in ('chasseur', 'succession') then
    return query select (p.etat->'file'->0->>'user')::uuid, p.phase;
  end if;
end $$;

-- Tout le monde a-t-il agi ?
create or replace function public.hg_lg__complet(p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p hg_lg_parties; v_reste int;
begin
  select * into p from hg_lg_parties where id = p_id;
  if p.phase = 'revelation' then
    return not exists (select 1 from hg_lg_joueurs where partie = p_id and not vu_role);
  elsif p.phase = 'vote' then
    return not exists (select 1 from hg_lg_joueurs j where j.partie = p_id and j.vivant and j.peut_voter
      and not exists (select 1 from hg_lg_votes v where v.partie = p_id and v.manche = p.manche and v.user_id = j.user_id));
  elsif p.phase in ('nuit_1', 'nuit', 'reveil', 'chasseur', 'succession') then
    select count(*) into v_reste from hg_lg__attendus(p_id) a
      where a.user_id is not null and not exists (select 1 from hg_lg_actions x where x.partie = p_id and x.manche = p.manche
        and x.etape = p.phase and x.user_id = a.user_id and (x.type = a.type or x.type = 'passer'));
    return v_reste = 0;
  end if;
  return false;
end $$;

/* =====================================================================
   2. Morts et victoire
   ===================================================================== */

create or replace function public.hg_lg__file_ajouter(p_id uuid, p_type text, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update hg_lg_parties set etat = jsonb_set(etat, '{file}',
    coalesce(etat->'file', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('type', p_type, 'user', p_user)))
  where id = p_id
$$;

-- Tue un joueur : rôle révélé, réactions en chaîne (amoureux, chasseur, capitaine, enfant sauvage, chevalier).
create or replace function public.hg_lg__tuer(p_id uuid, p_user uuid, p_cause text, p_texte text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j hg_lg_joueurs; c hg_lg_cartes; p hg_lg_parties; v_amour uuid; v_loup uuid; v_g uuid; v_d uuid; r record;
begin
  select * into j from hg_lg_joueurs where partie = p_id and user_id = p_user for update;
  if not found or not j.vivant then return; end if;
  select * into p from hg_lg_parties where id = p_id;
  select * into c from hg_lg_cartes where partie = p_id and user_id = p_user;
  update hg_lg_joueurs set vivant = false, role_revele = c.role, mort_manche = p.manche, mort_cause = p_cause, capitaine = false
    where partie = p_id and user_id = p_user;
  perform hg_lg__log(p_id, 'mort', coalesce(p_texte, j.pseudo || ' est mort·e.') || ' Son rôle était ' || hg_lg__role_nom(c.role) || '.',
    null, jsonb_build_object('user', p_user, 'role', c.role, 'cause', p_cause));
  if c.camp = 'loups' then
    update hg_lg_parties set etat = etat || '{"loup_mort": true}'::jsonb where id = p_id;
  end if;
  -- Chasseur : tire avant de mourir.
  if c.role = 'chasseur' and not coalesce((p.etat->>'pouvoirs_perdus')::boolean, false) then
    perform hg_lg__file_ajouter(p_id, 'chasseur', p_user);
  end if;
  -- Capitaine : désigne un successeur.
  if j.capitaine then
    perform hg_lg__file_ajouter(p_id, 'succession', p_user);
  end if;
  -- Ancien éliminé par le village : le village perd ses pouvoirs.
  if c.role = 'ancien' and p_cause in ('vote', 'chasseur') then
    update hg_lg_parties set etat = etat || '{"pouvoirs_perdus": true}'::jsonb where id = p_id;
    perform hg_lg__log(p_id, 'info', 'Le village a éliminé l''Ancien : les villageois perdent leurs pouvoirs.');
  end if;
  -- Chevalier dévoré : le premier loup à sa gauche mourra la nuit suivante.
  if c.role = 'chevalier-epee-rouillee' and p_cause = 'loups' then
    select x.user_id into v_loup from hg_lg_joueurs x join hg_lg_cartes k on k.partie = x.partie and k.user_id = x.user_id
      where x.partie = p_id and x.vivant and k.camp = 'loups'
      order by ((j.place - x.place + 100) % 100) limit 1;
    if v_loup is not null then
      update hg_lg_cartes set etat = etat || '{"blesse": true}'::jsonb where partie = p_id and user_id = v_loup;
    end if;
  end if;
  -- Enfant sauvage dont le modèle meurt : devient loup.
  for r in select k.user_id from hg_lg_cartes k join hg_lg_joueurs x on x.partie = k.partie and x.user_id = k.user_id
           where k.partie = p_id and k.role = 'enfant-sauvage' and x.vivant and (k.etat->>'modele')::uuid = p_user and k.camp <> 'loups' loop
    update hg_lg_cartes set camp = 'loups' where partie = p_id and user_id = r.user_id;
    perform hg_lg__log(p_id, 'prive', 'Ton modèle est mort : tu rejoins la meute des loups-garous.', r.user_id);
  end loop;
  -- Amoureux : meurt de chagrin.
  v_amour := (c.etat->>'amoureux')::uuid;
  if v_amour is not null and hg_lg__vivant(p_id, v_amour) then
    perform hg_lg__tuer(p_id, v_amour, 'chagrin', hg_lg__nom(p_id, v_amour) || ' meurt de chagrin.');
  end if;
end $$;

-- Camp vainqueur, ou null si la partie continue.
create or replace function public.hg_lg__victoire(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_vivants int; v_loups int; v_autres int; v_flute uuid; v_flute_ok boolean; v_lb boolean; a uuid; b uuid;
begin
  select count(*) into v_vivants from hg_lg_joueurs where partie = p_id and vivant;
  if v_vivants = 0 then return 'personne'; end if;
  -- Joueur de flûte : tous les autres survivants envoûtés.
  select c.user_id into v_flute from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id)
    where c.partie = p_id and c.role = 'joueur-de-flute' and j.vivant limit 1;
  if v_flute is not null then
    select bool_and(coalesce((c.etat->>'envoute')::boolean, false)) into v_flute_ok
      from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id) where c.partie = p_id and j.vivant and c.user_id <> v_flute;
    if coalesce(v_flute_ok, true) then return 'flute'; end if;
  end if;
  -- Loup blanc seul survivant.
  if v_vivants = 1 and exists (select 1 from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id)
                               where c.partie = p_id and c.role = 'loup-blanc' and j.vivant) then return 'loup_blanc'; end if;
  -- Amoureux de camps différents, derniers survivants.
  if v_vivants = 2 then
    select min(user_id::text)::uuid, max(user_id::text)::uuid into a, b from hg_lg_joueurs where partie = p_id and vivant;
    if exists (select 1 from hg_lg_cartes where partie = p_id and user_id = a and (etat->>'amoureux')::uuid = b) then
      if (select camp from hg_lg_cartes where partie = p_id and user_id = a) <> (select camp from hg_lg_cartes where partie = p_id and user_id = b) then
        return 'amoureux';
      end if;
    end if;
  end if;
  select count(*) filter (where c.camp = 'loups'),
         count(*) filter (where c.camp <> 'loups'),
         bool_or(c.role = 'loup-blanc')
    into v_loups, v_autres, v_lb
    from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id) where c.partie = p_id and j.vivant;
  if v_loups = 0 then
    if v_flute is null then return 'village'; end if;
    return null;   -- le joueur de flûte vit encore
  end if;
  if v_autres = 0 then
    if coalesce(v_lb, false) and v_loups > 1 then return null; end if;  -- le Loup blanc doit finir seul
    if coalesce(v_lb, false) then return 'loup_blanc'; end if;
    return 'loups';
  end if;
  return null;
end $$;

-- Fin de partie : rôles révélés, gagnants, Paillettes, badges.
create or replace function public.hg_lg__terminer(p_id uuid, p_vainqueur text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; cfg jsonb; pts jsonb; r record; v_gain int; v_jour int; v_plafond int; v_min int;
  v_mvp uuid; v_txt text; v_lynx int; v_amoureux uuid[]; v_cupidon uuid;
begin
  select * into p from hg_lg_parties where id = p_id for update;
  if p.statut = 'terminee' then return; end if;
  cfg := coalesce((select value from hg_settings where key = 'loup_garou'), '{}'::jsonb);
  pts := coalesce(cfg->'paillettes', '{}'::jsonb);
  v_plafond := coalesce((cfg->>'plafond_jour')::int, 200);
  v_min := coalesce((cfg->>'min_joueurs_paillettes')::int, 6);

  select array_agg(user_id) into v_amoureux from hg_lg_cartes where partie = p_id and etat ? 'amoureux';
  select user_id into v_cupidon from hg_lg_cartes where partie = p_id and role_initial = 'cupidon' limit 1;

  -- Gagnants
  update hg_lg_joueurs j set role_revele = c.role, gagne = case p_vainqueur
      when 'village' then c.camp = 'village'
      when 'loups' then c.camp = 'loups' and c.role <> 'loup-blanc'
      when 'loup_blanc' then c.role = 'loup-blanc'
      when 'flute' then c.role = 'joueur-de-flute'
      when 'ange' then c.role = 'ange'
      when 'amoureux' then j.user_id = any(coalesce(v_amoureux, '{}')) or j.user_id = v_cupidon
      else false end
    from hg_lg_cartes c where c.partie = j.partie and c.user_id = j.user_id and j.partie = p_id;

  v_txt := case p_vainqueur
    when 'village' then 'Le village l''emporte : tous les loups-garous ont été éliminés.'
    when 'loups' then 'Les loups-garous l''emportent : le village a été dévoré.'
    when 'loup_blanc' then 'Le Loup blanc l''emporte, seul survivant.'
    when 'flute' then 'Le Joueur de flûte l''emporte : tout le village est envoûté.'
    when 'ange' then 'L''Ange l''emporte : il a été éliminé dès les premiers jours.'
    when 'amoureux' then 'Les amoureux l''emportent, unis contre tous.'
    when 'annulee' then 'La partie a été arrêtée par le meneur.'
    else 'Personne ne survit : la partie se termine sans vainqueur.' end;

  update hg_lg_parties set statut = 'terminee', phase = 'fin', vainqueur = p_vainqueur, phase_fin = null,
    ended_at = now(), version = version + 1 where id = p_id;
  perform hg_lg__log(p_id, 'fin', v_txt, null, jsonb_build_object('vainqueur', p_vainqueur));

  -- MVP : le joueur gagnant qui a découvert le plus de loups, sinon celui qui a le plus voté contre des loups.
  select x.user_id into v_mvp from hg_lg_joueurs x where x.partie = p_id and x.gagne
    order by (select count(*) from hg_lg_journal jr where jr.partie = p_id and jr.pour = x.user_id and jr.data->>'decouvert' = 'loups') desc,
             (select count(*) from hg_lg_votes v join hg_lg_cartes k on k.partie = v.partie and k.user_id = v.cible
               where v.partie = p_id and v.user_id = x.user_id and k.camp = 'loups') desc,
             x.vivant desc, x.place limit 1;
  if v_mvp is not null then
    update hg_lg_parties set etat = etat || jsonb_build_object('mvp', v_mvp) where id = p_id;
  end if;

  if p_vainqueur = 'annulee' or p.nb_joueurs < v_min then return; end if;

  -- Paillettes (membres seulement, plafond par jour)
  for r in select x.*, k.role, k.camp from hg_lg_joueurs x join hg_lg_cartes k using (partie, user_id)
           where x.partie = p_id and not x.invite and exists (select 1 from hg_profiles pr where pr.id = x.user_id and not pr.is_ghost) loop
    select count(*) into v_lynx from hg_lg_journal jr where jr.partie = p_id and jr.pour = r.user_id and jr.data->>'decouvert' = 'loups';
    v_gain := coalesce((pts->>'participation')::int, 10)
      + case when r.gagne then coalesce((pts->>'victoire')::int, 30) else 0 end
      + case when r.vivant then coalesce((pts->>'survie')::int, 10) else 0 end
      + case when r.user_id = v_mvp then coalesce((pts->>'mvp')::int, 20) else 0 end
      + v_lynx * coalesce((pts->>'loup_decouvert')::int, 5);
    select coalesce(sum(delta), 0) into v_jour from hg_wallet_log
      where user_id = r.user_id and reason = 'loup_garou' and created_at >= date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
    v_gain := greatest(0, least(v_gain, v_plafond - v_jour));
    if v_gain > 0 and hg_wallet_add(r.user_id, v_gain, 'loup_garou', 'lg:' || p_id || ':' || r.user_id) then
      update hg_lg_joueurs set paillettes = v_gain where partie = p_id and user_id = r.user_id;
    end if;

    -- Badges
    if r.gagne then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_premiere_victoire') on conflict do nothing;
    end if;
    if v_lynx >= 3 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_oeil_de_lynx') on conflict do nothing;
    end if;
    if r.gagne and r.camp = 'loups' and p_vainqueur = 'loups'
       and not exists (select 1 from hg_lg_joueurs x2 join hg_lg_cartes k2 using (partie, user_id)
                       where x2.partie = p_id and k2.camp = 'loups' and not x2.vivant) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_meute_soudee') on conflict do nothing;
    end if;
    if r.vivant and (select count(*) from hg_lg_joueurs x3 join hg_lg_parties p3 on p3.id = x3.partie
                     where x3.user_id = r.user_id and x3.vivant and p3.statut = 'terminee' and p3.vainqueur <> 'annulee') >= 10 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_survivant') on conflict do nothing;
    end if;
    if r.camp = 'loups' and (select count(*) from hg_lg_journal jr join hg_lg_parties p4 on p4.id = jr.partie
          where jr.type = 'mort' and jr.data->>'cause' = 'loups'
            and exists (select 1 from hg_lg_cartes k4 where k4.partie = jr.partie and k4.user_id = r.user_id and k4.camp = 'loups')) >= 15 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_grand_mechant') on conflict do nothing;
    end if;
    if r.user_id = v_cupidon and v_amoureux is not null and array_length(v_amoureux, 1) = 2
       and (select count(distinct camp) from hg_lg_cartes where partie = p_id and user_id = any(v_amoureux)) = 2 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'lg_cupidon_farceur') on conflict do nothing;
    end if;
  end loop;
end $$;

/* =====================================================================
   3. Résolutions
   ===================================================================== */

-- Victime des loups : vote majoritaire de la meute (égalité : tirage au sort).
create or replace function public.hg_lg__victime(p_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.cible from hg_lg_actions a join hg_lg_parties p on p.id = a.partie
    where a.partie = p_id and a.manche = p.manche and a.etape = 'nuit' and a.type = 'devorer' and a.cible is not null
      and hg_lg__vivant(p_id, a.cible)
    group by a.cible order by count(*) desc, random() limit 1
$$;

create or replace function public.hg_lg__resoudre_nuit(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_victime uuid; v_protege uuid; v_sauve boolean := false; v_infecte boolean := false;
  v_poison uuid; v_extra uuid; v_blanc uuid; c hg_lg_cartes; r record; v_morts uuid[] := '{}'; v_n int; v_g uuid; v_d uuid;
begin
  select * into p from hg_lg_parties where id = p_id;
  v_victime := (p.etat->>'victime')::uuid;
  select cible into v_protege from hg_lg_actions where partie = p_id and manche = p.manche and type = 'proteger' limit 1;
  select (choix = 'vie'), cible into v_sauve, v_poison from hg_lg_actions where partie = p_id and manche = p.manche and type = 'sorciere' limit 1;
  v_sauve := coalesce(v_sauve, false);
  select true into v_infecte from hg_lg_actions where partie = p_id and manche = p.manche and type = 'infecter' and choix = 'oui' limit 1;
  v_infecte := coalesce(v_infecte, false);
  select cible into v_extra from hg_lg_actions where partie = p_id and manche = p.manche and type = 'grand_mechant' and cible is not null limit 1;
  select cible into v_blanc from hg_lg_actions where partie = p_id and manche = p.manche and type = 'loup_blanc' and cible is not null limit 1;

  if v_sauve then
    update hg_lg_cartes set etat = etat || '{"vie": false}'::jsonb where partie = p_id and role = 'sorciere';
  end if;
  if v_poison is not null then
    update hg_lg_cartes set etat = etat || '{"mort": false}'::jsonb where partie = p_id and role = 'sorciere';
  end if;

  -- Victime des loups
  if v_victime is not null and not v_sauve and v_victime is distinct from v_protege then
    select * into c from hg_lg_cartes where partie = p_id and user_id = v_victime;
    if v_infecte then
      update hg_lg_cartes set camp = 'loups', etat = etat || '{"infecte": true}'::jsonb where partie = p_id and user_id = v_victime;
      update hg_lg_cartes set etat = etat || '{"infect_utilise": true}'::jsonb where partie = p_id and role = 'infect-pere-des-loups';
      perform hg_lg__log(p_id, 'prive', 'Les loups t''ont infecté·e : tu fais désormais partie de la meute.', v_victime);
    elsif c.role = 'ancien' and coalesce((c.etat->>'vies')::int, 1) > 0 then
      update hg_lg_cartes set etat = etat || '{"vies": 0}'::jsonb where partie = p_id and user_id = v_victime;
      perform hg_lg__log(p_id, 'prive', 'Les loups t''ont attaqué·e, mais tu as résisté. La prochaine fois sera fatale.', v_victime);
    else
      v_morts := v_morts || v_victime;
    end if;
  end if;
  if v_extra is not null and v_extra is distinct from v_protege and not (v_extra = any(v_morts)) then v_morts := v_morts || v_extra; end if;
  if v_blanc is not null and not (v_blanc = any(v_morts)) then v_morts := v_morts || v_blanc; end if;
  if v_poison is not null and not (v_poison = any(v_morts)) then v_morts := v_morts || v_poison; end if;
  -- Blessure du Chevalier
  for r in select user_id from hg_lg_cartes where partie = p_id and coalesce((etat->>'blesse')::boolean, false) loop
    if hg_lg__vivant(p_id, r.user_id) and not (r.user_id = any(v_morts)) then v_morts := v_morts || r.user_id; end if;
    update hg_lg_cartes set etat = etat - 'blesse' where partie = p_id and user_id = r.user_id;
  end loop;

  update hg_lg_parties set etat = etat - 'victime', phase = 'aube' where id = p_id;

  v_n := coalesce(array_length(v_morts, 1), 0);
  if v_n = 0 then
    perform hg_lg__log(p_id, 'info', 'Le village se réveille : personne n''est mort cette nuit.');
  else
    foreach v_victime in array v_morts loop
      perform hg_lg__tuer(p_id, v_victime,
        case when v_victime = v_poison then 'poison' when v_victime = v_blanc then 'loup_blanc' else 'loups' end,
        'Ce matin, ' || hg_lg__nom(p_id, v_victime) || ' a été retrouvé·e mort·e.');
    end loop;
  end if;

  -- Envoûtements du joueur de flûte (annoncés aux victimes)
  for r in select cible, cible2 from hg_lg_actions where partie = p_id and manche = p.manche and type = 'envouter' loop
    update hg_lg_cartes set etat = etat || '{"envoute": true}'::jsonb where partie = p_id and user_id in (r.cible, r.cible2);
    if r.cible is not null then perform hg_lg__log(p_id, 'prive', 'Le Joueur de flûte t''a envoûté·e.', r.cible); end if;
    if r.cible2 is not null then perform hg_lg__log(p_id, 'prive', 'Le Joueur de flûte t''a envoûté·e.', r.cible2); end if;
  end loop;
  -- Corbeau : +2 voix demain
  update hg_lg_parties set etat = etat - 'corbeau' where id = p_id;
  for r in select cible from hg_lg_actions where partie = p_id and manche = p.manche and type = 'corbeau' and cible is not null loop
    update hg_lg_parties set etat = etat || jsonb_build_object('corbeau', r.cible) where id = p_id;
    perform hg_lg__log(p_id, 'info', 'Le Corbeau a désigné ' || hg_lg__nom(p_id, r.cible) || ' : 2 voix contre lui ou elle au vote.');
  end loop;
  -- Montreur d'ours
  for r in select c.user_id from hg_lg_cartes c join hg_lg_joueurs j using (partie, user_id)
           where c.partie = p_id and c.role = 'montreur-ours' and j.vivant loop
    select gauche, droite into v_g, v_d from hg_lg__voisins(p_id, r.user_id);
    if exists (select 1 from hg_lg_cartes where partie = p_id and user_id in (v_g, v_d) and camp = 'loups') then
      perform hg_lg__log(p_id, 'info', 'L''ours du Montreur grogne : un loup se cache à côté de lui.');
    else
      perform hg_lg__log(p_id, 'info', 'L''ours du Montreur reste calme.');
    end if;
  end loop;
end $$;

create or replace function public.hg_lg__resoudre_vote(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_max numeric; v_top uuid[]; v_elu uuid; v_bouc uuid; c hg_lg_cartes; r record;
begin
  select * into p from hg_lg_parties where id = p_id;
  with poids as (
    select v.cible, sum(case when j.capitaine then 2 else 1 end) as n
      from hg_lg_votes v join hg_lg_joueurs j on j.partie = v.partie and j.user_id = v.user_id
      where v.partie = p_id and v.manche = p.manche and j.vivant and j.peut_voter and hg_lg__vivant(p_id, v.cible)
      group by v.cible
    union all
    select (p.etat->>'corbeau')::uuid, 2 where p.etat ? 'corbeau' and hg_lg__vivant(p_id, (p.etat->>'corbeau')::uuid)
  ), tot as (select cible, sum(n) n from poids group by cible)
  select max(n) into v_max from tot;
  if v_max is null then
    perform hg_lg__log(p_id, 'vote', 'Personne n''a voté : aucun joueur n''est éliminé.');
    return;
  end if;
  with poids as (
    select v.cible, sum(case when j.capitaine then 2 else 1 end) as n
      from hg_lg_votes v join hg_lg_joueurs j on j.partie = v.partie and j.user_id = v.user_id
      where v.partie = p_id and v.manche = p.manche and j.vivant and j.peut_voter and hg_lg__vivant(p_id, v.cible)
      group by v.cible
    union all
    select (p.etat->>'corbeau')::uuid, 2 where p.etat ? 'corbeau' and hg_lg__vivant(p_id, (p.etat->>'corbeau')::uuid)
  ), tot as (select cible, sum(n) n from poids group by cible)
  select array_agg(cible) into v_top from tot where n = v_max;

  if array_length(v_top, 1) > 1 then
    select c2.user_id into v_bouc from hg_lg_cartes c2 join hg_lg_joueurs j using (partie, user_id)
      where c2.partie = p_id and c2.role = 'bouc-emissaire' and j.vivant limit 1;
    if v_bouc is null then
      perform hg_lg__log(p_id, 'vote', 'Égalité au vote : personne n''est éliminé.');
      return;
    end if;
    perform hg_lg__tuer(p_id, v_bouc, 'vote', 'Égalité : le Bouc émissaire, ' || hg_lg__nom(p_id, v_bouc) || ', est éliminé à la place des autres.');
    return;
  end if;

  v_elu := v_top[1];
  select * into c from hg_lg_cartes where partie = p_id and user_id = v_elu;
  if c.role = 'idiot-du-village' and coalesce((p.etat->>'pouvoirs_perdus')::boolean, false) = false
     and not coalesce((c.etat->>'revele')::boolean, false) then
    update hg_lg_cartes set etat = etat || '{"revele": true}'::jsonb where partie = p_id and user_id = v_elu;
    update hg_lg_joueurs set peut_voter = false, role_revele = 'idiot-du-village' where partie = p_id and user_id = v_elu;
    perform hg_lg__log(p_id, 'vote', hg_lg__nom(p_id, v_elu) || ' est désigné·e, mais c''est l''Idiot du village : il reste en vie et ne vote plus.');
    return;
  end if;
  if c.role = 'ange' and p.manche <= 2 then
    perform hg_lg__tuer(p_id, v_elu, 'vote', 'Le village a éliminé ' || hg_lg__nom(p_id, v_elu) || '.');
    update hg_lg_parties set etat = etat || '{"ange_gagne": true}'::jsonb where id = p_id;
    return;
  end if;
  perform hg_lg__tuer(p_id, v_elu, 'vote', 'Le village a éliminé ' || hg_lg__nom(p_id, v_elu) || ' (' || v_max || ' voix).');
end $$;

/* =====================================================================
   4. Machine à étapes
   ===================================================================== */

create or replace function public.hg_lg__ouvrir(p_id uuid, p_phase text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_victime uuid;
begin
  select * into p from hg_lg_parties where id = p_id;
  if p_phase = 'reveil' then
    v_victime := hg_lg__victime(p_id);
    update hg_lg_parties set etat = case when v_victime is null then etat - 'victime' else etat || jsonb_build_object('victime', v_victime) end where id = p_id;
  end if;
  update hg_lg_parties set phase = p_phase, pause_reste = null,
    phase_fin = now() + make_interval(secs => hg_lg__duree(p, p_phase)), version = version + 1 where id = p_id;
  perform hg_lg__log(p_id, 'phase', case p_phase
    when 'nuit_1' then 'La première nuit tombe sur le village.'
    when 'nuit' then 'La nuit ' || p.manche || ' tombe sur le village.'
    when 'reveil' then 'La Sorcière se réveille.'
    when 'debat' then 'Jour ' || p.manche || ' : le débat commence.'
    when 'vote' then 'Jour ' || p.manche || ' : place au vote.'
    when 'chasseur' then 'Le Chasseur doit tirer avant de mourir.'
    when 'succession' then 'Le Capitaine désigne son successeur.'
    else p_phase end);
end $$;

-- Après une résolution : réactions en attente, victoire, ou étape principale suivante.
create or replace function public.hg_lg__continuer(p_id uuid, p_apres text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_win text; v_item jsonb;
begin
  select * into p from hg_lg_parties where id = p_id;
  if coalesce((p.etat->>'ange_gagne')::boolean, false) then perform hg_lg__terminer(p_id, 'ange'); return; end if;
  -- Réactions en file (chasseur, succession) dont le joueur concerné existe
  if jsonb_array_length(coalesce(p.etat->'file', '[]'::jsonb)) > 0 then
    v_item := p.etat->'file'->0;
    update hg_lg_parties set etat = etat || jsonb_build_object('apres', p_apres) where id = p_id;
    perform hg_lg__ouvrir(p_id, v_item->>'type');
    return;
  end if;
  v_win := hg_lg__victoire(p_id);
  if v_win is not null then perform hg_lg__terminer(p_id, v_win); return; end if;
  -- L'Ange devient simple villageois après le 2e jour
  if p.manche >= 2 then
    update hg_lg_cartes set camp = 'village' where partie = p_id and role = 'ange' and camp = 'solo' and p_apres = 'nuit';
  end if;
  if p_apres = 'jour' then
    perform hg_lg__ouvrir(p_id, 'debat');
  else
    update hg_lg_parties set manche = manche + 1 where id = p_id;
    perform hg_lg__nuit_suivante(p_id, null);
  end if;
end $$;

-- Ouvre la prochaine étape de nuit qui a des acteurs (après p_depuis), ou résout la nuit.
create or replace function public.hg_lg__nuit_suivante(p_id uuid, p_depuis text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_etapes text[] := array['nuit_1', 'nuit', 'reveil']; v_i int; v_e text;
begin
  select * into p from hg_lg_parties where id = p_id;
  v_i := coalesce(array_position(v_etapes, p_depuis), 0) + 1;
  while v_i <= 3 loop
    v_e := v_etapes[v_i];
    if not (v_e = 'nuit_1' and p.manche <> 1) then
      update hg_lg_parties set phase = v_e where id = p_id;
      if v_e = 'reveil' then
        update hg_lg_parties set etat = case when hg_lg__victime(p_id) is null then etat - 'victime'
          else etat || jsonb_build_object('victime', hg_lg__victime(p_id)) end where id = p_id;
      end if;
      if exists (select 1 from hg_lg__attendus(p_id) a where a.user_id is not null) or v_e = 'nuit' then
        perform hg_lg__ouvrir(p_id, v_e);
        return;
      end if;
    end if;
    v_i := v_i + 1;
  end loop;
  -- Fin de la nuit
  perform hg_lg__resoudre_nuit(p_id);
  perform hg_lg__continuer(p_id, 'jour');
end $$;

-- Fait avancer la partie d'une étape. Appelée quand le temps est écoulé, quand tout le monde a agi, ou par le meneur.
create or replace function public.hg_lg__avancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_item jsonb; v_cible uuid; v_user uuid; v_succ uuid;
begin
  select * into p from hg_lg_parties where id = p_id for update;
  if p.statut not in ('revelation', 'en_cours') then return; end if;
  if p.phase = 'revelation' then
    update hg_lg_parties set statut = 'en_cours', manche = 1, started_at = coalesce(started_at, now()) where id = p_id;
    perform hg_lg__nuit_suivante(p_id, null);
  elsif p.phase in ('nuit_1', 'nuit', 'reveil') then
    perform hg_lg__nuit_suivante(p_id, p.phase);
  elsif p.phase = 'debat' then
    perform hg_lg__ouvrir(p_id, 'vote');
  elsif p.phase = 'vote' then
    perform hg_lg__resoudre_vote(p_id);
    perform hg_lg__continuer(p_id, 'nuit');
  elsif p.phase in ('chasseur', 'succession') then
    v_item := p.etat->'file'->0;
    v_user := (v_item->>'user')::uuid;
    select cible into v_cible from hg_lg_actions where partie = p_id and manche = p.manche and etape = p.phase and user_id = v_user and type = p.phase limit 1;
    update hg_lg_parties set etat = jsonb_set(etat, '{file}', coalesce((etat->'file') - 0, '[]'::jsonb)) where id = p_id;
    -- l'action est consommée : on la renomme pour qu'un second chasseur de la même manche puisse agir
    delete from hg_lg_actions where partie = p_id and manche = p.manche and etape = p.phase and user_id = v_user;
    if p.phase = 'chasseur' then
      if v_cible is not null and hg_lg__vivant(p_id, v_cible) then
        perform hg_lg__tuer(p_id, v_cible, 'chasseur', 'Le Chasseur, ' || hg_lg__nom(p_id, v_user) || ', abat ' || hg_lg__nom(p_id, v_cible) || '.');
      else
        perform hg_lg__log(p_id, 'info', 'Le Chasseur n''a pas tiré.');
      end if;
    else
      v_succ := v_cible;
      if v_succ is null or not hg_lg__vivant(p_id, v_succ) then
        select user_id into v_succ from hg_lg_joueurs where partie = p_id and vivant order by random() limit 1;
      end if;
      if v_succ is not null then
        update hg_lg_joueurs set capitaine = true where partie = p_id and user_id = v_succ;
        perform hg_lg__log(p_id, 'info', hg_lg__nom(p_id, v_succ) || ' devient Capitaine (sa voix compte double).');
      end if;
    end if;
    perform hg_lg__continuer(p_id, coalesce((select etat->>'apres' from hg_lg_parties where id = p_id), 'jour'));
  end if;
  perform hg_lg__bump(p_id);
end $$;

-- Avance si l'étape est terminée (temps écoulé ou tout le monde a agi). Renvoie true si la partie a changé.
create or replace function public.hg_lg__essayer(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_tours int := 0;
begin
  loop
    select * into p from hg_lg_parties where id = p_id;
    exit when p.statut not in ('revelation', 'en_cours') or p.phase_fin is null;
    exit when not (now() >= p.phase_fin or (p.phase <> 'debat' and hg_lg__complet(p_id)));
    perform hg_lg__avancer(p_id);
    v_tours := v_tours + 1;
    exit when v_tours >= 6;
  end loop;
  return v_tours > 0;
end $$;

-- Appelée chaque minute par pg_cron : débloque les parties dont le temps est écoulé.
create or replace function public.hg_lg_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from hg_lg_parties where statut in ('revelation', 'en_cours') and phase_fin is not null and phase_fin < now() loop
    if hg_lg__essayer(r.id) then n := n + 1; end if;
  end loop;
  -- Salles d'attente abandonnées depuis 6 heures : annulées.
  update hg_lg_parties set statut = 'annulee', version = version + 1 where statut = 'attente' and created_at < now() - interval '6 hours';
  return n;
end $$;

/* =====================================================================
   5. Fonctions publiques
   ===================================================================== */

-- Identité du joueur : profil du gang, sinon pseudo d'invité.
create or replace function public.hg_lg__identite(p_pseudo text)
returns table(pseudo text, couleur text, avatar_url text, invite boolean) language plpgsql stable security definer set search_path = public as $$
declare pr hg_profiles;
begin
  select * into pr from hg_profiles where id = auth.uid() and not is_ghost;
  if found then return query select pr.pseudo, pr.color, pr.avatar_url, false; return; end if;
  if p_pseudo is null or char_length(trim(p_pseudo)) not between 2 and 24 then
    raise exception 'Choisis un pseudo de 2 à 24 caractères.';
  end if;
  return query select trim(p_pseudo), null::text, null::text, true;
end $$;

create or replace function public.hg_lg_creer(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_nb int; v_total int := 0; v_loups int := 0; v_voleur int := 0; k text; n int; r hg_lg_roles;
  v_mode text; i record;
begin
  if not hg_lg_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  v_mode := coalesce(p->>'mode', 'auto');
  v_nb := (p->>'nb_joueurs')::int;
  if v_nb is null or v_nb < 4 or v_nb > 50 then raise exception 'Le nombre de joueurs doit être entre 4 et 50.'; end if;
  if jsonb_typeof(p->'composition') <> 'object' then raise exception 'Composition manquante.'; end if;
  for k, n in select key, value::int from jsonb_each_text(p->'composition') loop
    if n < 0 or n > 50 then raise exception 'Nombre invalide pour %.', k; end if;
    if n = 0 then continue; end if;
    select * into r from hg_lg_roles where id = k;
    if not found then raise exception 'Rôle inconnu : %.', k; end if;
    if not r.actif then raise exception 'Le rôle % n''est pas encore disponible.', r.nom; end if;
    if r.mj_seul and v_mode <> 'mj' then raise exception 'Le rôle % demande un meneur humain.', r.nom; end if;
    if k in ('voleur', 'cupidon', 'chien-loup', 'enfant-sauvage', 'salvateur', 'sorciere', 'voyante', 'corbeau', 'joueur-de-flute',
             'loup-blanc', 'grand-mechant-loup', 'infect-pere-des-loups', 'renard', 'ancien', 'bouc-emissaire', 'idiot-du-village',
             'capitaine', 'chasseur', 'petite-fille', 'ange', 'montreur-ours', 'chevalier-epee-rouillee', 'loup-garou-voyant') and n > 1 then
      raise exception 'Le rôle % ne peut être présent qu''une fois.', r.nom;
    end if;
    if k = 'deux-soeurs' and n not in (0, 2) then raise exception 'Les Deux sœurs vont par deux.'; end if;
    if k = 'trois-freres' and n not in (0, 3) then raise exception 'Les Trois frères vont par trois.'; end if;
    v_total := v_total + n;
    if r.camp = 'loups' then v_loups := v_loups + n; end if;
    if k = 'voleur' then v_voleur := n; end if;
  end loop;
  if v_loups = 0 then raise exception 'Il faut au moins un loup-garou.'; end if;
  if v_total <> v_nb + 2 * v_voleur then
    raise exception 'La composition compte % cartes, il en faut % (joueurs%).', v_total, v_nb + 2 * v_voleur,
      case when v_voleur > 0 then ' + 2 cartes au centre pour le Voleur' else '' end;
  end if;
  v_code := hg_lg__code();
  insert into hg_lg_parties(code, nom, hote, mode, visibilite, nb_joueurs, invites, t_nuit, t_jour, t_vote, annonce_discord, composition)
  values (v_code, left(coalesce(nullif(trim(p->>'nom'), ''), 'Partie de loups'), 60), auth.uid(), v_mode,
          coalesce(p->>'visibilite', 'privee'), v_nb, coalesce((p->>'invites')::boolean, true),
          coalesce((p->>'t_nuit')::int, 90), coalesce((p->>'t_jour')::int, 180), coalesce((p->>'t_vote')::int, 60),
          coalesce((p->>'annonce_discord')::boolean, false),
          (select coalesce(jsonb_object_agg(key, value::int), '{}'::jsonb) from jsonb_each_text(p->'composition') where value::int > 0))
  returning id into v_id;
  if v_mode = 'auto' then
    for i in select * from hg_lg__identite(p->>'pseudo') loop
      insert into hg_lg_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite) values (v_id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite);
    end loop;
  end if;
  perform hg_lg__log(v_id, 'info', 'Partie créée.');
  return v_code;
end $$;

create or replace function public.hg_lg_rejoindre(p_code text, p_pseudo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; i record; v_n int;
begin
  if not hg_lg_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  p := hg_lg__partie(p_code, true);
  if exists (select 1 from hg_lg_joueurs where partie = p.id and user_id = auth.uid()) or (p.mode = 'mj' and p.hote = auth.uid()) then
    return p.code;
  end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  select count(*) into v_n from hg_lg_joueurs where partie = p.id;
  if v_n >= p.nb_joueurs then raise exception 'La partie est complète (% joueurs).', p.nb_joueurs; end if;
  for i in select * from hg_lg__identite(p_pseudo) loop
    if i.invite and not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if exists (select 1 from hg_lg_joueurs where partie = p.id and lower(pseudo) = lower(i.pseudo)) then
      raise exception 'Le pseudo « % » est déjà pris dans cette partie.', i.pseudo;
    end if;
    insert into hg_lg_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite) values (p.id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite);
    perform hg_lg__log(p.id, 'info', i.pseudo || ' a rejoint la partie.');
  end loop;
  perform hg_lg__bump(p.id);
  return p.code;
end $$;

create or replace function public.hg_lg_quitter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_pseudo text;
begin
  p := hg_lg__partie(p_code, true);
  if p.statut <> 'attente' then raise exception 'On ne peut plus quitter une partie commencée.'; end if;
  if p.hote = auth.uid() then
    update hg_lg_parties set statut = 'annulee', version = version + 1 where id = p.id;
    return;
  end if;
  delete from hg_lg_joueurs where partie = p.id and user_id = auth.uid() returning pseudo into v_pseudo;
  if v_pseudo is not null then perform hg_lg__log(p.id, 'info', v_pseudo || ' a quitté la partie.'); end if;
  perform hg_lg__bump(p.id);
end $$;

create or replace function public.hg_lg_pret(p_code text, p_pret boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties;
begin
  p := hg_lg__partie(p_code);
  if p.statut <> 'attente' then return; end if;
  update hg_lg_joueurs set pret = p_pret where partie = p.id and user_id = auth.uid();
  perform hg_lg__bump(p.id);
end $$;

create or replace function public.hg_lg_exclure(p_code text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_pseudo text;
begin
  p := hg_lg__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut retirer un joueur.' using errcode = '42501'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if p_user = auth.uid() then raise exception 'Tu ne peux pas te retirer toi-même.'; end if;
  delete from hg_lg_joueurs where partie = p.id and user_id = p_user returning pseudo into v_pseudo;
  if v_pseudo is not null then perform hg_lg__log(p.id, 'info', v_pseudo || ' a été retiré·e de la partie.'); end if;
  perform hg_lg__bump(p.id);
end $$;

-- Lancement : distribution secrète des rôles, places autour du feu, Voleur (2 cartes au centre), révélation.
create or replace function public.hg_lg_lancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; v_n int; v_cartes text[] := '{}'; k text; n int; v_i int := 0; r record; v_place int := 0;
  v_cap uuid;
begin
  p := hg_lg__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut lancer la partie.' using errcode = '42501'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà été lancée.'; end if;
  select count(*) into v_n from hg_lg_joueurs where partie = p.id;
  if v_n <> p.nb_joueurs then raise exception 'Il faut % joueurs (% présents).', p.nb_joueurs, v_n; end if;
  if exists (select 1 from hg_lg_joueurs where partie = p.id and not pret and not (p.mode = 'auto' and user_id = p.hote)) then
    raise exception 'Tout le monde n''est pas prêt.';
  end if;
  for k, n in select key, value::int from jsonb_each_text(p.composition) loop
    for v_i in 1..n loop v_cartes := v_cartes || k; end loop;
  end loop;
  select array_agg(x order by random()) into v_cartes from unnest(v_cartes) x;
  -- Voleur : si les deux cartes du centre seraient deux loups, il doit en prendre une (règle) : rien à corriger ici.
  v_i := 0;
  for r in select user_id from hg_lg_joueurs where partie = p.id order by random() loop
    v_i := v_i + 1;
    insert into hg_lg_cartes(partie, user_id, role, role_initial, camp, etat)
    values (p.id, r.user_id, v_cartes[v_i], v_cartes[v_i], hg_lg__camp_depart(v_cartes[v_i]),
            case v_cartes[v_i] when 'sorciere' then '{"vie": true, "mort": true}'::jsonb when 'ancien' then '{"vies": 1}'::jsonb else '{}'::jsonb end);
    update hg_lg_joueurs set place = v_i, vu_role = false, pret = true where partie = p.id and user_id = r.user_id;
  end loop;
  if array_length(v_cartes, 1) > v_n then
    insert into hg_lg_centre(partie, idx, role) values (p.id, 0, v_cartes[v_n + 1]), (p.id, 1, v_cartes[v_n + 2]);
  end if;
  -- Capitaine : le porteur de la carte est Capitaine dès le départ (annoncé).
  select user_id into v_cap from hg_lg_cartes where partie = p.id and role = 'capitaine';
  if v_cap is not null then update hg_lg_joueurs set capitaine = true where partie = p.id and user_id = v_cap; end if;
  update hg_lg_parties set statut = 'revelation', started_at = now() where id = p.id;
  perform hg_lg__log(p.id, 'info', 'Les rôles sont distribués. Chacun découvre le sien en secret.');
  if v_cap is not null then perform hg_lg__log(p.id, 'info', hg_lg__nom(p.id, v_cap) || ' est le Capitaine : sa voix compte double.'); end if;
  perform hg_lg__ouvrir(p.id, 'revelation');
end $$;

create or replace function public.hg_lg_vu(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties;
begin
  p := hg_lg__partie(p_code);
  update hg_lg_joueurs set vu_role = true where partie = p.id and user_id = auth.uid();
  perform hg_lg__bump(p.id);
  perform hg_lg__essayer(p.id);
end $$;

-- Action de nuit (ou réaction : chasseur, succession). Les résultats immédiats (Voyante, Renard) arrivent dans le journal privé.
create or replace function public.hg_lg_agir(p_code text, p_type text, p_cible uuid default null, p_cible2 uuid default null, p_choix text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; c hg_lg_cartes; j hg_lg_joueurs; v_ok boolean; v_last uuid; v_role text; v_camp text; v_g uuid; v_d uuid;
  v_centre hg_lg_centre; v_c2 text;
begin
  p := hg_lg__partie(p_code, true);
  if p.statut not in ('en_cours') then raise exception 'Ce n''est pas le moment d''agir.'; end if;
  select * into j from hg_lg_joueurs where partie = p.id and user_id = auth.uid();
  if not found then raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501'; end if;
  select * into c from hg_lg_cartes where partie = p.id and user_id = auth.uid();
  select exists (select 1 from hg_lg__attendus(p.id) a where a.user_id = auth.uid() and (a.type = p_type or p_type = 'passer')) into v_ok;
  if not v_ok then raise exception 'Tu n''as pas d''action à faire maintenant.'; end if;
  if p_type in ('sonder', 'renard') and exists (select 1 from hg_lg_actions where partie = p.id and manche = p.manche and etape = p.phase
       and user_id = auth.uid() and type = p_type) then
    raise exception 'Tu as déjà utilisé ton pouvoir cette nuit.';
  end if;
  -- Contrôle des cibles
  if p_cible is not null and not hg_lg__vivant(p.id, p_cible) then raise exception 'Cette cible n''est plus en vie.'; end if;
  if p_cible2 is not null and not hg_lg__vivant(p.id, p_cible2) then raise exception 'Cette cible n''est plus en vie.'; end if;
  if p_type in ('devorer', 'sonder', 'proteger', 'renard', 'loup_blanc', 'grand_mechant', 'chasseur', 'succession', 'modele') and p_cible is null then
    raise exception 'Choisis un joueur.';
  end if;
  if p_type in ('sonder', 'modele', 'chasseur', 'succession', 'renard') and p_cible = auth.uid() then raise exception 'Choisis un autre joueur que toi.'; end if;
  if p_type = 'devorer' and exists (select 1 from hg_lg_cartes where partie = p.id and user_id = p_cible and camp = 'loups') then
    raise exception 'La meute ne peut pas dévorer un loup.';
  end if;
  if p_type = 'loup_blanc' and not exists (select 1 from hg_lg_cartes where partie = p.id and user_id = p_cible and camp = 'loups' and user_id <> auth.uid()) then
    raise exception 'Le Loup blanc ne peut dévorer qu''un autre loup.';
  end if;
  if p_type = 'proteger' then
    v_last := (c.etat->>'dernier_protege')::uuid;
    if p_cible = v_last then raise exception 'Tu ne peux pas protéger deux nuits de suite la même personne.'; end if;
    update hg_lg_cartes set etat = etat || jsonb_build_object('dernier_protege', p_cible) where partie = p.id and user_id = auth.uid();
  end if;
  if p_type = 'cupidon' then
    if p_cible is null or p_cible2 is null or p_cible = p_cible2 then raise exception 'Choisis deux joueurs différents.'; end if;
    update hg_lg_cartes set etat = etat || jsonb_build_object('amoureux', p_cible2) where partie = p.id and user_id = p_cible;
    update hg_lg_cartes set etat = etat || jsonb_build_object('amoureux', p_cible) where partie = p.id and user_id = p_cible2;
    perform hg_lg__log(p.id, 'prive', 'Cupidon t''a lié·e à ' || hg_lg__nom(p.id, p_cible2) || '. Si l''un meurt, l''autre aussi.', p_cible);
    perform hg_lg__log(p.id, 'prive', 'Cupidon t''a lié·e à ' || hg_lg__nom(p.id, p_cible) || '. Si l''un meurt, l''autre aussi.', p_cible2);
  end if;
  if p_type = 'envouter' and (p_cible is null or p_cible2 is null or p_cible = p_cible2 or auth.uid() in (p_cible, p_cible2)) then
    raise exception 'Choisis deux autres joueurs différents.';
  end if;
  if p_type = 'sorciere' then
    if p_choix = 'vie' and not coalesce((c.etat->>'vie')::boolean, false) then raise exception 'Ta potion de vie est déjà utilisée.'; end if;
    if p_choix = 'vie' and (p.etat->>'victime') is null then raise exception 'Personne n''a été attaqué cette nuit.'; end if;
    if p_cible is not null and not coalesce((c.etat->>'mort')::boolean, false) then raise exception 'Ta potion de mort est déjà utilisée.'; end if;
  end if;
  if p_type = 'voleur' then
    if p_choix not in ('0', '1', 'garder') then raise exception 'Choix invalide.'; end if;
    if p_choix = 'garder' and (select bool_and(hg_lg__camp_depart(role) = 'loups') from hg_lg_centre where partie = p.id) then
      raise exception 'Les deux cartes sont des loups : tu dois en prendre une.';
    end if;
    if p_choix in ('0', '1') then
      select * into v_centre from hg_lg_centre where partie = p.id and idx = p_choix::int;
      update hg_lg_centre set role = c.role where partie = p.id and idx = p_choix::int;
      update hg_lg_cartes set role = v_centre.role, camp = hg_lg__camp_depart(v_centre.role),
        etat = case v_centre.role when 'sorciere' then '{"vie": true, "mort": true}'::jsonb when 'ancien' then '{"vies": 1}'::jsonb else '{}'::jsonb end
        where partie = p.id and user_id = auth.uid();
      perform hg_lg__log(p.id, 'prive', 'Tu as pris la carte ' || hg_lg__role_nom(v_centre.role) || '. C''est ton nouveau rôle.', auth.uid());
      if v_centre.role = 'capitaine' then update hg_lg_joueurs set capitaine = true where partie = p.id and user_id = auth.uid(); end if;
    end if;
  end if;
  if p_type = 'chien' then
    if p_choix not in ('village', 'loups') then raise exception 'Choisis ton camp.'; end if;
    update hg_lg_cartes set camp = p_choix where partie = p.id and user_id = auth.uid();
  end if;
  if p_type = 'modele' then
    update hg_lg_cartes set etat = etat || jsonb_build_object('modele', p_cible) where partie = p.id and user_id = auth.uid();
  end if;
  if p_type = 'infecter' and p_choix = 'oui' and (p.etat->>'victime') is null then raise exception 'Personne à infecter cette nuit.'; end if;

  insert into hg_lg_actions(partie, manche, etape, user_id, type, cible, cible2, choix)
  values (p.id, p.manche, p.phase, auth.uid(), p_type, p_cible, p_cible2, p_choix)
  on conflict (partie, manche, etape, user_id, type) do update set cible = excluded.cible, cible2 = excluded.cible2, choix = excluded.choix, created_at = now();

  -- Résultats immédiats
  if p_type = 'sonder' then
    select role, camp into v_role, v_camp from hg_lg_cartes where partie = p.id and user_id = p_cible;
    perform hg_lg__log(p.id, 'prive', 'Nuit ' || p.manche || ' : ' || hg_lg__nom(p.id, p_cible) || ' est ' || hg_lg__role_nom(v_role) || '.', auth.uid(),
      jsonb_build_object('cible', p_cible, 'role', v_role, 'decouvert', case when v_camp = 'loups' then 'loups' else 'autre' end));
  end if;
  if p_type = 'renard' then
    select gauche, droite into v_g, v_d from hg_lg__voisins(p.id, p_cible);
    if exists (select 1 from hg_lg_cartes where partie = p.id and user_id in (p_cible, v_g, v_d) and camp = 'loups') then
      perform hg_lg__log(p.id, 'prive', 'Ton flair est formel : un loup se cache parmi ' || hg_lg__nom(p.id, v_g) || ', ' || hg_lg__nom(p.id, p_cible) || ' et ' || hg_lg__nom(p.id, v_d) || '.', auth.uid());
    else
      update hg_lg_cartes set etat = etat || '{"pouvoir_perdu": true}'::jsonb where partie = p.id and user_id = auth.uid();
      perform hg_lg__log(p.id, 'prive', 'Aucun loup parmi ' || hg_lg__nom(p.id, v_g) || ', ' || hg_lg__nom(p.id, p_cible) || ' et ' || hg_lg__nom(p.id, v_d) || '. Tu perds ton flair.', auth.uid());
    end if;
  end if;
  perform hg_lg__bump(p.id);
  perform hg_lg__essayer(p.id);
end $$;

create or replace function public.hg_lg_voter(p_code text, p_cible uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; j hg_lg_joueurs;
begin
  p := hg_lg__partie(p_code, true);
  if p.phase <> 'vote' or p.statut <> 'en_cours' then raise exception 'Ce n''est pas le moment de voter.'; end if;
  select * into j from hg_lg_joueurs where partie = p.id and user_id = auth.uid();
  if not found or not j.vivant or not j.peut_voter then raise exception 'Tu ne peux pas voter.' using errcode = '42501'; end if;
  if not hg_lg__vivant(p.id, p_cible) then raise exception 'Cette personne n''est plus en vie.'; end if;
  insert into hg_lg_votes(partie, manche, user_id, cible) values (p.id, p.manche, auth.uid(), p_cible)
    on conflict (partie, manche, user_id) do update set cible = excluded.cible, created_at = now();
  perform hg_lg__bump(p.id);
  perform hg_lg__essayer(p.id);
end $$;

create or replace function public.hg_lg_message(p_code text, p_canal text, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; j hg_lg_joueurs; c hg_lg_cartes; v_ok boolean := false; v_meneur boolean; v_nuit boolean;
begin
  p := hg_lg__partie(p_code);
  if p_texte is null or char_length(trim(p_texte)) = 0 then return; end if;
  if char_length(p_texte) > 500 then raise exception 'Message trop long (500 caractères au plus).'; end if;
  v_meneur := p.mode = 'mj' and p.hote = auth.uid();
  select * into j from hg_lg_joueurs where partie = p.id and user_id = auth.uid();
  if not found and not v_meneur then raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501'; end if;
  select * into c from hg_lg_cartes where partie = p.id and user_id = auth.uid();
  v_nuit := p.phase in ('nuit_1', 'nuit', 'reveil');
  if exists (select 1 from hg_lg_messages where partie = p.id and user_id = auth.uid() and created_at > now() - interval '1 second') then
    raise exception 'Doucement : un message par seconde.';
  end if;
  v_ok := case p_canal
    when 'salon' then p.statut in ('attente', 'revelation')
    when 'general' then p.statut = 'terminee' or v_meneur or (j.vivant and p.statut = 'en_cours' and not v_nuit)
    when 'loups' then p.statut = 'en_cours' and j.vivant and c.camp = 'loups' and v_nuit
    when 'morts' then p.statut = 'en_cours' and not j.vivant
    when 'famille' then p.statut = 'en_cours' and j.vivant and c.role in ('deux-soeurs', 'trois-freres') and v_nuit
    when 'meneur' then v_meneur
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Tu ne peux pas écrire dans ce salon maintenant.'; end if;
  insert into hg_lg_messages(partie, canal, user_id, texte) values (p.id, p_canal, auth.uid(), trim(p_texte));
end $$;

-- Le temps est écoulé (ou le meneur force l'étape suivante).
create or replace function public.hg_lg_avancer(p_code text, p_forcer boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties;
begin
  p := hg_lg__partie(p_code);
  if not hg_lg_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501'; end if;
  if p_forcer then
    if not (p.mode = 'mj' and p.hote = auth.uid()) then raise exception 'Seul le meneur peut passer à l''étape suivante.' using errcode = '42501'; end if;
    perform hg_lg__avancer(p.id);
    return;
  end if;
  perform hg_lg__essayer(p.id);
end $$;

-- Actions du meneur humain.
create or replace function public.hg_lg_mj(p_code text, p_action text, p_cible uuid default null, p_texte text default null, p_secondes int default 30)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties;
begin
  p := hg_lg__partie(p_code, true);
  if not (p.mode = 'mj' and p.hote = auth.uid()) then raise exception 'Réservé au meneur.' using errcode = '42501'; end if;
  if p_action = 'eliminer' then
    perform hg_lg__tuer(p.id, p_cible, 'meneur', 'Le meneur a éliminé ' || hg_lg__nom(p.id, p_cible) || '.');
    -- Les réactions (Chasseur, Capitaine) seront jouées à la fin de l'étape en cours.
    if hg_lg__victoire(p.id) is not null and jsonb_array_length(coalesce((select etat->'file' from hg_lg_parties where id = p.id), '[]'::jsonb)) = 0 then
      perform hg_lg__terminer(p.id, hg_lg__victoire(p.id));
    end if;
  elsif p_action = 'ressusciter' then
    update hg_lg_joueurs set vivant = true, role_revele = null, mort_manche = null, mort_cause = null where partie = p.id and user_id = p_cible;
    perform hg_lg__log(p.id, 'info', hg_lg__nom(p.id, p_cible) || ' revient parmi les vivants (correction du meneur).');
  elsif p_action = 'message' then
    if p_texte is null or char_length(trim(p_texte)) = 0 or char_length(p_texte) > 500 then raise exception 'Message vide ou trop long.'; end if;
    perform hg_lg__log(p.id, 'meneur', trim(p_texte));
  elsif p_action = 'pause' and p.phase_fin is not null then
    update hg_lg_parties set pause_reste = greatest(1, extract(epoch from (phase_fin - now()))::int), phase_fin = null where id = p.id;
  elsif p_action = 'reprendre' and p.pause_reste is not null then
    update hg_lg_parties set phase_fin = now() + make_interval(secs => pause_reste), pause_reste = null where id = p.id;
  elsif p_action = 'plus' and p.phase_fin is not null then
    update hg_lg_parties set phase_fin = phase_fin + make_interval(secs => least(greatest(p_secondes, 5), 600)) where id = p.id;
  elsif p_action = 'arreter' then
    perform hg_lg__terminer(p.id, 'annulee');
  else
    raise exception 'Action inconnue.';
  end if;
  perform hg_lg__bump(p.id);
end $$;

-- État de la partie vu par le compte connecté (ce qu'il a le droit de savoir, et rien de plus).
create or replace function public.hg_lg_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; moi hg_lg_joueurs; c hg_lg_cartes; v_meneur boolean; v_fini boolean; v_joueurs jsonb; v_moi jsonb;
  v_action jsonb; v_allies jsonb; v_votes jsonb; v_journal jsonb; v_restants jsonb; v_publics boolean; v_type text; v_fait jsonb;
begin
  if not hg_lg_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  p := hg_lg__partie(p_code);
  perform hg_lg__essayer(p.id);              -- rattrape un minuteur écoulé
  select * into p from hg_lg_parties where id = p.id;
  v_meneur := p.mode = 'mj' and p.hote = auth.uid();
  select * into moi from hg_lg_joueurs where partie = p.id and user_id = auth.uid();
  if moi.user_id is null and not v_meneur then
    if p.statut = 'attente' then
      return jsonb_build_object('partie', jsonb_build_object('code', p.code, 'nom', p.nom, 'statut', p.statut, 'mode', p.mode,
        'nb_joueurs', p.nb_joueurs, 'invites', p.invites, 'hote', hg_lg__nom(p.id, p.hote),
        'hote_pseudo', coalesce((select pseudo from hg_profiles where id = p.hote), '?'),
        'joueurs', (select count(*) from hg_lg_joueurs where partie = p.id)), 'moi', null);
    end if;
    raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501';
  end if;
  select * into c from hg_lg_cartes where partie = p.id and user_id = auth.uid();
  v_fini := p.statut = 'terminee';

  -- Joueurs : rôle visible si mort, partie finie, meneur, ou allié connu
  select jsonb_agg(jsonb_build_object(
      'user_id', j.user_id, 'pseudo', j.pseudo, 'couleur', j.couleur, 'avatar_url', j.avatar_url, 'invite', j.invite,
      'place', j.place, 'pret', j.pret, 'vu_role', j.vu_role, 'vivant', j.vivant, 'mort_cause', j.mort_cause, 'mort_manche', j.mort_manche,
      'capitaine', j.capitaine, 'peut_voter', j.peut_voter, 'gagne', j.gagne, 'paillettes', case when j.user_id = auth.uid() or v_fini then j.paillettes end,
      'role', case when v_fini or v_meneur or not j.vivant or j.role_revele is not null then coalesce(j.role_revele, k.role)
                   when j.user_id = auth.uid() then k.role end,
      'camp', case when v_fini or v_meneur then k.camp when j.user_id = auth.uid() then k.camp end,
      'etat_mj', case when v_meneur then k.etat end
    ) order by coalesce(j.place, 999), j.rejoint_at)
    into v_joueurs
    from hg_lg_joueurs j left join hg_lg_cartes k on k.partie = j.partie and k.user_id = j.user_id
    where j.partie = p.id;

  -- Alliés connus : meute, amoureux, sœurs/frères
  if c.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', k.user_id, 'pseudo', jj.pseudo, 'lien',
        case when (c.etat->>'amoureux')::uuid = k.user_id then 'amoureux'
             when c.camp = 'loups' and k.camp = 'loups' then 'loup'
             else 'famille' end, 'role', case when c.camp = 'loups' and k.camp = 'loups' then k.role end)), '[]'::jsonb)
      into v_allies
      from hg_lg_cartes k join hg_lg_joueurs jj on jj.partie = k.partie and jj.user_id = k.user_id
      where k.partie = p.id and k.user_id <> c.user_id and (
           (c.camp = 'loups' and k.camp = 'loups')
        or (c.etat->>'amoureux')::uuid = k.user_id
        or (c.role in ('deux-soeurs', 'trois-freres') and k.role = c.role));
  end if;

  -- Action attendue de moi maintenant
  select a.type into v_type from hg_lg__attendus(p.id) a where a.user_id = auth.uid() limit 1;
  if v_type is not null then
    select to_jsonb(x) into v_fait from (select type, cible, cible2, choix from hg_lg_actions where partie = p.id and manche = p.manche and etape = p.phase
      and user_id = auth.uid() order by created_at desc limit 1) x;
    if p.phase = 'vote' then
      select to_jsonb(x) into v_fait from (select cible from hg_lg_votes where partie = p.id and manche = p.manche and user_id = auth.uid()) x;
    end if;
    v_action := jsonb_build_object('type', v_type, 'fait', v_fait,
      'victime', case when v_type in ('sorciere', 'infecter') then (p.etat->>'victime') end,
      'victime_pseudo', case when v_type in ('sorciere', 'infecter') and p.etat ? 'victime' then hg_lg__nom(p.id, (p.etat->>'victime')::uuid) end,
      'potions', case when v_type = 'sorciere' then jsonb_build_object('vie', coalesce((c.etat->>'vie')::boolean, false), 'mort', coalesce((c.etat->>'mort')::boolean, false)) end,
      'centre', case when v_type = 'voleur' then (select jsonb_agg(jsonb_build_object('idx', idx, 'role', role) order by idx) from hg_lg_centre where partie = p.id) end,
      'dernier_protege', case when v_type = 'proteger' then c.etat->'dernier_protege' end,
      'meute', case when v_type = 'devorer' then (select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'cible', a.cible))
                    from hg_lg_actions a where a.partie = p.id and a.manche = p.manche and a.etape = 'nuit' and a.type = 'devorer') end);
  end if;

  -- Votes publics pendant et après le vote
  if p.phase = 'vote' or v_fini then
    select coalesce(jsonb_agg(jsonb_build_object('de', v.user_id, 'pour', v.cible, 'manche', v.manche)), '[]'::jsonb) into v_votes
      from hg_lg_votes v where v.partie = p.id and (v.manche = p.manche or v_fini);
  end if;

  -- Journal : public + mes infos privées (le meneur voit tout)
  select coalesce(jsonb_agg(jsonb_build_object('id', jr.id, 'manche', jr.manche, 'phase', jr.phase, 'type', jr.type, 'texte', jr.texte,
      'prive', jr.pour is not null, 'at', jr.created_at) order by jr.id), '[]'::jsonb) into v_journal
    from (select * from hg_lg_journal jr where jr.partie = p.id and (jr.pour is null or jr.pour = auth.uid() or v_meneur or v_fini)
          order by jr.id desc limit 200) jr;

  -- Rôles restants : composition moins les rôles révélés des morts (le centre du Voleur reste inconnu)
  select coalesce(jsonb_agg(jsonb_build_object('role', key, 'total', value::int,
      'morts', (select count(*) from hg_lg_joueurs x where x.partie = p.id and not x.vivant and x.role_revele = key))), '[]'::jsonb)
    into v_restants from jsonb_each_text(p.composition);

  v_moi := jsonb_build_object('user_id', auth.uid(), 'meneur', v_meneur, 'hote', p.hote = auth.uid(),
    'joueur', moi.user_id is not null, 'vivant', coalesce(moi.vivant, false),
    'role', c.role, 'role_initial', c.role_initial, 'camp', c.camp,
    'amoureux', c.etat->'amoureux', 'envoute', coalesce((c.etat->>'envoute')::boolean, false),
    'allies', coalesce(v_allies, '[]'::jsonb), 'action', v_action,
    'pouvoir_perdu', coalesce((c.etat->>'pouvoir_perdu')::boolean, false) or coalesce((p.etat->>'pouvoirs_perdus')::boolean, false));

  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'code', p.code, 'nom', p.nom, 'mode', p.mode, 'visibilite', p.visibilite,
      'statut', p.statut, 'phase', p.phase, 'manche', p.manche, 'phase_fin', p.phase_fin, 'pause_reste', p.pause_reste,
      'maintenant', now(), 'nb_joueurs', p.nb_joueurs, 'invites', p.invites, 't_nuit', p.t_nuit, 't_jour', p.t_jour, 't_vote', p.t_vote,
      'annonce_discord', p.annonce_discord, 'composition', p.composition, 'vainqueur', p.vainqueur, 'version', p.version,
      'hote', p.hote, 'corbeau', p.etat->'corbeau', 'mvp', p.etat->'mvp', 'started_at', p.started_at, 'ended_at', p.ended_at,
      'centre', case when v_fini or v_meneur then (select jsonb_agg(role order by idx) from hg_lg_centre where partie = p.id) end),
    'joueurs', coalesce(v_joueurs, '[]'::jsonb),
    'moi', v_moi,
    'votes', v_votes,
    'journal', v_journal,
    'restants', v_restants,
    'actions_mj', case when v_meneur then (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'etape', a.etape, 'type', a.type,
        'cible', a.cible, 'cible2', a.cible2, 'choix', a.choix)), '[]'::jsonb) from hg_lg_actions a where a.partie = p.id and a.manche = p.manche) end,
    'attendus', case when v_meneur then (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'type', a.type)), '[]'::jsonb) from hg_lg__attendus(p.id) a) end
  );
end $$;

-- Parties publiques en attente.
create or replace function public.hg_lg_publiques()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not hg_lg_peut() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'mode', p.mode, 'nb_joueurs', p.nb_joueurs,
      'joueurs', (select count(*) from hg_lg_joueurs j where j.partie = p.id),
      'hote_pseudo', coalesce((select pseudo from hg_profiles where id = p.hote), (select pseudo from hg_lg_joueurs where partie = p.id and user_id = p.hote)),
      'hote_couleur', (select color from hg_profiles where id = p.hote),
      'extensions', (select jsonb_agg(distinct r.extension) from jsonb_object_keys(p.composition) k join hg_lg_roles r on r.id = k),
      't_nuit', p.t_nuit) order by p.created_at desc)
    from hg_lg_parties p where p.statut = 'attente' and p.visibilite = 'publique' and p.created_at > now() - interval '6 hours'), '[]'::jsonb) end
$$;

-- Mes parties en cours (ou en attente).
create or replace function public.hg_lg_mes_parties()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('code', p.code, 'nom', p.nom, 'mode', p.mode, 'statut', p.statut, 'phase', p.phase, 'manche', p.manche,
      'nb_joueurs', p.nb_joueurs, 'vivants', (select count(*) from hg_lg_joueurs j where j.partie = p.id and j.vivant),
      'meneur', p.mode = 'mj' and p.hote = auth.uid(), 'created_at', p.created_at) x
    from hg_lg_parties p
    where p.statut in ('attente', 'revelation', 'en_cours') and hg_lg_peut()
      and (exists (select 1 from hg_lg_joueurs j where j.partie = p.id and j.user_id = auth.uid()) or (p.mode = 'mj' and p.hote = auth.uid()))) s
$$;

-- Statistiques d'un membre (moi par défaut).
create or replace function public.hg_lg_stats(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_u uuid := coalesce(p_user, auth.uid()); v jsonb;
begin
  if not hg_lg_peut() then return null; end if;
  with mes as (
    select j.*, k.role_initial, k.role as role_final, k.camp, p.vainqueur, p.nom, p.ended_at, p.code
      from hg_lg_joueurs j join hg_lg_parties p on p.id = j.partie join hg_lg_cartes k on k.partie = j.partie and k.user_id = j.user_id
      where j.user_id = v_u and p.statut = 'terminee' and p.vainqueur <> 'annulee')
  select jsonb_build_object(
    'parties', (select count(*) from mes),
    'victoires', (select count(*) from mes where gagne),
    'survies', (select count(*) from mes where vivant),
    'paillettes', (select coalesce(sum(paillettes), 0) from mes),
    'survie_moyenne', (select round(avg(coalesce(mort_manche, (select manche from hg_lg_parties where id = mes.partie)))::numeric, 1) from mes),
    'par_camp', (select coalesce(jsonb_object_agg(camp, jsonb_build_object('parties', n, 'victoires', w)), '{}'::jsonb)
                 from (select camp, count(*) n, count(*) filter (where gagne) w from mes group by camp) z),
    'par_role', (select coalesce(jsonb_agg(jsonb_build_object('role', role_final, 'parties', n, 'victoires', w) order by n desc), '[]'::jsonb)
                 from (select role_final, count(*) n, count(*) filter (where gagne) w from mes group by role_final) z),
    'dernieres', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'nom', nom, 'role', role_final, 'gagne', gagne, 'date', ended_at) order by ended_at desc), '[]'::jsonb)
                  from (select * from mes order by ended_at desc limit 8) z),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description, 'image_url', b.image_url,
                 'obtenu', ub.awarded_at) order by b.sort), '[]'::jsonb)
               from hg_badges b left join hg_user_badges ub on ub.badge_code = b.code and ub.user_id = v_u where b.code like 'lg\_%')
  ) into v;
  return v;
end $$;

-- Administration : réglages des récompenses et des testeurs.
create or replace function public.hg_lg_admin_reglages()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'reglages', (select value from hg_settings where key = 'loup_garou'),
    'badges', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description, 'image_url', b.image_url,
                 'membres', (select count(*) from hg_user_badges u where u.badge_code = b.code)) order by b.sort), '[]'::jsonb)
               from hg_badges b where b.code like 'lg\_%'),
    'parties', (select jsonb_build_object('en_cours', count(*) filter (where statut in ('attente', 'revelation', 'en_cours')),
                 'terminees', count(*) filter (where statut = 'terminee')) from hg_lg_parties));
end $$;

create or replace function public.hg_lg_admin_enregistrer(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''administrateur.' using errcode = '42501'; end if;
  v := coalesce((select value from hg_settings where key = 'loup_garou'), '{}'::jsonb);
  if p ? 'paillettes' then v := v || jsonb_build_object('paillettes', jsonb_build_object(
    'participation', greatest(0, least(1000, coalesce((p->'paillettes'->>'participation')::int, 10))),
    'victoire', greatest(0, least(1000, coalesce((p->'paillettes'->>'victoire')::int, 30))),
    'survie', greatest(0, least(1000, coalesce((p->'paillettes'->>'survie')::int, 10))),
    'mvp', greatest(0, least(1000, coalesce((p->'paillettes'->>'mvp')::int, 20))),
    'loup_decouvert', greatest(0, least(1000, coalesce((p->'paillettes'->>'loup_decouvert')::int, 5))))); end if;
  if p ? 'plafond_jour' then v := v || jsonb_build_object('plafond_jour', greatest(0, least(100000, (p->>'plafond_jour')::int))); end if;
  if p ? 'min_joueurs_paillettes' then v := v || jsonb_build_object('min_joueurs_paillettes', greatest(4, least(50, (p->>'min_joueurs_paillettes')::int))); end if;
  insert into hg_settings(key, value) values ('loup_garou', v) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'loup_garou_reglages', 'loup_garou', p);
end $$;

/* =====================================================================
   6. Badges du jeu
   ===================================================================== */
insert into public.hg_badges(code, name, description, sort) values
  ('lg_premiere_victoire', 'Première victoire', 'Gagner une partie de Loup-Garou.', 900),
  ('lg_oeil_de_lynx', 'Œil de lynx', 'Découvrir 3 loups en une seule partie.', 901),
  ('lg_meute_soudee', 'Meute soudée', 'Gagner avec les loups sans perdre un seul loup.', 902),
  ('lg_survivant', 'Survivant', 'Être encore en vie à la fin de 10 parties.', 903),
  ('lg_grand_mechant', 'Grand méchant', 'Dévorer 15 villageois au fil des parties.', 904),
  ('lg_cupidon_farceur', 'Cupidon farceur', 'En Cupidon, unir un loup et un villageois.', 905)
on conflict (code) do nothing;

/* =====================================================================
   7. Droits
   ===================================================================== */
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hg\_lg\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'hg\_lg\_\_%' or f.proname = 'hg_lg_tick' then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Minuteur de secours : chaque minute, débloque les parties dont le temps est écoulé.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'hg-lg-tick';
    perform cron.schedule('hg-lg-tick', '* * * * *', 'select public.hg_lg_tick()');
  end if;
end $$;
