-- 111 : disposition personnelle du plateau du panel admin (taille et place de chaque lieu, grille de 12 colonnes).
-- Rangée avec les préférences d'admin de chacun (hg_admin_shortcuts). null = disposition par défaut.
alter table public.hg_admin_shortcuts add column if not exists plateau jsonb;
alter table public.hg_admin_shortcuts alter column items set default '{}';
create or replace function public.hg_admin_plateau_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select plateau from hg_admin_shortcuts where user_id = auth.uid() and (hg_is_admin() or hg_is_staff())
$$;
create or replace function public.hg_admin_plateau_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text; c jsonb; cells jsonb := '{}'; x int; y int; w int; h int;
begin
  if not (hg_is_admin() or hg_is_staff()) then raise exception 'Réservé au Staff'; end if;
  if p is not null then
    if jsonb_typeof(p->'cells') <> 'object' then raise exception 'Disposition invalide'; end if;
    for k, c in select * from jsonb_each(p->'cells') loop
      if k not in ('place','poste','ventes','camp','fabrique','fete','mairie') then continue; end if;
      x := (c->>'x')::int; y := (c->>'y')::int; w := (c->>'w')::int; h := (c->>'h')::int;
      if x is null or y is null or w is null or h is null or x < 0 or w < 2 or x + w > 12 or y < 0 or y > 40 or h < 1 or h > 6 then
        raise exception 'Case « % » hors du cadre', k;
      end if;
      cells := cells || jsonb_build_object(k, jsonb_build_object('x', x, 'y', y, 'w', w, 'h', h));
    end loop;
    p := jsonb_build_object('v', 1, 'cells', cells);
  end if;
  insert into hg_admin_shortcuts (user_id, items, plateau, updated_at) values (auth.uid(), '{}', p, now())
    on conflict (user_id) do update set plateau = excluded.plateau, updated_at = now();
  return p;
end $$;
revoke all on function public.hg_admin_plateau_get() from public, anon;
revoke all on function public.hg_admin_plateau_set(jsonb) from public, anon;
grant execute on function public.hg_admin_plateau_get() to authenticated;
grant execute on function public.hg_admin_plateau_set(jsonb) to authenticated;
