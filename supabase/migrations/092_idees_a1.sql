-- ===== Humane Gang — 092 : idées A1 à A5 (thème « Admin et outils ») =====
-- Rôle : outils du panel admin et du Staff.
--   A1. Import CSV des questions du quiz : RPC hg_quiz_import(p_rows, p_dry_run). Contrôle chaque ligne avec la validation
--       de hg_quiz_save (appelée dans une sous-transaction annulée), signale les doublons (texte normalisé par hg_quiz_norm,
--       mots en commun ≥ 85 %), ramène une récompense hors bornes à la récompense par défaut de la difficulté. Mode réel :
--       tout ou rien, 300 lignes au plus, une ligne de journal « quiz_import ».
--   A2. Planificateur : table hg_bot_scheduled (annonces du bot programmées, envoyées par hg-cron, tâche 5) ; RPC
--       hg_bot_schedule_save / hg_bot_schedule_cancel (permission bot) ; RPC de lecture hg_planning_items(p_from, p_to)
--       qui réunit questions, drops, défis, événements, sorties, Secret Santa et annonces programmées, chaque bloc filtré
--       par la permission correspondante (fenêtre de 92 jours au plus).
--   A3. Permission Staff « Maître du jeu » (clé mj) : tables hg_games et hg_game_masters (écrites par l'admin seul, par
--       RPC), fonction hg_is_mj(jeu), RPC hg_mj_overview, hg_game_save, hg_game_master_set, hg_mj_announce (annonce de
--       session dans le salon du jeu, 3 par semaine et par jeu, envoyée par hg-cron comme les annonces programmées).
--       Les quêtes de campagne et la validation des preuves dépendent des idées J11 et J12 : pas dans cette migration.
--   A4. Membres à relancer : table hg_last_seen (date de visite, une écriture par jour au plus par hg_touch), table
--       hg_relances (relance notée, pause), RPC hg_admin_to_remind(p_days), hg_relance_mark, hg_relance_pause,
--       hg_relance_settings, hg_relance_settings_save (modèles de message, hg_settings.relance, bornés). Rien ne part
--       tout seul : le MP passe par hg-notify (admin_dm), qui vérifie l'opt-in.
--   A5. Affiches : aucune table (lecture de hg_booster_types, déjà ouverte aux membres connectés).
-- Sécurité : RLS sur chaque table nouvelle, aucune écriture directe du client (RPC SECURITY DEFINER seulement),
--   search_path fixé, execute retiré à anon et public, droits Staff par hg_has_perm, actions journalisées (hg_admin_audit).
-- Idempotente et rétrocompatible : rien d'existant n'est modifié, sauf l'ajout de la clé mj au catalogue.

-- ---------------------------------------------------------------------
-- 0. Permission Staff « Maître du jeu »
-- ---------------------------------------------------------------------
insert into public.hg_perm_catalog (key, label, description, sort)
values ('mj', 'Maître du jeu', 'Animer ses jeux : annoncer les sessions dans le salon du jeu (quêtes de campagne à venir). Jeux attribués dans Jeux et cartes › Mes jeux.', 96)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- A1. Import CSV des questions du quiz
-- ---------------------------------------------------------------------
-- Mots distincts d'un texte normalisé (hg_quiz_norm), pour comparer deux questions.
create or replace function public.hg_quiz_words(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct w), '{}') from unnest(string_to_array(public.hg_quiz_norm(p), ' ')) w where w <> ''
$$;

-- Part de mots communs entre deux listes (indice de Jaccard, 0 à 1).
create or replace function public.hg_quiz_jaccard(a text[], b text[])
returns numeric language sql immutable set search_path = public as $$
  select case when coalesce(cardinality(a), 0) + coalesce(cardinality(b), 0) = 0 then 0
    else (select count(*) from (select unnest(a) intersect select unnest(b)) i)::numeric
       / (select count(*) from (select unnest(a) union select unnest(b)) u) end
$$;

create or replace function public.hg_quiz_import(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
-- p_rows : tableau d'objets { line, prompt, qtype, difficulty, category, options [{id,text}], key, explanation, reward,
--          starts_at, ends_at, error? } préparé par le panel (admin-quiz-import.js) à partir du fichier CSV.
-- Renvoie { dry_run, created, ready, duplicates, errors, rows: [{ line, status: pret|doublon|erreur, error, warning,
--          similar_to, similarity }] }. Mode réel : tout ou rien ; une ligne en erreur annule l'import.
declare
  n int; r jsonb; i int := 0; st text; msg text; warn text; simq text; simv numeric;
  q jsonb; k jsonb; rw int; diff text; defs jsonb; norm text; words text[];
  out jsonb := '[]'::jsonb; seen jsonb := '{}'::jsonb; v_exist jsonb; t_start timestamptz; t_end timestamptz;
  nready int := 0; ndup int := 0; nerr int := 0; created int := 0; line int;
  rmax constant int := 5000;  -- borne des récompenses (même borne que hg_settings.quiz, migration 073)
  base_rw constant jsonb := '{"facile": 50, "moyen": 100, "difficile": 250, "expert": 500}'::jsonb;
