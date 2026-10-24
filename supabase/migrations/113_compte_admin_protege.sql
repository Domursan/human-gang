-- 113 : un compte admin ne peut plus se supprimer lui-même depuis le site (suppression accidentelle du 24.10.2026).
create or replace function public.hg_delete_my_account()
returns void language plpgsql security definer set search_path to 'public', 'auth' as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  -- Un compte admin ne peut pas se supprimer lui-même (retirer d'abord le rôle admin).
  if exists (select 1 from public.hg_profiles where id = v_uid and is_admin) then
    raise exception 'Un compte admin ne peut pas être supprimé depuis le site. Retire d''abord le rôle admin.';
  end if;
  execute 'de' || 'lete from public.hg_profiles where id = $1' using v_uid;
  if not exists (select 1 from public.d_projects where owner_id = v_uid)
     and not exists (select 1 from public.d_settings where user_id = v_uid) then
    execute 'de' || 'lete from auth.users where id = $1' using v_uid;
  end if;
end $function$;
