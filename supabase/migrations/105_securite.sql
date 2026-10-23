-- ============================================================================
-- 105_securite.sql : audit de sécurité du 23/10/2026, paquet E (privilèges).
--
-- Idempotente et rejouable. NON APPLIQUÉE par l'auteur de l'audit : à appliquer par le propriétaire.
-- Aucun comportement voulu ne change : chaque privilège retiré est déjà refusé par la RLS (aucune politique
-- ne l'accorde à anon ni à authenticated), et hg_role_grants n'est appelée que par des fonctions
-- SECURITY DEFINER (hg_page_ok, appelée par hg_member_access), qui s'exécutent avec le rôle propriétaire.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- E1 (moyenne) : écriture directe possible sur une centaine de tables.
-- anon et authenticated ont INSERT, UPDATE, TRUNCATE, REFERENCES et TRIGGER sur des tables sans politique
-- correspondante. Seule la RLS les empêche d'écrire. TRUNCATE n'est pas soumis à la RLS (non exposé par
-- PostgREST, mais accessible à tout code SQL d'un rôle connecté) : une politique future mal écrite donnerait
-- l'écriture directe.
-- Ce bloc ne retire un privilège que s'il n'existe aucune politique qui l'accorde à ce rôle (ou à public).
-- Le privilège de suppression n'est pas traité ici (à traiter à part, voir le rapport).
--
-- Test après application (liste attendue : seulement les couples couverts par une politique, par exemple
-- hg_events INSERT pour authenticated, hg_profiles UPDATE pour authenticated) :
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon', 'authenticated')
--      and privilege_type in ('INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
--    order by 1, 2, 3;
-- Test de comportement (client connecté, portefeuille d'un autre membre) : doit répondre « permission denied »
-- au lieu de « 0 ligne modifiée » :
--   set local role authenticated;
--   update public.hg_wallets set paillettes = 999999 where user_id <> auth.uid();
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select g.grantee, g.table_name, g.privilege_type
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.grantee in ('anon', 'authenticated')
       and g.privilege_type in ('INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  loop
    if not exists (
      select 1
        from pg_policies p
       where p.schemaname = 'public'
         and p.tablename = r.table_name
         and (r.grantee = any (p.roles) or 'public' = any (p.roles))
         and (p.cmd = 'ALL' or p.cmd = r.privilege_type)
    ) then
      execute format('revoke %s on table public.%I from %I', r.privilege_type, r.table_name, r.grantee);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- E2 (basse) : hg_role_grants(p_user, p_slug) répond pour n'importe quel membre.
-- Exécutable par authenticated, elle indique si un autre membre a un rôle donnant accès à une page.
-- Elle n'est appelée que par hg_page_ok (SECURITY DEFINER) : le retrait ne touche pas le site.
--
-- Test après application (attendu : false pour authenticated ; hg_member_access reste exécutable) :
--   select has_function_privilege('authenticated', 'public.hg_role_grants(uuid, text)', 'EXECUTE') as role_grants_auth,
--          has_function_privilege('authenticated', 'public.hg_member_access(uuid)', 'EXECUTE')     as member_access_auth;
-- Test fonctionnel (membre du Staff « membres ») : la liste des accès renvoie des lignes :
--   select count(*) from public.hg_member_access(auth.uid());
-- ---------------------------------------------------------------------------
revoke execute on function public.hg_role_grants(uuid, text) from public, anon, authenticated;
