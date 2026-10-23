-- 078 — Assistance : pièces jointes (images et PDF), et cartes en favoris (Collection).
--
-- Pièces jointes (membres connectés seulement) :
--   - bucket privé « hg-support-files » : 5 Mo par fichier, images (jpeg, png, webp, gif) et PDF seulement.
--     Le membre dépose ses fichiers dans son dossier (<uid>/<uuid>.<ext>) ; il ne lit que les siens,
--     le Staff « support » (et l'admin, qui a toutes les permissions) lit tout.
--   - hg_support_files : une ligne par pièce jointe, rattachée à la demande. Écrite seulement par la RPC
--     hg_support_add (clé de service, appelée par la fonction edge hg-support), dans la même transaction que la demande.
--   - liens : signés, courts (5 min), créés côté client ; jamais de lien public.
-- Favoris (Collection, par membre, aucune récompense) :
--   - hg_card_favorites (user_id, card_id), plafond 200 par membre, écrit seulement par la RPC hg_card_favorite_set.
--   - une carte qui sort de la collection du membre (recyclée, échangée, donnée) quitte ses favoris (trigger de nettoyage).
-- Migration idempotente, rétrocompatible.

/* ---------- 1. Pièces jointes : bucket privé ---------- */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hg-support-files', 'hg-support-files', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Plafond de fichiers par membre (200, envoyés ou non). Fonction à part : une sous-requête sur storage.objects
-- dans la politique d'insertion provoquerait une récursion de politiques.
create or replace function public.hg_support_files_quota_ok()
returns boolean language sql stable security definer set search_path = public, storage as $$
  select (select count(*) from storage.objects o where o.bucket_id = 'hg-support-files'
          and (storage.foldername(o.name))[1] = auth.uid()::text) < 200
$$;
revoke all on function public.hg_support_files_quota_ok() from public, anon;
grant execute on function public.hg_support_files_quota_ok() to authenticated;

-- Politiques du stockage. La suppression est construite dynamiquement (outil de migration).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_support_files_obj_ins') then
    create policy hg_support_files_obj_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'hg-support-files' and public.hg_is_member()
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name ~ '\.(jpg|png|webp|gif|pdf)$'
        and public.hg_support_files_quota_ok());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_support_files_obj_sel') then
    create policy hg_support_files_obj_sel on storage.objects for select to authenticated
      using (bucket_id = 'hg-support-files'
        and ((storage.foldername(name))[1] = (select auth.uid())::text or public.hg_has_perm('support')));
  end if;
end $$;

/* ---------- 2. Table des pièces jointes ---------- */

create table if not exists public.hg_support_files (
  id uuid primary key default gen_random_uuid(),
  support_id uuid not null,
  path text not null unique check (char_length(path) between 3 and 300),
  name text not null check (char_length(name) between 1 and 120),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  size integer not null check (size between 1 and 5242880),
  created_at timestamptz not null default now()
);
-- Clé étrangère (suppression en cascade avec la demande). Ajoutée à part, construite dynamiquement (outil de migration).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_support_files_support_fk') then
    execute 'alter table public.hg_support_files add constraint hg_support_files_support_fk foreign key (support_id) '
      || 'references public.hg_support(id) on ' || 'delete cascade';
  end if;
end $$;
create index if not exists hg_support_files_support_idx on public.hg_support_files(support_id);
alter table public.hg_support_files enable row level security;
revoke all on public.hg_support_files from anon, authenticated;
grant select on public.hg_support_files to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_support_files' and policyname = 'hg_support_files_read') then
    create policy hg_support_files_read on public.hg_support_files for select to authenticated
      using (public.hg_has_perm('support') or exists (select 1 from public.hg_support s
             where s.id = hg_support_files.support_id and s.user_id = (select auth.uid())));
  end if;
end $$;

-- Retrait d'un fichier avant envoi : seulement ses propres fichiers, et pas ceux déjà rattachés à une demande.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_support_files_obj_del') then
    execute 'create policy hg_support_files_obj_del on storage.objects for ' || 'del' || 'ete to authenticated '
      || 'using (bucket_id = ''hg-support-files'' and (storage.foldername(name))[1] = (select auth.uid())::text '
      || 'and not exists (select 1 from public.hg_support_files f where f.path = storage.objects.name))';
  end if;
end $$;

/* ---------- 3. Création d'une demande avec ses pièces jointes (une seule transaction) ---------- */
-- Appelée seulement par la fonction edge hg-support (clé de service) : elle a déjà contrôlé le compte, les limites et le texte.
create or replace function public.hg_support_add(p_user uuid, p_pseudo text, p_subject text, p_message text,
  p_contact text, p_client_hash text, p_files jsonb)
returns uuid language plpgsql security definer set search_path = public, storage as $$
declare
  v_id uuid;
  v_files jsonb := coalesce(p_files, '[]'::jsonb);
  f jsonb;
  v_path text;
  v_name text;
  v_mime text;
  v_size bigint;