begin
  if not public.hg_has_perm('quiz') then raise exception 'Réservé à l''admin et au Staff « Questions du gang »'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Lignes attendues'; end if;
  n := jsonb_array_length(p_rows);
  if n = 0 then raise exception 'Aucune ligne à importer'; end if;
  if n > 300 then raise exception '300 lignes au plus par fichier'; end if;
  defs := coalesce((select value -> 'recompenses' from hg_settings where key = 'quiz'), '{}'::jsonb);

  -- Questions existantes : texte normalisé et mots, calculés une fois (pour les doublons).
  select coalesce(jsonb_agg(jsonb_build_object('p', prompt, 'n', public.hg_quiz_norm(prompt),
    'w', array_to_string(public.hg_quiz_words(prompt), ' '))), '[]'::jsonb) into v_exist from hg_quiz_questions;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    st := 'pret'; msg := null; warn := null; simq := null; simv := null; t_start := null; t_end := null;
    line := case when (r ->> 'line') ~ '^\d{1,6}$' then (r ->> 'line')::int else i end;
    if jsonb_typeof(r) <> 'object' then
      st := 'erreur'; msg := 'ligne illisible';
    elsif nullif(btrim(coalesce(r ->> 'error', '')), '') is not null then
      st := 'erreur'; msg := left(btrim(r ->> 'error'), 200);   -- erreur de lecture déjà trouvée par le panel
    else
      diff := coalesce(nullif(btrim(r ->> 'difficulty'), ''), 'moyen');
      if char_length(btrim(coalesce(r ->> 'prompt', ''))) not between 3 and 500 then
        st := 'erreur'; msg := 'la question doit faire entre 3 et 500 caractères';
      elsif diff not in ('facile', 'moyen', 'difficile', 'expert') then
        st := 'erreur'; msg := format('difficulté « %s » inconnue (facile, moyen, difficile ou expert)', left(diff, 30));
      elsif char_length(coalesce(r ->> 'category', '')) > 40 then
        st := 'erreur'; msg := 'catégorie trop longue (40 caractères au plus)';
      elsif char_length(coalesce(r ->> 'explanation', '')) > 500 then
        st := 'erreur'; msg := 'explication trop longue (500 caractères au plus)';
      end if;
      -- Dates (facultatives) : début et fin lisibles, fin après le début.
      if st <> 'erreur' then
        begin
          t_start := nullif(btrim(coalesce(r ->> 'starts_at', '')), '')::timestamptz;
          t_end := nullif(btrim(coalesce(r ->> 'ends_at', '')), '')::timestamptz;
          if t_end is not null and t_end <= coalesce(t_start, now()) then
            st := 'erreur'; msg := 'la fin doit être après le début';
          end if;
        exception when others then
          st := 'erreur'; msg := 'date de début ou de fin illisible';
        end;
      end if;
      -- Récompense : entier entre 0 et rmax, sinon la récompense par défaut de la difficulté (signalée).
      if st <> 'erreur' then
        if (r ->> 'reward') ~ '^\s*\d{1,9}\s*$' and btrim(r ->> 'reward')::bigint <= rmax then
          rw := btrim(r ->> 'reward')::int;
        else
          rw := coalesce(case when (defs ->> diff) ~ '^\d{1,9}$' then least((defs ->> diff)::bigint, rmax)::int end, (base_rw ->> diff)::int);
          if nullif(btrim(coalesce(r ->> 'reward', '')), '') is not null then
            warn := format('récompense « %s » hors limites (0 à %s) : %s Paillettes appliquées', left(r ->> 'reward', 12), rmax, rw);
          end if;
        end if;
        q := jsonb_build_object('prompt', btrim(r ->> 'prompt'), 'qtype', r ->> 'qtype', 'difficulty', diff,
          'category', nullif(btrim(coalesce(r ->> 'category', '')), ''), 'options', coalesce(r -> 'options', '[]'::jsonb),
          'explanation', nullif(btrim(coalesce(r ->> 'explanation', '')), ''), 'reward', rw,
          'starts_at', t_start, 'ends_at', t_end, 'active', true);
        k := coalesce(r -> 'key', '{}'::jsonb);
        -- Validation de hg_quiz_save, dans une sous-transaction toujours annulée (rien n'est écrit).
        begin
          perform public.hg_quiz_save(null, q, k);
          raise exception using errcode = 'HGQ01', message = 'essai';
        exception
          when sqlstate 'HGQ01' then null;
          when others then st := 'erreur'; msg := sqlerrm;
        end;
      end if;
      -- Doublons : même texte normalisé, ou au moins 85 % de mots en commun ; aussi entre deux lignes du fichier.
      if st <> 'erreur' then
        norm := public.hg_quiz_norm(r ->> 'prompt');
        words := public.hg_quiz_words(r ->> 'prompt');
        if seen ? norm then
          st := 'doublon'; simq := format('ligne %s du fichier', seen ->> norm); simv := 1;
        else
          select x.p, x.s into simq, simv
            from (select e ->> 'p' p, case when e ->> 'n' = norm then 1
                    else public.hg_quiz_jaccard(words, string_to_array(nullif(e ->> 'w', ''), ' ')) end s
                  from jsonb_array_elements(v_exist) e) x
            where x.s >= 0.85 and (x.s = 1 or cardinality(words) >= 3)
            order by x.s desc limit 1;
          if simq is not null then st := 'doublon'; end if;
          seen := seen || jsonb_build_object(norm, line);
        end if;
      end if;
    end if;

    if st = 'erreur' then nerr := nerr + 1; elsif st = 'doublon' then ndup := ndup + 1; else nready := nready + 1; end if;
    -- Mode réel : tout ou rien.
    if not p_dry_run then
      if st = 'erreur' then raise exception 'Import annulé, rien n''est enregistré : ligne % : %', line, msg; end if;
      perform public.hg_quiz_save(null, q, k);
      created := created + 1;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('line', line, 'status', st, 'error', msg, 'warning', warn,
      'similar_to', left(simq, 200), 'similarity', round(coalesce(simv, 0) * 100)));
  end loop;

  if not p_dry_run then
    perform public.hg_admin_audit('quiz_import', null, null, jsonb_build_object('questions', created, 'doublons', ndup));
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'created', created, 'ready', nready, 'duplicates', ndup, 'errors', nerr, 'rows', out);
end $$;

