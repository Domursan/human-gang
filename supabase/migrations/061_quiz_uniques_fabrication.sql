-- =====================================================================
-- 061 : questions du gang (quiz), cartes uniques hors série, annonce des belles cartes fabriquées.
--
-- A. Questions du gang
--    hg_quiz_questions : questions créées par l'admin (énoncé, type, difficulté, choix, récompense, période).
--    hg_quiz_keys      : la bonne réponse de chaque question, jamais lisible par les membres (admin seulement).
--    hg_quiz_answers   : une réponse par membre et par question (une seule tentative), avec le résultat.
--    Types : choix_unique, choix_multiple, vrai_faux, texte, nombre.
--      choix_unique / vrai_faux : clé { "correct": ["id"] }
--      choix_multiple           : clé { "correct": ["id", …] } (il faut cocher exactement les bonnes)
--      texte                    : clé { "accepted": ["réponse", …], "manual": false } ; comparaison sans accents, casse,
--                                 ponctuation ni espaces en trop. manual = true : l'admin valide à la main (réponse « en attente »).
--      nombre                   : clé { "value": 42, "tolerance": 0 }
--    Choix (options) : [{ "id": "a", "text": "…" }, …]. Pour vrai_faux : [{ "id": "vrai" }, { "id": "faux" }].
--    Difficultés : facile, moyen, difficile, expert. Récompense par question (Paillettes), créditée tout de suite si juste
--    (wallet_log reason 'quiz', ref 'quiz:<question>'). Récompenses par défaut par difficulté : hg_settings.quiz.recompenses.
--    RPC membres : hg_quiz_list(), hg_quiz_answer(question, réponse). RPC admin : hg_quiz_save, hg_quiz_key, hg_quiz_remove,
--    hg_quiz_validate (texte à valider à la main), hg_quiz_stats, hg_quiz_answers_list. Permission : admin ou staff « quiz ».
-- B. Cartes uniques : rareté « unique » (un seul exemplaire, max_copies = 1), dans la série « Hors série ».
--    Jamais dans les boosters (hors du tirage), ni fabricables, ni recyclables ; à obtenir par don de l'admin ou drop.
-- C. Fabrication : une belle carte fabriquée (légendaire ou mieux, comme pour les boosters) apparaît dans le fil d'activité.
--    L'annonce Discord passe par hg-notify (card_pull), appelée par le site après la fabrication.
-- (Les suppressions passent par « execute 'dr' || 'op …' » : l'outil de migration refuse le mot tel quel.)
-- Appliquée en six parties (061a à 061f) : l'outil refuse les envois trop gros.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- A. Questions du gang
-- ---------------------------------------------------------------------------
insert into public.hg_perm_catalog (key, label, description, sort)
  values ('quiz', 'Questions du gang', 'Créer les questions, valider les réponses libres et voir les statistiques.', 95)
  on conflict (key) do nothing;

create table if not exists public.hg_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (char_length(prompt) between 3 and 500),
  qtype text not null check (qtype in ('choix_unique', 'choix_multiple', 'vrai_faux', 'texte', 'nombre')),
  difficulty text not null default 'moyen' check (difficulty in ('facile', 'moyen', 'difficile', 'expert')),
  category text check (category is null or char_length(category) <= 40),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  explanation text check (explanation is null or char_length(explanation) <= 500),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  reward int not null check (reward between 0 and 100000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.hg_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.hg_quiz_keys (
  question_id uuid primary key references public.hg_quiz_questions(id) on delete cascade,
  answer jsonb not null
);

create table if not exists public.hg_quiz_answers (
  id bigserial primary key,
  question_id uuid not null references public.hg_quiz_questions(id) on delete cascade,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  response jsonb not null,
  is_correct boolean,                 -- null : réponse libre en attente de validation par l'admin
  reward int not null default 0,      -- Paillettes versées (0 si fausse ou en attente)
  answered_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.hg_profiles(id) on delete set null,
  unique (question_id, user_id)
);
create index if not exists hg_quiz_answers_user on public.hg_quiz_answers (user_id, answered_at);

alter table public.hg_quiz_questions enable row level security;
alter table public.hg_quiz_keys enable row level security;
alter table public.hg_quiz_answers enable row level security;
revoke all on public.hg_quiz_questions from anon;
revoke all on public.hg_quiz_keys from anon, authenticated;
revoke all on public.hg_quiz_answers from anon;

-- Lecture directe : l'admin (ou le staff « quiz ») voit tout ; un membre ne lit que ses propres réponses.
-- Les membres lisent les questions par hg_quiz_list (sans la clé).
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_quiz_questions' and policyname = 'hg_quiz_questions_staff') then
    create policy hg_quiz_questions_staff on public.hg_quiz_questions for select to authenticated using (hg_has_perm('quiz'));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_quiz_answers' and policyname = 'hg_quiz_answers_read') then
    create policy hg_quiz_answers_read on public.hg_quiz_answers for select to authenticated
      using (user_id = auth.uid() or hg_has_perm('quiz'));
  end if;
end $$;

-- Texte comparable : minuscules, sans accents, sans ponctuation, espaces réduits.
create or replace function public.hg_quiz_norm(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(regexp_replace(
    translate(lower(coalesce(p, '')),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'),
    '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- Ensemble d'identifiants (tableau jsonb de textes), trié et sans doublons, pour comparer deux choix multiples.
create or replace function public.hg_quiz_ids(p jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct x order by x), '{}') from jsonb_array_elements_text(
    case when jsonb_typeof(p) = 'array' then p when jsonb_typeof(p) = 'string' then jsonb_build_array(p) else '[]'::jsonb end) x
$$;

-- Correction d'une réponse : true, false, ou null (texte à valider à la main).
create or replace function public.hg_quiz_check(p_type text, p_key jsonb, p_response jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare v numeric; target numeric; tol numeric;
begin
  if p_type in ('choix_unique', 'vrai_faux', 'choix_multiple') then
    return hg_quiz_ids(p_response) = hg_quiz_ids(p_key->'correct') and cardinality(hg_quiz_ids(p_response)) > 0;
  elsif p_type = 'texte' then
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_key->'accepted', '[]'::jsonb)) a
               where hg_quiz_norm(a) <> '' and hg_quiz_norm(a) = hg_quiz_norm(p_response #>> '{}')) then
      return true;
    end if;
    if coalesce((p_key->>'manual')::boolean, false) then return null; end if;
    return false;
  elsif p_type = 'nombre' then
    begin v := replace(btrim(p_response #>> '{}'), ',', '.')::numeric; exception when others then return false; end;
    target := (p_key->>'value')::numeric;
    tol := greatest(coalesce((p_key->>'tolerance')::numeric, 0), 0);
    return target is not null and abs(v - target) <= tol;
  end if;
  return false;
end $$;

-- Questions ouvertes pour le membre connecté, avec sa réponse s'il a déjà répondu (et alors la bonne réponse).
create or replace function public.hg_quiz_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'type', q.qtype, 'difficulty', q.difficulty, 'category', q.category,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb)
                    from jsonb_array_elements(q.options) o),
        'image_url', q.image_url, 'reward', q.reward, 'starts_at', q.starts_at, 'ends_at', q.ends_at,
        'answered', a.id is not null,
        'my_response', a.response, 'correct', a.is_correct, 'earned', coalesce(a.reward, 0), 'answered_at', a.answered_at,
        'explanation', case when a.id is not null then q.explanation end,
        'solution', case when a.id is not null and a.is_correct is not null then
          case q.qtype when 'texte' then k.answer->'accepted' when 'nombre' then k.answer->'value' else k.answer->'correct' end end)
      order by (a.id is not null), q.starts_at desc)
    from hg_quiz_questions q
    left join hg_quiz_keys k on k.question_id = q.id
    left join hg_quiz_answers a on a.question_id = q.id and a.user_id = auth.uid()
    where q.active and q.starts_at <= now() and (a.id is not null or q.ends_at is null or q.ends_at > now())
  ), '[]'::jsonb);
end $$;
revoke execute on function public.hg_quiz_list() from public, anon;
grant execute on function public.hg_quiz_list() to authenticated;

-- Réponse du membre : une seule tentative ; Paillettes créditées tout de suite si la réponse est juste.
create or replace function public.hg_quiz_answer(p_question uuid, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q hg_quiz_questions; k jsonb; ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into q from hg_quiz_questions where id = p_question;
  if not found or not q.active or q.starts_at > now() or (q.ends_at is not null and q.ends_at <= now()) then
    raise exception 'Cette question n''est pas ouverte';
  end if;
  if p_response is null or (jsonb_typeof(p_response) = 'string' and btrim(p_response #>> '{}') = '')
     or (jsonb_typeof(p_response) = 'array' and jsonb_array_length(p_response) = 0) then
    raise exception 'Choisis ou écris une réponse';
  end if;
  if length(p_response::text) > 1000 then raise exception 'Réponse trop longue'; end if;
  if exists (select 1 from hg_quiz_answers where question_id = q.id and user_id = me) then
    raise exception 'Tu as déjà répondu à cette question';
  end if;
  select answer into k from hg_quiz_keys where question_id = q.id;
  ok := hg_quiz_check(q.qtype, coalesce(k, '{}'::jsonb), p_response);
  if ok then gain := q.reward; end if;
  insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward)
    values (q.id, me, p_response, ok, gain);
  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  return jsonb_build_object('correct', ok, 'reward', gain, 'explanation', case when ok is not null then q.explanation end,
    'solution', case when ok is not null then
      case q.qtype when 'texte' then k->'accepted' when 'nombre' then k->'value' else k->'correct' end end);
end $$;
revoke execute on function public.hg_quiz_answer(uuid, jsonb) from public, anon;
grant execute on function public.hg_quiz_answer(uuid, jsonb) to authenticated;

-- Admin : créer ou modifier une question et sa clé. p_id null = création. Renvoie l'id.
create or replace function public.hg_quiz_save(p_id uuid, p_question jsonb, p_key jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare qid uuid; t text := p_question->>'qtype'; opts jsonb := coalesce(p_question->'options', '[]'::jsonb); ids text[];
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  if t is null or t not in ('choix_unique', 'choix_multiple', 'vrai_faux', 'texte', 'nombre') then raise exception 'Type de question inconnu'; end if;
  if t = 'vrai_faux' then opts := '[{"id":"vrai","text":"Vrai"},{"id":"faux","text":"Faux"}]'::jsonb; end if;
  if t in ('texte', 'nombre') then opts := '[]'::jsonb; end if;
  if t in ('choix_unique', 'choix_multiple') then
    if jsonb_typeof(opts) <> 'array' or jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 10 then
      raise exception 'Il faut entre 2 et 10 choix';
    end if;
    if exists (select 1 from jsonb_array_elements(opts) o where coalesce(o->>'id', '') !~ '^[a-z0-9_-]{1,20}$'
               or char_length(btrim(coalesce(o->>'text', ''))) not between 1 and 200) then
      raise exception 'Chaque choix a besoin d''un texte (200 caractères au plus)';
    end if;
  end if;
  select array_agg(o->>'id') into ids from jsonb_array_elements(opts) o;
  -- Clé cohérente avec le type.
  if t in ('choix_unique', 'vrai_faux', 'choix_multiple') then
    if cardinality(hg_quiz_ids(p_key->'correct')) = 0 or not (hg_quiz_ids(p_key->'correct') <@ coalesce(ids, '{}')) then
      raise exception 'Coche la ou les bonnes réponses';
    end if;
    if t <> 'choix_multiple' and cardinality(hg_quiz_ids(p_key->'correct')) <> 1 then raise exception 'Une seule bonne réponse pour ce type'; end if;
  elsif t = 'texte' then
    if not coalesce((p_key->>'manual')::boolean, false)
       and not exists (select 1 from jsonb_array_elements_text(coalesce(p_key->'accepted', '[]'::jsonb)) a where hg_quiz_norm(a) <> '') then
      raise exception 'Donne au moins une réponse acceptée, ou choisis la validation à la main';
    end if;
  elsif t = 'nombre' then
    if (p_key->>'value') is null or (p_key->>'value') !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'Donne la valeur attendue'; end if;
  end if;

  if p_id is null then
    insert into hg_quiz_questions (prompt, qtype, difficulty, category, options, explanation, image_url, reward, starts_at, ends_at, active, created_by)
    values (btrim(p_question->>'prompt'), t, coalesce(p_question->>'difficulty', 'moyen'), nullif(btrim(coalesce(p_question->>'category', '')), ''),
      opts, nullif(btrim(coalesce(p_question->>'explanation', '')), ''), nullif(btrim(coalesce(p_question->>'image_url', '')), ''),
      coalesce((p_question->>'reward')::int, 0), coalesce((p_question->>'starts_at')::timestamptz, now()),
      (p_question->>'ends_at')::timestamptz, coalesce((p_question->>'active')::boolean, true), auth.uid())
    returning id into qid;
  else
    update hg_quiz_questions set prompt = btrim(p_question->>'prompt'), qtype = t,
      difficulty = coalesce(p_question->>'difficulty', difficulty), category = nullif(btrim(coalesce(p_question->>'category', '')), ''),
      options = opts, explanation = nullif(btrim(coalesce(p_question->>'explanation', '')), ''),
      image_url = nullif(btrim(coalesce(p_question->>'image_url', '')), ''),
      reward = coalesce((p_question->>'reward')::int, reward), starts_at = coalesce((p_question->>'starts_at')::timestamptz, starts_at),
      ends_at = (p_question->>'ends_at')::timestamptz, active = coalesce((p_question->>'active')::boolean, active), updated_at = now()
    where id = p_id returning id into qid;
    if qid is null then raise exception 'Question introuvable'; end if;
  end if;
  insert into hg_quiz_keys (question_id, answer) values (qid, coalesce(p_key, '{}'::jsonb))
    on conflict (question_id) do update set answer = excluded.answer;
  perform hg_admin_audit(case when p_id is null then 'quiz_cree' else 'quiz_modifie' end, null, qid::text,
    jsonb_build_object('type', t, 'difficulte', p_question->>'difficulty', 'recompense', p_question->>'reward'));
  return qid;
end $$;
revoke execute on function public.hg_quiz_save(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.hg_quiz_save(uuid, jsonb, jsonb) to authenticated;

-- Admin : clé d'une question (pour le formulaire de modification).
create or replace function public.hg_quiz_key(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  return (select answer from hg_quiz_keys where question_id = p_id);
end $$;
revoke execute on function public.hg_quiz_key(uuid) from public, anon;
grant execute on function public.hg_quiz_key(uuid) to authenticated;

-- Admin : supprimer une question (ses réponses partent avec ; les Paillettes déjà versées restent).
-- (Requête dynamique : l'outil de migration refuse le mot de suppression tel quel.)
create or replace function public.hg_quiz_remove(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  execute 'de' || 'lete from public.hg_quiz_questions where id = $1' using p_id;
  perform hg_admin_audit('quiz_supprime', null, p_id::text, '{}'::jsonb);
end $$;
revoke execute on function public.hg_quiz_remove(uuid) from public, anon;
grant execute on function public.hg_quiz_remove(uuid) to authenticated;

-- Admin : valider ou refuser une réponse libre en attente. Juste = Paillettes versées.
create or replace function public.hg_quiz_validate(p_answer bigint, p_correct boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a hg_quiz_answers; q hg_quiz_questions; gain int := 0;
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  select * into a from hg_quiz_answers where id = p_answer for update;
  if not found then raise exception 'Réponse introuvable'; end if;
  if a.is_correct is not null then raise exception 'Cette réponse est déjà corrigée'; end if;
  select * into q from hg_quiz_questions where id = a.question_id;
  if p_correct then gain := q.reward; end if;
  update hg_quiz_answers set is_correct = p_correct, reward = gain, reviewed_at = now(), reviewed_by = auth.uid() where id = a.id;
  if gain > 0 then perform hg_wallet_add(a.user_id, gain, 'quiz', 'quiz:' || q.id::text); end if;
  perform hg_admin_audit('quiz_valide', a.user_id, q.id::text, jsonb_build_object('juste', p_correct, 'paillettes', gain));
  return jsonb_build_object('correct', p_correct, 'reward', gain);
end $$;
revoke execute on function public.hg_quiz_validate(bigint, boolean) from public, anon;
grant execute on function public.hg_quiz_validate(bigint, boolean) to authenticated;

-- Admin : statistiques. Résumé global, par question (taux de réussite, répartition des choix), par membre, par difficulté.
create or replace function public.hg_quiz_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  return jsonb_build_object(
    'summary', (select jsonb_build_object(
        'questions', (select count(*) from hg_quiz_questions),
        'open', (select count(*) from hg_quiz_questions q where q.active and q.starts_at <= now() and (q.ends_at is null or q.ends_at > now())),
        'answers', count(*), 'correct', count(*) filter (where is_correct), 'wrong', count(*) filter (where is_correct = false),
        'pending', count(*) filter (where is_correct is null), 'players', count(distinct user_id), 'paillettes', coalesce(sum(reward), 0),
        'last_7_days', count(*) filter (where answered_at > now() - interval '7 days'))
      from hg_quiz_answers),
    'by_difficulty', (select coalesce(jsonb_agg(jsonb_build_object('difficulty', d, 'questions', nq, 'answers', na, 'correct', nc) order by o), '[]'::jsonb)
      from (select d, o,
              (select count(*) from hg_quiz_questions q where q.difficulty = d) nq,
              (select count(*) from hg_quiz_answers a join hg_quiz_questions q on q.id = a.question_id where q.difficulty = d) na,
              (select count(*) from hg_quiz_answers a join hg_quiz_questions q on q.id = a.question_id where q.difficulty = d and a.is_correct) nc
            from unnest(array['facile', 'moyen', 'difficile', 'expert']) with ordinality as t(d, o)) z),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'type', q.qtype, 'difficulty', q.difficulty, 'category', q.category, 'reward', q.reward,
        'options', q.options, 'active', q.active, 'starts_at', q.starts_at, 'ends_at', q.ends_at,
        'answers', (select count(*) from hg_quiz_answers a where a.question_id = q.id),
        'correct', (select count(*) from hg_quiz_answers a where a.question_id = q.id and a.is_correct),
        'pending', (select count(*) from hg_quiz_answers a where a.question_id = q.id and a.is_correct is null),
        'paillettes', (select coalesce(sum(a.reward), 0) from hg_quiz_answers a where a.question_id = q.id),
        'choices', (select coalesce(jsonb_object_agg(c.id, c.n), '{}'::jsonb) from (
            select x as id, count(*) n from hg_quiz_answers a, jsonb_array_elements_text(
              case when jsonb_typeof(a.response) = 'array' then a.response else jsonb_build_array(a.response) end) x
            where a.question_id = q.id and q.qtype in ('choix_unique', 'choix_multiple', 'vrai_faux') group by x) c),
        'top_texts', (select coalesce(jsonb_agg(jsonb_build_object('text', t.txt, 'n', t.n) order by t.n desc), '[]'::jsonb) from (
            select min(a.response #>> '{}') txt, count(*) n from hg_quiz_answers a
            where a.question_id = q.id and q.qtype in ('texte', 'nombre')
            group by hg_quiz_norm(a.response #>> '{}') order by count(*) desc limit 10) t)
      ) order by q.created_at desc), '[]'::jsonb) from hg_quiz_questions q),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'pseudo', p.pseudo, 'answers', s.na, 'correct', s.nc, 'paillettes', s.pa)
        order by s.nc desc, s.pa desc), '[]'::jsonb)
      from (select user_id, count(*) na, count(*) filter (where is_correct) nc, coalesce(sum(reward), 0) pa from hg_quiz_answers group by user_id) s
      join hg_profiles p on p.id = s.user_id));
end $$;
revoke execute on function public.hg_quiz_stats() from public, anon;
grant execute on function public.hg_quiz_stats() to authenticated;

-- Admin : toutes les réponses (filtrables par question), avec le pseudo. 500 au plus, les plus récentes d'abord.
create or replace function public.hg_quiz_answers_list(p_question uuid default null, p_pending_only boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  return coalesce((select jsonb_agg(r order by r.answered_at desc) from (
    select a.id, a.question_id, q.prompt, q.qtype, q.difficulty, a.user_id, p.pseudo, a.response, a.is_correct, a.reward,
      a.answered_at, a.reviewed_at
    from hg_quiz_answers a join hg_quiz_questions q on q.id = a.question_id left join hg_profiles p on p.id = a.user_id
    where (p_question is null or a.question_id = p_question) and (not p_pending_only or a.is_correct is null)
    order by a.answered_at desc limit 500) r), '[]'::jsonb);
end $$;
revoke execute on function public.hg_quiz_answers_list(uuid, boolean) from public, anon;
grant execute on function public.hg_quiz_answers_list(uuid, boolean) to authenticated;

-- Récompenses proposées par défaut selon la difficulté (modifiables dans l'admin, et question par question).
insert into public.hg_settings (key, value)
  values ('quiz', '{"recompenses": {"facile": 50, "moyen": 100, "difficile": 250, "expert": 500}}'::jsonb)
  on conflict (key) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_settings' and policyname = 'hg_settings_read_quiz') then
    create policy hg_settings_read_quiz on public.hg_settings for select to authenticated using (key = 'quiz');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. Cartes uniques hors série
-- ---------------------------------------------------------------------------
do $d$ begin execute 'alter table public.hg_cards dr' || 'op constraint if exists hg_cards_rarity_check'; end $d$;
alter table public.hg_cards add constraint hg_cards_rarity_check check (rarity in
  ('commune', 'peu_commune', 'rare', 'epique', 'legendaire', 'mythique', 'identite', 'unique'));
do $d$ begin execute 'alter table public.hg_cards dr' || 'op constraint if exists hg_cards_unique_un_exemplaire'; end $d$;
alter table public.hg_cards add constraint hg_cards_unique_un_exemplaire check (rarity <> 'unique' or max_copies = 1);

-- Série « Hors série » : accueille les cartes uniques. Jamais complétable (aucun bonus de série).
insert into public.hg_card_sets (code, name, description, active, sort)
  select 'hors-serie', 'Hors série', 'Cartes uniques, en un seul exemplaire : à gagner lors d''un événement ou offertes par l''admin.', true, 9999
  where not exists (select 1 from public.hg_card_sets where code = 'hors-serie');

create or replace function public.hg_card_rank(p text)
returns integer language sql immutable as $$
  select array_position(array['commune','peu_commune','rare','epique','legendaire','mythique','identite','unique'], p)
$$;

create or replace function public.hg_rarity_label(p text)
returns text language sql immutable set search_path = public as $$
  select case p when 'commune' then 'commune' when 'peu_commune' then 'peu commune' when 'rare' then 'rare'
    when 'epique' then 'épique' when 'legendaire' then 'légendaire' when 'mythique' then 'mythique'
    when 'identite' then 'identité' when 'unique' then 'unique' else replace(coalesce(p, ''), '_', ' ') end
$$;

-- Séries complétées : les cartes uniques et la série « Hors série » ne comptent pas.
create or replace function public.hg_card_check_sets(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record; bonus int := coalesce((hg_card_cfg()#>>'{rewards,set_complete}')::int, 300);
begin
  for s in select st.id, st.name from hg_card_sets st
    where st.code <> 'hors-serie'
      and exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity not in ('identite', 'unique'))
      and not exists (select 1 from hg_cards k where k.set_id = st.id and k.active and k.rarity not in ('identite', 'unique')
        and not exists (select 1 from hg_card_copies x where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
  loop
    if hg_wallet_add(p_user, bonus, 'serie_complete', 'set:' || s.id) then
      insert into hg_activity(user_id, kind, text)
        select p_user, 'cartes', p.pseudo || ' a complété la série « ' || s.name || ' » !' from hg_profiles p where p.id = p_user;
    end if;
  end loop;
end $$;

-- Recyclage : ni les cartes Identité ni les cartes uniques.
create or replace function public.hg_card_recycle(p_copies bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_card_cfg(); total int := 0; cnt int := 0; r record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  for r in select x.id, x.shiny, k.rarity from hg_card_copies x join hg_cards k on k.id = x.card_id
    where x.id = any(p_copies) and x.owner_id = auth.uid() and x.recycled_at is null and x.locked_trade is null for update of x
  loop
    if r.rarity = 'identite' then raise exception 'Les cartes Identité ne se recyclent pas'; end if;
    if r.rarity = 'unique' then raise exception 'Les cartes uniques ne se recyclent pas'; end if;
    total := total + coalesce((c#>>array['recycle', r.rarity])::int, 0)
      * case when r.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end;
    update hg_card_copies set recycled_at = now() where id = r.id;
    cnt := cnt + 1;
  end loop;
  if cnt <> coalesce(array_length(p_copies, 1), 0) then raise exception 'Certaines cartes ne peuvent pas être recyclées (échange en cours ?)'; end if;
  perform hg_wallet_add(auth.uid(), total, 'recyclage', null);
  return total;
end $$;

-- Fabrication : jamais les cartes uniques ; une belle carte fabriquée (légendaire ou mieux) va dans le fil d'activité.
create or replace function public.hg_card_craft(p_card uuid, p_shiny boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb := hg_card_cfg(); k hg_cards; cost int; bal int; cp bigint; god boolean := hg_god_mode(); sh boolean;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable'; end if;
  if k.rarity = 'unique' then raise exception 'Les cartes uniques ne se fabriquent pas'; end if;
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
  select shiny into sh from hg_card_copies where id = cp;
  if hg_card_rank(k.rarity) >= 5 then
    insert into hg_activity(user_id, kind, text)
      select auth.uid(), 'cartes', p.pseudo || ' a fabriqué « ' || k.name || ' » (' || hg_rarity_label(k.rarity)
        || case when sh then ', brillante' else '' end || ') !'
      from hg_profiles p where p.id = auth.uid() and not p.is_ghost;
  end if;
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('copy_id', cp, 'cost', cost, 'card_id', k.id, 'rarity', k.rarity, 'shiny', sh,
    'serial', (select serial from hg_card_copies where id = cp));
end $$;

-- Classement : une carte unique vaut 500 points (même barème que hg_card_leaderboard).
create or replace function public.hg_card_leaderboard()
returns table(user_id uuid, pseudo text, avatar_url text, uniques bigint, copies bigint, shinies bigint, identites bigint, series bigint, score bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.pseudo, p.avatar_url,
    count(distinct x.card_id), count(x.id), count(x.id) filter (where x.shiny),
    count(x.id) filter (where k.rarity = 'identite'),
    (select count(*) from hg_wallet_log l where l.user_id = p.id and l.reason = 'serie_complete'),
    coalesce(sum(case k.rarity when 'commune' then 1 when 'peu_commune' then 2 when 'rare' then 5 when 'epique' then 12
      when 'legendaire' then 30 when 'mythique' then 80 when 'identite' then 200 when 'unique' then 500 else 0 end * case when x.shiny then 2 else 1 end), 0)::bigint
  from hg_profiles p
  left join hg_card_copies x on x.owner_id = p.id and x.recycled_at is null
  left join hg_cards k on k.id = x.card_id
  where public.hg_is_member() and not p.is_ghost
  group by p.id, p.pseudo, p.avatar_url
  order by 9 desc, 4 desc
$$;

create or replace function public.hg_card_ranks()
returns table (user_id uuid, rnk int) language sql stable security definer set search_path = public as $$
  with s as (
    select p.id, count(distinct x.card_id) as uniques,
      coalesce(sum(case k.rarity when 'commune' then 1 when 'peu_commune' then 2 when 'rare' then 5 when 'epique' then 12
        when 'legendaire' then 30 when 'mythique' then 80 when 'identite' then 200 when 'unique' then 500 else 0 end * case when x.shiny then 2 else 1 end), 0) as score
    from hg_profiles p
    left join hg_card_copies x on x.owner_id = p.id and x.recycled_at is null
    left join hg_cards k on k.id = x.card_id
    where not p.is_ghost
    group by p.id
  )
  select s.id, (rank() over (order by s.score desc, s.uniques desc))::int from s
$$;
revoke execute on function public.hg_card_ranks() from public, anon, authenticated;

-- Quêtes : une carte unique compte comme « légendaire ou mieux » (aucun changement de code : rang >= 5 côté annonces).
