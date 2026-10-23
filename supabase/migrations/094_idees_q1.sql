-- ===== Humane Gang — 094 : idées Qualité (paquet xQ1 : Q1 visite guidée, Q3 vignettes des photos) =====
-- Rôle :
--   Q1  hg_profiles.tour_done_at : date de la visite guidée (null = jamais vue → visite au prochain accueil).
--       Rattrapage à la création de la colonne seulement : les profils existants reçoivent 1970-01-01, qui veut dire
--       « inscrit avant la visite » (le site leur propose un bandeau une seule fois, puis écrit la vraie date).
--       La garde hg_profiles_guard (073) laisse déjà un membre écrire ce champ sur son propre profil, et le Staff
--       « membres » sur celui d'un autre (relancer la visite) : rien à ajouter. Aucune récompense, donc aucune RPC.
--   Q3  hg_photos.thumb_path, width, height : vignette 480 px et dimensions de la photo (pour réserver la place à
--       l'affichage). Le chemin de la vignette est imposé : <path>.thumb.webp (contrainte), il reste donc dans le
--       dossier du membre et ne peut pointer vers aucun autre fichier. Dimensions bornées (1 à 20 000 px).
--       Stockage : le Staff « souvenirs » peut déposer la vignette d'une photo existante dans le dossier de son
--       auteur (bouton « Générer les vignettes manquantes »), et seulement un fichier <path>.thumb.webp d'une ligne
--       hg_photos. Les autres règles du bucket hg-photos sont inchangées.
-- Idempotente, rétrocompatible (colonnes facultatives ; aucune policy de table modifiée).

-- ---------------------------------------------------------------------
-- Q1. Visite guidée
-- ---------------------------------------------------------------------
do $q1$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'hg_profiles' and column_name = 'tour_done_at') then
    alter table public.hg_profiles add column tour_done_at timestamptz;
    -- Rattrapage, une seule fois : les profils déjà là ont le bandeau, pas la visite.
    update public.hg_profiles set tour_done_at = timestamptz '1970-01-01 00:00:00+00';
  end if;
end $q1$;
comment on column public.hg_profiles.tour_done_at is
  'Visite guidée vue ou passée (migration 094). null = jamais vue ; 1970-01-01 = inscrit avant la visite (bandeau proposé une fois).';

-- ---------------------------------------------------------------------
-- Q3. Vignettes et dimensions des photos
-- ---------------------------------------------------------------------
alter table public.hg_photos add column if not exists thumb_path text;
alter table public.hg_photos add column if not exists width int;
alter table public.hg_photos add column if not exists height int;
comment on column public.hg_photos.thumb_path is 'Vignette 480 px (WebP) : toujours <path>.thumb.webp (migration 094). null = pas de vignette, la photo entière sert de vignette.';
comment on column public.hg_photos.width is 'Largeur de la photo envoyée, en pixels (migration 094).';
comment on column public.hg_photos.height is 'Hauteur de la photo envoyée, en pixels (migration 094).';

do $q3$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_photos_thumb_path_ok' and conrelid = 'public.hg_photos'::regclass) then
    alter table public.hg_photos add constraint hg_photos_thumb_path_ok
      check (thumb_path is null or thumb_path = path || '.thumb.webp');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_photos_dims_ok' and conrelid = 'public.hg_photos'::regclass) then
    alter table public.hg_photos add constraint hg_photos_dims_ok
      check ((width is null or width between 1 and 20000) and (height is null or height between 1 and 20000));
  end if;
end $q3$;

-- Stockage : vignette d'une photo existante déposée par le Staff « souvenirs » (dossier de l'auteur de la photo).
-- Le membre dépose ses propres vignettes avec la règle existante hg_photos_obj_insert (son dossier).
do $st$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_photos_obj_thumb_staff') then
    execute $p$create policy hg_photos_obj_thumb_staff on storage.objects for insert to authenticated
      with check (bucket_id = 'hg-photos' and public.hg_has_perm('souvenirs')
                  and name like '%.thumb.webp'
                  and exists (select 1 from public.hg_photos ph where ph.path || '.thumb.webp' = name))$p$;
  end if;
end $st$;
