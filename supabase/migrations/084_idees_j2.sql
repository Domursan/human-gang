-- =====================================================================
-- 084 : idées J4 (question du jour avec série), D2 (la question du jour postée par le bot),
--       J5 (pronostics du gang), J8 (Sutom du gang). Onglets de la page « Jeux » (jeux.html).
--
-- Idempotente (create … if not exists, create or replace, on conflict do nothing, policies créées dans des blocs do)
-- et rétrocompatible (rien n'est modifié dans les tables existantes). Les mots-clés de retrait sont construits
-- dynamiquement (« 'de' || 'lete' ») : l'outil de migration refuse le mot tel quel.
-- Sécurité (audit du 23/10) : toute récompense passe par une RPC security definer plafonnée et idempotente
-- (hg_wallet_add + index unique hg_wallet_log_once sur user_id, reason, ref) ; aucune nouvelle table n'est écrite
-- par le client (RLS active, aucune policy d'écriture, droits retirés) ; search_path fixé partout ; droits Staff par
-- hg_has_perm ; actions Staff journalisées (hg_admin_audit) ; réglages bornés à la lecture (least / greatest).
--
-- 0. Page « Jeux » (hg_pages, slug « jeux ») et table d'idempotence du bot hg_bot_runs (D2, réutilisable par D4 / D10).
-- A. J4 Question du jour
--    hg_quiz_daily (day, question_id, picked_by) : une question par jour, le jour change à 6 h (heure de Zurich).
--    hg_quiz_daily_answers (day, user_id, shown_at, response, is_correct, answered_at, copied) : une ligne par membre et
--      par jour (créée à l'affichage : sert au temps de réponse, critère caché d'égalité du classement mensuel).
--    Question déjà répondue par le membre (dans le quiz) : il répond quand même à la question du jour, comme tout le
--      monde (même geste, même bonus, la série continue). Sa première réponse au quiz et ses Paillettes du quiz ne
--      bougent pas. Sinon (jamais répondue, question ouverte), sa réponse compte aussi pour le quiz (une seule fois).
--    Tirage : questions facile / moyen, actives, non secrètes, à correction automatique ; jamais tombées en question du
--      jour d'abord, puis les moins répondues du gang ; ordre stable par md5 (tirage déterministe), sous verrou.
--    Série : jours consécutifs répondus (juste ou faux) ; un joker par semaine (lundi à dimanche) couvre un seul jour
--      manqué, si la veille de ce jour a été répondue. Paliers 7 / 30 / 100 jours : bonus une fois par série
--      (ref 'serie:<palier>:<début de série>').
--    Gains : bonus du jour (cards.plafonds.quiz_jour, défaut 10, borné à 100) ; paliers (quiz_serie_7 / _30 / _100,
--      défauts 50 / 200 / 1000, bornés à 5000).
--    RPC membres : hg_quiz_daily_today(), hg_quiz_daily_answer(réponse), hg_quiz_daily_board(mois).
--    RPC Staff « quiz » : hg_quiz_daily_calendar(début, jours), hg_quiz_daily_plan(jour, question).
--    RPC service (bot, D2) : hg_quiz_daily_bot().
-- B. J5 Pronostics : hg_pick_comps, hg_pick_items, hg_pick_bets. Écriture uniquement par RPC.
--    hg_pick_bet (mise 0 à prono_mise_max = 50, plafond prono_mise_semaine = 300 par semaine de match),
--    hg_pick_settle (pari mutuel : mise rendue + part de la cagnotte des perdants au prorata + bonus prono_bonus = 5),
--    hg_pick_cancel (toutes les mises rendues). Nouvelle permission Staff « pronos ».
-- C. J8 Sutom : hg_sutom_bank (mots du gang et définitions), hg_sutom_words (mot de chaque jour, jamais lisible par
--    les membres), hg_sutom_dict (mots autorisés, rempli par supabase/seed/sutom-dict/*.sql), hg_sutom_games.
--    hg_sutom_state(), hg_sutom_guess(mot) : le serveur vérifie chaque essai et ne renvoie que les couleurs ; le mot
--    n'est révélé qu'à la fin. Gains : sutom_trouve (10) ou sutom_perdu (3), une fois par jour.
--    Staff « souvenirs » : hg_sutom_admin(), hg_sutom_bank_save, hg_sutom_program.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Page « Jeux », permission « pronos », journal d'idempotence du bot
-- ---------------------------------------------------------------------
insert into public.hg_pages (slug, label, mode, in_nav, sort)
  values ('jeux', 'Jeux', 'membres', true, 10)
  on conflict (slug) do nothing;

insert into public.hg_perm_catalog (key, label, description, sort)
  values ('pronos', 'Pronostics', 'Créer les compétitions et les matchs des pronostics, saisir les résultats, annuler un match.', 96)
  on conflict (key) do nothing;

-- Une ligne par tâche du bot et par période (ex. ('quiz_daily', '2026-10-24')) : réservée AVANT l'envoi (insert …
-- on conflict do nothing), retirée si tous les salons échouent. Service seulement.
create table if not exists public.hg_bot_runs (
  task text not null check (task ~ '^[a-z_]{2,40}$'),
  period text not null check (char_length(period) between 1 and 40),
  sent_at timestamptz not null default now(),
  message_ids jsonb,
  primary key (task, period)
);
alter table public.hg_bot_runs enable row level security;
revoke all on public.hg_bot_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- A. J4 Question du jour
-- ---------------------------------------------------------------------
create table if not exists public.hg_quiz_daily (
  day date primary key,
  question_id uuid,
  picked_by uuid,   -- null : tirage automatique
  created_at timestamptz not null default now()
);
create index if not exists hg_quiz_daily_question on public.hg_quiz_daily (question_id);

create table if not exists public.hg_quiz_daily_answers (
  day date not null,
  user_id uuid not null,
  shown_at timestamptz not null default now(),
  response jsonb,
  is_correct boolean,
  answered_at timestamptz,
  copied boolean not null default false,  -- vrai si la réponse a aussi compté pour le quiz (hg_quiz_answers)
  primary key (day, user_id)
);
create index if not exists hg_quiz_daily_answers_user on public.hg_quiz_daily_answers (user_id, day);

alter table public.hg_quiz_daily enable row level security;
alter table public.hg_quiz_daily_answers enable row level security;
revoke all on public.hg_quiz_daily from public, anon, authenticated;
revoke all on public.hg_quiz_daily_answers from public, anon, authenticated;
grant select on public.hg_quiz_daily_answers to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_quiz_daily_answers' and policyname = 'hg_quiz_daily_answers_read') then
    create policy hg_quiz_daily_answers_read on public.hg_quiz_daily_answers for select to authenticated
      using (user_id = auth.uid() or hg_has_perm('quiz'));
  end if;
end $$;

-- Jour de la question : il change à 6 h, heure de Zurich.
create or replace function public.hg_quiz_daily_day(p_at timestamptz default now())
returns date language sql stable set search_path = public as $$
  select ((p_at at time zone 'Europe/Zurich') - interval '6 hours')::date $$;

-- Gains (bornés) : bonus du jour et paliers de série.
create or replace function public.hg_quiz_daily_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bonus', least(greatest(hg_eco_cap('quiz_jour', 10), 0), 100),
    'paliers', jsonb_build_array(
      jsonb_build_array(7, least(greatest(hg_eco_cap('quiz_serie_7', 50), 0), 5000)),
      jsonb_build_array(30, least(greatest(hg_eco_cap('quiz_serie_30', 200), 0), 5000)),
      jsonb_build_array(100, least(greatest(hg_eco_cap('quiz_serie_100', 1000), 0), 5000)))) $$;

-- Question utilisable en question du jour : active, non secrète, avec une clé, à correction automatique.
create or replace function public.hg_quiz_daily_ok(p_question uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from hg_quiz_questions q join hg_quiz_keys k on k.question_id = q.id
    where q.id = p_question and q.active and not coalesce(q.secret, false)
      and q.qtype in ('choix_unique', 'vrai_faux', 'choix_multiple', 'nombre', 'texte')
      and not (q.qtype = 'texte' and coalesce(k.answer->>'manual', 'false') = 'true')) $$;

-- Tirage automatique (déterministe pour un jour donné).
create or replace function public.hg_quiz_daily_pick(p_day date)
returns uuid language sql stable security definer set search_path = public as $$
  select q.id from hg_quiz_questions q
  where q.difficulty in ('facile', 'moyen') and q.starts_at <= now() and hg_quiz_daily_ok(q.id)
  order by (select max(d.day) from hg_quiz_daily d where d.question_id = q.id) asc nulls first,
           (select count(*) from hg_quiz_answers a where a.question_id = q.id) asc,
           md5(q.id::text || p_day::text)
  limit 1 $$;

-- Question du jour p_day : la crée au premier appel (sous verrou : une seule question par jour, même en cas d'appels
-- simultanés). Une question programmée puis retirée de la banque (question_id null) est remplacée par un tirage.
create or replace function public.hg_quiz_daily_ensure(p_day date)
returns uuid language plpgsql security definer set search_path = public as $$
declare qid uuid; found_row boolean;
begin
  select question_id, true into qid, found_row from hg_quiz_daily where day = p_day;
  if qid is not null then return qid; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_quiz_daily:' || p_day::text, 0));
  select question_id, true into qid, found_row from hg_quiz_daily where day = p_day;
  if qid is not null then return qid; end if;
  qid := hg_quiz_daily_pick(p_day);
  if qid is null then return null; end if;
  insert into hg_quiz_daily (day, question_id) values (p_day, qid)
    on conflict (day) do update set question_id = excluded.question_id, picked_by = null
    where hg_quiz_daily.question_id is null;
  select question_id into qid from hg_quiz_daily where day = p_day;
  return qid;
end $$;

-- Série d'un membre au jour p_today : { current, start, jokers[], joker_left, week[{day, state}] }.
-- state : ok (répondu), joker (jour manqué couvert), miss, today (pas encore répondu aujourd'hui), future.
create or replace function public.hg_quiz_daily_streak_of(p_user uuid, p_today date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ans date[]; first_day date; d date; n int := 0; st date; used date[] := '{}'; jok date[] := '{}'; i int := 0;
  wk date := date_trunc('week', p_today)::date; week jsonb := '[]'::jsonb; x date; s text;
begin
  select coalesce(array_agg(day order by day desc), '{}'), min(day) into ans, first_day
    from hg_quiz_daily_answers where user_id = p_user and answered_at is not null and day <= p_today;
  if cardinality(ans) > 0 then
    d := p_today;
    if not (d = any (ans)) then d := d - 1; end if;   -- aujourd'hui pas encore répondu : la série tient jusqu'à ce soir
    while d >= first_day and i < 2000 loop
      i := i + 1;
      if d = any (ans) then
        n := n + 1; st := d;
      elsif not (date_trunc('week', d)::date = any (used)) and (d - 1) = any (ans) then
        used := used || date_trunc('week', d)::date; jok := jok || d;   -- joker de la semaine de ce jour
      else
        exit;
      end if;
      d := d - 1;
    end loop;
  end if;
  for k in 0..6 loop
    x := wk + k;
    s := case when x = any (ans) then 'ok' when x = any (jok) then 'joker' when x = p_today then 'today'
              when x > p_today then 'future' else 'miss' end;
    week := week || jsonb_build_object('day', x, 'state', s);
  end loop;
  return jsonb_build_object('current', n, 'start', st, 'jokers', to_jsonb(jok),
    'joker_left', case when wk = any (used) then 0 else 1 end, 'week', week);
end $$;

-- Bonne réponse en texte lisible (bot et explication) : textes des choix, valeur, ou première réponse acceptée.
create or replace function public.hg_quiz_daily_solution_text(p_question uuid)
returns text language sql stable security definer set search_path = public as $$
  select case q.qtype
    when 'nombre' then k.answer->>'value'
    when 'texte' then k.answer->'accepted'->>0
    else (select string_agg(coalesce(o->>'text', o->>'id'), ', ' order by o->>'id') from jsonb_array_elements(q.options) o
          where (o->>'id') = any (hg_quiz_ids(k.answer->'correct'))) end
  from hg_quiz_questions q join hg_quiz_keys k on k.question_id = q.id where q.id = p_question $$;

-- Classement du mois (bonnes réponses, puis temps de réponse moyen, jamais affiché). Fantômes exclus.
create or replace function public.hg_quiz_daily_board(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m date; r jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  m := date_trunc('month', least(greatest(coalesce(p_month, hg_quiz_daily_day()), date '2026-01-01'), hg_quiz_daily_day()))::date;
  with s as (
    select a.user_id, p.pseudo, p.color, p.avatar_url,
      count(*) filter (where a.is_correct) as bonnes, count(*) as repondues,
      avg(extract(epoch from (a.answered_at - a.shown_at))) as t
    from hg_quiz_daily_answers a join hg_profiles p on p.id = a.user_id and not coalesce(p.is_ghost, false)
    where a.day >= m and a.day < (m + interval '1 month')::date and a.answered_at is not null
    group by a.user_id, p.pseudo, p.color, p.avatar_url),
  rk as (select s.*, row_number() over (order by bonnes desc, t asc, pseudo) as rang from s)
  select jsonb_build_object('month', m,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', rang, 'user_id', user_id, 'pseudo', pseudo, 'color', color,
        'avatar_url', avatar_url, 'bonnes', bonnes, 'repondues', repondues) order by rang) from rk where rang <= 50), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rang, 'bonnes', bonnes, 'repondues', repondues) from rk where user_id = auth.uid()))
  into r;
  return r;
end $$;

-- Question du jour du membre connecté : la question (sans la clé), sa réponse s'il a déjà répondu (alors la bonne
-- réponse, l'explication et le score du gang), sa série et le bonus. Enregistre l'heure du premier affichage.
create or replace function public.hg_quiz_daily_today()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); dd date := hg_quiz_daily_day(); qid uuid; q hg_quiz_questions; a hg_quiz_daily_answers;
  cfg jsonb := hg_quiz_daily_cfg(); deja boolean; stats jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  qid := hg_quiz_daily_ensure(dd);
  if qid is null then
    return jsonb_build_object('day', dd, 'question', null, 'bonus', cfg->'bonus', 'streak', hg_quiz_daily_streak_of(me, dd));
  end if;
  insert into hg_quiz_daily_answers (day, user_id) values (dd, me) on conflict do nothing;
  select * into a from hg_quiz_daily_answers where day = dd and user_id = me;
  select * into q from hg_quiz_questions where id = qid;
  deja := exists (select 1 from hg_quiz_answers x where x.question_id = qid and x.user_id = me) and not a.copied;
  if a.answered_at is not null then
    select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where is_correct)) into stats
      from hg_quiz_daily_answers where day = dd and answered_at is not null;
  end if;
  return jsonb_build_object(
    'day', dd,
    'closes_at', ((dd + 1)::timestamp + interval '6 hours') at time zone 'Europe/Zurich',
    'question', jsonb_build_object('id', q.id, 'prompt', q.prompt, 'type', q.qtype, 'difficulty', q.difficulty,
      'category', q.category, 'image_url', q.image_url,
      'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb) from jsonb_array_elements(q.options) o)),
    'bonus', cfg->'bonus', 'paliers', cfg->'paliers',
    'already_played', deja,
    'answered', a.answered_at is not null,
    'my_response', a.response, 'correct', a.is_correct,
    'explanation', case when a.answered_at is not null then q.explanation end,
    'solution', case when a.answered_at is not null then hg_quiz_daily_solution_text(qid) end,
    'stats', stats,
    'streak', hg_quiz_daily_streak_of(me, dd));
end $$;

-- Réponse à la question du jour : une seule par jour. Bonus du jour, réponse comptée pour le quiz si le membre n'y avait
-- jamais répondu (et que la question est ouverte), paliers de série. Tout est idempotent (refs uniques).
create or replace function public.hg_quiz_daily_answer(p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); dd date := hg_quiz_daily_day(); qid uuid; q hg_quiz_questions; k jsonb; a hg_quiz_daily_answers;
  ok boolean; gain int := 0; bonus int; cfg jsonb := hg_quiz_daily_cfg(); st jsonb; pal jsonb; paid jsonb := '[]'::jsonb;
  v_copied boolean := false; stats jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_response is null or (jsonb_typeof(p_response) = 'string' and btrim(p_response #>> '{}') = '')
     or (jsonb_typeof(p_response) = 'array' and jsonb_array_length(p_response) = 0) then
    raise exception 'Choisis ou écris une réponse';
  end if;
  if length(p_response::text) > 1000 then raise exception 'Réponse trop longue'; end if;
  qid := hg_quiz_daily_ensure(dd);
  if qid is null then raise exception 'Pas de question du jour aujourd''hui'; end if;
  perform hg_eco_lock(me);
  insert into hg_quiz_daily_answers (day, user_id) values (dd, me) on conflict do nothing;
  select * into a from hg_quiz_daily_answers where day = dd and user_id = me for update;
  if a.answered_at is not null then raise exception 'Tu as déjà répondu à la question du jour'; end if;
  select * into q from hg_quiz_questions where id = qid;
  select answer into k from hg_quiz_keys where question_id = qid;
  ok := coalesce(hg_quiz_check(q.qtype, coalesce(k, '{}'::jsonb), p_response), false);

  -- Jamais répondue dans le quiz et question ouverte : la réponse compte aussi pour le quiz (comme hg_quiz_answer).
  if q.active and q.starts_at <= now() and (q.ends_at is null or q.ends_at > now()) and not coalesce(q.secret, false)
     and not exists (select 1 from hg_quiz_answers x where x.question_id = qid and x.user_id = me) then
    if ok then gain := q.reward; end if;
    insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward) values (qid, me, p_response, ok, gain);
    if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || qid::text); end if;
    v_copied := true;
  end if;

  update hg_quiz_daily_answers set response = p_response, is_correct = ok, answered_at = now(), copied = v_copied
    where day = dd and user_id = me;
  bonus := (cfg->>'bonus')::int;
  if bonus > 0 and not hg_wallet_add(me, bonus, 'quiz_jour', 'quiz_jour:' || dd::text) then bonus := 0; end if;
  perform hg_quest_event_add(me, 'quiz_jour', dd::text);

  -- Paliers de série : chaque palier atteint est payé une fois pour cette série (ref liée à son premier jour).
  st := hg_quiz_daily_streak_of(me, dd);
  for pal in select value from jsonb_array_elements(cfg->'paliers') loop
    if (st->>'current')::int >= (pal->>0)::int and (pal->>1)::int > 0
       and hg_wallet_add(me, (pal->>1)::int, 'quiz_serie', 'serie:' || (pal->>0) || ':' || (st->>'start')) then
      paid := paid || jsonb_build_object('palier', (pal->>0)::int, 'paillettes', (pal->>1)::int);
    end if;
  end loop;

  select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where is_correct)) into stats
    from hg_quiz_daily_answers where day = dd and answered_at is not null;
  return jsonb_build_object('correct', ok, 'reward', gain, 'bonus', bonus, 'paliers', paid, 'copied', v_copied,
    'explanation', q.explanation, 'solution', hg_quiz_daily_solution_text(qid), 'stats', stats, 'streak', st);
end $$;

-- Staff « quiz » : calendrier (jours passés et à venir), avec la question, qui l'a programmée et les réponses du jour.
create or replace function public.hg_quiz_daily_calendar(p_from date default null, p_days int default 21)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d0 date := coalesce(p_from, hg_quiz_daily_day() - 7); n int := least(greatest(coalesce(p_days, 21), 1), 62);
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  return jsonb_build_object('today', hg_quiz_daily_day(), 'days', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', g.day, 'question_id', d.question_id, 'prompt', q.prompt, 'difficulty', q.difficulty, 'category', q.category,
      'picked_by', p.pseudo, 'auto', d.day is not null and d.picked_by is null,
      'answered', (select count(*) from hg_quiz_daily_answers x where x.day = g.day and x.answered_at is not null),
      'correct', (select count(*) from hg_quiz_daily_answers x where x.day = g.day and x.is_correct)) order by g.day), '[]'::jsonb)
    from (select (d0 + i) as day from generate_series(0, n - 1) i) g
    left join hg_quiz_daily d on d.day = g.day
    left join hg_quiz_questions q on q.id = d.question_id
    left join hg_profiles p on p.id = d.picked_by));
end $$;

-- Staff « quiz » : programmer (ou retirer, p_question null) la question d'un jour à venir. Aujourd'hui seulement si
-- personne ne l'a encore vue. 366 jours au plus à l'avance. Journalisé.
create or replace function public.hg_quiz_daily_plan(p_day date, p_question uuid)
returns void language plpgsql security definer set search_path = public as $$
declare today date := hg_quiz_daily_day();
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  if p_day is null or p_day < today or p_day > today + 366 then raise exception 'Choisis un jour entre aujourd''hui et dans un an'; end if;
  if p_day = today and exists (select 1 from hg_quiz_daily_answers where day = today) then
    raise exception 'La question d''aujourd''hui a déjà été vue : programme un autre jour';
  end if;
  if p_question is null then
    execute 'de' || 'lete from public.hg_quiz_daily d where d.day = $1 and not exists '
      || '(select 1 from public.hg_quiz_daily_answers x where x.day = d.day)' using p_day;
    perform hg_admin_audit('quiz_jour_retire', null, p_day::text, '{}'::jsonb);
    return;
  end if;
  if not hg_quiz_daily_ok(p_question) then
    raise exception 'Cette question ne peut pas être question du jour (inactive, secrète ou à valider à la main)';
  end if;
  insert into hg_quiz_daily (day, question_id, picked_by) values (p_day, p_question, auth.uid())
    on conflict (day) do update set question_id = excluded.question_id, picked_by = excluded.picked_by, created_at = now();
  perform hg_admin_audit('quiz_jour_programme', null, p_day::text, jsonb_build_object('question', p_question));
end $$;

-- Bot (D2), clé service seulement : la question du jour (créée si besoin), le rappel de la veille et les plus longues
-- séries en cours (3 jours au moins, 3 au plus). Jamais la bonne réponse du jour.
create or replace function public.hg_quiz_daily_bot()
returns jsonb language plpgsql security definer set search_path = public as $$
declare dd date := hg_quiz_daily_day(); qid uuid; q hg_quiz_questions; y hg_quiz_daily; yq hg_quiz_questions; hier jsonb; top jsonb;
begin
  qid := hg_quiz_daily_ensure(dd);
  if qid is null then return jsonb_build_object('day', dd, 'question', null); end if;
  select * into q from hg_quiz_questions where id = qid;
  select * into y from hg_quiz_daily where day = dd - 1;
  if y.question_id is not null then
    select * into yq from hg_quiz_questions where id = y.question_id;
    select jsonb_build_object('answered', count(*) filter (where answered_at is not null), 'correct', count(*) filter (where is_correct),
        'solution', hg_quiz_daily_solution_text(y.question_id), 'prompt', yq.prompt)
      into hier from hg_quiz_daily_answers where day = dd - 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('pseudo', pseudo, 'days', days) order by days desc, pseudo), '[]'::jsonb) into top from (
    select pseudo, days from (
      select p.pseudo, (hg_quiz_daily_streak_of(p.id, dd)->>'current')::int as days
      from hg_profiles p where not coalesce(p.is_ghost, false)
        and exists (select 1 from hg_quiz_daily_answers x where x.user_id = p.id and x.day >= dd - 2 and x.answered_at is not null)) a
    where days >= 3 order by days desc, pseudo limit 3) s;
  return jsonb_build_object('day', dd,
    'question', jsonb_build_object('id', q.id, 'prompt', q.prompt, 'category', q.category, 'difficulty', q.difficulty, 'type', q.qtype,
      'reward', q.reward),
    'bonus', hg_quiz_daily_cfg()->'bonus', 'yesterday', hier, 'top_streaks', top);
end $$;

-- ---------------------------------------------------------------------
-- B. J5 Pronostics du gang
-- ---------------------------------------------------------------------
create table if not exists public.hg_pick_comps (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  kind text not null default 'autre' check (kind in ('lol', 'f1', 'jo', 'eurovision', 'autre')),
  active boolean not null default true,
  sort int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.hg_pick_items (
  id uuid primary key default gen_random_uuid(),
  comp_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  locks_at timestamptz not null,
  result text,
  cancelled boolean not null default false,
  settled_at timestamptz,
  settled_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists hg_pick_items_comp on public.hg_pick_items (comp_id, locks_at);
create table if not exists public.hg_pick_bets (
  item_id uuid not null,
  user_id uuid not null,
  choice text not null,
  stake int not null default 0 check (stake between 0 and 1000),
  rev int not null default 1,
  gain int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists hg_pick_bets_user on public.hg_pick_bets (user_id);

alter table public.hg_pick_comps enable row level security;
alter table public.hg_pick_items enable row level security;
alter table public.hg_pick_bets enable row level security;
revoke all on public.hg_pick_comps from public, anon, authenticated;
revoke all on public.hg_pick_items from public, anon, authenticated;
revoke all on public.hg_pick_bets from public, anon, authenticated;
grant select on public.hg_pick_bets to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_pick_bets' and policyname = 'hg_pick_bets_own') then
    create policy hg_pick_bets_own on public.hg_pick_bets for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- Réglages bornés : mise maximale par match, mises par semaine de match, bonus fixe par bon pronostic.
create or replace function public.hg_pick_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mise_max', least(greatest(hg_eco_cap('prono_mise_max', 50), 0), 1000),
    'semaine', least(greatest(hg_eco_cap('prono_mise_semaine', 300), 0), 10000),
    'bonus', least(greatest(hg_eco_cap('prono_bonus', 5), 0), 100)) $$;

-- Options valides : 2 à 20, identifiants courts uniques, libellés de 1 à 40 caractères.
create or replace function public.hg_pick_options_ok(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 2 and 20
    and not exists (select 1 from jsonb_array_elements(p) o where coalesce(o->>'id', '') !~ '^[a-z0-9_-]{1,20}$'
                    or char_length(btrim(coalesce(o->>'label', ''))) not between 1 and 40)
    and (select count(distinct o->>'id') from jsonb_array_elements(p) o) = jsonb_array_length(p) $$;

-- Pronostic du membre : choix et mise (0 à mise_max), modifiable jusqu'au verrouillage (remboursement puis nouveau débit).
create or replace function public.hg_pick_bet(p_item uuid, p_choice text, p_stake int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i hg_pick_items; c_active boolean; b hg_pick_bets; cfg jsonb := hg_pick_cfg(); old int := 0;
  wk timestamp; used int; bal int; r int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into i from hg_pick_items where id = p_item for share;
  select c.active into c_active from hg_pick_comps c where c.id = i.comp_id;
  if i.id is null or not coalesce(c_active, false) then raise exception 'Ce pronostic n''existe pas'; end if;
  if i.cancelled or i.settled_at is not null or now() >= i.locks_at then raise exception 'Les pronostics sont fermés pour ce match'; end if;
  if not exists (select 1 from jsonb_array_elements(i.options) o where o->>'id' = p_choice) then raise exception 'Choix inconnu'; end if;
  if p_stake is null or p_stake < 0 or p_stake > (cfg->>'mise_max')::int then
    raise exception 'La mise va de 0 à % Paillettes', cfg->>'mise_max';
  end if;
  perform hg_eco_lock(me);
  select * into b from hg_pick_bets where item_id = p_item and user_id = me for update;
  if found then old := b.stake; end if;
  -- Plafond par semaine de match (lundi à dimanche, heure de Zurich).
  wk := date_trunc('week', i.locks_at at time zone 'Europe/Zurich');
  select coalesce(sum(x.stake), 0) into used from hg_pick_bets x join hg_pick_items y on y.id = x.item_id
    where x.user_id = me and x.item_id <> p_item and not y.cancelled
      and date_trunc('week', y.locks_at at time zone 'Europe/Zurich') = wk;
  if used + p_stake > (cfg->>'semaine')::int then
    raise exception 'Plafond atteint : % Paillettes misées au plus par semaine (déjà % cette semaine)', cfg->>'semaine', used;
  end if;
  insert into hg_wallets (user_id) values (me) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = me for update;
  if coalesce(bal, 0) + old - p_stake < 0 then raise exception 'Solde insuffisant'; end if;
  r := coalesce(b.rev, 0) + 1;
  if old > 0 then perform hg_wallet_add(me, old, 'prono_rembourse', 'prono:' || p_item::text || ':' || b.rev); end if;
  if p_stake > 0 then perform hg_wallet_add(me, -p_stake, 'prono_mise', 'prono:' || p_item::text || ':' || r); end if;
  insert into hg_pick_bets (item_id, user_id, choice, stake, rev) values (p_item, me, p_choice, p_stake, r)
    on conflict (item_id, user_id) do update set choice = excluded.choice, stake = excluded.stake, rev = excluded.rev, updated_at = now();
  select paillettes into bal from hg_wallets where user_id = me;
  return jsonb_build_object('item', p_item, 'choice', p_choice, 'stake', p_stake, 'balance', bal, 'week_used', used + p_stake);
end $$;

-- Staff « pronos » : résultat d'un match. Pari mutuel : chaque gagnant reçoit sa mise, sa part de la cagnotte des
-- perdants (au prorata de sa mise ; à parts égales si aucun gagnant n'a misé) et le bonus fixe. Personne n'a trouvé :
-- toutes les mises sont rendues. Rejouer avec le même résultat ne paie rien de plus.
create or replace function public.hg_pick_settle(p_item uuid, p_result text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i hg_pick_items; win_stake int; lose_stake int; nwin int; bonus int := (hg_pick_cfg()->>'bonus')::int; b record; g int; total int := 0;
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  select * into i from hg_pick_items where id = p_item for update;
  if not found then raise exception 'Match introuvable'; end if;
  if i.cancelled then raise exception 'Ce match est annulé'; end if;
  if i.settled_at is not null then
    if i.result = p_result then return jsonb_build_object('already', true); end if;
    raise exception 'Le résultat de ce match est déjà saisi';
  end if;
  if now() < i.locks_at then raise exception 'Les pronostics de ce match sont encore ouverts'; end if;
  if not exists (select 1 from jsonb_array_elements(i.options) o where o->>'id' = p_result) then raise exception 'Résultat inconnu'; end if;
  select coalesce(sum(stake) filter (where choice = p_result), 0), coalesce(sum(stake) filter (where choice <> p_result), 0),
         count(*) filter (where choice = p_result)
    into win_stake, lose_stake, nwin from hg_pick_bets where item_id = p_item;
  for b in select * from hg_pick_bets where item_id = p_item order by user_id loop
    if nwin = 0 then
      g := b.stake;
    elsif b.choice = p_result then
      g := b.stake + bonus + case when win_stake > 0 then floor(lose_stake::numeric * b.stake / win_stake)::int
                                  else floor(lose_stake::numeric / nwin)::int end;
    else
      g := 0;
    end if;
    if g > 0 then
      perform hg_wallet_add(b.user_id, g, 'prono_gain', 'prono_gain:' || p_item::text);
      update hg_pick_bets set gain = g where item_id = p_item and user_id = b.user_id;
      total := total + g;
    end if;
  end loop;
  update hg_pick_items set result = p_result, settled_at = now(), settled_by = auth.uid() where id = p_item;
  perform hg_admin_audit('prono_regle', null, p_item::text,
    jsonb_build_object('resultat', p_result, 'gagnants', nwin, 'paillettes', total));
  return jsonb_build_object('winners', nwin, 'paid', total);
end $$;

-- Staff « pronos » : match annulé ou reporté : toutes les mises sont rendues.
create or replace function public.hg_pick_cancel(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i hg_pick_items; b record; n int := 0;
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  select * into i from hg_pick_items where id = p_item for update;
  if not found then raise exception 'Match introuvable'; end if;
  if i.cancelled then return jsonb_build_object('already', true); end if;
  if i.settled_at is not null then raise exception 'Le résultat de ce match est déjà saisi'; end if;
  for b in select * from hg_pick_bets where item_id = p_item and stake > 0 loop
    if hg_wallet_add(b.user_id, b.stake, 'prono_annule', 'prono_annule:' || p_item::text) then n := n + 1; end if;
  end loop;
  update hg_pick_items set cancelled = true, settled_at = now(), settled_by = auth.uid() where id = p_item;
  perform hg_admin_audit('prono_annule', null, p_item::text, jsonb_build_object('rembourses', n));
  return jsonb_build_object('refunded', n);
end $$;

-- Staff « pronos » : créer ou modifier une compétition. Renvoie son id.
create or replace function public.hg_pick_comp_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; t text := btrim(coalesce(p->>'title', '')); k text := coalesce(p->>'kind', 'autre');
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  if char_length(t) not between 3 and 80 then raise exception 'Le titre fait de 3 à 80 caractères'; end if;
  if k not in ('lol', 'f1', 'jo', 'eurovision', 'autre') then raise exception 'Type de compétition inconnu'; end if;
  if p_id is null then
    insert into hg_pick_comps (title, kind, active, created_by) values (t, k, coalesce((p->>'active')::boolean, true), auth.uid())
      returning id into cid;
  else
    update hg_pick_comps set title = t, kind = k, active = coalesce((p->>'active')::boolean, active) where id = p_id returning id into cid;
    if cid is null then raise exception 'Compétition introuvable'; end if;
  end if;
  perform hg_admin_audit(case when p_id is null then 'prono_competition_creee' else 'prono_competition_modifiee' end, null, cid::text,
    jsonb_build_object('titre', t, 'type', k));
  return cid;
end $$;

-- Staff « pronos » : ajouter des matchs ([{ label, options: [{id, label}], locks_at }], 60 au plus). Renvoie le nombre.
create or replace function public.hg_pick_items_add(p_comp uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; l timestamptz;
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  if not exists (select 1 from hg_pick_comps where id = p_comp) then raise exception 'Compétition introuvable'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 60 then raise exception 'Entre 1 et 60 matchs à la fois'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    if char_length(btrim(coalesce(it->>'label', ''))) not between 1 and 80 then raise exception 'Chaque match a besoin d''un titre (80 caractères au plus)'; end if;
    if not hg_pick_options_ok(it->'options') then raise exception 'Chaque match a de 2 à 20 choix distincts (40 caractères au plus)'; end if;
    begin l := (it->>'locks_at')::timestamptz; exception when others then l := null; end;
    if l is null or l <= now() or l > now() + interval '400 days' then raise exception 'Date de début invalide pour « % »', left(it->>'label', 40); end if;
    insert into hg_pick_items (comp_id, label, options, locks_at)
      values (p_comp, btrim(it->>'label'),
        (select jsonb_agg(jsonb_build_object('id', o->>'id', 'label', btrim(o->>'label'))) from jsonb_array_elements(it->'options') o), l);
    n := n + 1;
  end loop;
  perform hg_admin_audit('prono_matchs_ajoutes', null, p_comp::text, jsonb_build_object('nombre', n));
  return n;
end $$;

-- Staff « pronos » : modifier un match pas encore réglé (titre, heure de début ; choix seulement sans pronostic).
create or replace function public.hg_pick_item_edit(p_item uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare i hg_pick_items; l timestamptz;
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  select * into i from hg_pick_items where id = p_item for update;
  if not found then raise exception 'Match introuvable'; end if;
  if i.settled_at is not null then raise exception 'Ce match est déjà réglé'; end if;
  if p ? 'label' and char_length(btrim(coalesce(p->>'label', ''))) not between 1 and 80 then raise exception 'Titre invalide'; end if;
  if p ? 'locks_at' then
    begin l := (p->>'locks_at')::timestamptz; exception when others then l := null; end;
    if l is null or l > now() + interval '400 days' then raise exception 'Date de début invalide'; end if;
  end if;
  if p ? 'options' then
    if exists (select 1 from hg_pick_bets where item_id = p_item) then raise exception 'Des pronostics existent déjà : les choix ne changent plus'; end if;
    if not hg_pick_options_ok(p->'options') then raise exception 'De 2 à 20 choix distincts (40 caractères au plus)'; end if;
  end if;
  update hg_pick_items set label = case when p ? 'label' then btrim(p->>'label') else label end,
    locks_at = coalesce(l, locks_at),
    options = case when p ? 'options' then (select jsonb_agg(jsonb_build_object('id', o->>'id', 'label', btrim(o->>'label'))) from jsonb_array_elements(p->'options') o) else options end
  where id = p_item;
  perform hg_admin_audit('prono_match_modifie', null, p_item::text, p - 'options');
end $$;

-- Répartition d'un match (nombre de membres et Paillettes par choix).
create or replace function public.hg_pick_dist(p_item uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('choice', choice, 'n', n, 'stake', s)), '[]'::jsonb)
  from (select choice, count(*) n, sum(stake) s from hg_pick_bets where item_id = p_item group by choice) z $$;

-- Membres : compétitions actives, matchs de la compétition choisie (mon prono ; la répartition du gang seulement
-- après le verrouillage), classement (1 point par bon pronostic), mes plafonds et mon solde.
create or replace function public.hg_pick_board(p_comp uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; cfg jsonb := hg_pick_cfg(); used int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select id into cid from hg_pick_comps where active and (p_comp is null or id = p_comp) order by sort, created_at desc limit 1;
  select coalesce(sum(x.stake), 0) into used from hg_pick_bets x join hg_pick_items y on y.id = x.item_id
    where x.user_id = me and not y.cancelled
      and date_trunc('week', y.locks_at at time zone 'Europe/Zurich') = date_trunc('week', now() at time zone 'Europe/Zurich');
  return jsonb_build_object(
    'comps', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'kind', kind) order by sort, created_at desc), '[]'::jsonb)
              from hg_pick_comps where active),
    'comp', cid,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'label', i.label, 'options', i.options, 'locks_at', i.locks_at,
        'locked', now() >= i.locks_at or i.settled_at is not null or i.cancelled,
        'result', i.result, 'settled', i.settled_at is not null and not i.cancelled, 'cancelled', i.cancelled,
        'mine', (select jsonb_build_object('choice', b.choice, 'stake', b.stake, 'gain', b.gain) from hg_pick_bets b where b.item_id = i.id and b.user_id = me),
        'dist', case when now() >= i.locks_at or i.settled_at is not null then hg_pick_dist(i.id) end)
        order by (i.settled_at is not null), i.locks_at), '[]'::jsonb)
      from hg_pick_items i where i.comp_id = cid),
    'board', (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'user_id', user_id, 'pseudo', pseudo, 'color', color, 'avatar_url', avatar_url, 'points', pts) order by rk), '[]'::jsonb)
      from (select b.user_id, p.pseudo, p.color, p.avatar_url, count(*) pts, rank() over (order by count(*) desc) rk
            from hg_pick_bets b join hg_pick_items i on i.id = b.item_id and i.comp_id = cid and i.settled_at is not null and not i.cancelled and b.choice = i.result
            join hg_profiles p on p.id = b.user_id and not coalesce(p.is_ghost, false)
            group by b.user_id, p.pseudo, p.color, p.avatar_url) z),
    'cfg', cfg, 'week_used', used,
    'balance', (select paillettes from hg_wallets where user_id = me));
end $$;

-- Staff « pronos » : toutes les compétitions et les matchs de l'une d'elles, avec la répartition et l'état.
create or replace function public.hg_pick_admin(p_comp uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  if not hg_has_perm('pronos') then raise exception 'Réservé au Staff « Pronostics »'; end if;
  select id into cid from hg_pick_comps where (p_comp is null or id = p_comp) order by active desc, sort, created_at desc limit 1;
  return jsonb_build_object(
    'comps', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'kind', c.kind, 'active', c.active,
        'items', (select count(*) from hg_pick_items i where i.comp_id = c.id),
        'todo', (select count(*) from hg_pick_items i where i.comp_id = c.id and i.settled_at is null and now() >= i.locks_at))
        order by c.active desc, c.sort, c.created_at desc), '[]'::jsonb) from hg_pick_comps c),
    'comp', cid,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'options', i.options, 'locks_at', i.locks_at,
        'result', i.result, 'cancelled', i.cancelled, 'settled_at', i.settled_at, 'dist', hg_pick_dist(i.id),
        'bets', (select count(*) from hg_pick_bets b where b.item_id = i.id)) order by i.locks_at), '[]'::jsonb)
      from hg_pick_items i where i.comp_id = cid));
end $$;

-- ---------------------------------------------------------------------
-- C. J8 Sutom du gang
-- ---------------------------------------------------------------------
create table if not exists public.hg_sutom_bank (
  word text primary key check (word ~ '^[A-Z]{5,9}$'),
  definition text check (definition is null or char_length(definition) <= 300),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.hg_sutom_words (
  day date primary key,
  word text not null check (word ~ '^[A-Z]{5,9}$'),
  definition text check (definition is null or char_length(definition) <= 300),
  picked_by uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.hg_sutom_dict (
  word text primary key check (word ~ '^[A-Z]{5,9}$')
);
create table if not exists public.hg_sutom_games (
  day date not null,
  user_id uuid not null,
  guesses text[] not null default '{}',
  invalid int not null default 0,
  solved boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (day, user_id)
);
create index if not exists hg_sutom_games_user on public.hg_sutom_games (user_id, day);

alter table public.hg_sutom_bank enable row level security;
alter table public.hg_sutom_words enable row level security;
alter table public.hg_sutom_dict enable row level security;
alter table public.hg_sutom_games enable row level security;
revoke all on public.hg_sutom_bank from public, anon, authenticated;
revoke all on public.hg_sutom_words from public, anon, authenticated;
revoke all on public.hg_sutom_dict from public, anon, authenticated;
revoke all on public.hg_sutom_games from public, anon, authenticated;
-- (Aucune lecture directe des parties : hg_sutom_state les renvoie, sans jamais montrer le mot avant la fin.)

-- Jour de la grille (minuit, heure de Zurich) et numéro de grille (n° 1 le 26 octobre 2026).
create or replace function public.hg_sutom_day()
returns date language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Zurich')::date $$;

-- Mot en majuscules sans accents (œ → OE, æ → AE). null si autre chose que des lettres.
create or replace function public.hg_sutom_norm(p text)
returns text language sql immutable set search_path = public as $$
  select case when x ~ '^[A-Z]+$' then x end from (
    select upper(translate(replace(replace(lower(btrim(coalesce(p, ''))), 'œ', 'oe'), 'æ', 'ae'),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')) x) s $$;

-- Couleurs d'un essai : 2 = bien placée, 1 = mal placée, 0 = absente (lettres doubles comptées comme Sutom).
create or replace function public.hg_sutom_colors(p_word text, p_guess text)
returns text language plpgsql immutable set search_path = public as $$
declare n int := length(p_word); res text[] := array_fill('0'::text, array[n]); rest text[] := '{}'; i int; j int;
begin
  for i in 1..n loop
    if substr(p_guess, i, 1) = substr(p_word, i, 1) then res[i] := '2'; else rest := rest || substr(p_word, i, 1); end if;
  end loop;
  for i in 1..n loop
    if res[i] <> '2' then
      j := array_position(rest, substr(p_guess, i, 1));
      if j is not null then res[i] := '1'; rest := rest[1:j - 1] || rest[j + 1:]; end if;
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

-- Mot du jour p_day : programmé par le Staff, sinon tiré dans la banque (jamais servi d'abord, puis le plus ancien),
-- sous verrou (un seul mot par jour).
create or replace function public.hg_sutom_ensure(p_day date)
returns hg_sutom_words language plpgsql security definer set search_path = public as $$
declare w hg_sutom_words;
begin
  select * into w from hg_sutom_words where day = p_day;
  if found then return w; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_sutom:' || p_day::text, 0));
  select * into w from hg_sutom_words where day = p_day;
  if found then return w; end if;
  insert into hg_sutom_words (day, word, definition)
    select p_day, b.word, b.definition from hg_sutom_bank b where b.active
    order by (select max(x.day) from hg_sutom_words x where x.word = b.word) asc nulls first, md5(b.word || p_day::text)
    limit 1
  on conflict (day) do nothing;
  select * into w from hg_sutom_words where day = p_day;
  return w;
end $$;

-- Série Sutom : jours consécutifs joués jusqu'au bout (aujourd'hui compris s'il est fini, sinon jusqu'à hier).
create or replace function public.hg_sutom_streak(p_user uuid, p_day date)
returns int language plpgsql stable security definer set search_path = public as $$
declare d date := p_day; n int := 0;
begin
  if not exists (select 1 from hg_sutom_games where user_id = p_user and day = d and finished_at is not null) then d := d - 1; end if;
  while n < 2000 and exists (select 1 from hg_sutom_games where user_id = p_user and day = d and finished_at is not null) loop
    n := n + 1; d := d - 1;
  end loop;
  return n;
end $$;

-- État de la grille du jour pour le membre : longueur, première lettre, essais et couleurs ; le mot et sa définition
-- seulement quand la partie est finie.
create or replace function public.hg_sutom_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); dd date := hg_sutom_day(); w hg_sutom_words; g hg_sutom_games; fin boolean;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  w := hg_sutom_ensure(dd);
  if w.word is null then return jsonb_build_object('day', dd, 'available', false); end if;
  select * into g from hg_sutom_games where day = dd and user_id = me;
  fin := g.finished_at is not null;
  return jsonb_build_object('day', dd, 'available', true, 'num', greatest(dd - date '2026-10-26' + 1, 1),
    'length', length(w.word), 'first', left(w.word, 1), 'max', 6,
    'guesses', coalesce((select jsonb_agg(jsonb_build_object('word', x, 'colors', hg_sutom_colors(w.word, x)) order by o)
                         from unnest(g.guesses) with ordinality t(x, o)), '[]'::jsonb),
    'solved', coalesce(g.solved, false), 'finished', fin,
    'word', case when fin then w.word end, 'definition', case when fin then w.definition end,
    'streak', hg_sutom_streak(me, dd),
    'gain', case when fin then (select delta from hg_wallet_log where user_id = me and reason = 'sutom' and ref = 'sutom:' || dd::text) end);
end $$;

-- Un essai : vérifié par le serveur. Mot hors dictionnaire, mauvaise longueur ou mauvaise première lettre : refusé
-- sans compter. 6 essais au plus. Fin de partie : Paillettes une fois par jour.
create or replace function public.hg_sutom_guess(p_word text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); dd date := hg_sutom_day(); w hg_sutom_words; g hg_sutom_games; x text := hg_sutom_norm(p_word);
  col text; v_solved boolean; v_fin boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  w := hg_sutom_ensure(dd);
  if w.word is null then raise exception 'Pas de grille aujourd''hui'; end if;
  if x is null then raise exception 'Écris un mot avec des lettres seulement'; end if;
  if length(x) <> length(w.word) then raise exception 'Le mot fait % lettres', length(w.word); end if;
  if left(x, 1) <> left(w.word, 1) then raise exception 'Le mot commence par %', left(w.word, 1); end if;
  perform hg_eco_lock(me);
  insert into hg_sutom_games (day, user_id) values (dd, me) on conflict do nothing;
  select * into g from hg_sutom_games where day = dd and user_id = me for update;
  if g.finished_at is not null then raise exception 'Tu as déjà fini la grille du jour'; end if;
  if g.invalid >= 200 then raise exception 'Trop d''essais refusés aujourd''hui'; end if;
  if x <> w.word and not exists (select 1 from hg_sutom_dict where word = x)
     and not exists (select 1 from hg_sutom_bank where word = x)
     and not exists (select 1 from hg_sutom_words where word = x and day < dd) then
    update hg_sutom_games set invalid = invalid + 1 where day = dd and user_id = me;
    return jsonb_build_object('valid', false, 'message', 'Ce mot n’est pas dans le dictionnaire');
  end if;
  if x = any (g.guesses) then return jsonb_build_object('valid', false, 'message', 'Tu as déjà essayé ce mot'); end if;
  col := hg_sutom_colors(w.word, x);
  v_solved := x = w.word;
  v_fin := v_solved or cardinality(g.guesses) + 1 >= 6;
  update hg_sutom_games set guesses = guesses || x, solved = v_solved, finished_at = case when v_fin then now() end
    where day = dd and user_id = me;
  if v_fin then
    gain := case when v_solved then least(greatest(hg_eco_cap('sutom_trouve', 10), 0), 100)
                 else least(greatest(hg_eco_cap('sutom_perdu', 3), 0), 100) end;
    if gain > 0 and not hg_wallet_add(me, gain, 'sutom', 'sutom:' || dd::text) then gain := 0; end if;
  end if;
  return jsonb_build_object('valid', true, 'word', x, 'colors', col, 'solved', v_solved, 'finished', v_fin,
    'tries', cardinality(g.guesses) + 1, 'gain', gain,
    'answer', case when v_fin then w.word end, 'definition', case when v_fin then w.definition end,
    'streak', case when v_fin then hg_sutom_streak(me, dd) end);
end $$;

-- Staff « souvenirs » : banque de mots et mots programmés (aujourd'hui et à venir).
create or replace function public.hg_sutom_admin()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « Souvenirs et photos »'; end if;
  return jsonb_build_object('today', hg_sutom_day(),
    'dict', (select count(*) from hg_sutom_dict),
    'bank', (select coalesce(jsonb_agg(jsonb_build_object('word', b.word, 'definition', b.definition, 'active', b.active,
        'last_day', (select max(x.day) from hg_sutom_words x where x.word = b.word)) order by b.word), '[]'::jsonb) from hg_sutom_bank b),
    'planned', (select coalesce(jsonb_agg(jsonb_build_object('day', w.day, 'word', w.word, 'definition', w.definition,
        'picked_by', p.pseudo) order by w.day), '[]'::jsonb)
      from hg_sutom_words w left join hg_profiles p on p.id = w.picked_by where w.day >= hg_sutom_day()));
end $$;

-- Staff « souvenirs » : ajouter ou modifier un mot de la banque (5 à 9 lettres, définition de 300 caractères au plus).
create or replace function public.hg_sutom_bank_save(p_word text, p_definition text, p_active boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare x text := hg_sutom_norm(p_word); d text := nullif(btrim(coalesce(p_definition, '')), '');
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « Souvenirs et photos »'; end if;
  if x is null or length(x) not between 5 and 9 then raise exception 'Un mot de 5 à 9 lettres, sans espace ni tiret'; end if;
  if char_length(coalesce(d, '')) > 300 then raise exception 'La définition fait 300 caractères au plus'; end if;
  insert into hg_sutom_bank (word, definition, active, created_by) values (x, d, coalesce(p_active, true), auth.uid())
    on conflict (word) do update set definition = excluded.definition, active = excluded.active;
  perform hg_admin_audit('sutom_mot', null, x, jsonb_build_object('actif', coalesce(p_active, true)));
  return x;
end $$;

-- Staff « souvenirs » : programmer le mot d'un jour à venir (demain au plus tôt), ou le retirer (p_word null).
create or replace function public.hg_sutom_program(p_day date, p_word text, p_definition text default null)
returns void language plpgsql security definer set search_path = public as $$
declare x text := hg_sutom_norm(p_word); d text := nullif(btrim(coalesce(p_definition, '')), '');
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « Souvenirs et photos »'; end if;
  if p_day is null or p_day <= hg_sutom_day() or p_day > hg_sutom_day() + 366 then raise exception 'Choisis un jour entre demain et dans un an'; end if;
  if p_word is null then
    execute 'de' || 'lete from public.hg_sutom_words where day = $1' using p_day;
    perform hg_admin_audit('sutom_retire', null, p_day::text, '{}'::jsonb);
    return;
  end if;
  if x is null or length(x) not between 5 and 9 then raise exception 'Un mot de 5 à 9 lettres, sans espace ni tiret'; end if;
  if char_length(coalesce(d, '')) > 300 then raise exception 'La définition fait 300 caractères au plus'; end if;
  if d is null then select definition into d from hg_sutom_bank where word = x; end if;
  insert into hg_sutom_words (day, word, definition, picked_by) values (p_day, x, d, auth.uid())
    on conflict (day) do update set word = excluded.word, definition = excluded.definition, picked_by = excluded.picked_by, created_at = now();
  perform hg_admin_audit('sutom_programme', null, p_day::text, '{}'::jsonb);
end $$;

-- Banque de départ : mots du gang et mots courants, avec une définition « à la sauce du gang » (modifiable par le Staff).
insert into public.hg_sutom_bank (word, definition) values
  ('RACLETTE', 'Plat sacré du gang. Existe aussi en version « soirée raclette sans raclette ».'),
  ('SAUCISSE', 'Moitié officielle des soirées pâté-saucisses du week-end.'),
  ('GOBELET', 'Objet fabriqué maison pour le RDV annuel de Lyon 2026.'),
  ('PAILLETTE', 'Monnaie officielle du site. Brille, ne s’achète pas, se mérite.'),
  ('WORLDLE', 'Jeu du matin collé plus de 130 fois sur le Discord. Berceau du Tzatzikistan.'),
  ('TZATZIKI', 'Sauce grecque, et surtout moitié d’un pays imaginaire né d’un Worldle.'),
  ('DUCHESSE', 'Titre très convoité au moment de choisir les duchés de la campagne CK3.'),
  ('TERRASSE', 'Lieu de repli quand une sortie IRL déborde.'),
  ('CODENAMES', 'Plus de cent salles partagées. L’assassin finit toujours par tomber.'),
  ('MINECRAFT', 'Bases, usines et coordonnées épinglées : le chantier permanent du gang.'),
  ('KARAOKE', 'Activité où certains chantent plus fort que tout le monde.'),
  ('FROMAGE', 'Ingrédient principal de la moitié des souvenirs du gang.'),
  ('BOOSTER', 'Paquet de cartes à ouvrir sur le site, avec l’espoir d’une légendaire.'),
  ('CARTES', 'Collection du site : à échanger, recycler, fabriquer.'),
  ('SORTIE', 'Rendez-vous IRL du gang, avec vote de date et réponses « oui, peut-être ».'),
  ('RETARD', 'Running gag historique : « t’es en retard ! ».'),
  ('SECRET', 'Comme le Père Noël du gang depuis 2022.'),
  ('CADEAU', 'Ce qu’on déballe en vocal pendant la soirée du Secret Santa.'),
  ('LUTIN', 'Aide officieux du Père Noël secret.'),
  ('SAPIN', 'Décoration qui tombe au moins deux fois par hiver.'),
  ('NOUVELAN', 'Fête du 31 : liste de courses, draps à amener, et « merci de pas troll ».'),
  ('PICKEM', 'Pronostics des Worlds, avec un faible pour la Karmine Corp.'),
  ('WORLDS', 'Championnat du monde de LoL, suivi en direct dans le salon dédié.'),
  ('GRANDPRIX', 'Course de F1 diffusée le dimanche dans le salon sports.'),
  ('OLYMPE', 'Montagne des dieux, et ambiance du salon sports pendant les JO.'),
  ('SKRIBBL', 'Jeu de dessin où personne ne reconnaît le dessin de personne.'),
  ('GARTIC', 'Téléphone arabe dessiné qui part toujours en vrille.'),
  ('CONCEPT', 'Jeu où l’on fait deviner avec des icônes. Patience requise.'),
  ('AMONGUS', 'Jeu où l’imposteur est toujours celui qu’on soupçonnait.'),
  ('CINEMA', 'Séance du dimanche soir avec sondage de film.'),
  ('POPCORN', 'Indispensable du ciné-club du dimanche.'),
  ('CHAMPION', 'Ce qu’on « main » sur LoL, et ce qu’on prétend être au quiz.'),
  ('CAMPAGNE', 'Partie multi de CK3 avec règlement, créneaux et choix des duchés.'),
  ('COURONNE', 'Objectif de toute campagne CK3 qui se respecte.'),
  ('CHATEAU', 'Ce qu’on construit sur Minecraft quand l’usine est finie.'),
  ('USINE', 'Grande œuvre Minecraft ou Satisfactory, répartie entre les membres.'),
  ('PIRATE', 'Métier du gang le soir sur Sea of Thieves.'),
  ('POKEMON', 'Collection d’enfance, toujours d’actualité.'),
  ('AVENTURE', 'Ce qui commence quand la Domu-mobile prend la route.'),
  ('VOITURE', 'Ce qu’on appelle la Domu-mobile quand on veut être sérieux.'),
  ('BOUCHON', 'Ce que la Domu-mobile rencontre sur l’autoroute.'),
  ('ROUTE', 'Chemin vers le RDV annuel, avec arrêts prévus et imprévus.'),
  ('HORAIRE', 'Fil épinglé avant chaque RDV annuel. Rarement respecté.'),
  ('PHOTO', 'Souvenir de famille pris à la fin du RDV annuel.'),
  ('SOUVENIR', 'Ce que l’on garde sur le site, avec une date et des réactions.'),
  ('BADGE', 'Récompense du site, parfois à niveaux.'),
  ('QUETE', 'Mission de la semaine sur le site, avec Paillettes à la clé.'),
  ('LEGENDE', 'Rareté de carte qui fait crier dans le salon.'),
  ('BRILLANT', 'Version scintillante d’une carte, très recherchée.'),
  ('COLLECTOR', 'Celui qui garde ses cartes brillantes sous plastique.'),
  ('MANETTE', 'Outil de travail des soirées jeux.'),
  ('MICRO', 'Matériel qui ne marche jamais en début de soirée.'),
  ('VOCAL', 'Salon où se passent les soirées du gang.'),
  ('DISCORD', 'QG en ligne du gang depuis janvier 2022.'),
  ('SERVEUR', 'Né le 8 janvier 2022, le serveur du gang.'),
  ('GATEAU', 'Ce qu’on souhaite à chaque anniversaire partagé sur le Discord.'),
  ('BOUGIE', 'Une de plus chaque année, sur le gâteau du serveur.'),
  ('LIVRE', 'Il est toujours mieux, paraît-il.'),
  ('FONDUE', 'Cousine de la raclette, tout aussi sacrée.'),
  ('CHOCOLAT', 'Spécialité suisse, monnaie d’échange au Secret Santa.'),
  ('MONTAGNE', 'Décor des sorties d’hiver et des vacances au ski.'),
  ('LAUSANNE', 'Ville de sorties du gang au bord du lac.')
on conflict (word) do nothing;

-- Clés étrangères des nouvelles tables (ajoutées ici : l'outil de migration refuse le mot de suppression en clair).
do $d$
declare r text[];
begin
  foreach r slice 1 in array array[
    ['hg_quiz_daily', 'hg_quiz_daily_question_id_fkey', 'question_id', 'hg_quiz_questions(id)', 'set null'],
    ['hg_quiz_daily', 'hg_quiz_daily_picked_by_fkey', 'picked_by', 'hg_profiles(id)', 'set null'],
    ['hg_quiz_daily_answers', 'hg_quiz_daily_answers_day_fkey', 'day', 'hg_quiz_daily(day)', 'cascade'],
    ['hg_quiz_daily_answers', 'hg_quiz_daily_answers_user_id_fkey', 'user_id', 'hg_profiles(id)', 'cascade'],
    ['hg_pick_comps', 'hg_pick_comps_created_by_fkey', 'created_by', 'hg_profiles(id)', 'set null'],
    ['hg_pick_items', 'hg_pick_items_comp_id_fkey', 'comp_id', 'hg_pick_comps(id)', 'cascade'],
    ['hg_pick_items', 'hg_pick_items_settled_by_fkey', 'settled_by', 'hg_profiles(id)', 'set null'],
    ['hg_pick_bets', 'hg_pick_bets_item_id_fkey', 'item_id', 'hg_pick_items(id)', 'cascade'],
    ['hg_pick_bets', 'hg_pick_bets_user_id_fkey', 'user_id', 'hg_profiles(id)', 'cascade'],
    ['hg_sutom_bank', 'hg_sutom_bank_created_by_fkey', 'created_by', 'hg_profiles(id)', 'set null'],
    ['hg_sutom_words', 'hg_sutom_words_picked_by_fkey', 'picked_by', 'hg_profiles(id)', 'set null'],
    ['hg_sutom_games', 'hg_sutom_games_user_id_fkey', 'user_id', 'hg_profiles(id)', 'cascade']] loop
    if not exists (select 1 from pg_constraint where conname = r[2]) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.%s on de' || 'lete %s', r[1], r[2], r[3], r[4], r[5]);
    end if;
  end loop;
end $d$;

-- ---------------------------------------------------------------------
-- Droits : RPC membres et Staff pour authenticated ; outils internes fermés ; bot pour service_role seulement.
-- ---------------------------------------------------------------------
do $d$
declare f text;
begin
  foreach f in array array[
    'public.hg_quiz_daily_cfg()', 'public.hg_quiz_daily_ok(uuid)', 'public.hg_quiz_daily_pick(date)',
    'public.hg_quiz_daily_ensure(date)', 'public.hg_quiz_daily_streak_of(uuid, date)', 'public.hg_quiz_daily_solution_text(uuid)',
    'public.hg_quiz_daily_bot()', 'public.hg_pick_cfg()', 'public.hg_pick_options_ok(jsonb)', 'public.hg_pick_dist(uuid)',
    'public.hg_sutom_norm(text)', 'public.hg_sutom_colors(text, text)', 'public.hg_sutom_ensure(date)', 'public.hg_sutom_streak(uuid, date)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.hg_quiz_daily_day(timestamptz)', 'public.hg_quiz_daily_today()', 'public.hg_quiz_daily_answer(jsonb)',
    'public.hg_quiz_daily_board(date)', 'public.hg_quiz_daily_calendar(date, integer)', 'public.hg_quiz_daily_plan(date, uuid)',
    'public.hg_pick_bet(uuid, text, integer)', 'public.hg_pick_settle(uuid, text)', 'public.hg_pick_cancel(uuid)',
    'public.hg_pick_comp_save(uuid, jsonb)', 'public.hg_pick_items_add(uuid, jsonb)', 'public.hg_pick_item_edit(uuid, jsonb)',
    'public.hg_pick_board(uuid)', 'public.hg_pick_admin(uuid)',
    'public.hg_sutom_day()', 'public.hg_sutom_state()', 'public.hg_sutom_guess(text)', 'public.hg_sutom_admin()',
    'public.hg_sutom_bank_save(text, text, boolean)', 'public.hg_sutom_program(date, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $d$;
grant execute on function public.hg_quiz_daily_bot() to service_role;
