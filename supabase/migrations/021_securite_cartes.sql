-- =====================================================================
-- 021 : sécurité, contraintes, journaux et corrections du jeu de cartes
-- Idempotente : rejouable sans erreur (if not exists, create or replace,
-- drop policy / trigger / function if exists, blocs do pour les contraintes).
--
-- Contenu :
--   S2  contraintes de format sur hg_profiles.color et discord_id
--   S3  avatar_url limité au bucket hg-avatars (contrainte en base)
--   S7  hg_export_my_data couvre tout ce que la page Mentions légales déclare
--   S8  hg_delete_my_account : version de production reprise à l'identique
--   S9  table hg_admin_access_log + RPC hg_admin_read_conversation qui journalise
--   AD2 table hg_admin_log, écrite par les RPC admin existantes et par un trigger
--       de suppression de carte
--   C5  hg_cards_earn_trg : l'erreur est signalée (raise warning) au lieu d'être avalée
--   C7  hg_open_booster : clé p_request (idempotence côté serveur)
--   J1  hg_trade_respond : verrou sur les deux portefeuilles, dans un ordre fixe
--   J3  hg_open_booster : renvoie le nombre demandé et le nombre réellement livré
--
-- Pour chaque fonction modifiée, le corps part de la définition ACTUELLE en base
-- (pg_get_functiondef, relevée le 2026-10-21, lecture seule), sans perdre de logique.
--
-- Vérification des contraintes sur les données existantes (2026-10-21) :
--   color : 0 ligne en violation ; discord_id : 0 ligne en violation ;
--   avatar_url : 1 ligne sur 1 conforme ; les contraintes sont donc validées (pas de NOT VALID).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contraintes de format sur le profil (S2, S3)
-- ---------------------------------------------------------------------
do $$ begin
  alter table public.hg_profiles add constraint hg_profiles_color_format
    check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.hg_profiles add constraint hg_profiles_discord_format
    check (discord_id is null or discord_id ~ '^[0-9]{15,21}$');
exception when duplicate_object then null; end $$;