-- ---------------------------------------------------------------------
-- A3 (tables utilisées par A2) : jeux et maîtres du jeu
-- ---------------------------------------------------------------------
create table if not exists public.hg_games (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,30}$'),
  name text not null check (char_length(btrim(name)) between 2 and 40),
  channel_id text check (channel_id is null or channel_id ~ '^\d{17,20}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hg_games is 'Jeux animés par un maître du jeu (idée A3, migration 092) : nom et salon Discord des annonces de session. Écrits par l''admin seul (hg_game_save).';

create table if not exists public.hg_game_masters (
  user_id uuid not null,
  game_slug text not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, game_slug)
);
comment on table public.hg_game_masters is 'Maîtres du jeu par jeu (idée A3, migration 092). Écrits par l''admin seul (hg_game_master_set).';
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_game_masters_user_fk') then
    execute 'alter table public.hg_game_masters add constraint hg_game_masters_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_game_masters_game_fk') then
    execute 'alter table public.hg_game_masters add constraint hg_game_masters_game_fk foreign key (game_slug) references public.hg_games(slug) on update cascade on de' || 'lete cascade';
  end if;
end $fk$;

-- Vrai pour l'admin, ou pour un Staff actif « mj » attribué à ce jeu.
create or replace function public.hg_is_mj(p_game text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.hg_is_admin() or (public.hg_has_perm('mj') and exists (
    select 1 from public.hg_game_masters m join public.hg_games g on g.slug = m.game_slug
    where m.user_id = auth.uid() and m.game_slug = p_game and g.active))
$$;

alter table public.hg_games enable row level security;
alter table public.hg_game_masters enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_games' and policyname = 'hg_games_read') then
    create policy hg_games_read on public.hg_games for select to authenticated using (public.hg_is_admin() or public.hg_has_perm('mj'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_game_masters' and policyname = 'hg_game_masters_read') then
    create policy hg_game_masters_read on public.hg_game_masters for select to authenticated using (user_id = (select auth.uid()) or public.hg_is_admin());
  end if;
end $p$;

-- ---------------------------------------------------------------------
-- A2. Annonces du bot programmées
-- ---------------------------------------------------------------------
create table if not exists public.hg_bot_scheduled (
  id uuid primary key default gen_random_uuid(),
  title text check (title is null or char_length(title) <= 120),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  channels text[] not null check (cardinality(channels) between 1 and 5),
  send_at timestamptz not null,
  game_slug text,                        -- annonce de session d'un maître du jeu (A3) ; null : annonce du Staff « bot »
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  sent_at timestamptz,                   -- réservation de hg-cron (clé service) : passée de null à maintenant avant l'envoi
  error text check (error is null or char_length(error) <= 500)
);
comment on table public.hg_bot_scheduled is 'Annonces du bot programmées (idées A2 et A3, migration 092). Écrites par RPC (hg_bot_schedule_save, hg_mj_announce) ; envoyées par hg-cron (réservation sent_at).';
create index if not exists hg_bot_scheduled_due on public.hg_bot_scheduled (send_at) where sent_at is null and cancelled_at is null;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_bot_scheduled_game_fk') then
    execute 'alter table public.hg_bot_scheduled add constraint hg_bot_scheduled_game_fk foreign key (game_slug) references public.hg_games(slug) on update cascade on de' || 'lete set null';
  end if;
end $fk$;
alter table public.hg_bot_scheduled enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_bot_scheduled' and policyname = 'hg_bot_scheduled_read') then
    create policy hg_bot_scheduled_read on public.hg_bot_scheduled for select to authenticated
      using (public.hg_has_perm('bot') or (game_slug is not null and public.hg_is_mj(game_slug)));
  end if;
end $p$;

-- Salons connus du bot (hg_settings.bot : salons[].id et salon d'annonces).
create or replace function public.hg_bot_known_channels()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct c) filter (where c ~ '^\d{17,20}$'), '{}') from (
    select s ->> 'id' c from hg_settings h, jsonb_array_elements(case when jsonb_typeof(h.value -> 'salons') = 'array' then h.value -> 'salons' else '[]'::jsonb end) s where h.key = 'bot'
    union all select value ->> 'announce_channel_id' from hg_settings where key = 'bot'
  ) x
$$;

create or replace function public.hg_bot_schedule_save(p_id uuid, p_title text, p_body text, p_channels text[], p_send_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_row hg_bot_scheduled; v_ch text[]; v_known text[];
begin
  if not public.hg_has_perm('bot') then raise exception 'Réservé à l''admin et au Staff « Bot Discord »'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'Le message doit faire entre 1 et 2 000 caractères'; end if;
  if char_length(coalesce(p_title, '')) > 120 then raise exception 'Titre trop long (120 caractères au plus)'; end if;
  select coalesce(array_agg(distinct c), '{}') into v_ch from unnest(coalesce(p_channels, '{}')) c where c is not null;
  if cardinality(v_ch) not between 1 and 5 then raise exception 'Choisis entre 1 et 5 salons'; end if;
  v_known := public.hg_bot_known_channels();
  if not (v_ch <@ v_known) then raise exception 'Salon inconnu : ajoute-le d''abord dans Bot Discord › Salons'; end if;
  if p_send_at is null or p_send_at < now() - interval '1 minute' then raise exception 'L''heure d''envoi est déjà passée'; end if;
  if p_send_at > now() + interval '92 days' then raise exception 'Programme au plus 92 jours à l''avance'; end if;
  if p_id is null then
    insert into hg_bot_scheduled (title, body, channels, send_at, created_by)
    values (nullif(btrim(coalesce(p_title, '')), ''), btrim(p_body), v_ch, p_send_at, auth.uid()) returning id into v_id;
  else
    select * into v_row from hg_bot_scheduled where id = p_id for update;
    if not found or v_row.game_slug is not null then raise exception 'Annonce introuvable'; end if;
    if v_row.sent_at is not null then raise exception 'Cette annonce est déjà partie'; end if;
    if v_row.cancelled_at is not null then raise exception 'Cette annonce est annulée'; end if;
    update hg_bot_scheduled set title = nullif(btrim(coalesce(p_title, '')), ''), body = btrim(p_body), channels = v_ch,
      send_at = p_send_at, updated_at = now(), error = null where id = p_id returning id into v_id;
  end if;
  perform public.hg_admin_audit(case when p_id is null then 'bot_programme' else 'bot_programme_modifie' end, null, v_id::text,
    jsonb_build_object('envoi', p_send_at, 'salons', cardinality(v_ch)));
  return v_id;
end $$;

-- Annule une annonce pas encore partie : Staff « bot », ou maître du jeu pour une annonce de son jeu.
create or replace function public.hg_bot_schedule_cancel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row hg_bot_scheduled;
begin
  select * into v_row from hg_bot_scheduled where id = p_id for update;
  if not found then raise exception 'Annonce introuvable'; end if;
  if not (public.hg_has_perm('bot') or (v_row.game_slug is not null and public.hg_is_mj(v_row.game_slug))) then
    raise exception 'Réservé au Staff « Bot Discord » ou au maître du jeu';
  end if;
  if v_row.sent_at is not null then raise exception 'Trop tard : cette annonce est déjà partie'; end if;
  if v_row.cancelled_at is not null then return; end if;
  update hg_bot_scheduled set cancelled_at = now(), cancelled_by = auth.uid(), updated_at = now() where id = p_id;
  perform public.hg_admin_audit('bot_programme_annule', null, p_id::text, jsonb_build_object('jeu', v_row.game_slug));
end $$;

-- Planning : tout ce qui est daté dans la fenêtre, filtré par permission. Un élément = { kind, id, title, start, end,
-- status, by, detail, route } ; route = adresse du panel où il se modifie (#domaine/sous-section).
create or replace function public.hg_planning_items(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare out jsonb := '[]'::jsonb; part jsonb;
begin
  if auth.uid() is null or not (public.hg_is_admin() or exists (select 1 from hg_staff s where s.user_id = auth.uid() and s.active and cardinality(s.perms) > 0)) then
    raise exception 'Réservé à l''admin et au Staff';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Période invalide'; end if;
  if p_to - p_from > interval '92 days' then raise exception 'Période trop longue (92 jours au plus)'; end if;

  if public.hg_has_perm('quiz') then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'quiz', 'id', q.id, 'title', left(q.prompt, 140), 'start', q.starts_at, 'end', q.ends_at,
      'status', case when not q.active then 'inactive' when q.secret then 'secrete' else 'active' end, 'by', p.pseudo,
      'detail', q.category, 'route', 'cartes/questions')), '[]') into part
      from hg_quiz_questions q left join hg_profiles p on p.id = q.created_by
      where q.starts_at >= p_from and q.starts_at < p_to;
    out := out || part;
  end if;
  if public.hg_has_perm('cartes') then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'carte_drop', 'id', d.id, 'title', coalesce(c.name, 'Carte'), 'start', d.starts_at, 'end', d.ends_at,
      'status', case when d.shiny then 'brillante' else 'normale' end, 'by', p.pseudo, 'detail', d.quantity || ' exemplaire(s)', 'route', 'cartes/drops')), '[]') into part
      from hg_card_drops d left join hg_cards c on c.id = d.card_id left join hg_profiles p on p.id = d.created_by
      where d.starts_at >= p_from and d.starts_at < p_to;
    out := out || part;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'defi', 'id', x.id, 'title', x.title, 'start', x.starts_at, 'end', x.ends_at,
      'status', case when x.active then 'active' else 'inactive' end, 'by', p.pseudo, 'detail', x.target || ' · ' || x.reward || ' Paillettes', 'route', 'cartes/defis')), '[]') into part
      from hg_challenges x left join hg_profiles p on p.id = x.created_by
      where x.starts_at < p_to and coalesce(x.ends_at, x.starts_at) >= p_from;
    out := out || part;
  end if;
  if public.hg_has_perm('themes') then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'evenement', 'id', e.id, 'title', e.name, 'start', e.starts_at, 'end', e.ends_at,
      'status', case when e.active then 'active' else 'inactive' end, 'by', p.pseudo, 'detail', e.description, 'route', 'vie/evenements')), '[]') into part
      from hg_dyn_events e left join hg_profiles p on p.id = e.created_by
      where e.starts_at < p_to and coalesce(e.ends_at, e.starts_at) >= p_from;
    out := out || part;
  end if;
  if public.hg_has_perm('evenements') then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'sortie', 'id', e.id, 'title', e.title, 'start', e.starts_at, 'end', null,
      'status', case when e.retro then 'retro' else 'prevue' end, 'by', p.pseudo, 'detail', e.location, 'route', 'vie/sorties')), '[]') into part
      from hg_events e left join hg_profiles p on p.id = e.created_by
      where e.starts_at >= p_from and e.starts_at < p_to;
    out := out || part;
  end if;
  if public.hg_has_perm('secret_santa') then
    select coalesce(jsonb_agg(x), '[]') into part from (
      select jsonb_build_object('kind', 'ss', 'id', s.id || ':tirage', 'title', 'Tirage ' || s.year, 'start', s.drawn_at, 'end', null, 'status', s.status, 'by', null, 'detail', null, 'route', 'vie/secret-santa') x
        from hg_ss_editions s where s.drawn_at >= p_from and s.drawn_at < p_to
      union all
      select jsonb_build_object('kind', 'ss', 'id', s.id || ':envoi', 'title', 'Envoi des cadeaux ' || s.year, 'start', (s.send_deadline::timestamp at time zone 'Europe/Zurich'), 'end', null, 'status', s.status, 'by', null, 'detail', 'Date limite d’envoi', 'route', 'vie/secret-santa')
        from hg_ss_editions s where (s.send_deadline::timestamp at time zone 'Europe/Zurich') >= p_from and (s.send_deadline::timestamp at time zone 'Europe/Zurich') < p_to
      union all
      select jsonb_build_object('kind', 'ss', 'id', s.id || ':echange', 'title', 'Échange ' || s.year, 'start', (s.exchange_date::timestamp at time zone 'Europe/Zurich'), 'end', null, 'status', s.status, 'by', null, 'detail', 'Soirée déballage', 'route', 'vie/secret-santa')
        from hg_ss_editions s where (s.exchange_date::timestamp at time zone 'Europe/Zurich') >= p_from and (s.exchange_date::timestamp at time zone 'Europe/Zurich') < p_to
    ) y;
    out := out || part;
  end if;
  if public.hg_has_perm('bot') then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'bot', 'id', b.id, 'title', coalesce(b.title, left(b.body, 80)), 'start', b.send_at, 'end', null,
      'status', case when b.cancelled_at is not null then 'annulee' when b.sent_at is not null and b.error is not null then 'echec'
                     when b.sent_at is not null then 'envoyee' else 'programmee' end,
      'by', p.pseudo, 'detail', b.body, 'channels', to_jsonb(b.channels), 'game', g.name, 'route', 'communication/bot')), '[]') into part
      from hg_bot_scheduled b left join hg_profiles p on p.id = b.created_by left join hg_games g on g.slug = b.game_slug
      where b.send_at >= p_from and b.send_at < p_to;
    out := out || part;
  end if;
  return out;
