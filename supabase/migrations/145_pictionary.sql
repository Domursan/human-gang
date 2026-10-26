-- ===== Humane Gang — migration 145 : Pictionary (salon : un joueur dessine, les autres devinent), en développement =====
-- Sur le moteur des jeux de plateau (2 à 10 joueurs ; page « pictionary » en mode admin).
-- Options : { manches: 1 | 2 | 3 (chacun dessine une fois par manche), duree: 60 | 80 | 100 secondes par dessin }.
-- Déroulé d'un tour : le dessinateur choisit un mot parmi 3 (action 'choisir' { mot }, 20 s, sinon le premier) ; il dessine
--   (les traits passent en direct par un canal temps réel « pict:<id de partie> » ; il enregistre aussi le dessin complet
--   de temps en temps avec l'action 'dessin' { traits } pour ceux qui arrivent en cours de route) ; les autres proposent
--   (action 'deviner' { texte }) : bonne réponse = 10 points + le temps restant / 10 ; le dessinateur gagne 4 points par joueur
--   qui trouve. Une proposition fausse s'affiche dans le journal (une proposition « presque » juste n'est montrée qu'à son
--   auteur). Des lettres du mot se dévoilent à mi-temps et aux trois quarts. Fin du tour : tout le monde a trouvé ou le
--   temps est écoulé ; le mot est alors révélé.
-- Mots : réserve hg_nj_contenus (jeu 'pictionary', chargée depuis outils/nj/reserves/pictionary.json).

alter table public.hg_nj_contenus drop constraint if exists hg_nj_contenus_jeu_check;
alter table public.hg_nj_contenus add constraint hg_nj_contenus_jeu_check check (jeu in ('connexions', 'motmele', 'motscroises', 'dico', 'pictionary'));

