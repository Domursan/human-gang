-- ===== Humane Gang — migration 130 : Risk (moteur du jeu, sur le socle 125) =====
-- Règles officielles (42 territoires, 6 continents), 2 à 6 joueurs, avec missions secrètes (option, activée par défaut) :
--   Mise en place : territoires distribués au hasard (1 armée chacun) ; chacun répartit ensuite ses armées restantes,
--   tous en même temps (40 armées à 2 joueurs, 35 à 3, 30 à 4, 25 à 5, 20 à 6). À 2 joueurs, pas d'armée neutre.
--   Tour : renforts (territoires / 3, minimum 3, + bonus des continents, + échange de cartes : 4, 6, 8, 10, 12, 15, puis +5 ;
--          +2 sur un territoire d'une carte échangée qu'on possède ; échange obligatoire à 5 cartes)
--        → attaques (jusqu'à 3 dés contre 2 ; le défenseur lance automatiquement le maximum ; égalité au défenseur)
--        → un déplacement de fin de tour (entre territoires reliés par les siens) → carte si au moins une conquête.
--   Un joueur éliminé donne ses cartes à celui qui l'a éliminé (échange obligatoire au tour suivant s'il en a 5 ou plus).
--   Victoire : mission remplie (missions) ou conquête du monde (sans missions).
-- Identifiants fixes des territoires et continents ; noms dans hg_plat_contenus.
-- Phases (etat.phase) : placement (tous ensemble) → renforts → attaque ↔ conquete → manoeuvre → joueur suivant.

/* ---------- Contenus paramétrables ---------- */
insert into public.hg_plat_contenus(jeu, cle, libelle, valeur, defaut, sort)
select 'risk', c.cle, c.libelle, c.v, c.v, c.sort from (values
  ('nom', 'Nom du jeu', to_jsonb('Risk'::text), 1),
  ('continents', 'Continents', '[
    {"id":"amn","nom":"Amérique du Nord","couleur":"#E3B23C"},{"id":"ams","nom":"Amérique du Sud","couleur":"#D9643A"},
    {"id":"eur","nom":"Europe","couleur":"#4A78C2"},{"id":"afr","nom":"Afrique","couleur":"#A0703C"},
    {"id":"asi","nom":"Asie","couleur":"#5E9C5A"},{"id":"oce","nom":"Océanie","couleur":"#8C5BB8"}]'::jsonb, 2),
  ('territoires', 'Territoires', '[
    {"id":"alaska","nom":"Alaska"},{"id":"tno","nom":"Territoires du Nord-Ouest"},{"id":"groenland","nom":"Groenland"},
    {"id":"alberta","nom":"Alberta"},{"id":"ontario","nom":"Ontario"},{"id":"quebec","nom":"Québec"},
    {"id":"ouest","nom":"États de l''Ouest"},{"id":"est","nom":"États de l''Est"},{"id":"amcentrale","nom":"Amérique centrale"},
    {"id":"venezuela","nom":"Venezuela"},{"id":"perou","nom":"Pérou"},{"id":"bresil","nom":"Brésil"},{"id":"argentine","nom":"Argentine"},
    {"id":"islande","nom":"Islande"},{"id":"scandinavie","nom":"Scandinavie"},{"id":"gb","nom":"Grande-Bretagne"},
    {"id":"europenord","nom":"Europe du Nord"},{"id":"europeouest","nom":"Europe de l''Ouest"},{"id":"europesud","nom":"Europe du Sud"},
    {"id":"ukraine","nom":"Ukraine"},
    {"id":"afnord","nom":"Afrique du Nord"},{"id":"egypte","nom":"Égypte"},{"id":"afest","nom":"Afrique de l''Est"},
    {"id":"congo","nom":"Congo"},{"id":"afsud","nom":"Afrique du Sud"},{"id":"madagascar","nom":"Madagascar"},
    {"id":"oural","nom":"Oural"},{"id":"siberie","nom":"Sibérie"},{"id":"yakoutie","nom":"Yakoutie"},{"id":"irkoutsk","nom":"Irkoutsk"},
    {"id":"kamtchatka","nom":"Kamtchatka"},{"id":"japon","nom":"Japon"},{"id":"mongolie","nom":"Mongolie"},{"id":"chine","nom":"Chine"},
    {"id":"afghanistan","nom":"Afghanistan"},{"id":"moyenorient","nom":"Moyen-Orient"},{"id":"inde","nom":"Inde"},{"id":"siam","nom":"Siam"},
    {"id":"indonesie","nom":"Indonésie"},{"id":"nouvelleguinee","nom":"Nouvelle-Guinée"},{"id":"australieouest","nom":"Australie occidentale"},
    {"id":"australieest","nom":"Australie orientale"}]'::jsonb, 3),
  ('armees', 'Armées', '[
    {"id":"rouge","nom":"Rouge","couleur":"#C8352E"},{"id":"bleu","nom":"Bleu","couleur":"#2F6DB5"},
    {"id":"vert","nom":"Vert","couleur":"#3E8E4A"},{"id":"jaune","nom":"Jaune","couleur":"#E2B21C"},
    {"id":"noir","nom":"Noir","couleur":"#2B2B2B"},{"id":"violet","nom":"Violet","couleur":"#7D4BA8"}]'::jsonb, 4),
  ('symboles', 'Symboles des cartes', '[
    {"id":"infanterie","nom":"Infanterie"},{"id":"cavalerie","nom":"Cavalerie"},{"id":"artillerie","nom":"Artillerie"},{"id":"joker","nom":"Joker"}]'::jsonb, 5),
  ('missions', 'Missions secrètes', '[
    {"id":"m1","texte":"Conquérir la totalité de l''Europe, de l''Océanie et d''un troisième continent au choix."},
    {"id":"m2","texte":"Conquérir la totalité de l''Europe, de l''Amérique du Sud et d''un troisième continent au choix."},
    {"id":"m3","texte":"Conquérir la totalité de l''Amérique du Nord et de l''Afrique."},
    {"id":"m4","texte":"Conquérir la totalité de l''Asie et de l''Amérique du Sud."},
    {"id":"m5","texte":"Conquérir la totalité de l''Amérique du Nord et de l''Océanie."},
    {"id":"m6","texte":"Conquérir 24 territoires au choix."},
    {"id":"m7","texte":"Conquérir 18 territoires et occuper chacun d''eux avec au moins 2 armées."},
    {"id":"m8","texte":"Conquérir la totalité de l''Asie et de l''Afrique."},
    {"id":"m9","texte":"Détruire les armées rouges. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."},
    {"id":"m10","texte":"Détruire les armées bleues. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."},
    {"id":"m11","texte":"Détruire les armées vertes. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."},
    {"id":"m12","texte":"Détruire les armées jaunes. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."},
    {"id":"m13","texte":"Détruire les armées noires. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."},
    {"id":"m14","texte":"Détruire les armées violettes. Si c''est toi, ou si un autre les détruit, conquiers 24 territoires."}]'::jsonb, 6)
) c(cle, libelle, v, sort)
on conflict (jeu, cle) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('plat_risk_victoire', 'Stratège', 'Gagner une partie de Risk.', 1040),
  ('plat_risk_monde', 'Maître du monde', 'Gagner une partie de Risk en conquérant le monde entier.', 1041),
  ('plat_risk_mission', 'Mission accomplie', 'Gagner une partie de Risk en remplissant sa mission secrète.', 1042),
  ('plat_risk_asie', 'Empereur d''Asie', 'Contrôler toute l''Asie au Risk.', 1043)
