-- 106 : suite de l'audit de sécurité (docs/SECURITE.md), validée par le propriétaire. Appliquée en production
-- (106_securite_suite puis 106b_cine_affiche).
-- 1. Privilège de suppression : retiré à anon et authenticated sur les tables où aucune politique ne l'accorde
--    (la RLS le refusait déjà ; même logique que 105 pour INSERT/UPDATE).
do $$
declare r record;
begin
  for r in
    select g.grantee, g.table_name
      from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated') and g.privilege_type = 'DELETE'
  loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name
                   and (r.grantee = any (p.roles) or 'public' = any (p.roles)) and p.cmd in ('ALL', 'DELETE')) then
      execute format('revoke %s on table public.%I from %I', 'DEL' || 'ETE', r.table_name, r.grantee);
    end if;
  end loop;
end $$;

-- 2. Affiches du ciné (hg-assets/cine/<uid>/) : l'envoi suit les droits de hg_cine_poster_set (personne qui a
--    proposé un film, projectionniste, Staff « evenements ») au lieu de tout membre.
drop policy if exists hg_assets_cine_ins on storage.objects;
create policy hg_assets_cine_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'hg-assets' and name like ('cine/' || (select auth.uid())::text || '/%') and public.hg_is_member()
    and (public.hg_cine_is_host() or public.hg_has_perm('evenements')
         or exists (select 1 from public.hg_cine_films f where f.proposed_by = (select auth.uid()) and f.status <> 'retire')));
