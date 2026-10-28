-- Calendrier de l'Avent sans limites (demande du propriétaire, 28/10/2026).
-- Une case peut maintenant tout contenir à la fois : autant de Paillettes que voulu, plusieurs cartes (avec quantité),
-- plusieurs boosters (avec quantité), un souvenir et une question. Plus de plafond mensuel « avent_mois » sur les
-- Paillettes du calendrier, plus de borne à 200 sur les Paillettes d'une case, le bonus collectif et le seuil collectif.
-- La colonne kind reste : elle donne seulement l'icône principale de la case (calculée à l'enregistrement).
-- Les anciennes colonnes card_id / shiny / booster_type sont reprises dans les listes puis ne servent plus.

alter table public.hg_advent_days drop constraint if exists hg_advent_days_reward_check;
alter table public.hg_advent_days drop constraint if exists hg_advent_days_group_reward_check;
alter table public.hg_advent_days drop constraint if exists hg_advent_days_group_target_check;
alter table public.hg_advent_days add constraint hg_advent_days_reward_check check (reward between 0 and 100000000);
alter table public.hg_advent_days add constraint hg_advent_days_group_reward_check check (group_reward between 0 and 100000000);
alter table public.hg_advent_days add constraint hg_advent_days_group_target_check check (group_target is null or group_target between 1 and 100000);
alter table public.hg_advent_days add column if not exists cards jsonb not null default '[]'::jsonb;
alter table public.hg_advent_days add column if not exists boosters jsonb not null default '[]'::jsonb;
alter table public.hg_advent_opens add column if not exists copy_ids bigint[] not null default '{}';
comment on column public.hg_advent_days.cards is 'Cartes de la case : [{card_id, shiny, qty}] (migration 170).';
comment on column public.hg_advent_days.boosters is 'Boosters de la case, mis dans le stock : [{type, qty}] (migration 170).';

-- Reprise des cases déjà réglées.
update public.hg_advent_days set cards = jsonb_build_array(jsonb_build_object('card_id', card_id, 'shiny', shiny, 'qty', 1))
  where card_id is not null and cards = '[]'::jsonb;
update public.hg_advent_days set boosters = jsonb_build_array(jsonb_build_object('type', booster_type, 'qty', 1))
  where booster_type is not null and boosters = '[]'::jsonb;
update public.hg_advent_days set card_id = null, shiny = false, booster_type = null;
update public.hg_advent_opens set copy_ids = array[copy_id] where copy_id is not null and copy_ids = '{}';

-- Réglages : Paillettes de repli (carte épuisée) sans borne basse à 200 ; plus de plafond.
create or replace function public.hg_advent_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'actif', coalesce((c->>'actif')::boolean, true),
    'seuil', least(greatest(coalesce((c->>'seuil')::int, 10), 1), 100000),
    'seuil_pct', least(greatest(coalesce((c->>'seuil_pct')::int, 70), 10), 100),
    'carte_repli', least(greatest(coalesce((c->>'carte_repli')::int, 20), 0), 100000000),
    'plafond', null)
  from (select coalesce(hg_saisons_cfg()->'avent', '{}'::jsonb) as c) x $$;

