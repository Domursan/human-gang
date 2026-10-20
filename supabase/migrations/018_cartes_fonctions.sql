-- ===== 018 (b) : jeu de cartes — fonctions =====
-- Les tables (hg_card_sets, hg_cards, hg_card_copies, hg_wallets, hg_wallet_log, hg_card_trades,
-- hg_card_trade_items, hg_card_wishlist, hg_card_showcase) et le réglage hg_settings.cards sont créés
-- dans 018_cartes_tables.sql. Toute l'économie passe par ces fonctions : aucun argent réel.

create or replace function public.hg_card_cfg() returns jsonb language sql stable security definer set search_path = public as
$$ select coalesce((select value from hg_settings where key = 'cards'), '{}'::jsonb) $$;

create or replace function public.hg_card_rank(p text) returns int language sql immutable as
$$ select array_position(array['commune','peu_commune','rare','epique','legendaire','mythique','identite'], p) $$;

-- Mouvement de Paillettes (interne). Idempotent quand p_ref est donné.
create or replace function public.hg_wallet_add(p_user uuid, p_delta int, p_reason text, p_ref text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_user is null or coalesce(p_delta, 0) = 0 then return false; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  insert into hg_wallet_log(user_id, delta, reason, ref) values (p_user, p_delta, p_reason, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;
  update hg_wallets set paillettes = paillettes + p_delta, updated_at = now() where user_id = p_user;
  return true;
end $$;

-- Tirage d'une rareté selon les taux (à partir du rang p_min)
create or replace function public.hg_card_roll(p_rates jsonb, p_min int default 1) returns text language plpgsql volatile as $$
declare ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  total numeric := 0; acc numeric := 0; r numeric; i int;
begin
  for i in p_min..7 loop total := total + greatest(coalesce((p_rates->>ord[i])::numeric, 0), 0); end loop;
  if total <= 0 then return ord[p_min]; end if;
  r := random() * total;
  for i in p_min..7 loop
    acc := acc + greatest(coalesce((p_rates->>ord[i])::numeric, 0), 0);
    if r < acc then return ord[i]; end if;
  end loop;
  return ord[p_min];
end $$;

-- Carte disponible au hasard pour une rareté (descend d'un cran si aucune)
create or replace function public.hg_card_pick(p_rarity text) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite']; i int; cid uuid;
begin
  i := array_position(ord, p_rarity);
  while i >= 1 loop
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id
     where k.active and s.active and k.rarity = ord[i]
       and (s.starts_at is null or s.starts_at <= now()) and (s.ends_at is null or s.ends_at > now())
       and (k.max_copies is null or (select count(*) from hg_card_copies x where x.card_id = k.id) < k.max_copies)
     order by random() limit 1;
    if cid is not null then return cid; end if;
    i := i - 1;
  end loop;
  return null;
end $$;

-- Création d'un exemplaire (numéroté si la carte est limitée)
create or replace function public.hg_card_give(p_user uuid, p_card uuid, p_shiny boolean, p_source text)
returns bigint language plpgsql security definer set search_path = public as $$
declare k hg_cards; s int; cid bigint;
begin
  select * into k from hg_cards where id = p_card for update;
  if not found then raise exception 'Carte introuvable'; end if;
  if k.max_copies is not null then
    select coalesce(max(serial), 0) + 1 into s from hg_card_copies where card_id = p_card;
    if s > k.max_copies then raise exception 'Plus aucun exemplaire disponible pour « % »', k.name; end if;
  end if;
  insert into hg_card_copies(card_id, owner_id, shiny, serial, source)
    values (p_card, p_user, coalesce(p_shiny, false) and k.can_shiny, s, p_source) returning id into cid;
  return cid;
end $$;

-- Récompense de série complète (hors cartes Identité), une seule fois par série
create or replace function public.hg_card_check_sets(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare s record; bonus int := coalesce((hg_card_cfg()#>>'{rewards,set_complete}')::int, 300);
begin
  for s in select st.id, st.name from hg_card_sets st
    where exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity <> 'identite')
      and not exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity <> 'identite'
        and not exists (select 1 from hg_card_copies x where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
  loop
    if hg_wallet_add(p_user, bonus, 'serie_complete', 'set:' || s.id) then
      insert into hg_activity(user_id, kind, text)
        select p_user, 'cartes', p.pseudo || ' a complété la série « ' || s.name || ' » !' from hg_profiles p where p.id = p_user;
    end if;
  end loop;
end $$;

-- État du joueur
create or replace function public.hg_cards_me() returns jsonb language plpgsql security definer set search_path = public as $$
declare w hg_wallets; c jsonb := hg_card_cfg(); hrs numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid();
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  return jsonb_build_object(
    'paillettes', w.paillettes, 'boosters_opened', w.boosters_opened, 'pity', w.pity_epique,
    'daily_streak', w.daily_streak,
    'daily_available', w.last_daily is distinct from (now() at time zone 'Europe/Zurich')::date,
    'free_booster_at', case when w.last_free_booster is null then now() else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'god', hg_god_mode(), 'config', c);
end $$;

-- Passage du jour (+ bonus de série de jours)
create or replace function public.hg_cards_daily() returns jsonb language plpgsql security definer set search_path = public as $$
declare w hg_wallets; c jsonb := hg_card_cfg(); today date := (now() at time zone 'Europe/Zurich')::date; streak int; gain int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  if w.last_daily = today then raise exception 'Déjà récupéré aujourd''hui'; end if;
  streak := case when w.last_daily = today - 1 then least(w.daily_streak + 1, coalesce((c#>>'{rewards,streak_max}')::int, 7)) else 1 end;
  gain := coalesce((c#>>'{rewards,daily}')::int, 20) + (streak - 1) * coalesce((c#>>'{rewards,streak_bonus}')::int, 5);
  update hg_wallets set last_daily = today, daily_streak = streak where user_id = auth.uid();
  perform hg_wallet_add(auth.uid(), gain, 'quotidien', today::text);
  return jsonb_build_object('gain', gain, 'streak', streak);
end $$;

-- Ouverture d'un booster (payant ou gratuit ; illimité en mode sans limite)
create or replace function public.hg_open_booster(p_free boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; price int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
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
  return jsonb_build_object('cards', out, 'best', ord[best]);
end $$;

-- Recyclage de doublons
create or replace function public.hg_card_recycle(p_copies bigint[]) returns int language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_card_cfg(); total int := 0; cnt int := 0; r record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  for r in select x.id, x.shiny, k.rarity from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = auth.uid() and x.recycled_at is null and x.locked_trade is null for update of x
  loop
    if r.rarity = 'identite' then raise exception 'Les cartes Identité ne se recyclent pas'; end if;
    total := total + coalesce((c#>>array['recycle', r.rarity])::int, 0)
      * case when r.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end;
    update hg_card_copies set recycled_at = now() where id = r.id;
    cnt := cnt + 1;
  end loop;
  if cnt <> coalesce(array_length(p_copies, 1), 0) then raise exception 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)'; end if;
  perform hg_wallet_add(auth.uid(), total, 'recyclage', null);
  return total;
end $$;

-- Fabrication d'une carte précise
create or replace function public.hg_card_craft(p_card uuid, p_shiny boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_card_cfg(); k hg_cards; cost int; bal int; cp bigint; god boolean := hg_god_mode();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable'; end if;
  cost := (c#>>array['craft', k.rarity])::int;
  if not god and (not k.craftable or k.rarity in ('mythique', 'identite') or cost is null) then raise exception 'Cette carte ne peut pas être fabriquée'; end if;
  cost := coalesce(cost, 0) * case when p_shiny then coalesce((c#>>'{craft,shiny_multiplier}')::int, 4) else 1 end;
  if not god then
    insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
    select paillettes into bal from hg_wallets where user_id = auth.uid() for update;
    if bal < cost then raise exception 'Pas assez de Paillettes (il en faut %)', cost; end if;
    perform hg_wallet_add(auth.uid(), -cost, 'fabrication', null);
  end if;
  cp := hg_card_give(auth.uid(), p_card, p_shiny, 'fabrication');
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('copy_id', cp, 'cost', cost);
end $$;

-- Échanges : proposer (ou contre-proposer)
create or replace function public.hg_trade_propose(p_to uuid, p_give bigint[], p_want bigint[], p_give_p int default 0,
  p_want_p int default 0, p_message text default null, p_parent uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid; par hg_card_trades; c jsonb := hg_card_cfg(); bal int; ng int; nw int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me then raise exception 'Destinataire invalide'; end if;
  if not exists (select 1 from hg_profiles where id = p_to) then raise exception 'Membre introuvable'; end if;
  p_give := coalesce(p_give, '{}'); p_want := coalesce(p_want, '{}');
  p_give_p := greatest(coalesce(p_give_p, 0), 0); p_want_p := greatest(coalesce(p_want_p, 0), 0);
  if cardinality(p_give) + cardinality(p_want) = 0 and p_give_p + p_want_p = 0 then raise exception 'L''offre est vide'; end if;
  if (select count(*) from hg_card_trades where from_user = me and status = 'proposee') >= coalesce((c->>'max_open_trades')::int, 10) then
    raise exception 'Trop d''offres en cours'; end if;
  select count(*) into ng from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_give) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  select count(*) into nw from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_want) and x.owner_id = p_to and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if ng <> cardinality(p_give) or nw <> cardinality(p_want) then raise exception 'Certaines cartes ne sont pas échangeables'; end if;
  select paillettes into bal from hg_wallets where user_id = me;
  if coalesce(bal, 0) < p_give_p then raise exception 'Pas assez de Paillettes'; end if;
  if p_parent is not null then
    select * into par from hg_card_trades where id = p_parent for update;
    if not found or par.status <> 'proposee' or par.to_user <> me or par.from_user <> p_to then raise exception 'Offre d''origine invalide'; end if;
    update hg_card_trades set status = 'remplacee', resolved_at = now() where id = p_parent;
    update hg_card_copies set locked_trade = null where locked_trade = p_parent;
  end if;
  insert into hg_card_trades(from_user, to_user, from_paillettes, to_paillettes, message, parent_id)
    values (me, p_to, p_give_p, p_want_p, left(p_message, 500), p_parent) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_give), 'from';
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_want), 'to';
  update hg_card_copies set locked_trade = t where id = any(p_give);
  return t;
end $$;

-- Échanges : accepter ou refuser (destinataire)
create or replace function public.hg_trade_respond(p_trade uuid, p_accept boolean) returns text language plpgsql security definer set search_path = public as $$
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
end $$;

-- Échanges : annuler (auteur ou admin)
create or replace function public.hg_trade_cancel(p_trade uuid) returns void language plpgsql security definer set search_path = public as $$
declare t hg_card_trades;
begin
  select * into t from hg_card_trades where id = p_trade for update;
  if not found or t.status <> 'proposee' then raise exception 'Offre introuvable ou déjà traitée'; end if;
  if t.from_user <> auth.uid() and not hg_is_admin() then raise exception 'Action non autorisée'; end if;
  update hg_card_trades set status = 'annulee', resolved_at = now() where id = p_trade;
  update hg_card_copies set locked_trade = null where locked_trade = p_trade;
end $$;

-- Cadeau direct (garde une trace dans l'historique des échanges)
create or replace function public.hg_card_gift(p_to uuid, p_copies bigint[], p_message text default null) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t uuid; n int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me or not exists (select 1 from hg_profiles where id = p_to) then raise exception 'Destinataire invalide'; end if;
  if coalesce(cardinality(p_copies), 0) = 0 then raise exception 'Aucune carte choisie'; end if;
  select count(*) into n from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if n <> cardinality(p_copies) then raise exception 'Certaines cartes ne peuvent pas être offertes'; end if;
  insert into hg_card_trades(from_user, to_user, status, message, resolved_at) values (me, p_to, 'acceptee', left(coalesce(p_message, 'Cadeau'), 500), now()) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_copies), 'from';
  update hg_card_copies set owner_id = p_to, source = 'cadeau' where id = any(p_copies);
  perform hg_card_check_sets(p_to);
  return t;
end $$;

-- Classement
create or replace function public.hg_card_leaderboard() returns table(user_id uuid, pseudo text, avatar_url text, uniques bigint, copies bigint,
  shinies bigint, identites bigint, series bigint, score bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.avatar_url,
    count(distinct x.card_id), count(x.id), count(x.id) filter (where x.shiny),
    count(x.id) filter (where k.rarity = 'identite'),
    (select count(*) from hg_wallet_log l where l.user_id = p.id and l.reason = 'serie_complete'),
    coalesce(sum(case k.rarity when 'commune' then 1 when 'peu_commune' then 2 when 'rare' then 5 when 'epique' then 12
      when 'legendaire' then 30 when 'mythique' then 80 when 'identite' then 200 else 0 end * case when x.shiny then 2 else 1 end), 0)::bigint
  from hg_profiles p
  left join hg_card_copies x on x.owner_id = p.id and x.recycled_at is null
  left join hg_cards k on k.id = x.card_id
  where public.hg_is_member()
  group by p.id, p.pseudo, p.avatar_url
  order by 9 desc, 4 desc
$$;

-- Admin : donner des cartes, ajuster les Paillettes, retirer un exemplaire
create or replace function public.hg_cards_admin_give(p_user uuid, p_card uuid, p_shiny boolean default false, p_count int default 1)
returns int language plpgsql security definer set search_path = public as $$
declare i int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  for i in 1..greatest(least(coalesce(p_count, 1), 100), 1) loop perform hg_card_give(p_user, p_card, p_shiny, 'admin'); end loop;
  perform hg_card_check_sets(p_user);
  return greatest(least(coalesce(p_count, 1), 100), 1);
end $$;

create or replace function public.hg_cards_admin_paillettes(p_user uuid, p_delta int, p_reason text default 'admin')
returns int language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  insert into hg_wallets(user_id) values (p_user) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = p_user;
  perform hg_wallet_add(p_user, greatest(p_delta, -bal), coalesce(nullif(p_reason, ''), 'admin'), null);
  select paillettes into bal from hg_wallets where user_id = p_user;
  return bal;
end $$;

create or replace function public.hg_cards_admin_take(p_copy bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  update hg_card_copies set recycled_at = now(), locked_trade = null where id = p_copy;
end $$;

-- Gains liés à l'activité sur le site (jamais bloquants)
create or replace function public.hg_cards_earn_trg() returns trigger language plpgsql security definer set search_path = public as $$
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
  exception when others then null;
  end;
  return new;
end $$;

create trigger hg_cards_earn after insert or update of status on public.hg_event_rsvps for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after insert on public.hg_events for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after insert on public.hg_photos for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after insert on public.hg_moments for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after insert on public.hg_user_badges for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after insert on public.hg_dyn_captures for each row execute function public.hg_cards_earn_trg();
create trigger hg_cards_earn after update of sent_at on public.hg_ss_participants for each row execute function public.hg_cards_earn_trg();

-- Présence aux sorties IRL passées (« oui » à une sortie terminée), toutes les heures
create or replace function public.hg_cards_presence() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; g int := coalesce((hg_card_cfg()#>>'{rewards,presence}')::int, 30);
begin
  for r in select v.user_id, v.event_id from hg_event_rsvps v join hg_events e on e.id = v.event_id
    where v.status = 'oui' and e.starts_at < now() and e.starts_at > now() - interval '60 days'
  loop
    if hg_wallet_add(r.user_id, g, 'presence', 'presence:' || r.event_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
select cron.schedule('hg-cards-hourly', '23 * * * *', 'select public.hg_cards_presence()');

update public.hg_settings set value = jsonb_set(value, '{rewards,set_complete}', '300') where key = 'cards';

-- Droits : seules les fonctions « joueur » et « admin » sont appelables depuis le site
revoke execute on function public.hg_wallet_add(uuid, int, text, text), public.hg_card_give(uuid, uuid, boolean, text),
  public.hg_card_check_sets(uuid), public.hg_card_pick(text), public.hg_cards_presence(), public.hg_cards_earn_trg()
  from public, anon, authenticated;
revoke execute on function public.hg_cards_me(), public.hg_cards_daily(), public.hg_open_booster(boolean), public.hg_card_recycle(bigint[]),
  public.hg_card_craft(uuid, boolean), public.hg_trade_propose(uuid, bigint[], bigint[], int, int, text, uuid), public.hg_trade_respond(uuid, boolean),
  public.hg_trade_cancel(uuid), public.hg_card_gift(uuid, bigint[], text), public.hg_card_leaderboard(),
  public.hg_cards_admin_give(uuid, uuid, boolean, int), public.hg_cards_admin_paillettes(uuid, int, text), public.hg_cards_admin_take(bigint), public.hg_card_cfg()
  from public, anon;
grant execute on function public.hg_cards_me(), public.hg_cards_daily(), public.hg_open_booster(boolean), public.hg_card_recycle(bigint[]),
  public.hg_card_craft(uuid, boolean), public.hg_trade_propose(uuid, bigint[], bigint[], int, int, text, uuid), public.hg_trade_respond(uuid, boolean),
  public.hg_trade_cancel(uuid), public.hg_card_gift(uuid, bigint[], text), public.hg_card_leaderboard(),
  public.hg_cards_admin_give(uuid, uuid, boolean, int), public.hg_cards_admin_paillettes(uuid, int, text), public.hg_cards_admin_take(bigint), public.hg_card_cfg()
  to authenticated;
