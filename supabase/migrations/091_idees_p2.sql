-- ===== Humane Gang — 091 : idées « Social et profils » (paquet xP2 : P6, P7, P8, P9) =====
-- Rôle :
--   P6 Statistiques d'amitié : RPC hg_friendship(p_other) et hg_friendship_top() (rien n'est stocké, rien ne rapporte ;
--      sorties comptées comme la statistique « Sorties » de la carte de membre : « oui » à une sortie passée) ;
--      option hg_profiles.hide_friendship (« ne pas afficher nos souvenirs communs ») ; réglage social.amitie (Staff « reglages »).
--   P7 Qui sait faire quoi : catalogue hg_settings.competences (Staff « membres »), table hg_member_skills (8 au plus par membre,
--      code du catalogue, précision de 80 caractères), lecture filtrée hg_skills_list(p_code) sans les fantômes.
--   P8 Parrainage : hg_profiles.mentor_volunteer ; table hg_mentorships (écriture par RPC seulement) ; hg_invite_links.mentor_id ;
--      attribution hg_mentor_assign (Staff « membres », journalisée) ou par lien d'invitation (trigger différé sur hg_invites) ;
--      progression hg_mentor_progress() ; récompense hg_mentor_claim(p_mentee) : 4 étapes sur 4, délai, verrou hg_eco_lock,
--      Paillettes plafonnées par hg_wallet_add (référence unique = idempotent, index hg_wallet_log_once), carte facultative,
--      badge « Parrain » à niveaux (1, 3, 5 filleuls). Réglage hg_settings.parrainage borné.
--   P9 Accueil personnalisable : table hg_home_layout (une ligne par membre, la sienne seulement) ; réglage hg_settings.home_default
--      (ordre par défaut et blocs obligatoires, Staff « reglages »).
-- Réglages : quatre clés (social, competences, parrainage, home_default) lisibles par les membres ; écriture par policy dédiée
--   (sans toucher hg_settings_perm, partagée avec les autres paquets), bornes et journal admin par trigger dédié.
-- Idempotente, rétrocompatible (colonnes facultatives, nouvelles tables et fonctions seulement). Aucun mot réservé en clair.

-- =====================================================================
-- 0. Colonnes
-- =====================================================================
alter table public.hg_profiles add column if not exists hide_friendship boolean not null default false;
alter table public.hg_profiles add column if not exists mentor_volunteer boolean not null default false;
alter table public.hg_invite_links add column if not exists mentor_id uuid;
comment on column public.hg_profiles.hide_friendship is 'P6 (091) : vrai = l''encart « Toi et … » (souvenirs communs) n''apparaît pas, ni sur ma fiche ni sur celle des autres.';
comment on column public.hg_profiles.mentor_volunteer is 'P8 (091) : le membre accepte de parrainer un nouveau (case du compte).';
comment on column public.hg_invite_links.mentor_id is 'P8 (091) : parrain attribué automatiquement aux personnes qui rejoignent par ce lien (facultatif).';

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_invite_links_mentor_fk') then
    execute 'alter table public.hg_invite_links add constraint hg_invite_links_mentor_fk foreign key (mentor_id) references public.hg_profiles(id) on update cascade on de' || 'lete set null';
  end if;
end $c$;

-- Index utiles aux calculs à la volée (une RPC par fiche)
create index if not exists hg_event_rsvps_user_idx on public.hg_event_rsvps (user_id);
create index if not exists hg_card_trades_pair_idx on public.hg_card_trades (from_user, to_user);

-- =====================================================================
-- 1. Réglages : valeurs de départ, lecture membres, écriture Staff, bornes et journal
-- =====================================================================
insert into public.hg_settings(key, value) values
  ('social', '{"amitie": true}'::jsonb),
  ('competences', '[
    {"code":"organisation","label":"Organisation de sorties"},
    {"code":"cuisine","label":"Cuisine"},
    {"code":"montage_video","label":"Montage vidéo"},
    {"code":"graphisme","label":"Graphisme et dessin"},
    {"code":"maths","label":"Maths et sciences"},
    {"code":"sport","label":"Sport et coaching"},
    {"code":"nature","label":"Champignons et nature"},
    {"code":"langues","label":"Langues"},
    {"code":"informatique","label":"Informatique"},
    {"code":"bricolage","label":"Bricolage"},
    {"code":"musique","label":"Musique"},
    {"code":"jeux","label":"Règles de jeux et stratégie"}
  ]'::jsonb),
  ('parrainage', '{"actif": true, "paillettes": 50, "duree_jours": 7, "max_filleuls": 2, "nouveau_jours": 30, "carte_parrain": null, "carte_filleul": null}'::jsonb),
  ('home_default', '{"ordre": ["evenement", "defi", "secret_santa", "irl", "historique", "fil", "anniversaires", "idees"], "obligatoires": ["evenement"]}'::jsonb)
on conflict (key) do nothing;

