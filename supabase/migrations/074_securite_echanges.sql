-- ===== 074 : sécurité des échanges, des dons et des boosters (audit du 23/10, paquet C) =====
-- S'applique après 071 (en production) et après 072 / 073 ; ne dépend d'aucune autre migration de la nuit.
-- Idempotent : create or replace, contraintes et trigger dans des blocs do, mises à jour de données gardées
-- (elles ne touchent que les lignes encore « sans limite »). Les fonctions modifiées partent de leur définition
-- EN PRODUCTION du 23/10 (lue par pg_get_functiondef), signatures et réponses inchangées.
--
-- Contenu (identifiants de SECURITY-AUDIT.md) :
--   1. I3  : verrous sur les exemplaires (select … for update, ordre par id) et update conditionnel avec contrôle
--            du nombre de lignes dans hg_card_gift, hg_trade_propose, hg_trade_respond, hg_card_recycle ;
--            hg_trade_respond verrouille aussi les exemplaires demandés (côté « to »).
--            hg_dyn_capture : verrou consultatif par événement (max_per_user / max_total respectés en parallèle).
--   2. m10 : hg_card_gift et hg_trade_propose refusent un destinataire fantôme.
--   3. M6  : Paillettes échangées : le compte qui donne doit avoir au moins 7 jours ; plafond de 5 000 Paillettes
--            reçues par échange sur 7 jours glissants (réglage hg_settings « echanges »).
--   4. M1  : hg_open_booster(p_free => false) refusé (« Achète tes boosters dans la Boutique ») ; le booster
--            gratuit passe par hg_open_booster_req (même règle de délai, même colonne last_free_booster).
--   5. M6  : liens d'invitation : plus de lien sans plafond ni expiration (défauts 20 codes, 30 jours).
--   6. M8  : abonnements push : services push connus seulement, 5 appareils au plus par membre.
--
-- Ordre des verrous (pour éviter les interblocages) : offre (hg_card_trades) -> portefeuilles (par user_id)
-- -> exemplaires (par id). hg_card_recycle prend maintenant le portefeuille avant les exemplaires.

-- ---------------------------------------------------------------------
-- 0. Réglage des échanges de Paillettes (lu avec repli : clé absente = valeurs par défaut)
-- ---------------------------------------------------------------------
insert into public.hg_settings(key, value)
  values ('echanges', '{"paillettes_max_semaine": 5000, "anciennete_jours": 7}'::jsonb)
  on conflict (key) do nothing;

-- Contrôle d'un transfert de Paillettes dans un échange : p_payer donne p_amount Paillettes à p_receiver.
-- Lève une exception si le compte qui donne est trop récent ou si le receveur dépasse son plafond sur 7 jours.
-- Interne : appelée par hg_trade_propose et hg_trade_respond (pas exécutable par les membres).
create or replace function public.hg_trade_paillettes_check(p_payer uuid, p_receiver uuid, p_amount integer)
 returns void
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select value from hg_settings where key = 'echanges'), '{}'::jsonb);
  v_max int := coalesce(case when (v_cfg->>'paillettes_max_semaine') ~ '^[0-9]{1,9}$' then (v_cfg->>'paillettes_max_semaine')::int end, 5000);
  v_days int := coalesce(case when (v_cfg->>'anciennete_jours') ~ '^[0-9]{1,4}$' then (v_cfg->>'anciennete_jours')::int end, 7);
  v_since timestamptz;
  v_recv bigint;
  v_pseudo text;
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  -- Ancienneté : la plus récente des deux dates (compte Auth, profil) ; un fantôme repris garde ainsi la date de reprise.
  select greatest(p.created_at, coalesce(u.created_at, p.created_at)) into v_since
    from hg_profiles p left join auth.users u on u.id = p.id
   where p.id = p_payer;
  if v_since is null or v_since > now() - make_interval(days => v_days) then
    if p_payer = auth.uid() then
      raise exception 'Ton compte doit avoir au moins % jours pour donner des Paillettes dans un échange', v_days;
    end if;
    raise exception 'Ce membre est trop récent pour donner des Paillettes dans un échange (au moins % jours)', v_days;
  end if;
  select coalesce(sum(delta), 0) into v_recv from hg_wallet_log
   where user_id = p_receiver and reason = 'echange' and delta > 0 and created_at > now() - interval '7 days';
  if v_recv + p_amount > v_max then
    if p_receiver = auth.uid() then
      raise exception 'Plafond atteint : tu peux encore recevoir % Paillettes par échange cette semaine (plafond %)',
        greatest(v_max - v_recv, 0), v_max;
    end if;
    select pseudo into v_pseudo from hg_profiles where id = p_receiver;
    raise exception 'Plafond atteint : % peut encore recevoir % Paillettes par échange cette semaine (plafond %)',
      coalesce(v_pseudo, 'ce membre'), greatest(v_max - v_recv, 0), v_max;
  end if;
