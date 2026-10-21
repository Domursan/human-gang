-- ============================================================================
-- 003 : règles « supprimer », suppression de compte, verrou des tables d_*
-- Historique : ces commandes ont d'abord été collées à la main dans le SQL Editor
-- (projet Gestion_RP), car elles contiennent des règles de suppression.
-- Rejouable : chaque policy est précédée de « drop policy if exists ».
-- Le fichier ne contient plus aucun identifiant personnel (voir la section 3).
-- Voir supabase/migrations/README.md pour l'ordre et le statut.
-- ============================================================================

-- 1) Règles « supprimer » (se désinscrire, supprimer ses sorties / photos / moments)
drop policy if exists hg_ss_part_leave on public.hg_ss_participants;
create policy hg_ss_part_leave on public.hg_ss_participants for delete to authenticated
  using (user_id = (select auth.uid()) and exists(select 1 from public.hg_ss_editions e where e.id = edition_id and e.status = 'inscriptions'));

drop policy if exists hg_events_delete on public.hg_events;
create policy hg_events_delete on public.hg_events for delete to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());

drop policy if exists hg_photos_delete on public.hg_photos;
create policy hg_photos_delete on public.hg_photos for delete to authenticated using (user_id = (select auth.uid()) or public.hg_is_admin());

drop policy if exists hg_moments_delete on public.hg_moments;
create policy hg_moments_delete on public.hg_moments for delete to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());

drop policy if exists hg_photos_obj_delete on storage.objects;
create policy hg_photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hg-photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.hg_is_admin()));

drop policy if exists hg_avatars_obj_delete on storage.objects;
create policy hg_avatars_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hg-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists hg_assets_obj_admin_del on storage.objects;
create policy hg_assets_obj_admin_del on storage.objects for delete to authenticated using (bucket_id = 'hg-assets' and public.hg_is_admin());

-- 2) Suppression de son compte Humane Gang (droit à l'effacement)
--    Supprime le profil ET l'identifiant de connexion (e-mail, mot de passe), sauf pour un compte
--    qui possède aussi des données Domursan (ton compte) : là, seul le profil Humane Gang est effacé.
--    (Même logique que la version de production, reprise dans 021 : c'est celle qui fait foi.)
create or replace function public.hg_delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  delete from public.hg_profiles where id = v_uid;
  if not exists (select 1 from public.d_projects where owner_id = v_uid)
     and not exists (select 1 from public.d_settings where user_id = v_uid) then
    delete from auth.users where id = v_uid;
  end if;
end $$;
revoke execute on function public.hg_delete_my_account() from anon, public;
grant execute on function public.hg_delete_my_account() to authenticated;

-- 3) Verrouiller Domursan (tables d_*) sur ton seul compte, pour que les membres
--    Humane Gang (qui partagent la même base) ne puissent jamais y écrire.
--    L'UUID du propriétaire n'est PAS dans le dépôt : il est lu dans hg_settings,
--    clé 'domursan_owner', valeur {"uuid": "<uuid>"}, à insérer hors dépôt avant de rejouer.
--    Sans cette clé, la migration s'arrête ici (les sections 1 et 2 restent appliquées).
do $$
declare
  t text;
  v_owner uuid;
begin
  select (value->>'uuid')::uuid into v_owner from public.hg_settings where key = 'domursan_owner';
  if v_owner is null then
    raise exception 'Clé hg_settings ''domursan_owner'' absente : renseigner le propriétaire Domursan avant de rejouer 003';
  end if;
  foreach t in array array['d_settings','d_projects','d_links','d_tasks','d_notes','d_changelog','d_events','d_files','d_contacts','d_transactions','d_inventory','d_bugs','d_features'] loop
    execute format('drop policy if exists %I on public.%I', t||'_owner_lock', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select auth.uid()) = %L::uuid) with check ((select auth.uid()) = %L::uuid)', t||'_owner_lock', t, v_owner, v_owner);
  end loop;
end $$;
