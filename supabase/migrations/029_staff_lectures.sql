-- 029 — Lectures transverses du Staff et réglages par domaine.
-- Tout Staff lit les profils (pseudos et avatars dans les listes de son domaine).
-- Chaque clé de hg_settings relève de la permission de son domaine ; les clés techniques restent à l'admin.
-- La liste des comptes (sans e-mail) sert aussi à la messagerie.

alter policy hg_profiles_admin_read on public.hg_profiles using (public.hg_is_staff());

create or replace function public.hg_settings_perm(p_key text)
returns text language sql immutable as $$
  select case p_key
    when 'cards' then 'cartes'
    when 'bot' then 'bot'
    when 'bot_templates' then 'bot'
    when 'theme' then 'themes'
    when 'push_vapid_public' then null
    when 'domursan_owner' then null
    when 'admin_initial' then null
    else 'reglages'
  end
$$;

alter policy hg_settings_admin on public.hg_settings
  using (public.hg_is_admin() or public.hg_has_perm(public.hg_settings_perm(key)))
  with check (public.hg_is_admin() or public.hg_has_perm(public.hg_settings_perm(key)));

create or replace function public.hg_admin_accounts()
returns table(id uuid, pseudo text, email text, is_admin boolean, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not (public.hg_has_perm('membres') or public.hg_has_perm('messages')) then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo,
      case when public.hg_is_admin() then u.email::text else null end,
      p.is_admin, p.created_at, u.last_sign_in_at
    from hg_profiles p join auth.users u on u.id = p.id order by p.pseudo;
end $$;