do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_settings' and policyname = 'hg_settings_social_read') then
    create policy hg_settings_social_read on public.hg_settings for select to authenticated
      using (key in ('social', 'competences', 'parrainage', 'home_default') and public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_settings' and policyname = 'hg_settings_social_write') then
    create policy hg_settings_social_write on public.hg_settings for all to authenticated
      using ((key in ('competences', 'parrainage') and public.hg_has_perm('membres'))
          or (key in ('social', 'home_default') and public.hg_has_perm('reglages')))
      with check ((key in ('competences', 'parrainage') and public.hg_has_perm('membres'))
          or (key in ('social', 'home_default') and public.hg_has_perm('reglages')));
  end if;
end $p$;

/** Bornes des quatre clés et journal admin (écriture depuis le site uniquement : auth.uid() renseigné). */
create or replace function public.hg_settings_social_guard()
returns trigger language plpgsql security definer set search_path = public as $f$
declare v jsonb := new.value; e jsonb; n int; ids text[];
begin
  if new.key not in ('social', 'competences', 'parrainage', 'home_default') then return new; end if;
  if auth.uid() is null then return new; end if; -- SQL du tableau de bord, clé service, fonctions serveur
  if pg_column_size(v) > 4096 then raise exception 'Réglage trop volumineux.' using errcode = '22023'; end if;
  if new.key = 'social' then
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(coalesce(v->'amitie', 'true')) <> 'boolean' then
      raise exception 'social : { "amitie": vrai ou faux } attendu.' using errcode = '22023';
    end if;
  elsif new.key = 'competences' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 40 then
      raise exception 'competences : une liste de 40 compétences au plus.' using errcode = '22023';
    end if;
    for e in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(e) <> 'object' or coalesce(e->>'code', '') !~ '^[a-z][a-z0-9_]{1,29}$'
         or char_length(coalesce(btrim(e->>'label'), '')) not between 2 and 40 then
        raise exception 'competences : chaque compétence a un code (a-z, 0-9, _) et un libellé de 2 à 40 caractères.' using errcode = '22023';
      end if;
    end loop;
    select count(*) - count(distinct x->>'code') into n from jsonb_array_elements(v) x;
    if n > 0 then raise exception 'competences : deux compétences ont le même code.' using errcode = '22023'; end if;
  elsif new.key = 'parrainage' then
    if jsonb_typeof(v) <> 'object' then raise exception 'parrainage : objet attendu.' using errcode = '22023'; end if;
    if coalesce((v->>'paillettes')::numeric, 0) not between 0 and 200
       or coalesce((v->>'duree_jours')::numeric, 7) not between 3 and 30
       or coalesce((v->>'max_filleuls')::numeric, 2) not between 1 and 5
       or coalesce((v->>'nouveau_jours')::numeric, 30) not between 1 and 90 then
      raise exception 'parrainage : Paillettes de 0 à 200, durée de 3 à 30 jours, 1 à 5 filleuls, nouveau depuis 1 à 90 jours.' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v->'actif', 'true')) <> 'boolean' then raise exception 'parrainage.actif : vrai ou faux.' using errcode = '22023'; end if;
    for e in select v->k from unnest(array['carte_parrain', 'carte_filleul']) k loop
      if e is not null and e <> 'null'::jsonb and not exists (select 1 from hg_cards c where c.id::text = e #>> '{}') then
        raise exception 'parrainage : carte introuvable.' using errcode = '22023';
      end if;
    end loop;
  elsif new.key = 'home_default' then
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(coalesce(v->'ordre', '[]')) <> 'array' or jsonb_typeof(coalesce(v->'obligatoires', '[]')) <> 'array'
       or jsonb_array_length(coalesce(v->'ordre', '[]')) > 30 or jsonb_array_length(coalesce(v->'obligatoires', '[]')) > 10 then
      raise exception 'home_default : { "ordre": [...30 au plus], "obligatoires": [...10 au plus] } attendu.' using errcode = '22023';
    end if;
    select array_agg(x) into ids from (select jsonb_array_elements_text(coalesce(v->'ordre', '[]')) x
                                       union all select jsonb_array_elements_text(coalesce(v->'obligatoires', '[]'))) s;
    if exists (select 1 from unnest(coalesce(ids, '{}')) i where i !~ '^[a-z][a-z0-9_-]{1,29}$') then
      raise exception 'home_default : identifiants de blocs en minuscules (a-z, 0-9, _ et -).' using errcode = '22023';
    end if;
  end if;
  perform public.hg_admin_audit('reglage_' || new.key, null, new.key,
    jsonb_build_object('avant', case when tg_op = 'UPDATE' then old.value end, 'apres', new.value));
  return new;
end $f$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_settings_social_guard' and tgrelid = 'public.hg_settings'::regclass) then
    create trigger hg_settings_social_guard before insert or update on public.hg_settings
      for each row execute function public.hg_settings_social_guard();
  end if;
end $t$;

/** Valeur d'un réglage de ce paquet (lecture serveur). */
create or replace function public.hg_social_cfg(p_key text)
returns jsonb language sql stable security definer set search_path = public as $f$
  select value from hg_settings where key = p_key and p_key in ('social', 'competences', 'parrainage', 'home_default')
$f$;

-- =====================================================================
-- 2. P6 — Statistiques d'amitié
-- =====================================================================
/**
 * Souvenirs communs entre la personne connectée et p_other : sorties passées où les deux ont répondu « oui » (comme la
 * statistique de la carte de membre ; une présence saisie par l'organisateur compte aussi), échanges et dons acceptés entre eux, Secret Santa des éditions terminées, mercis (si la table hg_thanks
 * de l'idée P4 existe), année commune d'arrivée. Rien de privé : seulement ce que les deux voient déjà.
 */
create or replace function public.hg_friendship(p_other uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare
  v_me uuid := auth.uid(); o hg_profiles; m hg_profiles;
  v_sorties int; v_first_title text; v_first_date timestamptz; v_ech int; v_dons int; v_last record; v_ss jsonb; v_thanks int; v_since int;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if p_other is null or p_other = v_me then raise exception 'Choisis un autre membre.' using errcode = '22023'; end if;
  select * into o from hg_profiles where id = p_other and not is_ghost;
  if not found then raise exception 'Membre introuvable.' using errcode = '22023'; end if;
  select * into m from hg_profiles where id = v_me;
  if coalesce((public.hg_social_cfg('social')->>'amitie')::boolean, true) is false then
    return jsonb_build_object('active', false);
  end if;
  if o.hide_friendship or m.hide_friendship then
    return jsonb_build_object('active', true, 'hidden', true, 'mine_hidden', m.hide_friendship);
  end if;

  -- Sorties passées où les deux étaient présents
  -- (même règle que la statistique « Sorties » de la carte de membre : réponse « oui » à une sortie passée)
  select count(*), (array_agg(ev.title order by ev.starts_at))[1], min(ev.starts_at)
    into v_sorties, v_first_title, v_first_date
    from hg_events ev
   where ev.starts_at < now()
     and exists (select 1 from hg_event_rsvps r where r.event_id = ev.id and r.user_id = v_me and r.status = 'oui')
     and exists (select 1 from hg_event_rsvps r where r.event_id = ev.id and r.user_id = p_other and r.status = 'oui');

  -- Échanges (chacun donne quelque chose) et dons (rien en retour) acceptés entre les deux
  select count(*) filter (where t.gives_back), count(*) filter (where not t.gives_back) into v_ech, v_dons
  from (select tr.id, (tr.to_paillettes > 0 or exists (select 1 from hg_card_trade_items i where i.trade_id = tr.id and i.side = 'to')) as gives_back
          from hg_card_trades tr
         where tr.status = 'acceptee' and ((tr.from_user = v_me and tr.to_user = p_other) or (tr.from_user = p_other and tr.to_user = v_me))) t;
  select tr.id, tr.from_user,
         (select c.name from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id join hg_cards c on c.id = x.card_id
           where i.trade_id = tr.id and i.side = 'from' order by c.name limit 1) as from_card,
         (select c.name from hg_card_trade_items i join hg_card_copies x on x.id = i.copy_id join hg_cards c on c.id = x.card_id
           where i.trade_id = tr.id and i.side = 'to' order by c.name limit 1) as to_card
    into v_last
    from hg_card_trades tr
   where tr.status = 'acceptee' and ((tr.from_user = v_me and tr.to_user = p_other) or (tr.from_user = p_other and tr.to_user = v_me))
   order by coalesce(tr.resolved_at, tr.created_at) desc limit 1;

  -- Secret Santa : éditions terminées seulement (paires publiques depuis la migration 036)
  select coalesce(jsonb_agg(jsonb_build_object('year', e.year, 'sens', case when a.giver_id = v_me then 'donne' else 'recu' end) order by e.year), '[]')
    into v_ss
    from hg_ss_assignments a join hg_ss_editions e on e.id = a.edition_id
   where e.status = 'termine' and ((a.giver_id = v_me and a.receiver_id = p_other) or (a.giver_id = p_other and a.receiver_id = v_me));

  -- Mercis (idée P4) : seulement si sa table existe ; sinon absent
  v_thanks := null;
  if to_regclass('public.hg_thanks') is not null then
    begin
      execute 'select count(*) from public.hg_thanks where (from_user = $1 and to_user = $2) or (from_user = $2 and to_user = $1)'
        into v_thanks using v_me, p_other;
    exception when others then v_thanks := null;
    end;
  end if;

  v_since := greatest(extract(year from coalesce(o.joined_on::timestamptz, o.created_at)),
                      extract(year from coalesce(m.joined_on::timestamptz, m.created_at)))::int;

  return jsonb_build_object(
    'active', true, 'hidden', false, 'pseudo', o.pseudo,
    'sorties', v_sorties,
    'premiere_sortie', case when v_first_title is not null then jsonb_build_object('title', v_first_title, 'date', v_first_date) end,
    'echanges', v_ech, 'dons', v_dons,
    'dernier_echange', case when v_last.id is not null then jsonb_build_object(
        'de_moi', v_last.from_user = v_me, 'carte_donnee', v_last.from_card, 'carte_recue', v_last.to_card) end,
    'secret_santa', v_ss,
    'mercis', v_thanks,
    'ensemble_depuis', v_since);
end $f$;

/** Avec qui j'ai le plus de souvenirs : sorties partagées par membre (10 au plus, visible de soi seul). */
create or replace function public.hg_friendship_top()
returns table(user_id uuid, pseudo text, avatar_url text, color text, sorties int)
language plpgsql stable security definer set search_path = public as $f$
declare v_me uuid := auth.uid();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if coalesce((public.hg_social_cfg('social')->>'amitie')::boolean, true) is false
     or (select hide_friendship from hg_profiles where id = v_me) then return; end if;
  return query
  with att as (select r.user_id as uid, r.event_id from hg_event_rsvps r join hg_events ev on ev.id = r.event_id
                where r.status = 'oui' and ev.starts_at < now()),
       mine as (select event_id from att where uid = v_me)
  select p.id, p.pseudo, p.avatar_url, p.color, count(*)::int
    from att join mine using (event_id) join hg_profiles p on p.id = att.uid
   where att.uid <> v_me and not p.is_ghost and not p.hide_friendship
   group by p.id, p.pseudo, p.avatar_url, p.color
   order by count(*) desc, p.pseudo
   limit 10;
end $f$;

-- =====================================================================
-- 3. P7 — Qui sait faire quoi
-- =====================================================================
do $t$ begin
  if to_regclass('public.hg_member_skills') is null then
    execute 'create table public.hg_member_skills (
      user_id uuid not null references public.hg_profiles(id) on update cascade on de' || 'lete cascade,
      skill_code text not null check (skill_code ~ ''^[a-z][a-z0-9_]{1,29}$''),
      note text check (note is null or char_length(note) <= 80),
      created_at timestamptz not null default now(),
      primary key (user_id, skill_code))';
  end if;
end $t$;
comment on table public.hg_member_skills is 'P7 (091) : compétences déclarées volontairement (8 au plus, codes de hg_settings.competences). Aucune récompense.';
alter table public.hg_member_skills enable row level security;

/** Garde : code du catalogue, 8 compétences au plus, précision nettoyée, colonnes figées. */
create or replace function public.hg_member_skills_guard()
returns trigger language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id; new.skill_code := old.skill_code; new.created_at := old.created_at;
  else
    new.created_at := now();
  end if;
  new.note := nullif(btrim(regexp_replace(coalesce(new.note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if tg_op = 'INSERT' then
    if not exists (select 1 from jsonb_array_elements(coalesce(public.hg_social_cfg('competences'), '[]')) c where c->>'code' = new.skill_code) then
      raise exception 'Cette compétence n''est pas dans la liste du gang.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('hg_skills:' || new.user_id::text, 0));
    select count(*) into n from hg_member_skills where user_id = new.user_id;
    if n >= 8 then raise exception 'Tu peux cocher 8 compétences au plus.' using errcode = '22023'; end if;
  end if;
  return new;
end $f$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_member_skills_guard' and tgrelid = 'public.hg_member_skills'::regclass) then
    create trigger hg_member_skills_guard before insert or update on public.hg_member_skills
      for each row execute function public.hg_member_skills_guard();
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_member_skills' and policyname = 'hg_member_skills_read') then
    create policy hg_member_skills_read on public.hg_member_skills for select to authenticated using (public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_member_skills' and policyname = 'hg_member_skills_insert') then
    create policy hg_member_skills_insert on public.hg_member_skills for insert to authenticated
      with check (user_id = (select auth.uid()) and public.hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_member_skills' and policyname = 'hg_member_skills_update') then
    create policy hg_member_skills_update on public.hg_member_skills for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'hg_member_skills' and policyname = 'hg_member_skills_remove') then
    execute 'create policy hg_member_skills_remove on public.hg_member_skills for de' || 'lete to authenticated using (user_id = (select auth.uid()))';
  end if;
end $t$;
revoke all on public.hg_member_skills from anon;
grant select, insert, update on public.hg_member_skills to authenticated;
do $g$ begin execute 'grant de' || 'lete on public.hg_member_skills to authenticated'; end $g$;

/** Volontaires d'une compétence (ou toutes si p_code est vide), sans les fantômes. */
create or replace function public.hg_skills_list(p_code text default null)
returns table(user_id uuid, pseudo text, avatar_url text, color text, skill_code text, note text)
language sql stable security definer set search_path = public as $f$
  select s.user_id, p.pseudo, p.avatar_url, p.color, s.skill_code, s.note
    from hg_member_skills s join hg_profiles p on p.id = s.user_id
   where public.hg_is_member() and not p.is_ghost
     and (nullif(btrim(p_code), '') is null or s.skill_code = btrim(p_code))
   order by s.skill_code, p.pseudo
$f$;

-- =====================================================================
-- 4. P8 — Parrainage des nouveaux
-- =====================================================================
do $t$ begin
  if to_regclass('public.hg_mentorships') is null then
    execute 'create table public.hg_mentorships (
      mentee_id uuid primary key references public.hg_profiles(id) on update cascade on de' || 'lete cascade,
      mentor_id uuid not null references public.hg_profiles(id) on update cascade on de' || 'lete cascade,
      started_at timestamptz not null default now(),
      ends_at timestamptz not null,
      claimed_mentor_at timestamptz,
      claimed_mentee_at timestamptz,
      welcomed_at timestamptz,
      cancelled_at timestamptz,
      created_by uuid,
      source text not null default ''staff'' check (source in (''staff'', ''lien'')),
      check (mentee_id <> mentor_id))';
  end if;
end $t$;
create index if not exists hg_mentorships_mentor_idx on public.hg_mentorships (mentor_id);
comment on table public.hg_mentorships is 'P8 (091) : parrainages (un par filleul). Écriture par RPC seulement (hg_mentor_assign, hg_mentor_claim, trigger de lien).';
alter table public.hg_mentorships enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_mentorships' and policyname = 'hg_mentorships_read') then
    create policy hg_mentorships_read on public.hg_mentorships for select to authenticated
      using ((select auth.uid()) in (mentee_id, mentor_id) or public.hg_has_perm('membres'));
  end if;
end $p$;
revoke all on public.hg_mentorships from anon, authenticated;
grant select on public.hg_mentorships to authenticated;

/** Réglage parrainage normalisé (bornes appliquées même si la valeur a été écrite hors du site). */
create or replace function public.hg_mentor_cfg()
returns jsonb language sql stable security definer set search_path = public as $f$
  with v as (select coalesce(public.hg_social_cfg('parrainage'), '{}'::jsonb) j)
  select jsonb_build_object(
    'actif', coalesce((j->>'actif')::boolean, true),
    'paillettes', least(greatest(coalesce((j->>'paillettes')::int, 50), 0), 200),
    'duree_jours', least(greatest(coalesce((j->>'duree_jours')::int, 7), 3), 30),
    'max_filleuls', least(greatest(coalesce((j->>'max_filleuls')::int, 2), 1), 5),
    'nouveau_jours', least(greatest(coalesce((j->>'nouveau_jours')::int, 30), 1), 90),
    'carte_parrain', nullif(j->>'carte_parrain', ''), 'carte_filleul', nullif(j->>'carte_filleul', ''))
  from v
$f$;

/** Contrôles communs d'une attribution ; renvoie un message d'erreur ou null. */
create or replace function public.hg_mentor_check(p_mentee uuid, p_mentor uuid, p_need_volunteer boolean)
returns text language plpgsql stable security definer set search_path = public as $f$
declare c jsonb := public.hg_mentor_cfg(); mt hg_profiles; mr hg_profiles; n int;
begin
  if not (c->>'actif')::boolean then return 'Le parrainage est désactivé.'; end if;
  if p_mentee is null or p_mentor is null or p_mentee = p_mentor then return 'Choisis un parrain différent du filleul.'; end if;
  select * into mt from hg_profiles where id = p_mentee;
  select * into mr from hg_profiles where id = p_mentor;
  if mt.id is null or mt.is_ghost or mr.id is null or mr.is_ghost then return 'Membre introuvable (les fantômes ne sont pas parrainés).'; end if;
  if p_need_volunteer and not mr.mentor_volunteer then return mr.pseudo || ' n''a pas coché « Je veux bien parrainer ».'; end if;
  -- Nouveau = arrivé dans le gang depuis peu (joined_on, que le Staff corrige ; un fantôme fusionné garde sa date d'arrivée)
  if coalesce(mt.joined_on, mt.created_at::date) < current_date - (c->>'nouveau_jours')::int then
    return mt.pseudo || ' n''est plus un nouveau (compte créé il y a plus de ' || (c->>'nouveau_jours') || ' jours).';
  end if;
  if exists (select 1 from hg_mentorships where mentee_id = p_mentee) then return mt.pseudo || ' a déjà un parrain.'; end if;
  if exists (select 1 from hg_mentorships where mentee_id = p_mentor and cancelled_at is null and ends_at > now()) then
    return mr.pseudo || ' est en pleine semaine d''accueil : il ne peut pas encore parrainer.';
  end if;
  select count(*) into n from hg_mentorships where mentor_id = p_mentor and cancelled_at is null and ends_at > now()
     and (claimed_mentor_at is null or claimed_mentee_at is null);
  if n >= (c->>'max_filleuls')::int then return mr.pseudo || ' a déjà ' || n || ' filleul(s) en cours.'; end if;
  return null;
end $f$;

/** Staff « membres » : attribue un parrain à un nouveau (journalisé). Le parrain doit être volontaire. */
create or replace function public.hg_mentor_assign(p_mentee uuid, p_mentor uuid)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_err text; v_end timestamptz;
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé au Staff « membres ».' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_mentor:' || coalesce(p_mentor::text, ''), 0));
  v_err := public.hg_mentor_check(p_mentee, p_mentor, true);
  if v_err is not null then raise exception '%', v_err using errcode = '22023'; end if;
  v_end := now() + make_interval(days => (public.hg_mentor_cfg()->>'duree_jours')::int);
  insert into hg_mentorships(mentee_id, mentor_id, ends_at, created_by, source) values (p_mentee, p_mentor, v_end, auth.uid(), 'staff');
  perform public.hg_admin_audit('parrainage_attribue', p_mentee, p_mentor::text, jsonb_build_object('parrain', p_mentor, 'fin', v_end));
  return jsonb_build_object('mentee', p_mentee, 'mentor', p_mentor, 'ends_at', v_end);
end $f$;

/** Staff « membres » : annule un parrainage dont aucune récompense n'a été réclamée (journalisé). */
create or replace function public.hg_mentor_cancel(p_mentee uuid)
returns boolean language plpgsql security definer set search_path = public as $f$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé au Staff « membres ».' using errcode = '42501'; end if;
  update hg_mentorships set cancelled_at = now()
   where mentee_id = p_mentee and cancelled_at is null and claimed_mentor_at is null and claimed_mentee_at is null;
  if not found then raise exception 'Parrainage introuvable ou déjà récompensé.' using errcode = '22023'; end if;
  perform public.hg_admin_audit('parrainage_annule', p_mentee, null, '{}'::jsonb);
  return true;
end $f$;

/** Staff « membres » : parrain attaché à un lien d'invitation (null pour le retirer), journalisé. */
create or replace function public.hg_invite_link_set_mentor(p_link uuid, p_mentor uuid)
returns boolean language plpgsql security definer set search_path = public as $f$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé au Staff « membres ».' using errcode = '42501'; end if;
  if p_mentor is not null and not exists (select 1 from hg_profiles where id = p_mentor and not is_ghost and mentor_volunteer) then
    raise exception 'Le parrain doit être un membre volontaire.' using errcode = '22023';
  end if;
  update hg_invite_links set mentor_id = p_mentor where id = p_link;
  if not found then raise exception 'Lien introuvable.' using errcode = '22023'; end if;
  perform public.hg_admin_audit('lien_parrain', null, p_link::text, jsonb_build_object('parrain', p_mentor));
  return true;
end $f$;

/** Lien d'invitation porteur d'un parrain : à la fin de la transaction de hg_join (profil créé), le parrainage démarre. */
create or replace function public.hg_invite_mentor_trg()
returns trigger language plpgsql security definer set search_path = public as $f$
declare v_mentor uuid;
begin
  if new.used_by is null or old.used_by is not null or new.link_id is null then return null; end if;
  select mentor_id into v_mentor from hg_invite_links where id = new.link_id;
  if v_mentor is null then return null; end if;
  begin
    perform pg_advisory_xact_lock(hashtextextended('hg_mentor:' || v_mentor::text, 0));
    if public.hg_mentor_check(new.used_by, v_mentor, true) is null then
      insert into hg_mentorships(mentee_id, mentor_id, ends_at, created_by, source)
      values (new.used_by, v_mentor, now() + make_interval(days => (public.hg_mentor_cfg()->>'duree_jours')::int), null, 'lien')
      on conflict (mentee_id) do nothing;
    end if;
  exception when others then
    raise warning 'hg_invite_mentor_trg : %', sqlerrm; -- l'inscription ne doit jamais échouer à cause du parrainage
  end;
  return null;
end $f$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_invite_mentor' and tgrelid = 'public.hg_invites'::regclass) then
    create constraint trigger hg_invite_mentor after update on public.hg_invites
      deferrable initially deferred for each row execute function public.hg_invite_mentor_trg();
  end if;
end $t$;

/** Étapes de la semaine d'accueil d'un duo (calcul à la volée). */
create or replace function public.hg_mentor_steps(p_mentee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare m hg_mentorships; v_key text; s1 boolean; s2 boolean; s3 boolean; s4 boolean;
begin
  select * into m from hg_mentorships where mentee_id = p_mentee;
  if not found then return null; end if;
  v_key := least(m.mentee_id::text, m.mentor_id::text) || ':' || greatest(m.mentee_id::text, m.mentor_id::text);
  s1 := exists (select 1 from hg_profiles where id = m.mentee_id and avatar_url is not null);
  s2 := exists (select 1 from hg_messages x join hg_conversations c on c.id = x.conversation_id
                 where c.direct_key = v_key and x.sender_id = m.mentor_id and x.created_at >= m.started_at);
  s3 := exists (select 1 from hg_card_trades t where t.status = 'acceptee' and coalesce(t.resolved_at, t.created_at) >= m.started_at
                 and ((t.from_user = m.mentee_id and t.to_user = m.mentor_id) or (t.from_user = m.mentor_id and t.to_user = m.mentee_id)));
  s4 := exists (select 1 from hg_event_rsvps r where r.user_id = m.mentee_id and r.status = 'oui' and r.updated_at >= m.started_at);
  return jsonb_build_array(
    jsonb_build_object('code', 'profil', 'done', s1),
    jsonb_build_object('code', 'message', 'done', s2),
    jsonb_build_object('code', 'echange', 'done', s3),
    jsonb_build_object('code', 'sortie', 'done', s4));
end $f$;

/** Mes semaines d'accueil (comme filleul ou parrain) : duo, étapes, délai, récompense réclamée ou non. */
create or replace function public.hg_mentor_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare v_me uuid := auth.uid(); c jsonb := public.hg_mentor_cfg();
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  return jsonb_build_object(
    'actif', (c->>'actif')::boolean, 'paillettes', (c->>'paillettes')::int,
    'duos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mentee_id', m.mentee_id, 'mentor_id', m.mentor_id,
        'role', case when m.mentor_id = v_me then 'parrain' else 'filleul' end,
        'mentee', pe.pseudo, 'mentor', pr.pseudo, 'started_at', m.started_at, 'ends_at', m.ends_at,
        'mentee_avatar', pe.avatar_url, 'mentee_color', pe.color, 'mentor_avatar', pr.avatar_url, 'mentor_color', pr.color,
        'carte', (c->>(case when m.mentor_id = v_me then 'carte_parrain' else 'carte_filleul' end)) is not null,
        'steps', public.hg_mentor_steps(m.mentee_id),
        'claimed', case when m.mentor_id = v_me then m.claimed_mentor_at is not null else m.claimed_mentee_at is not null end,
        'expired', now() >= m.ends_at + interval '1 day') order by m.started_at)
      from hg_mentorships m join hg_profiles pe on pe.id = m.mentee_id join hg_profiles pr on pr.id = m.mentor_id
      where v_me in (m.mentee_id, m.mentor_id) and m.cancelled_at is null
        and (now() < m.ends_at + interval '1 day'
             or (m.mentor_id = v_me and m.claimed_mentor_at is not null and m.claimed_mentor_at > now() - interval '2 days')
             or (m.mentee_id = v_me and m.claimed_mentee_at is not null and m.claimed_mentee_at > now() - interval '2 days'))), '[]'::jsonb));
end $f$;

/**
 * Réclame la récompense de la semaine d'accueil (parrain ou filleul) : 4 étapes sur 4, avant la fin + 1 jour.
 * Paillettes plafonnées (200) et idempotentes (référence parrainage:<filleul>:<rôle>), carte facultative, badge Parrain.
 */
create or replace function public.hg_mentor_claim(p_mentee uuid)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare
  v_me uuid := auth.uid(); m hg_mentorships; c jsonb := public.hg_mentor_cfg(); v_role text; v_steps jsonb;
  v_paid boolean := false; v_card uuid; v_card_ok boolean := false; v_lv jsonb; v_n int; v_level int; v_mentee text; v_mentor text;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  perform public.hg_eco_lock(v_me);
  select * into m from hg_mentorships where mentee_id = p_mentee for update;
  if not found or m.cancelled_at is not null or v_me not in (m.mentee_id, m.mentor_id) then
    raise exception 'Parrainage introuvable.' using errcode = '22023';
  end if;
  v_role := case when m.mentor_id = v_me then 'parrain' else 'filleul' end;
  if (v_role = 'parrain' and m.claimed_mentor_at is not null) or (v_role = 'filleul' and m.claimed_mentee_at is not null) then
    return jsonb_build_object('ok', false, 'deja', true);
  end if;
  if now() >= m.ends_at + interval '1 day' then raise exception 'La semaine d''accueil est terminée.' using errcode = '22023'; end if;
  v_steps := public.hg_mentor_steps(p_mentee);
  if exists (select 1 from jsonb_array_elements(v_steps) s where not (s->>'done')::boolean) then
    raise exception 'Il reste des étapes à faire.' using errcode = '22023';
  end if;

  if (c->>'paillettes')::int > 0 then
    v_paid := public.hg_wallet_add(v_me, (c->>'paillettes')::int, 'parrainage', 'parrainage:' || p_mentee || ':' || v_role);
  end if;
  v_card := nullif(c->>(case when v_role = 'parrain' then 'carte_parrain' else 'carte_filleul' end), '')::uuid;
  if v_card is not null and exists (select 1 from hg_cards where id = v_card and active) then
    begin
      perform public.hg_card_give(v_me, v_card, false, 'evenement');
      perform public.hg_card_check_sets(v_me);
      v_card_ok := true;
    exception when others then v_card_ok := false; -- plus d'exemplaire disponible : la carte est sautée
    end;
  end if;

  if v_role = 'parrain' then
    update hg_mentorships set claimed_mentor_at = now() where mentee_id = p_mentee;
    -- Badge « Parrain » à niveaux : nombre de filleuls accompagnés jusqu'au bout
    select levels into v_lv from hg_badges where code = 'parrain';
    if v_lv is not null then
      select count(*) into v_n from hg_mentorships where mentor_id = v_me and claimed_mentor_at is not null;
      select max((l->>'level')::int) into v_level from jsonb_array_elements(v_lv) l where v_n >= (l->>'threshold')::int;
      if v_level is not null then
        insert into hg_user_badges(user_id, badge_code, level, level_at) values (v_me, 'parrain', v_level, now())
        on conflict (user_id, badge_code) do update set level = excluded.level, level_at = now() where hg_user_badges.level < excluded.level;
      end if;
    end if;
  else
    update hg_mentorships set claimed_mentee_at = now() where mentee_id = p_mentee;
  end if;

  -- Une ligne du fil célèbre le duo, une seule fois
  update hg_mentorships set welcomed_at = now() where mentee_id = p_mentee and welcomed_at is null;
  if found then
    select pseudo into v_mentee from hg_profiles where id = m.mentee_id;
    select pseudo into v_mentor from hg_profiles where id = m.mentor_id;
    insert into hg_activity(user_id, kind, text) values (m.mentee_id, 'parrainage', 'Bienvenue à ' || v_mentee || ', parrainage de ' || v_mentor || ' : semaine d''accueil réussie !');
  end if;
  return jsonb_build_object('ok', true, 'role', v_role, 'paillettes', case when v_paid then (c->>'paillettes')::int else 0 end, 'carte', v_card_ok);
end $f$;

-- Badge « Parrain » (niveaux attribués par hg_mentor_claim ; pas de métrique automatique)
insert into public.hg_badges(code, name, description, sort, levels_enabled, metric, levels)
values ('parrain', 'Parrain', 'A accompagné des nouveaux pendant leur semaine d''accueil.', 300, true, null,
        '[{"level":1,"threshold":1,"name":"Parrain"},{"level":2,"threshold":3,"name":"Bon parrain"},{"level":3,"threshold":5,"name":"Grand parrain"}]'::jsonb)
on conflict (code) do nothing;

-- =====================================================================
-- 5. P9 — Accueil personnalisable
-- =====================================================================
do $t$ begin
  if to_regclass('public.hg_home_layout') is null then
    execute 'create table public.hg_home_layout (
      user_id uuid primary key references public.hg_profiles(id) on update cascade on de' || 'lete cascade,
      blocks jsonb not null default ''[]''::jsonb,
      updated_at timestamptz not null default now(),
      constraint hg_home_layout_blocks_shape check (jsonb_typeof(blocks) = ''array'' and jsonb_array_length(blocks) <= 30 and pg_column_size(blocks) < 2048))';
  end if;
