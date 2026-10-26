-- ===== Humane Gang — migration 139 : chargement des réserves et import des images des jeux du jour =====
-- La fonction edge hg-nj-images (clé de service) charge les réserves du dépôt (outils/nj/reserves/*.json) avec
-- hg_nj_import_lot, puis remplit les images : hg_nj_images_a_faire réserve un lot d'éléments sans image (verrou
-- « skip locked » : deux appels simultanés ne prennent pas les mêmes), hg_nj_image_ok enregistre l'adresse ou l'erreur.
-- Ces deux fonctions ne sont exécutables que par la clé de service.

-- Chargement en lot : admins, ou clé de service (fonction edge).
create or replace function public.hg_nj_import_lot(p_jeu text, p_items jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not (coalesce(hg_is_admin(), false) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Réservé aux administrateurs'; end if;
  if p_jeu not in ('jv', 'pochette', 'replique', 'pays', 'plat') then raise exception 'Jeu inconnu'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into hg_nj_items (jeu, reponse, libelle, variantes, indices, media, source, difficulte, image)
    values (p_jeu, btrim(e->>'reponse'), nullif(btrim(e->>'libelle'), ''),
      coalesce((select array_agg(v) from jsonb_array_elements_text(e->'variantes') v), '{}'),
      coalesce((select array_agg(v) from jsonb_array_elements_text(e->'indices') v), '{}'),
      coalesce(e->'media', '{}'::jsonb), nullif(e->'source', 'null'::jsonb), coalesce((e->>'difficulte')::smallint, 2), e->>'image')
    on conflict (jeu, lower(reponse), coalesce(libelle, '')) do update set
      variantes = excluded.variantes, indices = excluded.indices, media = excluded.media,
      source = coalesce(excluded.source, hg_nj_items.source), difficulte = excluded.difficulte,
      image = coalesce(excluded.image, hg_nj_items.image), updated_at = now();
    n := n + 1;
  end loop;
  if auth.uid() is not null then
    insert into hg_admin_log (admin_id, action, target_ref, details) values (auth.uid(), 'jeux.nj_import', p_jeu, jsonb_build_object('n', n));
  end if;
  return n;
end $$;

-- Réserve jusqu'à p_n éléments à illustrer (source connue, pas d'image, moins de 3 essais).
create or replace function public.hg_nj_images_a_faire(p_n int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare ids uuid[];
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Réservé à la fonction edge'; end if;
  select array_agg(id) into ids from (
    select id from hg_nj_items
    where image is null and source is not null and import_essais < 3
      and (import_erreur is distinct from 'en cours' or updated_at < now() - interval '10 minutes')
    order by import_essais, created_at limit least(greatest(p_n, 1), 40) for update skip locked) x;
  if ids is null then return '[]'::jsonb; end if;
  update hg_nj_items set import_essais = import_essais + 1, import_erreur = 'en cours', updated_at = now() where id = any (ids);
  return (select jsonb_agg(jsonb_build_object('id', id, 'jeu', jeu, 'source', source)) from hg_nj_items where id = any (ids));
end $$;

-- Résultat de l'import d'une image : adresse publique, ou message d'erreur.
create or replace function public.hg_nj_image_ok(p_id uuid, p_image text, p_erreur text, p_media jsonb default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Réservé à la fonction edge'; end if;
  update hg_nj_items set image = coalesce(p_image, image), import_erreur = case when p_image is null then left(p_erreur, 300) end,
    media = case when p_media is null then media else media || p_media end, updated_at = now() where id = p_id;
end $$;

revoke all on function public.hg_nj_images_a_faire(int), public.hg_nj_image_ok(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hg_nj_images_a_faire(int), public.hg_nj_image_ok(uuid, text, text, jsonb) to service_role;
grant execute on function public.hg_nj_import_lot(text, jsonb) to service_role;
