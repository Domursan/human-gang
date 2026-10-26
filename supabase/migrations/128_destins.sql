-- ===== Humane Gang — migration 128 : Destins, le jeu de la vie (moteur du jeu, sur le socle 125) =====
-- Règles du jeu de la vie, adaptées au jeu en ligne (2 à 6 joueurs) :
--   Départ : Université (prêt d'études de 100 000 €, métiers avec diplôme) ou Carrière (métier tout de suite).
--   On tourne la roue (1 à 10) et on avance. Cases STOP : Diplôme, Mariage, Choix de vie (Famille ou Aventure), Retraite.
--   Jour de paie : salaire en passant ou en s'arrêtant. Événements, bébés, achat de maison, assurances, impôts, procès,
--   augmentations, cases Risque (sur le chemin Aventure). Argent à découvert : prêt automatique de 20 000 € (25 000 € à rendre).
--   Retraite : ordre d'arrivée (+100 000 / +50 000 / +20 000 €), puis Maison de retraite (sûr) ou Domaine des millionnaires
--   (pari à la roue : 1-4 → −200 000 €, 5-7 → +100 000 €, 8-10 → +400 000 €).
--   Fin quand tout le monde est à la retraite : fortune = argent + vente des maisons + 50 000 € par enfant − prêts à rendre.
-- Plateau : 91 cases (0 à 90), voir hg_plat__de_case. Phases (etat.phase) : depart → (metier) → tourner → (achat | assurance | voie | cible | retraite).

/* ---------- Contenus paramétrables ---------- */
insert into public.hg_plat_contenus(jeu, cle, libelle, valeur, defaut, sort)
select 'destins', c.cle, c.libelle, c.v, c.v, c.sort from (values
  ('nom', 'Nom du jeu', to_jsonb('Destins'::text), 1),
  ('sous_titre', 'Sous-titre', to_jsonb('le jeu de la vie'::text), 2),
  ('cases', 'Noms des cases', '[
    {"id":"depart","nom":"Départ"},{"id":"paie","nom":"Jour de paie"},{"id":"evenement","nom":"Événement"},{"id":"vacances","nom":"Vacances"},
    {"id":"assurance","nom":"Assurance"},{"id":"diplome","nom":"Diplôme"},{"id":"mariage","nom":"Mariage"},{"id":"bebe","nom":"Bébé"},
    {"id":"jumeaux","nom":"Jumeaux"},{"id":"achat","nom":"Achat d''une maison"},{"id":"impots","nom":"Impôts"},{"id":"proces","nom":"Procès"},
    {"id":"augmentation","nom":"Augmentation"},{"id":"choix","nom":"Choix de vie"},{"id":"risque","nom":"Risque"},{"id":"retraite","nom":"Retraite"}]'::jsonb, 3),
  ('voies', 'Chemins', '[
    {"id":"universite","nom":"Université","texte":"Prêt d''études de 100 000 €, mais des métiers mieux payés."},
    {"id":"carriere","nom":"Carrière","texte":"Un métier tout de suite, sans diplôme."},
    {"id":"famille","nom":"Famille","texte":"Plus d''enfants et une vie tranquille."},
    {"id":"aventure","nom":"Aventure","texte":"Des risques : on peut gagner gros… ou perdre beaucoup."},
    {"id":"maison","nom":"Maison de retraite","texte":"Une retraite paisible : tu gardes ta fortune."},
    {"id":"domaine","nom":"Domaine des millionnaires","texte":"Le pari : tourne la roue. 1 à 4 : −200 000 €, 5 à 7 : +100 000 €, 8 à 10 : +400 000 €."}]'::jsonb, 4),
  ('metiers', 'Métiers', '[
    {"id":"medecin","nom":"Médecin","diplome":true,"salaire":100000},
    {"id":"avocat","nom":"Avocat","diplome":true,"salaire":90000},
    {"id":"ingenieur","nom":"Ingénieur","diplome":true,"salaire":80000},
    {"id":"pilote","nom":"Pilote","diplome":true,"salaire":80000},
    {"id":"veterinaire","nom":"Vétérinaire","diplome":true,"salaire":70000},
    {"id":"comptable","nom":"Comptable","diplome":true,"salaire":70000},
    {"id":"enseignant","nom":"Enseignant","diplome":true,"salaire":60000},
    {"id":"policier","nom":"Policier","diplome":false,"salaire":50000},
    {"id":"mecanicien","nom":"Mécanicien","diplome":false,"salaire":40000},
    {"id":"artiste","nom":"Artiste","diplome":false,"salaire":40000},
    {"id":"cuisinier","nom":"Cuisinier","diplome":false,"salaire":40000},
    {"id":"vendeur","nom":"Vendeur","diplome":false,"salaire":30000},
    {"id":"coiffeur","nom":"Coiffeur","diplome":false,"salaire":30000},
    {"id":"athlete","nom":"Athlète","diplome":false,"salaire":60000}]'::jsonb, 5),
  ('maisons', 'Maisons', '[
    {"id":"studio","nom":"Studio","prix":60000,"vente":80000},
    {"id":"appartement","nom":"Appartement","prix":100000,"vente":140000},
    {"id":"campagne","nom":"Maison de campagne","prix":160000,"vente":220000},
    {"id":"chalet","nom":"Chalet","prix":200000,"vente":270000},
    {"id":"villa","nom":"Villa","prix":250000,"vente":350000},
    {"id":"chateau","nom":"Château","prix":400000,"vente":560000}]'::jsonb, 6),
  ('evenements', 'Cartes Événement', '[
    {"id":"e1","texte":"Tu gagnes un concours de cuisine. Reçois 20 000 €.","effet":"gain","montant":20000},
    {"id":"e2","texte":"Ta voiture tombe en panne. Paie 10 000 €.","effet":"perte","montant":10000},
    {"id":"e3","texte":"Un oncle d''Amérique te laisse un héritage. Reçois 100 000 €.","effet":"gain","montant":100000},
    {"id":"e4","texte":"Une tornade abîme ta maison. Sans assurance habitation, paie 50 000 €.","effet":"maison","montant":50000},
    {"id":"e5","texte":"Accident de voiture. Sans assurance auto, paie 20 000 €.","effet":"auto","montant":20000},
    {"id":"e6","texte":"Tu vends un tableau au marché aux puces. Reçois 30 000 €.","effet":"gain","montant":30000},
    {"id":"e7","texte":"Tu offres un voyage à ta famille. Paie 25 000 €.","effet":"perte","montant":25000},
    {"id":"e8","texte":"Ton chef t''accorde une prime. Reçois un salaire en plus.","effet":"salaire","montant":0},
    {"id":"e9","texte":"Tu adoptes un enfant.","effet":"bebe","montant":1},
    {"id":"e10","texte":"Inondation dans ta cave. Sans assurance habitation, paie 30 000 €.","effet":"maison","montant":30000},
    {"id":"e11","texte":"Tu gagnes au loto ! Reçois 50 000 €.","effet":"gain","montant":50000},
    {"id":"e12","texte":"Rénovation de la cuisine. Paie 15 000 €.","effet":"perte","montant":15000},
    {"id":"e13","texte":"Tu écris un livre à succès. Reçois 60 000 €.","effet":"gain","montant":60000},
    {"id":"e14","texte":"Excès de vitesse. Paie 5 000 €.","effet":"perte","montant":5000},
    {"id":"e15","texte":"Accrochage sur le parking. Sans assurance auto, paie 10 000 €.","effet":"auto","montant":10000},
    {"id":"e16","texte":"Tu reçois une promotion. Ton salaire augmente de 10 000 €.","effet":"augmentation","montant":10000},
    {"id":"e17","texte":"Tu remportes un procès. Choisis un joueur : il te paie 50 000 €.","effet":"proces","montant":50000},
    {"id":"e18","texte":"Tu aides un ami à déménager. Il ne se passe rien, mais il te remercie.","effet":"rien","montant":0},
    {"id":"e19","texte":"Fête d''anniversaire surprise. Chaque joueur t''offre 5 000 €.","effet":"cadeaux","montant":5000},
    {"id":"e20","texte":"Le toit fuit. Sans assurance habitation, paie 20 000 €.","effet":"maison","montant":20000}]'::jsonb, 7)
) c(cle, libelle, v, sort)
on conflict (jeu, cle) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('plat_destins_victoire', 'Belle vie', 'Gagner une partie de Destins.', 1020),
  ('plat_destins_famille', 'Famille nombreuse', 'Finir une partie de Destins avec 4 enfants ou plus.', 1021),
  ('plat_destins_millionnaire', 'Millionnaire', 'Finir une partie de Destins avec plus de 1 000 000 €.', 1022),
  ('plat_destins_pari', 'Coup de poker', 'Gagner le pari du Domaine des millionnaires (8 à 10).', 1023)
on conflict (code) do nothing;

/* ---------- Plateau ---------- */

-- Type de la case n.
create or replace function public.hg_plat__de_case(n int)
returns text language sql immutable as $$
  select (array[
    'depart',
    'evenement', 'vacances', 'evenement', 'evenement', 'vacances', 'evenement', 'assurance', 'evenement', 'vacances', 'diplome',
    'paie', 'evenement', 'vacances', 'evenement', 'paie', 'assurance', 'evenement', 'evenement', 'vacances', 'paie',
    'evenement', 'augmentation', 'evenement', 'paie', 'mariage', 'evenement', 'bebe', 'achat', 'paie', 'assurance',
    'evenement', 'impots', 'bebe', 'paie', 'proces', 'evenement', 'vacances', 'achat', 'paie', 'evenement',
    'impots', 'bebe', 'evenement', 'paie', 'augmentation', 'evenement', 'jumeaux', 'vacances', 'paie', 'evenement',
    'choix',
    'bebe', 'paie', 'evenement', 'bebe', 'achat', 'paie', 'jumeaux', 'evenement', 'bebe', 'paie',
    'risque', 'paie', 'evenement', 'risque', 'augmentation', 'paie', 'risque', 'evenement', 'risque', 'paie',
    'evenement', 'impots', 'paie', 'evenement', 'achat', 'bebe', 'paie', 'proces', 'evenement', 'vacances',
    'paie', 'impots', 'evenement', 'augmentation', 'paie', 'evenement', 'vacances', 'paie', 'retraite'])[n + 1]
$$;

-- Case suivante (p_voie : choix fait aux embranchements 0 et 51).
create or replace function public.hg_plat__de_suivante(n int, p_voie text)
returns int language sql immutable as $$
  select case n
    when 0 then case when p_voie = 'universite' then 1 else 11 end
    when 10 then 21 when 20 then 21
    when 51 then case when p_voie = 'aventure' then 62 else 52 end
    when 61 then 72 when 71 then 72
    when 90 then 90
    else n + 1 end
$$;

/* ---------- Outils ---------- */

create or replace function public.hg_plat__de_j(p_id uuid, p_u uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select etat from hg_plat_joueurs where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__de_set(p_id uuid, p_u uuid, p jsonb)
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set etat = etat || p where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__de_euros(n bigint)
returns text language sql immutable as $$
  select case when n < 0 then '−' else '' end || trim(replace(to_char(abs(n), 'FM999G999G999G990'), ',', ' ')) || ' €'
$$;

-- Ajoute (ou retire) de l'argent ; à découvert, prêts automatiques de 20 000 € (25 000 € à rendre).
create or replace function public.hg_plat__de_argent(p_id uuid, p_u uuid, n bigint)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_a bigint; v_prets int := 0;
begin
  e := hg_plat__de_j(p_id, p_u);
  v_a := (e->>'argent')::bigint + n;
  while v_a < 0 loop v_a := v_a + 20000; v_prets := v_prets + 1; end loop;
  perform hg_plat__de_set(p_id, p_u, jsonb_build_object('argent', v_a, 'prets', (e->>'prets')::int + v_prets));
  if v_prets > 0 then
    perform hg_plat__log(p_id, p_u, 'pret', hg_plat__nom(p_id, p_u) || ' emprunte ' || hg_plat__de_euros(v_prets * 20000) || ' à la banque.');
  end if;
end $$;

create or replace function public.hg_plat__de_metier(p_id text, p_champ text)
returns text language sql stable security definer set search_path = public as $$
  select x->>p_champ from jsonb_array_elements(hg_plat__c('destins', 'metiers')) x where x->>'id' = p_id
$$;
-- Les nombres viennent toujours des valeurs d'origine (non modifiables).
create or replace function public.hg_plat__de_defaut(p_cle text, p_id text, p_champ text)
returns bigint language sql stable security definer set search_path = public as $$
  select (x->>p_champ)::bigint from hg_plat_contenus c, jsonb_array_elements(c.defaut) x where c.jeu = 'destins' and c.cle = p_cle and x->>'id' = p_id
$$;

create or replace function public.hg_plat__de_salaire(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s bigint;
begin
  v_s := coalesce((hg_plat__de_j(p_id, p_u)->>'salaire')::bigint, 0);
  if v_s > 0 then
    perform hg_plat__de_argent(p_id, p_u, v_s);
    perform hg_plat__log(p_id, p_u, 'paie', 'Jour de paie : ' || hg_plat__nom(p_id, p_u) || ' reçoit ' || hg_plat__de_euros(v_s) || '.');
  end if;
end $$;

create or replace function public.hg_plat__de_bebe(p_id uuid, p_u uuid, n int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hg_plat__de_set(p_id, p_u, jsonb_build_object('enfants', (hg_plat__de_j(p_id, p_u)->>'enfants')::int + n));
  perform hg_plat__log(p_id, p_u, 'bebe', case when n > 1 then hg_plat__nom(p_id, p_u) || ' a des jumeaux !' else hg_plat__nom(p_id, p_u) || ' accueille un enfant.' end);
end $$;

-- Fortune finale (sans les bonus déjà ajoutés à l'argent).
create or replace function public.hg_plat__de_fortune(e jsonb)
returns bigint language sql stable security definer set search_path = public as $$
  select (e->>'argent')::bigint
    + coalesce((select sum(hg_plat__de_defaut('maisons', m, 'vente')) from jsonb_array_elements_text(e->'maisons') m), 0)
    + 50000 * (e->>'enfants')::int - 25000 * (e->>'prets')::int
$$;

-- Deux métiers au hasard (avec ou sans diplôme).
create or replace function public.hg_plat__de_tirer_metiers(p_diplome boolean)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_agg(x->>'id') from (select x from jsonb_array_elements(hg_plat__c('destins', 'metiers')) x
    where (x->>'diplome')::boolean = p_diplome order by random() limit 2) t
$$;

create or replace function public.hg_plat__de_phase(p_id uuid, p_phase text, p_choix jsonb default null)
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', p_phase, 'choix', p_choix) where id = p_id
$$;

-- Joueur suivant pas encore à la retraite ; fin si tout le monde y est.
create or replace function public.hg_plat__de_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_actif uuid; v_place int; v_suiv uuid; r record; v_gagnants uuid[]; v_max bigint;
begin
  select etat into e from hg_plat_parties where id = p_id;
  v_actif := (e->>'actif')::uuid;
  select place into v_place from hg_plat_joueurs where partie = p_id and user_id = v_actif;
  select user_id into v_suiv from hg_plat_joueurs where partie = p_id and not coalesce((etat->>'retraite')::boolean, false)
    order by (place <= v_place), place limit 1;
  if v_suiv is null then
    -- Fin : fortune et classement.
    for r in select user_id, etat from hg_plat_joueurs where partie = p_id loop
      perform hg_plat__de_set(p_id, r.user_id, jsonb_build_object('fortune', hg_plat__de_fortune(r.etat)));
    end loop;
    with c as (select user_id, rank() over (order by (etat->>'fortune')::bigint desc) rg from hg_plat_joueurs where partie = p_id)
    update hg_plat_joueurs j set rang = c.rg from c where j.partie = p_id and j.user_id = c.user_id;
    select max((etat->>'fortune')::bigint) into v_max from hg_plat_joueurs where partie = p_id;
    select array_agg(user_id) into v_gagnants from hg_plat_joueurs where partie = p_id and (etat->>'fortune')::bigint = v_max;
    perform hg_plat__terminer(p_id, v_gagnants, 'retraite');
    return;
  end if;
  update hg_plat_parties set nb_tours = nb_tours + 1, etat = etat || jsonb_build_object('actif', v_suiv, 'phase',
    case when (hg_plat__de_j(p_id, v_suiv)->>'case')::int = 0 and hg_plat__de_j(p_id, v_suiv)->>'voie' is null then 'depart' else 'tourner' end,
    'choix', null) where id = p_id;
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

-- Effet de la case où l'on s'arrête. Renvoie vrai si un choix est attendu (le tour ne passe pas).
create or replace function public.hg_plat__de_arriver(p_id uuid, p_u uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare j jsonb; n int; t text; v_carte jsonb; v_m bigint; d int; r record; v_ordre int; v_bonus bigint;
begin
  j := hg_plat__de_j(p_id, p_u); n := (j->>'case')::int; t := hg_plat__de_case(n);
  if t = 'paie' then perform hg_plat__de_salaire(p_id, p_u);
  elsif t = 'bebe' then perform hg_plat__de_bebe(p_id, p_u, 1);
  elsif t = 'jumeaux' then perform hg_plat__de_bebe(p_id, p_u, 2);
  elsif t = 'augmentation' then
    if (j->>'salaire')::bigint > 0 then
      perform hg_plat__de_set(p_id, p_u, jsonb_build_object('salaire', (j->>'salaire')::bigint + 10000));
      perform hg_plat__log(p_id, p_u, 'paie', hg_plat__nom(p_id, p_u) || ' est augmenté : +' || hg_plat__de_euros(10000) || ' par jour de paie.');
    end if;
  elsif t = 'impots' then
    v_m := (j->>'salaire')::bigint / 4;
    if v_m > 0 then perform hg_plat__de_argent(p_id, p_u, -v_m);
      perform hg_plat__log(p_id, p_u, 'perte', hg_plat__nom(p_id, p_u) || ' paie ses impôts : ' || hg_plat__de_euros(v_m) || '.'); end if;
  elsif t = 'risque' then
    d := hg_plat__sh_d(10);
    update hg_plat_parties set etat = etat || jsonb_build_object('roue2', d) where id = p_id;
    if d >= 6 then perform hg_plat__de_argent(p_id, p_u, 100000);
      perform hg_plat__log(p_id, p_u, 'gain', 'Risque : ' || d || ' à la roue, ' || hg_plat__nom(p_id, p_u) || ' gagne ' || hg_plat__de_euros(100000) || ' !');
    else perform hg_plat__de_argent(p_id, p_u, -50000);
      perform hg_plat__log(p_id, p_u, 'perte', 'Risque : ' || d || ' à la roue, ' || hg_plat__nom(p_id, p_u) || ' perd ' || hg_plat__de_euros(50000) || '.'); end if;
  elsif t = 'mariage' then
    if not coalesce((j->>'marie')::boolean, false) then
      perform hg_plat__de_set(p_id, p_u, '{"marie": true}');
      perform hg_plat__log(p_id, p_u, 'mariage', hg_plat__nom(p_id, p_u) || ' se marie ! Chaque joueur offre ' || hg_plat__de_euros(10000) || '.');
      for r in select user_id from hg_plat_joueurs where partie = p_id and user_id <> p_u loop
        perform hg_plat__de_argent(p_id, r.user_id, -10000); perform hg_plat__de_argent(p_id, p_u, 10000);
      end loop;
    end if;
  elsif t = 'proces' then
    perform hg_plat__de_phase(p_id, 'cible', jsonb_build_object('montant', 50000, 'raison', 'proces'));
    return true;
  elsif t = 'achat' then
    perform hg_plat__de_phase(p_id, 'achat', jsonb_build_object('maisons', (select jsonb_agg(x->>'id') from (select x from jsonb_array_elements(hg_plat__c('destins', 'maisons')) x order by random() limit 3) s)));
    return true;
  elsif t = 'assurance' then
    if coalesce((j->>'assurance_habitation')::boolean, false) and coalesce((j->>'assurance_auto')::boolean, false) then return false; end if;
    perform hg_plat__de_phase(p_id, 'assurance');
    return true;
  elsif t = 'diplome' then
    perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' obtient son diplôme !');
    perform hg_plat__de_phase(p_id, 'metier', jsonb_build_object('metiers', hg_plat__de_tirer_metiers(true)));
    return true;
  elsif t = 'choix' then
    perform hg_plat__de_phase(p_id, 'voie', '{"voies": ["famille", "aventure"]}');
    return true;
  elsif t = 'retraite' then
    select count(*) into v_ordre from hg_plat_joueurs where partie = p_id and coalesce((etat->>'retraite')::boolean, false);
    v_bonus := case v_ordre when 0 then 100000 when 1 then 50000 when 2 then 20000 else 0 end;
    if v_bonus > 0 then
      perform hg_plat__de_argent(p_id, p_u, v_bonus);
      perform hg_plat__log(p_id, p_u, 'gain', hg_plat__nom(p_id, p_u) || ' arrive ' || case v_ordre when 0 then '1er' else (v_ordre + 1) || 'e' end
        || ' à la retraite : +' || hg_plat__de_euros(v_bonus) || '.');
    end if;
    perform hg_plat__de_phase(p_id, 'retraite', '{"voies": ["maison", "domaine"]}');
    return true;
  elsif t = 'evenement' then
    select x into v_carte from jsonb_array_elements(hg_plat__c('destins', 'evenements')) x order by random() limit 1;
    v_m := hg_plat__de_defaut('evenements', v_carte->>'id', 'montant');
    update hg_plat_parties set etat = etat || jsonb_build_object('carte', jsonb_build_object('id', v_carte->>'id', 'pour', p_u, 'case', n)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'evenement', hg_plat__nom(p_id, p_u) || ' tire : « ' || (v_carte->>'texte') || ' »');
    case (select x->>'effet' from hg_plat_contenus c, jsonb_array_elements(c.defaut) x where c.jeu = 'destins' and c.cle = 'evenements' and x->>'id' = v_carte->>'id')
      when 'gain' then perform hg_plat__de_argent(p_id, p_u, v_m);
      when 'perte' then perform hg_plat__de_argent(p_id, p_u, -v_m);
      when 'maison' then
        if jsonb_array_length(j->'maisons') = 0 then perform hg_plat__log(p_id, p_u, 'info', 'Pas de maison : rien à payer.');
        elsif coalesce((j->>'assurance_habitation')::boolean, false) then perform hg_plat__log(p_id, p_u, 'info', 'Assuré : rien à payer.');
        else perform hg_plat__de_argent(p_id, p_u, -v_m); end if;
      when 'auto' then
        if coalesce((j->>'assurance_auto')::boolean, false) then perform hg_plat__log(p_id, p_u, 'info', 'Assuré : rien à payer.');
        else perform hg_plat__de_argent(p_id, p_u, -v_m); end if;
      when 'salaire' then perform hg_plat__de_salaire(p_id, p_u);
      when 'bebe' then perform hg_plat__de_bebe(p_id, p_u, 1);
      when 'augmentation' then
        if (j->>'salaire')::bigint > 0 then perform hg_plat__de_set(p_id, p_u, jsonb_build_object('salaire', (j->>'salaire')::bigint + v_m)); end if;
      when 'cadeaux' then
        for r in select user_id from hg_plat_joueurs where partie = p_id and user_id <> p_u loop
          perform hg_plat__de_argent(p_id, r.user_id, -v_m); perform hg_plat__de_argent(p_id, p_u, v_m);
        end loop;
      when 'proces' then
        perform hg_plat__de_phase(p_id, 'cible', jsonb_build_object('montant', v_m, 'raison', 'proces'));
        return true;
      else null;
    end case;
  end if;
  return false;
end $$;

-- Avance de k cases (jour de paie en passant ; arrêt sur les cases STOP).
create or replace function public.hg_plat__de_avancer(p_id uuid, p_u uuid, k int)
returns void language plpgsql security definer set search_path = public as $$
declare j jsonb; n int; i int; t text;
begin
  j := hg_plat__de_j(p_id, p_u); n := (j->>'case')::int;
  for i in 1 .. k loop
    n := hg_plat__de_suivante(n, case when n = 0 then j->>'voie' else j->>'voie2' end);
    t := hg_plat__de_case(n);
    exit when t in ('diplome', 'mariage', 'choix', 'retraite') and i < k and not (t = 'mariage' and coalesce((j->>'marie')::boolean, false));
    if t = 'paie' and i < k then
      perform hg_plat__de_set(p_id, p_u, jsonb_build_object('case', n));
      perform hg_plat__de_salaire(p_id, p_u);
    end if;
  end loop;
  perform hg_plat__de_set(p_id, p_u, jsonb_build_object('case', n));
  perform hg_plat__log(p_id, p_u, 'avance', hg_plat__nom(p_id, p_u) || ' arrive sur : ' || hg_plat__n('destins', 'cases', hg_plat__de_case(n)) || '.');
end $$;

/* ---------- Interface du socle ---------- */

create or replace function public.hg_plat__destins_options(p jsonb)
returns jsonb language sql immutable as $$ select '{}'::jsonb $$;

create or replace function public.hg_plat__destins_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_premier uuid;
begin
  update hg_plat_joueurs set etat = jsonb_build_object('case', 0, 'voie', null, 'voie2', null, 'argent', 10000, 'prets', 0, 'metier', null, 'salaire', 0,
    'marie', false, 'enfants', 0, 'maisons', '[]'::jsonb, 'assurance_habitation', false, 'assurance_auto', false, 'retraite', false, 'retraite_lieu', null)
  where partie = p_id;
  select user_id into v_premier from hg_plat_joueurs where partie = p_id order by place limit 1;
  update hg_plat_parties set nb_tours = 1, etat = jsonb_build_object('actif', v_premier, 'phase', 'depart', 'choix', null, 'roue', null, 'carte', null) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'La vie commence ! Chacun reçoit ' || hg_plat__de_euros(10000) || '.');
  perform hg_plat__donner_tour(p_id, v_premier);
end $$;

create or replace function public.hg_plat__destins_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; ph text; j jsonb; d int; v_x text; v_m bigint; c uuid;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; ph := e->>'phase';
  if (e->>'actif')::uuid is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;
  j := hg_plat__de_j(p_id, p_u);

  if p_action = 'rembourser' then
    if (j->>'prets')::int = 0 then raise exception 'Tu n''as aucun prêt.'; end if;
    if (j->>'argent')::bigint < 25000 then raise exception 'Il te faut 25 000 € pour rembourser un prêt.'; end if;
    perform hg_plat__de_set(p_id, p_u, jsonb_build_object('argent', (j->>'argent')::bigint - 25000, 'prets', (j->>'prets')::int - 1));
    perform hg_plat__log(p_id, p_u, 'pret', hg_plat__nom(p_id, p_u) || ' rembourse un prêt (' || hg_plat__de_euros(25000) || ').');
    return null;
  end if;

  if p_action = 'voie' and ph = 'depart' then
    v_x := a->>'voie';
    if v_x not in ('universite', 'carriere') then raise exception 'Choisis Université ou Carrière.'; end if;
    perform hg_plat__de_set(p_id, p_u, jsonb_build_object('voie', v_x));
    if v_x = 'universite' then
      perform hg_plat__de_set(p_id, p_u, jsonb_build_object('prets', (j->>'prets')::int + 5));
      perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' part à l''université (prêt d''études de ' || hg_plat__de_euros(100000) || ').');
      perform hg_plat__de_phase(p_id, 'tourner');
    else
      perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' commence sa carrière.');
      perform hg_plat__de_phase(p_id, 'metier', jsonb_build_object('metiers', hg_plat__de_tirer_metiers(false), 'puis', 'tourner'));
    end if;
    return null;
  elsif p_action = 'metier' and ph = 'metier' then
    v_x := a->>'metier';
    if not (e->'choix'->'metiers' ? v_x) then raise exception 'Choisis un des métiers proposés.'; end if;
    perform hg_plat__de_set(p_id, p_u, jsonb_build_object('metier', v_x, 'salaire', hg_plat__de_defaut('metiers', v_x, 'salaire')));
    perform hg_plat__log(p_id, p_u, 'metier', hg_plat__nom(p_id, p_u) || ' devient ' || hg_plat__de_metier(v_x, 'nom') || ' (' || hg_plat__de_euros(hg_plat__de_defaut('metiers', v_x, 'salaire')) || ' par jour de paie).');
    if e->'choix'->>'puis' = 'tourner' then perform hg_plat__de_phase(p_id, 'tourner'); else perform hg_plat__de_suivant(p_id); end if;
    return null;
  elsif p_action = 'tourner' and ph = 'tourner' then
    d := hg_plat__sh_d(10);
    update hg_plat_parties set etat = etat || jsonb_build_object('roue', d, 'roue2', null, 'carte', null) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'roue', hg_plat__nom(p_id, p_u) || ' fait ' || d || ' à la roue.');
    perform hg_plat__de_avancer(p_id, p_u, d);
    if not hg_plat__de_arriver(p_id, p_u) then perform hg_plat__de_suivant(p_id); end if;
    return null;
  elsif p_action = 'acheter' and ph = 'achat' then
    v_x := a->>'maison';
    if v_x is null then
      perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' n''achète rien.');
    else
      if not (e->'choix'->'maisons' ? v_x) then raise exception 'Choisis une des maisons proposées.'; end if;
      v_m := hg_plat__de_defaut('maisons', v_x, 'prix');
      perform hg_plat__de_argent(p_id, p_u, -v_m);
      perform hg_plat__de_set(p_id, p_u, jsonb_build_object('maisons', (hg_plat__de_j(p_id, p_u)->'maisons') || to_jsonb(v_x)));
      perform hg_plat__log(p_id, p_u, 'maison', hg_plat__nom(p_id, p_u) || ' achète : ' || hg_plat__n('destins', 'maisons', v_x) || ' (' || hg_plat__de_euros(v_m) || ').');
    end if;
    perform hg_plat__de_suivant(p_id);
    return null;
  elsif p_action = 'assurer' and ph = 'assurance' then
    if coalesce((a->>'habitation')::boolean, false) and not coalesce((j->>'assurance_habitation')::boolean, false) then
      perform hg_plat__de_argent(p_id, p_u, -20000);
      perform hg_plat__de_set(p_id, p_u, '{"assurance_habitation": true}');
      perform hg_plat__log(p_id, p_u, 'assurance', hg_plat__nom(p_id, p_u) || ' prend une assurance habitation (' || hg_plat__de_euros(20000) || ').');
    end if;
    if coalesce((a->>'auto')::boolean, false) and not coalesce((j->>'assurance_auto')::boolean, false) then
      perform hg_plat__de_argent(p_id, p_u, -10000);
      perform hg_plat__de_set(p_id, p_u, '{"assurance_auto": true}');
      perform hg_plat__log(p_id, p_u, 'assurance', hg_plat__nom(p_id, p_u) || ' prend une assurance auto (' || hg_plat__de_euros(10000) || ').');
    end if;
    perform hg_plat__de_suivant(p_id);
    return null;
  elsif p_action = 'voie' and ph = 'voie' then
    v_x := a->>'voie';
    if v_x not in ('famille', 'aventure') then raise exception 'Choisis Famille ou Aventure.'; end if;
    perform hg_plat__de_set(p_id, p_u, jsonb_build_object('voie2', v_x));
    perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' choisit le chemin : ' || hg_plat__n('destins', 'voies', v_x) || '.');
    perform hg_plat__de_suivant(p_id);
    return null;
  elsif p_action = 'cible' and ph = 'cible' then
    c := (a->>'cible')::uuid;
    if c is null or c = p_u or not exists (select 1 from hg_plat_joueurs where partie = p_id and user_id = c) then raise exception 'Choisis un autre joueur.'; end if;
    v_m := (e->'choix'->>'montant')::bigint;
    perform hg_plat__de_argent(p_id, c, -v_m); perform hg_plat__de_argent(p_id, p_u, v_m);
    perform hg_plat__log(p_id, p_u, 'proces', hg_plat__nom(p_id, p_u) || ' gagne son procès contre ' || hg_plat__nom(p_id, c) || ' : ' || hg_plat__de_euros(v_m) || '.');
    perform hg_plat__de_suivant(p_id);
    return null;
  elsif p_action = 'retraite' and ph = 'retraite' then
    v_x := a->>'lieu';
    if v_x not in ('maison', 'domaine') then raise exception 'Choisis la Maison de retraite ou le Domaine des millionnaires.'; end if;
    perform hg_plat__de_set(p_id, p_u, jsonb_build_object('retraite', true, 'retraite_lieu', v_x));
    if v_x = 'domaine' then
      d := hg_plat__sh_d(10);
      update hg_plat_parties set etat = etat || jsonb_build_object('roue2', d) where id = p_id;
      v_m := case when d <= 4 then -200000 when d <= 7 then 100000 else 400000 end;
      perform hg_plat__de_argent(p_id, p_u, v_m);
      perform hg_plat__de_set(p_id, p_u, jsonb_build_object('pari', d));
      perform hg_plat__log(p_id, p_u, 'retraite', hg_plat__nom(p_id, p_u) || ' tente le Domaine des millionnaires : ' || d || ' à la roue, '
        || case when v_m > 0 then '+' else '' end || hg_plat__de_euros(v_m) || '.');
    else
      perform hg_plat__log(p_id, p_u, 'retraite', hg_plat__nom(p_id, p_u) || ' prend sa retraite à la Maison de retraite.');
    end if;
    perform hg_plat__de_suivant(p_id);
    return null;
  end if;
  raise exception 'Action impossible maintenant.';
