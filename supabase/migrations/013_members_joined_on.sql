-- 013 — Annuaire : « membre depuis » tient compte de la date d'arrivée saisie par l'admin (hg_profiles.joined_on).
-- hg_member_card le faisait déjà (011) ; hg_members renvoyait encore created_at, d'où un écart entre
-- la carte d'identité et la liste « Le gang » de membre.html. Même signature : pas de DROP nécessaire.
-- À coller dans l'éditeur SQL Supabase (non appliquée automatiquement).
create or replace function public.hg_members()
returns table(id uuid, pseudo text, avatar_url text, color text, member_since timestamptz, birthday_dm text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.pseudo, p.avatar_url, p.color, coalesce(p.joined_on::timestamptz, p.created_at),
         case when p.share_birthday and p.birthday is not null then to_char(p.birthday, 'DD.MM') end
    from public.hg_profiles p
   where public.hg_is_member()
   order by p.pseudo
$$;
