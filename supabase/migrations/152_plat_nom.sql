-- ===== Humane Gang — migration 152 : Plat du jour, on devine le NOM du plat (et plus son pays) =====
-- Réponses possibles : les noms des plats (libellé et variantes). La bonne réponse est le plat de la photo.
-- Un essai raté donne la distance et la direction entre le pays du plat proposé et celui du plat à trouver
-- (0 km = même pays). Le pays devient un indice (le 4e) ; le dernier indice donne l'initiale et la longueur du nom.
-- hg_nj__contenu (plat) : 'reponse' = nom du plat, 'pays' = pays d'origine. hg_nj__coord accepte aussi un nom de plat.

-- Réponses possibles d'un jeu (liste fermée) : libellé affiché et clés acceptées (normalisées).
create or replace function public.hg_nj__candidats(p_jeu text)
returns table (libelle text, cles text[]) language sql stable security definer set search_path = public as $$
  select x.libelle, array_agg(distinct x.cle) from (
    select i.reponse as libelle, public.hg_nj_norm(v) as cle
      from hg_nj_items i, unnest(array[i.reponse] || i.variantes) v
      where i.actif and ((p_jeu = 'pays' and i.jeu = 'pays') or (p_jeu in ('jv', 'replique') and i.jeu = p_jeu))
    union all
    select coalesce(i.libelle, i.reponse), public.hg_nj_norm(v)
      from hg_nj_items i, unnest(array[coalesce(i.libelle, i.reponse)] || i.variantes) v
      where i.actif and p_jeu = 'plat' and i.jeu = 'plat'
    union all
    select coalesce(i.libelle, i.reponse), public.hg_nj_norm(v)
      from hg_nj_items i, unnest(array[i.reponse, coalesce(i.libelle, i.reponse)] || i.variantes) v
      where i.actif and p_jeu = 'pochette' and i.jeu = 'pochette'
    union all
    select c.name, public.hg_nj_norm(c.name)
      from hg_cards c where p_jeu = 'carte' and c.active and c.image_url is not null
  ) x where x.cle <> '' group by x.libelle $$;
revoke all on function public.hg_nj__candidats(text) from public, anon, authenticated;

-- Coordonnées de la capitale d'un pays (par libellé) ; pour un nom de plat, celles de son pays d'origine.
create or replace function public.hg_nj__coord(p_nom text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select i.media from hg_nj_items i where i.jeu = 'pays' and i.actif
      and (public.hg_nj_norm(i.reponse) = public.hg_nj_norm(p_nom) or public.hg_nj_norm(p_nom) = any (select public.hg_nj_norm(v) from unnest(i.variantes) v))
      limit 1),
    (select c.media from hg_nj_items pl join hg_nj_items c on c.jeu = 'pays' and c.actif and public.hg_nj_norm(c.reponse) = public.hg_nj_norm(pl.reponse)
      where pl.jeu = 'plat' and (public.hg_nj_norm(coalesce(pl.libelle, pl.reponse)) = public.hg_nj_norm(p_nom)
        or public.hg_nj_norm(p_nom) = any (select public.hg_nj_norm(v) from unnest(pl.variantes) v))
      limit 1)) $$;
revoke all on function public.hg_nj__coord(text) from public, anon, authenticated;

-- Contenu d'une manche de plat : la réponse est le nom du plat, le pays est à part.
select public.hg__patch('public.hg_nj__contenu(public.hg_nj_rounds)'::regprocedure,
  $o$return jsonb_build_object('reponse', i.reponse, 'libelle', coalesce(i.libelle, i.reponse), 'image', i.image,$o$,
  $n$return jsonb_build_object('reponse', case when r.jeu = 'plat' then coalesce(i.libelle, i.reponse) else i.reponse end,
    'pays', case when r.jeu = 'plat' then i.reponse end, 'libelle', coalesce(i.libelle, i.reponse), 'image', i.image,$n$);

-- État : la cible des distances est le pays du plat ; la réponse de fin donne aussi le pays.
select public.hg__patch('public.hg_nj_etat(text)'::regprocedure,
  $o$cible := case when p_jeu = 'pays' then k->'media' else hg_nj__coord(k->>'reponse') end;$o$,
  $n$cible := case when p_jeu = 'pays' then k->'media' else hg_nj__coord(k->>'pays') end;$n$);
select public.hg__patch('public.hg_nj_etat(text)'::regprocedure,
  $o$'reponse', case when fini then jsonb_build_object('titre', k->>'libelle', 'reponse', k->>'reponse', 'details', k->'details',$o$,
  $n$'reponse', case when fini then jsonb_build_object('titre', k->>'libelle', 'reponse', k->>'reponse', 'pays', k->>'pays', 'details', k->'details',$n$);

-- Indices des plats : trois indices de description, puis le pays, puis l'initiale et la longueur du nom.
update public.hg_nj_items set indices =
  (select array_agg(x order by o) from unnest(indices) with ordinality u(x, o) where x not like 'Nom du plat :%')
  || array['Pays d''origine : ' || reponse,
           'Commence par « ' || upper(left(coalesce(libelle, reponse), 1)) || ' » · ' || char_length(coalesce(libelle, reponse)) || ' caractères']
where jeu = 'plat' and not ('Pays d''origine : ' || reponse = any (indices));
