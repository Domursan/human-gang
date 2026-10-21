-- ===== 042 : dons groupés (boosters, Paillettes, cartes) et boosters offerts =====
-- Idempotent : rejouable sans erreur (add column if not exists, create or replace, drop function if exists).
--
-- Contenu :
--   1. hg_wallets.gift_boosters : stock de boosters offerts par membre (ouverts sans coût, sans délai).
--   2. hg_cards_me : renvoie le stock (clé gift_boosters).
--   3. hg_open_booster_req(p_free, p_request, p_offert) : p_offert consomme un booster offert.
--      L'ancienne signature à 2 paramètres est supprimée ; les appels nommés {p_free, p_request} restent valides
--      (p_offert vaut false par défaut). Idempotence par p_request inchangée.
--   4. hg_cards_admin_bulk_give : don groupé de Paillettes, de boosters offerts ou d'une carte, à plusieurs membres
--      (ou à tout le gang). Tout ou rien : une erreur annule le don entier.
--
-- Économie : les Paillettes passent par hg_wallet_add(user, montant, 'don_admin', 'don_groupe:<lot>'),
--   idempotent par lot. Les boosters offerts ne passent pas par le journal (pas de mouvement de Paillettes).
-- Trace : une ligne hg_admin_audit par don (action 'don_groupe', détail complet), une ligne hg_activity groupée.
--
-- Points délicats (pour la relecture) :
--   - Verrou : la carte est verrouillée (for update) avant le contrôle de max_copies, puis hg_card_give la
--     verrouille à nouveau dans la même transaction ; deux dons simultanés de la même carte se suivent.
--   - Les soldes sont verrouillés par la mise à jour de hg_wallets (hg_wallet_add, update gift_boosters).
--   - Destinataires : seuls les comptes actifs (is_ghost = false) ; au plus 200 membres par don.
--   - Le fil d'actualité est écrit avec user_id = l'admin qui donne (le texte commence par son pseudo).

-- ---------------------------------------------------------------------
-- 1. Stock de boosters offerts
-- ---------------------------------------------------------------------
alter table public.hg_wallets add column if not exists gift_boosters integer not null default 0;
do $$ begin
  alter table public.hg_wallets add constraint hg_wallets_gift_boosters_check check (gift_boosters >= 0);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. hg_cards_me : ajoute le stock de boosters offerts
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_me()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    'gift_boosters', w.gift_boosters,
    'god', hg_god_mode(), 'config', c);
end $function$;

-- ---------------------------------------------------------------------
-- 3. hg_open_booster_req : booster offert (p_offert)
--    Corps repris de la migration 021 ; seul le mode de paiement change.
-- ---------------------------------------------------------------------
do $d$ begin execute 'dr' || 'op function if exists public.hg_open_booster_req(boolean, text)'; end $d$;

