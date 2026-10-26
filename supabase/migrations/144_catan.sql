-- ===== Humane Gang — migration 144 : Catan du gang (version simplifiée) sur le moteur des jeux de plateau, en développement =====
-- 2 à 4 joueurs (robots possibles). Plateau de 19 tuiles (rangées 3-4-5-4-3) : 4 bois, 3 argile, 4 blé, 4 mouton, 3 pierre, 1 désert ;
-- jetons 2 à 12 tirés au hasard (6 et 8 jamais voisins). Géométrie fixe : 54 sommets, 72 arêtes (hg_ct__geo).
-- Mise en place : chacun pose une colonie et une route, puis dans l'ordre inverse une deuxième (qui rapporte les ressources voisines).
-- Tour : lancer les dés → production (colonie 1, ville 2 ; rien sous le voleur) ; sur 7, ceux qui ont plus de 7 cartes en
-- défaussent la moitié (au hasard) et le joueur déplace le voleur et vole une carte à un voisin de la tuile.
-- Puis : route (bois + argile), colonie (bois + argile + blé + mouton ; à 2 arêtes de toute autre, reliée à une de mes routes),
-- ville (2 blé + 3 pierre, sur une de mes colonies), échange avec la banque 4 contre 1, fin du tour.
-- Points : colonie 1, ville 2 ; objectif 10 (option 8). Limites : 15 routes, 5 colonies, 4 villes.
-- Simplifications assumées : ni cartes de développement, ni ports, ni plus longue route, ni échanges entre joueurs.
-- Ressources : prive.ressources (seul le joueur les voit) ; etat public : points, cartes (nombre), colonies, villes, routes.

