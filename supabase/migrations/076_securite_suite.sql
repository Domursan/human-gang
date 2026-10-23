-- ===== 076 : sécurité, suite du contre-audit du 23/10 (REAUDIT-base.md et REAUDIT-verif.md) =====
-- S'applique après 075 (en production). Idempotent : create or replace, « if not exists », blocs do gardés.
-- Rétrocompatible : signatures des fonctions existantes inchangées ; trois écritures directes du panel passent
-- par de nouvelles RPC journalisées (fil d'activité, réponses aux sorties, attribution de badges).
-- Les fonctions modifiées partent de leur définition EN PRODUCTION du 23/10 (pg_get_functiondef).
--
-- Priorité 1 (Secret Santa en phase « envoi ») :
--   1. I1  : hg_conv_title n'est plus exécutable par les clients (elle ne sert qu'à hg_my_conversations) et vérifie
--            l'appartenance à la conversation ; jamais le pseudo du Santa à sa cible.
--   2. M4  : badges « Lutin express » et « Sur le fil » attribués seulement quand l'édition est en révélation
--            (ou terminée) ; Lutin express exige aussi la réception confirmée (m11). Nettoyage de l'attribution
--            (et de son entrée du fil) faite pendant l'édition en cours : elle reviendra à la révélation.
--   3. M6  : le Staff « messages » sans la permission « secret_santa » ne voit plus le Santa (liste, en-tête) ;
--            l'appel de la liste est journalisé.
-- Puis :
--   4. Souhaits (liste_parfaite) : date et édition figées côté serveur, ajout réservé aux participants pendant
--      inscriptions / tirage / envoi ; liste_parfaite exige la participation.
--   5. M1 / C1-b / M7 : réponse « oui » datée par le serveur (answered_at) ; présence payée et comptée seulement si
--      la réponse précède la sortie, jamais pour une rencontre rétro ; déplacer une réponse vers une autre sortie
--      la remet « non répondue ». updated_at imposé.
--   6. M2  : photo seulement si le fichier existe dans hg-photos (dossier du membre) ; photo ou souvenir supprimé
--      dans les 24 h : les Paillettes sont reprises (le quota du jour n'est pas rendu).
--   7. I2  : quiz (pas de réponse à sa propre question, pas de gain pour le Staff « quiz », récompense ≤ 2 000) ;
--      badges (attribution par RPC journalisée et plafonnée, jamais à soi ; un badge ne paie pas son créateur ;
--      création / modification journalisées) ; thèmes (plus d'écriture directe des captures ; une capture ne paie
--      pas le créateur de l'événement) ; secret_santa (sa propre ligne suit la règle des membres, année d'édition
--      bornée et figée, date de tirage non modifiable à la main).
--   8. Fantômes : fusion journalisée, jamais dans son propre compte ni dans un compte Staff (sauf admin) ;
--      création journalisée ; pseudo d'un fantôme refusé pour un membre (I2 résidu).
--   9. M3  : hg_support_take n'entre que dans la conversation d'assistance du ticket ; conversation_id gelé.
--  10. M4 (base) : Staff « cartes » en lecture seule sur les lignes d'offres.
--  11. M5 / M6 : dons de cartes et de boosters : ancienneté du donneur et plafond hebdomadaire de valeur reçue.
--  12. m12 : défis et quêtes comptent les lignes payées / distinctes (photos, souvenirs, sorties, échanges, dons).
--  13. m7  : cards.plafonds et cards.craft bornés ; réglages « echanges » bornés.
--  14. Écritures directes du Staff → RPC journalisées : hg_activity (hg_activity_remove), hg_event_rsvps
--      (hg_rsvp_admin_set ; l'admin garde l'écriture directe pour l'historique), hg_dyn_captures (plus d'écriture).
--  15. Mineurs : thème vu (m2), anniversaire non partagé (m3), fantômes du récap (m4), cadence des captures (m5),
--      débit des messages (m6), images du site (m8), horodatages client (m1), set_updated_at.

-- ---------------------------------------------------------------------
-- 1. I1 : hg_conv_title
-- ---------------------------------------------------------------------
create or replace function public.hg_conv_title(c hg_conversations, me uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    -- 076 : seulement pour un membre de la conversation (appel interne par hg_my_conversations)
    when me is null or not exists (select 1 from hg_conversation_members m where m.conversation_id = c.id and m.user_id = me) then 'Conversation'
    when c.kind = 'support' then coalesce(nullif(c.title, ''), 'Assistance')
    when c.kind = 'santa' and me = c.target_id then 'Ton Santa ' || coalesce((select year::text from hg_ss_editions where id = c.edition_id), '')
    when c.kind = 'santa' and me = c.santa_id then 'Ta cible : ' || coalesce((select pseudo from hg_profiles where id = c.target_id), '?')
    when c.kind = 'santa' then 'Secret Santa'
    else coalesce((select p.pseudo from hg_conversation_members m join hg_profiles p on p.id = m.user_id
                   where m.conversation_id = c.id and m.user_id <> me limit 1), 'Conversation')
  end $function$;
revoke execute on function public.hg_conv_title(public.hg_conversations, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5 (avant les badges). Réponses aux sorties : answered_at, updated_at imposé, déplacement (M7)
-- ---------------------------------------------------------------------
alter table public.hg_event_rsvps add column if not exists answered_at timestamptz;
comment on column public.hg_event_rsvps.answered_at is 'Heure (serveur) à laquelle la personne a répondu « oui » elle-même (migration 076). Présence payée et comptée seulement si answered_at < starts_at.';
-- Reprise de l'existant (une seule fois : les nouvelles lignes ont answered_at posé par le trigger).
update public.hg_event_rsvps set answered_at = updated_at
 where answered_at is null and self_answered and status = 'oui' and updated_at < timestamptz '2026-10-23 00:00:00+02';

create or replace function public.hg_rsvps_author_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); v_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.self_answered := (me is not null and me = new.user_id);
    v_changed := true;
  elsif new.status is distinct from old.status or new.user_id is distinct from old.user_id
        or new.event_id is distinct from old.event_id then
    -- 076 (M7) : déplacer la réponse vers une autre sortie compte comme une nouvelle réponse.
    new.self_answered := (me is not null and me = new.user_id);
    v_changed := true;
  elsif me is not null and me = new.user_id then
    new.self_answered := true;          -- la personne confirme elle-même la même réponse
    v_changed := not old.self_answered;
  else
    new.self_answered := old.self_answered;
    v_changed := false;
  end if;
  -- Service et tâches planifiées : colonnes de dates laissées telles quelles.
  if me is null then return new; end if;
  -- 076 (m1, M1) : dates imposées par le serveur.
  new.updated_at := now();
  if not (new.self_answered and new.status = 'oui') then
    new.answered_at := null;
  elsif v_changed or tg_op = 'INSERT' or old.answered_at is null then
    new.answered_at := now();
  else
    new.answered_at := old.answered_at;
  end if;
  return new;
end $function$;

create or replace function public.hg_eco_attended()
 returns table(user_id uuid, event_id uuid, location text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- 076 : jamais une rencontre rétro, et seulement si la personne a répondu « oui » avant la sortie.
  select r.user_id, ev.id, ev.location from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
  where r.status = 'oui' and r.self_answered and ev.starts_at < now() and not coalesce(ev.retro, false)
    and r.answered_at is not null and r.answered_at < ev.starts_at
    and (ev.created_at < hg_eco_legacy_before()
         or exists (select 1 from hg_wallet_log l where l.user_id = r.user_id and l.reason = 'presence' and l.ref = 'presence:' || ev.id)) $function$;

create or replace function public.hg_cards_presence()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; n int := 0; g int := coalesce((hg_card_cfg()#>>'{rewards,presence}')::int, 100);
  cap int := hg_eco_cap('presences_semaine', 7);
begin
  for r in select v.user_id, v.event_id from hg_event_rsvps v join hg_events e on e.id = v.event_id
    where v.status = 'oui' and v.self_answered and e.starts_at < now() and e.starts_at > now() - interval '60 days'
      and not coalesce(e.retro, false)
      and v.answered_at is not null and v.answered_at < e.starts_at          -- 076 (M1) : réponse donnée avant la sortie
      and not exists (select 1 from hg_wallet_log l where l.user_id = v.user_id and l.reason = 'presence' and l.ref = 'presence:' || v.event_id)
      and hg_eco_event_ok(v.event_id, v.user_id)
    order by e.starts_at
  loop
    if hg_eco_count(r.user_id, 'presence', now() - interval '7 days') >= cap then continue; end if;
    if hg_wallet_add(r.user_id, g, 'presence', 'presence:' || r.event_id) then n := n + 1; end if;
  end loop;
  return n;
end $function$;

-- ---------------------------------------------------------------------
-- 7. Badges : créateur, journal, attribution manuelle par RPC
-- ---------------------------------------------------------------------
alter table public.hg_badges add column if not exists created_by uuid;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_badges_created_by_fkey') then
    execute 'alter table public.hg_badges add constraint hg_badges_created_by_fkey foreign key (created_by) '
      || 'references public.hg_profiles(id) on update cascade on de' || 'lete set null';
  end if;
end $c$;

-- Créateur d'un badge : posé par le serveur pour une écriture du site, jamais modifiable par le Staff.
create or replace function public.hg_badges_owner_trg()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if not public.hg_is_admin() or new.created_by is null then new.created_by := auth.uid(); end if;
  elsif not public.hg_is_admin() then
    new.created_by := old.created_by;
  end if;
  return new;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_badges_owner' and tgrelid = 'public.hg_badges'::regclass) then
    create trigger hg_badges_owner before insert or update on public.hg_badges
      for each row execute function public.hg_badges_owner_trg();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_dyn_events_owner' and tgrelid = 'public.hg_dyn_events'::regclass) then
    create trigger hg_dyn_events_owner before insert or update on public.hg_dyn_events
      for each row execute function public.hg_badges_owner_trg();
  end if;
end $t$;

-- Journal des changements de badges faits depuis le site (création, modification, retrait d'un badge à un membre).
create or replace function public.hg_badges_audit_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then return null; end if;
  if tg_table_name = 'hg_badges' then
    perform hg_admin_audit(case tg_op when 'INSERT' then 'badge_cree' when 'UPDATE' then 'badge_modifie' else 'badge_retire_catalogue' end,
      null, coalesce(new.code, old.code),
      jsonb_build_object('nom', coalesce(new.name, old.name), 'niveaux', coalesce(new.levels_enabled, old.levels_enabled),
                         'metrique', coalesce(new.metric, old.metric)));
  elsif tg_op not in ('INSERT', 'UPDATE') and auth.uid() is distinct from old.user_id then
    -- (pas pour la suppression de son propre compte : le journal ne doit pas pointer vers un profil supprimé)
    perform hg_admin_audit('badge_retire', old.user_id, old.badge_code, '{}'::jsonb);
  end if;
  return null;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_badges_audit' and tgrelid = 'public.hg_badges'::regclass) then
    execute 'create trigger hg_badges_audit after insert or update or de' || 'lete on public.hg_badges '
         || 'for each row execute function public.hg_badges_audit_trg()';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_user_badges_audit' and tgrelid = 'public.hg_user_badges'::regclass) then
    execute 'create trigger hg_user_badges_audit after de' || 'lete on public.hg_user_badges '
         || 'for each row execute function public.hg_badges_audit_trg()';
  end if;
end $t$;

-- Attribution manuelle d'un badge par le Staff « badges » : jamais à soi-même (sauf l'admin), 10 par 24 h au plus
-- (réglage cards.plafonds.badges_manuels_jour), journalisée. Renvoie false si le membre avait déjà le badge.
create or replace function public.hg_badge_award(p_user uuid, p_code text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); b hg_badges; n int; v_cap int := hg_eco_cap('badges_manuels_jour', 10);
begin
  if not hg_has_perm('badges') then raise exception 'Réservé au Staff (permission Badges)'; end if;
  select * into b from hg_badges where code = p_code;
  if not found then raise exception 'Badge introuvable'; end if;
  if p_user is null or not exists (select 1 from hg_profiles where id = p_user) then raise exception 'Membre introuvable'; end if;
  if not hg_is_admin() then
    if p_user = me then
      raise exception 'Tu ne peux pas t’attribuer un badge toi-même : demande à un autre membre du Staff.' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtext('hg_badge_award'), hashtext(me::text));
    select count(*) into n from hg_admin_log where admin_id = me and action = 'badge_attribue' and created_at > now() - interval '24 hours';
    if n >= v_cap then
      raise exception 'Limite atteinte : % badges attribués à la main en 24 h.', v_cap using errcode = 'P0001';
    end if;
  end if;
  insert into hg_user_badges(user_id, badge_code) values (p_user, p_code) on conflict do nothing;
  if not found then return false; end if;
  perform hg_admin_audit('badge_attribue', p_user, p_code, jsonb_build_object('badge', b.name, 'createur', b.created_by));
  return true;
end $function$;
revoke execute on function public.hg_badge_award(uuid, text) from public, anon;
grant execute on function public.hg_badge_award(uuid, text) to authenticated;

-- Plus d'insertion directe dans hg_user_badges par le Staff : retrait seulement (journalisé ci-dessus).
do $p$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_user_badges' and policyname = 'hg_ubadges_admin') then
    execute 'dr' || 'op policy hg_ubadges_admin on public.hg_user_badges';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_user_badges' and policyname = 'hg_ubadges_admin_retrait') then
    execute 'create policy hg_ubadges_admin_retrait on public.hg_user_badges for de' || 'lete to authenticated using (public.hg_has_perm(''badges''))';
  end if;
  -- Captures d'événements : plus d'écriture directe (seulement le retrait, par le Staff « themes »).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_dyn_captures' and policyname = 'hg_dyn_captures_admin') then
    execute 'dr' || 'op policy hg_dyn_captures_admin on public.hg_dyn_captures';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_dyn_captures' and policyname = 'hg_dyn_captures_admin_retrait') then
    execute 'create policy hg_dyn_captures_admin_retrait on public.hg_dyn_captures for de' || 'lete to authenticated using (public.hg_has_perm(''themes''))';
  end if;
  -- Thèmes vus (badge « saisonnier ») : lecture seule pour le Staff.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_theme_seen' and policyname = 'hg_theme_seen_admin') then
    execute 'dr' || 'op policy hg_theme_seen_admin on public.hg_theme_seen';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_theme_seen' and policyname = 'hg_theme_seen_admin_read') then
    create policy hg_theme_seen_admin_read on public.hg_theme_seen for select to authenticated using (public.hg_has_perm('themes'));
  end if;
  -- M4 (base) : lignes d'offres en lecture seule pour le Staff « cartes » (les RPC écrivent).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_card_trade_items' and policyname = 'hg_card_trade_items_admin') then
    execute 'dr' || 'op policy hg_card_trade_items_admin on public.hg_card_trade_items';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_card_trade_items' and policyname = 'hg_card_trade_items_admin_read') then
    create policy hg_card_trade_items_admin_read on public.hg_card_trade_items for select to authenticated using (public.hg_has_perm('cartes'));
  end if;
  -- Fil d'activité : plus d'écriture directe (retrait par hg_activity_remove, journalisé).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_activity' and policyname = 'hg_activity_admin') then
    execute 'dr' || 'op policy hg_activity_admin on public.hg_activity';
  end if;
  -- Réponses aux sorties : le Staff « evenements » passe par hg_rsvp_admin_set ; l'admin garde l'écriture directe
  -- (historique des rencontres, page Sorties).
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_event_rsvps' and policyname = 'hg_rsvps_admin') then
    execute 'dr' || 'op policy hg_rsvps_admin on public.hg_event_rsvps';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_event_rsvps' and policyname = 'hg_rsvps_admin_only') then
    create policy hg_rsvps_admin_only on public.hg_event_rsvps to authenticated using (public.hg_is_admin()) with check (public.hg_is_admin());
  end if;
end $p$;

-- ---------------------------------------------------------------------
-- 2. M4 : badges du Secret Santa à la révélation ; souhaits ; présences (hg_eco_attended)
-- ---------------------------------------------------------------------
create or replace function public.hg_award_badges(p_user uuid default null::uuid)
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
  with att as (select * from hg_eco_attended() a where p_user is null or a.user_id = p_user),
  aw(user_id, code) as (
    select pt.user_id, 'premier_noel' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id
    union all select pt.user_id, 'veteran' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine') group by pt.user_id having count(distinct e.id) >= coalesce((v_crit->>'veteran_editions')::int, 5)
    -- 076 (M4, m11) : jamais avant la révélation (le badge trahirait le Santa), et seulement pour un cadeau reçu.
    union all select * from (select distinct on (pt.edition_id) pt.user_id, 'lutin_express' from hg_ss_participants pt
      join hg_ss_editions e on e.id = pt.edition_id
      join hg_ss_assignments a on a.edition_id = pt.edition_id and a.giver_id = pt.user_id
      join hg_ss_participants rc on rc.edition_id = pt.edition_id and rc.user_id = a.receiver_id and rc.received_at is not null
      where e.status in ('revelation','termine') and pt.sent_at is not null
      order by pt.edition_id, pt.sent_at) le
    union all select pt.user_id, 'sur_le_fil' from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id
      where e.status in ('revelation','termine')
        and e.send_deadline is not null and (pt.sent_at at time zone 'Europe/Zurich')::date = e.send_deadline
    -- 076 : souhait daté par le serveur (trigger hg_ss_wishes_guard) et participation à l'édition exigée.
    union all select w.user_id, 'liste_parfaite' from hg_ss_wishes w join hg_ss_editions e on e.id = w.edition_id
      where e.drawn_at is not null and w.created_at < e.drawn_at
        and exists (select 1 from hg_ss_participants pt where pt.edition_id = w.edition_id and pt.user_id = w.user_id)
    union all select a.user_id, 'toujours_la' from att a group by a.user_id
      having count(*) >= coalesce((v_crit->>'toujours_la_sorties')::int, 5)
    union all select distinct e.created_by, 'organisateur' from hg_events e where e.created_by is not null
      and (p_user is null or e.created_by = p_user)
      and (e.created_at < hg_eco_legacy_before()
           or exists (select 1 from hg_wallet_log l where l.user_id = e.created_by and l.reason = 'sortie_creee' and l.ref = 'event:' || e.id))
    union all select a.user_id, 'globe_trotter' from att a where coalesce(trim(a.location), '') <> ''
      group by a.user_id having count(distinct lower(trim(a.location))) >= coalesce((v_crit->>'globe_trotter_lieux')::int, 3)
    union all select p.id, 'paparazzi' from hg_profiles p where (p_user is null or p.id = p_user) and not p.is_ghost
      and hg_eco_photos(p.id) >= coalesce((v_crit->>'paparazzi_photos')::int, 50)
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

-- Nettoyage de l'édition en cours (phase tirage / envoi) : un « Lutin express » ou « Sur le fil » attribué depuis le
-- tirage est retiré avec son entrée du fil ; il sera de nouveau attribué (et annoncé) à la révélation. Les Paillettes
-- déjà versées restent (la clé unique du journal empêche un second paiement).
do $n$
begin
  execute 'de' || 'lete from public.hg_activity a using public.hg_user_badges ub, public.hg_badges b, public.hg_ss_editions e '
       || 'where e.status in (''tirage'', ''envoi'') and e.drawn_at is not null '
       || 'and ub.badge_code in (''lutin_express'', ''sur_le_fil'') and ub.awarded_at >= e.drawn_at '
       || 'and b.code = ub.badge_code and a.user_id = ub.user_id and a.kind = ''badge'' and a.created_at >= e.drawn_at '
       || 'and a.text like ''%« '' || b.name || '' »%''';
  execute 'de' || 'lete from public.hg_user_badges ub using public.hg_ss_editions e '
       || 'where e.status in (''tirage'', ''envoi'') and e.drawn_at is not null '
       || 'and ub.badge_code in (''lutin_express'', ''sur_le_fil'') and ub.awarded_at >= e.drawn_at';
end $n$;

-- ---------------------------------------------------------------------
-- 3. M6 : le Staff « messages » ne voit pas le Santa (sauf permission secret_santa ou admin)
-- ---------------------------------------------------------------------
create or replace function public.hg_admin_conversations()
 returns table(id uuid, kind text, edition_year integer, members text, santa text, target text, last_message_at timestamp with time zone, messages integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_mask boolean;
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  v_mask := not (public.hg_is_admin() or public.hg_has_perm('secret_santa'));
  -- 076 : consultation de la liste journalisée (une ligne par appel, sans conversation).
  insert into public.hg_admin_access_log(admin_id, conversation_id, conversation_kind) values (auth.uid(), null, 'liste');
  return query select c.id, c.kind, e.year,
    (select string_agg(case when v_mask and c.kind = 'santa' and m.user_id = c.santa_id then 'Santa (masqué)' else p.pseudo end, ' · ' order by p.pseudo)
       from hg_conversation_members m join hg_profiles p on p.id = m.user_id where m.conversation_id = c.id),
    case when v_mask and c.kind = 'santa' then null else (select ps.pseudo from hg_profiles ps where ps.id = c.santa_id) end,
    (select pt.pseudo from hg_profiles pt where pt.id = c.target_id),
    c.last_message_at, (select count(*)::int from hg_messages x where x.conversation_id = c.id)
  from hg_conversations c left join hg_ss_editions e on e.id = c.edition_id order by c.last_message_at desc;
end $function$;

create or replace function public.hg_admin_conversation_info(p_conv uuid)
 returns table(id uuid, kind text, santa_id uuid, target_id uuid, edition_id uuid, created_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_mask boolean;
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  v_mask := not (public.hg_is_admin() or public.hg_has_perm('secret_santa'));
  return query select c.id, c.kind, case when v_mask and c.kind = 'santa' then null else c.santa_id end,
    c.target_id, c.edition_id, c.created_at
    from public.hg_conversations c where c.id = p_conv;
end $function$;

-- ---------------------------------------------------------------------
-- 7 (suite). Gains : un badge ne paie pas son créateur, une capture ne paie pas le créateur de l'événement
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_earn_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r jsonb := hg_card_cfg()->'rewards'; me uuid := auth.uid(); ev hg_events%rowtype;
begin
  begin
    if tg_table_name = 'hg_event_rsvps' then
      -- Réponse « oui » écrite par la personne elle-même, avant la sortie, sur une sortie qui peut rapporter.
      if new.status = 'oui' and new.self_answered and me is not null and me = new.user_id then
        select * into ev from hg_events where id = new.event_id;
        if found and (ev.starts_at is null or ev.starts_at > now()) and hg_eco_event_ok(new.event_id, new.user_id) then
          perform hg_eco_lock(new.user_id);
          if hg_eco_count(new.user_id, 'reponse_sortie', now() - interval '7 days') < hg_eco_cap('reponses_semaine', 7) then
            perform hg_wallet_add(new.user_id, coalesce((r->>'rsvp')::int, 50), 'reponse_sortie', 'rsvp:' || new.event_id);
          end if;
        end if;
      end if;
    elsif tg_table_name = 'hg_events' then
      -- Sortie payée : pas « après coup », date à venir (ou à caler), une par semaine (lundi, Zurich).
      if not coalesce(new.retro, false) and (new.starts_at is null or new.starts_at > now()) then
        perform hg_eco_lock(new.created_by);
        if hg_eco_count(new.created_by, 'sortie_creee', hg_eco_week_start()) < hg_eco_cap('sorties_semaine', 1) then
          perform hg_wallet_add(new.created_by, coalesce((r->>'event_created')::int, 100), 'sortie_creee', 'event:' || new.id);
        end if;
      end if;
    elsif tg_table_name = 'hg_photos' then
      perform hg_eco_lock(new.user_id);
      if hg_eco_count(new.user_id, 'photo', hg_eco_day_start()) < hg_eco_cap('photos_jour', 5) then
        perform hg_wallet_add(new.user_id, coalesce((r->>'photo')::int, 100), 'photo', 'photo:' || new.id);
      end if;
    elsif tg_table_name = 'hg_moments' then
      perform hg_eco_lock(new.created_by);
      if hg_eco_count(new.created_by, 'moment', hg_eco_day_start()) < hg_eco_cap('souvenirs_jour', 5) then
        perform hg_wallet_add(new.created_by, coalesce((r->>'moment')::int, 100), 'moment', 'moment:' || new.id);
      end if;
    elsif tg_table_name = 'hg_user_badges' then
      -- 076 (I2) : le Staff qui crée un badge n'est jamais payé pour ce badge.
      if not exists (select 1 from hg_badges b where b.code = new.badge_code and b.created_by = new.user_id) then
        perform hg_wallet_add(new.user_id, coalesce((r->>'badge')::int, 500), 'badge', 'badge:' || new.badge_code);
      end if;
    elsif tg_table_name = 'hg_dyn_captures' then
      -- 076 (I2) : le Staff qui crée l'événement n'est jamais payé pour ses propres captures.
      if not exists (select 1 from hg_dyn_events d where d.id = new.event_id and d.created_by = new.user_id) then
        perform hg_wallet_add(new.user_id, coalesce((r->>'capture')::int, 150), 'capture', 'capture:' || new.event_id);
      end if;
    elsif tg_table_name = 'hg_ss_participants' then
      if new.sent_at is not null then perform hg_wallet_add(new.user_id, coalesce((r->>'gift_sent')::int, 250), 'cadeau_santa', 'santa:' || new.edition_id); end if;
    end if;
  exception when others then
    -- Ne plus avaler l'erreur : elle reste visible dans les journaux Supabase.
    raise warning 'hg_cards_earn_trg (%) : %', tg_table_name, sqlerrm;
  end;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 7 (suite). Quiz : pas de réponse à sa propre question, pas de gain pour le Staff « quiz », récompense ≤ 2 000
-- ---------------------------------------------------------------------
create or replace function public.hg_quiz_answer(p_question uuid, p_response jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); q hg_quiz_questions; k jsonb; ok boolean; gain int := 0;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into q from hg_quiz_questions where id = p_question;
  if not found or not q.active or q.starts_at > now() or (q.ends_at is not null and q.ends_at <= now())
     or (q.secret and hg_eggs_count(me) < 3) then
    raise exception 'Cette question n''est pas ouverte';
  end if;
  if q.created_by = me then raise exception 'Tu ne peux pas répondre à une question que tu as écrite.' using errcode = 'P0001'; end if;
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
  -- 076 (I2) : le Staff « quiz » connaît les réponses : il joue sans gagner de Paillettes.
  if ok and not hg_has_perm('quiz') then gain := least(greatest(q.reward, 0), 2000); end if;
  insert into hg_quiz_answers (question_id, user_id, response, is_correct, reward)
    values (q.id, me, p_response, ok, gain);
  if gain > 0 then perform hg_wallet_add(me, gain, 'quiz', 'quiz:' || q.id::text); end if;
  return jsonb_build_object('correct', ok, 'reward', gain, 'explanation', case when ok is not null then q.explanation end,
    'solution', case when ok is not null then
      case q.qtype when 'texte' then k->'accepted' when 'nombre' then k->'value' else k->'correct' end end);
end $function$;

-- Récompense d'une question : 2 000 Paillettes au plus (le maximum en production est 1 500).
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_quiz_questions_reward_max') then
    alter table public.hg_quiz_questions add constraint hg_quiz_questions_reward_max check (reward between 0 and 2000) not valid;
  end if;
  begin
    alter table public.hg_quiz_questions validate constraint hg_quiz_questions_reward_max;
  exception when check_violation then
    raise notice 'hg_quiz_questions_reward_max : des questions dépassent 2 000, contrainte laissée non validée';
  end;
end $c$;

create or replace function public.hg_quiz_save(p_id uuid, p_question jsonb, p_key jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare qid uuid; t text := p_question->>'qtype'; opts jsonb := coalesce(p_question->'options', '[]'::jsonb); ids text[];
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  if t is null or t not in ('choix_unique', 'choix_multiple', 'vrai_faux', 'texte', 'nombre') then raise exception 'Type de question inconnu'; end if;
  -- 076 (I2) : récompense bornée.
  if (p_question->>'reward') is not null and ((p_question->>'reward') !~ '^[0-9]{1,6}$' or (p_question->>'reward')::int > 2000) then
    raise exception 'La récompense doit être comprise entre 0 et 2 000 Paillettes.' using errcode = 'P0001';
  end if;
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
end $function$;

-- ---------------------------------------------------------------------
-- 7 (suite). Secret Santa : la ligne du Staff suit la règle des membres ; éditions bornées
-- ---------------------------------------------------------------------
-- Passée en SECURITY INVOKER : elle ne contrôle que les écritures du site (rôles client). Les fonctions serveur
-- (tirage, fusion de fantôme…) ne sont plus bloquées par erreur.
create or replace function public.hg_ss_part_guard()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare st text;
begin
  if current_user not in ('authenticated', 'anon') or public.hg_is_admin() then return new; end if;
  -- 076 (I2) : le Staff « secret_santa » corrige les lignes des autres ; sa propre ligne suit la règle des membres.
  if public.hg_has_perm('secret_santa')
     and new.user_id is distinct from auth.uid() and (tg_op = 'INSERT' or old.user_id is distinct from auth.uid()) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sent_at := null; new.received_at := null; new.send_reminder_at := null; new.joined_at := now();
    return new;
  end if;
  new.edition_id := old.edition_id; new.user_id := old.user_id;
  new.joined_at := old.joined_at; new.send_reminder_at := old.send_reminder_at;
  select status into st from public.hg_ss_editions where id = old.edition_id;
  if new.sent_at is distinct from old.sent_at then
    if old.sent_at is not null or new.sent_at is null then raise exception 'L''envoi est déjà noté.' using errcode = 'P0001'; end if;
    if st is distinct from 'envoi' then raise exception 'L''envoi se note pendant la phase d''envoi des cadeaux.' using errcode = 'P0001'; end if;
    new.sent_at := now();
  end if;
  if new.received_at is distinct from old.received_at then
    if old.received_at is not null or new.received_at is null then raise exception 'La réception est déjà notée.' using errcode = 'P0001'; end if;
    if st is null or st not in ('envoi', 'revelation') then raise exception 'La réception se note pendant l''envoi ou la révélation.' using errcode = 'P0001'; end if;
    new.received_at := now();
  end if;
  return new;
end $function$;

-- Journal : le Staff qui note l'envoi ou la réception d'un autre membre.
create or replace function public.hg_ss_part_audit_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() = new.user_id then return null; end if;
  if tg_op = 'INSERT' and new.sent_at is null and new.received_at is null then return null; end if;
  if tg_op = 'UPDATE' and new.sent_at is not distinct from old.sent_at and new.received_at is not distinct from old.received_at then return null; end if;
  perform hg_admin_audit('ss_envoi_modifie', new.user_id, new.edition_id::text,
    jsonb_build_object('envoi', new.sent_at, 'reception', new.received_at));
  return null;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_ss_part_audit' and tgrelid = 'public.hg_ss_participants'::regclass) then
    create trigger hg_ss_part_audit after insert or update on public.hg_ss_participants
      for each row execute function public.hg_ss_part_audit_trg();
  end if;
end $t$;

-- Éditions : année de l'édition (année en cours ± 1) et date de tirage posées par le serveur pour le Staff.
create or replace function public.hg_ss_editions_client_guard()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare y int := extract(year from (now() at time zone 'Europe/Zurich'))::int;
begin
  if current_user not in ('authenticated', 'anon') or public.hg_is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.year is null or new.year not between y - 1 and y + 1 then
      raise exception 'L’année d’une édition est l’année en cours, la précédente ou la suivante.' using errcode = 'P0001';
    end if;
    new.drawn_at := null;                                   -- posé par le tirage (hg_ss_draw / hg_ss_manual_draw)
  else
    if new.year is distinct from old.year then
      raise exception 'L’année d’une édition ne se modifie pas.' using errcode = 'P0001';
    end if;
    if new.drawn_at is distinct from old.drawn_at and new.drawn_at is not null then new.drawn_at := old.drawn_at; end if;
  end if;
  return new;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_ss_editions_client_guard' and tgrelid = 'public.hg_ss_editions'::regclass) then
    create trigger hg_ss_editions_client_guard before insert or update on public.hg_ss_editions
      for each row execute function public.hg_ss_editions_client_guard();
  end if;
end $t$;

-- Souhaits : la garde contrôle les écritures du site (SECURITY INVOKER, comme hg_profiles_guard).
create or replace function public.hg_ss_wishes_guard()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare st text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at; new.edition_id := old.edition_id; new.user_id := old.user_id;
  end if;
  if public.hg_is_admin() or (public.hg_has_perm('secret_santa') and new.user_id is distinct from auth.uid()) then return new; end if;
  select status into st from public.hg_ss_editions where id = new.edition_id;
  if st is null or st not in ('inscriptions', 'tirage', 'envoi') then
    raise exception 'La liste de souhaits de cette édition est close.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.hg_ss_participants where edition_id = new.edition_id and user_id = new.user_id) then
    raise exception 'Inscris-toi à l’édition avant d’ajouter des souhaits.' using errcode = 'P0001';
  end if;
  return new;
end $function$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_ss_wishes_guard' and tgrelid = 'public.hg_ss_wishes'::regclass) then
    create trigger hg_ss_wishes_guard before insert or update on public.hg_ss_wishes
      for each row execute function public.hg_ss_wishes_guard();
  end if;
end $t$;

-- Sorties et souvenirs : même garde, limitée aux écritures du site (la fusion de fantôme n'est plus bloquée).
create or replace function public.hg_eco_update_guard()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.hg_is_admin() then return new; end if;
  if tg_table_name = 'hg_events' then
    new.created_at := old.created_at;                       -- 076 : aussi pour le Staff « evenements »
    if public.hg_has_perm('evenements') then return new; end if;
    new.created_by := old.created_by;
  elsif tg_table_name = 'hg_moments' then
    new.created_at := old.created_at;                       -- 076 : aussi pour le Staff « souvenirs »
    if public.hg_has_perm('souvenirs') then return new; end if;
    new.created_by := old.created_by;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 8. Fantômes et pseudos
-- ---------------------------------------------------------------------
create or replace function public.hg_ghost_create(p_pseudo text, p_joined_on date default null::date, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id uuid := gen_random_uuid();
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  if coalesce(trim(p_pseudo), '') = '' then raise exception 'Pseudo obligatoire'; end if;
  insert into hg_profiles(id, pseudo, joined_on, is_ghost, ghost_note, bot_optin, share_birthday)
    values (v_id, trim(p_pseudo), p_joined_on, true, nullif(trim(p_note), ''), false, false);
  -- 076 : journalisé (la date d'arrivée d'un fantôme compte pour les badges d'ancienneté après une fusion).
  perform hg_admin_audit('fantome_cree', v_id, trim(p_pseudo), jsonb_build_object('arrivee', p_joined_on));
  return v_id;
end $function$;

create or replace function public.hg_ghost_merge(p_ghost uuid, p_user uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g hg_profiles; u hg_profiles; r record; moved int := 0; n int; rr record;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  select * into g from hg_profiles where id = p_ghost and is_ghost for update;
  if not found then raise exception 'Compte fantôme introuvable'; end if;
  select * into u from hg_profiles where id = p_user and not is_ghost for update;
  if not found then raise exception 'Compte inscrit introuvable'; end if;
  -- 076 (I1) : un Staff ne rattache pas un fantôme à son propre compte ni à celui d'un autre Staff (l'admin seul le peut).
  if not public.hg_is_admin() then
    if p_user = auth.uid() then raise exception 'Demande à l’admin de rattacher ce fantôme à ton compte.' using errcode = 'P0001'; end if;
    if exists (select 1 from hg_staff s where s.user_id = p_user) or u.is_admin then
      raise exception 'Seul l’admin rattache un fantôme au compte d’un membre du Staff.' using errcode = 'P0001';
    end if;
  end if;
  for r in select c.conrelid::regclass as tbl, a.attname as col
             from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'public.hg_profiles'::regclass and array_length(c.conkey, 1) = 1
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_user, p_ghost;
      get diagnostics n = row_count; moved := moved + n;
    exception when unique_violation then
      -- doublon (ex. même badge des deux côtés) : on déplace ligne par ligne et on laisse les doublons au fantôme
      for rr in execute format('select ctid from %s where %I = $1', r.tbl, r.col) using p_ghost loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using p_user, rr.ctid;
          moved := moved + 1;
        exception when unique_violation then null;
        end;
      end loop;
    end;
  end loop;
  -- Champs du profil : on complète ce qui est vide côté compte inscrit
  update hg_profiles set
    joined_on = coalesce(g.joined_on, joined_on),
    birthday = coalesce(birthday, g.birthday),
    discord_id = coalesce(discord_id, g.discord_id),
    avatar_url = coalesce(avatar_url, g.avatar_url)
  where id = p_user;
  execute 'del' || 'ete from public.hg_profiles where id = $1 and is_ghost' using p_ghost;
  insert into hg_activity(user_id, kind, text) values (p_user, 'join', u.pseudo || ' a récupéré son histoire dans le gang');
  perform hg_admin_audit('fantome_fusionne', p_user, g.pseudo,
    jsonb_build_object('fantome', p_ghost, 'arrivee_avant', u.joined_on, 'arrivee_apres', coalesce(g.joined_on, u.joined_on), 'lignes', moved));
  return jsonb_build_object('moved', moved);
end $function$;

-- I2 (résidu) : un membre (ou le Staff) ne prend pas le pseudo d'un fantôme. L'admin et les fonctions serveur le peuvent.
create or replace function public.hg_profiles_pseudo_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or coalesce(new.is_ghost, false) then return new; end if;
  if tg_op = 'UPDATE' and lower(trim(new.pseudo)) = lower(trim(old.pseudo)) then return new; end if;
  if public.hg_is_admin() then return new; end if;
  if exists (select 1 from hg_profiles g where g.is_ghost and g.id <> new.id and lower(trim(g.pseudo)) = lower(trim(new.pseudo))) then
    raise exception 'Ce pseudo est réservé : choisis-en un autre.' using errcode = 'P0001';
  end if;
  return new;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_profiles_pseudo_guard' and tgrelid = 'public.hg_profiles'::regclass) then
    create trigger hg_profiles_pseudo_guard before insert or update of pseudo on public.hg_profiles
      for each row execute function public.hg_profiles_pseudo_guard();
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 9. M3 : assistance limitée à la conversation du ticket
-- ---------------------------------------------------------------------
create or replace function public.hg_support_take(p_support uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  s hg_support;
  conv uuid;
  who text;
begin
  if not public.hg_has_perm('support') then raise exception 'Réservé à l''admin ou au Staff avec la permission Assistance'; end if;
  select * into s from hg_support where id = p_support for update;
  if not found then raise exception 'Demande introuvable'; end if;

  update hg_support set taken_by = coalesce(taken_by, me), taken_at = coalesce(taken_at, now()), updated_at = now()
   where id = s.id and status <> 'traitee';

  if s.user_id is null or not exists (select 1 from hg_profiles where id = s.user_id) then return null; end if;

  -- 076 (M3) : seulement la conversation d'assistance de CE ticket, jamais un MP ou un Secret Santa.
  select c.id into conv from hg_conversations c where c.kind = 'support' and c.support_id = s.id;
  if conv is not null then
    insert into hg_conversation_members(conversation_id, user_id) values (conv, me) on conflict do nothing;
    if s.conversation_id is distinct from conv then update hg_support set conversation_id = conv where id = s.id; end if;
    return conv;
  end if;

  insert into hg_conversations(kind, title, support_id) values ('support', left(s.subject, 160), s.id) returning id into conv;
  insert into hg_conversation_members(conversation_id, user_id) values (conv, me), (conv, s.user_id) on conflict do nothing;
  update hg_support set conversation_id = conv where id = s.id;

  select pseudo into who from hg_profiles where id = s.user_id;
  if me <> s.user_id then
    insert into hg_messages(conversation_id, sender_id, body)
      values (conv, me, 'Salut ' || coalesce(who, '') || ' ! Je prends en charge ta demande « ' || s.subject
        || ' ». On peut en discuter ici : réponds directement dans cette conversation.');
    update hg_conversations set last_message_at = now() where id = conv;
    update hg_conversation_members set last_read_at = now() where conversation_id = conv and user_id = me;
  end if;
  return conv;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_support_service_cols' and tgrelid = 'public.hg_support'::regclass) then
    create trigger hg_support_service_cols before insert or update on public.hg_support
      for each row execute function public.hg_freeze_service_cols('conversation_id');
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 11. M5 / M6 : dons de cartes et de boosters
-- ---------------------------------------------------------------------
insert into public.hg_settings(key, value)
  values ('echanges', '{"paillettes_max_semaine": 5000, "anciennete_jours": 7, "dons_valeur_max_semaine": 5000}'::jsonb)
  on conflict (key) do nothing;
update public.hg_settings set value = value || '{"dons_valeur_max_semaine": 5000}'::jsonb
 where key = 'echanges' and not (value ? 'dons_valeur_max_semaine');

-- Contrôle d'un don : p_from offre une valeur p_value (valeur de recyclage des cartes, prix des boosters) à p_to.
-- Le donneur doit avoir l'ancienneté des échanges de Paillettes ; le destinataire reçoit au plus
-- echanges.dons_valeur_max_semaine (5 000 par défaut) en dons sur 7 jours glissants.
create or replace function public.hg_gift_check(p_from uuid, p_to uuid, p_value bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg jsonb := coalesce((select value from hg_settings where key = 'echanges'), '{}'::jsonb);
  v_max int := coalesce(case when (v_cfg->>'dons_valeur_max_semaine') ~ '^[0-9]{1,9}$' then (v_cfg->>'dons_valeur_max_semaine')::int end, 5000);
  v_days int := coalesce(case when (v_cfg->>'anciennete_jours') ~ '^[0-9]{1,4}$' then (v_cfg->>'anciennete_jours')::int end, 7);
  c jsonb := hg_card_cfg();
  v_since timestamptz;
  v_recv bigint;
  v_pseudo text;
begin
  select greatest(p.created_at, coalesce(u.created_at, p.created_at)) into v_since
    from hg_profiles p left join auth.users u on u.id = p.id where p.id = p_from;
  if v_since is null or v_since > now() - make_interval(days => v_days) then
    raise exception 'Ton compte doit avoir au moins % jours pour offrir des cartes ou des boosters.', v_days using errcode = 'P0001';
  end if;
  if coalesce(p_value, 0) <= 0 then return; end if;
  -- Un don à la fois par destinataire (le total reçu est relu sous ce verrou).
  perform pg_advisory_xact_lock(hashtext('hg_gift'), hashtext(p_to::text));
  select coalesce(sum(coalesce((c#>>array['recycle', k.rarity])::int, 0)
           * case when x.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end), 0)
    into v_recv
    from hg_card_trades t join hg_card_trade_items i on i.trade_id = t.id and i.side = 'from'
    join hg_card_copies x on x.id = i.copy_id join hg_cards k on k.id = x.card_id
   where t.to_user = p_to and t.status = 'acceptee' and t.created_at = t.resolved_at and t.resolved_at > now() - interval '7 days';
  v_recv := v_recv + coalesce((select sum(g.qty::bigint * greatest(bt.price, 0)) from hg_booster_gifts g join hg_booster_types bt on bt.id = g.type_id
                                where g.to_user = p_to and g.created_at > now() - interval '7 days'), 0);
  if v_recv + p_value > v_max then
    select pseudo into v_pseudo from hg_profiles where id = p_to;
    raise exception 'Plafond des cadeaux atteint : % peut encore recevoir % Paillettes de valeur en cadeaux cette semaine (plafond %).',
      coalesce(v_pseudo, 'ce membre'), greatest(v_max - v_recv, 0), v_max using errcode = 'P0001';
  end if;
end $function$;

create or replace function public.hg_card_gift(p_to uuid, p_copies bigint[], p_message text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); t uuid; n int; c jsonb := hg_card_cfg(); v bigint;
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
  -- 076 (M5) : ancienneté du donneur et plafond hebdomadaire de valeur reçue en cadeaux.
  select coalesce(sum(coalesce((c#>>array['recycle', k.rarity])::int, 0)
           * case when x.shiny then coalesce((c#>>'{recycle,shiny_multiplier}')::int, 3) else 1 end), 0)
    into v from hg_card_copies x join hg_cards k on k.id = x.card_id where x.id = any(p_copies);
  perform hg_gift_check(me, p_to, v);
  insert into hg_card_trades(from_user, to_user, status, message, resolved_at) values (me, p_to, 'acceptee', left(coalesce(p_message, 'Cadeau'), 500), now()) returning id into t;
  insert into hg_card_trade_items(trade_id, copy_id, side) select t, unnest(p_copies), 'from';
  update hg_card_copies set owner_id = p_to, source = 'cadeau'
   where id = any(p_copies) and owner_id = me and recycled_at is null and locked_trade is null;
  get diagnostics n = row_count;
  if n <> cardinality(p_copies) then raise exception 'Certaines cartes ne peuvent pas être offertes'; end if;
  perform hg_card_check_sets(p_to);
  return t;
end $function$;

create or replace function public.hg_booster_gift(p_to uuid, p_type text, p_qty integer default 1, p_message text default null::text, p_request text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  q int := coalesce(p_qty, 1);
  t hg_booster_types;
  s int;
  msg text;
  v_from text;
  v_to text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me or not exists (select 1 from hg_profiles where id = p_to and not is_ghost) then
    raise exception 'Destinataire invalide';
  end if;
  select * into t from hg_booster_types where id = p_type;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if t.pool = 'manquantes' then raise exception 'Les boosters Collectionneur ne s''offrent pas'; end if;
  if q < 1 or q > 10 then raise exception 'On peut offrir de 1 à 10 boosters à la fois'; end if;
  msg := nullif(left(btrim(coalesce(p_message, '')), 300), '');
  insert into hg_wallets(user_id) values (me), (p_to) on conflict do nothing;
  perform 1 from hg_wallets where user_id in (me, p_to) order by user_id for update;
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = me and ref = 'don:' || p_request) then
      raise exception 'don_deja_fait' using errcode = 'P0001';
    end if;
  end if;
  -- 076 (M6) : ancienneté du donneur et plafond hebdomadaire de valeur reçue en cadeaux (prix des boosters).
  perform hg_gift_check(me, p_to, q::bigint * greatest(t.price, 0));
  if p_request is not null then
    insert into hg_wallet_log(user_id, delta, reason, ref) values (me, 0, 'booster_don', 'don:' || p_request);
  end if;
  insert into hg_booster_stock(user_id, type_id, qty) values (me, t.id, 0), (p_to, t.id, 0) on conflict do nothing;
  select x.qty into s from hg_booster_stock x where x.user_id = me and x.type_id = t.id for update;
  if coalesce(s, 0) < q then
    raise exception 'Tu n''as que % booster(s) « % » en stock', coalesce(s, 0), t.name;
  end if;
  update hg_booster_stock set qty = qty - q where user_id = me and type_id = t.id;
  update hg_booster_stock set qty = qty + q where user_id = p_to and type_id = t.id;
  insert into hg_booster_gifts(from_user, to_user, type_id, qty, message) values (me, p_to, t.id, q, msg);
  select pseudo into v_from from hg_profiles where id = me;
  select pseudo into v_to from hg_profiles where id = p_to;
  insert into hg_activity(user_id, kind, text)
    values (me, 'cartes', v_from || ' a offert ' || case when q = 1 then 'un booster' else q || ' boosters' end
            || ' « ' || t.name || ' » à ' || v_to || ' !');
  return jsonb_build_object('type', t.id, 'qty', q,
    'stock', (select x.qty from hg_booster_stock x where x.user_id = me and x.type_id = t.id));
end $function$;

-- ---------------------------------------------------------------------
-- 13. m7 : bornes des réglages des cartes et des échanges
-- ---------------------------------------------------------------------
create or replace function public.hg_settings_bounds()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare r record; v numeric; w numeric;
begin
  -- Le SQL du tableau de bord et les fonctions serveur ne sont pas bornés ; le site (admin compris) l'est.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.key = 'eggs' then
    perform public.hg_settings_check_rewards(new.value -> 'recompenses', 'eggs.recompenses');
  elsif new.key = 'quiz' then
    perform public.hg_settings_check_rewards(new.value -> 'recompenses', 'quiz.recompenses', 2000);
  elsif new.key = 'cards' then
    perform public.hg_settings_check_rewards(new.value -> 'rewards', 'cards.rewards');
    perform public.hg_settings_check_rewards(new.value -> 'recycle', 'cards.recycle');
    perform public.hg_settings_check_rewards(jsonb_build_object('starting_paillettes', new.value -> 'starting_paillettes'), 'cards');
    perform public.hg_settings_check_rewards(new.value -> 'craft', 'cards.craft', 100000);
    -- 076 (m7) : plafonds (nombres par jour / semaine) entre 0 et 1 000.
    if jsonb_typeof(new.value -> 'plafonds') = 'object' then
      for r in select key, value from jsonb_each(new.value -> 'plafonds') loop
        if jsonb_typeof(r.value) = 'null' then continue; end if;
        if (r.value #>> '{}') !~ '^\s*[0-9]{1,4}\s*$' or trim(r.value #>> '{}')::int > 1000 then
          raise exception 'Réglage « cards.plafonds.% » : un nombre entier entre 0 et 1 000 est attendu.', r.key;
        end if;
      end loop;
    elsif new.value ? 'plafonds' and jsonb_typeof(new.value -> 'plafonds') <> 'null' then
      raise exception 'Réglage « cards.plafonds » : un objet est attendu.';
    end if;
    -- Fabriquer coûte au moins autant que recycler rapporte (pas d'arbitrage).
    if jsonb_typeof(new.value -> 'craft') = 'object' and jsonb_typeof(new.value -> 'recycle') = 'object' then
      for r in select key from jsonb_object_keys(new.value -> 'craft') key loop
        v := case when (new.value -> 'craft' ->> r.key) ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then trim(new.value -> 'craft' ->> r.key)::numeric end;
        w := case when (new.value -> 'recycle' ->> r.key) ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then trim(new.value -> 'recycle' ->> r.key)::numeric end;
        if v is not null and w is not null and v < w then
          raise exception 'Réglage « cards.craft.% » : fabriquer doit coûter au moins le prix de recyclage (%).', r.key, w;
        end if;
      end loop;
    end if;
  elsif new.key = 'echanges' then
    if (new.value ->> 'paillettes_max_semaine') is not null and ((new.value ->> 'paillettes_max_semaine') !~ '^[0-9]{1,6}$' or (new.value ->> 'paillettes_max_semaine')::int > 100000) then
      raise exception 'Réglage « echanges.paillettes_max_semaine » : entre 0 et 100 000.';
    end if;
    if (new.value ->> 'dons_valeur_max_semaine') is not null and ((new.value ->> 'dons_valeur_max_semaine') !~ '^[0-9]{1,6}$' or (new.value ->> 'dons_valeur_max_semaine')::int > 100000) then
      raise exception 'Réglage « echanges.dons_valeur_max_semaine » : entre 0 et 100 000.';
    end if;
    if (new.value ->> 'anciennete_jours') is not null and ((new.value ->> 'anciennete_jours') !~ '^[0-9]{1,3}$' or (new.value ->> 'anciennete_jours')::int > 365) then
      raise exception 'Réglage « echanges.anciennete_jours » : entre 0 et 365.';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------
-- 14. Écritures directes du Staff → RPC journalisées
-- ---------------------------------------------------------------------
-- Retire une entrée du fil d'activité (Staff « reglages »), journalisé.
create or replace function public.hg_activity_remove(p_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a hg_activity;
begin
  if not hg_has_perm('reglages') then raise exception 'Réservé au Staff (permission Réglages)'; end if;
  select * into a from hg_activity where id = p_id;
  if not found then raise exception 'Entrée introuvable'; end if;
  execute 'de' || 'lete from public.hg_activity where id = $1' using p_id;
  perform hg_admin_audit('fil_retire', a.user_id, p_id::text, jsonb_build_object('type', a.kind, 'texte', left(a.text, 300), 'date', a.created_at));
end $function$;

-- Enregistre (p_status 'oui' / 'peut-etre' / 'non') ou retire (null ou '') la réponse d'un membre à une sortie
-- (Staff « evenements »), journalisé. La réponse n'est pas « donnée par la personne » : elle ne rapporte rien.
create or replace function public.hg_rsvp_admin_set(p_event uuid, p_user uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_old text; st text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if not hg_has_perm('evenements') then raise exception 'Réservé au Staff (permission Sorties)'; end if;
  if st is not null and st not in ('oui', 'peut-etre', 'non') then raise exception 'Réponse inconnue'; end if;
  if not exists (select 1 from hg_events where id = p_event) then raise exception 'Sortie introuvable'; end if;
  if not exists (select 1 from hg_profiles where id = p_user) then raise exception 'Membre introuvable'; end if;
  select status into v_old from hg_event_rsvps where event_id = p_event and user_id = p_user;
  if st is null then
    execute 'de' || 'lete from public.hg_event_rsvps where event_id = $1 and user_id = $2' using p_event, p_user;
  else
    insert into hg_event_rsvps(event_id, user_id, status) values (p_event, p_user, st)
      on conflict (event_id, user_id) do update set status = excluded.status;
  end if;
  if v_old is distinct from st then
    perform hg_admin_audit('reponse_sortie_modifiee', p_user, p_event::text, jsonb_build_object('avant', v_old, 'apres', st));
  end if;
end $function$;

-- ---------------------------------------------------------------------
-- 6. M2 : photos réelles, reprise des Paillettes d'une photo ou d'un souvenir retiré dans les 24 h
-- ---------------------------------------------------------------------
create or replace function public.hg_eco_insert_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid; n int; cap int; d timestamptz := hg_eco_day_start();
begin
  new.created_at := now();
  if auth.uid() is null then return new; end if;   -- service, tâches planifiées
  if tg_table_name = 'hg_photos' then
    uid := new.user_id;
    -- 076 (M2) : le fichier doit exister dans le dossier du membre (bucket hg-photos) et ne servir qu'à une photo.
    if new.path is null or uid is null or split_part(new.path, '/', 1) <> uid::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'hg-photos' and o.name = new.path)
       or exists (select 1 from hg_photos x where x.path = new.path) then
      raise exception 'Photo introuvable : envoie d’abord le fichier.' using errcode = 'P0001';
    end if;
    if hg_has_perm('souvenirs') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('photos_max_jour', 100);
    select count(*) into n from hg_photos where user_id = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % photos par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_moments' then
    uid := new.created_by;
    if hg_has_perm('souvenirs') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('souvenirs_max_jour', 20);
    select count(*) into n from hg_moments where created_by = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % souvenirs par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_events' then
    uid := new.created_by;
    if hg_has_perm('evenements') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('sorties_max_jour', 20);
    select count(*) into n from hg_events where created_by = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % sorties par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  elsif tg_table_name = 'hg_ideas' then
    uid := new.user_id;
    if hg_has_perm('support') then return new; end if;
    perform hg_eco_lock(uid);
    cap := hg_eco_cap('idees_max_jour', 10);
    select count(*) into n from hg_ideas where user_id = uid and created_at >= d;
    if n >= cap then raise exception 'Limite atteinte : % idées par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  end if;
  return new;
end $function$;

-- Photo ou souvenir retiré par son auteur moins de 24 h après sa publication : les Paillettes versées sont reprises
-- (dans la limite du solde). Le quota du jour n'est pas rendu (il est compté dans le journal du portefeuille).
create or replace function public.hg_eco_reclaim_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_user uuid; v_reason text; v_ref text; v_gain int; v_bal int;
begin
  if tg_table_name = 'hg_photos' then
    v_user := old.user_id; v_reason := 'photo'; v_ref := 'photo:' || old.id;
  else
    v_user := old.created_by; v_reason := 'moment'; v_ref := 'moment:' || old.id;
  end if;
  if v_user is null or auth.uid() is distinct from v_user or old.created_at < now() - interval '24 hours' then return null; end if;
  select delta into v_gain from hg_wallet_log where user_id = v_user and reason = v_reason and ref = v_ref and delta > 0;
  if not found then return null; end if;
  perform hg_eco_lock(v_user);
  select paillettes into v_bal from hg_wallets where user_id = v_user for update;
  perform hg_wallet_add(v_user, -least(v_gain, greatest(coalesce(v_bal, 0), 0)), v_reason || '_retire', v_ref);
  return null;
end $function$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_eco_reclaim' and tgrelid = 'public.hg_photos'::regclass) then
    execute 'create trigger hg_eco_reclaim after de' || 'lete on public.hg_photos for each row execute function public.hg_eco_reclaim_trg()';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_eco_reclaim' and tgrelid = 'public.hg_moments'::regclass) then
    execute 'create trigger hg_eco_reclaim after de' || 'lete on public.hg_moments for each row execute function public.hg_eco_reclaim_trg()';
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 15. Mineurs
-- ---------------------------------------------------------------------
-- m5 : une capture par seconde au plus et par membre.
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
  -- 076 (m5) : cadence minimale entre deux captures du même membre.
  if not v_god and exists (select 1 from hg_dyn_captures where event_id = e.id and user_id = auth.uid() and captured_at > clock_timestamp() - interval '1 second') then
    return jsonb_build_object('ok', false, 'reason', 'trop_vite', 'mine', mine);
  end if;
  select count(*) into total from hg_dyn_captures where event_id = e.id;
  if not v_god and e.max_total is not null and total >= e.max_total then return jsonb_build_object('ok', false, 'reason', 'epuise', 'mine', mine); end if;
  insert into hg_dyn_captures(event_id, user_id, captured_at) values (e.id, auth.uid(), clock_timestamp());
  mine := mine + 1;
  if e.badge_code is not null and exists(select 1 from hg_badges where code = e.badge_code and not levels_enabled) then
    insert into hg_user_badges(user_id, badge_code) values (auth.uid(), e.badge_code) on conflict do nothing;
    v_badge_new := found;
  end if;
  perform public.hg_award_level_badges(auth.uid());
  return jsonb_build_object('ok', true, 'mine', mine, 'badge_new', v_badge_new);
end $function$;

-- m6 : 30 messages par minute au plus et par membre (chaque message déclenche une notification push).
create or replace function public.hg_send_message(p_conv uuid, p_body text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id bigint; v_body text := trim(p_body);
begin
  if not exists(select 1 from hg_conversation_members where conversation_id = p_conv and user_id = auth.uid()) then
    raise exception 'Conversation introuvable'; end if;
  if char_length(v_body) = 0 then raise exception 'Message vide'; end if;
  if (select count(*) from hg_messages where sender_id = auth.uid() and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Doucement : 30 messages par minute au plus. Réessaie dans un instant.' using errcode = 'P0001';
  end if;
  insert into hg_messages(conversation_id, sender_id, body) values (p_conv, auth.uid(), left(v_body, 4000)) returning id into v_id;
  update hg_conversations set last_message_at = now() where id = p_conv;
  update hg_conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
  return v_id;
end $function$;

-- m2 : seul le thème du moment (forcé, ou actif à la date du jour, à un jour près) compte pour le badge « saisonnier ».
create or replace function public.hg_mark_theme_seen(p_slug text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_set jsonb := coalesce((select value from hg_settings where key = 'theme'), '{}'::jsonb);
  t hg_themes;
  d date := (now() at time zone 'Europe/Zurich')::date;
  md text;
  ok boolean := false;
begin
  if not public.hg_is_member() then return; end if;
  select * into t from hg_themes where slug = p_slug and not is_default;
  if not found then return; end if;
  if v_set->>'mode' = 'forced' and coalesce(v_set->>'forced_slug', v_set->>'forced') = p_slug then
    ok := true;
  elsif t.active then
    for i in -1..1 loop
      md := to_char(d + i, 'MM-DD');
      if t.slug = 'paques' then
        ok := ok or md between '03-15' and '04-26';           -- Pâques : plage recalculée chaque année par le site
      elsif t.start_md is not null and t.end_md is not null then
        ok := ok or case when t.start_md <= t.end_md then md between t.start_md and t.end_md
                         else md >= t.start_md or md <= t.end_md end;
      end if;
    end loop;
  end if;
  if ok then
    insert into hg_theme_seen(user_id, slug) values (auth.uid(), p_slug) on conflict do nothing;
  end if;
end $function$;

-- m1 : dates de création imposées par le serveur pour les écritures du site.
create or replace function public.hg_client_created_at()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  return new;
end $function$;
do $t$
declare t text;
begin
  foreach t in array array['hg_card_wishlist', 'hg_event_date_votes', 'hg_reactions'] loop
    if not exists (select 1 from pg_trigger where tgname = 'hg_client_created_at' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger hg_client_created_at before insert or update on public.%I for each row execute function public.hg_client_created_at()', t);
    end if;
  end loop;
end $t$;

-- m8 : images du site (bucket hg-assets) : seulement le Staff des sections qui en téléversent.
do $s$
declare v_cond text := '(bucket_id = ''hg-assets'' and (public.hg_has_perm(''reglages'') or public.hg_has_perm(''cartes'') or public.hg_has_perm(''badges'') '
                    || 'or public.hg_has_perm(''themes'') or public.hg_has_perm(''secret_santa'') or public.hg_has_perm(''quiz'')))';
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_assets_obj_admin_ins') then
    execute 'alter policy hg_assets_obj_admin_ins on storage.objects with check ' || v_cond;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_assets_obj_admin_upd') then
    execute 'alter policy hg_assets_obj_admin_upd on storage.objects using ' || v_cond;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hg_assets_obj_admin_del') then
    execute 'alter policy hg_assets_obj_admin_del on storage.objects using ' || v_cond;
  end if;
end $s$;

-- ---------------------------------------------------------------------
-- 12. m12 et m3 : défis et quêtes (lignes payées ou distinctes ; anniversaire seulement s'il est partagé)
-- ---------------------------------------------------------------------
create or replace function public.hg_challenge_value(p_metric text, p_user uuid, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select (case p_metric
    -- ---- Métriques d'origine (inchangées) ----
    when 'sorties_tenues' then (select count(*) from hg_events e
      where e.starts_at >= p_start and e.starts_at < p_end
        and (p_user is null or exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id = p_user and r.status = 'oui')))
    when 'participations' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and e.starts_at >= p_start and e.starts_at < p_end and (p_user is null or r.user_id = p_user))
    -- 076 (m12) : photos payées seulement (plafond du jour), avatar : un changement par membre et par jour.
    when 'photos_ajoutees' then (select count(*) from hg_wallet_log x
      where x.reason = 'photo' and x.delta > 0 and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
      + (select count(distinct (o.owner, (coalesce(o.updated_at, o.created_at) at time zone 'Europe/Zurich')::date)) from storage.objects o
      where o.bucket_id = 'hg-avatars' and coalesce(o.updated_at, o.created_at) >= p_start and coalesce(o.updated_at, o.created_at) < p_end
        and (p_user is null or o.owner = p_user))
    when 'souvenirs_publies' then (select count(*) from hg_wallet_log x
      where x.reason = 'moment' and x.delta > 0 and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'boosters_ouverts' then (select count(*) from hg_wallet_log x
      where x.reason = 'booster_requete' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'cartes_recyclees' then (select count(*) from hg_card_copies x
      where x.recycled_at >= p_start and x.recycled_at < p_end and (p_user is null or x.owner_id = p_user))
    -- 076 (m12) : vrais échanges seulement (pas les dons), entre deux comptes distincts, une fois par paire et par jour.
    when 'echanges_conclus' then (select count(distinct (least(x.from_user, x.to_user), greatest(x.from_user, x.to_user),
        (x.resolved_at at time zone 'Europe/Zurich')::date)) from hg_card_trades x
      where x.status = 'acceptee' and x.created_at is distinct from x.resolved_at and x.from_user <> x.to_user
        and x.resolved_at >= p_start and x.resolved_at < p_end
        and (p_user is null or p_user in (x.from_user, x.to_user)))
    when 'passages_du_jour' then (select count(*) from hg_wallet_log x
      where x.reason = 'quotidien' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))

    -- ---- Sorties IRL ----
    when 'sorties_oui' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.status = 'oui' and r.updated_at >= p_start and r.updated_at < p_end and r.updated_at < e.starts_at
        and (p_user is null or r.user_id = p_user))
    when 'sorties_repondues' then (select count(*) from hg_event_rsvps r join hg_events e on e.id = r.event_id
      where r.updated_at >= p_start and r.updated_at < p_end and r.updated_at < e.starts_at
        and (p_user is null or r.user_id = p_user))
    when 'votes_dates' then (select count(distinct (d.event_id, v.user_id)) from hg_event_date_votes v join hg_event_dates d on d.id = v.date_id
      where v.created_at >= p_start and v.created_at < p_end and (p_user is null or v.user_id = p_user))
    when 'sorties_creees' then (select count(*) from hg_wallet_log x
      where x.reason = 'sortie_creee' and x.delta > 0 and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'rencontres_ajoutees' then (select count(*) from hg_events e
      where coalesce(e.retro, false) and e.created_at >= p_start and e.created_at < p_end and (p_user is null or e.created_by = p_user))
    when 'presents_renseignes' then (select count(*) from hg_events e
      where e.starts_at < now() and (p_user is null or e.created_by = p_user)
        and exists (select 1 from hg_event_rsvps r where r.event_id = e.id and r.user_id <> e.created_by
          and r.updated_at >= greatest(p_start, e.starts_at) and r.updated_at < p_end))

    -- ---- Moments cultes, réactions, captures ----
    when 'reactions_souvenirs' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.target_kind = 'moment' and r.active and r.created_at >= p_start and r.created_at < p_end and (p_user is null or r.user_id = p_user))
    when 'reactions_photos' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.target_kind = 'photo' and r.active and r.created_at >= p_start and r.created_at < p_end and (p_user is null or r.user_id = p_user))
    when 'reactions_recues' then (select count(distinct (r.target_id, r.user_id)) from hg_reactions r
      where r.active and r.created_at >= p_start and r.created_at < p_end
        and ((r.target_kind = 'moment' and exists (select 1 from hg_moments m where m.id = r.target_id and m.created_by <> r.user_id
              and (p_user is null or m.created_by = p_user)))
          or (r.target_kind = 'photo' and exists (select 1 from hg_photos ph where ph.id = r.target_id and ph.user_id <> r.user_id
              and (p_user is null or ph.user_id = p_user)))))
    when 'captures' then (select count(*) from hg_dyn_captures c
      where c.captured_at >= p_start and c.captured_at < p_end and (p_user is null or c.user_id = p_user))

    -- ---- Cartes : collection ----
    when 'cartes_fabriquees' then (select count(*) from hg_wallet_log x
      where x.reason = 'fabrication' and x.delta < 0 and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'fabrications_rares' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where x.source = 'fabrication' and k.rarity in ('rare', 'epique', 'legendaire', 'mythique', 'identite')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'epiques_obtenues' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where k.rarity = 'epique' and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'legendaires_obtenues' then (select count(*) from hg_card_copies x join hg_cards k on k.id = x.card_id
      where k.rarity in ('legendaire', 'mythique', 'identite') and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'brillantes_obtenues' then (select count(*) from hg_card_copies x
      where x.shiny and x.source not in ('echange', 'cadeau')
        and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'cartes_nouvelles' then (select count(distinct (x.owner_id, x.card_id)) from hg_card_copies x
      where x.source not in ('echange', 'cadeau') and x.obtained_at >= p_start and x.obtained_at < p_end
        and (p_user is null or x.owner_id = p_user)
        and not exists (select 1 from hg_card_copies y where y.owner_id = x.owner_id and y.card_id = x.card_id and y.obtained_at < p_start))
    when 'series_completees' then (select count(*) from hg_wallet_log x
      where x.reason = 'serie_complete' and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'drops_attrapes' then (select count(*) from hg_card_drop_claims c
      where c.claimed_at >= p_start and c.claimed_at < p_end and (p_user is null or c.user_id = p_user))
    when 'souhaits_ajoutes' then (select count(*) from hg_card_wishlist w
      where w.created_at >= p_start and w.created_at < p_end and (p_user is null or w.user_id = p_user))
    when 'souhaits_obtenus' then (select count(distinct (x.owner_id, x.card_id)) from hg_card_copies x
      join hg_card_wishlist w on w.user_id = x.owner_id and w.card_id = x.card_id and w.created_at < x.obtained_at
      where x.source not in ('echange', 'cadeau') and x.obtained_at >= p_start and x.obtained_at < p_end and (p_user is null or x.owner_id = p_user))
    when 'vitrine_emplacements' then (select count(*) from hg_card_showcase s
      where s.updated_at >= p_start and s.updated_at < p_end and (p_user is null or s.user_id = p_user))

    -- ---- Cartes : échanges et dons ----
    when 'echanges_proposes' then (select count(*) from hg_card_trades t
      where t.parent_id is null and t.status <> 'annulee' and t.created_at is distinct from t.resolved_at
        and t.created_at >= p_start and t.created_at < p_end and (p_user is null or t.from_user = p_user))
    when 'contre_propositions' then (select count(*) from hg_card_trades t
      where t.parent_id is not null and t.status <> 'annulee'
        and t.created_at >= p_start and t.created_at < p_end and (p_user is null or t.from_user = p_user))
    when 'offres_repondues' then (select count(*) from hg_card_trades t
      where t.status in ('acceptee', 'refusee') and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end and (p_user is null or t.to_user = p_user))
    -- 076 (m12) : un don compte une fois par destinataire et par jour.
    when 'cartes_offertes' then (select count(distinct (t.from_user, t.to_user, (t.resolved_at at time zone 'Europe/Zurich')::date)) from hg_card_trades t
      where t.status = 'acceptee' and t.created_at = t.resolved_at and t.from_user <> t.to_user
        and t.resolved_at >= p_start and t.resolved_at < p_end and (p_user is null or t.from_user = p_user))
    when 'echanges_souhaits' then (select count(distinct t.id) from hg_card_trades t
      join hg_card_trade_items i on i.trade_id = t.id
      join hg_card_copies x on x.id = i.copy_id
      where t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end
        and ((i.side = 'from' and (p_user is null or t.to_user = p_user)
              and exists (select 1 from hg_card_wishlist w where w.user_id = t.to_user and w.card_id = x.card_id and w.created_at < t.resolved_at))
          or (i.side = 'to' and (p_user is null or t.from_user = p_user)
              and exists (select 1 from hg_card_wishlist w where w.user_id = t.from_user and w.card_id = x.card_id and w.created_at < t.resolved_at))))
    when 'partenaires_echange' then (select count(distinct (case when t.from_user = p_user then t.to_user else t.from_user end)) from hg_card_trades t
      where p_user is not null and p_user in (t.from_user, t.to_user) and t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end)
    when 'echanges_rares' then (select count(distinct t.id) from hg_card_trades t
      join hg_card_trade_items i on i.trade_id = t.id
      join hg_card_copies x on x.id = i.copy_id
      join hg_cards k on k.id = x.card_id
      where t.status = 'acceptee' and t.created_at is distinct from t.resolved_at
        and t.resolved_at >= p_start and t.resolved_at < p_end
        and k.rarity in ('rare', 'epique', 'legendaire', 'mythique', 'identite')
        and ((i.side = 'from' and (p_user is null or t.to_user = p_user)) or (i.side = 'to' and (p_user is null or t.from_user = p_user))))

    -- ---- Paillettes ----
    when 'paillettes_depensees' then (select coalesce(-sum(x.delta), 0) from hg_wallet_log x
      where x.delta < 0 and x.reason in ('booster', 'fabrication')
        and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'paillettes_gagnees' then (select coalesce(sum(x.delta), 0) from hg_wallet_log x
      where x.delta > 0 and x.reason not in ('quete', 'echange', 'admin', 'don_admin', 'bienvenue', 'Départ')
        and x.created_at >= p_start and x.created_at < p_end and (p_user is null or x.user_id = p_user))
    when 'serie_jours' then (select coalesce(max(case when w.last_daily >= (p_start at time zone 'Europe/Zurich')::date
        then w.daily_streak else 0 end), 0) from hg_wallets w where p_user is not null and w.user_id = p_user)

    -- ---- Classement et défis ----
    when 'classement_top10' then (select count(*) from hg_card_ranks() r where p_user is not null and r.user_id = p_user and r.rnk <= 10)
    when 'classement_places' then (select coalesce(max(greatest(s.rnk - r.rnk, 0)), 0)
      from hg_quest_rank_snapshot s join hg_card_ranks() r on r.user_id = s.user_id
      where p_user is not null and s.user_id = p_user and s.week = hg_quest_week(p_start))
    when 'defi_contribution' then (select coalesce(sum(public.hg_challenge_value(c.metric, p_user, greatest(c.starts_at, p_start), least(c.ends_at, p_end))), 0)
      from hg_challenges c
      where p_user is not null and c.active and c.starts_at < p_end and c.ends_at > p_start)

    -- ---- Communauté et messages ----
    when 'messages_envoyes' then (select count(*) from hg_messages m
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'interlocuteurs' then (select count(distinct (m.sender_id, cm.user_id)) from hg_messages m
      join hg_conversations c on c.id = m.conversation_id and c.kind = 'direct'
      join hg_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'reponses_messages' then (select count(distinct (m.conversation_id, m.sender_id)) from hg_messages m
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user)
        and exists (select 1 from hg_messages o where o.conversation_id = m.conversation_id and o.sender_id <> m.sender_id and o.created_at < m.created_at))
    when 'anniversaires_souhaites' then (select count(distinct (m.sender_id, cm.user_id)) from hg_messages m
      join hg_conversations c on c.id = m.conversation_id and c.kind = 'direct'
      join hg_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id <> m.sender_id
      join hg_profiles p on p.id = cm.user_id and p.birthday is not null and p.share_birthday
      where m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user)
        and to_char(p.birthday, 'MM-DD') = to_char(m.created_at at time zone 'Europe/Zurich', 'MM-DD'))
    when 'idees_proposees' then (select count(*) from hg_ideas i
      where i.created_at >= p_start and i.created_at < p_end and (p_user is null or i.user_id = p_user))
    when 'bugs_traites' then (select count(*) from hg_support s
      where s.status = 'traitee' and s.subject = coalesce((select value->'criteres'->>'bug_sujet' from hg_settings where key = 'badges'), 'Bug sur le site')
        and s.updated_at >= p_start and s.updated_at < p_end and s.user_id is not null and (p_user is null or s.user_id = p_user))
    when 'invitations_utilisees' then (select count(*) from hg_invites i
      where i.used_by is not null and i.used_at >= p_start and i.used_at < p_end and (p_user is null or i.created_by = p_user))

    -- ---- Actions enregistrées dans hg_quest_events ----
    when 'fiches_consultees' then (select count(*) from hg_quest_events q where q.kind = 'fiche_vue'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'idees_retenues' then (select count(*) from hg_quest_events q where q.kind = 'idee_retenue'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'profil_complet' then (select count(*) from hg_quest_events q where q.kind = 'profil_complet'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'anniversaire_renseigne' then (select count(*) from hg_quest_events q where q.kind = 'anniversaire'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'discord_lie' then (select count(*) from hg_quest_events q where q.kind = 'discord'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'carte_identite' then (select count(*) from hg_quest_events q where q.kind = 'carte_identite'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'app_installee' then (select count(*) from hg_quest_events q where q.kind = 'app_installee'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'tutos_lus' then (select count(*) from hg_quest_events q where q.kind = 'tuto_lu'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))
    when 'theme_change' then (select count(*) from hg_quest_events q where q.kind = 'theme_change'
      and q.created_at >= p_start and q.created_at < p_end and (p_user is null or q.user_id = p_user))

    -- ---- Secret Santa ----
    when 'ss_inscription' then (select count(*) from hg_ss_participants s
      where s.joined_at >= p_start and s.joined_at < p_end and (p_user is null or s.user_id = p_user))
    when 'ss_souhaits' then (select count(*) from hg_ss_wishes w
      where w.created_at >= p_start and w.created_at < p_end and (p_user is null or w.user_id = p_user))
    when 'ss_messages' then (select count(*) from hg_messages m join hg_conversations c on c.id = m.conversation_id
      where c.kind = 'santa' and m.sender_id = c.santa_id
        and m.created_at >= p_start and m.created_at < p_end and (p_user is null or m.sender_id = p_user))
    when 'ss_cadeau_a_temps' then (select count(*) from hg_ss_participants s join hg_ss_editions e on e.id = s.edition_id
      where s.sent_at >= p_start and s.sent_at < p_end
        and (e.send_deadline is null or (s.sent_at at time zone 'Europe/Zurich')::date <= e.send_deadline)
        and (p_user is null or s.user_id = p_user))
    else 0 end)::numeric
$function$;

-- m4 : le récapitulatif de l'année ne compte pas les fantômes.
create or replace function public.hg_year_recap(p_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with b as (select make_timestamptz(p_year,1,1,0,0,0,'Europe/Zurich') s, make_timestamptz(p_year+1,1,1,0,0,0,'Europe/Zurich') e),
  ev as (select ev.* from hg_events ev, b where ev.starts_at >= b.s and ev.starts_at < b.e and ev.starts_at < now()),
  ph as (select x.* from hg_photos x, b where x.created_at >= b.s and x.created_at < b.e)
  select case when not public.hg_is_member() then null else jsonb_build_object(
    'year', p_year,
    'gang', jsonb_build_object(
      'membres_total', (select count(*) from hg_profiles, b where not is_ghost and created_at < b.e),
      'nouveaux_membres', (select coalesce(jsonb_agg(pseudo order by created_at), '[]') from hg_profiles, b where not is_ghost and created_at >= b.s and created_at < b.e),
      'sorties', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'location', location, 'starts_at', starts_at,
                    'presents', (select count(*) from hg_event_rsvps r where r.event_id = ev.id and r.status = 'oui')) order by starts_at), '[]') from ev),
      'photos', (select count(*) from ph),
      'top_photographes', (select coalesce(jsonb_agg(t), '[]') from (select p.pseudo, count(*) n from ph join hg_profiles p on p.id = ph.user_id group by p.pseudo order by n desc limit 3) t),
      'plus_presents', (select coalesce(jsonb_agg(t), '[]') from (select p.pseudo, count(*) n from hg_event_rsvps r join ev on ev.id = r.event_id join hg_profiles p on p.id = r.user_id where r.status = 'oui' group by p.pseudo order by n desc limit 3) t),
      'secret_santa', (select jsonb_build_object('participants', (select count(*) from hg_ss_participants where edition_id = e.id),
                         'envoyes', (select count(sent_at) from hg_ss_participants where edition_id = e.id), 'status', e.status)
                       from hg_ss_editions e where e.year = p_year),
      'moments', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'happened_on', happened_on) order by happened_on), '[]') from hg_moments, b where happened_on >= b.s::date and happened_on < b.e::date),
      'badges_debloques', (select count(*) from hg_user_badges, b where awarded_at >= b.s and awarded_at < b.e),
      'messages', (select count(*) from hg_messages, b where created_at >= b.s and created_at < b.e)),
    'moi', jsonb_build_object(
      'sorties', (select count(*) from hg_event_rsvps r join ev on ev.id = r.event_id where r.user_id = auth.uid() and r.status = 'oui'),
      'photos', (select count(*) from ph where user_id = auth.uid()),
      'badges', (select coalesce(jsonb_agg(bd.name), '[]') from hg_user_badges ub join hg_badges bd on bd.code = ub.badge_code, b where ub.user_id = auth.uid() and ub.awarded_at >= b.s and ub.awarded_at < b.e),
      'secret_santa', (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = auth.uid() and e.year = p_year),
      'messages_envoyes', (select count(*) from hg_messages, b where sender_id = auth.uid() and created_at >= b.s and created_at < b.e))
  ) end $function$

;

-- ---------------------------------------------------------------------
-- Droits : RPC pour les connectés ; fonctions internes et fonctions trigger fermées aux clients.
-- ---------------------------------------------------------------------
revoke execute on function public.hg_activity_remove(bigint) from public, anon;
grant execute on function public.hg_activity_remove(bigint) to authenticated;
revoke execute on function public.hg_rsvp_admin_set(uuid, uuid, text) from public, anon;
grant execute on function public.hg_rsvp_admin_set(uuid, uuid, text) to authenticated;
revoke execute on function public.hg_gift_check(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.hg_eco_attended() from public, anon, authenticated;
revoke execute on function public.hg_cards_presence() from public, anon, authenticated;
revoke execute on function public.hg_award_badges(uuid) from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
do $r$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and p.proname like 'hg\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $r$;