-- Contenu d'une case : tout ce qu'elle contient (pour une case ouverte par le membre, ou pour le Staff).
-- Garde « card » et « booster » (premier élément) pour les anciens écrans.
create or replace function public.hg_advent_content(p_year int, p_day int, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d hg_advent_days; o hg_advent_opens; out jsonb; m record; e record; q record;
  answered boolean := false; a_ok boolean; v_cards jsonb; v_boosters jsonb;
begin
  select * into d from hg_advent_days where year = p_year and day = p_day;
  if not found then return null; end if;
  select * into o from hg_advent_opens where year = p_year and day = p_day and user_id = p_user;
  out := jsonb_build_object('kind', d.kind, 'reward', d.reward, 'label', d.label, 'paid', coalesce(o.paid, 0));
  select coalesce(jsonb_agg(to_jsonb(k) || jsonb_build_object('shiny', coalesce((x->>'shiny')::boolean, false),
      'qty', greatest(coalesce((x->>'qty')::int, 1), 1),
      'copies', coalesce((select jsonb_agg(jsonb_build_object('serial', cc.serial, 'shiny', cc.shiny) order by cc.id)
        from hg_card_copies cc where cc.id = any(coalesce(o.copy_ids, '{}')) and cc.card_id = k.id), '[]'::jsonb)) order by x.ord), '[]'::jsonb)
    into v_cards
    from jsonb_array_elements(d.cards) with ordinality x(x, ord)
    join lateral (select c.id, c.name, c.rarity, c.family, c.image_url, c.flavor, c.caption, c.number, c.max_copies,
        s.name as set_name, s.code as set_code
      from hg_cards c join hg_card_sets s on s.id = c.set_id where c.id = (x->>'card_id')::uuid) k on true;
  select coalesce(jsonb_agg(jsonb_build_object('id', bt.id, 'name', bt.name, 'size', bt.size, 'style', bt.style,
      'qty', greatest(coalesce((x->>'qty')::int, 1), 1)) order by x.ord), '[]'::jsonb)
    into v_boosters
    from jsonb_array_elements(d.boosters) with ordinality x(x, ord)
    join hg_booster_types bt on bt.id = x->>'type';
  out := out || jsonb_build_object('cards', v_cards, 'boosters', v_boosters);
  if jsonb_array_length(v_cards) > 0 then
    out := out || jsonb_build_object('card', (v_cards->0) - 'copies' - 'qty' - 'shiny', 'shiny', (v_cards->0->>'shiny')::boolean,
      'serial', v_cards->0->'copies'->0->'serial');
  end if;
  if jsonb_array_length(v_boosters) > 0 then out := out || jsonb_build_object('booster', v_boosters->0); end if;
  if d.moment_id is not null then
    select id, title, body, happened_on, image_path into m from hg_moments where id = d.moment_id;
    if found then out := out || jsonb_build_object('moment', jsonb_build_object('id', m.id, 'title', m.title,
      'body', left(coalesce(m.body, ''), 600), 'happened_on', m.happened_on, 'image_path', m.image_path)); end if;
  end if;
  if d.event_id is not null then
    select id, title, location, starts_at, cover_path into e from hg_events where id = d.event_id;
    if found then out := out || jsonb_build_object('event', jsonb_build_object('id', e.id, 'title', e.title,
      'location', e.location, 'starts_at', e.starts_at, 'cover_path', e.cover_path)); end if;
  end if;
  if d.quiz_id is not null then
    select id, prompt, qtype, options, image_url, reward, explanation into q from hg_quiz_questions where id = d.quiz_id;
    if found then
      select is_correct into a_ok from hg_quiz_answers where question_id = q.id and user_id = p_user;
      answered := found;
      out := out || jsonb_build_object('question', jsonb_build_object('id', q.id, 'prompt', q.prompt, 'qtype', q.qtype,
        'options', coalesce((select jsonb_agg(jsonb_build_object('id', x->>'id', 'text', x->>'text')) from jsonb_array_elements(q.options) x), '[]'::jsonb),
        'image_url', q.image_url, 'reward', q.reward, 'answered', answered, 'correct', a_ok,
        'explanation', case when answered and a_ok is not null then q.explanation end));
    end if;
  end if;
  return out;
end $$;

-- Membre : ouvre une case. Donne tout son contenu : Paillettes (sans plafond), chaque carte autant de fois que sa
-- quantité (carte épuisée : Paillettes de repli par exemplaire manquant), chaque booster dans le stock.
create or replace function public.hg_advent_open(p_day int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); clk jsonb := hg_advent_clock(); y int; t int; d hg_advent_days; cfg jsonb := hg_advent_cfg();
  n int; given int := 0; cid bigint; ids bigint[] := '{}'; badge boolean := false; v_ref text; missing int := 0; x jsonb; i int; qty int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  y := (clk->>'year')::int; t := (clk->>'today')::int;
  if y is null or not (cfg->>'actif')::boolean then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  if p_day is null or p_day < 1 or p_day > 24 then raise exception 'Case inconnue'; end if;
  if p_day > t then raise exception 'Patience : cette case s''ouvre le % décembre à 6 h', p_day; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found then raise exception 'Cette case n''est pas encore prête'; end if;
  perform hg_eco_lock(me);
  insert into hg_wallets (user_id) values (me) on conflict do nothing;
  perform 1 from hg_wallets where user_id = me for update;
  insert into hg_advent_opens (year, day, user_id, late) values (y, p_day, me, p_day < t) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('day', p_day, 'already', true, 'content', hg_advent_content(y, p_day, me));
  end if;
  v_ref := 'avent:' || y || ':' || lpad(p_day::text, 2, '0');
  for x in select * from jsonb_array_elements(d.cards) loop
    qty := least(greatest(coalesce((x->>'qty')::int, 1), 1), 1000);
    for i in 1..qty loop
      begin
        cid := hg_card_give(me, (x->>'card_id')::uuid, coalesce((x->>'shiny')::boolean, false), 'evenement');
        ids := ids || cid;
      exception when others then
        missing := missing + 1;
      end;
    end loop;
  end loop;
  for x in select * from jsonb_array_elements(d.boosters) loop
    qty := least(greatest(coalesce((x->>'qty')::int, 1), 1), 1000);
    if exists (select 1 from hg_booster_types where id = x->>'type') then
      insert into hg_booster_stock (user_id, type_id, qty) values (me, x->>'type', qty)
        on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
    end if;
  end loop;
  update hg_advent_opens set copy_ids = ids, copy_id = ids[1] where year = y and day = p_day and user_id = me;
  given := d.reward + missing * (cfg->>'carte_repli')::int;
  if given > 0 and hg_wallet_add(me, given, 'avent', v_ref) then
    update hg_advent_opens set paid = given where year = y and day = p_day and user_id = me;
  else
    given := 0;
  end if;
  if (select count(*) from hg_advent_opens where year = y and user_id = me) >= 24 then
    insert into hg_user_badges (user_id, badge_code) values (me, 'avent_complet') on conflict do nothing;
    get diagnostics n = row_count;
    badge := n > 0;
  end if;
  return jsonb_build_object('day', p_day, 'already', false, 'paid', given, 'fallback', missing > 0, 'missing', missing,
    'badge', badge, 'content', hg_advent_content(y, p_day, me));
end $$;

-- Question : toute case qui en contient une (plus seulement les cases « question »).
create or replace function public.hg_advent_answer(p_day int, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); y int := (hg_advent_clock()->>'year')::int; d hg_advent_days; q hg_quiz_questions; k jsonb;
  ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if y is null then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found or d.quiz_id is null then raise exception 'Pas de question dans cette case'; end if;
  if not exists (select 1 from hg_advent_opens where year = y and day = p_day and user_id = me) then
    raise exception 'Ouvre d''abord la case';
  end if;
  select * into q from hg_quiz_questions where id = d.quiz_id;
  if not found then raise exception 'Question introuvable'; end if;
  if p_response is null or (jsonb_typeof(p_response) = 'string' and btrim(p_response #>> '{}') = '')
     or (jsonb_typeof(p_response) = 'array' and jsonb_array_length(p_response) = 0) then
    raise exception 'Choisis ou écris une réponse';
  end if;
  if length(p_response::text) > 1000 then raise exception 'Réponse trop longue'; end if;
  perform hg_eco_lock(me);
  if exists (select 1 from hg_quiz_answers where question_id = q.id and user_id = me) then
    raise exception 'Tu as déjà répondu à cette question';
  end if;
  select answer into k from hg_quiz_keys where question_id = q.id;
  ok := hg_quiz_check(q.qtype, coalesce(k, '{}'::jsonb), p_response);
  if ok then gain := greatest(q.reward, 0); end if;
  insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward) values (q.id, me, p_response, ok, gain);
  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  return jsonb_build_object('correct', ok, 'reward', gain, 'explanation', case when ok is not null then q.explanation end,
    'solution', case when ok is not null then
      case q.qtype when 'texte' then k->'accepted' when 'nombre' then k->'value' else k->'correct' end end);
end $$;

-- Bonus collectif : sans plafond.
create or replace function public.hg_advent_claim_group(p_day int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); y int := (hg_advent_clock()->>'year')::int; d hg_advent_days; cnt int; tgt int;
  gain int; v_ref text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if y is null or not (hg_advent_cfg()->>'actif')::boolean then raise exception 'Le calendrier de l''Avent est fermé'; end if;
  select * into d from hg_advent_days where year = y and day = p_day;
  if not found or d.group_target is null then raise exception 'Cette case n''est pas collective'; end if;
  if not exists (select 1 from hg_advent_opens where year = y and day = p_day and user_id = me) then
    raise exception 'Ouvre d''abord la case du %', p_day;
  end if;
  select count(*) into cnt from hg_advent_opens where year = y and day = p_day;
  tgt := hg_advent_target(d.group_target);
  if cnt < tgt then raise exception 'Encore % membre(s) avant le bonus du gang', tgt - cnt; end if;
  perform hg_eco_lock(me);
  v_ref := 'avent:' || y || ':' || lpad(p_day::text, 2, '0') || ':groupe';
  gain := d.group_reward;
  update hg_advent_opens set group_claimed_at = now() where year = y and day = p_day and user_id = me and group_claimed_at is null;
  if not found then return jsonb_build_object('already', true, 'paid', 0); end if;
  if gain > 0 and hg_wallet_add(me, gain, 'avent_groupe', v_ref) then
    update hg_advent_opens set group_paid = gain where year = y and day = p_day and user_id = me;
  else
    gain := 0;
  end if;
  return jsonb_build_object('already', false, 'paid', gain, 'count', cnt, 'target', tgt);
end $$;

-- Staff « themes » : les 24 cases avec leurs listes.
create or replace function public.hg_advent_admin(p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  return jsonb_build_object('year', p_year, 'clock', hg_advent_clock(), 'cfg', hg_advent_cfg(), 'gang', hg_saisons_gang_size(),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'day', g.d, 'ready', d.year is not null, 'kind', d.kind, 'reward', d.reward,
        'cards', coalesce(d.cards, '[]'::jsonb), 'boosters', coalesce(d.boosters, '[]'::jsonb),
        'moment_id', d.moment_id, 'event_id', d.event_id, 'quiz_id', d.quiz_id,
        'group_target', d.group_target, 'group_target_eff', case when d.group_target is not null then hg_advent_target(d.group_target) end,
        'group_reward', d.group_reward, 'label', d.label,
        'opens', (select count(*) from hg_advent_opens x where x.year = p_year and x.day = g.d),
        'preview', case when d.year is not null then hg_advent_content(p_year, g.d, null) end) order by g.d)
      from generate_series(1, 24) g(d) left join hg_advent_days d on d.year = p_year and d.day = g.d), '[]'::jsonb));