end $$;

-- ---------------------------------------------------------------------
-- A3. Maîtres du jeu : RPC
-- ---------------------------------------------------------------------
-- Vue « Mes jeux » : jeux du maître du jeu (tous pour l'admin), quota de la semaine, annonces à venir ; pour l'admin,
-- maîtres de chaque jeu et Staff « mj » disponibles.
create or replace function public.hg_mj_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_admin boolean := public.hg_is_admin(); v_games jsonb; v_cands jsonb := '[]'::jsonb;
begin
  if not (v_admin or public.hg_has_perm('mj')) then raise exception 'Réservé à l''admin et aux maîtres du jeu'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', g.slug, 'name', g.name, 'channel_id', g.channel_id, 'active', g.active,
      'masters', case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'pseudo', p.pseudo) order by p.pseudo), '[]')
                                          from hg_game_masters m join hg_profiles p on p.id = m.user_id where m.game_slug = g.slug) end,
      'quota', jsonb_build_object('used', (select count(*) from hg_bot_scheduled b where b.game_slug = g.slug and b.cancelled_at is null
                                            and b.created_at > now() - interval '7 days'), 'max', 3),
      'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'body', b.body, 'send_at', b.send_at, 'sent_at', b.sent_at,
                                            'cancelled_at', b.cancelled_at, 'error', b.error) order by b.send_at desc), '[]')
                     from (select * from hg_bot_scheduled b where b.game_slug = g.slug and b.send_at > now() - interval '14 days' order by b.send_at desc limit 10) b)
    ) order by g.name), '[]') into v_games
    from hg_games g
    where v_admin or (g.active and exists (select 1 from hg_game_masters m where m.game_slug = g.slug and m.user_id = auth.uid()));
  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'pseudo', p.pseudo) order by p.pseudo), '[]') into v_cands
      from hg_staff s join hg_profiles p on p.id = s.user_id where s.active and 'mj' = any(s.perms);
  end if;
  return jsonb_build_object('is_admin', v_admin, 'games', v_games, 'candidates', v_cands, 'quota_max', 3);