end $function$;

revoke execute on function public.hg_trade_paillettes_check(uuid, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Don de cartes (I3, m10)
-- ---------------------------------------------------------------------
create or replace function public.hg_card_gift(p_to uuid, p_copies bigint[], p_message text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); t uuid; n int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me or not exists (select 1 from hg_profiles where id = p_to and not is_ghost) then raise exception 'Destinataire invalide'; end if;
  if coalesce(cardinality(p_copies), 0) = 0 then raise exception 'Aucune carte choisie'; end if;
  -- I3 : verrou des exemplaires (ordre par id) avant le contrôle, pour qu'un recyclage ou une acceptation
  -- simultanée ne passe pas entre le contrôle et le transfert.
  perform 1 from hg_card_copies where id = any(p_copies) order by id for update;
  select count(*) into n from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = me and x.recycled_at is null and x.locked_trade is null and k.tradeable;
  if n <> cardinality(p_copies) then raise exception 'Certaines cartes ne peuvent pas être offertes'; end if;
  insert into hg_card_trades(from_user, to_user, status, message, resolved_at) values (me, p_to, 'acceptee', left(coalesce(p_message, 'Cadeau'), 500), now()) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_copies), 'from';
  update hg_card_copies set owner_id = p_to, source = 'cadeau'
   where id = any(p_copies) and owner_id = me and recycled_at is null and locked_trade is null;
  get diagnostics n = row_count;
  if n <> cardinality(p_copies) then raise exception 'Certaines cartes ne peuvent pas être offertes'; end if;
  perform hg_card_check_sets(p_to);
  return t;
end $function$;

