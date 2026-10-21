-- 028 — Ajustements Staff : journal des lectures de messages et e-mails réservés à l'admin,
-- modération des réactions (permission souvenirs).

alter policy hg_admin_access_log_admin_read on public.hg_admin_access_log using (public.hg_is_admin());

create or replace function public.hg_admin_accounts()
returns table(id uuid, pseudo text, email text, is_admin boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo,
      case when public.hg_is_admin() then u.email::text else null end,
      p.is_admin, p.created_at, u.last_sign_in_at
    from hg_profiles p join auth.users u on u.id = p.id order by p.pseudo;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_reactions' and policyname='hg_reactions_moderation') then
    create policy hg_reactions_moderation on public.hg_reactions for update to authenticated
      using (public.hg_has_perm('souvenirs')) with check (public.hg_has_perm('souvenirs'));
  end if;
end $$;