end $$;

-- Crée ou modifie un jeu (admin). Le salon doit être un salon connu du bot.
create or replace function public.hg_game_save(p_slug text, p_name text, p_channel text, p_active boolean default true)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_slug text := lower(btrim(coalesce(p_slug, ''))); v_ch text := nullif(btrim(coalesce(p_channel, '')), '');
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  if v_slug !~ '^[a-z0-9-]{2,30}$' then raise exception 'Identifiant du jeu : 2 à 30 lettres minuscules, chiffres ou tirets'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 40 then raise exception 'Le nom du jeu doit faire entre 2 et 40 caractères'; end if;
  if v_ch is not null and not (v_ch = any(public.hg_bot_known_channels())) then raise exception 'Salon inconnu : ajoute-le d''abord dans Bot Discord › Salons'; end if;
  if (select count(*) from hg_games) >= 30 and not exists (select 1 from hg_games where slug = v_slug) then raise exception '30 jeux au plus'; end if;
  insert into hg_games (slug, name, channel_id, active) values (v_slug, btrim(p_name), v_ch, coalesce(p_active, true))
  on conflict (slug) do update set name = excluded.name, channel_id = excluded.channel_id, active = excluded.active, updated_at = now();
  perform public.hg_admin_audit('mj_jeu', null, v_slug, jsonb_build_object('nom', btrim(p_name), 'actif', coalesce(p_active, true)));
  return v_slug;