on conflict (code) do nothing;

/* ---------- Carte du monde (règles fixes) ---------- */

create or replace function public.hg_plat__rk_tous()
returns text[] language sql immutable as $$
  select array['alaska','tno','groenland','alberta','ontario','quebec','ouest','est','amcentrale',
    'venezuela','perou','bresil','argentine',
    'islande','scandinavie','gb','europenord','europeouest','europesud','ukraine',
    'afnord','egypte','afest','congo','afsud','madagascar',
    'oural','siberie','yakoutie','irkoutsk','kamtchatka','japon','mongolie','chine','afghanistan','moyenorient','inde','siam',
    'indonesie','nouvelleguinee','australieouest','australieest']
$$;

create or replace function public.hg_plat__rk_continent(t text)
returns text language sql immutable as $$
  select case when t in ('alaska','tno','groenland','alberta','ontario','quebec','ouest','est','amcentrale') then 'amn'
    when t in ('venezuela','perou','bresil','argentine') then 'ams'
    when t in ('islande','scandinavie','gb','europenord','europeouest','europesud','ukraine') then 'eur'
    when t in ('afnord','egypte','afest','congo','afsud','madagascar') then 'afr'
    when t in ('indonesie','nouvelleguinee','australieouest','australieest') then 'oce'
    else 'asi' end
$$;

create or replace function public.hg_plat__rk_bonus(c text)
returns int language sql immutable as $$
  select case c when 'amn' then 5 when 'ams' then 2 when 'eur' then 5 when 'afr' then 3 when 'asi' then 7 when 'oce' then 2 else 0 end
$$;

create or replace function public.hg_plat__rk_voisins(t text)
returns text[] language sql immutable as $$
  select case t
    when 'alaska' then array['tno','alberta','kamtchatka']
    when 'tno' then array['alaska','alberta','ontario','groenland']
    when 'groenland' then array['tno','ontario','quebec','islande']
    when 'alberta' then array['alaska','tno','ontario','ouest']
    when 'ontario' then array['tno','alberta','ouest','est','quebec','groenland']
    when 'quebec' then array['ontario','est','groenland']
    when 'ouest' then array['alberta','ontario','est','amcentrale']
    when 'est' then array['ouest','ontario','quebec','amcentrale']
    when 'amcentrale' then array['ouest','est','venezuela']
    when 'venezuela' then array['amcentrale','perou','bresil']
    when 'perou' then array['venezuela','bresil','argentine']
    when 'bresil' then array['venezuela','perou','argentine','afnord']
    when 'argentine' then array['perou','bresil']
    when 'islande' then array['groenland','gb','scandinavie']
    when 'scandinavie' then array['islande','gb','europenord','ukraine']
    when 'gb' then array['islande','scandinavie','europenord','europeouest']
    when 'europenord' then array['gb','scandinavie','ukraine','europesud','europeouest']
    when 'europeouest' then array['gb','europenord','europesud','afnord']
    when 'europesud' then array['europeouest','europenord','ukraine','moyenorient','egypte','afnord']
    when 'ukraine' then array['scandinavie','europenord','europesud','oural','afghanistan','moyenorient']
    when 'afnord' then array['bresil','europeouest','europesud','egypte','afest','congo']
    when 'egypte' then array['afnord','europesud','moyenorient','afest']
    when 'afest' then array['egypte','afnord','congo','afsud','madagascar','moyenorient']
    when 'congo' then array['afnord','afest','afsud']
    when 'afsud' then array['congo','afest','madagascar']
    when 'madagascar' then array['afsud','afest']
    when 'oural' then array['ukraine','siberie','chine','afghanistan']
    when 'siberie' then array['oural','yakoutie','irkoutsk','mongolie','chine']
    when 'yakoutie' then array['siberie','irkoutsk','kamtchatka']
    when 'irkoutsk' then array['siberie','yakoutie','kamtchatka','mongolie']
    when 'kamtchatka' then array['yakoutie','irkoutsk','mongolie','japon','alaska']
    when 'japon' then array['kamtchatka','mongolie']
    when 'mongolie' then array['siberie','irkoutsk','kamtchatka','japon','chine']
    when 'chine' then array['mongolie','siberie','oural','afghanistan','inde','siam']
    when 'afghanistan' then array['ukraine','oural','chine','inde','moyenorient']
    when 'moyenorient' then array['ukraine','afghanistan','inde','egypte','europesud','afest']
    when 'inde' then array['moyenorient','afghanistan','chine','siam']
    when 'siam' then array['inde','chine','indonesie']
    when 'indonesie' then array['siam','nouvelleguinee','australieouest']
    when 'nouvelleguinee' then array['indonesie','australieouest','australieest']
    when 'australieouest' then array['indonesie','nouvelleguinee','australieest']
    when 'australieest' then array['nouvelleguinee','australieouest']
    else array[]::text[] end
