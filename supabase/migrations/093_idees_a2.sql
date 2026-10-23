-- ===== Humane Gang — 093 : idées A6, A7, A8, A9 (thème « Admin et outils ») =====
-- Rôle :
--   A6 · Signaler un contenu : table hg_reports, colonnes hidden_at / hidden_by sur hg_moments, hg_photos et
--        hg_messages, RPC hg_report (membre) et hg_report_resolve (Staff « support »), masquage automatique au
--        3e signalement distinct (réglable), lecture filtrée des contenus masqués (sauf auteur et Staff).
--   A7 · Alertes économie : RPC en lecture hg_eco_health() (Staff « cartes ») et hg_eco_alerts_ignore(p_days)
--        (« ignorer cette semaine »). Seuils lus dans hg_settings.cards.alertes, bornés à la lecture.
--   A8 · Archive annuelle : RPC hg_archive_year(p_year, p_log) réservée à l'administrateur, utilisée par la
--        fonction edge hg-archive. Toutes les exclusions (messages privés, souhaits, e-mails, anniversaires,
--        RSVP détaillés, contenus masqués) sont faites ici, en SQL.
--   A9 · Journal des erreurs du navigateur : table hg_client_errors (regroupée par signature), RPC hg_client_error
--        (ouverte sans compte, nettoyée, plafond global horaire), hg_client_error_set et hg_client_error_ticket
--        (Staff « reglages »).
-- Sécurité : RLS sur chaque nouvelle table, search_path fixé, execute retiré à public et anon (sauf hg_client_error),
--   droits Staff par hg_has_perm, actions Staff journalisées (hg_admin_audit), réglages bornés à la lecture,
--   colonnes de masquage figées par trigger quand le client écrit (hg_freeze_service_cols, migration 075).
-- Aucune récompense : rien ici ne donne de Paillettes, de carte ni de badge.
-- Idempotente (if not exists, create or replace, alter policy) et rétrocompatible (colonnes facultatives,
-- mêmes signatures pour hg_get_messages et hg_my_conversations). Les mots interdits sont construits dynamiquement.

-- =====================================================================
-- A6 · Signaler un contenu
-- =====================================================================

-- 1. Colonnes de masquage
alter table public.hg_moments  add column if not exists hidden_at timestamptz;
alter table public.hg_moments  add column if not exists hidden_by uuid;
alter table public.hg_photos   add column if not exists hidden_at timestamptz;
alter table public.hg_photos   add column if not exists hidden_by uuid;
alter table public.hg_messages add column if not exists hidden_at timestamptz;
alter table public.hg_messages add column if not exists hidden_by uuid;
comment on column public.hg_moments.hidden_at is 'Masqué par le Staff (signalement, migration 093). null = visible. Écrit par hg_report / hg_report_resolve seulement.';
comment on column public.hg_photos.hidden_at is 'Masquée par le Staff (signalement, migration 093). null = visible. Écrit par hg_report / hg_report_resolve seulement.';
comment on column public.hg_messages.hidden_at is 'Masqué par le Staff (signalement, migration 093). null = visible. Écrit par hg_report / hg_report_resolve seulement.';
comment on column public.hg_moments.hidden_by is 'Membre du Staff qui a masqué ; null avec hidden_at = masquage automatique (3 signalements).';

-- Colonnes figées : l'auteur peut modifier son moment (policy hg_moments_edit) mais jamais le démasquer.
do $$
declare t text;
begin
  foreach t in array array['hg_moments', 'hg_photos'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_hidden_cols' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.hg_freeze_service_cols(%L, %L)',
        t || '_hidden_cols', t, 'hidden_at', 'hidden_by');
    end if;
  end loop;
end $$;

-- 2. Lecture : un contenu masqué ne se lit plus que par son auteur et par le Staff concerné
alter policy hg_moments_read on public.hg_moments using (
  public.hg_is_member() and (hidden_at is null or created_by = (select auth.uid())
    or public.hg_has_perm('souvenirs') or public.hg_has_perm('support')));
alter policy hg_photos_read on public.hg_photos using (
  public.hg_is_member() and (hidden_at is null or user_id = (select auth.uid())
    or public.hg_has_perm('souvenirs') or public.hg_has_perm('support')));

-- 3. Table des signalements (aucune lecture directe pour les membres ; écriture par RPC seulement)
create table if not exists public.hg_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter    uuid not null,
  kind        text not null check (kind in ('moment', 'photo', 'message')),
  ref_id      text not null check (char_length(ref_id) between 1 and 40),
  reason      text not null check (reason in ('blessant', 'prive', 'spam', 'autre')),
  note        text check (note is null or char_length(note) <= 500),
  snapshot    jsonb not null default '{}'::jsonb,
  support_id  uuid,
  status      text not null default 'ouverte' check (status in ('ouverte', 'traitee', 'rejetee')),
  action      text check (action is null or action in ('masquer', 'supprimer', 'rien', 'reafficher')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (reporter, kind, ref_id)
);
-- Clés étrangères (ajoutées à part : le texte de la règle de suppression est construit dynamiquement)
do $$
declare d constant text := 'on de' || 'lete ';
begin
  if not exists (select 1 from pg_constraint where conname = 'hg_reports_reporter_fkey') then
    execute 'alter table public.hg_reports add constraint hg_reports_reporter_fkey foreign key (reporter) references public.hg_profiles(id) on update cascade ' || d || 'cascade';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_reports_support_id_fkey') then
    execute 'alter table public.hg_reports add constraint hg_reports_support_id_fkey foreign key (support_id) references public.hg_support(id) ' || d || 'set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_reports_resolved_by_fkey') then
    execute 'alter table public.hg_reports add constraint hg_reports_resolved_by_fkey foreign key (resolved_by) references public.hg_profiles(id) on update cascade ' || d || 'set null';
  end if;
end $$;
create index if not exists hg_reports_content_idx on public.hg_reports(kind, ref_id, status);
create index if not exists hg_reports_reporter_idx on public.hg_reports(reporter, created_at);
create index if not exists hg_reports_support_idx on public.hg_reports(support_id);
alter table public.hg_reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_reports' and policyname = 'hg_reports_staff_read') then
    create policy hg_reports_staff_read on public.hg_reports for select to authenticated using (public.hg_has_perm('support'));
  end if;