end $$;

-- Chrono écoulé : choix prudents.
create or replace function public.hg_plat__destins_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e jsonb; ph text; u uuid;
begin
  select etat into e from hg_plat_parties where id = p_id;
  ph := e->>'phase'; u := (e->>'actif')::uuid;
  if ph = 'depart' then perform hg_plat__destins_agir(p_id, u, 'voie', '{"voie": "carriere"}');
  elsif ph = 'metier' then perform hg_plat__destins_agir(p_id, u, 'metier', jsonb_build_object('metier',
    (select m from jsonb_array_elements_text(e->'choix'->'metiers') m order by hg_plat__de_defaut('metiers', m, 'salaire') desc limit 1)));
  elsif ph = 'tourner' then perform hg_plat__destins_agir(p_id, u, 'tourner', '{}');
  elsif ph = 'achat' then perform hg_plat__destins_agir(p_id, u, 'acheter', '{}');
  elsif ph = 'assurance' then perform hg_plat__destins_agir(p_id, u, 'assurer', '{}');
  elsif ph = 'voie' then perform hg_plat__destins_agir(p_id, u, 'voie', '{"voie": "famille"}');
  elsif ph = 'cible' then perform hg_plat__destins_agir(p_id, u, 'cible', jsonb_build_object('cible',
    (select user_id from hg_plat_joueurs where partie = p_id and user_id <> u order by (etat->>'argent')::bigint desc limit 1)));
  elsif ph = 'retraite' then perform hg_plat__destins_agir(p_id, u, 'retraite', '{"lieu": "maison"}');
  else return false;
  end if;
  return true;