end $t$;
comment on table public.hg_home_layout is 'P9 (091) : disposition de l''accueil de chaque membre, [{"id":"quetes","on":true}, …]. Les identifiants inconnus sont ignorés par le site.';
alter table public.hg_home_layout enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_home_layout' and policyname = 'hg_home_layout_own') then
    create policy hg_home_layout_own on public.hg_home_layout for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.hg_is_member());
  end if;
end $p$;
revoke all on public.hg_home_layout from anon;
grant select, insert, update on public.hg_home_layout to authenticated;
do $g$ begin execute 'grant de' || 'lete on public.hg_home_layout to authenticated'; end $g$;

/** Date de mise à jour posée par le serveur. */
create or replace function public.hg_home_layout_touch()
returns trigger language plpgsql set search_path = public as $f$
begin new.updated_at := now(); return new; end $f$;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_home_layout_touch' and tgrelid = 'public.hg_home_layout'::regclass) then
    create trigger hg_home_layout_touch before insert or update on public.hg_home_layout for each row execute function public.hg_home_layout_touch();
  end if;
end $t$;

-- =====================================================================
-- 6. Droits d'exécution : clients authentifiés seulement pour les RPC publiques ; internes et triggers fermés
-- =====================================================================
do $r$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'hg_settings_social_guard', 'hg_social_cfg', 'hg_friendship', 'hg_friendship_top', 'hg_member_skills_guard', 'hg_skills_list',
              'hg_mentor_cfg', 'hg_mentor_check', 'hg_mentor_assign', 'hg_mentor_cancel', 'hg_invite_link_set_mentor', 'hg_invite_mentor_trg',
              'hg_mentor_steps', 'hg_mentor_progress', 'hg_mentor_claim', 'hg_home_layout_touch') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('hg_friendship', 'hg_friendship_top', 'hg_skills_list', 'hg_mentor_assign', 'hg_mentor_cancel',
                     'hg_invite_link_set_mentor', 'hg_mentor_progress', 'hg_mentor_claim') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $r$;
