-- Migration 053 : réglages du lot 4 (badges automatiques, jeu de cartes, drops, quêtes).
-- Rétrocompatible : sans clé dans hg_settings, chaque fonction se comporte exactement comme avant.
-- Les valeurs de repli sont les valeurs actuellement en base (hg_settings.cards, lu le 22/10/2026),
-- et les replis divergents des migrations précédentes sont alignés sur elles.
--
-- Clés lues :
--   badges.criteres.toujours_la_sorties (5), paparazzi_photos (50), fidele_annees (3),
--   veteran_editions (5), globe_trotter_lieux (3), saisonnier_themes (7), bug_sujet ('Bug sur le site')
--     -> hg_award_badges
--   cards.drops.quantite_max (50), cards.drops.duree_max_min (1440) -> hg_drop_create
--   cards.quetes_par_semaine (3) -> hg_card_quests_pick
--   cards.rewards.* (replis alignés sur la base) -> hg_cards_daily, hg_cards_earn_trg, hg_cards_presence
--   cards.craft.shiny_multiplier (6, repli 4 avant), cards.max_open_trades (50, repli 10 avant)
--     -> hg_card_craft, hg_trade_propose
--
-- Définitions reprises de la base (pg_get_functiondef) ; seuls les points lisant un réglage sont modifiés.
-- Fonctions non modifiées : hg_card_check_sets (repli 300, déjà identique), hg_card_recycle, hg_card_roll,
-- hg_card_pick, hg_open_booster, hg_open_booster_req, hg_card_draw, hg_card_quests_me.

