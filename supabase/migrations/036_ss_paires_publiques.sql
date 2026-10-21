-- 036 — Secret Santa : les paires « qui offre à qui » d'une édition terminée sont visibles par tous les membres.
-- (Pendant une édition en cours, chacun ne voit toujours que sa propre attribution.)
-- Données importées le 21.10.2026 depuis le fichier d'Ethan : éditions 2022 à 2025 (terminées) et paires 2024, 2025 et 2026
-- (édition 2026 passée en « envoi »).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_ss_assignments' and policyname='hg_ss_assign_read_termine') then
    create policy hg_ss_assign_read_termine on public.hg_ss_assignments for select to authenticated
      using (public.hg_is_member() and exists (select 1 from public.hg_ss_editions e where e.id = edition_id and e.status = 'termine'));
  end if;
end $$;
