-- 112 : le don groupé (Give) peut offrir n'importe quel type de booster (avant : toujours « classique »).
-- Nouveau paramètre p_booster (identifiant de hg_booster_types, « classique » par défaut). Les types inactifs
-- (événements passés) restent offrables par l'admin.
drop function if exists public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text);
create or replace function public.hg_cards_admin_bulk_give(p_users uuid[] default null, p_kind text default null,
  p_amount integer default null, p_card uuid default null, p_shiny boolean default false, p_announce boolean default true,
  p_note text default null, p_booster text default 'classique')
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_me uuid := auth.uid();
  v_batch text := gen_random_uuid()::text;
  v_ids uuid[];
  v_n int;
  v_names text[];
  v_card hg_cards;
  v_type hg_booster_types;
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

  if p_kind = 'paillettes' and (p_amount < 1 or p_amount > 10000) then
    raise exception 'Paillettes : entre 1 et 10 000 par membre';
  elsif p_kind = 'boosters' and (p_amount < 1 or p_amount > 50) then
    raise exception 'Boosters : entre 1 et 50 par membre';
  elsif p_kind = 'carte' and (p_amount < 1 or p_amount > 10) then
    raise exception 'Carte : entre 1 et 10 exemplaires par membre';
  end if;
  if p_kind = 'carte' and p_card is null then raise exception 'Choisis une carte'; end if;
  if p_kind = 'boosters' then
    select * into v_type from hg_booster_types where id = coalesce(p_booster, 'classique');
    if not found then raise exception 'Type de booster inconnu'; end if;
  end if;

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

  if p_kind = 'boosters' then
    insert into hg_wallets(user_id) select u from unnest(v_ids) as u on conflict do nothing;
    perform 1 from hg_wallets where user_id = any(v_ids) order by user_id for update;
  end if;

  for i in 1..v_n loop
    v_u := v_ids[i];
    if p_kind = 'paillettes' then
      perform hg_wallet_add(v_u, p_amount, 'don_admin', 'don_groupe:' || v_batch);
    elsif p_kind = 'boosters' then
      insert into hg_booster_stock(user_id, type_id, qty) values (v_u, v_type.id, p_amount)
        on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
    else
      for j in 1..p_amount loop perform hg_card_give(v_u, p_card, v_shiny, 'admin'); end loop;
      perform hg_card_check_sets(v_u);
    end if;
  end loop;

  select array_agg(p.pseudo order by p.pseudo) into v_names from hg_profiles p where p.id = any(v_ids);
  perform hg_admin_audit('don_groupe', null, p_kind, jsonb_build_object(
    'lot', v_batch, 'montant', p_amount, 'carte', p_card, 'brillante', v_shiny and coalesce(v_card.can_shiny, false),
    'booster', case when p_kind = 'boosters' then v_type.id end,
    'membres', v_n, 'tout_le_gang', p_users is null, 'annonce', v_announce,
    'note', nullif(btrim(coalesce(p_note, '')), ''), 'destinataires', to_jsonb(v_ids)));

  if v_announce then
    select p.pseudo into v_giver from hg_profiles p where p.id = v_me;
    v_obj := case p_kind
      when 'paillettes' then p_amount || ' Paillettes'
      when 'boosters' then p_amount || ' booster' || case when p_amount > 1 then 's' else '' end || ' « ' || v_type.name || ' »'
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
    'booster', case when p_kind = 'boosters' then v_type.id end,
    'batch', v_batch, 'detail', coalesce(v_detail, '[]'::jsonb));
end $function$;
revoke all on function public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text, text) from public, anon;
grant execute on function public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text, text) to authenticated;
