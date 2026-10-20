-- ===== 018 (c) : jeu de cartes — sécurité de la vitrine (RLS) =====
-- À appliquer après 018_cartes_tables.sql et 018_cartes_fonctions.sql. NON APPLIQUÉ.
-- Vitrine : 3 emplacements par membre (hg_card_showcase). Lecture pour tous les membres ; écriture seulement
-- pour soi, et seulement avec un exemplaire qui m'appartient et n'est pas recyclé.

alter table public.hg_card_showcase enable row level security;

drop policy if exists hg_card_showcase_read on public.hg_card_showcase;
create policy hg_card_showcase_read on public.hg_card_showcase for select to authenticated
  using (public.hg_is_member());

drop policy if exists hg_card_showcase_insert on public.hg_card_showcase;
create policy hg_card_showcase_insert on public.hg_card_showcase for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.hg_card_copies c
      where c.id = copy_id and c.owner_id = (select auth.uid()) and c.recycled_at is null)
  );

drop policy if exists hg_card_showcase_update on public.hg_card_showcase;
create policy hg_card_showcase_update on public.hg_card_showcase for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.hg_card_copies c
      where c.id = copy_id and c.owner_id = (select auth.uid()) and c.recycled_at is null)
  );

drop policy if exists hg_card_showcase_delete on public.hg_card_showcase;
create policy hg_card_showcase_delete on public.hg_card_showcase for delete to authenticated
  using (user_id = (select auth.uid()));

-- La vitrine affiche des cartes et des exemplaires d'autres membres : il faut une lecture membre sur le catalogue
-- et sur les exemplaires. Ces politiques n'ont d'effet que si la RLS est activée sur ces tables (à faire avec
-- le reste des règles du jeu, 018 c suite) ; sinon elles sont inertes.
drop policy if exists hg_cards_member_read on public.hg_cards;
create policy hg_cards_member_read on public.hg_cards for select to authenticated
  using (public.hg_is_member());

drop policy if exists hg_card_copies_member_read on public.hg_card_copies;
create policy hg_card_copies_member_read on public.hg_card_copies for select to authenticated
  using (public.hg_is_member());
