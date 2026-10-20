-- ===== Humane Gang : admin — remplacement des fichiers dans hg-assets =====
-- Le Storage exige SELECT + INSERT + UPDATE pour un upload en `upsert: true`
-- (remplacer cartes/base-<année>.<ext> ou badges/<code>.png déjà existants).
-- Le bucket est public (lecture par URL publique) ; cette policy ne concerne que l'API Storage authentifiée.
-- (déjà appliquée le 20.10.2026, avec la policy équivalente pour les avatars)
create policy hg_assets_obj_admin_sel on storage.objects for select to authenticated
  using (bucket_id = 'hg-assets' and public.hg_is_admin());
create policy hg_avatars_obj_sel on storage.objects for select to authenticated
  using (bucket_id = 'hg-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
