-- 032 — Annuaire public du Staff : pseudos, avatars et couleurs, sans les champs personnels.
-- Lu par la messagerie (pseudos des expéditeurs) : un Staff qui n'a pas la permission « membres » ni « bot »
-- ne lit plus hg_profiles en entier (la lecture complète est réservée à ces permissions, voir 029 et 026).
-- Renvoie : id, pseudo, avatar_url, color, is_ghost, joined_on. Exécutable par tout Staff et l'admin.

create or replace function public.hg_staff_directory()
returns table(id uuid, pseudo text, avatar_url text, color text, is_ghost boolean, joined_on date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_is_staff() then raise exception 'Réservé au Staff'; end if;
  return query select p.id, p.pseudo, p.avatar_url, p.color, coalesce(p.is_ghost, false), p.joined_on
    from hg_profiles p order by p.pseudo;
end $$;

grant execute on function public.hg_staff_directory() to authenticated;
