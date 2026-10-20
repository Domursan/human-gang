-- ===== Humane Gang : sécurité (RLS) et stockage =====
-- Principe : un visiteur non membre ne voit rien. Les infos de profil ne sont lisibles que par leur propriétaire
-- (l'annuaire passe par la fonction hg_members qui n'expose que pseudo/avatar/couleur/anniversaire partagé).

do $$
declare t text;
begin
  foreach t in array array['hg_profiles','hg_invites','hg_settings','hg_activity','hg_ss_editions','hg_ss_participants',
    'hg_ss_wishes','hg_ss_exclusions','hg_ss_assignments','hg_events','hg_event_rsvps','hg_event_dates',
    'hg_event_date_votes','hg_photos','hg_moments','hg_badges','hg_user_badges','hg_ideas','hg_support'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Profils : chacun ne voit et ne modifie que le sien (l'admin ne lit pas les infos privées)
create policy hg_profiles_select_own on public.hg_profiles for select to authenticated using (id = (select auth.uid()));
create policy hg_profiles_update_own on public.hg_profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- (création uniquement via hg_join, suppression via hg_delete_my_account)

-- Invitations : admin uniquement (l'utilisation passe par hg_join)
create policy hg_invites_admin on public.hg_invites for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Paramètres : lisibles par tous (thème avant connexion), modifiables par l'admin. Le réglage "bot" est réservé à l'admin.
create policy hg_settings_read on public.hg_settings for select to anon, authenticated using (key = 'theme');
create policy hg_settings_admin on public.hg_settings for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Fil d'activité : membres en lecture
create policy hg_activity_read on public.hg_activity for select to authenticated using (public.hg_is_member());

-- Secret Santa
create policy hg_ss_editions_read on public.hg_ss_editions for select to authenticated using (public.hg_is_member());
create policy hg_ss_editions_admin on public.hg_ss_editions for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

create policy hg_ss_part_read on public.hg_ss_participants for select to authenticated using (public.hg_is_member());
create policy hg_ss_part_join on public.hg_ss_participants for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hg_is_member()
              and exists(select 1 from public.hg_ss_editions e where e.id = edition_id and e.status = 'inscriptions'));
create policy hg_ss_part_update_own on public.hg_ss_participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy hg_ss_part_leave on public.hg_ss_participants for delete to authenticated
  using (user_id = (select auth.uid()) and exists(select 1 from public.hg_ss_editions e where e.id = edition_id and e.status = 'inscriptions'));
create policy hg_ss_part_admin on public.hg_ss_participants for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Souhaits : propriétaire + son Santa (et seulement lui)
create policy hg_ss_wishes_own on public.hg_ss_wishes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy hg_ss_wishes_santa on public.hg_ss_wishes for select to authenticated
  using (public.hg_ss_is_santa_of(edition_id, user_id));

create policy hg_ss_excl_admin on public.hg_ss_exclusions for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Attributions : aucune lecture directe (passer par hg_ss_my_target / hg_ss_reveal). Personne, même l'admin.

-- IRL
create policy hg_events_read on public.hg_events for select to authenticated using (public.hg_is_member());
create policy hg_events_insert on public.hg_events for insert to authenticated with check (public.hg_is_member() and created_by = (select auth.uid()));
create policy hg_events_update on public.hg_events for update to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());
create policy hg_events_delete on public.hg_events for delete to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());

create policy hg_rsvps_read on public.hg_event_rsvps for select to authenticated using (public.hg_is_member());
create policy hg_rsvps_own on public.hg_event_rsvps for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.hg_is_member());

create policy hg_dates_read on public.hg_event_dates for select to authenticated using (public.hg_is_member());
create policy hg_dates_write on public.hg_event_dates for all to authenticated
  using (public.hg_is_admin() or exists(select 1 from public.hg_events e where e.id = event_id and e.created_by = (select auth.uid())))
  with check (public.hg_is_admin() or exists(select 1 from public.hg_events e where e.id = event_id and e.created_by = (select auth.uid())));

create policy hg_votes_read on public.hg_event_date_votes for select to authenticated using (public.hg_is_member());
create policy hg_votes_own on public.hg_event_date_votes for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.hg_is_member());

