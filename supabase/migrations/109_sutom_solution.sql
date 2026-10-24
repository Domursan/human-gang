-- 109 : le compte admin (ou la permission « souvenirs », qui gère le Sutom) peut voir le mot du jour sur la page du Sutom.
-- Les autres comptes reçoivent null : le mot n'est jamais envoyé à un joueur ordinaire.
create or replace function public.hg_sutom_solution()
returns jsonb language plpgsql security definer set search_path = public as $$
declare w hg_sutom_words;
begin
  if not (hg_is_admin() or hg_has_perm('souvenirs')) then return null; end if;
  w := hg_sutom_ensure(hg_sutom_day());
  if w.word is null then return null; end if;
  return jsonb_build_object('word', w.word, 'definition', w.definition, 'day', w.day);
end $$;
revoke all on function public.hg_sutom_solution() from public, anon;
grant execute on function public.hg_sutom_solution() to authenticated;