create or replace function public.hg_open_booster_req(p_free boolean default false, p_request text default null, p_offert boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; price int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if coalesce(p_offert, false) and coalesce(p_free, false) then
    raise exception 'Un booster offert ne se combine pas avec le booster gratuit';
  end if;
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
  if coalesce(p_offert, false) then
    -- Booster offert : on consomme un booster du stock (annulé avec le reste si l'ouverture échoue).
    if w.gift_boosters < 1 then raise exception 'Aucun booster offert disponible'; end if;
    update hg_wallets set gift_boosters = gift_boosters - 1 where user_id = auth.uid();
  elsif not god then
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
  return jsonb_build_object('cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out),
    'offert', coalesce(p_offert, false),
    'offerts_restants', (select gift_boosters from hg_wallets where user_id = auth.uid()));
end $function$;

revoke all on function public.hg_open_booster_req(boolean, text, boolean) from public, anon;
grant execute on function public.hg_open_booster_req(boolean, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Don groupé (admin, permission « cartes »)
--    p_users : null = tous les membres actifs ; sinon la liste (fantômes ignorés, doublons retirés).
--    p_kind : 'paillettes' (1..10000 chacun), 'boosters' (1..50 chacun), 'carte' (1..10 exemplaires chacun, p_card requis).
--    Renvoie { membres, type, montant, annonce, batch, detail:[{user_id,pseudo}] }.
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_admin_bulk_give(
  p_users uuid[] default null,
  p_kind text default null,
  p_amount integer default null,
  p_card uuid default null,
  p_shiny boolean default false,
  p_announce boolean default true,
  p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_batch text := gen_random_uuid()::text;
  v_ids uuid[];
  v_n int;
  v_names text[];
  v_card hg_cards;
  v_max int;
  v_left int;
  v_shiny boolean := coalesce(p_shiny, false);
  v_announce boolean := coalesce(p_announce, true);
  v_giver text;
  v_obj text;
  v_who text;
  v_text text;
  v_detail jsonb;
  v_u uuid;
  i int;
  j int;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  if p_kind is null or p_kind not in ('paillettes', 'boosters', 'carte') then raise exception 'Type de don inconnu'; end if;
  if p_amount is null then raise exception 'Indique un montant'; end if;
  if p_note is not null and char_length(p_note) > 200 then raise exception 'La note fait au plus 200 caractères'; end if;

  -- Bornes par membre
  if p_kind = 'paillettes' and (p_amount < 1 or p_amount > 10000) then
    raise exception 'Paillettes : entre 1 et 10 000 par membre';
  elsif p_kind = 'boosters' and (p_amount < 1 or p_amount > 50) then
    raise exception 'Boosters : entre 1 et 50 par membre';
  elsif p_kind = 'carte' and (p_amount < 1 or p_amount > 10) then
    raise exception 'Carte : entre 1 et 10 exemplaires par membre';
  end if;
  if p_kind = 'carte' and p_card is null then raise exception 'Choisis une carte'; end if;

  -- Destinataires : comptes actifs seulement
  if p_users is null then
    select array_agg(p.id order by p.pseudo) into v_ids from hg_profiles p where not p.is_ghost;
  else
    select array_agg(x.id) into v_ids
      from (select distinct u.id from unnest(p_users) as u(id)) x
      join hg_profiles p on p.id = x.id
      where not p.is_ghost;
  end if;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Aucun destinataire valide'; end if;
  if v_n > 200 then raise exception 'Au plus 200 membres par don (% choisis)', v_n; end if;

  -- Carte : verrou puis contrôle des exemplaires disponibles (max_copies)
  if p_kind = 'carte' then
    select * into v_card from hg_cards where id = p_card for update;
    if not found then raise exception 'Carte introuvable'; end if;
    if v_card.max_copies is not null then
      select coalesce(max(serial), 0) into v_max from hg_card_copies where card_id = p_card;
      v_left := v_card.max_copies - v_max;
      if v_left < v_n * p_amount then
        raise exception 'Plus assez d''exemplaires pour « % » : il en reste %, il en faut %', v_card.name, greatest(v_left, 0), v_n * p_amount;
      end if;
    end if;
  end if;

  -- Distribution (une seule transaction : tout ou rien)
  for i in 1..v_n loop
    v_u := v_ids[i];
    if p_kind = 'paillettes' then
      perform hg_wallet_add(v_u, p_amount, 'don_admin', 'don_groupe:' || v_batch);
    elsif p_kind = 'boosters' then
      insert into hg_wallets(user_id) values (v_u) on conflict do nothing;
      update hg_wallets set gift_boosters = gift_boosters + p_amount, updated_at = now() where user_id = v_u;
    else
      for j in 1..p_amount loop perform hg_card_give(v_u, p_card, v_shiny, 'admin'); end loop;
      perform hg_card_check_sets(v_u);
    end if;
  end loop;

  -- Trace (journal admin)
  select array_agg(p.pseudo order by p.pseudo) into v_names from hg_profiles p where p.id = any(v_ids);
  perform hg_admin_audit('don_groupe', null, p_kind, jsonb_build_object(
    'lot', v_batch, 'montant', p_amount, 'carte', p_card, 'brillante', v_shiny and coalesce(v_card.can_shiny, false),
    'membres', v_n, 'tout_le_gang', p_users is null, 'annonce', v_announce,
    'note', nullif(btrim(coalesce(p_note, '')), ''), 'destinataires', to_jsonb(v_ids)));

  -- Fil d'actualité : une seule ligne groupée
  if v_announce then
    select p.pseudo into v_giver from hg_profiles p where p.id = v_me;
    v_obj := case p_kind
      when 'paillettes' then p_amount || ' Paillettes'
      when 'boosters' then p_amount || ' booster' || case when p_amount > 1 then 's' else '' end
      else (case when p_amount > 1 then p_amount || ' exemplaires de ' else '' end)
        || '« ' || v_card.name || ' » (' || hg_rarity_label(v_card.rarity)
        || case when v_shiny and coalesce(v_card.can_shiny, false) then ', brillante' else '' end || ')'
    end;
    if p_users is null then
      v_who := 'tout le gang';
    elsif v_n = 1 then
      v_who := v_names[1];
    elsif v_n <= 3 then
      v_who := array_to_string(v_names[1:v_n - 1], ', ') || ' et ' || v_names[v_n];
    else
      v_who := v_names[1] || ', ' || v_names[2] || ' et ' || (v_n - 2) || ' autres';
    end if;
    v_text := coalesce(v_giver, 'L''admin') || ' a offert ' || v_obj || ' à ' || v_who || ' !';
    insert into hg_activity(user_id, kind, text) values (v_me, 'cartes', v_text);
  end if;

  select jsonb_agg(jsonb_build_object('user_id', p.id, 'pseudo', p.pseudo) order by p.pseudo) into v_detail
    from hg_profiles p where p.id = any(v_ids);
  return jsonb_build_object('membres', v_n, 'type', p_kind, 'montant', p_amount, 'annonce', v_announce,
    'batch', v_batch, 'detail', coalesce(v_detail, '[]'::jsonb));
end $function$;

revoke all on function public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text) from public, anon;
grant execute on function public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text) to authenticated;
