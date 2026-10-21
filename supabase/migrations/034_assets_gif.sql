-- 034 — Le stockage hg-assets accepte les GIF (images de cartes, d'événements et logos animés),
-- comme le prévoient les formulaires de l'admin.
update storage.buckets
   set allowed_mime_types = array(select distinct unnest(coalesce(allowed_mime_types, '{}') || array['image/gif']))
 where id = 'hg-assets';
