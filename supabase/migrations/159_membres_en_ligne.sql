-- =====================================================================
-- 159 : liste des membres en ligne (menu « En ligne » à droite du site, core/en-ligne.js).
--   hg_membres_en_ligne() : les autres membres dont le dernier signal date de moins de 2 minutes et qui ne masquent pas
--   leur statut (même règle que hg_en_ligne, migration 153). Pseudo, couleur et photo pour l'affichage. 100 au plus.
-- =====================================================================
create or replace function public.hg_membres_en_ligne()
returns table (user_id uuid, pseudo text, color text, avatar_url text, vu_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.pseudo, pr.color, pr.avatar_url, p.seen_at
  from hg_presence p
  join hg_profiles pr on pr.id = p.user_id
  where public.hg_is_member()
    and p.seen_at > now() - interval '2 minutes'
    and not p.masque
    and p.user_id <> auth.uid()
  order by lower(pr.pseudo)
  limit 100 $$;

revoke all on function public.hg_membres_en_ligne() from public, anon;
grant execute on function public.hg_membres_en_ligne() to authenticated;
