-- =====================================================================
-- 023 : réactions (émojis) sur les souvenirs (hg_moments) et les photos (hg_photos)
-- Idempotente : rejouable sans erreur.
--   - table hg_reactions (cible polymorphe : 'moment' ou 'photo'), liste fermée de 6 émojis (CHECK)
--   - unique (target_kind, target_id, user_id, emoji) : une seule fois par émoji et par membre
--   - RLS : lecture pour les membres ; insertion et suppression de ses propres lignes seulement
--   - RPC hg_toggle_reaction(p_kind, p_id, p_emoji) : ajoute ou retire, renvoie true si l'émoji est posé
--   - purge des réactions quand un souvenir ou une photo est supprimé (triggers)
-- Les policies sont créées si absentes (pg_policies) : pas de « drop policy ».
-- =====================================================================

create table if not exists public.hg_reactions (
  id          uuid not null default gen_random_uuid() primary key,
  target_kind text not null,
  target_id   uuid not null,
  user_id     uuid not null references public.hg_profiles(id) on update cascade on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  constraint hg_reactions_kind_check  check (target_kind in ('moment', 'photo')),
  constraint hg_reactions_emoji_check check (emoji in ('❤️', '😂', '😮', '🔥', '👏', '🎉')),
  constraint hg_reactions_unique      unique (target_kind, target_id, user_id, emoji)
);

alter table public.hg_reactions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_reactions' and policyname = 'hg_reactions_read') then
    create policy hg_reactions_read on public.hg_reactions as permissive for select to authenticated
      using (public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_reactions' and policyname = 'hg_reactions_insert_own') then
    create policy hg_reactions_insert_own on public.hg_reactions as permissive for insert to authenticated
      with check (user_id = (select auth.uid()) and public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_reactions' and policyname = 'hg_reactions_delete_own') then
    create policy hg_reactions_delete_own on public.hg_reactions as permissive for delete to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RPC : bascule d'une réaction (le membre appelant uniquement)
-- ---------------------------------------------------------------------
create or replace function public.hg_toggle_reaction(p_kind text, p_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_removed integer;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind not in ('moment', 'photo') then raise exception 'Cible inconnue'; end if;
  if p_emoji is null or p_emoji not in ('❤️', '😂', '😮', '🔥', '👏', '🎉') then
    raise exception 'Réaction non autorisée';
  end if;
  if p_kind = 'moment' and not exists (select 1 from public.hg_moments where id = p_id) then
    raise exception 'Souvenir introuvable';
  end if;
  if p_kind = 'photo' and not exists (select 1 from public.hg_photos where id = p_id) then
    raise exception 'Photo introuvable';
  end if;

  delete from public.hg_reactions
   where target_kind = p_kind and target_id = p_id and user_id = v_uid and emoji = p_emoji;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then return false; end if;

  insert into public.hg_reactions (target_kind, target_id, user_id, emoji)
  values (p_kind, p_id, v_uid, p_emoji)
  on conflict on constraint hg_reactions_unique do nothing;
  return true;
end
$$;

revoke all on function public.hg_toggle_reaction(text, uuid, text) from public, anon;
grant execute on function public.hg_toggle_reaction(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Purge : pas de clé étrangère (cible polymorphe), donc un trigger nettoie
-- ---------------------------------------------------------------------
create or replace function public.hg_reactions_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.hg_reactions where target_kind = tg_argv[0] and target_id = old.id;
  return old;
end
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_moments_reactions_purge') then
    create trigger hg_moments_reactions_purge after delete on public.hg_moments
      for each row execute function public.hg_reactions_purge('moment');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_photos_reactions_purge') then
    create trigger hg_photos_reactions_purge after delete on public.hg_photos
      for each row execute function public.hg_reactions_purge('photo');
  end if;
end $$;