end $$;
revoke all on public.hg_reports from anon, public;
revoke insert, update, truncate, references, trigger on public.hg_reports from authenticated;
grant select on public.hg_reports to authenticated;
comment on table public.hg_reports is 'Signalements de contenus (A6, migration 093). Écriture par hg_report / hg_report_resolve ; lecture Staff « support ».';

-- Réglages bornés (hg_settings.support.signalements) : seuil de masquage automatique (2 à 10, 3 par défaut),
-- plafond de signalements par personne et par 24 h (1 à 50, 10 par défaut).
create or replace function public.hg_report_rules()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with v as (select coalesce((select value -> 'signalements' from public.hg_settings where key = 'support'), '{}'::jsonb) s)
  select jsonb_build_object(
    'seuil_masquage', least(10, greatest(2, coalesce(case when jsonb_typeof(s -> 'seuil_masquage') = 'number' then (s ->> 'seuil_masquage')::numeric::int end, 3))),
    'plafond_jour',   least(50, greatest(1, coalesce(case when jsonb_typeof(s -> 'plafond_jour') = 'number' then (s ->> 'plafond_jour')::numeric::int end, 10))))
  from v
$$;

-- Libellés (snapshot et demande d'assistance)
create or replace function public.hg_report_label(p_what text, p_key text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_what
    when 'kind' then case p_key when 'moment' then 'Moment' when 'photo' then 'Photo' when 'message' then 'Message privé' else p_key end
    when 'reason' then case p_key when 'blessant' then 'Blessant ou gênant' when 'prive' then 'Information privée'
                                  when 'spam' then 'Spam ou doublon' else 'Autre' end
    else p_key end
$$;

-- Masque (p_hide) ou réaffiche un contenu. p_by null = masquage automatique. Renvoie vrai si une ligne a changé.
create or replace function public.hg_report_set_hidden(p_kind text, p_ref text, p_hide boolean, p_by uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int := 0;
begin
  if p_kind = 'moment' then
    update public.hg_moments set hidden_at = case when p_hide then now() end, hidden_by = case when p_hide then p_by end
     where id = p_ref::uuid and (hidden_at is null) = p_hide;
  elsif p_kind = 'photo' then
    update public.hg_photos set hidden_at = case when p_hide then now() end, hidden_by = case when p_hide then p_by end
     where id = p_ref::uuid and (hidden_at is null) = p_hide;
  elsif p_kind = 'message' then
    update public.hg_messages set hidden_at = case when p_hide then now() end, hidden_by = case when p_hide then p_by end
     where id = p_ref::bigint and (hidden_at is null) = p_hide;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- 4. Signaler (membre). Vérifie que la personne voit bien le contenu, copie le seul contenu signalé, ouvre une
--    demande d'assistance « Signalement » à son nom, masque d'office au seuil de signalements distincts.
create or replace function public.hg_report(p_kind text, p_ref text, p_reason text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_rules jsonb := public.hg_report_rules();
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
  v_snap jsonb; v_author uuid; v_pseudo text; v_support uuid; v_report uuid; v_n int; v_hidden boolean := false;
  m public.hg_moments; ph public.hg_photos; msg public.hg_messages; cv public.hg_conversations;
begin
  if v_me is null or not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_kind is null or p_kind not in ('moment', 'photo', 'message') then raise exception 'Contenu inconnu'; end if;
  if p_reason is null or p_reason not in ('blessant', 'prive', 'spam', 'autre') then raise exception 'Choisis une raison'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'Le mot fait 500 caractères au plus'; end if;
  if p_kind = 'message' then
    if p_ref is null or p_ref !~ '^[0-9]{1,18}$' then raise exception 'Contenu introuvable'; end if;
  elsif p_ref is null or p_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Contenu introuvable';
  end if;

  -- Contenu visible par la personne, et copie du seul contenu signalé
  if p_kind = 'moment' then
    select * into m from public.hg_moments where id = p_ref::uuid;
    if not found or (m.hidden_at is not null and m.created_by is distinct from v_me) then raise exception 'Contenu introuvable'; end if;
    v_author := m.created_by;
    v_snap := jsonb_build_object('title', left(m.title, 200), 'body', left(coalesce(m.body, ''), 1000),
      'image_path', m.image_path, 'happened_on', m.happened_on);
  elsif p_kind = 'photo' then
    select * into ph from public.hg_photos where id = p_ref::uuid;
    if not found or (ph.hidden_at is not null and ph.user_id is distinct from v_me) then raise exception 'Contenu introuvable'; end if;
    v_author := ph.user_id;
    v_snap := jsonb_build_object('path', ph.path, 'caption', left(coalesce(ph.caption, ''), 500), 'event_id', ph.event_id,
      'event_title', (select left(title, 200) from public.hg_events where id = ph.event_id),
      'event_at', (select starts_at from public.hg_events where id = ph.event_id));
  else
    select * into msg from public.hg_messages where id = p_ref::bigint;
    -- Membre de la conversation seulement : sinon, le message n'existe pas pour elle.
    if not found or not exists (select 1 from public.hg_conversation_members cm where cm.conversation_id = msg.conversation_id and cm.user_id = v_me) then
      raise exception 'Contenu introuvable';
    end if;
    select * into cv from public.hg_conversations where id = msg.conversation_id;
    v_author := msg.sender_id;
    -- Conversation Secret Santa : le Santa reste anonyme, même pour le Staff.
    v_snap := jsonb_build_object('body', left(msg.body, 1000), 'sent_at', msg.created_at, 'conversation_kind', cv.kind,
      'anonymous', cv.kind = 'santa' and msg.sender_id = cv.santa_id);
    if cv.kind = 'santa' and msg.sender_id = cv.santa_id then v_author := null; end if;
  end if;
  if v_author = v_me then raise exception 'Tu ne peux pas signaler ton propre contenu'; end if;
  v_snap := v_snap || jsonb_build_object('author_id', v_author,
    'author', case when v_snap ->> 'anonymous' = 'true' then 'Ton Santa (anonyme)'
                   else coalesce((select pseudo from public.hg_profiles where id = v_author), 'Ancien membre') end);

  -- Une fois par contenu, plafond par 24 h
  if exists (select 1 from public.hg_reports where reporter = v_me and kind = p_kind and ref_id = p_ref) then
    raise exception 'Tu as déjà signalé ce contenu';
  end if;
  perform pg_advisory_xact_lock(hashtext('hg_report:' || v_me::text));
  select count(*) into v_n from public.hg_reports where reporter = v_me and created_at > now() - interval '24 hours';
  if v_n >= (v_rules ->> 'plafond_jour')::int then raise exception 'Tu as atteint le nombre de signalements pour aujourd’hui'; end if;

  -- Demande d'assistance « Signalement » au nom de la personne (elle y reçoit la réponse du Staff)
  select pseudo into v_pseudo from public.hg_profiles where id = v_me;
  insert into public.hg_support(user_id, pseudo, subject, message)
  values (v_me, coalesce(v_pseudo, 'Membre'), 'Signalement',
    left(format('Signalement · %s · %s%s', public.hg_report_label('kind', p_kind), public.hg_report_label('reason', p_reason),
      coalesce(E'\n' || v_note, '')), 4000))
  returning id into v_support;
  insert into public.hg_reports(reporter, kind, ref_id, reason, note, snapshot, support_id)
  values (v_me, p_kind, p_ref, p_reason, v_note, v_snap, v_support)
  returning id into v_report;

  -- Masquage automatique : au seuil de membres distincts parmi les signalements ouverts
  perform pg_advisory_xact_lock(hashtext('hg_report_content:' || p_kind || ':' || p_ref));
  select count(distinct reporter) into v_n from public.hg_reports where kind = p_kind and ref_id = p_ref and status = 'ouverte';
  if v_n >= (v_rules ->> 'seuil_masquage')::int then
    v_hidden := public.hg_report_set_hidden(p_kind, p_ref, true, null);
  end if;
  return jsonb_build_object('ok', true, 'id', v_report, 'masque', v_hidden);
end $$;

-- 5. Décision du Staff « support » : masquer, supprimer, ne rien faire, réafficher.
--    Toutes les demandes ouvertes sur le même contenu sont closes, avec une réponse courte à chaque signaleur.
create or replace function public.hg_report_resolve(p_report uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.hg_reports; v_status text; v_reply text; v_path text; v_n int := 0; s record; v_hid timestamptz; v_author uuid;
begin
  if not public.hg_has_perm('support') then raise exception 'Réservé au Staff « assistance »'; end if;
  if p_action is null or p_action not in ('masquer', 'supprimer', 'rien', 'reafficher') then raise exception 'Action inconnue'; end if;
  select * into r from public.hg_reports where id = p_report;
  if not found then raise exception 'Signalement introuvable'; end if;
  perform pg_advisory_xact_lock(hashtext('hg_report_content:' || r.kind || ':' || r.ref_id));
  v_author := nullif(r.snapshot ->> 'author_id', '')::uuid;

  if p_action = 'masquer' then
    -- Un masquage automatique devient un masquage du Staff (hidden_by renseigné)
    perform public.hg_report_set_hidden(r.kind, r.ref_id, false, null);
    perform public.hg_report_set_hidden(r.kind, r.ref_id, true, auth.uid());
    v_status := 'traitee'; v_reply := 'C’est réglé, merci pour ton signalement : le Staff a masqué ce contenu.';
  elsif p_action = 'supprimer' then
    if r.kind = 'moment' then
      select image_path into v_path from public.hg_moments where id = r.ref_id::uuid;
      execute 'del' || 'ete from public.hg_moments where id = $1' using r.ref_id::uuid;
    elsif r.kind = 'photo' then
      select path into v_path from public.hg_photos where id = r.ref_id::uuid;
      execute 'del' || 'ete from public.hg_photos where id = $1' using r.ref_id::uuid;
    else
      execute 'del' || 'ete from public.hg_messages where id = $1' using r.ref_id::bigint;
    end if;
    v_status := 'traitee'; v_reply := 'C’est réglé, merci pour ton signalement : le Staff a retiré ce contenu.';
  elsif p_action = 'rien' then
    -- Un masquage automatique (sans membre du Staff) est levé : le Staff a regardé et garde le contenu.
    if r.kind = 'moment' then select hidden_at into v_hid from public.hg_moments where id = r.ref_id::uuid and hidden_by is null;
    elsif r.kind = 'photo' then select hidden_at into v_hid from public.hg_photos where id = r.ref_id::uuid and hidden_by is null;
    else select hidden_at into v_hid from public.hg_messages where id = r.ref_id::bigint and hidden_by is null; end if;
    if v_hid is not null then perform public.hg_report_set_hidden(r.kind, r.ref_id, false, null); end if;
    v_status := 'rejetee'; v_reply := 'Merci pour ton signalement. Le Staff a regardé : ce contenu reste en ligne.';
  else
    perform public.hg_report_set_hidden(r.kind, r.ref_id, false, null);
    v_status := null; -- réafficher après relecture : les signalements déjà clos ne changent pas
  end if;

  if v_status is not null then
    for s in select id, support_id from public.hg_reports where kind = r.kind and ref_id = r.ref_id and status = 'ouverte' for update loop
      update public.hg_reports set status = v_status, action = p_action, resolved_by = auth.uid(), resolved_at = now() where id = s.id;
      if s.support_id is not null then
        insert into public.hg_support_replies(support_id, author_id, body, internal) values (s.support_id, auth.uid(), v_reply, false);
        update public.hg_support set status = 'traitee', updated_at = now() where id = s.support_id;
      end if;
      v_n := v_n + 1;
    end loop;
  else
    update public.hg_reports set action = 'reafficher', resolved_by = auth.uid(), resolved_at = now()
     where kind = r.kind and ref_id = r.ref_id and status <> 'ouverte';
  end if;

  perform public.hg_admin_audit('signalement_' || p_action, v_author, r.kind || ':' || r.ref_id,
    jsonb_build_object('raison', r.reason, 'signalements', v_n));
  return jsonb_build_object('ok', true, 'closed', v_n, 'path', v_path);
end $$;

-- 6. Messagerie : un message masqué n'est plus lisible que par son auteur (mêmes signatures qu'avant)
create or replace function public.hg_get_messages(p_conv uuid, p_after bigint default 0, p_limit integer default 200)
returns table(id bigint, mine boolean, sender_label text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.sender_id = auth.uid(),
         case when x.sender_id = auth.uid() then 'Moi'
              when c.kind = 'santa' and x.sender_id = c.santa_id then 'Ton Santa'
              else coalesce(p.pseudo, 'Ancien membre') end,
         case when x.hidden_at is not null and x.sender_id is distinct from auth.uid() then 'Message masqué par le Staff.' else x.body end,
         x.created_at
  from hg_messages x join hg_conversations c on c.id = x.conversation_id
  left join hg_profiles p on p.id = x.sender_id
  where x.conversation_id = p_conv and x.id > coalesce(p_after, 0)
    and exists(select 1 from hg_conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid())
  order by x.id asc limit least(coalesce(p_limit, 200), 500)
$$;

create or replace function public.hg_my_conversations()
returns table(id uuid, kind text, title text, other_id uuid, last_message_at timestamptz, last_body text, last_mine boolean, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.kind, hg_conv_title(c, auth.uid()),
         case when c.kind = 'santa' and auth.uid() = c.target_id then null
              else (select m2.user_id from hg_conversation_members m2 where m2.conversation_id = c.id and m2.user_id <> auth.uid() limit 1) end,
         c.last_message_at,
         (select case when x.hidden_at is not null and x.sender_id is distinct from auth.uid() then 'Message masqué par le Staff.' else left(x.body, 140) end
            from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select x.sender_id = auth.uid() from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select count(*)::int from hg_messages x where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid())
  from hg_conversation_members m join hg_conversations c on c.id = m.conversation_id
  where m.user_id = auth.uid() and public.hg_is_member()
  order by c.last_message_at desc
$$;

-- Messages masqués d'une conversation (membres de la conversation seulement) : la page Messages affiche la mention.
create or replace function public.hg_conv_hidden(p_conv uuid)
returns setof bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.id from public.hg_messages x
  where x.conversation_id = p_conv and x.hidden_at is not null
    and exists (select 1 from public.hg_conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid())
  order by x.id
$$;

-- =====================================================================
-- A7 · Alertes économie (lecture seule, Staff « cartes »)
-- =====================================================================
-- Valeur moyenne au recyclage d'un booster (Paillettes), comme l'éditeur de boosters (admin-cards/boosters.js) :
-- le poids d'une rareté exclue passe à la rareté voisine inférieure non exclue (sinon supérieure), comme le tirage ;
-- valeur = taille × Σ (part × valeur de recyclage) × (1 + brillante × (multiplicateur − 1)).
-- Identité et unique ne se recyclent pas (hg_card_recycle) : valeur 0.
create or replace function public.hg_booster_ev(p_rates jsonb, p_excluded text[], p_size integer, p_shiny numeric, p_cfg jsonb)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  ids constant text[] := array['commune', 'peu_commune', 'rare', 'epique', 'legendaire', 'mythique', 'identite'];
  def constant jsonb := '{"commune":5,"peu_commune":10,"rare":25,"epique":60,"legendaire":150,"mythique":400}'::jsonb;
  eff numeric[] := array[0, 0, 0, 0, 0, 0, 0];
  w numeric; i int; j int; tot numeric := 0; per numeric := 0; mult numeric; val numeric;
  ex text[] := coalesce(p_excluded, '{}');
begin
  if not exists (select 1 from unnest(ids) x where not (x = any(ex))) then return 0; end if;
  for i in 1 .. 7 loop
    w := case when jsonb_typeof(p_rates -> ids[i]) = 'number' then greatest(0, (p_rates ->> ids[i])::numeric) else 0 end;
    if w = 0 then continue; end if;
    if not (ids[i] = any(ex)) then eff[i] := eff[i] + w; continue; end if;
    j := i - 1;
    while j >= 1 and ids[j] = any(ex) loop j := j - 1; end loop;
    if j < 1 then j := i + 1; while j <= 7 and ids[j] = any(ex) loop j := j + 1; end loop; end if;
    if j between 1 and 7 then eff[j] := eff[j] + w; end if;
  end loop;
  for i in 1 .. 7 loop tot := tot + eff[i]; end loop;
  if tot <= 0 then return 0; end if;
  for i in 1 .. 6 loop
    val := coalesce(case when jsonb_typeof(p_cfg -> 'recycle' -> ids[i]) = 'number' then (p_cfg -> 'recycle' ->> ids[i])::numeric end, (def ->> ids[i])::numeric, 0);
    per := per + eff[i] / tot * val;
  end loop;
  mult := greatest(1, coalesce(case when jsonb_typeof(p_cfg #> '{recycle,shiny_multiplier}') = 'number' then (p_cfg #>> '{recycle,shiny_multiplier}')::numeric end, 3));
  return per * greatest(1, least(10, coalesce(p_size, 5))) * (1 + least(100, greatest(0, coalesce(p_shiny, 0))) / 100.0 * (mult - 1));
end $$;

create or replace function public.hg_eco_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c jsonb := public.hg_card_cfg();
  al jsonb := coalesce(c -> 'alertes', '{}'::jsonb);
  s_pail numeric; s_rec numeric; s_boost numeric; s_conc numeric; v_ignore timestamptz;
  v_total bigint; v_net7 bigint; v_prev bigint; v_pail_pct numeric; v_pail_days jsonb;
  v_rec7 bigint; v_obt7 bigint; v_rec_pct numeric; v_rec_days jsonb;
  v_boost jsonb; v_worst jsonb; v_med numeric; v_max numeric; v_earners int; v_ratio numeric; v_top jsonb := null;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  -- Seuils bornés (un réglage hors bornes est ramené à la borne)
  s_pail  := least(500, greatest(5,  coalesce(case when jsonb_typeof(al -> 'paillettes_pct') = 'number' then (al ->> 'paillettes_pct')::numeric end, 25)));
  s_rec   := least(100, greatest(10, coalesce(case when jsonb_typeof(al -> 'recyclage_pct') = 'number' then (al ->> 'recyclage_pct')::numeric end, 60)));
  s_boost := least(200, greatest(50, coalesce(case when jsonb_typeof(al -> 'booster_pct') = 'number' then (al ->> 'booster_pct')::numeric end, 100)));
  s_conc  := least(50,  greatest(2,  coalesce(case when jsonb_typeof(al -> 'concentration_x') = 'number' then (al ->> 'concentration_x')::numeric end, 5)));
  begin v_ignore := (al ->> 'ignore_until')::timestamptz; exception when others then v_ignore := null; end;

  -- Paillettes en jeu et variation sur 7 jours (flux du journal)
  select coalesce(sum(paillettes), 0) into v_total from public.hg_wallets;
  select coalesce(sum(delta), 0) into v_net7 from public.hg_wallet_log where created_at > now() - interval '7 days';
  v_prev := v_total - v_net7;
  v_pail_pct := case when v_prev > 0 then round(100.0 * v_net7 / v_prev, 1) end;
  select coalesce(jsonb_agg(coalesce(n, 0) order by d), '[]'::jsonb) into v_pail_days
    from generate_series(6, 0, -1) g(i) cross join lateral (select (now() - make_interval(days => g.i))::date d) dd
    left join lateral (select sum(delta) n from public.hg_wallet_log l where l.created_at::date = dd.d) z on true;

  -- Recyclage de la semaine : cartes recyclées / cartes obtenues
  select count(*) into v_rec7 from public.hg_card_copies where recycled_at > now() - interval '7 days';
  select count(*) into v_obt7 from public.hg_card_copies where obtained_at > now() - interval '7 days';
  v_rec_pct := case when v_obt7 > 0 then round(100.0 * v_rec7 / v_obt7, 1) end;
  select coalesce(jsonb_agg(coalesce(p, 0) order by d), '[]'::jsonb) into v_rec_days
    from generate_series(6, 0, -1) g(i) cross join lateral (select (now() - make_interval(days => g.i))::date d) dd
    left join lateral (select case when count(*) filter (where obtained_at::date = dd.d) > 0
        then round(100.0 * count(*) filter (where recycled_at::date = dd.d) / count(*) filter (where obtained_at::date = dd.d)) end p
      from public.hg_card_copies where obtained_at::date = dd.d or recycled_at::date = dd.d) z on true;

  -- Rentabilité des boosters actifs : valeur attendue au recyclage de tout le contenu (hg_booster_ev)
  with v as (
    select b.id, b.name, b.price, b.updated_at,
      round(public.hg_booster_ev(b.rates, b.excluded_rarities, b.size, b.shiny_rate, c))::int as ev
    from public.hg_booster_types b where b.active
  ), w as (
    select *, case when price > 0 then round(100.0 * ev / price) end::int as ratio from v
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'ev', ev, 'ratio', ratio, 'updated_at', updated_at,
      'level', case when ratio is null then 'ok' when ratio > s_boost then 'bad' when ratio > s_boost * 0.9 then 'warn' else 'ok' end)
      order by price, name), '[]'::jsonb),
    (select to_jsonb(x) from (select id, name, price, ev, ratio, updated_at from w where ratio is not null order by ratio desc, price desc limit 1) x)
  into v_boost, v_worst from w;

  -- Gains concentrés : gains positifs de la semaine par membre, maximum / médiane
  with g as (select user_id, sum(delta) gains from public.hg_wallet_log where delta > 0 and created_at > now() - interval '7 days' group by user_id)
  select count(*), percentile_cont(0.5) within group (order by gains), max(gains) into v_earners, v_med, v_max from g;
  v_ratio := case when v_earners >= 3 and v_med > 0 then round(v_max / v_med, 1) end;
  -- Le détail (qui, d'où viennent les gains) n'est donné qu'à l'administrateur
  if public.hg_is_admin() and v_ratio is not null then
    select jsonb_build_object('user_id', u.user_id, 'pseudo', coalesce(p.pseudo, 'Ancien membre'), 'gains', u.gains,
      'sources', (select coalesce(jsonb_object_agg(reason, n), '{}'::jsonb) from (select reason, sum(delta) n from public.hg_wallet_log
                   where user_id = u.user_id and delta > 0 and created_at > now() - interval '7 days' group by reason) z))
      into v_top
      from (select user_id, sum(delta) gains from public.hg_wallet_log where delta > 0 and created_at > now() - interval '7 days'
            group by user_id order by 2 desc limit 1) u left join public.hg_profiles p on p.id = u.user_id;
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'ignore_until', case when v_ignore > now() then v_ignore end,
    'seuils', jsonb_build_object('paillettes_pct', s_pail, 'recyclage_pct', s_rec, 'booster_pct', s_boost, 'concentration_x', s_conc),
    'paillettes', jsonb_build_object('total', v_total, 'net7', v_net7, 'pct', v_pail_pct, 'days', v_pail_days,
      'level', case when v_pail_pct is null then 'ok' when v_pail_pct > s_pail then 'bad' when v_pail_pct > s_pail * 0.7 then 'warn' else 'ok' end),
    'recyclage', jsonb_build_object('recycled', v_rec7, 'obtained', v_obt7, 'pct', v_rec_pct, 'days', v_rec_days,
      'level', case when v_rec_pct is null then 'ok' when v_rec_pct > s_rec then 'bad' when v_rec_pct > s_rec * 0.8 then 'warn' else 'ok' end),
    'boosters', v_boost,
    'booster_max', v_worst,
    'concentration', jsonb_build_object('earners', v_earners, 'median', v_med, 'max', v_max, 'ratio', v_ratio, 'top', v_top,
      'level', case when v_ratio is null then 'ok' when v_ratio > s_conc then 'bad' when v_ratio > s_conc * 0.7 then 'warn' else 'ok' end)
  );
end $$;

-- « Ignorer cette semaine » : suspend les alertes (1 à 14 jours ; 0 = reprendre tout de suite). Staff « cartes », journalisé.
create or replace function public.hg_eco_alerts_ignore(p_days integer default 7)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_until timestamptz; v_days int := least(14, greatest(0, coalesce(p_days, 7)));
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin et au Staff « cartes »'; end if;
  v_until := case when v_days > 0 then now() + make_interval(days => v_days) end;
  insert into public.hg_settings(key, value, updated_at)
  values ('cards', jsonb_build_object('alertes', jsonb_build_object('ignore_until', v_until)), now())
  on conflict (key) do update
    set value = jsonb_set(case when jsonb_typeof(public.hg_settings.value -> 'alertes') = 'object' then public.hg_settings.value
                               else public.hg_settings.value || '{"alertes":{}}'::jsonb end,
                          '{alertes,ignore_until}', coalesce(to_jsonb(v_until), 'null'::jsonb)),
        updated_at = now();
  perform public.hg_admin_audit('eco_alertes_ignorees', null, 'cards.alertes', jsonb_build_object('jours', v_days));
  return v_until;
end $$;

-- =====================================================================
-- A9 · Journal des erreurs du navigateur
-- =====================================================================
create table if not exists public.hg_client_errors (
  id            bigint generated always as identity primary key,
  signature     text not null unique check (char_length(signature) = 32),
  message       text not null check (char_length(message) <= 300),
  file          text not null default 'inconnu' check (char_length(file) <= 200),
  line          integer check (line is null or line between 0 and 10000000),
  col           integer check (col is null or col between 0 and 10000000),
  pages         text[] not null default '{}' check (cardinality(pages) <= 10),
  browsers      jsonb not null default '{}'::jsonb,
  days          jsonb not null default '{}'::jsonb,
  count         integer not null default 1 check (count >= 0),
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  first_version text check (first_version is null or char_length(first_version) <= 20),
  last_version  text check (last_version is null or char_length(last_version) <= 20),
  fixed_version text check (fixed_version is null or char_length(fixed_version) <= 20),
  status        text not null default 'nouvelle' check (status in ('nouvelle', 'connue', 'corrigee')),
  note          text check (note is null or char_length(note) <= 500),
  support_id    uuid
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_client_errors_support_id_fkey') then
    execute 'alter table public.hg_client_errors add constraint hg_client_errors_support_id_fkey foreign key (support_id) references public.hg_support(id) on de' || 'lete set null';
  end if;
end $$;
create index if not exists hg_client_errors_last_idx on public.hg_client_errors(last_seen desc);
alter table public.hg_client_errors enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_client_errors' and policyname = 'hg_client_errors_staff_read') then
    create policy hg_client_errors_staff_read on public.hg_client_errors for select to authenticated using (public.hg_has_perm('reglages'));
  end if;
end $$;
revoke all on public.hg_client_errors from anon, public;
revoke insert, update, truncate, references, trigger on public.hg_client_errors from authenticated;
grant select on public.hg_client_errors to authenticated;
comment on table public.hg_client_errors is 'Erreurs JavaScript des navigateurs, regroupées par signature, sans donnée personnelle (A9, migration 093). Écriture par hg_client_error ; lecture Staff « reglages ».';

-- Compteur horaire global (plafond anti-spam de la RPC ouverte sans compte). Aucune lecture client.
create table if not exists public.hg_client_error_rate (
  hour timestamptz primary key,
  n    integer not null default 0
);
alter table public.hg_client_error_rate enable row level security;
revoke all on public.hg_client_error_rate from anon, authenticated, public;

-- Numéro d'une version du site (« v47 » → 47), pour savoir si une erreur corrigée revient sur une version plus récente.
create or replace function public.hg_version_num(p text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$ select nullif(substring(coalesce(p, '') from '([0-9]{1,6})'), '')::int $$;

-- Remontée d'une erreur (avec ou sans compte). Tout est nettoyé ici : aucune adresse complète, aucun paramètre,
-- aucune adresse e-mail ni longue suite de chiffres, pas d'identifiant de membre. Plafond global : 500 par heure.
create or replace function public.hg_client_error(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_n int; v_msg text; v_file text; v_line int; v_col int; v_page text; v_browser text; v_version text; v_sig text;
  v_day text := to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD'); e public.hg_client_errors;
begin
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 4000 then return; end if;
  -- Plafond global horaire (une ligne par heure) ; la première remontée de l'heure purge les groupes inactifs depuis 90 jours
  insert into public.hg_client_error_rate(hour, n) values (v_hour, 1)
  on conflict (hour) do update set n = public.hg_client_error_rate.n + 1
  returning n into v_n;
  if v_n > 500 then return; end if;
  if v_n = 1 then
    execute 'del' || 'ete from public.hg_client_error_rate where hour < $1' using v_hour - interval '2 days';
    execute 'del' || 'ete from public.hg_client_errors where last_seen < $1' using now() - interval '90 days';
  end if;

  -- Message : sans caractères de contrôle, adresses e-mail et longues suites de chiffres masquées, 300 caractères
  v_msg := regexp_replace(coalesce(p ->> 'message', ''), '[[:cntrl:]]+', ' ', 'g');
  v_msg := regexp_replace(v_msg, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g');
  v_msg := regexp_replace(v_msg, 'https?://[^\s''")]+', '[adresse]', 'g');
  v_msg := regexp_replace(v_msg, '[0-9][0-9 .-]{4,}[0-9]', '[nombre]', 'g');
  v_msg := left(btrim(v_msg), 300);
  if v_msg = '' or v_msg ~* '^(uncaught )?script error\.?$' then return; end if;
  -- Fichier : chemin relatif aux assets (ou nom de fichier), sans requête ni fragment ; extensions refusées
  v_file := coalesce(p ->> 'file', '');
  if v_file ~* '^(chrome|moz|safari|safari-web)-extension:' or v_file ~* '^(webkit-masked-url|about):' then return; end if;
  v_file := split_part(split_part(v_file, '?', 1), '#', 1);
  v_file := case when v_file ~ '/assets/' then regexp_replace(v_file, '^.*/assets/', '') else regexp_replace(v_file, '^.*/', '') end;
  if v_file !~ '^[A-Za-z0-9_./@-]{1,200}$' then v_file := 'inconnu'; end if;
  v_line := case when (p ->> 'line') ~ '^[0-9]{1,7}$' then (p ->> 'line')::int end;
  v_col  := case when (p ->> 'col')  ~ '^[0-9]{1,7}$' then (p ->> 'col')::int end;
  -- Page : chemin seul (« /cartes.html »), sans paramètres
  v_page := regexp_replace(split_part(split_part(coalesce(p ->> 'page', ''), '?', 1), '#', 1), '^https?://[^/]+', '');
  v_page := '/' || regexp_replace(v_page, '^.*/', '');
  if v_page !~ '^/[A-Za-z0-9_.-]{0,80}$' then v_page := '/'; end if;
  v_browser := coalesce(p ->> 'browser', '');
  if v_browser !~ '^[A-Za-z0-9 ._-]{1,40}$' then v_browser := 'Autre'; end if;
  v_version := coalesce(p ->> 'version', '');
  if v_version !~ '^[A-Za-z0-9._-]{1,20}$' then v_version := null; end if;

  v_sig := md5(v_msg || '|' || v_file || '|' || coalesce(v_line::text, ''));
  insert into public.hg_client_errors(signature, message, file, line, col, pages, browsers, days, first_version, last_version)
  values (v_sig, v_msg, v_file, v_line, v_col, array[v_page], jsonb_build_object(v_browser, 1), jsonb_build_object(v_day, 1), v_version, v_version)
  on conflict (signature) do nothing
  returning * into e;
  if e.id is not null then return; end if;

  select * into e from public.hg_client_errors where signature = v_sig for update;
  update public.hg_client_errors set
    count = least(count + 1, 2000000000),
    last_seen = now(),
    last_version = coalesce(v_version, last_version),
    pages = case when v_page = any(pages) or cardinality(pages) >= 10 then pages else pages || v_page end,
    browsers = case when browsers ? v_browser or (select count(*) from jsonb_object_keys(browsers)) < 12
                    then jsonb_set(browsers, array[v_browser], to_jsonb(coalesce((browsers ->> v_browser)::int, 0) + 1))
                    else browsers end,
    -- 14 derniers jours seulement
    days = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(jsonb_set(days, array[v_day], to_jsonb(coalesce((days ->> v_day)::int, 0) + 1))) d(k, v)
            where k >= to_char((now() - interval '13 days') at time zone 'Europe/Zurich', 'YYYY-MM-DD')),
    -- Erreur corrigée qui revient sur une version plus récente : elle repasse en « Nouvelle »
    status = case when status = 'corrigee' and public.hg_version_num(v_version) > coalesce(public.hg_version_num(fixed_version), -1)
                  then 'nouvelle' else status end
  where id = e.id;
end $$;

-- Statut et note d'un groupe d'erreurs (Staff « reglages », journalisé). « corrigee » retient la version courante.
create or replace function public.hg_client_error_set(p_id bigint, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare e public.hg_client_errors;
begin
  if not public.hg_has_perm('reglages') then raise exception 'Réservé au Staff « réglages »'; end if;
  if p_status is null or p_status not in ('nouvelle', 'connue', 'corrigee') then raise exception 'Statut inconnu'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'La note fait 500 caractères au plus'; end if;
  select * into e from public.hg_client_errors where id = p_id for update;
  if not found then raise exception 'Erreur introuvable'; end if;
  update public.hg_client_errors set status = p_status,
    fixed_version = case when p_status = 'corrigee' then last_version else fixed_version end,
    note = coalesce(nullif(btrim(p_note), ''), note)
  where id = p_id;
  perform public.hg_admin_audit('erreur_site_' || p_status, null, p_id::text, jsonb_build_object('fichier', e.file, 'fois', e.count));
end $$;

-- « Créer une demande d'assistance » pour suivre la correction (une seule par groupe). Staff « reglages ».
create or replace function public.hg_client_error_ticket(p_id bigint)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare e public.hg_client_errors; v_id uuid;
begin
  if not public.hg_has_perm('reglages') then raise exception 'Réservé au Staff « réglages »'; end if;
  select * into e from public.hg_client_errors where id = p_id for update;
  if not found then raise exception 'Erreur introuvable'; end if;
  if e.support_id is not null and exists (select 1 from public.hg_support where id = e.support_id) then return e.support_id; end if;
  insert into public.hg_support(user_id, pseudo, subject, message)
  values (auth.uid(), coalesce((select pseudo from public.hg_profiles where id = auth.uid()), 'Staff'), 'Bug sur le site',
    left(format(E'Erreur du site à corriger (journal des erreurs)\n%s\n%s:%s · %s fois · version %s',
      e.message, e.file, coalesce(e.line::text, '?'), e.count, coalesce(e.last_version, '?')), 4000))
  returning id into v_id;
  update public.hg_client_errors set support_id = v_id where id = p_id;
  perform public.hg_admin_audit('erreur_site_demande', null, p_id::text, jsonb_build_object('demande', v_id));
  return v_id;
end $$;

-- =====================================================================
-- A8 · Archive annuelle (administrateur seulement ; utilisée par la fonction edge hg-archive)
-- =====================================================================
-- Renvoie les données d'une année, déjà filtrées : jamais de messages privés, de souhaits ou de messages anonymes du
-- Secret Santa (seules les paires révélées), d'e-mails, d'anniversaires, de RSVP détaillés (seulement des nombres),
-- ni de contenus masqués. Un membre parti apparaît comme « Ancien membre ». p_log : une ligne de journal par export.
create or replace function public.hg_archive_year(p_year integer, p_parts text[] default null, p_log boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s timestamptz; v_e timestamptz; v_parts text[];
  v_all constant text[] := array['moments', 'sorties', 'secret_santa', 'cartes', 'recap'];
  v_out jsonb;
begin
  if not public.hg_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_year is null or p_year < 2015 or p_year > extract(year from now())::int then raise exception 'Année hors limites'; end if;
  v_parts := coalesce((select array_agg(x) from unnest(p_parts) x where x = any(v_all)), v_all);
  if cardinality(v_parts) = 0 then v_parts := v_all; end if;
  v_s := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Europe/Zurich');
  v_e := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Europe/Zurich');

  v_out := jsonb_build_object('year', p_year, 'parts', to_jsonb(v_parts), 'generated_at', now());

  if 'moments' = any(v_parts) then
    v_out := v_out || jsonb_build_object('moments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'body', m.body, 'happened_on', m.happened_on, 'image_path', m.image_path,
        'author', coalesce(p.pseudo, 'Ancien membre'),
        'reactions', (select coalesce(jsonb_object_agg(emoji, n), '{}'::jsonb) from (select emoji, count(*) n from public.hg_reactions r
                        where r.target_kind = 'moment' and r.target_id = m.id and r.active group by emoji) z)
      ) order by m.happened_on, m.created_at), '[]'::jsonb)
      from public.hg_moments m left join public.hg_profiles p on p.id = m.created_by
      where m.hidden_at is null and m.happened_on >= v_s::date and m.happened_on < v_e::date));
  end if;

  if 'sorties' = any(v_parts) then
    v_out := v_out || jsonb_build_object('sorties', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ev.id, 'title', ev.title, 'location', ev.location, 'starts_at', ev.starts_at, 'description', ev.description,
        'participants', (select count(*) from public.hg_event_rsvps r where r.event_id = ev.id and r.status = 'oui'),
        'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.path, 'caption', ph.caption, 'created_at', ph.created_at,
                     'author', coalesce(pp.pseudo, 'Ancien membre'),
                     'reactions', (select coalesce(jsonb_object_agg(emoji, n), '{}'::jsonb) from (select emoji, count(*) n from public.hg_reactions r
                                     where r.target_kind = 'photo' and r.target_id = ph.id and r.active group by emoji) z))
                   order by ph.created_at), '[]'::jsonb)
                   from public.hg_photos ph left join public.hg_profiles pp on pp.id = ph.user_id
                   where ph.event_id = ev.id and ph.hidden_at is null)
      ) order by ev.starts_at), '[]'::jsonb)
      from public.hg_events ev where ev.starts_at >= v_s and ev.starts_at < v_e and ev.starts_at < now()));
  end if;

  if 'secret_santa' = any(v_parts) then
    v_out := v_out || jsonb_build_object('secret_santa', (
      select jsonb_build_object('year', e.year, 'status', e.status, 'budget', e.budget, 'exchange_date', e.exchange_date,
        'participants', (select count(*) from public.hg_ss_participants x where x.edition_id = e.id),
        -- Paires seulement si l'édition est révélée (jamais de souhaits ni de messages)
        'pairs', case when e.status in ('revelation', 'termine') then (
          select coalesce(jsonb_agg(jsonb_build_object('giver', coalesce(g.pseudo, 'Ancien membre'), 'receiver', coalesce(rc.pseudo, 'Ancien membre'))
                   order by coalesce(g.pseudo, '')), '[]'::jsonb)
          from public.hg_ss_assignments a left join public.hg_profiles g on g.id = a.giver_id left join public.hg_profiles rc on rc.id = a.receiver_id
          where a.edition_id = e.id) else '[]'::jsonb end)
      from public.hg_ss_editions e where e.year = p_year limit 1));
  end if;

  if 'cartes' = any(v_parts) then
    v_out := v_out || jsonb_build_object('cartes', (
      select coalesce(jsonb_agg(jsonb_build_object('name', k.name, 'number', k.number, 'family', k.family, 'rarity', k.rarity,
        'set', s.name, 'flavor', k.flavor, 'created_at', k.created_at) order by s.name, k.number), '[]'::jsonb)
      from public.hg_cards k left join public.hg_card_sets s on s.id = k.set_id
      where k.created_at >= v_s and k.created_at < v_e));
  end if;

  if 'recap' = any(v_parts) then
    -- Partie « gang » du récap annuel (la partie « moi » concerne l'appelant : exclue)
    v_out := v_out || jsonb_build_object('recap', coalesce(public.hg_year_recap(p_year) -> 'gang', '{}'::jsonb) - 'messages');
  end if;

  if p_log then
    perform public.hg_admin_audit('archive_annuelle', null, p_year::text, jsonb_build_object('parties', to_jsonb(v_parts)));
  end if;
  return v_out;
end $$;

-- =====================================================================
-- Droits d'exécution
-- =====================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.hg_report_rules()', 'public.hg_report_label(text, text)', 'public.hg_report_set_hidden(text, text, boolean, uuid)',
    'public.hg_report(text, text, text, text)', 'public.hg_report_resolve(uuid, text)', 'public.hg_conv_hidden(uuid)',
    'public.hg_get_messages(uuid, bigint, integer)', 'public.hg_my_conversations()',
    'public.hg_eco_health()', 'public.hg_eco_alerts_ignore(integer)',
    'public.hg_version_num(text)', 'public.hg_booster_ev(jsonb, text[], integer, numeric, jsonb)', 'public.hg_client_error(jsonb)', 'public.hg_client_error_set(bigint, text, text)',
    'public.hg_client_error_ticket(bigint)', 'public.hg_archive_year(integer, text[], boolean)'] loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
  -- Fonctions internes : jamais appelées directement par le site
  foreach f in array array['public.hg_report_rules()', 'public.hg_report_label(text, text)',
    'public.hg_report_set_hidden(text, text, boolean, uuid)', 'public.hg_version_num(text)',
    'public.hg_booster_ev(jsonb, text[], integer, numeric, jsonb)'] loop
    execute format('revoke all on function %s from authenticated', f);
  end loop;
  foreach f in array array['public.hg_report(text, text, text, text)', 'public.hg_report_resolve(uuid, text)', 'public.hg_conv_hidden(uuid)',
    'public.hg_get_messages(uuid, bigint, integer)', 'public.hg_my_conversations()',
    'public.hg_eco_health()', 'public.hg_eco_alerts_ignore(integer)', 'public.hg_client_error(jsonb)',
    'public.hg_client_error_set(bigint, text, text)', 'public.hg_client_error_ticket(bigint)', 'public.hg_archive_year(integer, text[], boolean)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Journal des erreurs : aussi depuis les pages publiques, sans compte
  execute 'grant execute on function public.hg_client_error(jsonb) to anon';
end $$;