-- Avatars : seule une URL du bucket public hg-avatars est acceptée (pas de serveur externe).
-- Si une ligne existante ne correspondait pas au motif, il faudrait ajouter la contrainte
-- en NOT VALID ; ici toutes les lignes sont conformes.
do $$ begin
  alter table public.hg_profiles add constraint hg_profiles_avatar_bucket
    check (avatar_url is null or avatar_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/hg-avatars/[^[:space:]"''<>]+$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Journal des actions administrateur (AD2)
-- ---------------------------------------------------------------------
create table if not exists public.hg_admin_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.hg_profiles(id) on update cascade on delete set null,
  action      text not null,
  target_user uuid,
  target_ref  text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists hg_admin_log_created_idx on public.hg_admin_log (created_at desc);
alter table public.hg_admin_log enable row level security;
drop policy if exists hg_admin_log_admin_read on public.hg_admin_log;
create policy hg_admin_log_admin_read on public.hg_admin_log for select to authenticated
  using (public.hg_is_admin());
-- Aucune policy d'écriture : seules les fonctions security definer écrivent dans ce journal.

create or replace function public.hg_admin_audit(p_action text, p_user uuid, p_ref text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.hg_admin_log(admin_id, action, target_user, target_ref, details)
  values (auth.uid(), p_action, p_user, p_ref, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public.hg_admin_audit(text, uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Journal des lectures admin de conversations (S9)
-- ---------------------------------------------------------------------
create table if not exists public.hg_admin_access_log (
  id              bigint generated always as identity primary key,
  admin_id        uuid references public.hg_profiles(id) on update cascade on delete set null,
  conversation_id uuid references public.hg_conversations(id) on delete set null,
  conversation_kind text,
  accessed_at     timestamptz not null default now()
);
create index if not exists hg_admin_access_log_conv_idx on public.hg_admin_access_log (conversation_id, accessed_at desc);
alter table public.hg_admin_access_log enable row level security;
drop policy if exists hg_admin_access_log_admin_read on public.hg_admin_access_log;
create policy hg_admin_access_log_admin_read on public.hg_admin_access_log for select to authenticated
  using (public.hg_is_admin());

-- Lecture admin des messages d'une conversation : passe par cette RPC, qui journalise.
-- L'interface (admin-messages.js) n'est pas encore branchée dessus ; la policy directe
-- hg_msg_admin reste donc en place tant que l'interface n'a pas migré.
create or replace function public.hg_admin_read_conversation(p_conv uuid, p_after bigint default 0, p_limit integer default 100)
returns setof public.hg_messages
language plpgsql
security definer
set search_path = public
as $$
declare v_kind text;
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  select kind into v_kind from public.hg_conversations where id = p_conv;
  if not found then raise exception 'Conversation introuvable'; end if;
  insert into public.hg_admin_access_log(admin_id, conversation_id, conversation_kind)
    values (auth.uid(), p_conv, v_kind);
  return query
    select m.* from public.hg_messages m
    where m.conversation_id = p_conv and m.id > coalesce(p_after, 0)
    order by m.id
    limit greatest(least(coalesce(p_limit, 100), 500), 1);
end $$;
revoke all on function public.hg_admin_read_conversation(uuid, bigint, integer) from public, anon;
grant execute on function public.hg_admin_read_conversation(uuid, bigint, integer) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC admin existantes : écriture dans le journal (AD2)
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_admin_give(p_user uuid, p_card uuid, p_shiny boolean DEFAULT false, p_count integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare i int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  for i in 1..greatest(least(coalesce(p_count, 1), 100), 1) loop perform hg_card_give(p_user, p_card, p_shiny, 'admin'); end loop;
  perform hg_card_check_sets(p_user);
  perform hg_admin_audit('carte_donnee', p_user, p_card::text,
    jsonb_build_object('exemplaires', greatest(least(coalesce(p_count, 1), 100), 1), 'brillante', coalesce(p_shiny, false)));
  return greatest(least(coalesce(p_count, 1), 100), 1);
end $function$;

create or replace function public.hg_cards_admin_take(p_copy bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_owner uuid;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  select owner_id into v_owner from hg_card_copies where id = p_copy;
  update hg_card_copies set recycled_at = now(), locked_trade = null where id = p_copy;
  perform hg_admin_audit('exemplaire_retire', v_owner, p_copy::text, '{}'::jsonb);
end $function$;

create or replace function public.hg_cards_admin_paillettes(p_user uuid, p_delta integer, p_reason text DEFAULT 'admin'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_wallet_add(p_user, greatest(p_delta, -bal), coalesce(nullif(p_reason, ''), 'admin'), null);
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_admin_audit('ajustement_paillettes', p_user, null,
    jsonb_build_object('demande', p_delta, 'motif', coalesce(nullif(p_reason, ''), 'admin'), 'solde_apres', bal));
  return bal;
end $function$;

-- Suppression d'une carte (AD1 garde la confirmation côté interface ; ici, trace).
create or replace function public.hg_cards_admin_audit_del()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hg_admin_log(admin_id, action, target_ref, details)
  values (auth.uid(), 'carte_supprimee', old.id::text,
          jsonb_build_object('nom', old.name, 'numero', old.number, 'set_id', old.set_id));
  return old;
end $$;
drop trigger if exists hg_cards_admin_audit_del on public.hg_cards;
create trigger hg_cards_admin_audit_del after delete on public.hg_cards
  for each row execute function public.hg_cards_admin_audit_del();

-- ---------------------------------------------------------------------
-- 5. Gains du jeu de cartes : erreur signalée, plus avalée (C5)
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_earn_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r jsonb := hg_card_cfg()->'rewards';
begin
  begin
    if tg_table_name = 'hg_event_rsvps' then
      if new.status = 'oui' then perform hg_wallet_add(new.user_id, coalesce((r->>'rsvp')::int, 15), 'reponse_sortie', 'rsvp:' || new.event_id); end if;
    elsif tg_table_name = 'hg_events' then
      if not coalesce(new.retro, false) then perform hg_wallet_add(new.created_by, coalesce((r->>'event_created')::int, 25), 'sortie_creee', 'event:' || new.id); end if;
    elsif tg_table_name = 'hg_photos' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'photo')::int, 2), 'photo', 'photo:' || new.id);
    elsif tg_table_name = 'hg_moments' then
      perform hg_wallet_add(new.created_by, coalesce((r->>'moment')::int, 15), 'moment', 'moment:' || new.id);
    elsif tg_table_name = 'hg_user_badges' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'badge')::int, 40), 'badge', 'badge:' || new.badge_code);
    elsif tg_table_name = 'hg_dyn_captures' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'capture')::int, 10), 'capture', 'capture:' || new.event_id);
    elsif tg_table_name = 'hg_ss_participants' then
      if new.sent_at is not null then perform hg_wallet_add(new.user_id, coalesce((r->>'gift_sent')::int, 50), 'cadeau_santa', 'santa:' || new.edition_id); end if;
    end if;
  exception when others then
    -- Ne plus avaler l'erreur : elle reste visible dans les journaux Supabase.
    raise warning 'hg_cards_earn_trg (%) : %', tg_table_name, sqlerrm;
  end;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 6. Ouverture de booster : idempotence (C7) et nombre livré (J3)