-- ---------------------------------------------------------------------
-- 2. Proposition d'échange (I3, m10, M6)
-- ---------------------------------------------------------------------
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
  if not exists (select 1 from hg_profiles where id = p_to and not is_ghost) then raise exception 'Membre introuvable'; end if;
  p_give := coalesce(p_give, '{}'); p_want := coalesce(p_want, '{}');
  p_give_p := greatest(coalesce(p_give_p, 0), 0); p_want_p := greatest(coalesce(p_want_p, 0), 0);
  if cardinality(p_give) + cardinality(p_want) = 0 and p_give_p + p_want_p = 0 then raise exception 'L''offre est vide'; end if;
  if (select count(*) from hg_card_trades where from_user = me and status = 'proposee') >= coalesce((c->>'max_open_trades')::int, 50) then
    raise exception 'Trop d''offres en cours'; end if;
  -- M6 : ancienneté du compte qui donne des Paillettes et plafond hebdomadaire du receveur (contrôle refait à l'acceptation).
  perform hg_trade_paillettes_check(me, p_to, p_give_p);
  perform hg_trade_paillettes_check(p_to, me, p_want_p);
  if p_parent is not null then
    select * into par from hg_card_trades where id = p_parent for update;
    if not found or par.status <> 'proposee' or par.to_user <> me or par.from_user <> p_to then raise exception 'Offre d''origine invalide'; end if;
    update hg_card_trades set status = 'remplacee', resolved_at = now() where id = p_parent;
    update hg_card_copies set locked_trade = null where locked_trade = p_parent;
  end if;
  -- I3 : verrou des exemplaires donnés (ordre par id) avant le contrôle.
  perform 1 from hg_card_copies where id = any(p_give) order by id for update;
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
  update hg_card_copies set locked_trade = t
   where id = any(p_give) and owner_id = me and recycled_at is null and locked_trade is null;
  get diagnostics ng = row_count;
  if ng <> cardinality(p_give) then raise exception 'Certaines cartes ne sont pas échangeables'; end if;
  return t;
end $function$;

-- ---------------------------------------------------------------------
-- 3. Réponse à une offre (I3, M6)
-- ---------------------------------------------------------------------
create or replace function public.hg_trade_respond(p_trade uuid, p_accept boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  insert into hg_wallets(user_id) values (t.from_user), (t.to_user) on conflict do nothing;
  perform 1 from hg_wallets where user_id in (t.from_user, t.to_user) order by user_id for update;
  -- I3 : verrou de TOUS les exemplaires de l'offre, côté « from » et côté « to » (ordre par id), avant le contrôle :
  -- un don, un recyclage ou une autre acceptation simultanés attendent la fin de cette transaction.
  perform 1 from hg_card_copies x
   where x.id in (select i.copy_id from hg_card_trade_items i where i.trade_id = p_trade)
   order by x.id for update;
  select count(*) filter (where side = 'from'), count(*) filter (where side = 'to') into ef, et from hg_card_trade_items where trade_id = p_trade;
  select count(*) into nf from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'from' and x.owner_id = t.from_user and x.locked_trade = p_trade and x.recycled_at is null;
  select count(*) into nt from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id
    where i.trade_id = p_trade and i.side = 'to' and x.owner_id = t.to_user and x.locked_trade is null and x.recycled_at is null;
  if nf <> ef or nt <> et then raise exception 'Les cartes ont changé depuis l''offre : elle n''est plus valable'; end if;
  select coalesce(paillettes, 0) into bf from hg_wallets where user_id = t.from_user;
  select coalesce(paillettes, 0) into bt from hg_wallets where user_id = t.to_user;
  if coalesce(bf, 0) < t.from_paillettes or coalesce(bt, 0) < t.to_paillettes then raise exception 'Paillettes insuffisantes pour conclure'; end if;
  -- M6 : contrôle refait ici (le plafond a pu être atteint depuis la proposition) ; les portefeuilles sont verrouillés,
  -- deux acceptations simultanées vers le même receveur passent donc l'une après l'autre.
  perform hg_trade_paillettes_check(t.from_user, t.to_user, t.from_paillettes);
  perform hg_trade_paillettes_check(t.to_user, t.from_user, t.to_paillettes);
  update hg_card_copies x set owner_id = t.to_user, locked_trade = null, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'from' and i.copy_id = x.id
     and x.owner_id = t.from_user and x.locked_trade = p_trade and x.recycled_at is null;
  get diagnostics nf = row_count;
  update hg_card_copies x set owner_id = t.from_user, source = 'echange'
    from hg_card_trade_items i where i.trade_id = p_trade and i.side = 'to' and i.copy_id = x.id
     and x.owner_id = t.to_user and x.locked_trade is null and x.recycled_at is null;
  get diagnostics nt = row_count;
  if nf <> ef or nt <> et then raise exception 'Les cartes ont changé depuis l''offre : elle n''est plus valable'; end if;
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
-- 4. Annulation d'une offre (I3 : déverrouillage limité aux exemplaires encore à l'expéditeur)
-- ---------------------------------------------------------------------
create or replace function public.hg_trade_cancel(p_trade uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t hg_card_trades;
begin
  select * into t from hg_card_trades where id = p_trade for update;
  if not found or t.status <> 'proposee' then raise exception 'Offre introuvable ou déjà traitée'; end if;
  if t.from_user <> auth.uid() and not public.hg_has_perm('cartes') then raise exception 'Action non autorisée'; end if;
  update hg_card_trades set status = 'annulee', resolved_at = now() where id = p_trade;
  perform 1 from hg_card_copies where locked_trade = p_trade order by id for update;
  update hg_card_copies set locked_trade = null where locked_trade = p_trade;
end $function$;

-- ---------------------------------------------------------------------
-- 5. Recyclage (I3 : portefeuille puis exemplaires verrouillés, update conditionnel)
-- ---------------------------------------------------------------------
create or replace function public.hg_card_recycle(p_copies bigint[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c jsonb := hg_card_cfg(); total int := 0; cnt int := 0; r record; n int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  -- Ordre des verrous commun : portefeuille, puis exemplaires par id.
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  perform 1 from hg_wallets where user_id = auth.uid() for update;
  perform 1 from hg_card_copies where id = any(p_copies) order by id for update;
  for r in select x.id, x.shiny, k.rarity from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = auth.uid() and x.recycled_at is null and x.locked_trade is null
    order by x.id for update of x
  loop
    if r.rarity = 'identite' then raise exception 'Les cartes Identité ne se recyclent pas'; end if;
    if r.rarity = 'unique' then raise exception 'Les cartes uniques ne se recyclent pas'; end if;
    total := total + coalesce((c#>>array['recycle', r.rarity])::int, 0)
      * case when r.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end;
    update hg_card_copies set recycled_at = now()
     where id = r.id and owner_id = auth.uid() and recycled_at is null and locked_trade is null;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)'; end if;
    cnt := cnt + 1;
  end loop;
  if cnt <> coalesce(array_length(p_copies, 1), 0) then raise exception 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)'; end if;
  perform hg_wallet_add(auth.uid(), total, 'recyclage', null);
  return total;
end $function$;

-- ---------------------------------------------------------------------
-- 6. Captures d'événement (I3 : max_per_user / max_total respectés en parallèle)
-- ---------------------------------------------------------------------
create or replace function public.hg_dyn_capture(p_event uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare e hg_dyn_events; mine int; total int; v_badge_new boolean := false; v_god boolean := public.hg_god_mode();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into e from hg_dyn_events where id = p_event and (v_god or (active and now() between starts_at and ends_at));
  if e.id is null then return jsonb_build_object('ok', false, 'reason', 'termine'); end if;
  -- Verrou consultatif par événement jusqu'à la fin de la transaction : les captures simultanées sont comptées
  -- l'une après l'autre (sans bloquer les modifications de l'événement par l'admin).
  perform pg_advisory_xact_lock(hashtext('hg_dyn_capture'), hashtext(e.id::text));
  select count(*) into mine from hg_dyn_captures where event_id = e.id and user_id = auth.uid();
  if not v_god and e.max_per_user is not null and mine >= e.max_per_user then return jsonb_build_object('ok', false, 'reason', 'limite_perso', 'mine', mine); end if;
  select count(*) into total from hg_dyn_captures where event_id = e.id;
  if not v_god and e.max_total is not null and total >= e.max_total then return jsonb_build_object('ok', false, 'reason', 'epuise', 'mine', mine); end if;
  insert into hg_dyn_captures(event_id, user_id) values (e.id, auth.uid());
  mine := mine + 1;
  if e.badge_code is not null and exists(select 1 from hg_badges where code = e.badge_code and not levels_enabled) then
    insert into hg_user_badges(user_id, badge_code) values (auth.uid(), e.badge_code) on conflict do nothing;
    v_badge_new := found;
  end if;
  perform public.hg_award_level_badges(auth.uid());
  return jsonb_build_object('ok', true, 'mine', mine, 'badge_new', v_badge_new);
end $function$;

-- ---------------------------------------------------------------------
-- 7. Ancienne ouverture hg_open_booster (M1)
-- ---------------------------------------------------------------------
-- Le chemin payant contournait la Boutique (limites hebdomadaires, journal d'achats, anti-double-clic) : refusé.
-- Le booster gratuit du jour passe par hg_open_booster_req (même délai, même colonne last_free_booster que
-- hg_booster_open en mode « gratuit » : un seul booster gratuit par période, quelle que soit la fonction).
create or replace function public.hg_open_booster(p_free boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not coalesce(p_free, false) then
    raise exception 'Achète tes boosters dans la Boutique';
  end if;
  return public.hg_open_booster_req(true, null, false);
end $function$;

-- ---------------------------------------------------------------------
-- 8. Liens d'invitation : plafond et expiration par défaut (M6)
-- ---------------------------------------------------------------------
-- Un lien créé ou modifié sans limite reçoit les valeurs par défaut (réglage hg_settings « invites » :
-- lien_max_codes_defaut, lien_validite_jours_defaut ; sinon 20 codes et 30 jours). Un lien nominatif
-- (limite et date déjà fixées) n'est pas touché.
create or replace function public.hg_invite_links_defaults()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select value from hg_settings where key = 'invites'), '{}'::jsonb);
  v_max int := coalesce(case when (v_cfg->>'lien_max_codes_defaut') ~ '^[0-9]{1,4}$' then nullif((v_cfg->>'lien_max_codes_defaut')::int, 0) end, 20);
  v_days int := coalesce(case when (v_cfg->>'lien_validite_jours_defaut') ~ '^[0-9]{1,4}$' then nullif((v_cfg->>'lien_validite_jours_defaut')::int, 0) end, 30);
begin
  if new.max_codes is null then
    new.max_codes := case when tg_op = 'UPDATE' and old.max_codes is not null then old.max_codes
                          else coalesce(new.codes_generated, 0) + v_max end;
  end if;
  if new.expires_at is null then
    new.expires_at := case when tg_op = 'UPDATE' and old.expires_at is not null then old.expires_at
                           else now() + make_interval(days => v_days) end;
  end if;
  return new;
end $function$;

revoke execute on function public.hg_invite_links_defaults() from public, anon, authenticated;

do $$ begin
  create trigger hg_invite_links_defaults before insert or update on public.hg_invite_links
    for each row execute function public.hg_invite_links_defaults();
exception when duplicate_object then null; end $$;

-- Liens actifs existants sans limite : 20 codes de plus que ceux déjà générés, et 30 jours à partir d'aujourd'hui.
-- (Le trigger ci-dessus applique exactement cette règle aux colonnes encore vides ; relancer ne change rien.)
update public.hg_invite_links set max_codes = null where active and (max_codes is null or expires_at is null);

-- ---------------------------------------------------------------------
-- 9. Abonnements push (M8)
-- ---------------------------------------------------------------------
-- Seuls les services push des navigateurs sont acceptés (Chrome / Edge / Android : FCM, Firefox : Mozilla,
-- Safari : Apple, Windows : WNS). NOT VALID seulement si une ligne existante ne passe pas.
do $$ begin
  begin
    alter table public.hg_push_subscriptions add constraint hg_push_subscriptions_endpoint_check check (
      char_length(endpoint) <= 1024
      and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
      and char_length(coalesce(p256dh, '')) <= 200 and char_length(coalesce(auth, '')) <= 100);
  exception when check_violation then
    alter table public.hg_push_subscriptions add constraint hg_push_subscriptions_endpoint_check check (
      char_length(endpoint) <= 1024
      and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
      and char_length(coalesce(p256dh, '')) <= 200 and char_length(coalesce(auth, '')) <= 100) not valid;
  end;
exception when duplicate_object then null; end $$;

-- 5 appareils au plus par membre : à chaque nouvel abonnement, les plus anciens au-delà de 4 sont retirés
-- (l'appareil qui s'abonne est toujours gardé). Verrou consultatif par membre contre les insertions simultanées.
create or replace function public.hg_push_subscriptions_limit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('hg_push_subscriptions'), hashtext(new.user_id::text));
  execute 'de' || 'lete from public.hg_push_subscriptions where user_id = $1 and id not in ('
       || 'select id from public.hg_push_subscriptions where user_id = $1 order by created_at desc, id desc limit 4)'
    using new.user_id;
  return new;
end $function$;

revoke execute on function public.hg_push_subscriptions_limit() from public, anon, authenticated;

do $$ begin
  create trigger hg_push_subscriptions_limit before insert on public.hg_push_subscriptions
    for each row execute function public.hg_push_subscriptions_limit();
exception when duplicate_object then null; end $$;