-- =========================================================
-- 1. Badges automatiques : critères lus dans badges.criteres
-- =========================================================
create or replace function public.hg_award_badges(p_user uuid default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c int;
  -- Première année du gang : la plus ancienne date d'arrivée connue
  v_first_year int := (select min(extract(year from coalesce(joined_on::timestamptz, created_at)))::int from hg_profiles);
  -- Critères réglables (hg_settings.badges.criteres) ; sans clé, les valeurs de repli sont celles d'avant
  v_crit jsonb := coalesce((select value->'criteres' from hg_settings where key = 'badges'), '{}'::jsonb);
begin
  with aw(user_id, code) as (
    select pt.user_id, 'premier_noel' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id
    union all select pt.user_id, 'veteran' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id having count(distinct e.id) >= coalesce((v_crit->>'veteran_editions')::int, 5)
    union all select * from (select distinct on (edition_id) user_id, 'lutin_express' from hg_ss_participants where sent_at is not null order by edition_id, sent_at) le
    union all select pt.user_id, 'sur_le_fil' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.send_deadline is not null and (pt.sent_at at time zone 'Europe/Zurich')::date = e.send_deadline
    union all select w.user_id, 'liste_parfaite' from hg_ss_wishes w join hg_ss_editions e on e.id = w.edition_id
      where e.drawn_at is not null and w.created_at < e.drawn_at
    union all select r.user_id, 'toujours_la' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() group by r.user_id having count(*) >= coalesce((v_crit->>'toujours_la_sorties')::int, 5)
    union all select created_by, 'organisateur' from hg_events where created_by is not null
    union all select r.user_id, 'globe_trotter' from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
      where r.status = 'oui' and ev.starts_at < now() and coalesce(trim(ev.location), '') <> ''
      group by r.user_id having count(distinct lower(trim(ev.location))) >= coalesce((v_crit->>'globe_trotter_lieux')::int, 3)
    union all select user_id, 'paparazzi' from hg_photos where user_id is not null group by user_id having count(*) >= coalesce((v_crit->>'paparazzi_photos')::int, 50)
    union all select user_id, 'boite_a_idees' from hg_ideas where status = 'retenue' and user_id is not null
    union all select id, 'fondateur' from hg_profiles where extract(year from coalesce(joined_on::timestamptz, created_at))::int = v_first_year
    union all select id, 'fidele' from hg_profiles where coalesce(joined_on::timestamptz, created_at) <= now() - make_interval(years => coalesce((v_crit->>'fidele_annees')::int, 3))
    union all select user_id, 'chasseur_bugs' from hg_support where subject = coalesce(v_crit->>'bug_sujet', 'Bug sur le site') and status = 'traitee' and user_id is not null
    union all select user_id, 'saisonnier' from hg_theme_seen group by user_id having count(distinct slug) >= coalesce((v_crit->>'saisonnier_themes')::int, 7)
  )
  insert into hg_user_badges(user_id, badge_code)
  select distinct a.user_id, a.code from aw a
  where a.user_id is not null and (p_user is null or a.user_id = p_user)
    and exists(select 1 from hg_profiles p where p.id = a.user_id)
    and exists(select 1 from hg_badges b where b.code = a.code)
  on conflict do nothing;
  get diagnostics c = row_count;
  return c;
end $function$;

-- =========================================================
-- 2. Jeu de cartes : replis alignés sur les valeurs en base
-- =========================================================
create or replace function public.hg_cards_daily()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w hg_wallets; c jsonb := hg_card_cfg(); today date := (now() at time zone 'Europe/Zurich')::date; streak int; gain int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  if w.last_daily = today then raise exception 'Déjà récupéré aujourd''hui'; end if;
  streak := case when w.last_daily = today - 1 then least(w.daily_streak + 1, coalesce((c#>>'{rewards,streak_max}')::int, 30)) else 1 end;
  gain := coalesce((c#>>'{rewards,daily}')::int, 100) + (streak - 1) * coalesce((c#>>'{rewards,streak_bonus}')::int, 20);
  update hg_wallets set last_daily = today, daily_streak = streak where user_id = auth.uid();
  perform hg_wallet_add(auth.uid(), gain, 'quotidien', today::text);
  return jsonb_build_object('gain', gain, 'streak', streak);
end $function$;

create or replace function public.hg_cards_earn_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb := hg_card_cfg()->'rewards';
begin
  begin
    if tg_table_name = 'hg_event_rsvps' then
      if new.status = 'oui' then perform hg_wallet_add(new.user_id, coalesce((r->>'rsvp')::int, 50), 'reponse_sortie', 'rsvp:' || new.event_id); end if;
    elsif tg_table_name = 'hg_events' then
      if not coalesce(new.retro, false) then perform hg_wallet_add(new.created_by, coalesce((r->>'event_created')::int, 100), 'sortie_creee', 'event:' || new.id); end if;
    elsif tg_table_name = 'hg_photos' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'photo')::int, 100), 'photo', 'photo:' || new.id);
    elsif tg_table_name = 'hg_moments' then
      perform hg_wallet_add(new.created_by, coalesce((r->>'moment')::int, 100), 'moment', 'moment:' || new.id);
    elsif tg_table_name = 'hg_user_badges' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'badge')::int, 500), 'badge', 'badge:' || new.badge_code);
    elsif tg_table_name = 'hg_dyn_captures' then
      perform hg_wallet_add(new.user_id, coalesce((r->>'capture')::int, 150), 'capture', 'capture:' || new.event_id);
    elsif tg_table_name = 'hg_ss_participants' then
      if new.sent_at is not null then perform hg_wallet_add(new.user_id, coalesce((r->>'gift_sent')::int, 250), 'cadeau_santa', 'santa:' || new.edition_id); end if;
    end if;
  exception when others then
    -- Ne plus avaler l'erreur : elle reste visible dans les journaux Supabase.
    raise warning 'hg_cards_earn_trg (%) : %', tg_table_name, sqlerrm;
  end;
  return new;
end $function$;