--    La signature change (ajout de p_request) : l'ancienne est retirée d'abord,
--    sinon PostgREST ne saurait plus quelle version appeler.
-- ---------------------------------------------------------------------
drop function if exists public.hg_open_booster(boolean);

create or replace function public.hg_open_booster(p_free boolean default false, p_request text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; price int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  -- Idempotence : le verrou ci-dessus sérialise les appels ; une même requête ne peut
  -- ouvrir qu'un seul booster. Un second envoi (réseau coupé, double clic) lève cette erreur.
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = auth.uid() and ref = 'booster:' || p_request) then
      raise exception 'booster_deja_ouvert' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref)
      values (auth.uid(), 0, 'booster_requete', 'booster:' || p_request);
  end if;
  n := greatest(coalesce((c->>'booster_size')::int, 5), 1);
  price := coalesce((c->>'booster_price')::int, 100);
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  pity := coalesce((c->>'pity_epique')::int, 10);
  if not god then
    if p_free then
      if w.last_free_booster is not null and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
        raise exception 'Le booster gratuit n''est pas encore disponible';
      end if;
      update hg_wallets set last_free_booster = now() where user_id = auth.uid();
    else
      if w.paillettes < price then raise exception 'Pas assez de Paillettes (il en faut %)', price; end if;
      perform hg_wallet_add(auth.uid(), -price, 'booster', null);
    end if;
  end if;
  for i in 1..n loop
    if i = n and best < 4 and pity > 0 and w.pity_epique + 1 >= pity then rar := hg_card_roll(c->'rates', 4);
    else rar := hg_card_roll(c->'rates', 1); end if;
    cid := hg_card_pick(rar);
    continue when cid is null;
    sh := random() * 100 < coalesce((c->>'shiny_rate')::numeric, 3);
    cp := hg_card_give(auth.uid(), cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
      'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select shiny from hg_card_copies where id = cp), 'serial', (select serial from hg_card_copies where id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select auth.uid(), 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !' from hg_profiles p where p.id = auth.uid();
    end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;
  update hg_wallets set boosters_opened = boosters_opened + 1,
    pity_epique = case when best >= 4 then 0 else pity_epique + 1 end, updated_at = now() where user_id = auth.uid();
  perform hg_card_check_sets(auth.uid());
  -- J3 : le client affiche le nombre réellement livré au lieu du nombre payé.
  return jsonb_build_object('cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out));
end $function$;

revoke all on function public.hg_open_booster(boolean, text) from public, anon;
grant execute on function public.hg_open_booster(boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Échanges : verrou des deux portefeuilles, dans un ordre fixe (J1)
-- ---------------------------------------------------------------------
create or replace function public.hg_trade_respond(p_trade uuid, p_accept boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t hg_card_trades; nf int; nt int; ef int; et int; bf int; bt int;
begin
  select * into t from hg_card_trades where id = p_trade for update;
  if not found or t.status <> 'proposee' then raise exception 'Offre introuvable ou déjà traitée'; end if;
  if t.to_user <> auth.uid() then raise exception 'Seul le destinataire peut répondre'; end if;
  if not p_accept then
    update hg_card_trades set status = 'refusee', resolved_at = now() where id = p_trade;
    update hg_card_copies set locked_trade = null where locked_trade = p_trade;
    return 'refusee';
  end if;
  -- J1 : verrou sur les deux portefeuilles, toujours dans le même ordre (user_id),
  -- pour que deux opérations simultanées ne voient pas un solde périmé.
  perform 1 from hg_wallets where user_id in (t.from_user, t.to_user) order by user_id for update;
  select count(*) filter (where side = 'from'), count(*) filter (where side = 'to') into ef, et from hg_card_trade_items where trade_id = p_trade;
  select count(*) into nf from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'from' and x.owner_id = t.from_user and x.locked_trade = p_trade and x.recycled_at is null;
  select count(*) into nt from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'to' and x.owner_id = t.to_user and x.locked_trade is null and x.recycled_at is null;
  if nf <> ef or nt <> et then raise exception 'Les cartes ont changé depuis l''offre : elle n''est plus valable'; end if;
  select coalesce(paillettes, 0) into bf from hg_wallets where user_id = t.from_user;
  select coalesce(paillettes, 0) into bt from hg_wallets where user_id = t.to_user;
  if coalesce(bf, 0) < t.from_paillettes or coalesce(bt, 0) < t.to_paillettes then raise exception 'Paillettes insuffisantes pour conclure'; end if;
  update hg_card_copies x set owner_id = t.to_user, locked_trade = null, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'from' and i.copy_id = x.id;
  update hg_card_copies x set owner_id = t.from_user, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'to' and i.copy_id = x.id;
  if t.from_paillettes > 0 then
    perform hg_wallet_add(t.from_user, -t.from_paillettes, 'echange', 'trade:' || p_trade || ':a');
    perform hg_wallet_add(t.to_user, t.from_paillettes, 'echange', 'trade:' || p_trade || ':b');
  end if;
  if t.to_paillettes > 0 then
    perform hg_wallet_add(t.to_user, -t.to_paillettes, 'echange', 'trade:' || p_trade || ':c');
    perform hg_wallet_add(t.from_user, t.to_paillettes, 'echange', 'trade:' || p_trade || ':d');
  end if;
  update hg_card_trades set status = 'acceptee', resolved_at = now() where id = p_trade;
  insert into hg_activity(user_id, kind, text)
    select t.from_user, 'cartes', a.pseudo || ' et ' || b.pseudo || ' ont conclu un échange de cartes'
    from hg_profiles a, hg_profiles b where a.id = t.from_user and b.id = t.to_user;
  perform hg_card_check_sets(t.from_user); perform hg_card_check_sets(t.to_user);
  return 'acceptee';
end $function$;

-- ---------------------------------------------------------------------
-- 8. Export des données personnelles, complet (S7)
--    Couvre le profil, les infos de profil, le Secret Santa, les messages envoyés,
--    les sorties et moments créés, les votes de date, les photos, les idées,
--    l'assistance, les badges, les captures, et le jeu de cartes.
-- ---------------------------------------------------------------------
create or replace function public.hg_export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  'profil', (select to_jsonb(p) from hg_profiles p where id = auth.uid()),
  'infos_profil', (select to_jsonb(x) from hg_profile_info x where user_id = auth.uid()),
  'secret_santa_participations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_participants x where user_id = auth.uid()),
  'souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ss_wishes x where user_id = auth.uid()),
  'reponses_irl', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_rsvps x where user_id = auth.uid()),
  'sorties_creees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_events x where created_by = auth.uid()),
  'votes_dates', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_event_date_votes x where user_id = auth.uid()),
  'photos', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_photos x where user_id = auth.uid()),
  'moments_crees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_moments x where created_by = auth.uid()),
  'messages_envoyes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from hg_messages x where sender_id = auth.uid()),
  'conversations', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_conversation_members x where user_id = auth.uid()),
  'idees', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_ideas x where user_id = auth.uid()),
  'assistance', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_support x where user_id = auth.uid()),
  'badges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_user_badges x where user_id = auth.uid()),
  'captures_evenements', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_dyn_captures x where user_id = auth.uid()),
  'jeu_de_cartes', jsonb_build_object(
    'portefeuille', (select to_jsonb(w) from hg_wallets w where user_id = auth.uid()),
    'journal', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from hg_wallet_log x where user_id = auth.uid()),
    'exemplaires', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_copies x where owner_id = auth.uid()),
    'echanges', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_trades x where from_user = auth.uid() or to_user = auth.uid()),
    'liste_souhaits', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_wishlist x where user_id = auth.uid()),
    'vitrine', (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from hg_card_showcase x where user_id = auth.uid())
  )
);
$$;

-- ---------------------------------------------------------------------
-- 9. Suppression de compte : version de production, reprise ici (S8)
--    Remplace la version de 001 (qui ne supprimait pas l'identifiant de connexion).
-- ---------------------------------------------------------------------
create or replace function public.hg_delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  delete from public.hg_profiles where id = v_uid;
  if not exists (select 1 from public.d_projects where owner_id = v_uid)
     and not exists (select 1 from public.d_settings where user_id = v_uid) then
    delete from auth.users where id = v_uid;
  end if;
end $function$;
revoke execute on function public.hg_delete_my_account() from anon, public;
grant execute on function public.hg_delete_my_account() to authenticated;
