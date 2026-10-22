-- =====================================================================
-- 062 : easter eggs (secrets cachés sur le site).
--
-- hg_egg_log : un secret trouvé par un membre, pour une période (« once » = une seule fois ; « AAAA-MM-JJ » = une fois par jour ;
--              « AAAA-MM » = une fois par mois ; « AAAA » = une fois par an). Une ligne = une récompense versée au plus.
-- hg_egg_found(code, extra) : le site signale un secret trouvé ; le serveur vérifie ce qui peut l'être (heure de Zurich,
--              date anniversaire du gang…), verse la récompense une seule fois par période et renvoie un message.
-- hg_eggs_me() : secrets déjà trouvés par le membre (pour la page secrète et la question bonus).
-- Réglages : hg_settings.eggs = { anniversaire_gang: "MM-JJ" | null, mot_secret: "SECRETS", recompenses: { code: Paillettes } }.
-- Récompenses spéciales : konami → badge « Initié » ; logo → carte « Le Curieux » ; lettres (7/7) → badge « Chasseur de secrets » ;
--   anniversaire → carte « Gâteau du gang » (une fois par an) ; secousse → un booster offert (une fois par mois) ;
--   heure du gang (13 h 37) → 13 Paillettes ; jeu de la page 404 → 5 Paillettes par jour.
-- Les cartes secrètes sont dans la série « Secrets » (inactive : jamais dans les boosters).
-- Question bonus du quiz : hg_quiz_questions.secret = true ; visible seulement après 3 secrets trouvés.
-- Ces secrets sont des jeux : un membre bricoleur peut les déclencher à la main ; les gains sont petits et plafonnés par période.
-- (Appliquée en plusieurs parties : l'outil de migration refuse les envois trop gros.)
-- =====================================================================

create table if not exists public.hg_egg_log (
  id bigserial primary key,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  egg text not null check (egg ~ '^[a-z0-9_]{2,30}$'),
  period text not null default 'once' check (period ~ '^(once|[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?)$'),
  reward int not null default 0,
  found_at timestamptz not null default now(),
  unique (user_id, egg, period)
);
alter table public.hg_egg_log enable row level security;
revoke all on public.hg_egg_log from anon;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_egg_log' and policyname = 'hg_egg_log_own') then
    create policy hg_egg_log_own on public.hg_egg_log for select to authenticated using (user_id = auth.uid() or hg_is_admin());
  end if;
end $$;

insert into public.hg_settings (key, value)
  values ('eggs', '{"anniversaire_gang": null, "mot_secret": "SECRETS", "recompenses": {"konami": 100, "logo": 50, "humane": 25, "jeu404": 5, "heure_gang": 13, "anniversaire": 100, "console": 50, "lettres": 200, "secousse": 0, "nuit": 30, "rembobine": 25}}'::jsonb)
  on conflict (key) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_settings' and policyname = 'hg_settings_read_eggs') then
    create policy hg_settings_read_eggs on public.hg_settings for select to authenticated using (key = 'eggs');
  end if;
end $$;

-- Série cachée « Secrets » (inactive : jamais tirée dans un booster) et ses deux cartes.
insert into public.hg_card_sets (code, name, description, active, sort)
  select 'secrets', 'Secrets', 'Cartes cachées : on ne les obtient qu''en trouvant les secrets du site.', false, 9998
  where not exists (select 1 from public.hg_card_sets where code = 'secrets');
insert into public.hg_cards (set_id, number, name, family, rarity, flavor, can_shiny, tradeable, craftable, active)
  select s.id, 1, 'Le Curieux', 'objet', 'epique', 'Il a cliqué sept fois sur le logo. Juste pour voir.', false, true, false, true
  from public.hg_card_sets s where s.code = 'secrets'
    and not exists (select 1 from public.hg_cards k where k.set_id = s.id and k.name = 'Le Curieux');
insert into public.hg_cards (set_id, number, name, family, rarity, flavor, can_shiny, tradeable, craftable, active)
  select s.id, 2, 'Gâteau du gang', 'evenement', 'legendaire', 'Une part par an, le jour de l''anniversaire du gang.', true, true, false, true
  from public.hg_card_sets s where s.code = 'secrets'
    and not exists (select 1 from public.hg_cards k where k.set_id = s.id and k.name = 'Gâteau du gang');

-- Badges secrets (attribués par hg_egg_found ; la récompense de badge habituelle s'applique).
insert into public.hg_badges (code, name, description, sort)
  values ('initie', 'Initié', 'A trouvé le code secret du gang.', 900),
         ('chasseur_secrets', 'Chasseur de secrets', 'A trouvé les 7 lettres cachées du site.', 901)
  on conflict (code) do nothing;

-- Question bonus secrète du quiz.
alter table public.hg_quiz_questions add column if not exists secret boolean not null default false;

-- Nombre de secrets différents trouvés par un membre.
create or replace function public.hg_eggs_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct case when egg like 'lettre_%' then 'lettres' else egg end)::int from hg_egg_log where user_id = p_user
$$;
revoke execute on function public.hg_eggs_count(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Fonctions (appliquées en 062b et 062c)
-- ---------------------------------------------------------------------------
-- Secret trouvé : vérifie, verse la récompense une fois par période, renvoie { new, reward, message, card, badge, found }.
create or replace function public.hg_egg_found(p_egg text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
  z timestamp := now() at time zone 'Europe/Zurich';
  cfg jsonb := coalesce((select value from hg_settings where key = 'eggs'), '{}'::jsonb);
  per text := 'once'; gain int; msg text; card_name text; badge text; cid uuid; inserted int; extra_msg text := '';
  base text := case when p_egg like 'lettre_%' then 'lettre' else p_egg end;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_egg is null or p_egg !~ '^(konami|logo|humane|jeu404|heure_gang|anniversaire|console|lettre_[1-7]|secousse|nuit|rembobine)$' then
    raise exception 'Secret inconnu';
  end if;
  -- Conditions vérifiées côté serveur (heure et date de Zurich).
  if p_egg = 'heure_gang' and to_char(z, 'HH24:MI') not in ('13:36', '13:37', '13:38') then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'nuit' and extract(hour from z) <> 3 then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'anniversaire' and coalesce(cfg->>'anniversaire_gang', '') <> to_char(z, 'MM-DD') then raise exception 'Ce n''est pas le bon jour'; end if;
  if p_egg = 'jeu404' and coalesce((p_extra->>'score')::int, 0) < 1 then raise exception 'Attrape au moins une paillette'; end if;
  per := case p_egg when 'jeu404' then to_char(z, 'YYYY-MM-DD') when 'secousse' then to_char(z, 'YYYY-MM')
                    when 'anniversaire' then to_char(z, 'YYYY') else 'once' end;
  gain := case when base = 'lettre' then 0 else coalesce((cfg#>>array['recompenses', p_egg])::int,
            case p_egg when 'jeu404' then 5 when 'heure_gang' then 13 else 25 end) end;

  insert into hg_egg_log (user_id, egg, period, reward) values (me, p_egg, per, gain) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('new', false, 'reward', 0, 'found', hg_eggs_count(me),
      'message', case when per = 'once' then 'Tu avais déjà trouvé ce secret.' else 'Déjà trouvé pour cette fois-ci. Reviens plus tard !' end);
  end if;

  if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:' || p_egg || ':' || per); end if;

  if p_egg = 'konami' then
    insert into hg_user_badges (user_id, badge_code) values (me, 'initie') on conflict do nothing; badge := 'Initié';
  elsif p_egg = 'logo' then
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Le Curieux';
    if cid is not null then perform hg_card_give(me, cid, false, 'evenement'); card_name := 'Le Curieux'; end if;
  elsif p_egg = 'anniversaire' then
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Gâteau du gang';
    if cid is not null then perform hg_card_give(me, cid, random() < 0.1, 'evenement'); card_name := 'Gâteau du gang'; end if;
  elsif p_egg = 'secousse' then
    insert into hg_wallets (user_id) values (me) on conflict do nothing;
    update hg_wallets set gift_boosters = coalesce(gift_boosters, 0) + 1, updated_at = now() where user_id = me;
    extra_msg := ' Un booster offert t''attend sur la page Cartes.';
  elsif base = 'lettre' then
    if (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') = 7 then
      insert into hg_user_badges (user_id, badge_code) values (me, 'chasseur_secrets') on conflict do nothing; badge := 'Chasseur de secrets';
      insert into hg_egg_log (user_id, egg, period, reward)
        values (me, 'lettres', 'once', coalesce((cfg#>>'{recompenses,lettres}')::int, 200)) on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        gain := coalesce((cfg#>>'{recompenses,lettres}')::int, 200);
        if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:lettres'); end if;
        extra_msg := ' Tu as réuni les 7 lettres : « ' || coalesce(cfg->>'mot_secret', 'SECRETS') || ' » !';
      end if;
    else
      extra_msg := ' Lettre ' || (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') || ' sur 7.';
    end if;
  end if;

  if per = 'once' and base <> 'lettre' then
    insert into hg_activity (user_id, kind, text)
      select me, 'secret', p.pseudo || ' a trouvé un secret caché sur le site…' from hg_profiles p where p.id = me and not p.is_ghost;
  end if;

  msg := case p_egg
    when 'konami' then 'Code secret accepté. Bienvenue parmi les initiés !'
    when 'logo' then 'Tu es curieux… La carte « Le Curieux » rejoint ta collection.'
    when 'humane' then 'Le gang en couleurs !'
    when 'jeu404' then 'Bien joué ! Une partie par jour est récompensée.'
    when 'heure_gang' then 'Il est 13 h 37. Tu connais l''heure du gang.'
    when 'anniversaire' then 'Joyeux anniversaire au gang ! Une part de gâteau pour toi.'
    when 'console' then 'Tu as résolu l''énigme de la console. Respect.'
    when 'secousse' then 'Ça secoue !'
    when 'nuit' then 'Toi aussi tu ne dors pas ? La chouette te salue.'
    when 'rembobine' then 'Rembobinage complet. Les souvenirs repartent du début.'
    else 'Tu as trouvé une lettre cachée.' end || extra_msg;
  return jsonb_build_object('new', true, 'reward', gain, 'message', msg, 'card', card_name, 'badge', badge, 'found', hg_eggs_count(me));
end $$;
revoke execute on function public.hg_egg_found(text, jsonb) from public, anon;
grant execute on function public.hg_egg_found(text, jsonb) to authenticated;

-- Secrets déjà trouvés par le membre connecté : { found, total: 12, eggs: [{ egg, first }], letters }.
create or replace function public.hg_eggs_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('found', hg_eggs_count(auth.uid()), 'total', 12,
    'eggs', coalesce((select jsonb_agg(jsonb_build_object('egg', egg, 'first', first) order by first)
      from (select egg, min(found_at) first from hg_egg_log where user_id = auth.uid() group by egg) z), '[]'::jsonb),
    'letters', (select count(distinct egg) from hg_egg_log where user_id = auth.uid() and egg like 'lettre_%'));
end $$;
revoke execute on function public.hg_eggs_me() from public, anon;
grant execute on function public.hg_eggs_me() to authenticated;

-- Question bonus secrète : hg_quiz_list et hg_quiz_answer remplacées (versions de 061 + filtre « secret »).
create or replace function public.hg_quiz_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare unlocked boolean := hg_eggs_count(auth.uid()) >= 3;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', q.id, 'prompt', q.prompt, 'type', q.qtype, 'difficulty', q.difficulty, 'category', q.category,
        'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb)
                    from jsonb_array_elements(q.options) o),
        'image_url', q.image_url, 'reward', q.reward, 'starts_at', q.starts_at, 'ends_at', q.ends_at, 'secret', q.secret,
        'answered', a.id is not null,
        'my_response', a.response, 'correct', a.is_correct, 'earned', coalesce(a.reward, 0), 'answered_at', a.answered_at,
        'explanation', case when a.id is not null then q.explanation end,
        'solution', case when a.id is not null and a.is_correct is not null then
          case q.qtype when 'texte' then k.answer->'accepted' when 'nombre' then k.answer->'value' else k.answer->'correct' end end)
      order by (a.id is not null), q.secret desc, q.starts_at desc)
    from hg_quiz_questions q
    left join hg_quiz_keys k on k.question_id = q.id
    left join hg_quiz_answers a on a.question_id = q.id and a.user_id = auth.uid()
    where q.active and q.starts_at <= now() and (a.id is not null or q.ends_at is null or q.ends_at > now())
      and (not q.secret or unlocked or a.id is not null)
  ), '[]'::jsonb);
end $$;
revoke execute on function public.hg_quiz_list() from public, anon;
grant execute on function public.hg_quiz_list() to authenticated;

create or replace function public.hg_quiz_answer(p_question uuid, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q hg_quiz_questions; k jsonb; ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into q from hg_quiz_questions where id = p_question;
  if not found or not q.active or q.starts_at > now() or (q.ends_at is not null and q.ends_at <= now())
     or (q.secret and hg_eggs_count(me) < 3) then
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

-- Réglage admin du champ « secret », appelé après hg_quiz_save.
create or replace function public.hg_quiz_set_secret(p_id uuid, p_secret boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  update hg_quiz_questions set secret = coalesce(p_secret, false), updated_at = now() where id = p_id;
end $$;
revoke execute on function public.hg_quiz_set_secret(uuid, boolean) from public, anon;
grant execute on function public.hg_quiz_set_secret(uuid, boolean) to authenticated;
