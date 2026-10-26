-- ===== Humane Gang — migration 129 : Monopoly (moteur du jeu, sur le socle 125) =====
-- Règles officielles (plateau français, 2 à 6 joueurs, 1 500 € au départ), en version courte :
--   la partie s'arrête après la durée choisie (45, 60 ou 90 minutes, à la fin d'un tour) ; le plus riche gagne
--   (argent + prix des terrains, la moitié s'ils sont hypothéqués + prix des maisons et hôtels).
--   Elle s'arrête aussi s'il ne reste qu'un joueur non ruiné.
-- Simplification : pas d'enchères quand un joueur refuse d'acheter (le terrain reste à la banque).
-- Le reste est conforme : doubles (rejouer, 3 doubles → prison), loyers doublés sur un groupe complet nu, maisons et hôtels
--   construits de façon égale, gares, compagnies, hypothèques (+10 % pour lever), prison (50 €, carte, ou doubles en 3 essais),
--   cartes Chance et Caisse de communauté, échanges entre joueurs (argent, terrains, cartes « Sortie de prison »), faillite.
-- Cases : 0 à 39 ; identifiants des contenus 'c0'…'c39'. Phases (etat.phase) : lancer → (achat) → gestion → joueur suivant ;
--   dette (le joueur doit trouver l'argent ou faire faillite).

/* ---------- Contenus paramétrables ---------- */
insert into public.hg_plat_contenus(jeu, cle, libelle, valeur, defaut, sort)
select 'monopoly', c.cle, c.libelle, c.v, c.v, c.sort from (values
  ('nom', 'Nom du jeu', to_jsonb('Monopoly'::text), 1),
  ('monnaie', 'Monnaie', to_jsonb('€'::text), 2),
  ('groupes', 'Groupes de couleur', '[
    {"id":"brun","nom":"Marron","couleur":"#8B5A3C"},{"id":"ciel","nom":"Bleu ciel","couleur":"#AEDCF0"},
    {"id":"rose","nom":"Rose","couleur":"#D93A96"},{"id":"orange","nom":"Orange","couleur":"#F7941D"},
    {"id":"rouge","nom":"Rouge","couleur":"#ED1B24"},{"id":"jaune","nom":"Jaune","couleur":"#FEF200"},
    {"id":"vert","nom":"Vert","couleur":"#1FB25A"},{"id":"bleu","nom":"Bleu foncé","couleur":"#0072BB"}]'::jsonb, 3),
  ('cases', 'Cases du plateau', '[
    {"id":"c0","nom":"Départ"},{"id":"c1","nom":"Boulevard de Belleville"},{"id":"c2","nom":"Caisse de communauté"},
    {"id":"c3","nom":"Rue Lecourbe"},{"id":"c4","nom":"Impôts sur le revenu"},{"id":"c5","nom":"Gare Montparnasse"},
    {"id":"c6","nom":"Rue de Vaugirard"},{"id":"c7","nom":"Chance"},{"id":"c8","nom":"Rue de Courcelles"},
    {"id":"c9","nom":"Avenue de la République"},{"id":"c10","nom":"Prison"},{"id":"c11","nom":"Boulevard de la Villette"},
    {"id":"c12","nom":"Compagnie de distribution d''électricité"},{"id":"c13","nom":"Avenue de Neuilly"},{"id":"c14","nom":"Rue de Paradis"},
    {"id":"c15","nom":"Gare de Lyon"},{"id":"c16","nom":"Avenue Mozart"},{"id":"c17","nom":"Caisse de communauté"},
    {"id":"c18","nom":"Boulevard Saint-Michel"},{"id":"c19","nom":"Place Pigalle"},{"id":"c20","nom":"Parc gratuit"},
    {"id":"c21","nom":"Avenue Matignon"},{"id":"c22","nom":"Chance"},{"id":"c23","nom":"Boulevard Malesherbes"},
    {"id":"c24","nom":"Avenue Henri-Martin"},{"id":"c25","nom":"Gare du Nord"},{"id":"c26","nom":"Faubourg Saint-Honoré"},
    {"id":"c27","nom":"Place de la Bourse"},{"id":"c28","nom":"Compagnie de distribution des eaux"},{"id":"c29","nom":"Rue La Fayette"},
    {"id":"c30","nom":"Allez en prison"},{"id":"c31","nom":"Avenue de Breteuil"},{"id":"c32","nom":"Avenue Foch"},
    {"id":"c33","nom":"Caisse de communauté"},{"id":"c34","nom":"Boulevard des Capucines"},{"id":"c35","nom":"Gare Saint-Lazare"},
    {"id":"c36","nom":"Chance"},{"id":"c37","nom":"Avenue des Champs-Élysées"},{"id":"c38","nom":"Taxe de luxe"},
    {"id":"c39","nom":"Rue de la Paix"}]'::jsonb, 4),
  ('chance', 'Cartes Chance', '[
    {"id":"ch1","texte":"Avancez jusqu''à la case Départ."},
    {"id":"ch2","texte":"Rendez-vous à l''Avenue Henri-Martin. Si vous passez par la case Départ, recevez 200 €."},
    {"id":"ch3","texte":"Avancez au Boulevard de la Villette. Si vous passez par la case Départ, recevez 200 €."},
    {"id":"ch4","texte":"Rendez-vous Rue de la Paix."},
    {"id":"ch5","texte":"Allez à la Gare de Lyon. Si vous passez par la case Départ, recevez 200 €."},
    {"id":"ch6","texte":"Reculez de trois cases."},
    {"id":"ch7","texte":"Allez en prison. Ne passez pas par la case Départ, ne recevez pas 200 €."},
    {"id":"ch8","texte":"Vous êtes libéré de prison. Cette carte peut être conservée."},
    {"id":"ch9","texte":"La banque vous verse un dividende de 50 €."},
    {"id":"ch10","texte":"Votre immeuble et votre prêt rapportent. Recevez 150 €."},
    {"id":"ch11","texte":"Vous avez gagné le prix de mots croisés. Recevez 100 €."},
    {"id":"ch12","texte":"Amende pour excès de vitesse : 15 €."},
    {"id":"ch13","texte":"Payez pour frais de scolarité : 150 €."},
    {"id":"ch14","texte":"Amende pour ivresse : 20 €."},
    {"id":"ch15","texte":"Faites des réparations dans toutes vos maisons : 25 € par maison, 100 € par hôtel."},
    {"id":"ch16","texte":"Réparations de voirie : 40 € par maison, 115 € par hôtel."}]'::jsonb, 5),
  ('caisse', 'Cartes Caisse de communauté', '[
    {"id":"cc1","texte":"Avancez jusqu''à la case Départ."},
    {"id":"cc2","texte":"Erreur de la banque en votre faveur. Recevez 200 €."},
    {"id":"cc3","texte":"Payez la note du médecin : 50 €."},
    {"id":"cc4","texte":"La vente de votre stock vous rapporte 50 €."},
    {"id":"cc5","texte":"Vous êtes libéré de prison. Cette carte peut être conservée."},
    {"id":"cc6","texte":"Allez en prison. Ne passez pas par la case Départ, ne recevez pas 200 €."},
    {"id":"cc7","texte":"Retournez au Boulevard de Belleville."},
    {"id":"cc8","texte":"Recevez votre revenu annuel : 100 €."},
    {"id":"cc9","texte":"C''est votre anniversaire : chaque joueur vous donne 10 €."},
    {"id":"cc10","texte":"Recevez votre intérêt sur l''emprunt à 7 % : 25 €."},
    {"id":"cc11","texte":"Payez l''hôpital : 100 €."},
    {"id":"cc12","texte":"Vous héritez de 100 €."},
    {"id":"cc13","texte":"Payez votre police d''assurance : 50 €."},
    {"id":"cc14","texte":"Vous avez gagné le deuxième prix de beauté. Recevez 10 €."},
    {"id":"cc15","texte":"Les contributions vous remboursent 20 €."},
    {"id":"cc16","texte":"Payez une amende de 10 €."}]'::jsonb, 6),
  ('pions', 'Pions', '[
    {"id":"voiture","nom":"Voiture"},{"id":"chien","nom":"Chien"},{"id":"chapeau","nom":"Chapeau"},
    {"id":"bateau","nom":"Bateau"},{"id":"fer","nom":"Fer à repasser"},{"id":"de","nom":"Dé à coudre"}]'::jsonb, 7)
) c(cle, libelle, v, sort)
on conflict (jeu, cle) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('plat_monopoly_victoire', 'Magnat', 'Gagner une partie de Monopoly.', 1030),
  ('plat_monopoly_hotel', 'Hôtelier', 'Construire un hôtel au Monopoly.', 1031),
  ('plat_monopoly_paix', 'Rue de la Paix', 'Posséder la Rue de la Paix et l''Avenue des Champs-Élysées à la fin d''une partie.', 1032),
  ('plat_monopoly_ruine', 'Banqueroute', 'Faire faillite au Monopoly.', 1033)
on conflict (code) do nothing;

/* ---------- Plateau (règles fixes) ---------- */

-- Données d'une case : type (rue, gare, compagnie, depart, caisse, chance, impot, prison, parc, allez_prison), groupe, prix, loyers, prix d'une maison.
create or replace function public.hg_plat__mo_case(n int)
returns jsonb language sql immutable as $$
  select case n
    when 0 then '{"type":"depart"}'
    when 1 then '{"type":"rue","groupe":"brun","prix":60,"loyers":[2,10,30,90,160,250],"maison":50}'
    when 2 then '{"type":"caisse"}'
    when 3 then '{"type":"rue","groupe":"brun","prix":60,"loyers":[4,20,60,180,320,450],"maison":50}'
    when 4 then '{"type":"impot","montant":200}'
    when 5 then '{"type":"gare","prix":200}'
    when 6 then '{"type":"rue","groupe":"ciel","prix":100,"loyers":[6,30,90,270,400,550],"maison":50}'
    when 7 then '{"type":"chance"}'
    when 8 then '{"type":"rue","groupe":"ciel","prix":100,"loyers":[6,30,90,270,400,550],"maison":50}'
    when 9 then '{"type":"rue","groupe":"ciel","prix":120,"loyers":[8,40,100,300,450,600],"maison":50}'
    when 10 then '{"type":"prison"}'
    when 11 then '{"type":"rue","groupe":"rose","prix":140,"loyers":[10,50,150,450,625,750],"maison":100}'
    when 12 then '{"type":"compagnie","prix":150}'
    when 13 then '{"type":"rue","groupe":"rose","prix":140,"loyers":[10,50,150,450,625,750],"maison":100}'
    when 14 then '{"type":"rue","groupe":"rose","prix":160,"loyers":[12,60,180,500,700,900],"maison":100}'
    when 15 then '{"type":"gare","prix":200}'
    when 16 then '{"type":"rue","groupe":"orange","prix":180,"loyers":[14,70,200,550,750,950],"maison":100}'
    when 17 then '{"type":"caisse"}'
    when 18 then '{"type":"rue","groupe":"orange","prix":180,"loyers":[14,70,200,550,750,950],"maison":100}'
    when 19 then '{"type":"rue","groupe":"orange","prix":200,"loyers":[16,80,220,600,800,1000],"maison":100}'
    when 20 then '{"type":"parc"}'
    when 21 then '{"type":"rue","groupe":"rouge","prix":220,"loyers":[18,90,250,700,875,1050],"maison":150}'
    when 22 then '{"type":"chance"}'
    when 23 then '{"type":"rue","groupe":"rouge","prix":220,"loyers":[18,90,250,700,875,1050],"maison":150}'
    when 24 then '{"type":"rue","groupe":"rouge","prix":240,"loyers":[20,100,300,750,925,1100],"maison":150}'
    when 25 then '{"type":"gare","prix":200}'
    when 26 then '{"type":"rue","groupe":"jaune","prix":260,"loyers":[22,110,330,800,975,1150],"maison":150}'
    when 27 then '{"type":"rue","groupe":"jaune","prix":260,"loyers":[22,110,330,800,975,1150],"maison":150}'
    when 28 then '{"type":"compagnie","prix":150}'
    when 29 then '{"type":"rue","groupe":"jaune","prix":280,"loyers":[24,120,360,850,1025,1200],"maison":150}'
    when 30 then '{"type":"allez_prison"}'
    when 31 then '{"type":"rue","groupe":"vert","prix":300,"loyers":[26,130,390,900,1100,1275],"maison":200}'
    when 32 then '{"type":"rue","groupe":"vert","prix":300,"loyers":[26,130,390,900,1100,1275],"maison":200}'
    when 33 then '{"type":"caisse"}'
    when 34 then '{"type":"rue","groupe":"vert","prix":320,"loyers":[28,150,450,1000,1200,1400],"maison":200}'
    when 35 then '{"type":"gare","prix":200}'
    when 36 then '{"type":"chance"}'
    when 37 then '{"type":"rue","groupe":"bleu","prix":350,"loyers":[35,175,500,1100,1300,1500],"maison":200}'
    when 38 then '{"type":"impot","montant":100}'
    when 39 then '{"type":"rue","groupe":"bleu","prix":400,"loyers":[50,200,600,1400,1700,2000],"maison":200}'
  end::jsonb
$$;

/* ---------- Outils ---------- */

create or replace function public.hg_plat__mo_j(p_id uuid, p_u uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select etat from hg_plat_joueurs where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__mo_set(p_id uuid, p_u uuid, p jsonb)
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set etat = etat || p where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__mo_nom(n int)
returns text language sql stable security definer set search_path = public as $$ select hg_plat__n('monopoly', 'cases', 'c' || n) $$;
create or replace function public.hg_plat__mo_e(n bigint)
returns text language sql stable security definer set search_path = public as $$
  select trim(replace(to_char(n, 'FM999G999G990'), ',', ' ')) || ' ' || coalesce(hg_plat__c('monopoly', 'monnaie') #>> '{}', '€')
$$;
-- Titre de propriété d'une case (null si à la banque).
create or replace function public.hg_plat__mo_p(p_id uuid, n int)
returns jsonb language sql stable security definer set search_path = public as $$
  select etat->'proprietes'->(n::text) from hg_plat_parties where id = p_id
$$;
create or replace function public.hg_plat__mo_setp(p_id uuid, n int, p jsonb)
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set etat = jsonb_set(etat, array['proprietes', n::text], case when p is null then 'null'::jsonb else coalesce(etat->'proprietes'->(n::text), '{}') || p end) where id = p_id
$$;
create or replace function public.hg_plat__mo_cases_groupe(p_groupe text)
returns int[] language sql immutable as $$
  select array_agg(n) from generate_series(0, 39) n where hg_plat__mo_case(n)->>'groupe' = p_groupe
$$;
create or replace function public.hg_plat__mo_proprio(p_id uuid, n int)
returns uuid language sql stable security definer set search_path = public as $$ select (hg_plat__mo_p(p_id, n)->>'proprio')::uuid $$;
-- Le joueur possède tout le groupe.
create or replace function public.hg_plat__mo_monopole(p_id uuid, p_u uuid, p_groupe text)
returns boolean language sql stable security definer set search_path = public as $$
  select bool_and(hg_plat__mo_proprio(p_id, n) is not distinct from p_u) from unnest(hg_plat__mo_cases_groupe(p_groupe)) n
$$;
create or replace function public.hg_plat__mo_nb(p_id uuid, p_u uuid, p_type text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(0, 39) n where hg_plat__mo_case(n)->>'type' = p_type and hg_plat__mo_proprio(p_id, n) = p_u
$$;

-- Argent : + ou − ; peut devenir négatif (la dette est réglée ensuite).
create or replace function public.hg_plat__mo_argent(p_id uuid, p_u uuid, n bigint)
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set etat = jsonb_set(etat, '{argent}', to_jsonb((etat->>'argent')::bigint + n)) where partie = p_id and user_id = p_u
$$;

-- Valeur de revente possible (maisons à moitié prix + hypothèques) : pour savoir si une dette peut être couverte.
create or replace function public.hg_plat__mo_liquidite(p_id uuid, p_u uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when coalesce((hg_plat__mo_p(p_id, n)->>'hypotheque')::boolean, false) then 0
    else (hg_plat__mo_case(n)->>'prix')::int / 2 + coalesce((hg_plat__mo_p(p_id, n)->>'maisons')::int, 0) * coalesce((hg_plat__mo_case(n)->>'maison')::int, 0) / 2 end), 0)
  from generate_series(0, 39) n where hg_plat__mo_proprio(p_id, n) = p_u
$$;

-- Fortune pour le classement final.
create or replace function public.hg_plat__mo_fortune(p_id uuid, p_u uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint + coalesce((select sum(
      case when coalesce((hg_plat__mo_p(p_id, n)->>'hypotheque')::boolean, false) then (hg_plat__mo_case(n)->>'prix')::int / 2 else (hg_plat__mo_case(n)->>'prix')::int end
      + coalesce((hg_plat__mo_p(p_id, n)->>'maisons')::int, 0) * coalesce((hg_plat__mo_case(n)->>'maison')::int, 0))
    from generate_series(0, 39) n where hg_plat__mo_proprio(p_id, n) = p_u), 0)
$$;

-- Vend maisons puis hypothèque jusqu'à revenir à 0 (jeu automatique et joueurs absents).
create or replace function public.hg_plat__mo_liquider(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; c jsonb;
begin
  while (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint < 0 loop
    select x into n from generate_series(0, 39) x where hg_plat__mo_proprio(p_id, x) = p_u and coalesce((hg_plat__mo_p(p_id, x)->>'maisons')::int, 0) > 0
      order by (hg_plat__mo_p(p_id, x)->>'maisons')::int desc, x desc limit 1;
    if n is not null then
      c := hg_plat__mo_case(n);
      perform hg_plat__mo_setp(p_id, n, jsonb_build_object('maisons', (hg_plat__mo_p(p_id, n)->>'maisons')::int - 1));
      perform hg_plat__mo_argent(p_id, p_u, (c->>'maison')::int / 2);
      continue;
    end if;
    select x into n from generate_series(0, 39) x where hg_plat__mo_proprio(p_id, x) = p_u and not coalesce((hg_plat__mo_p(p_id, x)->>'hypotheque')::boolean, false)
      order by x limit 1;
    exit when n is null;
    perform hg_plat__mo_setp(p_id, n, '{"hypotheque": true}');
    perform hg_plat__mo_argent(p_id, p_u, (hg_plat__mo_case(n)->>'prix')::int / 2);
    perform hg_plat__log(p_id, p_u, 'hypotheque', hg_plat__nom(p_id, p_u) || ' hypothèque : ' || hg_plat__mo_nom(n) || '.');
  end loop;
end $$;

-- Faillite : biens au créancier (ou à la banque), sa dette non couverte est perdue pour le créancier.
create or replace function public.hg_plat__mo_faillite(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_cr uuid; v_a bigint; n int;
begin
  select etat into e from hg_plat_parties where id = p_id;
  v_cr := (e->'dette'->>'creancier')::uuid;
  if (e->'dette'->>'debiteur')::uuid is distinct from p_u then v_cr := null; end if;
  v_a := (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint;
  if v_cr is not null then
    if v_a < 0 then perform hg_plat__mo_argent(p_id, v_cr, v_a); end if;
    if v_a > 0 then perform hg_plat__mo_argent(p_id, v_cr, v_a); end if;
    for n in select x from generate_series(0, 39) x where hg_plat__mo_proprio(p_id, x) = p_u loop
      perform hg_plat__mo_argent(p_id, v_cr, coalesce((hg_plat__mo_p(p_id, n)->>'maisons')::int, 0) * coalesce((hg_plat__mo_case(n)->>'maison')::int, 0) / 2);
      perform hg_plat__mo_setp(p_id, n, jsonb_build_object('proprio', v_cr, 'maisons', 0));
    end loop;
    perform hg_plat__mo_set(p_id, v_cr, jsonb_build_object('cartes_sortie', (hg_plat__mo_j(p_id, v_cr)->>'cartes_sortie')::int + (hg_plat__mo_j(p_id, p_u)->>'cartes_sortie')::int));
  else
    for n in select x from generate_series(0, 39) x where hg_plat__mo_proprio(p_id, x) = p_u loop perform hg_plat__mo_setp(p_id, n, null); end loop;
  end if;
  perform hg_plat__mo_set(p_id, p_u, '{"argent": 0, "faillite": true, "cartes_sortie": 0}');
  update hg_plat_joueurs set elimine = true where partie = p_id and user_id = p_u;
  update hg_plat_parties set etat = etat || jsonb_build_object('dette', null, 'offre', null) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'faillite', hg_plat__nom(p_id, p_u) || ' fait faillite' || case when v_cr is null then '.' else ' : ses biens vont à ' || hg_plat__nom(p_id, v_cr) || '.' end);
end $$;

-- Paiement. p_cr null = la banque. Un joueur qui n'est pas en train de jouer règle tout de suite (vente automatique) ;
-- le joueur actif à découvert passe en phase dette.
create or replace function public.hg_plat__mo_payer(p_id uuid, p_u uuid, n bigint, p_cr uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if n <= 0 then return; end if;
  perform hg_plat__mo_argent(p_id, p_u, -n);
  if p_cr is not null then perform hg_plat__mo_argent(p_id, p_cr, n); end if;
  if (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint >= 0 then return; end if;
  select etat into e from hg_plat_parties where id = p_id;
  if (e->>'actif')::uuid = p_u then
    update hg_plat_parties set etat = etat || jsonb_build_object('dette', jsonb_build_object('debiteur', p_u, 'creancier', p_cr, 'retour', e->>'phase'), 'phase', 'dette') where id = p_id;
    perform hg_plat__log(p_id, p_u, 'dette', hg_plat__nom(p_id, p_u) || ' est à découvert : il doit vendre, hypothéquer ou échanger.');
  else
    perform hg_plat__mo_liquider(p_id, p_u);
    if (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint < 0 then
      update hg_plat_parties set etat = etat || jsonb_build_object('dette', jsonb_build_object('debiteur', p_u, 'creancier', p_cr)) where id = p_id;
      perform hg_plat__mo_faillite(p_id, p_u);
      update hg_plat_parties set etat = etat || jsonb_build_object('dette', null) where id = p_id;
    end if;
  end if;
end $$;

create or replace function public.hg_plat__mo_prison(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hg_plat__mo_set(p_id, p_u, '{"pos": 10, "prison": true, "essais": 0}');
  update hg_plat_parties set etat = etat || '{"rejouer": false}' where id = p_id;
  perform hg_plat__log(p_id, p_u, 'prison', hg_plat__nom(p_id, p_u) || ' va en prison.');
end $$;

-- Déplacement vers une case (p_depart : toucher 200 en passant par Départ).
create or replace function public.hg_plat__mo_aller(p_id uuid, p_u uuid, p_case int, p_depart boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_pos int;
begin
  v_pos := (hg_plat__mo_j(p_id, p_u)->>'pos')::int;
  if p_depart and p_case < v_pos then
    perform hg_plat__mo_argent(p_id, p_u, 200);
    perform hg_plat__log(p_id, p_u, 'depart', hg_plat__nom(p_id, p_u) || ' passe par la case Départ : +' || hg_plat__mo_e(200) || '.');
  end if;
  perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('pos', p_case));
end $$;

-- Loyer dû sur une case (p_des : total des dés pour les compagnies).
create or replace function public.hg_plat__mo_loyer(p_id uuid, n int, p_des int)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare c jsonb; p jsonb; v_u uuid; v_m int; v_k int;
begin
  c := hg_plat__mo_case(n); p := hg_plat__mo_p(p_id, n); v_u := (p->>'proprio')::uuid;
  if v_u is null or coalesce((p->>'hypotheque')::boolean, false) then return 0; end if;
  if c->>'type' = 'rue' then
    v_m := coalesce((p->>'maisons')::int, 0);
    if v_m = 0 and hg_plat__mo_monopole(p_id, v_u, c->>'groupe') then return 2 * (c->'loyers'->>0)::int; end if;
    return (c->'loyers'->>v_m)::int;
  elsif c->>'type' = 'gare' then
    v_k := hg_plat__mo_nb(p_id, v_u, 'gare');
    return 25 * power(2, v_k - 1)::int;
  elsif c->>'type' = 'compagnie' then
    v_k := hg_plat__mo_nb(p_id, v_u, 'compagnie');
    return p_des * case when v_k = 2 then 10 else 4 end;
  end if;
  return 0;
end $$;

-- Effet d'une carte.
create or replace function public.hg_plat__mo_carte(p_id uuid, p_u uuid, p_pioche text)
returns boolean language plpgsql security definer set search_path = public as $$
declare s jsonb; v_id text; v_texte text; v_m int; v_h int; r record; v_pos int;
begin
  select secret into s from hg_plat_parties where id = p_id for update;
  if jsonb_array_length(coalesce(s->p_pioche, '[]')) = 0 then
    s := jsonb_set(s, array[p_pioche], (select jsonb_agg(x->>'id' order by random()) from jsonb_array_elements(hg_plat__c('monopoly', p_pioche)) x
      where not exists (select 1 from hg_plat_joueurs j where j.partie = p_id and j.prive->'cartes_gardees' ? (x->>'id'))));
  end if;
  v_id := s->p_pioche->>0;
  s := jsonb_set(s, array[p_pioche], (s->p_pioche) - 0);
  update hg_plat_parties set secret = s where id = p_id;
  v_texte := (select x->>'texte' from jsonb_array_elements(hg_plat__c('monopoly', p_pioche)) x where x->>'id' = v_id);
  update hg_plat_parties set etat = etat || jsonb_build_object('carte', jsonb_build_object('pioche', p_pioche, 'id', v_id, 'texte', v_texte, 'pour', p_u)) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'carte', hg_plat__nom(p_id, p_u) || ' tire une carte ' || case when p_pioche = 'chance' then 'Chance' else 'Caisse de communauté' end || ' : « ' || v_texte || ' »');
  v_pos := (hg_plat__mo_j(p_id, p_u)->>'pos')::int;
  case v_id
    when 'ch1' then perform hg_plat__mo_aller(p_id, p_u, 0); perform hg_plat__mo_argent(p_id, p_u, 200);
    when 'cc1' then perform hg_plat__mo_aller(p_id, p_u, 0); perform hg_plat__mo_argent(p_id, p_u, 200);
    when 'ch2' then perform hg_plat__mo_aller(p_id, p_u, 24); return true;
    when 'ch3' then perform hg_plat__mo_aller(p_id, p_u, 11); return true;
    when 'ch4' then perform hg_plat__mo_aller(p_id, p_u, 39); return true;
    when 'ch5' then perform hg_plat__mo_aller(p_id, p_u, 15); return true;
    when 'ch6' then perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('pos', (v_pos + 37) % 40)); return true;
    when 'cc7' then perform hg_plat__mo_aller(p_id, p_u, 1, false); return true;
    when 'ch7' then perform hg_plat__mo_prison(p_id, p_u);
    when 'cc6' then perform hg_plat__mo_prison(p_id, p_u);
    when 'ch8' then
      perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('cartes_sortie', (hg_plat__mo_j(p_id, p_u)->>'cartes_sortie')::int + 1));
      update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes_gardees}', coalesce(prive->'cartes_gardees', '[]') || to_jsonb(v_id)) where partie = p_id and user_id = p_u;
    when 'cc5' then
      perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('cartes_sortie', (hg_plat__mo_j(p_id, p_u)->>'cartes_sortie')::int + 1));
      update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes_gardees}', coalesce(prive->'cartes_gardees', '[]') || to_jsonb(v_id)) where partie = p_id and user_id = p_u;
    when 'ch9' then perform hg_plat__mo_argent(p_id, p_u, 50);
    when 'ch10' then perform hg_plat__mo_argent(p_id, p_u, 150);
    when 'ch11' then perform hg_plat__mo_argent(p_id, p_u, 100);
    when 'ch12' then perform hg_plat__mo_payer(p_id, p_u, 15);
    when 'ch13' then perform hg_plat__mo_payer(p_id, p_u, 150);
    when 'ch14' then perform hg_plat__mo_payer(p_id, p_u, 20);
    when 'ch15', 'ch16' then
      select coalesce(sum(case when (hg_plat__mo_p(p_id, n)->>'maisons')::int between 1 and 4 then (hg_plat__mo_p(p_id, n)->>'maisons')::int else 0 end), 0),
             count(*) filter (where (hg_plat__mo_p(p_id, n)->>'maisons')::int = 5)
        into v_m, v_h from generate_series(0, 39) n where hg_plat__mo_proprio(p_id, n) = p_u;
      perform hg_plat__mo_payer(p_id, p_u, case when v_id = 'ch15' then 25 * v_m + 100 * v_h else 40 * v_m + 115 * v_h end);
    when 'cc2' then perform hg_plat__mo_argent(p_id, p_u, 200);
    when 'cc3' then perform hg_plat__mo_payer(p_id, p_u, 50);
    when 'cc4' then perform hg_plat__mo_argent(p_id, p_u, 50);
    when 'cc8' then perform hg_plat__mo_argent(p_id, p_u, 100);
    when 'cc9' then
      for r in select user_id from hg_plat_joueurs where partie = p_id and user_id <> p_u and not elimine order by place loop
        perform hg_plat__mo_payer(p_id, r.user_id, 10, p_u);
      end loop;
    when 'cc10' then perform hg_plat__mo_argent(p_id, p_u, 25);
    when 'cc11' then perform hg_plat__mo_payer(p_id, p_u, 100);
    when 'cc12' then perform hg_plat__mo_argent(p_id, p_u, 100);
    when 'cc13' then perform hg_plat__mo_payer(p_id, p_u, 50);
    when 'cc14' then perform hg_plat__mo_argent(p_id, p_u, 10);
    when 'cc15' then perform hg_plat__mo_argent(p_id, p_u, 20);
    when 'cc16' then perform hg_plat__mo_payer(p_id, p_u, 10);
    else null;
  end case;
  return false;
end $$;

-- Arrivée sur la case courante. Renvoie la phase suivante ('achat', 'gestion', 'dette').
create or replace function public.hg_plat__mo_arriver(p_id uuid, p_u uuid, p_des int)
returns text language plpgsql security definer set search_path = public as $$
declare n int; c jsonb; v_pr uuid; v_l bigint; v_bouge boolean; i int := 0;
begin
  loop
    n := (hg_plat__mo_j(p_id, p_u)->>'pos')::int; c := hg_plat__mo_case(n);
    perform hg_plat__log(p_id, p_u, 'case', hg_plat__nom(p_id, p_u) || ' arrive sur : ' || hg_plat__mo_nom(n) || '.');
    v_bouge := false;
    if c->>'type' in ('rue', 'gare', 'compagnie') then
      v_pr := hg_plat__mo_proprio(p_id, n);
      if v_pr is null then return 'achat';
      elsif v_pr <> p_u then
        v_l := hg_plat__mo_loyer(p_id, n, p_des);
        if v_l > 0 then
          perform hg_plat__log(p_id, p_u, 'loyer', hg_plat__nom(p_id, p_u) || ' paie ' || hg_plat__mo_e(v_l) || ' de loyer à ' || hg_plat__nom(p_id, v_pr) || '.');
          perform hg_plat__mo_payer(p_id, p_u, v_l, v_pr);
        end if;
      end if;
    elsif c->>'type' = 'impot' then
      perform hg_plat__log(p_id, p_u, 'impot', hg_plat__nom(p_id, p_u) || ' paie ' || hg_plat__mo_e((c->>'montant')::int) || '.');
      perform hg_plat__mo_payer(p_id, p_u, (c->>'montant')::int);
    elsif c->>'type' = 'allez_prison' then perform hg_plat__mo_prison(p_id, p_u);
    elsif c->>'type' in ('chance', 'caisse') then v_bouge := hg_plat__mo_carte(p_id, p_u, c->>'type');
    end if;
    i := i + 1;
    exit when not v_bouge or i > 3;
  end loop;
  return case when (select etat->>'phase' from hg_plat_parties where id = p_id) = 'dette' then 'dette' else 'gestion' end;
end $$;

-- Fin de la partie (classement par fortune).
create or replace function public.hg_plat__mo_finir_partie(p_id uuid, p_raison text)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_max bigint; v_g uuid[];
begin
  for r in select user_id from hg_plat_joueurs where partie = p_id loop
    perform hg_plat__mo_set(p_id, r.user_id, jsonb_build_object('fortune', hg_plat__mo_fortune(p_id, r.user_id)));
  end loop;
  with c as (select user_id, rank() over (order by elimine, (etat->>'fortune')::bigint desc) rg from hg_plat_joueurs where partie = p_id)
  update hg_plat_joueurs j set rang = c.rg from c where j.partie = p_id and j.user_id = c.user_id;
  select max((etat->>'fortune')::bigint) into v_max from hg_plat_joueurs where partie = p_id and not elimine;
  select array_agg(user_id) into v_g from hg_plat_joueurs where partie = p_id and not elimine and (etat->>'fortune')::bigint = v_max;
  perform hg_plat__terminer(p_id, v_g, p_raison);
end $$;

-- Joueur suivant (ou le même après un double). Vérifie la fin de partie.
create or replace function public.hg_plat__mo_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_actif uuid; v_suiv uuid; v_n int;
begin
  select * into p from hg_plat_parties where id = p_id;
  v_actif := (p.etat->>'actif')::uuid;
  select count(*) into v_n from hg_plat_joueurs where partie = p_id and not elimine;
  if v_n <= 1 then perform hg_plat__mo_finir_partie(p_id, 'ruine'); return; end if;
  if coalesce((p.etat->>'rejouer')::boolean, false) and hg_plat__mo_vivant(p_id, v_actif) then
    update hg_plat_parties set etat = etat || '{"phase": "lancer", "rejouer": false, "carte": null}' where id = p_id;
    perform hg_plat__donner_tour(p_id, v_actif);
    return;
  end if;
  if p.started_at + make_interval(mins => coalesce((p.options->>'duree')::int, 60)) <= now() then
    perform hg_plat__log(p_id, null, 'info', 'Le temps est écoulé : on compte les fortunes !');
    perform hg_plat__mo_finir_partie(p_id, 'temps');
    return;
  end if;
  v_suiv := hg_plat__suivant(p_id, v_actif);
  update hg_plat_parties set nb_tours = nb_tours + 1,
    etat = etat || jsonb_build_object('actif', v_suiv, 'phase', 'lancer', 'doubles', 0, 'rejouer', false, 'carte', null, 'offre', null) where id = p_id;
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

create or replace function public.hg_plat__mo_vivant(p_id uuid, p_u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not elimine from hg_plat_joueurs where partie = p_id and user_id = p_u), false)
$$;

-- Lance les dés et joue le déplacement.
create or replace function public.hg_plat__mo_lancer(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j jsonb; d1 int; d2 int; v_doubles int; v_pos int; v_ph text;
begin
  j := hg_plat__mo_j(p_id, p_u);
  d1 := hg_plat__sh_d(6); d2 := hg_plat__sh_d(6);
  update hg_plat_parties set etat = etat || jsonb_build_object('des', jsonb_build_array(d1, d2), 'carte', null) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'des', hg_plat__nom(p_id, p_u) || ' lance les dés : ' || d1 || ' et ' || d2 || '.');
  if coalesce((j->>'prison')::boolean, false) then
    if d1 = d2 then
      perform hg_plat__mo_set(p_id, p_u, '{"prison": false, "essais": 0}');
      perform hg_plat__log(p_id, p_u, 'prison', 'Un double : ' || hg_plat__nom(p_id, p_u) || ' sort de prison.');
    elsif (j->>'essais')::int >= 2 then
      perform hg_plat__mo_set(p_id, p_u, '{"prison": false, "essais": 0}');
      perform hg_plat__log(p_id, p_u, 'prison', hg_plat__nom(p_id, p_u) || ' paie ' || hg_plat__mo_e(50) || ' et sort de prison.');
      perform hg_plat__mo_payer(p_id, p_u, 50);
      if (select etat->>'phase' from hg_plat_parties where id = p_id) = 'dette' then
        update hg_plat_parties set etat = jsonb_set(etat, '{dette,retour}', '"lancer_sortie"') where id = p_id;
        update hg_plat_parties set etat = jsonb_set(etat, '{des_sortie}', to_jsonb(d1 + d2)) where id = p_id;
        return;
      end if;
    else
      perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('essais', (j->>'essais')::int + 1));
      update hg_plat_parties set etat = etat || '{"phase": "gestion"}' where id = p_id;
      return;
    end if;
    -- On sort de prison : on avance du total, sans rejouer.
    v_pos := ((hg_plat__mo_j(p_id, p_u)->>'pos')::int + d1 + d2) % 40;
    perform hg_plat__mo_aller(p_id, p_u, v_pos);
    v_ph := hg_plat__mo_arriver(p_id, p_u, d1 + d2);
    update hg_plat_parties set etat = etat || jsonb_build_object('phase', v_ph) where id = p_id;
    return;
  end if;
  v_doubles := coalesce((select (etat->>'doubles')::int from hg_plat_parties where id = p_id), 0) + case when d1 = d2 then 1 else 0 end;
  if d1 = d2 and v_doubles >= 3 then
    perform hg_plat__log(p_id, p_u, 'prison', 'Trois doubles de suite !');
    perform hg_plat__mo_prison(p_id, p_u);
    update hg_plat_parties set etat = etat || '{"phase": "gestion", "doubles": 0}' where id = p_id;
    return;
  end if;
  update hg_plat_parties set etat = etat || jsonb_build_object('doubles', v_doubles, 'rejouer', d1 = d2) where id = p_id;
  v_pos := ((j->>'pos')::int + d1 + d2) % 40;
  perform hg_plat__mo_aller(p_id, p_u, v_pos);
  v_ph := hg_plat__mo_arriver(p_id, p_u, d1 + d2);
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', v_ph) where id = p_id;
end $$;

-- Échange : vérifie qu'un côté possède bien ce qu'il propose.
create or replace function public.hg_plat__mo_verifier_lot(p_id uuid, p_u uuid, l jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(l) <> 'object' then raise exception 'Proposition d''échange invalide.'; end if;
  if coalesce((l->>'argent')::bigint, 0) < 0 then raise exception 'Montant invalide.'; end if;
  if coalesce((l->>'argent')::bigint, 0) > (hg_plat__mo_j(p_id, p_u)->>'argent')::bigint then raise exception '% n''a pas assez d''argent.', hg_plat__nom(p_id, p_u); end if;
  if coalesce((l->>'cartes')::int, 0) > (hg_plat__mo_j(p_id, p_u)->>'cartes_sortie')::int then raise exception 'Carte « Sortie de prison » manquante.'; end if;
  for n in select x::int from jsonb_array_elements_text(coalesce(l->'proprietes', '[]')) x loop
    if hg_plat__mo_proprio(p_id, n) is distinct from p_u then raise exception '% n''appartient pas à %.', hg_plat__mo_nom(n), hg_plat__nom(p_id, p_u); end if;
    if exists (select 1 from unnest(hg_plat__mo_cases_groupe(hg_plat__mo_case(n)->>'groupe')) g where coalesce((hg_plat__mo_p(p_id, g)->>'maisons')::int, 0) > 0) then
      raise exception 'Vends d''abord les maisons du groupe de %.', hg_plat__mo_nom(n);
    end if;
  end loop;
end $$;

create or replace function public.hg_plat__mo_transferer(p_id uuid, p_de uuid, p_a uuid, l jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare n int; k int; v_g jsonb;
begin
  perform hg_plat__mo_argent(p_id, p_de, -coalesce((l->>'argent')::bigint, 0));
  perform hg_plat__mo_argent(p_id, p_a, coalesce((l->>'argent')::bigint, 0));
  for n in select x::int from jsonb_array_elements_text(coalesce(l->'proprietes', '[]')) x loop
    perform hg_plat__mo_setp(p_id, n, jsonb_build_object('proprio', p_a));
  end loop;
  k := coalesce((l->>'cartes')::int, 0);
  if k > 0 then
    perform hg_plat__mo_set(p_id, p_de, jsonb_build_object('cartes_sortie', (hg_plat__mo_j(p_id, p_de)->>'cartes_sortie')::int - k));
    perform hg_plat__mo_set(p_id, p_a, jsonb_build_object('cartes_sortie', (hg_plat__mo_j(p_id, p_a)->>'cartes_sortie')::int + k));
    select coalesce(prive->'cartes_gardees', '[]') into v_g from hg_plat_joueurs where partie = p_id and user_id = p_de;
    update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes_gardees}', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(v_g) with ordinality t(x, o) where o > k) s)) where partie = p_id and user_id = p_de;
    update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes_gardees}', coalesce(prive->'cartes_gardees', '[]') || (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(v_g) with ordinality t(x, o) where o <= k) s)) where partie = p_id and user_id = p_a;
  end if;
end $$;

/* ---------- Interface du socle ---------- */

create or replace function public.hg_plat__monopoly_options(p jsonb)
returns jsonb language plpgsql immutable as $$
declare d int := coalesce((p->>'duree')::int, 60);
begin
  if d not in (45, 60, 90) then raise exception 'Durée invalide (45, 60 ou 90 minutes).'; end if;
  return jsonb_build_object('duree', d);
end $$;

create or replace function public.hg_plat__monopoly_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_premier uuid; v_pions text[] := array['voiture', 'chien', 'chapeau', 'bateau', 'fer', 'de'];
begin
  update hg_plat_joueurs set etat = jsonb_build_object('pos', 0, 'argent', 1500, 'prison', false, 'essais', 0, 'cartes_sortie', 0, 'faillite', false, 'pion', v_pions[place]),
    prive = '{"cartes_gardees": []}' where partie = p_id;
  select user_id into v_premier from hg_plat_joueurs where partie = p_id order by place limit 1;
  update hg_plat_parties set nb_tours = 1,
    secret = jsonb_build_object('chance', (select jsonb_agg(x->>'id' order by random()) from jsonb_array_elements(hg_plat__c('monopoly', 'chance')) x),
      'caisse', (select jsonb_agg(x->>'id' order by random()) from jsonb_array_elements(hg_plat__c('monopoly', 'caisse')) x)),
    etat = jsonb_build_object('proprietes', '{}'::jsonb, 'actif', v_premier, 'phase', 'lancer', 'des', null, 'doubles', 0, 'rejouer', false,
      'carte', null, 'offre', null, 'dette', null, 'fin_prevue', now() + make_interval(mins => coalesce((options->>'duree')::int, 60)))
  where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Chaque joueur reçoit ' || hg_plat__mo_e(1500) || '. Fin de la partie dans ' || (select coalesce((options->>'duree')::int, 60) from hg_plat_parties where id = p_id) || ' minutes.');
  perform hg_plat__donner_tour(p_id, v_premier);
end $$;

create or replace function public.hg_plat__monopoly_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; ph text; j jsonb; n int; c jsonb; pr jsonb; v_g int[]; v_m int; o jsonb; v_cible uuid; v_ret text;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; ph := e->>'phase'; j := hg_plat__mo_j(p_id, p_u);

  -- Réponse à un échange : à tout moment, par le joueur à qui il est proposé.
  if p_action in ('accepter_echange', 'refuser_echange') then
    o := e->'offre';
    if o is null or jsonb_typeof(o) = 'null' or (o->>'a')::uuid <> p_u then raise exception 'Aucune proposition d''échange pour toi.'; end if;
    if p_action = 'refuser_echange' then
      perform hg_plat__log(p_id, p_u, 'echange', hg_plat__nom(p_id, p_u) || ' refuse l''échange.');
    else
      perform hg_plat__mo_verifier_lot(p_id, (o->>'de')::uuid, o->'donne');
      perform hg_plat__mo_verifier_lot(p_id, p_u, o->'recoit');
      perform hg_plat__mo_transferer(p_id, (o->>'de')::uuid, p_u, o->'donne');
      perform hg_plat__mo_transferer(p_id, p_u, (o->>'de')::uuid, o->'recoit');
      perform hg_plat__log(p_id, p_u, 'echange', hg_plat__nom(p_id, p_u) || ' accepte l''échange avec ' || hg_plat__nom(p_id, (o->>'de')::uuid) || '.');
    end if;
    update hg_plat_parties set etat = etat || '{"offre": null}' where id = p_id;
    return null;
  end if;

  if (e->>'actif')::uuid is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;

  -- Gestion (avant de lancer, après, ou pour régler une dette).
  if p_action in ('construire', 'vendre_maison', 'hypothequer', 'lever_hypotheque') then
    if ph not in ('lancer', 'gestion', 'dette') then raise exception 'Termine d''abord ton action en cours.'; end if;
    n := (a->>'case')::int; c := hg_plat__mo_case(n); pr := hg_plat__mo_p(p_id, n);
    if (pr->>'proprio')::uuid is distinct from p_u then raise exception 'Ce terrain ne t''appartient pas.'; end if;
    v_m := coalesce((pr->>'maisons')::int, 0);
    if p_action = 'construire' then
      if ph = 'dette' then raise exception 'Règle d''abord ta dette.'; end if;
      if c->>'type' <> 'rue' then raise exception 'On ne construit que sur les rues.'; end if;
      if not hg_plat__mo_monopole(p_id, p_u, c->>'groupe') then raise exception 'Il te faut tout le groupe de couleur.'; end if;
      v_g := hg_plat__mo_cases_groupe(c->>'groupe');
      if exists (select 1 from unnest(v_g) g where coalesce((hg_plat__mo_p(p_id, g)->>'hypotheque')::boolean, false)) then raise exception 'Un terrain du groupe est hypothéqué.'; end if;
      if v_m >= 5 then raise exception 'Il y a déjà un hôtel.'; end if;
      if v_m > (select min(coalesce((hg_plat__mo_p(p_id, g)->>'maisons')::int, 0)) from unnest(v_g) g) then raise exception 'Construis de façon égale sur tout le groupe.'; end if;
      if (j->>'argent')::bigint < (c->>'maison')::int then raise exception 'Pas assez d''argent.'; end if;
      perform hg_plat__mo_argent(p_id, p_u, -(c->>'maison')::int);
      perform hg_plat__mo_setp(p_id, n, jsonb_build_object('maisons', v_m + 1));
      perform hg_plat__log(p_id, p_u, 'construire', hg_plat__nom(p_id, p_u) || ' construit ' || case when v_m = 4 then 'un hôtel' else 'une maison' end || ' : ' || hg_plat__mo_nom(n) || '.');
      if v_m = 4 then perform hg_plat__badge(p_u, 'plat_monopoly_hotel'); end if;
    elsif p_action = 'vendre_maison' then
      if v_m = 0 then raise exception 'Aucune maison ici.'; end if;
      v_g := hg_plat__mo_cases_groupe(c->>'groupe');
      if v_m < (select max(coalesce((hg_plat__mo_p(p_id, g)->>'maisons')::int, 0)) from unnest(v_g) g) then raise exception 'Vends de façon égale sur tout le groupe.'; end if;
      perform hg_plat__mo_setp(p_id, n, jsonb_build_object('maisons', v_m - 1));
      perform hg_plat__mo_argent(p_id, p_u, (c->>'maison')::int / 2);
      perform hg_plat__log(p_id, p_u, 'construire', hg_plat__nom(p_id, p_u) || ' vend ' || case when v_m = 5 then 'un hôtel' else 'une maison' end || ' : ' || hg_plat__mo_nom(n) || '.');
    elsif p_action = 'hypothequer' then
      if coalesce((pr->>'hypotheque')::boolean, false) then raise exception 'Déjà hypothéqué.'; end if;
      if c->>'type' = 'rue' and exists (select 1 from unnest(hg_plat__mo_cases_groupe(c->>'groupe')) g where coalesce((hg_plat__mo_p(p_id, g)->>'maisons')::int, 0) > 0) then
        raise exception 'Vends d''abord les maisons du groupe.';
      end if;
      perform hg_plat__mo_setp(p_id, n, '{"hypotheque": true}');
      perform hg_plat__mo_argent(p_id, p_u, (c->>'prix')::int / 2);
      perform hg_plat__log(p_id, p_u, 'hypotheque', hg_plat__nom(p_id, p_u) || ' hypothèque : ' || hg_plat__mo_nom(n) || ' (+' || hg_plat__mo_e((c->>'prix')::int / 2) || ').');
    else
      if ph = 'dette' then raise exception 'Règle d''abord ta dette.'; end if;
      if not coalesce((pr->>'hypotheque')::boolean, false) then raise exception 'Ce terrain n''est pas hypothéqué.'; end if;
      if (j->>'argent')::bigint < ((c->>'prix')::int / 2) * 11 / 10 then raise exception 'Pas assez d''argent.'; end if;
      perform hg_plat__mo_argent(p_id, p_u, -(((c->>'prix')::int / 2) * 11 / 10));
      perform hg_plat__mo_setp(p_id, n, '{"hypotheque": false}');
      perform hg_plat__log(p_id, p_u, 'hypotheque', hg_plat__nom(p_id, p_u) || ' lève l''hypothèque : ' || hg_plat__mo_nom(n) || '.');
    end if;
    return null;
  elsif p_action = 'proposer_echange' then
    if ph not in ('lancer', 'gestion', 'dette') then raise exception 'Termine d''abord ton action en cours.'; end if;
    v_cible := (a->>'a')::uuid;
    if v_cible is null or v_cible = p_u or not hg_plat__mo_vivant(p_id, v_cible) then raise exception 'Choisis un autre joueur.'; end if;
    perform hg_plat__mo_verifier_lot(p_id, p_u, coalesce(a->'donne', '{}'));
    perform hg_plat__mo_verifier_lot(p_id, v_cible, coalesce(a->'recoit', '{}'));
    update hg_plat_parties set etat = etat || jsonb_build_object('offre', jsonb_build_object('de', p_u, 'a', v_cible,
      'donne', coalesce(a->'donne', '{}'), 'recoit', coalesce(a->'recoit', '{}'))) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'echange', hg_plat__nom(p_id, p_u) || ' propose un échange à ' || hg_plat__nom(p_id, v_cible) || '.');
    return null;
  elsif p_action = 'annuler_echange' then
    update hg_plat_parties set etat = etat || '{"offre": null}' where id = p_id;
    return null;
  elsif p_action = 'lancer' then
    if ph <> 'lancer' then raise exception 'Tu as déjà lancé les dés.'; end if;
    perform hg_plat__mo_lancer(p_id, p_u);
    return null;
  elsif p_action = 'payer_prison' or p_action = 'carte_prison' then
    if ph <> 'lancer' or not coalesce((j->>'prison')::boolean, false) then raise exception 'Tu n''es pas en prison.'; end if;
    if p_action = 'carte_prison' then
      if (j->>'cartes_sortie')::int < 1 then raise exception 'Tu n''as pas de carte « Sortie de prison ».'; end if;
      perform hg_plat__mo_set(p_id, p_u, jsonb_build_object('cartes_sortie', (j->>'cartes_sortie')::int - 1, 'prison', false, 'essais', 0));
      update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes_gardees}', (prive->'cartes_gardees') - 0) where partie = p_id and user_id = p_u;
      perform hg_plat__log(p_id, p_u, 'prison', hg_plat__nom(p_id, p_u) || ' utilise sa carte et sort de prison.');
    else
      if (j->>'argent')::bigint < 50 then raise exception 'Il te faut 50 pour sortir.'; end if;
      perform hg_plat__mo_argent(p_id, p_u, -50);
      perform hg_plat__mo_set(p_id, p_u, '{"prison": false, "essais": 0}');
      perform hg_plat__log(p_id, p_u, 'prison', hg_plat__nom(p_id, p_u) || ' paie ' || hg_plat__mo_e(50) || ' et sort de prison.');
    end if;
    return null;
  elsif p_action = 'acheter' or p_action = 'refuser' then
    if ph <> 'achat' then raise exception 'Rien à acheter.'; end if;
    n := (j->>'pos')::int; c := hg_plat__mo_case(n);
    if p_action = 'acheter' then
      if (j->>'argent')::bigint < (c->>'prix')::int then raise exception 'Pas assez d''argent (hypothèque ou vends d''abord).'; end if;
      perform hg_plat__mo_argent(p_id, p_u, -(c->>'prix')::int);
      perform hg_plat__mo_setp(p_id, n, jsonb_build_object('proprio', p_u, 'maisons', 0, 'hypotheque', false));
      perform hg_plat__log(p_id, p_u, 'achat', hg_plat__nom(p_id, p_u) || ' achète : ' || hg_plat__mo_nom(n) || ' (' || hg_plat__mo_e((c->>'prix')::int) || ').');
    else
      perform hg_plat__log(p_id, p_u, 'achat', hg_plat__nom(p_id, p_u) || ' n''achète pas : ' || hg_plat__mo_nom(n) || '.');
    end if;
    update hg_plat_parties set etat = etat || '{"phase": "gestion"}' where id = p_id;
    return null;
  elsif p_action = 'regler' then
    if ph <> 'dette' then raise exception 'Tu n''as pas de dette.'; end if;
    if (j->>'argent')::bigint < 0 then raise exception 'Il te manque encore %.', hg_plat__mo_e(-(j->>'argent')::bigint); end if;
    v_ret := e->'dette'->>'retour';
    update hg_plat_parties set etat = etat || '{"dette": null, "phase": "gestion"}' where id = p_id;
    if v_ret = 'lancer_sortie' then
      perform hg_plat__mo_aller(p_id, p_u, ((j->>'pos')::int + (e->>'des_sortie')::int) % 40);
      update hg_plat_parties set etat = etat || jsonb_build_object('phase', hg_plat__mo_arriver(p_id, p_u, (e->>'des_sortie')::int)) where id = p_id;
    end if;
    return null;
  elsif p_action = 'faillite' then
    if ph <> 'dette' then raise exception 'Tu n''as pas de dette.'; end if;
    perform hg_plat__mo_faillite(p_id, p_u);
    update hg_plat_parties set etat = etat || '{"rejouer": false}' where id = p_id;
    perform hg_plat__mo_suivant(p_id);
    return null;
  elsif p_action = 'finir' then
    if ph <> 'gestion' then raise exception 'Lance d''abord les dés.'; end if;
    perform hg_plat__mo_suivant(p_id);
    return null;
  end if;
  raise exception 'Action inconnue.';
end $$;

-- Chrono écoulé : jeu prudent (achète s'il garde 200 de réserve, ne construit pas).
create or replace function public.hg_plat__monopoly_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e jsonb; ph text; u uuid; j jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  ph := e->>'phase'; u := (e->>'actif')::uuid; j := hg_plat__mo_j(p_id, u);
  if e->'offre' is not null and jsonb_typeof(e->'offre') <> 'null' then update hg_plat_parties set etat = etat || '{"offre": null}' where id = p_id; end if;
  if ph = 'lancer' then
    if coalesce((j->>'prison')::boolean, false) and (j->>'cartes_sortie')::int > 0 then perform hg_plat__monopoly_agir(p_id, u, 'carte_prison', '{}'); end if;
    perform hg_plat__monopoly_agir(p_id, u, 'lancer', '{}');
  elsif ph = 'achat' then
    perform hg_plat__monopoly_agir(p_id, u, case when (j->>'argent')::bigint >= (hg_plat__mo_case((j->>'pos')::int)->>'prix')::int + 200 then 'acheter' else 'refuser' end, '{}');
  elsif ph = 'gestion' then perform hg_plat__mo_suivant(p_id);
  elsif ph = 'dette' then
    perform hg_plat__mo_liquider(p_id, u);
    if (hg_plat__mo_j(p_id, u)->>'argent')::bigint >= 0 then perform hg_plat__monopoly_agir(p_id, u, 'regler', '{}');
    else perform hg_plat__monopoly_agir(p_id, u, 'faillite', '{}'); end if;
  else return false;
  end if;
  return true;
end $$;

create or replace function public.hg_plat__monopoly_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; v_pos int;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat;
  v_pos := (hg_plat__mo_j(p_id, (e->>'actif')::uuid)->>'pos')::int;
  return jsonb_build_object('phase', e->>'phase', 'actif', e->'actif', 'des', e->'des', 'doubles', e->'doubles', 'rejouer', e->'rejouer',
    'proprietes', e->'proprietes', 'carte', e->'carte', 'offre', e->'offre', 'dette', e->'dette', 'fin_prevue', e->'fin_prevue',
    'plateau', (select jsonb_agg(hg_plat__mo_case(n) order by n) from generate_series(0, 39) n),
    'loyer_ici', case when e->>'phase' in ('gestion', 'achat') and v_pos is not null then hg_plat__mo_loyer(p_id, v_pos, 7) end,
    'fortunes', (select jsonb_object_agg(user_id, hg_plat__mo_fortune(p_id, user_id)) from hg_plat_joueurs where partie = p_id));
end $$;

create or replace function public.hg_plat__monopoly_badges(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select user_id, gagne, elimine from hg_plat_joueurs where partie = p_id and not invite loop
    if r.gagne then perform hg_plat__badge(r.user_id, 'plat_monopoly_victoire'); end if;
    if r.elimine then perform hg_plat__badge(r.user_id, 'plat_monopoly_ruine'); end if;
    if hg_plat__mo_proprio(p_id, 37) = r.user_id and hg_plat__mo_proprio(p_id, 39) = r.user_id then perform hg_plat__badge(r.user_id, 'plat_monopoly_paix'); end if;
  end loop;
end $$;

select public.hg_plat__droits();