create policy hg_photos_read on public.hg_photos for select to authenticated using (public.hg_is_member());
create policy hg_photos_insert on public.hg_photos for insert to authenticated with check (user_id = (select auth.uid()) and public.hg_is_member());
create policy hg_photos_delete on public.hg_photos for delete to authenticated using (user_id = (select auth.uid()) or public.hg_is_admin());

-- Historique
create policy hg_moments_read on public.hg_moments for select to authenticated using (public.hg_is_member());
create policy hg_moments_insert on public.hg_moments for insert to authenticated with check (public.hg_is_member() and created_by = (select auth.uid()));
create policy hg_moments_edit on public.hg_moments for update to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());
create policy hg_moments_delete on public.hg_moments for delete to authenticated using (created_by = (select auth.uid()) or public.hg_is_admin());

-- Badges : catalogue et badges obtenus lisibles par les membres, attribution par l'admin
create policy hg_badges_read on public.hg_badges for select to authenticated using (public.hg_is_member());
create policy hg_badges_admin on public.hg_badges for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());
create policy hg_ubadges_read on public.hg_user_badges for select to authenticated using (public.hg_is_member());
create policy hg_ubadges_admin on public.hg_user_badges for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Boîte à idées : dépôt par les membres, lecture admin uniquement
create policy hg_ideas_insert on public.hg_ideas for insert to authenticated with check (user_id = (select auth.uid()) and public.hg_is_member());
create policy hg_ideas_admin on public.hg_ideas for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Assistance : création via la fonction edge hg-support (service role). Lecture/gestion admin.
create policy hg_support_admin on public.hg_support for all to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());

-- Fonctions : pas d'exécution anonyme
revoke execute on function public.hg_ss_draw(uuid) from anon, public;
revoke execute on function public.hg_join(text, text) from anon, public;
revoke execute on function public.hg_export_my_data() from anon, public;
revoke execute on function public.hg_delete_my_account() from anon, public;
grant execute on function public.hg_ss_draw(uuid), public.hg_join(text, text), public.hg_export_my_data(), public.hg_delete_my_account() to authenticated;
revoke execute on function public.hg_is_admin(), public.hg_is_member(), public.hg_members(), public.hg_ss_is_santa_of(uuid,uuid), public.hg_ss_my_target(uuid), public.hg_ss_progress(uuid), public.hg_ss_reveal(uuid) from anon, public;
grant execute on function public.hg_is_admin(), public.hg_is_member(), public.hg_members(), public.hg_ss_is_santa_of(uuid,uuid), public.hg_ss_my_target(uuid), public.hg_ss_progress(uuid), public.hg_ss_reveal(uuid) to authenticated;
revoke execute on function public.hg_profiles_guard() from anon, authenticated, public;

-- ===== Stockage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('hg-photos', 'hg-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif']),
  ('hg-avatars', 'hg-avatars', true, 2097152, array['image/jpeg','image/png','image/webp']),
  ('hg-assets', 'hg-assets', true, 10485760, array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do nothing;

-- Photos : membres lisent, chacun dépose dans son dossier <uid>/...
create policy hg_photos_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'hg-photos' and public.hg_is_member());
create policy hg_photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hg-photos' and public.hg_is_member() and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy hg_photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hg-photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.hg_is_admin()));

-- Avatars : public en lecture, chacun écrit dans son dossier
create policy hg_avatars_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'hg-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy hg_avatars_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'hg-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy hg_avatars_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hg-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Assets (carte de base Secret Santa, images de badges) : admin en écriture
create policy hg_assets_obj_admin_ins on storage.objects for insert to authenticated with check (bucket_id = 'hg-assets' and public.hg_is_admin());
create policy hg_assets_obj_admin_upd on storage.objects for update to authenticated using (bucket_id = 'hg-assets' and public.hg_is_admin());
create policy hg_assets_obj_admin_del on storage.objects for delete to authenticated using (bucket_id = 'hg-assets' and public.hg_is_admin());

-- ===== Compte admin initial (Ethan) =====
insert into public.hg_profiles(id, pseudo, is_admin)
select id, 'Ethan', true from auth.users where email = 'domursan1@gmail.com'
on conflict (id) do update set is_admin = true;