create or replace function public.hg_cards_presence()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; n int := 0; g int := coalesce((hg_card_cfg()#>>'{rewards,presence}')::int, 100);
begin
  for r in select v.user_id, v.event_id from hg_event_rsvps v join hg_events e on e.id = v.event_id
    where v.status = 'oui' and e.starts_at < now() and e.starts_at > now() - interval '60 days'
  loop
    if hg_wallet_add(r.user_id, g, 'presence', 'presence:' || r.event_id) then n := n + 1; end if;
  end loop;
  return n;
end $function$;

create or replace function public.hg_card_craft(p_card uuid, p_shiny boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c jsonb := hg_card_cfg(); k hg_cards; cost int; bal int; cp bigint; god boolean := hg_god_mode();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable'; end if;
  cost := (c#>>array['craft', k.rarity])::int;
  if not god and (not k.craftable or k.rarity in ('mythique', 'identite') or cost is null) then raise exception 'Cette carte ne peut pas être fabriquée'; end if;
  cost := coalesce(cost, 0) * case when p_shiny then coalesce((c#>>'{craft,shiny_multiplier}')::int, 6) else 1 end;
  if not god then
    insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
    select paillettes into bal from hg_wallets where user_id = auth.uid() for update;
    if bal < cost then raise exception 'Pas assez de Paillettes (il en faut %)', cost; end if;
    perform hg_wallet_add(auth.uid(), -cost, 'fabrication', null);
  end if;
  cp := hg_card_give(auth.uid(), p_card, p_shiny, 'fabrication');
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('copy_id', cp, 'cost', cost);
end $function$;

create or replace function public.hg_trade_propose(p_to uuid, p_give bigint[], p_want bigint[], p_give_p integer default 0, p_want_p integer default 0, p_message text default null::text, p_parent uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); t uuid; par hg_card_trades; c jsonb := hg_card_cfg(); bal int; ng int; nw int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me then raise exception 'Destinataire invalide'; end if;
  if not exists (select 1 from hg_profiles where id = p_to) then raise exception 'Membre introuvable'; end if;
  p_give := coalesce(p_give, '{}'); p_want := coalesce(p_want, '{}');
  p_give_p := greatest(coalesce(p_give_p, 0), 0); p_want_p := greatest(coalesce(p_want_p, 0), 0);
  if cardinality(p_give) + cardinality(p_want) = 0 and p_give_p + p_want_p = 0 then raise exception 'L''offre est vide'; end if;
  if (select count(*) from hg_card_trades where from_user = me and status = 'proposee') >= coalesce((c->>'max_open_trades')::int, 50) then
    raise exception 'Trop d''offres en cours'; end if;
  if p_parent is not null then
    select * into par from hg_card_trades where id = p_parent for update;
    if not found or par.status <> 'proposee' or par.to_user <> me or par.from_user <> p_to then raise exception 'Offre d''origine invalide'; end if;
    update hg_card_trades set status = 'remplacee', resolved_at = now() where id = p_parent;
    update hg_card_copies set locked_trade = null where locked_trade = p_parent;
  end if;
  select count(*) into ng from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_give) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  select count(*) into nw from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_want) and x.owner_id = p_to and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if ng <> cardinality(p_give) or nw <> cardinality(p_want) then raise exception 'Certaines cartes ne sont pas échangeables'; end if;
  select paillettes into bal from hg_wallets where user_id = me;
  if coalesce(bal, 0) < p_give_p then raise exception 'Pas assez de Paillettes'; end if;
  insert into hg_card_trades(from_user, to_user, from_paillettes, to_paillettes, message, parent_id)
    values (me, p_to, p_give_p, p_want_p, left(p_message, 500), p_parent) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_give), 'from';
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_want), 'to';
  update hg_card_copies set locked_trade = t where id = any(p_give);
  return t;
end $function$;

-- =========================================================
-- 3. Drops : bornes de quantité et de durée lues dans cards.drops
-- =========================================================
create or replace function public.hg_drop_create(p_card uuid, p_shiny boolean default false, p_quantity integer default 1, p_minutes integer default 30, p_announce boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k hg_cards; did uuid; ann boolean := coalesce(p_announce, true); sh boolean := coalesce(p_shiny, false);
  v_qmax int := coalesce((hg_card_cfg()#>>'{drops,quantite_max}')::int, 50);
  v_dmax int := coalesce((hg_card_cfg()#>>'{drops,duree_max_min}')::int, 1440);
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable ou inactive'; end if;
  if coalesce(p_quantity, 0) < 1 or p_quantity > v_qmax then raise exception 'La quantité doit être entre 1 et %.', v_qmax; end if;
  if coalesce(p_minutes, 0) < 1 or p_minutes > v_dmax then raise exception 'La durée doit être entre 1 et % minutes.', v_dmax; end if;
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
end $function$;

-- =========================================================
-- 4. Quêtes de la semaine : nombre tiré lu dans cards.quetes_par_semaine
-- =========================================================
create or replace function public.hg_card_quests_pick(p_week date)
 returns setof hg_card_quests_templates
 language sql
 stable
 set search_path to 'public'
as $function$
  select t.* from hg_card_quests_templates t
  where t.active
  order by md5(p_week::text || t.code), t.code
  limit coalesce((hg_card_cfg()->>'quetes_par_semaine')::int, 3)
$function$;
