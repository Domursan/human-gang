-- 035 — Les comptes fantômes ne reçoivent pas de badge tant qu'ils ne sont pas liés à un compte actif.
-- Toute attribution (automatique ou manuelle) ou montée de niveau visant un fantôme est ignorée sans erreur.
-- Après liaison (hg_ghost_merge), les badges sont calculés pour le compte actif comme pour tout membre.

create or replace function public.hg_user_badges_no_ghost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.hg_profiles p where p.id = new.user_id and coalesce(p.is_ghost, false)) then
    return null;
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_user_badges_no_ghost_trg') then
    create trigger hg_user_badges_no_ghost_trg before insert or update on public.hg_user_badges
      for each row execute function public.hg_user_badges_no_ghost();
  end if;
end $$;

-- Fil d'actualité : aucune ligne « badge » pour un fantôme (garde-fou en plus du blocage ci-dessus).
create or replace function public.hg_activity_no_ghost_badge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind like 'badge%' and exists (select 1 from public.hg_profiles p where p.id = new.user_id and coalesce(p.is_ghost, false)) then
    return null;
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_activity_no_ghost_badge_trg') then
    create trigger hg_activity_no_ghost_badge_trg before insert on public.hg_activity
      for each row execute function public.hg_activity_no_ghost_badge();
  end if;
end $$;

-- Nettoyage appliqué le 21.10.2026 : badges et lignes « badge » du fil des fantômes retirés
-- (95 badges, 130 lignes d'activité).