$$;

-- Symbole d'une carte (14 de chaque, plus 2 jokers).
create or replace function public.hg_plat__rk_symbole(c text)
returns text language sql immutable as $$
  select case when c like 'joker%' then 'joker' else (array['infanterie','cavalerie','artillerie'])[1 + (array_position(hg_plat__rk_tous(), c) - 1) % 3] end
$$;

/* ---------- Outils ---------- */

create or replace function public.hg_plat__rk_t(p_id uuid, t text)
returns jsonb language sql stable security definer set search_path = public as $$
  select etat->'territoires'->t from hg_plat_parties where id = p_id
$$;
create or replace function public.hg_plat__rk_proprio(p_id uuid, t text)
returns uuid language sql stable security definer set search_path = public as $$ select (hg_plat__rk_t(p_id, t)->>'j')::uuid $$;
create or replace function public.hg_plat__rk_armees(p_id uuid, t text)
returns int language sql stable security definer set search_path = public as $$ select (hg_plat__rk_t(p_id, t)->>'a')::int $$;
create or replace function public.hg_plat__rk_sett(p_id uuid, t text, p_u uuid, p_a int)
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set etat = jsonb_set(etat, array['territoires', t], jsonb_build_object('j', p_u, 'a', p_a)) where id = p_id
$$;
create or replace function public.hg_plat__rk_nom(t text)
returns text language sql stable security definer set search_path = public as $$ select hg_plat__n('risk', 'territoires', t) $$;
create or replace function public.hg_plat__rk_mes(p_id uuid, p_u uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(k), '{}') from hg_plat_parties p, jsonb_each(p.etat->'territoires') x(k, v) where p.id = p_id and (v->>'j')::uuid = p_u
$$;
create or replace function public.hg_plat__rk_possede(p_id uuid, p_u uuid, p_cont text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(bool_and((v->>'j')::uuid = p_u), false) from hg_plat_parties p, jsonb_each(p.etat->'territoires') x(k, v)
  where p.id = p_id and hg_plat__rk_continent(k) = p_cont
$$;
create or replace function public.hg_plat__rk_cartes(p_id uuid, p_u uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(prive->'cartes') from hg_plat_joueurs where partie = p_id and user_id = p_u), '{}')
$$;
create or replace function public.hg_plat__rk_set_cartes(p_id uuid, p_u uuid, p_c text[])
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set prive = jsonb_set(prive, '{cartes}', to_jsonb(coalesce(p_c, '{}'))), etat = jsonb_set(etat, '{nb_cartes}', to_jsonb(cardinality(coalesce(p_c, '{}'))))
  where partie = p_id and user_id = p_u
$$;

-- Renforts de début de tour (sans les cartes) : territoires / 3 (minimum 3) + bonus des continents tenus (une seule lecture de la carte).
create or replace function public.hg_plat__rk_renforts(p_id uuid, p_u uuid)
returns int language sql stable security definer set search_path = public as $$
  with t as (select k, (v->>'j')::uuid j from hg_plat_parties p, jsonb_each(p.etat->'territoires') x(k, v) where p.id = p_id),
  c as (select hg_plat__rk_continent(k) cont, bool_and(j = p_u) tenu from t group by 1)
  select greatest(3, (select count(*) from t where j = p_u)::int / 3) + coalesce((select sum(hg_plat__rk_bonus(cont)) from c where tenu), 0)::int
$$;

-- Valeur du n-ième échange de cartes (1er = 4).
create or replace function public.hg_plat__rk_valeur(n int)
returns int language sql immutable as $$
  select case when n <= 5 then 2 + 2 * n when n = 6 then 15 else 15 + 5 * (n - 6) end
$$;

-- Vrai si trois cartes forment une combinaison (trois identiques, trois différentes, ou avec un joker).
create or replace function public.hg_plat__rk_combinaison(c text[])
returns boolean language sql immutable as $$
  select cardinality(c) = 3 and (select count(distinct x) from unnest(c) x) = 3 and (
    exists (select 1 from unnest(c) x where hg_plat__rk_symbole(x) = 'joker')
    or (select count(distinct hg_plat__rk_symbole(x)) from unnest(c) x) in (1, 3))
$$;