create or replace function public.hg_nj_contenu_lot(p_jeu text, p_items jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not (coalesce(hg_is_admin(), false) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Réservé aux administrateurs'; end if;
  if p_jeu not in ('connexions', 'motmele', 'motscroises', 'dico', 'pictionary') then raise exception 'Jeu inconnu'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into hg_nj_contenus (jeu, cle, data) values (p_jeu,
      case when p_jeu in ('dico', 'pictionary') then e->>'mot' else md5(e::text) end, e)
    on conflict (jeu, cle) do update set data = excluded.data;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.hg_plat__pictionary_options(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('manches', case when (p->>'manches') in ('1', '2', '3') then (p->>'manches')::int else 2 end,
    'duree', case when (p->>'duree') in ('60', '80', '100') then (p->>'duree')::int else 80 end) $$;

-- Indice affiché : une case par lettre (« _ »), espaces et tirets gardés, p_lettres lettres dévoilées (positions tirées du mot).
create or replace function public.hg_pi__indice(p_mot text, p_lettres int)
returns text language sql immutable as $$
  select string_agg(case when ch in (' ', '-', '''') then ch when i in (
      select j from generate_series(1, char_length(p_mot)) j where substr(p_mot, j, 1) not in (' ', '-', '''') order by md5(p_mot || j) limit greatest(p_lettres, 0))
    then ch else '_' end, ' ' order by i)
  from (select i, substr(p_mot, i, 1) ch from generate_series(1, char_length(p_mot)) i) x $$;

-- Tour suivant : prochain dessinateur (ordre des places), ou fin de partie.
create or replace function public.hg_pi__tour(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; idx int; n int; dess uuid; choix jsonb;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  e := p.etat;
  n := (select count(*) from hg_plat_joueurs where partie = p_id and not elimine);
  idx := coalesce((e->>'tour_n')::int, 0) + 1;
  if idx > n * coalesce((p.options->>'manches')::int, 2) or n < 2 then perform hg_pi__fin(p_id); return; end if;
  select user_id into dess from hg_plat_joueurs where partie = p_id and not elimine order by place offset ((idx - 1) % n) limit 1;
  select jsonb_agg(m) into choix from (select c.data->>'mot' m from hg_nj_contenus c where c.jeu = 'pictionary' and c.actif
    and not coalesce(e->'deja', '[]'::jsonb) ? (c.data->>'mot') order by (c.data->>'niveau')::int = (1 + floor(random() * 3))::int desc, random() limit 3) z;
  if choix is null then choix := '["raclette", "montagne", "chat"]'::jsonb; end if;
  update hg_plat_parties set nb_tours = 1 + (idx - 1) / n, etat = jsonb_build_object('phase', 'choix', 'tour_n', idx, 'dessinateur', dess,
    'choix', choix, 'mot', null, 'trouves', '[]'::jsonb, 'traits', '[]'::jsonb, 'debut', null, 'deja', coalesce(e->'deja', '[]'::jsonb),
    'precedent', e->'revele') where id = p_id;
  update hg_plat_parties set tour = dess, tour_fin = now() + interval '20 seconds' where id = p_id;
  perform hg_plat__log(p_id, dess, 'info', 'Manche ' || (1 + (idx - 1) / n) || ' : ' || hg_plat__nom(p_id, dess) || ' choisit un mot à dessiner.');
end $$;

create or replace function public.hg_pi__fin_dessin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id for update;
  if e->>'phase' <> 'dessin' then return; end if;
  perform hg_plat__log(p_id, (e->>'dessinateur')::uuid, 'info', 'Le mot était : « ' || (e->>'mot') || ' » (' || jsonb_array_length(e->'trouves') || ' joueur(s) ont trouvé).');
  update hg_plat_parties set etat = etat || jsonb_build_object('revele', jsonb_build_object('mot', e->>'mot', 'dessinateur', e->'dessinateur',
    'trouves', e->'trouves', 'traits', e->'traits')) where id = p_id;
  perform hg_pi__tour(p_id);
end $$;

create or replace function public.hg_pi__fin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_max int; v_g uuid[];
begin
  select max(coalesce((etat->>'points')::int, 0)) into v_max from hg_plat_joueurs where partie = p_id;
  select array_agg(user_id) into v_g from hg_plat_joueurs where partie = p_id and coalesce((etat->>'points')::int, 0) = v_max and v_max > 0;
  update hg_plat_joueurs j set etat = j.etat || jsonb_build_object('rang', (select count(*) + 1 from hg_plat_joueurs k
    where k.partie = p_id and coalesce((k.etat->>'points')::int, 0) > coalesce((j.etat->>'points')::int, 0))) where j.partie = p_id;
  perform hg_plat__terminer(p_id, v_g, 'points');
end $$;

create or replace function public.hg_plat__pictionary_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update hg_plat_joueurs set etat = jsonb_build_object('points', 0) where partie = p_id;
  update hg_plat_parties set nb_tours = 1, etat = jsonb_build_object('tour_n', 0, 'deja', '[]'::jsonb) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'À vos crayons ! Chacun dessine à son tour, les autres devinent.');
  perform hg_pi__tour(p_id);
end $$;

create or replace function public.hg_plat__pictionary_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; m text; t text; reste numeric; pts int; n_dev int; nom text := hg_plat__nom(p_id, p_u);
begin
  select * into p from hg_plat_parties where id = p_id for update;
  e := p.etat;
  if p_action = 'choisir' then
    if e->>'phase' <> 'choix' or e->>'dessinateur' <> p_u::text then raise exception 'Ce n''est pas à toi de choisir.'; end if;
    m := a->>'mot';
    if not coalesce(e->'choix', '[]'::jsonb) ? m then raise exception 'Choisis un des trois mots proposés.'; end if;
    update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'dessin', 'mot', m, 'debut', now(), 'deja', coalesce(etat->'deja', '[]'::jsonb) || to_jsonb(m)),
      tour_fin = now() + make_interval(secs => coalesce((options->>'duree')::int, 80)) where id = p_id;
    perform hg_plat__log(p_id, p_u, 'info', nom || ' dessine (' || char_length(m) || ' lettres).');
    return '{}'::jsonb;
  end if;
  if p_action = 'dessin' then
    if e->>'phase' <> 'dessin' or e->>'dessinateur' <> p_u::text then raise exception 'Ce n''est pas toi qui dessines.'; end if;
    if octet_length((a->'traits')::text) > 200000 then raise exception 'Dessin trop lourd.'; end if;
    update hg_plat_parties set etat = jsonb_set(etat, '{traits}', coalesce(a->'traits', '[]'::jsonb)) where id = p_id;
    return '{}'::jsonb;
  end if;
  if p_action = 'deviner' then
    if e->>'phase' <> 'dessin' then raise exception 'Attends que le dessin commence.'; end if;
    if e->>'dessinateur' = p_u::text then raise exception 'Tu dessines : pas de proposition !'; end if;
    if coalesce(e->'trouves', '[]'::jsonb) ? p_u::text then raise exception 'Tu as déjà trouvé.'; end if;
    t := btrim(coalesce(a->>'texte', ''));
    if t = '' or char_length(t) > 60 then raise exception 'Proposition vide ou trop longue.'; end if;
    if hg_nj_norm(t) = hg_nj_norm(e->>'mot') then
      reste := greatest(0, extract(epoch from p.tour_fin - now()));
      pts := 10 + floor(reste / 10)::int;
      update hg_plat_joueurs set etat = jsonb_set(etat, '{points}', to_jsonb(coalesce((etat->>'points')::int, 0) + pts)) where partie = p_id and user_id = p_u;
      update hg_plat_joueurs set etat = jsonb_set(etat, '{points}', to_jsonb(coalesce((etat->>'points')::int, 0) + 4))
        where partie = p_id and user_id = (e->>'dessinateur')::uuid;
      update hg_plat_parties set etat = jsonb_set(etat, '{trouves}', coalesce(etat->'trouves', '[]'::jsonb) || to_jsonb(p_u::text)) where id = p_id;
      perform hg_plat__log(p_id, p_u, 'trouve', nom || ' a trouvé ! (+' || pts || ')');
      select count(*) into n_dev from hg_plat_joueurs where partie = p_id and not elimine and user_id <> (e->>'dessinateur')::uuid;
      if jsonb_array_length(coalesce(e->'trouves', '[]'::jsonb)) + 1 >= n_dev then perform hg_pi__fin_dessin(p_id); end if;
      return jsonb_build_object('ok', true, 'points', pts);
    end if;
    -- Presque : même mot à une lettre près (ou contenu dans le mot) : seulement pour l'auteur.
    if levenshtein_ok(hg_nj_norm(t), hg_nj_norm(e->>'mot')) then
      perform hg_plat__log(p_id, p_u, 'info', '« ' || t || ' » : presque !', p_u);
    else
      perform hg_plat__log(p_id, p_u, 'propose', nom || ' : ' || t);
    end if;
    return jsonb_build_object('ok', false);
  end if;
  raise exception 'Action inconnue.';
end $$;

-- Proche à une lettre près (substitution, ajout ou retrait), sans extension fuzzystrmatch.
create or replace function public.levenshtein_ok(a text, b text)
returns boolean language plpgsql immutable as $$
declare i int := 1; la int := char_length(a); lb int := char_length(b);
begin
  if a = b or abs(la - lb) > 1 or la < 3 then return false; end if;
  while i <= least(la, lb) and substr(a, i, 1) = substr(b, i, 1) loop i := i + 1; end loop;
  if la = lb then return substr(a, i + 1) = substr(b, i + 1); end if;
  if la > lb then return substr(a, i + 1) = substr(b, i); end if;
  return substr(a, i) = substr(b, i + 1);
end $$;

-- Temps écoulé : choix automatique du premier mot, ou fin du dessin.
create or replace function public.hg_plat__pictionary_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  if e->>'phase' = 'choix' then
    perform hg_plat__pictionary_agir(p_id, (e->>'dessinateur')::uuid, 'choisir', jsonb_build_object('mot', e->'choix'->>0));
    return true;
  end if;
  if e->>'phase' = 'dessin' then perform hg_pi__fin_dessin(p_id); return true; end if;
  return false;
end $$;

create or replace function public.hg_plat__pictionary_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; dess boolean; ecoule numeric; duree int; lettres int;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; dess := e->>'dessinateur' = p_moi::text;
  duree := coalesce((p.options->>'duree')::int, 80);
  ecoule := case when e->>'debut' is null then 0 else extract(epoch from now() - (e->>'debut')::timestamptz) end;
  lettres := case when ecoule >= duree * 0.75 then 2 when ecoule >= duree * 0.5 then 1 else 0 end;
  return jsonb_build_object('phase', e->>'phase', 'dessinateur', e->'dessinateur', 'manche', p.nb_tours,
    'manches', coalesce((p.options->>'manches')::int, 2), 'duree', duree, 'tour_n', e->'tour_n',
    'choix', case when dess and e->>'phase' = 'choix' then e->'choix' end,
    'mot', case when dess or coalesce(e->'trouves', '[]'::jsonb) ? p_moi::text then e->>'mot' end,
    'indice', case when e->>'mot' is not null then hg_pi__indice(e->>'mot', lettres) end,
    'trouves', coalesce(e->'trouves', '[]'::jsonb), 'traits', coalesce(e->'traits', '[]'::jsonb),
    'precedent', e->'precedent', 'canal', 'pict:' || p_id::text);
end $$;

revoke all on function public.hg_pi__tour(uuid), public.hg_pi__fin_dessin(uuid), public.hg_pi__fin(uuid),
  public.hg_plat__pictionary_agir(uuid, uuid, text, jsonb), public.hg_plat__pictionary_auto(uuid), public.hg_plat__pictionary_lancer(uuid)
  from public, anon, authenticated;