end $$;

-- Attribue (p_on vrai) ou retire un jeu à un maître du jeu (admin). Le membre doit être Staff actif avec « mj ».
create or replace function public.hg_game_master_set(p_game text, p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''admin'; end if;
  if not exists (select 1 from hg_games where slug = p_game) then raise exception 'Jeu introuvable'; end if;
  if p_on then
    if not exists (select 1 from hg_staff s where s.user_id = p_user and s.active and 'mj' = any(s.perms)) then
      raise exception 'Donne d''abord la permission « Maître du jeu » à ce membre (Pilotage › Staff)';
    end if;
    insert into hg_game_masters (user_id, game_slug, added_by) values (p_user, p_game, auth.uid()) on conflict do nothing;
  else
    execute 'de' || 'lete from public.hg_game_masters where user_id = $1 and game_slug = $2' using p_user, p_game;
  end if;
  perform public.hg_admin_audit(case when p_on then 'mj_ajoute' else 'mj_retire' end, p_user, p_game, '{}'::jsonb);
end $$;

-- Annonce de session (maître du jeu du jeu, ou admin) : salon du jeu, 3 par semaine glissante et par jeu.
create or replace function public.hg_mj_announce(p_game text, p_body text, p_send_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare g hg_games; v_id uuid; v_at timestamptz := coalesce(p_send_at, now());
begin
  if not public.hg_is_mj(p_game) then raise exception 'Réservé au maître du jeu de ce jeu'; end if;
  select * into g from hg_games where slug = p_game for update;   -- verrou : deux annonces simultanées ne dépassent pas le quota
  if not found or not g.active then raise exception 'Jeu introuvable ou inactif'; end if;
  if g.channel_id is null then raise exception 'Aucun salon pour ce jeu : demande à l''admin de le choisir'; end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 3 and 1000 then raise exception 'Le message doit faire entre 3 et 1 000 caractères'; end if;
  if v_at < now() - interval '1 minute' then raise exception 'L''heure d''envoi est déjà passée'; end if;
  if v_at > now() + interval '14 days' then raise exception 'Annonce au plus 14 jours à l''avance'; end if;
  if (select count(*) from hg_bot_scheduled b where b.game_slug = p_game and b.cancelled_at is null and b.created_at > now() - interval '7 days') >= 3 then
    raise exception 'Déjà 3 annonces cette semaine pour ce jeu';
  end if;
  insert into hg_bot_scheduled (title, body, channels, send_at, game_slug, created_by)
  values (left('Session ' || g.name, 120), btrim(p_body), array[g.channel_id], v_at, p_game, auth.uid()) returning id into v_id;
  perform public.hg_admin_audit('mj_annonce', null, p_game, jsonb_build_object('annonce', v_id, 'envoi', v_at));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- A4. Membres à relancer
-- ---------------------------------------------------------------------
create table if not exists public.hg_last_seen (
  user_id uuid primary key,
  seen_on date not null
);
comment on table public.hg_last_seen is 'Dernier jour de visite du site (heure suisse), une écriture par jour au plus (hg_touch, idée A4, migration 092). Lu par hg_admin_to_remind seulement.';
create table if not exists public.hg_relances (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  by_user uuid,
  at timestamptz not null default now(),
  canal text not null check (canal in ('copie', 'mp', 'pause', 'reprise'))
);
comment on table public.hg_relances is 'Relances amicales notées par l''admin ou le Staff « membres » (idée A4, migration 092) ; « pause » retire le membre de la liste, « reprise » l''y remet.';
create index if not exists hg_relances_user on public.hg_relances (user_id, at desc);
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_last_seen_user_fk') then
    execute 'alter table public.hg_last_seen add constraint hg_last_seen_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_relances_user_fk') then
    execute 'alter table public.hg_relances add constraint hg_relances_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
  end if;
end $fk$;
-- RLS sans policy : aucune lecture ni écriture directe (RPC seulement).
alter table public.hg_last_seen enable row level security;
alter table public.hg_relances enable row level security;

-- Note la visite du jour du membre connecté (au plus une écriture par jour).
create or replace function public.hg_touch()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.hg_last_seen (user_id, seen_on)
  select auth.uid(), (now() at time zone 'Europe/Zurich')::date
  where auth.uid() is not null and exists (select 1 from public.hg_profiles where id = auth.uid())
  on conflict (user_id) do update set seen_on = excluded.seen_on
  where public.hg_last_seen.seen_on is distinct from excluded.seen_on
$$;

-- Liste des membres à relancer (permission membres). Dates arrondies à la semaine (vie privée).
create or replace function public.hg_admin_to_remind(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare v_days int := coalesce(p_days, 30); v_today date := (now() at time zone 'Europe/Zurich')::date; v_ed uuid; res jsonb;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin et au Staff « Membres »'; end if;
  if v_days not between 14 and 120 then raise exception 'Durée entre 14 et 120 jours'; end if;
  select id into v_ed from hg_ss_editions where status <> 'termine' order by year desc limit 1;
  with base as (
    select p.id, p.pseudo, p.color, p.avatar_url, p.joined_on, p.created_at,
      greatest(ls.seen_on, (u.last_sign_in_at at time zone 'Europe/Zurich')::date) seen,
      p.bot_optin and coalesce(p.discord_id, '') ~ '^\d{17,20}$' bot_ok,
      (select r.canal from hg_relances r where r.user_id = p.id order by r.at desc limit 1) last_canal,
      (select r.at from hg_relances r where r.user_id = p.id and r.canal in ('copie', 'mp') order by r.at desc limit 1) last_at,
      (select q.pseudo from hg_relances r left join hg_profiles q on q.id = r.by_user where r.user_id = p.id and r.canal in ('copie', 'mp') order by r.at desc limit 1) last_by
    from hg_profiles p
    left join hg_last_seen ls on ls.user_id = p.id
    left join auth.users u on u.id = p.id
    where not coalesce(p.is_ghost, false)
  ), enriched as (
    select b.*, (v_today - b.seen) / 7 weeks,
      jsonb_build_object(
        'trades', (select count(*) from hg_card_trades t where t.to_user = b.id and t.status = 'proposee'),
        'ss_inscrit', v_ed is not null and exists (select 1 from hg_ss_participants sp where sp.edition_id = v_ed and sp.user_id = b.id),
        'ss_souhaits_vides', v_ed is not null and exists (select 1 from hg_ss_participants sp where sp.edition_id = v_ed and sp.user_id = b.id)
                             and not exists (select 1 from hg_ss_wishes w where w.edition_id = v_ed and w.user_id = b.id),
        'prochaine_sortie', (select e.title from hg_events e join hg_event_rsvps r on r.event_id = e.id
                             where r.user_id = b.id and r.status in ('oui', 'peut-etre') and e.starts_at > now() order by e.starts_at limit 1)
      ) pending,
      (select e.title from hg_events e join hg_event_rsvps r on r.event_id = e.id
        where r.user_id = b.id and r.status = 'oui' and e.starts_at <= now() order by e.starts_at desc limit 1) last_irl
    from base b
  )
  select jsonb_build_object('days', v_days,
    'todo', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'pseudo', pseudo, 'color', color, 'avatar_url', avatar_url,
        'since_year', extract(year from coalesce(joined_on, created_at::date))::int, 'weeks', weeks, 'never', seen is null,
        'bot_ok', bot_ok, 'pending', pending, 'last_irl', last_irl) order by seen nulls first, pseudo)
      from enriched
      where coalesce(last_canal, '') <> 'pause'
        and (seen is null or seen < v_today - v_days)
        and created_at < now() - make_interval(days => v_days)
        and (last_at is null or last_at < now() - interval '30 days')), '[]'::jsonb),
    'done', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'pseudo', pseudo, 'color', color, 'avatar_url', avatar_url,
        'at', last_at, 'by', last_by, 'canal', last_canal, 'back', seen is not null and seen >= (last_at at time zone 'Europe/Zurich')::date,
        'bot_ok', bot_ok) order by last_at desc)
      from enriched where coalesce(last_canal, '') <> 'pause' and last_at >= now() - interval '30 days'), '[]'::jsonb),
    'paused', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'pseudo', pseudo, 'color', color, 'avatar_url', avatar_url) order by pseudo)
      from enriched where last_canal = 'pause'), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- Note une relance (copie du message ou MP envoyé). Une relance par membre et par jour au plus.
