-- 033 — Vie privée et durcissement après vérification des permissions.
-- 1. Les profils complets (anniversaire, Discord, notes…) ne sont lisibles que par les permissions membres et bot.
--    Les autres Staff passent par hg_staff_directory() (pseudo, avatar, couleur, fantôme, arrivée).
-- 2. Retrait des droits TRUNCATE / TRIGGER / REFERENCES aux rôles de l'API sur les tables publiques.

alter policy hg_profiles_admin_read on public.hg_profiles
  using (public.hg_has_perm('membres') or public.hg_has_perm('bot'));

create or replace function public.hg_staff_directory()
returns table(id uuid, pseudo text, avatar_url text, color text, is_ghost boolean, joined_on date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_is_staff() then raise exception 'Réservé au Staff' using errcode = '42501'; end if;
  return query select p.id, p.pseudo, p.avatar_url, p.color, coalesce(p.is_ghost, false), p.joined_on
    from public.hg_profiles p order by p.pseudo;
end $$;
revoke all on function public.hg_staff_directory() from public, anon;
grant execute on function public.hg_staff_directory() to authenticated;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
