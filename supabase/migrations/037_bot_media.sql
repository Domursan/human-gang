-- 037 — Pièces jointes des annonces du bot (images, GIF, vidéos, sons, PDF), stockage privé hg-bot-media.
-- Le bot (fonction hg-notify, clé de service) lit le fichier et l'envoie à Discord en pièce jointe.
-- Limite 10 Mo : c'est la taille maximale d'envoi d'un bot sur un serveur Discord sans boost.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hg-bot-media', 'hg-bot-media', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
              'audio/mpeg','audio/ogg','audio/wav','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hg_bot_media_rw') then
    create policy hg_bot_media_rw on storage.objects for all to authenticated
      using (bucket_id = 'hg-bot-media' and public.hg_has_perm('bot'))
      with check (bucket_id = 'hg-bot-media' and public.hg_has_perm('bot'));
  end if;
end $$;