-- Une combinaison possible dans une main (ou null).
create or replace function public.hg_plat__rk_trouver(c text[])
returns text[] language sql immutable as $$
  select array[a, b, d] from unnest(c) with ordinality x(a, i), unnest(c) with ordinality y(b, j), unnest(c) with ordinality z(d, k)
  where i < j and j < k and hg_plat__rk_combinaison(array[a, b, d]) limit 1
$$;

-- Mission remplie ?
create or replace function public.hg_plat__rk_mission_ok(p_id uuid, p_u uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare m jsonb; v_mes text[]; v_n int; v_c int;
begin
  select prive->'mission' into m from hg_plat_joueurs where partie = p_id and user_id = p_u;
  if m is null then return false; end if;
  v_mes := hg_plat__rk_mes(p_id, p_u); v_n := cardinality(v_mes);
  select count(*) into v_c from unnest(array['amn','ams','eur','afr','asi','oce']) c where hg_plat__rk_possede(p_id, p_u, c);
  return case m->>'type'
    when 'm1' then hg_plat__rk_possede(p_id, p_u, 'eur') and hg_plat__rk_possede(p_id, p_u, 'oce') and v_c >= 3
    when 'm2' then hg_plat__rk_possede(p_id, p_u, 'eur') and hg_plat__rk_possede(p_id, p_u, 'ams') and v_c >= 3
    when 'm3' then hg_plat__rk_possede(p_id, p_u, 'amn') and hg_plat__rk_possede(p_id, p_u, 'afr')
    when 'm4' then hg_plat__rk_possede(p_id, p_u, 'asi') and hg_plat__rk_possede(p_id, p_u, 'ams')
    when 'm5' then hg_plat__rk_possede(p_id, p_u, 'amn') and hg_plat__rk_possede(p_id, p_u, 'oce')
    when 'm6' then v_n >= 24
    when 'm7' then (select count(*) from unnest(v_mes) t where hg_plat__rk_armees(p_id, t) >= 2) >= 18
    when 'm8' then hg_plat__rk_possede(p_id, p_u, 'asi') and hg_plat__rk_possede(p_id, p_u, 'afr')
    when 'detruire' then exists (select 1 from hg_plat_joueurs where partie = p_id and user_id = (m->>'cible')::uuid and elimine)
    else false end;
end $$;

-- Fin de partie si quelqu'un a gagné.
create or replace function public.hg_plat__rk_verifier(p_id uuid, p_u uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_missions boolean; v_n int;
begin
  if (select statut from hg_plat_parties where id = p_id) <> 'en_cours' then return true; end if;
  select count(*) into v_n from hg_plat_joueurs where partie = p_id and not elimine;
  if v_n = 1 then
    select user_id into p_u from hg_plat_joueurs where partie = p_id and not elimine;
    perform hg_plat__log(p_id, p_u, 'victoire', hg_plat__nom(p_id, p_u) || ' a conquis le monde !');
    perform hg_plat__terminer(p_id, array[p_u], 'monde');
    return true;
  end if;
  v_missions := coalesce((select (options->>'missions')::boolean from hg_plat_parties where id = p_id), true);
  if v_missions and p_u is not null and hg_plat__rk_mission_ok(p_id, p_u) then
    perform hg_plat__log(p_id, p_u, 'victoire', hg_plat__nom(p_id, p_u) || ' a rempli sa mission secrète : « '
      || (select x->>'texte' from jsonb_array_elements(hg_plat__c('risk', 'missions')) x, hg_plat_joueurs j
          where j.partie = p_id and j.user_id = p_u and x->>'id' = j.prive->'mission'->>'id') || ' »');
    perform hg_plat__terminer(p_id, array[p_u], 'mission');
    return true;
  end if;
  return false;
end $$;

-- Tour suivant.
create or replace function public.hg_plat__rk_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_actif uuid; v_suiv uuid; s jsonb; v_carte text;
begin
  select etat, secret into e, s from hg_plat_parties where id = p_id;
  v_actif := (e->>'actif')::uuid;
  if coalesce((e->>'conquis')::boolean, false) and jsonb_array_length(coalesce(s->'pioche', '[]')) > 0 then
    v_carte := s->'pioche'->>0;
    update hg_plat_parties set secret = jsonb_set(secret, '{pioche}', (secret->'pioche') - 0) where id = p_id;
    perform hg_plat__rk_set_cartes(p_id, v_actif, hg_plat__rk_cartes(p_id, v_actif) || v_carte);
    perform hg_plat__log(p_id, v_actif, 'carte', hg_plat__nom(p_id, v_actif) || ' reçoit une carte.');
  end if;
  v_suiv := hg_plat__suivant(p_id, v_actif);
  update hg_plat_parties set nb_tours = nb_tours + 1, etat = etat || jsonb_build_object('actif', v_suiv, 'phase', 'renforts',
    'renforts', hg_plat__rk_renforts(p_id, v_suiv), 'conquis', false, 'combat', null, 'conquete', null, 'deplace', false) where id = p_id;
  perform hg_plat__log(p_id, v_suiv, 'renforts', hg_plat__nom(p_id, v_suiv) || ' reçoit ' || hg_plat__rk_renforts(p_id, v_suiv) || ' armées.');
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

/* ---------- Interface du socle ---------- */

create or replace function public.hg_plat__risk_options(p jsonb)
returns jsonb language sql immutable as $$ select jsonb_build_object('missions', coalesce((p->>'missions')::boolean, true)) $$;

create or replace function public.hg_plat__risk_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_j uuid[]; v_n int; v_t text[]; i int; v_dep int; v_coul text[] := array['rouge','bleu','vert','jaune','noir','violet'];
  v_m text[]; v_cible uuid; k int; v_terr jsonb := '{}';
begin
  select array_agg(user_id order by place) into v_j from hg_plat_joueurs where partie = p_id;
  v_n := cardinality(v_j);
  v_dep := case v_n when 2 then 40 when 3 then 35 when 4 then 30 when 5 then 25 else 20 end;
  select array_agg(t order by random()) into v_t from unnest(hg_plat__rk_tous()) t;
  for i in 1 .. 42 loop v_terr := v_terr || jsonb_build_object(v_t[i], jsonb_build_object('j', v_j[1 + (i - 1) % v_n], 'a', 1)); end loop;
  select array_agg(m order by random()) into v_m from unnest(array['m1','m2','m3','m4','m5','m6','m7','m8','m9','m10','m11','m12','m13','m14']) m;
  for i in 1 .. v_n loop
    -- Mission « détruire » : la couleur visée doit être celle d'un autre joueur, sinon 24 territoires.
    k := case when v_m[i] in ('m9','m10','m11','m12','m13','m14') then substr(v_m[i], 2)::int - 8 else null end;
    v_cible := case when k is not null and k <= v_n and k <> i then v_j[k] else null end;
    update hg_plat_joueurs set etat = jsonb_build_object('armee', v_coul[i], 'nb_cartes', 0, 'a_placer', v_dep - (select count(*) from generate_series(1, 42) x where 1 + (x - 1) % v_n = i), 'pret', false),
      prive = jsonb_build_object('cartes', '[]'::jsonb, 'mission', jsonb_build_object('id', v_m[i],
        'type', case when k is null then v_m[i] when v_cible is null then 'm6' else 'detruire' end, 'cible', v_cible))
    where partie = p_id and user_id = v_j[i];
  end loop;
  update hg_plat_parties set nb_tours = 0,
    secret = jsonb_build_object('pioche', (select jsonb_agg(c order by random()) from (select unnest(hg_plat__rk_tous()) c union all select 'joker1' union all select 'joker2') s)),
    etat = jsonb_build_object('territoires', v_terr, 'actif', null, 'phase', 'placement', 'echanges', 0, 'renforts', 0, 'conquis', false,
      'combat', null, 'conquete', null, 'deplace', false),
    tour = null, tour_fin = now() + make_interval(secs => t_tour * 2)
  where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Les territoires sont distribués. Placez vos armées (tous en même temps).');
end $$;

-- Fin de la mise en place quand tout le monde a placé : le premier joueur commence.
create or replace function public.hg_plat__rk_debut(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_premier uuid;
begin
  if exists (select 1 from hg_plat_joueurs where partie = p_id and (etat->>'a_placer')::int > 0) then return; end if;
  select user_id into v_premier from hg_plat_joueurs where partie = p_id order by place limit 1;
  update hg_plat_parties set nb_tours = 1, etat = etat || jsonb_build_object('actif', v_premier, 'phase', 'renforts', 'renforts', hg_plat__rk_renforts(p_id, v_premier)) where id = p_id;
  perform hg_plat__log(p_id, v_premier, 'renforts', 'Que la guerre commence ! ' || hg_plat__nom(p_id, v_premier) || ' reçoit ' || hg_plat__rk_renforts(p_id, v_premier) || ' armées.');
  perform hg_plat__donner_tour(p_id, v_premier);
end $$;

-- Place des armées : {territoire: nombre}. Pendant la mise en place (son stock) ou les renforts (ceux du tour).
create or replace function public.hg_plat__rk_placer(p_id uuid, p_u uuid, p jsonb, p_initial boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_total int; r record; v_dispo int;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Placement invalide.'; end if;
  select coalesce(sum(v::int), 0) into v_total from jsonb_each_text(p) x(k, v);
  if exists (select 1 from jsonb_each_text(p) x(k, v) where v::int < 0) then raise exception 'Nombre invalide.'; end if;
  v_dispo := case when p_initial then (select (etat->>'a_placer')::int from hg_plat_joueurs where partie = p_id and user_id = p_u)
    else (select (etat->>'renforts')::int from hg_plat_parties where id = p_id) end;
  if v_total = 0 or v_total > v_dispo then raise exception 'Tu as % armées à placer.', v_dispo; end if;
  for r in select k, v::int n from jsonb_each_text(p) x(k, v) where v::int > 0 loop
    if hg_plat__rk_proprio(p_id, r.k) is distinct from p_u then raise exception '% ne t''appartient pas.', hg_plat__rk_nom(r.k); end if;
    perform hg_plat__rk_sett(p_id, r.k, p_u, hg_plat__rk_armees(p_id, r.k) + r.n);
  end loop;
  if p_initial then
    update hg_plat_joueurs set etat = jsonb_set(etat, '{a_placer}', to_jsonb((etat->>'a_placer')::int - v_total)) where partie = p_id and user_id = p_u;
  else
    update hg_plat_parties set etat = jsonb_set(etat, '{renforts}', to_jsonb((etat->>'renforts')::int - v_total)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'renforts', hg_plat__nom(p_id, p_u) || ' place ' || v_total || ' armée' || case when v_total > 1 then 's' else '' end || '.');
  end if;
end $$;

-- Échange de 3 cartes contre des armées.
create or replace function public.hg_plat__rk_echanger(p_id uuid, p_u uuid, p_c text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_main text[]; v_n int; v_val int; t text; v_bonus text;
begin
  v_main := hg_plat__rk_cartes(p_id, p_u);
  if not (p_c <@ v_main) or not hg_plat__rk_combinaison(p_c) then raise exception 'Ces trois cartes ne forment pas une combinaison.'; end if;
  v_n := (select (etat->>'echanges')::int + 1 from hg_plat_parties where id = p_id);
  v_val := hg_plat__rk_valeur(v_n);
  perform hg_plat__rk_set_cartes(p_id, p_u, array(select x from unnest(v_main) x where not (x = any(p_c))));
  update hg_plat_parties set etat = etat || jsonb_build_object('echanges', v_n, 'renforts', (etat->>'renforts')::int + v_val),
    secret = jsonb_set(secret, '{pioche}', (secret->'pioche') || to_jsonb(p_c)) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'cartes', hg_plat__nom(p_id, p_u) || ' échange 3 cartes contre ' || v_val || ' armées.');
  -- +2 armées sur un territoire d'une carte qu'on possède (une seule fois).
  select x into v_bonus from unnest(p_c) x where hg_plat__rk_proprio(p_id, x) = p_u limit 1;
  if v_bonus is not null then
    perform hg_plat__rk_sett(p_id, v_bonus, p_u, hg_plat__rk_armees(p_id, v_bonus) + 2);
    perform hg_plat__log(p_id, p_u, 'cartes', '+2 armées sur ' || hg_plat__rk_nom(v_bonus) || '.');
  end if;
end $$;

-- Un combat : renvoie le résultat ; gère la conquête.
create or replace function public.hg_plat__rk_combat(p_id uuid, p_u uuid, p_de text, p_vers text, p_des int)
returns void language plpgsql security definer set search_path = public as $$
declare v_def uuid; v_aa int; v_ad int; v_nd int; att int[]; def int[]; i int; v_pa int := 0; v_pd int := 0; v_elim boolean;
begin
  v_def := hg_plat__rk_proprio(p_id, p_vers);
  v_aa := hg_plat__rk_armees(p_id, p_de); v_ad := hg_plat__rk_armees(p_id, p_vers);
  p_des := least(coalesce(p_des, 3), 3, v_aa - 1);
  if p_des < 1 then raise exception 'Il faut au moins 2 armées pour attaquer.'; end if;
  v_nd := least(2, v_ad);
  select array_agg(d order by d desc) into att from (select hg_plat__sh_d(6) d from generate_series(1, p_des)) s;
  select array_agg(d order by d desc) into def from (select hg_plat__sh_d(6) d from generate_series(1, v_nd)) s;
  for i in 1 .. least(p_des, v_nd) loop
    if att[i] > def[i] then v_pd := v_pd + 1; else v_pa := v_pa + 1; end if;
  end loop;
  perform hg_plat__rk_sett(p_id, p_de, p_u, v_aa - v_pa);
  perform hg_plat__rk_sett(p_id, p_vers, v_def, v_ad - v_pd);
  update hg_plat_parties set etat = etat || jsonb_build_object('combat', jsonb_build_object('de', p_de, 'vers', p_vers, 'attaquant', p_u, 'defenseur', v_def,
    'des_att', to_jsonb(att), 'des_def', to_jsonb(def), 'pertes_att', v_pa, 'pertes_def', v_pd)) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'attaque', hg_plat__nom(p_id, p_u) || ' attaque ' || hg_plat__rk_nom(p_vers) || ' depuis ' || hg_plat__rk_nom(p_de)
    || ' (' || array_to_string(att, '-') || ' contre ' || array_to_string(def, '-') || ') : ' || v_pa || ' perte' || case when v_pa > 1 then 's' else '' end
    || ' contre ' || v_pd || '.');
  if v_ad - v_pd = 0 then
    perform hg_plat__rk_sett(p_id, p_vers, p_u, 0);
    update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'conquete', 'conquis', true,
      'conquete', jsonb_build_object('de', p_de, 'vers', p_vers, 'min', p_des)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'conquete', hg_plat__nom(p_id, p_u) || ' conquiert ' || hg_plat__rk_nom(p_vers) || ' !');
    v_elim := cardinality(hg_plat__rk_mes(p_id, v_def)) = 0;
    if v_elim then
      update hg_plat_joueurs set elimine = true where partie = p_id and user_id = v_def;
      perform hg_plat__rk_set_cartes(p_id, p_u, hg_plat__rk_cartes(p_id, p_u) || hg_plat__rk_cartes(p_id, v_def));
      perform hg_plat__rk_set_cartes(p_id, v_def, '{}');
      perform hg_plat__log(p_id, v_def, 'elimine', hg_plat__nom(p_id, v_def) || ' est éliminé par ' || hg_plat__nom(p_id, p_u) || ' (qui prend ses cartes).');
      -- Missions « détruire » visant ce joueur, d'un autre que le vainqueur : deviennent 24 territoires.
      update hg_plat_joueurs set prive = jsonb_set(prive, '{mission,type}', '"m6"')
        where partie = p_id and user_id <> p_u and prive->'mission'->>'type' = 'detruire' and (prive->'mission'->>'cible')::uuid = v_def;
    end if;
  end if;
end $$;

-- Chemin entre deux territoires à soi (pour le déplacement de fin de tour).
create or replace function public.hg_plat__rk_relies(p_id uuid, p_u uuid, p_de text, p_vers text)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive mes as (select unnest(hg_plat__rk_mes(p_id, p_u)) t),
  chemin(t) as (select p_de union select v from chemin c, unnest(hg_plat__rk_voisins(c.t)) v where v in (select t from mes))
  select exists (select 1 from chemin where t = p_vers)
$$;

create or replace function public.hg_plat__risk_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; ph text; v_de text; v_vers text; n int; v_c text[]; q jsonb;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; ph := e->>'phase';
  if p_action = 'placer' and ph = 'placement' then
    perform hg_plat__rk_placer(p_id, p_u, a->'placements', true);
    perform hg_plat__rk_debut(p_id);
    return null;
  end if;
  if (e->>'actif')::uuid is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;
  if p_action = 'echanger' then
    if ph <> 'renforts' then raise exception 'On échange des cartes pendant les renforts.'; end if;
    v_c := array(select jsonb_array_elements_text(a->'cartes'));
    perform hg_plat__rk_echanger(p_id, p_u, v_c);
    return null;
  elsif p_action = 'placer' then
    if ph <> 'renforts' then raise exception 'Tu n''as pas de renforts à placer.'; end if;
    if cardinality(hg_plat__rk_cartes(p_id, p_u)) >= 5 then raise exception 'Tu as 5 cartes ou plus : échange d''abord une combinaison.'; end if;
    perform hg_plat__rk_placer(p_id, p_u, a->'placements', false);
    if (select (etat->>'renforts')::int from hg_plat_parties where id = p_id) = 0 then
      update hg_plat_parties set etat = etat || '{"phase": "attaque"}' where id = p_id;
      perform hg_plat__rk_verifier(p_id, p_u);
    end if;
    return null;
  elsif p_action = 'attaquer' then
    if ph <> 'attaque' then raise exception 'Tu ne peux pas attaquer maintenant.'; end if;
    v_de := a->>'de'; v_vers := a->>'vers';
    if hg_plat__rk_proprio(p_id, v_de) is distinct from p_u then raise exception 'Attaque depuis un de tes territoires.'; end if;
    if hg_plat__rk_proprio(p_id, v_vers) = p_u or hg_plat__rk_proprio(p_id, v_vers) is null then raise exception 'Choisis un territoire ennemi.'; end if;
    if not (v_vers = any(hg_plat__rk_voisins(v_de))) then raise exception 'Ces territoires ne sont pas voisins.'; end if;
    perform hg_plat__rk_combat(p_id, p_u, v_de, v_vers, coalesce((a->>'des')::int, 3));
    perform hg_plat__rk_verifier(p_id, p_u);
    return null;
  elsif p_action = 'avancer' then
    if ph <> 'conquete' then raise exception 'Aucune conquête en cours.'; end if;
    q := e->'conquete'; n := coalesce((a->>'armees')::int, (q->>'min')::int);
    if n < (q->>'min')::int or n > hg_plat__rk_armees(p_id, q->>'de') - 1 then
      raise exception 'Déplace entre % et % armées.', (q->>'min')::int, hg_plat__rk_armees(p_id, q->>'de') - 1;
    end if;
    perform hg_plat__rk_sett(p_id, q->>'de', p_u, hg_plat__rk_armees(p_id, q->>'de') - n);
    perform hg_plat__rk_sett(p_id, q->>'vers', p_u, n);
    update hg_plat_parties set etat = etat || '{"phase": "attaque", "conquete": null}' where id = p_id;
    -- 6 cartes ou plus après une élimination : échange obligatoire tout de suite.
    if cardinality(hg_plat__rk_cartes(p_id, p_u)) >= 6 then
      update hg_plat_parties set etat = etat || '{"phase": "renforts"}' where id = p_id;
      perform hg_plat__log(p_id, p_u, 'cartes', hg_plat__nom(p_id, p_u) || ' a 6 cartes : il doit les échanger maintenant.');
    end if;
    perform hg_plat__rk_verifier(p_id, p_u);
    return null;
  elsif p_action = 'fin_attaque' then
    if ph <> 'attaque' then raise exception 'Tu n''es pas en phase d''attaque.'; end if;
    update hg_plat_parties set etat = etat || '{"phase": "manoeuvre", "combat": null}' where id = p_id;
    return null;
  elsif p_action = 'manoeuvrer' then
    if ph <> 'manoeuvre' then raise exception 'Termine d''abord tes attaques.'; end if;
    v_de := a->>'de'; v_vers := a->>'vers'; n := (a->>'armees')::int;
    if hg_plat__rk_proprio(p_id, v_de) is distinct from p_u or hg_plat__rk_proprio(p_id, v_vers) is distinct from p_u or v_de = v_vers then
      raise exception 'Choisis deux de tes territoires.';
    end if;
    if not hg_plat__rk_relies(p_id, p_u, v_de, v_vers) then raise exception 'Ces territoires ne sont pas reliés par les tiens.'; end if;
    if n is null or n < 1 or n > hg_plat__rk_armees(p_id, v_de) - 1 then raise exception 'Déplace entre 1 et % armées.', hg_plat__rk_armees(p_id, v_de) - 1; end if;
    perform hg_plat__rk_sett(p_id, v_de, p_u, hg_plat__rk_armees(p_id, v_de) - n);
    perform hg_plat__rk_sett(p_id, v_vers, p_u, hg_plat__rk_armees(p_id, v_vers) + n);
    perform hg_plat__log(p_id, p_u, 'manoeuvre', hg_plat__nom(p_id, p_u) || ' déplace ' || n || ' armée' || case when n > 1 then 's' else '' end
      || ' de ' || hg_plat__rk_nom(v_de) || ' vers ' || hg_plat__rk_nom(v_vers) || '.');
    if not hg_plat__rk_verifier(p_id, p_u) then perform hg_plat__rk_suivant(p_id); end if;
    return null;
  elsif p_action = 'finir' then
    if ph not in ('attaque', 'manoeuvre') then raise exception 'Place d''abord tes renforts.'; end if;
    if not hg_plat__rk_verifier(p_id, p_u) then perform hg_plat__rk_suivant(p_id); end if;
    return null;
  end if;
  raise exception 'Action inconnue.';
end $$;

-- Chrono écoulé : place au hasard (sur un territoire en contact avec l'ennemi), n'attaque pas.
create or replace function public.hg_plat__risk_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e jsonb; ph text; u uuid; r record; v_t text; v_c text[]; i int := 0;
begin
  select etat into e from hg_plat_parties where id = p_id;
  ph := e->>'phase'; u := (e->>'actif')::uuid;
  if ph = 'placement' then
    for r in select user_id, (etat->>'a_placer')::int n from hg_plat_joueurs where partie = p_id and (etat->>'a_placer')::int > 0 loop
      perform hg_plat__rk_placer(p_id, r.user_id, (select jsonb_object_agg(t, c) from (select t, count(*) c from
        (select (select x from unnest(hg_plat__rk_mes(p_id, r.user_id)) x order by random() + g * 0 limit 1) t from generate_series(1, r.n) g) s group by t) s2), true);
      update hg_plat_joueurs set manques = manques + 1 where partie = p_id and user_id = r.user_id;
    end loop;
    perform hg_plat__rk_debut(p_id);
  elsif ph = 'renforts' then
    loop
      v_c := hg_plat__rk_cartes(p_id, u);
      exit when cardinality(v_c) < 5 or i > 3;
      perform hg_plat__rk_echanger(p_id, u, hg_plat__rk_trouver(v_c)); i := i + 1;
    end loop;
    select t into v_t from unnest(hg_plat__rk_mes(p_id, u)) t
      where exists (select 1 from unnest(hg_plat__rk_voisins(t)) v where hg_plat__rk_proprio(p_id, v) <> u) order by random() limit 1;
    v_t := coalesce(v_t, (hg_plat__rk_mes(p_id, u))[1]);
    if (select (etat->>'renforts')::int from hg_plat_parties where id = p_id) > 0 then
      perform hg_plat__rk_placer(p_id, u, jsonb_build_object(v_t, (select (etat->>'renforts')::int from hg_plat_parties where id = p_id)), false);
    end if;
    update hg_plat_parties set etat = etat || '{"phase": "attaque"}' where id = p_id;
  elsif ph = 'conquete' then perform hg_plat__risk_agir(p_id, u, 'avancer', '{}');
  elsif ph in ('attaque', 'manoeuvre') then
    if not hg_plat__rk_verifier(p_id, u) then perform hg_plat__rk_suivant(p_id); end if;
  else return false;
  end if;
  return true;
end $$;

create or replace function public.hg_plat__risk_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; j hg_plat_joueurs; v_fini boolean;
begin
  select * into p from hg_plat_parties where id = p_id;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_moi;
  e := p.etat; v_fini := p.statut in ('terminee', 'annulee');
  return jsonb_build_object('phase', e->>'phase', 'actif', e->'actif', 'territoires', e->'territoires', 'renforts', e->'renforts',
    'echanges', e->'echanges', 'prochain_echange', hg_plat__rk_valeur((e->>'echanges')::int + 1), 'combat', e->'combat', 'conquete', e->'conquete',
    'conquis', e->'conquis', 'missions', coalesce((p.options->>'missions')::boolean, true),
    'pioche', jsonb_array_length(coalesce(p.secret->'pioche', '[]')),
    'moi', case when j.user_id is null then null else jsonb_build_object(
      'cartes', (select coalesce(jsonb_agg(jsonb_build_object('id', c, 'symbole', hg_plat__rk_symbole(c))), '[]') from unnest(hg_plat__rk_cartes(p_id, p_moi)) c),
      'mission', jsonb_build_object('id', j.prive->'mission'->'id', 'type', j.prive->'mission'->'type', 'cible', j.prive->'mission'->'cible'),
      'a_placer', j.etat->'a_placer', 'renforts_prevus', hg_plat__rk_renforts(p_id, p_moi)) end,
    'missions_fin', case when v_fini then (select jsonb_object_agg(user_id, prive->'mission') from hg_plat_joueurs where partie = p_id) else null end,
    'voisins', (select jsonb_object_agg(t, to_jsonb(hg_plat__rk_voisins(t))) from unnest(hg_plat__rk_tous()) t),
    'continents', (select jsonb_object_agg(t, hg_plat__rk_continent(t)) from unnest(hg_plat__rk_tous()) t),
    'bonus', '{"amn": 5, "ams": 2, "eur": 5, "afr": 3, "asi": 7, "oce": 2}'::jsonb);
end $$;

create or replace function public.hg_plat__risk_badges(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_raison text;
begin
  select raison into v_raison from hg_plat_parties where id = p_id;
  for r in select user_id, gagne from hg_plat_joueurs where partie = p_id and not invite loop
    if r.gagne then
      perform hg_plat__badge(r.user_id, 'plat_risk_victoire');
      perform hg_plat__badge(r.user_id, case when v_raison = 'mission' then 'plat_risk_mission' else 'plat_risk_monde' end);
    end if;
    if hg_plat__rk_possede(p_id, r.user_id, 'asi') then perform hg_plat__badge(r.user_id, 'plat_risk_asie'); end if;
  end loop;
end $$;

select public.hg_plat__droits();