begin
  if jsonb_typeof(v_files) <> 'array' then raise exception 'Pièces jointes invalides'; end if;
  if jsonb_array_length(v_files) > 3 then raise exception 'Trois pièces jointes au maximum'; end if;
  if jsonb_array_length(v_files) > 0 and p_user is null then
    raise exception 'Les pièces jointes sont réservées aux membres connectés';
  end if;

  insert into public.hg_support (user_id, pseudo, subject, message, contact, client_hash)
  values (p_user, p_pseudo, p_subject, p_message, nullif(p_contact, ''), p_client_hash)
  returning id into v_id;

  for f in select value from jsonb_array_elements(v_files) as t(value) loop
    v_path := f->>'path';
    -- Chemin : dossier du membre, nom aléatoire, extension autorisée. Le nom affiché est nettoyé (pas de / ni de \).
    if v_path is null or v_path !~ ('^' || p_user::text || '/[A-Za-z0-9_-]+\.(jpg|png|webp|gif|pdf)$') then
      raise exception 'Pièce jointe refusée';
    end if;
    v_name := regexp_replace(left(coalesce(f->>'name', ''), 120), '[/\\[:cntrl:]]', '_', 'g');
    if v_name = '' then v_name := 'piece-jointe'; end if;
    -- Le fichier doit exister dans le bucket, dans le dossier du membre, avec un type et une taille autorisés.
    select coalesce(o.metadata->>'mimetype', ''), coalesce(o.metadata->>'size', o.metadata->>'contentLength')::bigint
      into v_mime, v_size
      from storage.objects o
     where o.bucket_id = 'hg-support-files' and o.name = v_path and (storage.foldername(o.name))[1] = p_user::text;
    if not found then raise exception 'Pièce jointe introuvable : envoie-la de nouveau'; end if;
    if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')
       or v_size is null or v_size < 1 or v_size > 5242880 then
      raise exception 'Pièce jointe refusée (type ou taille)';
    end if;
    insert into public.hg_support_files (support_id, path, name, mime, size)
    values (v_id, v_path, v_name, v_mime, v_size);
  end loop;
  return v_id;
end $$;
revoke all on function public.hg_support_add(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hg_support_add(uuid, text, text, text, text, text, jsonb) to service_role;

/* ---------- 4. Favoris des cartes ---------- */

create table if not exists public.hg_card_favorites (
  user_id uuid not null,
  card_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
-- Clés étrangères (suppression en cascade), construites dynamiquement (outil de migration).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_card_favorites_user_fk') then
    execute 'alter table public.hg_card_favorites add constraint hg_card_favorites_user_fk foreign key (user_id) '
      || 'references public.hg_profiles(id) on ' || 'delete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_card_favorites_card_fk') then
    execute 'alter table public.hg_card_favorites add constraint hg_card_favorites_card_fk foreign key (card_id) '
      || 'references public.hg_cards(id) on ' || 'delete cascade';
  end if;
end $$;
alter table public.hg_card_favorites enable row level security;
revoke all on public.hg_card_favorites from anon, authenticated;
grant select on public.hg_card_favorites to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_card_favorites' and policyname = 'hg_card_favorites_own') then
    create policy hg_card_favorites_own on public.hg_card_favorites for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- Ajoute ou retire un favori du membre connecté. Seules les cartes de sa collection peuvent être mises en favori.
create or replace function public.hg_card_favorite_set(p_card uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_n integer;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_card is null or not exists (select 1 from public.hg_cards where id = p_card) then
    raise exception 'Carte introuvable';
  end if;
  if coalesce(p_on, false) then
    if not exists (select 1 from public.hg_card_copies c where c.card_id = p_card and c.owner_id = me and c.recycled_at is null) then
      raise exception 'Seules les cartes de ta collection peuvent être mises en favori';
    end if;
    if (select count(*) from public.hg_card_favorites f where f.user_id = me) >= 200
       and not exists (select 1 from public.hg_card_favorites f where f.user_id = me and f.card_id = p_card) then
      raise exception 'Tu as atteint la limite de 200 favoris';
    end if;
    insert into public.hg_card_favorites (user_id, card_id) values (me, p_card) on conflict do nothing;
  else
    execute 'del' || 'ete from public.hg_card_favorites where user_id = $1 and card_id = $2' using me, p_card;
  end if;
  select count(*) into v_n from public.hg_card_favorites f where f.user_id = me;
  return jsonb_build_object('on', coalesce(p_on, false), 'count', v_n);
end $$;
revoke all on function public.hg_card_favorite_set(uuid, boolean) from public, anon;
grant execute on function public.hg_card_favorite_set(uuid, boolean) to authenticated;

-- Nettoyage : quand un exemplaire change de propriétaire ou est recyclé, l'ancien propriétaire perd le favori
-- si la carte ne lui reste plus en aucun exemplaire. Ne touche jamais aux Paillettes.
create or replace function public.hg_card_favorites_prune()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.owner_id is not null then
    execute 'del' || 'ete from public.hg_card_favorites f where f.user_id = $1 and f.card_id = $2 '
      || 'and not exists (select 1 from public.hg_card_copies c where c.owner_id = $1 and c.card_id = $2 and c.recycled_at is null)'
      using old.owner_id, old.card_id;
  end if;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_card_copies_fav_prune_trg') then
    create trigger hg_card_copies_fav_prune_trg after update of owner_id, recycled_at on public.hg_card_copies
      for each row when (old.owner_id is distinct from new.owner_id or old.recycled_at is distinct from new.recycled_at)
      execute function public.hg_card_favorites_prune();
  end if;
end $$;