create or replace function public.hg_ct__geo()
returns jsonb language sql immutable as $$ select '{"hexes":[{"id":0,"q":0,"r":-2,"x":-1.732,"y":-3.0,"sommets":[0,1,2,3,4,5]},{"id":1,"q":1,"r":-2,"x":0.0,"y":-3.0,"sommets":[6,7,8,9,2,1]},{"id":2,"q":2,"r":-2,"x":1.732,"y":-3.0,"sommets":[10,11,12,13,8,7]},{"id":3,"q":-1,"r":-1,"x":-2.598,"y":-1.5,"sommets":[4,3,14,15,16,17]},{"id":4,"q":0,"r":-1,"x":-0.866,"y":-1.5,"sommets":[2,9,18,19,14,3]},{"id":5,"q":1,"r":-1,"x":0.866,"y":-1.5,"sommets":[8,13,20,21,18,9]},{"id":6,"q":2,"r":-1,"x":2.598,"y":-1.5,"sommets":[12,22,23,24,20,13]},{"id":7,"q":-2,"r":0,"x":-3.464,"y":0.0,"sommets":[16,15,25,26,27,28]},{"id":8,"q":-1,"r":0,"x":-1.732,"y":0.0,"sommets":[14,19,29,30,25,15]},{"id":9,"q":0,"r":0,"x":0.0,"y":0.0,"sommets":[18,21,31,32,29,19]},{"id":10,"q":1,"r":0,"x":1.732,"y":0.0,"sommets":[20,24,33,34,31,21]},{"id":11,"q":2,"r":0,"x":3.464,"y":0.0,"sommets":[23,35,36,37,33,24]},{"id":12,"q":-2,"r":1,"x":-2.598,"y":1.5,"sommets":[25,30,38,39,40,26]},{"id":13,"q":-1,"r":1,"x":-0.866,"y":1.5,"sommets":[29,32,41,42,38,30]},{"id":14,"q":0,"r":1,"x":0.866,"y":1.5,"sommets":[31,34,43,44,41,32]},{"id":15,"q":1,"r":1,"x":2.598,"y":1.5,"sommets":[33,37,45,46,43,34]},{"id":16,"q":-2,"r":2,"x":-1.732,"y":3.0,"sommets":[38,42,47,48,49,39]},{"id":17,"q":-1,"r":2,"x":0.0,"y":3.0,"sommets":[41,44,50,51,47,42]},{"id":18,"q":0,"r":2,"x":1.732,"y":3.0,"sommets":[43,46,52,53,50,44]}],"sommets":[{"id":0,"x":-1.732,"y":-4.0,"hexes":[0],"voisins":[1,5],"aretes":[0,5]},{"id":1,"x":-0.866,"y":-3.5,"hexes":[0,1],"voisins":[0,2,6],"aretes":[0,1,10]},{"id":2,"x":-0.866,"y":-2.5,"hexes":[0,1,4],"voisins":[1,3,9],"aretes":[1,2,9]},{"id":3,"x":-1.732,"y":-2.0,"hexes":[0,3,4],"voisins":[2,4,14],"aretes":[2,3,16]},{"id":4,"x":-2.598,"y":-2.5,"hexes":[0,3],"voisins":[3,5,17],"aretes":[3,4,20]},{"id":5,"x":-2.598,"y":-3.5,"hexes":[0],"voisins":[0,4],"aretes":[4,5]},{"id":6,"x":0.0,"y":-4.0,"hexes":[1],"voisins":[1,7],"aretes":[6,10]},{"id":7,"x":0.866,"y":-3.5,"hexes":[1,2],"voisins":[6,8,10],"aretes":[6,7,15]},{"id":8,"x":0.866,"y":-2.5,"hexes":[1,2,5],"voisins":[7,9,13],"aretes":[7,8,14]},{"id":9,"x":0.0,"y":-2.0,"hexes":[1,4,5],"voisins":[2,8,18],"aretes":[8,9,21]},{"id":10,"x":1.732,"y":-4.0,"hexes":[2],"voisins":[7,11],"aretes":[11,15]},{"id":11,"x":2.598,"y":-3.5,"hexes":[2],"voisins":[10,12],"aretes":[11,12]},{"id":12,"x":2.598,"y":-2.5,"hexes":[2,6],"voisins":[11,13,22],"aretes":[12,13,27]},{"id":13,"x":1.732,"y":-2.0,"hexes":[2,5,6],"voisins":[8,12,20],"aretes":[13,14,24]},{"id":14,"x":-1.732,"y":-1.0,"hexes":[3,4,8],"voisins":[3,15,19],"aretes":[16,17,23]},{"id":15,"x":-2.598,"y":-0.5,"hexes":[3,7,8],"voisins":[14,16,25],"aretes":[17,18,31]},{"id":16,"x":-3.464,"y":-1.0,"hexes":[3,7],"voisins":[15,17,28],"aretes":[18,19,35]},{"id":17,"x":-3.464,"y":-2.0,"hexes":[3],"voisins":[4,16],"aretes":[19,20]},{"id":18,"x":0.0,"y":-1.0,"hexes":[4,5,9],"voisins":[9,19,21],"aretes":[21,22,26]},{"id":19,"x":-0.866,"y":-0.5,"hexes":[4,8,9],"voisins":[14,18,29],"aretes":[22,23,36]},{"id":20,"x":1.732,"y":-1.0,"hexes":[5,6,10],"voisins":[13,21,24],"aretes":[24,25,30]},{"id":21,"x":0.866,"y":-0.5,"hexes":[5,9,10],"voisins":[18,20,31],"aretes":[25,26,39]},{"id":22,"x":3.464,"y":-2.0,"hexes":[6],"voisins":[12,23],"aretes":[27,28]},{"id":23,"x":3.464,"y":-1.0,"hexes":[6,11],"voisins":[22,24,35],"aretes":[28,29,45]},{"id":24,"x":2.598,"y":-0.5,"hexes":[6,10,11],"voisins":[20,23,33],"aretes":[29,30,42]},{"id":25,"x":-2.598,"y":0.5,"hexes":[7,8,12],"voisins":[15,26,30],"aretes":[31,32,38]},{"id":26,"x":-3.464,"y":1.0,"hexes":[7,12],"voisins":[25,27,40],"aretes":[32,33,52]},{"id":27,"x":-4.33,"y":0.5,"hexes":[7],"voisins":[26,28],"aretes":[33,34]},{"id":28,"x":-4.33,"y":-0.5,"hexes":[7],"voisins":[16,27],"aretes":[34,35]},{"id":29,"x":-0.866,"y":0.5,"hexes":[8,9,13],"voisins":[19,30,32],"aretes":[36,37,41]},{"id":30,"x":-1.732,"y":1.0,"hexes":[8,12,13],"voisins":[25,29,38],"aretes":[37,38,49]},{"id":31,"x":0.866,"y":0.5,"hexes":[9,10,14],"voisins":[21,32,34],"aretes":[39,40,44]},{"id":32,"x":0.0,"y":1.0,"hexes":[9,13,14],"voisins":[29,31,41],"aretes":[40,41,53]},{"id":33,"x":2.598,"y":0.5,"hexes":[10,11,15],"voisins":[24,34,37],"aretes":[42,43,48]},{"id":34,"x":1.732,"y":1.0,"hexes":[10,14,15],"voisins":[31,33,43],"aretes":[43,44,56]},{"id":35,"x":4.33,"y":-0.5,"hexes":[11],"voisins":[23,36],"aretes":[45,46]},{"id":36,"x":4.33,"y":0.5,"hexes":[11],"voisins":[35,37],"aretes":[46,47]},{"id":37,"x":3.464,"y":1.0,"hexes":[11,15],"voisins":[33,36,45],"aretes":[47,48,59]},{"id":38,"x":-1.732,"y":2.0,"hexes":[12,13,16],"voisins":[30,39,42],"aretes":[49,50,55]},{"id":39,"x":-2.598,"y":2.5,"hexes":[12,16],"voisins":[38,40,49],"aretes":[50,51,65]},{"id":40,"x":-3.464,"y":2.0,"hexes":[12],"voisins":[26,39],"aretes":[51,52]},{"id":41,"x":0.0,"y":2.0,"hexes":[13,14,17],"voisins":[32,42,44],"aretes":[53,54,58]},{"id":42,"x":-0.866,"y":2.5,"hexes":[13,16,17],"voisins":[38,41,47],"aretes":[54,55,62]},{"id":43,"x":1.732,"y":2.0,"hexes":[14,15,18],"voisins":[34,44,46],"aretes":[56,57,61]},{"id":44,"x":0.866,"y":2.5,"hexes":[14,17,18],"voisins":[41,43,50],"aretes":[57,58,66]},{"id":45,"x":3.464,"y":2.0,"hexes":[15],"voisins":[37,46],"aretes":[59,60]},{"id":46,"x":2.598,"y":2.5,"hexes":[15,18],"voisins":[43,45,52],"aretes":[60,61,69]},{"id":47,"x":-0.866,"y":3.5,"hexes":[16,17],"voisins":[42,48,51],"aretes":[62,63,68]},{"id":48,"x":-1.732,"y":4.0,"hexes":[16],"voisins":[47,49],"aretes":[63,64]},{"id":49,"x":-2.598,"y":3.5,"hexes":[16],"voisins":[39,48],"aretes":[64,65]},{"id":50,"x":0.866,"y":3.5,"hexes":[17,18],"voisins":[44,51,53],"aretes":[66,67,71]},{"id":51,"x":0.0,"y":4.0,"hexes":[17],"voisins":[47,50],"aretes":[67,68]},{"id":52,"x":2.598,"y":3.5,"hexes":[18],"voisins":[46,53],"aretes":[69,70]},{"id":53,"x":1.732,"y":4.0,"hexes":[18],"voisins":[50,52],"aretes":[70,71]}],"aretes":[{"id":0,"a":0,"b":1},{"id":1,"a":1,"b":2},{"id":2,"a":2,"b":3},{"id":3,"a":3,"b":4},{"id":4,"a":4,"b":5},{"id":5,"a":0,"b":5},{"id":6,"a":6,"b":7},{"id":7,"a":7,"b":8},{"id":8,"a":8,"b":9},{"id":9,"a":2,"b":9},{"id":10,"a":1,"b":6},{"id":11,"a":10,"b":11},{"id":12,"a":11,"b":12},{"id":13,"a":12,"b":13},{"id":14,"a":8,"b":13},{"id":15,"a":7,"b":10},{"id":16,"a":3,"b":14},{"id":17,"a":14,"b":15},{"id":18,"a":15,"b":16},{"id":19,"a":16,"b":17},{"id":20,"a":4,"b":17},{"id":21,"a":9,"b":18},{"id":22,"a":18,"b":19},{"id":23,"a":14,"b":19},{"id":24,"a":13,"b":20},{"id":25,"a":20,"b":21},{"id":26,"a":18,"b":21},{"id":27,"a":12,"b":22},{"id":28,"a":22,"b":23},{"id":29,"a":23,"b":24},{"id":30,"a":20,"b":24},{"id":31,"a":15,"b":25},{"id":32,"a":25,"b":26},{"id":33,"a":26,"b":27},{"id":34,"a":27,"b":28},{"id":35,"a":16,"b":28},{"id":36,"a":19,"b":29},{"id":37,"a":29,"b":30},{"id":38,"a":25,"b":30},{"id":39,"a":21,"b":31},{"id":40,"a":31,"b":32},{"id":41,"a":29,"b":32},{"id":42,"a":24,"b":33},{"id":43,"a":33,"b":34},{"id":44,"a":31,"b":34},{"id":45,"a":23,"b":35},{"id":46,"a":35,"b":36},{"id":47,"a":36,"b":37},{"id":48,"a":33,"b":37},{"id":49,"a":30,"b":38},{"id":50,"a":38,"b":39},{"id":51,"a":39,"b":40},{"id":52,"a":26,"b":40},{"id":53,"a":32,"b":41},{"id":54,"a":41,"b":42},{"id":55,"a":38,"b":42},{"id":56,"a":34,"b":43},{"id":57,"a":43,"b":44},{"id":58,"a":41,"b":44},{"id":59,"a":37,"b":45},{"id":60,"a":45,"b":46},{"id":61,"a":43,"b":46},{"id":62,"a":42,"b":47},{"id":63,"a":47,"b":48},{"id":64,"a":48,"b":49},{"id":65,"a":39,"b":49},{"id":66,"a":44,"b":50},{"id":67,"a":50,"b":51},{"id":68,"a":47,"b":51},{"id":69,"a":46,"b":52},{"id":70,"a":52,"b":53},{"id":71,"a":50,"b":53}]}'::jsonb $$;