end $$;

-- Staff « themes » : enregistre une case. p = { reward, cards: [{card_id, shiny, qty}], boosters: [{type, qty}],
-- moment_id, event_id, quiz_id, group (bool), group_target, group_reward, label }. Tout est cumulable ; il faut au moins
-- une chose dans la case. Les anciens champs card_id / shiny / booster_type sont encore acceptés (une carte, un booster).
create or replace function public.hg_advent_day_save(p_year int, p_day int, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r int; gt int; gr int; mom uuid; ev uuid; qz uuid; k text; x jsonb;
  v_cards jsonb := '[]'::jsonb; v_boosters jsonb := '[]'::jsonb; cq int;
begin
  if not hg_has_perm('themes') then raise exception 'Réservé au Staff « Thèmes et événements »'; end if;
  if p_year is null or p_year < 2024 or p_year > 2100 or p_day is null or p_day < 1 or p_day > 24 then raise exception 'Case inconnue'; end if;
  begin
    r := coalesce(nullif(p->>'reward', '')::int, 0);
    gt := nullif(p->>'group_target', '')::int;
    gr := coalesce(nullif(p->>'group_reward', '')::int, 0);
    mom := nullif(p->>'moment_id', '')::uuid;
    ev := nullif(p->>'event_id', '')::uuid; qz := nullif(p->>'quiz_id', '')::uuid;
  exception when others then raise exception 'Valeur invalide'; end;
  if r < 0 or r > 100000000 then raise exception 'Paillettes de la case : nombre positif'; end if;
  if gr < 0 or gr > 100000000 then raise exception 'Bonus du gang : nombre positif'; end if;
  if gt is not null and (gt < 1 or gt > 100000) then raise exception 'Seuil collectif : au moins 1 membre'; end if;
  -- Cartes (liste, ou ancien champ unique).
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'cards') = 'array' then p->'cards'
      when nullif(p->>'card_id', '') is not null then jsonb_build_array(jsonb_build_object('card_id', p->>'card_id', 'shiny', p->'shiny', 'qty', 1))
      else '[]'::jsonb end) loop
    if nullif(x->>'card_id', '') is null then continue; end if;
    begin cq := least(greatest(coalesce(nullif(x->>'qty', '')::int, 1), 1), 1000);
    exception when others then raise exception 'Quantité de carte invalide'; end;
    if not exists (select 1 from hg_cards where id = (x->>'card_id')::uuid) then raise exception 'Carte introuvable'; end if;
    v_cards := v_cards || jsonb_build_array(jsonb_build_object('card_id', x->>'card_id',
      'shiny', coalesce((x->>'shiny')::boolean, false), 'qty', cq));
  end loop;
  -- Boosters (liste, ou ancien champ unique).
  for x in select * from jsonb_array_elements(case when jsonb_typeof(p->'boosters') = 'array' then p->'boosters'
      when nullif(p->>'booster_type', '') is not null then jsonb_build_array(jsonb_build_object('type', p->>'booster_type', 'qty', 1))
      else '[]'::jsonb end) loop
    if nullif(x->>'type', '') is null then continue; end if;
    begin cq := least(greatest(coalesce(nullif(x->>'qty', '')::int, 1), 1), 1000);
    exception when others then raise exception 'Quantité de booster invalide'; end;
    if not exists (select 1 from hg_booster_types where id = x->>'type') then raise exception 'Type de booster introuvable'; end if;
    v_boosters := v_boosters || jsonb_build_array(jsonb_build_object('type', x->>'type', 'qty', cq));
  end loop;
  if mom is not null and not exists (select 1 from hg_moments where id = mom) then raise exception 'Souvenir introuvable'; end if;
  if ev is not null and not exists (select 1 from hg_events where id = ev) then raise exception 'Sortie introuvable'; end if;
  if qz is not null and not exists (select 1 from hg_quiz_questions where id = qz) then raise exception 'Question introuvable'; end if;
  if r = 0 and jsonb_array_length(v_cards) = 0 and jsonb_array_length(v_boosters) = 0 and mom is null and ev is null and qz is null then
    raise exception 'La case est vide : ajoute des Paillettes, une carte, un booster, un souvenir ou une question';
  end if;
  -- Icône principale de la case.
  k := case when qz is not null then 'question' when jsonb_array_length(v_cards) > 0 then 'carte'
    when jsonb_array_length(v_boosters) > 0 then 'booster' when mom is not null or ev is not null then 'souvenir' else 'paillettes' end;
  if coalesce((p->>'group')::boolean, gt is not null) is false then gt := null; end if;
  insert into hg_advent_days (year, day, kind, reward, cards, boosters, card_id, shiny, booster_type, moment_id, event_id, quiz_id,
      group_target, group_reward, label, updated_at, updated_by)
    values (p_year, p_day, k, r, v_cards, v_boosters, null, false, null, mom, ev, qz,
      gt, case when gt is null then 0 else gr end, left(nullif(btrim(p->>'label'), ''), 120), now(), auth.uid())
    on conflict (year, day) do update set kind = excluded.kind, reward = excluded.reward, cards = excluded.cards,
      boosters = excluded.boosters, card_id = null, shiny = false, booster_type = null, moment_id = excluded.moment_id,
      event_id = excluded.event_id, quiz_id = excluded.quiz_id, group_target = excluded.group_target,
      group_reward = excluded.group_reward, label = excluded.label, updated_at = now(), updated_by = auth.uid();
  perform hg_admin_audit('avent_case', null, p_year || '-' || p_day, jsonb_build_object('icone', k, 'paillettes', r,
    'cartes', jsonb_array_length(v_cards), 'boosters', jsonb_array_length(v_boosters), 'seuil', gt));
  return jsonb_build_object('year', p_year, 'day', p_day, 'kind', k);
end $$;