end $$;

create or replace function public.hg_plat__destins_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  return jsonb_build_object('phase', e->>'phase', 'actif', e->'actif', 'choix', e->'choix', 'roue', e->'roue', 'roue2', e->'roue2', 'carte', e->'carte',
    'plateau', (select jsonb_agg(hg_plat__de_case(n) order by n) from generate_series(0, 90) n),
    'fortunes', (select jsonb_object_agg(user_id, hg_plat__de_fortune(etat)) from hg_plat_joueurs where partie = p_id),
    'prochaine_paie', (select jsonb_object_agg(user_id, (
        with recursive pas(i, n) as (select 0, (etat->>'case')::int union all
          select i + 1, hg_plat__de_suivante(n, case when n = 0 then etat->>'voie' else etat->>'voie2' end) from pas where i < 12 and n < 90)
        select min(i) from pas where i > 0 and hg_plat__de_case(n) = 'paie')) from hg_plat_joueurs where partie = p_id));
end $$;

create or replace function public.hg_plat__destins_badges(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id, gagne, etat from hg_plat_joueurs where partie = p_id and not invite loop
    if r.gagne then perform hg_plat__badge(r.user_id, 'plat_destins_victoire'); end if;
    if (r.etat->>'enfants')::int >= 4 then perform hg_plat__badge(r.user_id, 'plat_destins_famille'); end if;
    if (r.etat->>'fortune')::bigint > 1000000 then perform hg_plat__badge(r.user_id, 'plat_destins_millionnaire'); end if;
    if (r.etat->>'pari')::int >= 8 then perform hg_plat__badge(r.user_id, 'plat_destins_pari'); end if;
  end loop;
end $$;

select public.hg_plat__droits();