create or replace function public.hg_ct__pips(n int)
returns int language sql immutable as $$ select case when n is null or n = 7 then 0 else 6 - abs(7 - n) end $$;

create or replace function public.hg_plat__catan_options(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('objectif', case when (p->>'objectif') = '8' then 8 else 10 end) $$;

-- Ressources d'un joueur (prive.ressources) et opérations.
create or replace function public.hg_ct__res(p_id uuid, p_u uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(prive->'ressources', '{"bois":0,"argile":0,"ble":0,"mouton":0,"pierre":0}'::jsonb) from hg_plat_joueurs where partie = p_id and user_id = p_u $$;

create or replace function public.hg_ct__ajouter(p_id uuid, p_u uuid, d jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r jsonb := hg_ct__res(p_id, p_u); k text;
begin
  for k in select jsonb_object_keys(d) loop
    r := jsonb_set(r, array[k], to_jsonb(coalesce((r->>k)::int, 0) + (d->>k)::int));
    if (r->>k)::int < 0 then raise exception 'Pas assez de ressources.'; end if;
  end loop;
  update hg_plat_joueurs set prive = jsonb_set(prive, '{ressources}', r),
    etat = jsonb_set(etat, '{cartes}', to_jsonb((select sum(v::int) from jsonb_each_text(r) x(k2, v)))) where partie = p_id and user_id = p_u;
end $$;

-- Points (colonies + 2 × villes) recalculés dans l'état public.
create or replace function public.hg_ct__compter(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  update hg_plat_joueurs j set etat = j.etat || jsonb_build_object(
    'colonies', (select count(*) from jsonb_each_text(coalesce(e->'colonies', '{}')) x where x.value = j.user_id::text),
    'villes', (select count(*) from jsonb_each_text(coalesce(e->'villes', '{}')) x where x.value = j.user_id::text),
    'routes', (select count(*) from jsonb_each_text(coalesce(e->'routes', '{}')) x where x.value = j.user_id::text),
    'points', (select count(*) from jsonb_each_text(coalesce(e->'colonies', '{}')) x where x.value = j.user_id::text)
      + 2 * (select count(*) from jsonb_each_text(coalesce(e->'villes', '{}')) x where x.value = j.user_id::text))
  where j.partie = p_id;
end $$;

-- Sommet libre et à distance (aucun voisin occupé) ; hors mise en place, relié à une de mes routes.
create or replace function public.hg_ct__colonie_ok(e jsonb, v int, u uuid, p_placement boolean)
returns boolean language sql immutable as $$
  select v between 0 and 53
    and not (coalesce(e->'colonies', '{}') ? v::text) and not (coalesce(e->'villes', '{}') ? v::text)
    and not exists (select 1 from jsonb_array_elements_text(public.hg_ct__geo()->'sommets'->v->'voisins') w
                    where coalesce(e->'colonies', '{}') ? w or coalesce(e->'villes', '{}') ? w)
    and (p_placement or exists (select 1 from jsonb_array_elements_text(public.hg_ct__geo()->'sommets'->v->'aretes') a
                                where e->'routes'->>a = u::text)) $$;

-- Arête libre reliée à mon réseau (une de mes colonies/villes ou routes à une extrémité) ; en mise en place, à la colonie posée.
create or replace function public.hg_ct__route_ok(e jsonb, a int, u uuid, p_depuis int)
returns boolean language plpgsql immutable as $$
declare ar jsonb; x int;
begin
  if a not between 0 and 71 or coalesce(e->'routes', '{}') ? a::text then return false; end if;
  ar := hg_ct__geo()->'aretes'->a;
  if p_depuis is not null then return p_depuis in ((ar->>'a')::int, (ar->>'b')::int); end if;
  foreach x in array array[(ar->>'a')::int, (ar->>'b')::int] loop
    if e->'colonies'->>x::text = u::text or e->'villes'->>x::text = u::text then return true; end if;
    -- par une route à moi, si le sommet n'est pas occupé par un autre joueur
    if coalesce(e->'colonies'->>x::text, e->'villes'->>x::text) is null
       and exists (select 1 from jsonb_array_elements_text(hg_ct__geo()->'sommets'->x->'aretes') b where e->'routes'->>b = u::text) then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.hg_plat__catan_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare res text[]; nums int[]; tuiles jsonb; i int; k int; ok boolean; essai int := 0; desert int; ordre uuid[]; geo jsonb := hg_ct__geo();
begin
  loop
    essai := essai + 1;
    select array_agg(x order by random()) into res from unnest(array['bois','bois','bois','bois','argile','argile','argile','ble','ble','ble','ble',
      'mouton','mouton','mouton','mouton','pierre','pierre','pierre','desert']) x;
    select array_agg(x order by random()) into nums from unnest(array[2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12]) x;
    tuiles := '[]'; k := 1;
    for i in 1..19 loop
      if res[i] = 'desert' then tuiles := tuiles || jsonb_build_object('res', 'desert', 'num', null); desert := i - 1;
      else tuiles := tuiles || jsonb_build_object('res', res[i], 'num', nums[k]); k := k + 1; end if;
    end loop;
    -- 6 et 8 jamais sur deux tuiles voisines (qui partagent un sommet)
    ok := not exists (select 1 from jsonb_array_elements(geo->'sommets') s, jsonb_array_elements_text(s->'hexes') h1, jsonb_array_elements_text(s->'hexes') h2
      where h1 < h2 and (tuiles->h1::int->>'num')::int in (6, 8) and (tuiles->h2::int->>'num')::int in (6, 8));
    exit when ok or essai > 60;
  end loop;
  select array_agg(user_id order by place) into ordre from hg_plat_joueurs where partie = p_id;
  ordre := ordre || array(select x from unnest(ordre) with ordinality o(x, n) order by n desc);
  update hg_plat_joueurs set etat = jsonb_build_object('points', 0, 'cartes', 0, 'colonies', 0, 'villes', 0, 'routes', 0),
    prive = jsonb_build_object('ressources', '{"bois":0,"argile":0,"ble":0,"mouton":0,"pierre":0}'::jsonb) where partie = p_id;
  update hg_plat_parties set nb_tours = 0, etat = jsonb_build_object('tuiles', tuiles, 'voleur', desert, 'colonies', '{}'::jsonb, 'villes', '{}'::jsonb,
    'routes', '{}'::jsonb, 'phase', 'placement', 'ordre', to_jsonb(ordre), 'etape', 0, 'sous', 'colonie', 'de', null,
    'objectif', coalesce((select (options->>'objectif')::int from hg_plat_parties where id = p_id), 10)) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'L''île est prête ! Chacun pose une colonie et une route, puis une deuxième dans l''ordre inverse.');
  perform hg_plat__donner_tour(p_id, ordre[1]);
end $$;

-- Production d'un lancer.
create or replace function public.hg_ct__produire(p_id uuid, total int)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; geo jsonb := hg_ct__geo(); h int; s text; u uuid; n int; txt text := '';
begin
  select etat into e from hg_plat_parties where id = p_id;
  for h in 0..18 loop
    if (e->'tuiles'->h->>'num')::int is distinct from total or h = (e->>'voleur')::int then continue; end if;
    for s in select jsonb_array_elements_text(geo->'hexes'->h->'sommets') loop
      u := coalesce(e->'colonies'->>s, e->'villes'->>s)::uuid;
      if u is null then continue; end if;
      n := case when e->'villes' ? s then 2 else 1 end;
      perform hg_ct__ajouter(p_id, u, jsonb_build_object(e->'tuiles'->h->>'res', n));
    end loop;
  end loop;
end $$;

-- Le joueur courant a fini sa mise en place ou son tour : suivant.
create or replace function public.hg_ct__suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; u uuid;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  if p.etat->>'phase' = 'placement' then
    if (p.etat->>'etape')::int + 1 >= jsonb_array_length(p.etat->'ordre') then
      update hg_plat_parties set nb_tours = 1, etat = etat || jsonb_build_object('phase', 'lancer', 'sous', null) where id = p_id;
      u := (p.etat->'ordre'->>0)::uuid;
      perform hg_plat__log(p_id, u, 'info', 'Mise en place terminée : ' || hg_plat__nom(p_id, u) || ' lance les dés.');
    else
      update hg_plat_parties set etat = etat || jsonb_build_object('etape', (p.etat->>'etape')::int + 1, 'sous', 'colonie') where id = p_id;
      u := (p.etat->'ordre'->>((p.etat->>'etape')::int + 1))::uuid;
    end if;
  else
    u := hg_plat__suivant(p_id, p.tour);
    update hg_plat_parties set nb_tours = nb_tours + 1, etat = etat || jsonb_build_object('phase', 'lancer', 'de', null) where id = p_id;
  end if;
  perform hg_plat__donner_tour(p_id, u);
end $$;

create or replace function public.hg_ct__victoire(p_id uuid, p_u uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare obj int;
begin
  perform hg_ct__compter(p_id);
  select coalesce((etat->>'objectif')::int, 10) into obj from hg_plat_parties where id = p_id;
  if (select (etat->>'points')::int from hg_plat_joueurs where partie = p_id and user_id = p_u) >= obj then
    update hg_plat_joueurs j set etat = j.etat || jsonb_build_object('rang', (select count(*) + 1 from hg_plat_joueurs k
      where k.partie = p_id and (k.etat->>'points')::int > (j.etat->>'points')::int)) where j.partie = p_id;
    perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' atteint ' || obj || ' points et gagne la partie !');
    perform hg_plat__terminer(p_id, array[p_u], 'points');
    return true;
  end if;
  return false;
end $$;

create or replace function public.hg_plat__catan_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; nom text := hg_plat__nom(p_id, p_u); v int; d1 int; d2 int; r record; perte int; k text; cible uuid;
  vols text[]; pris text; cout jsonb; donne text; recoit text; s text;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  e := p.etat;
  if p.tour is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;

  if e->>'phase' = 'placement' then
    if e->>'sous' = 'colonie' then
      if p_action <> 'colonie' then raise exception 'Pose d''abord une colonie.'; end if;
      v := (a->>'sommet')::int;
      if not hg_ct__colonie_ok(e, v, p_u, true) then raise exception 'Emplacement impossible : il faut au moins deux arêtes entre deux colonies.'; end if;
      e := jsonb_set(e, '{colonies}', e->'colonies' || jsonb_build_object(v::text, p_u)) || jsonb_build_object('sous', 'route', 'dernier', v);
      update hg_plat_parties set etat = e where id = p_id;
      perform hg_plat__log(p_id, p_u, 'coup', nom || ' fonde une colonie.');
      -- Deuxième colonie : ressources des tuiles voisines.
      if (e->>'etape')::int >= jsonb_array_length(e->'ordre') / 2 then
        for s in select jsonb_array_elements_text(hg_ct__geo()->'sommets'->v->'hexes') loop
          if e->'tuiles'->s::int->>'res' <> 'desert' then perform hg_ct__ajouter(p_id, p_u, jsonb_build_object(e->'tuiles'->s::int->>'res', 1)); end if;
        end loop;
      end if;
      perform hg_ct__compter(p_id);
      perform hg_plat__donner_tour(p_id, p_u);
    else
      if p_action <> 'route' then raise exception 'Pose maintenant une route à côté de ta colonie.'; end if;
      v := (a->>'arete')::int;
      if not hg_ct__route_ok(e, v, p_u, (e->>'dernier')::int) then raise exception 'La route doit toucher la colonie que tu viens de poser.'; end if;
      update hg_plat_parties set etat = jsonb_set(etat, '{routes}', etat->'routes' || jsonb_build_object(v::text, p_u)) where id = p_id;
      perform hg_ct__compter(p_id);
      perform hg_ct__suivant(p_id);
    end if;
    return '{}'::jsonb;
  end if;

  if e->>'phase' = 'lancer' then
    if p_action <> 'lancer' then raise exception 'Lance d''abord les dés.'; end if;
    d1 := 1 + floor(random() * 6)::int; d2 := 1 + floor(random() * 6)::int;
    update hg_plat_parties set etat = etat || jsonb_build_object('de', jsonb_build_array(d1, d2)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' lance les dés : ' || d1 || ' + ' || d2 || ' = ' || (d1 + d2) || '.');
    if d1 + d2 = 7 then
      for r in select user_id, prive from hg_plat_joueurs where partie = p_id loop
        perte := (select sum(v2::int) from jsonb_each_text(coalesce(r.prive->'ressources', '{}')) x(k2, v2)) / 2;
        if (select sum(v2::int) from jsonb_each_text(coalesce(r.prive->'ressources', '{}')) x(k2, v2)) > 7 then
          for i in 1..perte loop
            select x.k2 into k from jsonb_each_text(hg_ct__res(p_id, r.user_id)) x(k2, v2) where v2::int > 0 order by random() limit 1;
            perform hg_ct__ajouter(p_id, r.user_id, jsonb_build_object(k, -1));
          end loop;
          perform hg_plat__log(p_id, r.user_id, 'info', hg_plat__nom(p_id, r.user_id) || ' défausse ' || perte || ' cartes.');
        end if;
      end loop;
      update hg_plat_parties set etat = etat || '{"phase": "voleur"}'::jsonb where id = p_id;
    else
      perform hg_ct__produire(p_id, d1 + d2);
      update hg_plat_parties set etat = etat || '{"phase": "action"}'::jsonb where id = p_id;
    end if;
    perform hg_plat__donner_tour(p_id, p_u);
    return '{}'::jsonb;
  end if;

  if e->>'phase' = 'voleur' then
    if p_action <> 'voleur' then raise exception 'Déplace d''abord le voleur.'; end if;
    v := (a->>'hexe')::int;
    if v not between 0 and 18 or v = (e->>'voleur')::int then raise exception 'Choisis une autre tuile.'; end if;
    update hg_plat_parties set etat = etat || jsonb_build_object('voleur', v, 'phase', 'action') where id = p_id;
    -- Vol : la cible choisie si elle est voisine de la tuile, sinon un voisin au hasard qui a des cartes.
    select x::uuid into cible from (select coalesce(e->'colonies'->>s2, e->'villes'->>s2) x from jsonb_array_elements_text(hg_ct__geo()->'hexes'->v->'sommets') s2) z
      where x is not null and x <> p_u::text and (select coalesce((etat->>'cartes')::int, 0) from hg_plat_joueurs where partie = p_id and user_id = x::uuid) > 0
      order by (x = a->>'cible') desc, random() limit 1;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' déplace le voleur.');
    if cible is not null then
      select x.k2 into pris from jsonb_each_text(hg_ct__res(p_id, cible)) x(k2, v2) where v2::int > 0 order by random() limit 1;
      perform hg_ct__ajouter(p_id, cible, jsonb_build_object(pris, -1));
      perform hg_ct__ajouter(p_id, p_u, jsonb_build_object(pris, 1));
      perform hg_plat__log(p_id, p_u, 'info', nom || ' vole une carte à ' || hg_plat__nom(p_id, cible) || '.');
      perform hg_plat__log(p_id, p_u, 'info', 'Tu voles : ' || pris || '.', p_u);
    end if;
    perform hg_plat__donner_tour(p_id, p_u);
    return '{}'::jsonb;
  end if;

  if e->>'phase' <> 'action' then raise exception 'Action impossible maintenant.'; end if;
  if p_action = 'route' then
    v := (a->>'arete')::int;
    if (select count(*) from jsonb_each_text(e->'routes') x where x.value = p_u::text) >= 15 then raise exception 'Tu as déjà 15 routes.'; end if;
    if not hg_ct__route_ok(e, v, p_u, null) then raise exception 'La route doit prolonger ton réseau.'; end if;
    perform hg_ct__ajouter(p_id, p_u, '{"bois": -1, "argile": -1}');
    update hg_plat_parties set etat = jsonb_set(etat, '{routes}', etat->'routes' || jsonb_build_object(v::text, p_u)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' construit une route.');
  elsif p_action = 'colonie' then
    v := (a->>'sommet')::int;
    if (select count(*) from jsonb_each_text(e->'colonies') x where x.value = p_u::text) >= 5 then raise exception 'Tu as déjà 5 colonies : transforme-en une en ville.'; end if;
    if not hg_ct__colonie_ok(e, v, p_u, false) then raise exception 'Emplacement impossible : libre, à deux arêtes des autres colonies et relié à une de tes routes.'; end if;
    perform hg_ct__ajouter(p_id, p_u, '{"bois": -1, "argile": -1, "ble": -1, "mouton": -1}');
    update hg_plat_parties set etat = jsonb_set(etat, '{colonies}', etat->'colonies' || jsonb_build_object(v::text, p_u)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' fonde une colonie.');
    if hg_ct__victoire(p_id, p_u) then return '{}'::jsonb; end if;
  elsif p_action = 'ville' then
    v := (a->>'sommet')::int;
    if e->'colonies'->>v::text is distinct from p_u::text then raise exception 'Une ville se construit sur une de tes colonies.'; end if;
    if (select count(*) from jsonb_each_text(e->'villes') x where x.value = p_u::text) >= 4 then raise exception 'Tu as déjà 4 villes.'; end if;
    perform hg_ct__ajouter(p_id, p_u, '{"ble": -2, "pierre": -3}');
    update hg_plat_parties set etat = jsonb_set(jsonb_set(etat, '{colonies}', (etat->'colonies') - v::text), '{villes}', etat->'villes' || jsonb_build_object(v::text, p_u)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' agrandit une colonie en ville.');
    if hg_ct__victoire(p_id, p_u) then return '{}'::jsonb; end if;
  elsif p_action = 'echanger' then
    donne := a->>'donne'; recoit := a->>'recoit';
    if donne not in ('bois', 'argile', 'ble', 'mouton', 'pierre') or recoit not in ('bois', 'argile', 'ble', 'mouton', 'pierre') or donne = recoit then raise exception 'Échange invalide.'; end if;
    perform hg_ct__ajouter(p_id, p_u, jsonb_build_object(donne, -4, recoit, 1));
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' échange 4 ' || donne || ' contre 1 ' || recoit || ' avec la banque.');
  elsif p_action = 'finir' then
    perform hg_ct__suivant(p_id);
    return '{}'::jsonb;
  else
    raise exception 'Action inconnue.';
  end if;
  perform hg_ct__compter(p_id);
  perform hg_plat__donner_tour(p_id, p_u);
  return '{}'::jsonb;
end $$;

-- Meilleur sommet libre (somme des chances de production des tuiles voisines), éventuellement relié à mes routes.
create or replace function public.hg_ct__meilleur_sommet(e jsonb, u uuid, p_placement boolean)
returns int language sql stable as $$
  select (s->>'id')::int from jsonb_array_elements(public.hg_ct__geo()->'sommets') s
  where public.hg_ct__colonie_ok(e, (s->>'id')::int, u, p_placement)
  order by (select coalesce(sum(public.hg_ct__pips((e->'tuiles'->h::int->>'num')::int)), 0) from jsonb_array_elements_text(s->'hexes') h) desc, random()
  limit 1 $$;

-- Absent : lance les dés, place le voleur et passe. Robot : construit ce qu'il peut (ville, colonie, route), échange 4 contre 1.
create or replace function public.hg_plat__catan_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; u uuid; robot boolean; v int; res jsonb; k text; manque text; h int;
begin
  select * into p from hg_plat_parties where id = p_id;
  u := p.tour; e := p.etat;
  if u is null then return false; end if;
  select invite into robot from hg_plat_joueurs where partie = p_id and user_id = u;
  if e->>'phase' = 'placement' then
    if e->>'sous' = 'colonie' then perform hg_plat__catan_agir(p_id, u, 'colonie', jsonb_build_object('sommet', hg_ct__meilleur_sommet(e, u, true)));
    else
      select (x)::int into v from jsonb_array_elements_text(hg_ct__geo()->'sommets'->(e->>'dernier')::int->'aretes') x
        where hg_ct__route_ok(e, x::int, u, (e->>'dernier')::int) order by random() limit 1;
      perform hg_plat__catan_agir(p_id, u, 'route', jsonb_build_object('arete', v));
    end if;
    return true;
  end if;
  if e->>'phase' = 'lancer' then perform hg_plat__catan_agir(p_id, u, 'lancer', '{}'); return true; end if;
  if e->>'phase' = 'voleur' then
    -- La tuile la plus productive qui ne touche aucune de mes constructions.
    select (hx->>'id')::int into h from jsonb_array_elements(hg_ct__geo()->'hexes') hx
      where (hx->>'id')::int <> (e->>'voleur')::int
        and not exists (select 1 from jsonb_array_elements_text(hx->'sommets') s where coalesce(e->'colonies'->>s, e->'villes'->>s) = u::text)
      order by (select count(*) from jsonb_array_elements_text(hx->'sommets') s where coalesce(e->'colonies'->>s, e->'villes'->>s) is not null) desc,
        hg_ct__pips((e->'tuiles'->(hx->>'id')::int->>'num')::int) desc limit 1;
    perform hg_plat__catan_agir(p_id, u, 'voleur', jsonb_build_object('hexe', coalesce(h, case when (e->>'voleur')::int = 0 then 1 else 0 end)));
    return true;
  end if;
  if e->>'phase' = 'action' and robot then
    res := hg_ct__res(p_id, u);
    -- ville
    if (res->>'ble')::int >= 2 and (res->>'pierre')::int >= 3 then
      select x.key::int into v from jsonb_each_text(e->'colonies') x where x.value = u::text limit 1;
      if v is not null and (select count(*) from jsonb_each_text(e->'villes') x where x.value = u::text) < 4 then
        perform hg_plat__catan_agir(p_id, u, 'ville', jsonb_build_object('sommet', v)); return true;
      end if;
    end if;
    -- colonie
    if (res->>'bois')::int >= 1 and (res->>'argile')::int >= 1 and (res->>'ble')::int >= 1 and (res->>'mouton')::int >= 1 then
      v := hg_ct__meilleur_sommet(e, u, false);
      if v is not null and (select count(*) from jsonb_each_text(e->'colonies') x where x.value = u::text) < 5 then
        perform hg_plat__catan_agir(p_id, u, 'colonie', jsonb_build_object('sommet', v)); return true;
      end if;
    end if;
    -- route (si aucune colonie n'est possible faute d'emplacement), au plus 15
    if (res->>'bois')::int >= 1 and (res->>'argile')::int >= 1 and hg_ct__meilleur_sommet(e, u, false) is null
       and (select count(*) from jsonb_each_text(e->'routes') x where x.value = u::text) < 15 then
      select (ar->>'id')::int into v from jsonb_array_elements(hg_ct__geo()->'aretes') ar
        where hg_ct__route_ok(e, (ar->>'id')::int, u, null) order by random() limit 1;
      if v is not null then perform hg_plat__catan_agir(p_id, u, 'route', jsonb_build_object('arete', v)); return true; end if;
    end if;
    -- échange 4 contre 1 vers la ressource qui manque le plus
    select x.k2 into k from jsonb_each_text(res) x(k2, v2) where v2::int >= 5 order by v2::int desc limit 1;
    select x.k2 into manque from jsonb_each_text(res) x(k2, v2) where x.k2 <> coalesce(k, '') order by v2::int, random() limit 1;
    if k is not null and manque is not null then
      perform hg_plat__catan_agir(p_id, u, 'echanger', jsonb_build_object('donne', k, 'recoit', manque)); return true;
    end if;
  end if;
  perform hg_plat__catan_agir(p_id, u, 'finir', '{}');
  return true;
end $$;

create or replace function public.hg_plat__catan_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  return jsonb_build_object('geo', hg_ct__geo(), 'tuiles', e->'tuiles', 'voleur', e->'voleur', 'colonies', e->'colonies', 'villes', e->'villes',
    'routes', e->'routes', 'phase', e->>'phase', 'sous', e->>'sous', 'dernier', e->'dernier', 'de', e->'de', 'objectif', e->'objectif',
    'mes_ressources', (select prive->'ressources' from hg_plat_joueurs where partie = p_id and user_id = p_moi),
    'couts', jsonb_build_object('route', jsonb_build_object('bois', 1, 'argile', 1), 'colonie', jsonb_build_object('bois', 1, 'argile', 1, 'ble', 1, 'mouton', 1),
      'ville', jsonb_build_object('ble', 2, 'pierre', 3)));
end $$;

revoke all on function public.hg_ct__ajouter(uuid, uuid, jsonb), public.hg_ct__compter(uuid), public.hg_ct__produire(uuid, int), public.hg_ct__suivant(uuid),
  public.hg_ct__victoire(uuid, uuid), public.hg_plat__catan_agir(uuid, uuid, text, jsonb), public.hg_plat__catan_auto(uuid), public.hg_plat__catan_lancer(uuid)
  from public, anon, authenticated;