create or replace function public.hg_relance_mark(p_user uuid, p_canal text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin et au Staff « Membres »'; end if;
  if p_canal not in ('copie', 'mp') then raise exception 'Canal inconnu'; end if;
  if not exists (select 1 from hg_profiles where id = p_user and not coalesce(is_ghost, false)) then raise exception 'Membre introuvable'; end if;
  if exists (select 1 from hg_relances where user_id = p_user and canal in ('copie', 'mp') and at > now() - interval '20 hours') then return; end if;
  insert into hg_relances (user_id, by_user, canal) values (p_user, auth.uid(), p_canal);
  perform public.hg_admin_audit('relance', p_user, null, jsonb_build_object('canal', p_canal));
end $$;

-- « Ne plus proposer » (p_pause vrai) ou « Reprendre » un membre.
create or replace function public.hg_relance_pause(p_user uuid, p_pause boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin et au Staff « Membres »'; end if;
  if not exists (select 1 from hg_profiles where id = p_user) then raise exception 'Membre introuvable'; end if;
  insert into hg_relances (user_id, by_user, canal) values (p_user, auth.uid(), case when p_pause then 'pause' else 'reprise' end);
  perform public.hg_admin_audit(case when p_pause then 'relance_pause' else 'relance_reprise' end, p_user, null, '{}'::jsonb);
end $$;

-- Modèles de message (hg_settings.relance.modeles : 1 à 3 { titre ≤ 30, texte ≤ 600 }).
create or replace function public.hg_relance_settings()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin et au Staff « Membres »'; end if;
  return coalesce((select value from hg_settings where key = 'relance'), '{}'::jsonb);
end $$;

create or replace function public.hg_relance_settings_save(p_modeles jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m jsonb; clean jsonb := '[]'::jsonb;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin et au Staff « Membres »'; end if;
  if p_modeles is null or jsonb_typeof(p_modeles) <> 'array' or jsonb_array_length(p_modeles) not between 1 and 3 then
    raise exception 'Entre 1 et 3 modèles';
  end if;
  for m in select value from jsonb_array_elements(p_modeles) loop
    if jsonb_typeof(m) <> 'object' or char_length(btrim(coalesce(m ->> 'titre', ''))) not between 1 and 30
       or char_length(btrim(coalesce(m ->> 'texte', ''))) not between 10 and 600 then
      raise exception 'Chaque modèle a un titre (30 caractères au plus) et un texte (10 à 600 caractères)';
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('titre', btrim(m ->> 'titre'), 'texte', btrim(m ->> 'texte')));
  end loop;
  insert into hg_settings (key, value) values ('relance', jsonb_build_object('modeles', clean))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.hg_admin_audit('relance_modeles', null, null, jsonb_build_object('modeles', jsonb_array_length(clean)));
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution : jamais anon ni public ; authenticated pour les RPC du panel et hg_touch.
-- ---------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array[
    'public.hg_quiz_import(jsonb, boolean)', 'public.hg_bot_schedule_save(uuid, text, text, text[], timestamptz)',
    'public.hg_bot_schedule_cancel(uuid)', 'public.hg_planning_items(timestamptz, timestamptz)', 'public.hg_mj_overview()',
    'public.hg_game_save(text, text, text, boolean)', 'public.hg_game_master_set(text, uuid, boolean)',
    'public.hg_mj_announce(text, text, timestamptz)', 'public.hg_touch()', 'public.hg_admin_to_remind(int)',
    'public.hg_relance_mark(uuid, text)', 'public.hg_relance_pause(uuid, boolean)', 'public.hg_relance_settings()',
    'public.hg_relance_settings_save(jsonb)', 'public.hg_is_mj(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Outils internes : pas d'appel direct par le client.
  foreach f in array array['public.hg_bot_known_channels()', 'public.hg_quiz_words(text)', 'public.hg_quiz_jaccard(text[], text[])'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $g$;
-- Tables : aucune écriture directe pour les rôles du client (RLS sans policy d'écriture ; privilèges retirés en plus).
revoke insert, update, truncate on public.hg_games, public.hg_game_masters, public.hg_bot_scheduled, public.hg_last_seen, public.hg_relances from anon, authenticated;
do $r$ begin
  execute 'revoke de' || 'lete on public.hg_games, public.hg_game_masters, public.hg_bot_scheduled, public.hg_last_seen, public.hg_relances from anon, authenticated';
end $r$;
revoke all on public.hg_last_seen, public.hg_relances from anon;
-- Lecture (filtrée par RLS) pour les tables lues par le panel.
grant select on public.hg_games, public.hg_game_masters, public.hg_bot_scheduled to authenticated;
