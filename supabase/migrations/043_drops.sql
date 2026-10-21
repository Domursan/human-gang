-- ===== 043 — Drops de cartes : une carte à attraper, les X premiers qui cliquent la gagnent =====
-- L'admin lance un drop (hg_drop_create) ; la carte apparaît sur le site pour les membres connectés (card-drops.js) ;
-- hg_drop_claim attribue un exemplaire au premier clic, dans la limite de la quantité. Un membre ne gagne qu'une fois par drop.
-- Idempotente : tables et policies « if not exists » / « drop … if exists », fonctions « create or replace ».
-- Les écritures passent uniquement par les RPC (pas de policy d'écriture sur les tables).

-- 1. Le don par drop est une nouvelle origine d'exemplaire.
alter table public.hg_card_copies drop constraint if exists hg_card_copies_source_check;
alter table public.hg_card_copies add constraint hg_card_copies_source_check
  check (source in ('booster','cadeau','admin','fabrication','evenement','echange','drop'));

-- 2. Tables
create table if not exists public.hg_card_drops (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.hg_cards(id) on delete cascade,
  shiny boolean not null default false,
  quantity int not null check (quantity between 1 and 50),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid references public.hg_profiles(id) on delete set null,
  announce boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists hg_card_drops_ends on public.hg_card_drops(ends_at);

create table if not exists public.hg_card_drop_claims (
  drop_id uuid not null references public.hg_card_drops(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  copy_id bigint references public.hg_card_copies(id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (drop_id, user_id)
);

alter table public.hg_card_drops enable row level security;
alter table public.hg_card_drop_claims enable row level security;

-- Lecture : l'admin (permission cartes) voit tout ; un membre ne voit que les drops en cours.
-- Les réclamations : chacun voit les siennes ; l'admin voit les gagnants.
drop policy if exists hg_card_drops_read on public.hg_card_drops;
create policy hg_card_drops_read on public.hg_card_drops for select to authenticated
  using (public.hg_has_perm('cartes') or (public.hg_is_member() and now() >= starts_at and now() < ends_at));

drop policy if exists hg_card_drop_claims_read on public.hg_card_drop_claims;
create policy hg_card_drop_claims_read on public.hg_card_drop_claims for select to authenticated
  using (user_id = auth.uid() or public.hg_has_perm('cartes'));

revoke all on public.hg_card_drops, public.hg_card_drop_claims from anon;
grant select on public.hg_card_drops, public.hg_card_drop_claims to authenticated;

-- 3. Temps réel : mêmes règles que le reste (les abonnés ne reçoivent que les lignes que la RLS autorise).
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['hg_card_drops','hg_card_drop_claims']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. Drops en cours pour le membre connecté (non fantôme), pas encore gagnés par lui, pas épuisés.
create or replace function public.hg_drops_active()
returns table(drop_id uuid, card_id uuid, name text, rarity text, family text, image_url text, flavor text, number int,
              max_copies int, set_name text, shiny boolean, quantity int, remaining int, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, k.id, k.name, k.rarity, k.family, k.image_url, k.flavor, k.number, k.max_copies, s.name,
         d.shiny, d.quantity,
         (d.quantity - (select count(*)::int from hg_card_drop_claims c where c.drop_id = d.id)),
         d.ends_at
  from hg_card_drops d
  join hg_cards k on k.id = d.card_id
  join hg_card_sets s on s.id = k.set_id
  where public.hg_is_member()
    and not coalesce((select p.is_ghost from hg_profiles p where p.id = auth.uid()), false)
    and now() >= d.starts_at and now() < d.ends_at
    and not exists (select 1 from hg_card_drop_claims c where c.drop_id = d.id and c.user_id = auth.uid())
    and (select count(*) from hg_card_drop_claims c where c.drop_id = d.id) < d.quantity
  order by d.starts_at
$$;

-- 5. Réclamation : verrou sur le drop (les clics simultanés passent l'un après l'autre), puis un exemplaire.
create or replace function public.hg_drop_claim(p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me hg_profiles; d hg_card_drops; k hg_cards; sname text; n int; cid bigint; cp hg_card_copies; topser int;
begin
  select * into me from hg_profiles where id = auth.uid();
  if me.id is null or coalesce(me.is_ghost, false) then raise exception 'Réservé aux membres'; end if;

  select * into d from hg_card_drops where id = p_drop for update;
  if not found then raise exception 'Trop tard : ce drop n''existe plus.'; end if;
  if now() < d.starts_at or now() >= d.ends_at then raise exception 'Trop tard : ce drop est terminé.'; end if;
  if exists (select 1 from hg_card_drop_claims where drop_id = p_drop and user_id = auth.uid()) then
    raise exception 'Tu as déjà attrapé cette carte.';
  end if;
  select count(*) into n from hg_card_drop_claims where drop_id = p_drop;
  if n >= d.quantity then raise exception 'Trop tard, tous les exemplaires sont partis !'; end if;

  select * into k from hg_cards where id = d.card_id;
  if not k.active then raise exception 'Cette carte n''est plus disponible.'; end if;
  -- Plafond de la carte (max_copies) : même calcul que hg_card_give (numéro de série = max + 1)
  if k.max_copies is not null then
    select coalesce(max(serial), 0) into topser from hg_card_copies where card_id = d.card_id;
    if topser >= k.max_copies then raise exception 'Trop tard, tous les exemplaires sont partis !'; end if;
  end if;

  cid := public.hg_card_give(auth.uid(), d.card_id, d.shiny, 'drop');
  insert into hg_card_drop_claims(drop_id, user_id, copy_id) values (p_drop, auth.uid(), cid);
  perform public.hg_card_check_sets(auth.uid());
  select * into cp from hg_card_copies where id = cid;
  select st.name into sname from hg_card_sets st where st.id = k.set_id;

  if d.announce then
    insert into hg_activity(user_id, kind, text) values (auth.uid(), 'cartes', me.pseudo || ' a attrapé « ' || k.name || ' » !');
  end if;

  return jsonb_build_object('copy_id', cid, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
    'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number, 'max_copies', k.max_copies, 'set_name', sname,
    'shiny', cp.shiny, 'serial', cp.serial, 'remaining', d.quantity - n - 1);
end $$;

-- 6. Lancer un drop (admin, permission cartes). Bornes : quantité 1 à 50, durée 1 à 1440 minutes.
create or replace function public.hg_drop_create(p_card uuid, p_shiny boolean default false, p_quantity integer default 1,
                                                p_minutes integer default 30, p_announce boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare k hg_cards; did uuid; ann boolean := coalesce(p_announce, true); sh boolean := coalesce(p_shiny, false);
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable ou inactive'; end if;
  if coalesce(p_quantity, 0) < 1 or p_quantity > 50 then raise exception 'La quantité doit être entre 1 et 50.'; end if;
  if coalesce(p_minutes, 0) < 1 or p_minutes > 1440 then raise exception 'La durée doit être entre 1 et 1440 minutes.'; end if;
  if sh and not k.can_shiny then raise exception 'Cette carte ne peut pas être brillante.'; end if;

  insert into hg_card_drops(card_id, shiny, quantity, starts_at, ends_at, created_by, announce)
    values (p_card, sh, p_quantity, now(), now() + make_interval(mins => p_minutes), auth.uid(), ann)
    returning id into did;
  if ann then
    insert into hg_activity(user_id, kind, text) values (null, 'cartes', 'Une carte sauvage est apparue !');
  end if;
  perform public.hg_admin_audit('drop_lance', null, did::text,
    jsonb_build_object('carte', k.name, 'brillante', sh, 'exemplaires', p_quantity, 'minutes', p_minutes, 'annonce', ann));
  return did;
end $$;

-- 7. Arrêter un drop en cours : il prend fin maintenant (les gagnants déjà enregistrés sont conservés).
create or replace function public.hg_drop_stop(p_drop uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  update hg_card_drops set ends_at = greatest(now(), starts_at + interval '1 second')
    where id = p_drop and now() < ends_at;
  if not found then raise exception 'Ce drop est déjà terminé.'; end if;
  perform public.hg_admin_audit('drop_arrete', null, p_drop::text, '{}'::jsonb);
end $$;

-- 8. Droits : fonctions réservées aux membres connectés.
revoke all on function public.hg_drops_active() from public, anon;
revoke all on function public.hg_drop_claim(uuid) from public, anon;
revoke all on function public.hg_drop_create(uuid, boolean, integer, integer, boolean) from public, anon;
revoke all on function public.hg_drop_stop(uuid) from public, anon;
grant execute on function public.hg_drops_active() to authenticated;
grant execute on function public.hg_drop_claim(uuid) to authenticated;
grant execute on function public.hg_drop_create(uuid, boolean, integer, integer, boolean) to authenticated;
grant execute on function public.hg_drop_stop(uuid) to authenticated;
