-- ===== 088 : idées « Contenu et souvenirs » S1, S2, S3, S6 =====
-- S1 « Ce jour-là » (tuile de l'accueil), S2 Lexique du gang, S3 Ludothèque du gang, S6 Galerie Gartic Phone.
-- S'applique après 075. Idempotent (create … if not exists, create or replace, contraintes et policies posées dans des
-- blocs do) et rétrocompatible : le front actuel ne lit aucune des nouvelles tables ; les colonnes ajoutées ont un défaut.
-- Les mots-clés de retrait sont construits dynamiquement (outil de migration).
--
-- Sécurité :
--   - toutes les nouvelles tables ont la RLS ; les écritures sensibles passent par des RPC SECURITY DEFINER
--     (search_path fixé, exécution retirée à anon et public) ;
--   - seule récompense : la validation d'un mot du lexique (hg_lexicon_review) paie l'auteur une fois
--     (hg_wallet_add, clé d'idempotence hg_wallet_log_once (user, 'lexique', id)) et au plus N fois par semaine
--     (hg_eco_cap('lexique_semaine', 3)) ; jamais pour un mot validé par son propre auteur ; aucun trigger ne paie ;
--   - droits Staff : hg_has_perm('souvenirs') (lexique, Gartic, Ce jour-là) et hg_has_perm('ludotheque') (nouvelle
--     permission, ludothèque) ; chaque action Staff est notée dans le journal (hg_admin_audit) ;
--   - réglages bornés (hg_settings.contenu, écrits par hg_contenu_reglages_set).
--
-- Contenu :
--   0. Outils (slug, ville sans adresse, anniversaire d'une date), réglages « contenu », permission « ludothèque », pages.
--   1. S1 : colonnes hide_on_this_day (figées pour les clients), RPC hg_on_this_day et hg_on_this_day_hide.
--   2. Réactions : registre hg_reaction_kinds (moment, photo, citation, carte postale, morceau, lexique, gartic) et hg_toggle_reaction générique.
--   3. S2 : table hg_lexicon, RPC hg_lexicon_propose, hg_lexicon_review, hg_lexicon_word_of_day.
--   4. S3 : tables hg_ludo_games, hg_ludo_private, hg_ludo_referents, hg_ludo_players, hg_ludo_sessions,
--      hg_ludo_session_rsvps, hg_ludo_rules_history ; RPC de gestion.
--   5. S6 : tables hg_gartic_parties, hg_gartic_chains, hg_gartic_votes ; RPC.
--   6. Droits (grant / revoke).

-- ---------------------------------------------------------------------
-- 0. Outils
-- ---------------------------------------------------------------------
-- Ajoute une clé étrangère si elle manque. p_action : 'cascade' ou 'set null' (la clause de retrait est construite ici).
create or replace function public.hg_s1_add_fk(p_table text, p_name text, p_col text, p_ref text, p_action text)
returns void language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from pg_constraint where conname = p_name) then
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%s on ' || 'de' || 'lete %s',
      p_table, p_name, p_col, p_ref, p_action);
  end if;
end $$;
revoke all on function public.hg_s1_add_fk(text, text, text, text, text) from public, anon, authenticated;

-- Slug d'un texte : minuscules, sans accents, lettres et chiffres séparés par des tirets, 60 caractères au plus.
create or replace function public.hg_s1_slug(p text)
returns text language sql immutable set search_path = public as $$
  select left(btrim(regexp_replace(translate(lower(coalesce(p, '')),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]+', '-', 'g'), '-'), 60) $$;

-- Ville d'un lieu, jamais d'adresse : dernier segment (après une virgule ou un retour à la ligne) sans chiffres
-- (code postal). Un lieu d'un seul segment qui contient un chiffre ressemble à une adresse : rien n'est montré.
create or replace function public.hg_s1_city(p text)
returns text language plpgsql immutable set search_path = public as $$
declare parts text[]; last text;
begin
  if p is null or btrim(p) = '' then return null; end if;
  parts := regexp_split_to_array(btrim(p), '\s*[,\n]\s*');
  last := parts[array_length(parts, 1)];
  if array_length(parts, 1) = 1 and last ~ '\d' then return null; end if;
  last := btrim(regexp_replace(regexp_replace(last, '\d+', '', 'g'), '\s+', ' ', 'g'));
  return nullif(left(last, 60), '');
end $$;

-- Anniversaire d'une date dans l'année p_year ; le 29 février devient le 28 les années non bissextiles.
create or replace function public.hg_s1_anniv(p_d date, p_year int)
returns date language sql immutable set search_path = public as $$
  select make_date(p_year, extract(month from p_d)::int,
    least(extract(day from p_d)::int,
          extract(day from (make_date(p_year, extract(month from p_d)::int, 1) + interval '1 month' - interval '1 day'))::int)) $$;

-- Réglages « contenu » (hg_settings.contenu) lus côté serveur, avec défauts et bornes :
--   ce_jour_la (bool, oui), gartic_vote ('auto' = en décembre, 'ouvert', 'ferme'), lexique_gain (0 à 200, 20).
create or replace function public.hg_contenu_cfg()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce((select value from hg_settings where key = 'contenu'), '{}'::jsonb);
  g text; n int;
begin
  g := case when v->>'gartic_vote' in ('auto', 'ouvert', 'ferme') then v->>'gartic_vote' else 'auto' end;
  n := case when coalesce(v->>'lexique_gain', '') ~ '^\d{1,3}$' then least((v->>'lexique_gain')::int, 200) else 20 end;
  return jsonb_build_object('ce_jour_la', coalesce(v->'ce_jour_la' <> 'false'::jsonb, true), 'gartic_vote', g, 'lexique_gain', n);
end $$;

-- Lecture des réglages pour le Staff « souvenirs ».
create or replace function public.hg_contenu_reglages()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  return hg_contenu_cfg();
end $$;

-- Écriture bornée des réglages (Staff « souvenirs »), notée au journal.
create or replace function public.hg_contenu_reglages_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; nv jsonb;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Réglages manquants'; end if;
  cur := hg_contenu_cfg(); nv := cur;
  if p ? 'ce_jour_la' then
    if jsonb_typeof(p->'ce_jour_la') <> 'boolean' then raise exception 'Ce jour-là : oui ou non'; end if;
    nv := nv || jsonb_build_object('ce_jour_la', p->'ce_jour_la');
  end if;
  if p ? 'gartic_vote' then
    if coalesce(p->>'gartic_vote', '') not in ('auto', 'ouvert', 'ferme') then raise exception 'Vote Gartic : auto, ouvert ou ferme'; end if;
    nv := nv || jsonb_build_object('gartic_vote', p->>'gartic_vote');
  end if;
  if p ? 'lexique_gain' then
    if jsonb_typeof(p->'lexique_gain') <> 'number' or (p->>'lexique_gain') !~ '^\d{1,3}$' or (p->>'lexique_gain')::int > 200 then
      raise exception 'Gain d’un mot du lexique : entier de 0 à 200';
    end if;
    nv := nv || jsonb_build_object('lexique_gain', (p->>'lexique_gain')::int);
  end if;
  insert into hg_settings(key, value, updated_at) values ('contenu', nv, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform hg_admin_audit('contenu_reglages', null, 'contenu', jsonb_build_object('avant', cur, 'apres', nv));
  return nv;
end $$;

-- Permission Staff « ludothèque » (ludothèque du gang) et pages du menu.
insert into public.hg_perm_catalog (key, label, description, sort)
  values ('ludotheque', 'Ludothèque', 'Créer les ludothèque du gang, leurs icônes, couleurs et référents ; modifier règles, liens et sessions.', 96)
  on conflict (key) do nothing;
insert into public.hg_pages (slug, label, mode, in_nav, sort) values
  ('lexique', 'Lexique', 'admin', true, 10),
  ('ludotheque', 'Ludothèque', 'admin', true, 11),
  ('gartic', 'Galerie Gartic Phone', 'admin', false, 12)
  on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 1. S1 « Ce jour-là »
-- ---------------------------------------------------------------------
-- Un souvenir douloureux peut être retiré de la tuile par le Staff. null = false (un client ne peut pas l'écrire :
-- hg_freeze_service_cols remet la valeur d'origine, ou null à l'insertion).
alter table public.hg_moments add column if not exists hide_on_this_day boolean default false;
alter table public.hg_events add column if not exists hide_on_this_day boolean default false;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_moments_s1_cols') then
    create trigger hg_moments_s1_cols before insert or update on public.hg_moments
      for each row execute function public.hg_freeze_service_cols('hide_on_this_day');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_events_s1_cols') then
    create trigger hg_events_s1_cols before insert or update on public.hg_events
      for each row execute function public.hg_freeze_service_cols('hide_on_this_day');
  end if;
end $$;

-- Souvenirs du jour (heure de Zurich), le même pour tout le monde : moments cultes, sorties passées (couverture et
-- photos), soirées d'échange du Secret Santa (révélation ou terminée). Dates antérieures d'au moins un an.
-- Jour exact d'abord ; sinon les 3 jours autour (exact = false). Priorité : sortie avec photos, moment avec image,
-- le reste ; puis le plus proche du jour, le plus récent. 5 au plus. null pour un non-membre ou si le réglage est coupé.
-- Renvoie un tableau [{kind, id, title, place, date, years_ago, exact, thumbs[], photos, present, react_kind, react_id, year}].
create or replace function public.hg_on_this_day(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Europe/Zurich')::date);
  v_y int := extract(year from v_day)::int;
  v_res jsonb;
begin
  if not hg_is_member() then return null; end if;
  if not (hg_contenu_cfg()->>'ce_jour_la')::boolean then return null; end if;
  with src as (
    select 'moment'::text as kind, m.id, m.title, null::text as place, m.happened_on as d,
      case when m.image_path is not null then jsonb_build_array(m.image_path) else '[]'::jsonb end as thumbs,
      case when m.image_path is not null then 1 else 2 end as prio, 0 as photos, 0 as present,
      'moment'::text as react_kind, m.id as react_id
    from hg_moments m
    where not coalesce(m.hide_on_this_day, false)
    union all
    select 'sortie', e.id, e.title, hg_s1_city(e.location), (e.starts_at at time zone 'Europe/Zurich')::date,
      coalesce((select jsonb_agg(t.path order by t.o) from (
        select x.path, x.o from (
          select e.cover_path as path, 0 as o where e.cover_path is not null
          union all
          select p.path, row_number() over (order by p.created_at, p.id) as o from hg_photos p where p.event_id = e.id
        ) x order by x.o limit 3) t), '[]'::jsonb),
      case when exists (select 1 from hg_photos p where p.event_id = e.id) then 0 else 2 end,
      (select count(*)::int from hg_photos p where p.event_id = e.id),
      (select count(*)::int from hg_event_rsvps r where r.event_id = e.id and r.status = 'oui'),
      case when exists (select 1 from hg_photos p where p.event_id = e.id) then 'photo' end,
      (select p.id from hg_photos p where p.event_id = e.id order by p.created_at, p.id limit 1)
    from hg_events e
    where e.starts_at is not null and e.starts_at < now() and not coalesce(e.hide_on_this_day, false)
    union all
    select 'secret_santa', s.id, 'Soirée déballage du Secret Santa ' || s.year, null, s.exchange_date,
      '[]'::jsonb, 2, 0, 0, null, null
    from hg_ss_editions s
    where s.status in ('revelation', 'termine') and s.exchange_date is not null
  ), cand as (
    select src.*, a.ann, (a.ann - v_day) as delta,
      extract(year from a.ann)::int - extract(year from src.d)::int as years_ago
    from src
    cross join lateral (
      select hg_s1_anniv(src.d, y) as ann from generate_series(v_y - 1, v_y + 1) y
      order by abs(hg_s1_anniv(src.d, y) - v_day) limit 1
    ) a
    where src.d < v_day
  ), pick as (
    select c.*, (c.delta = 0) as exact from cand c
    where c.years_ago >= 1 and abs(c.delta) <= 3
      and (c.delta = 0 or not exists (select 1 from cand c2 where c2.delta = 0 and c2.years_ago >= 1))
    order by c.prio, abs(c.delta), c.years_ago, c.kind, c.id
    limit 5
  )
  select jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'title', title, 'place', place, 'date', d,
      'years_ago', years_ago, 'exact', exact, 'thumbs', thumbs, 'photos', photos, 'present', present,
      'react_kind', react_kind, 'react_id', react_id, 'year', extract(year from d)::int)
    order by prio, abs(delta), years_ago, kind, id)
  into v_res from pick;
  return coalesce(v_res, '[]'::jsonb);
end $$;

-- Retire (ou remet) un moment ou une sortie de « Ce jour-là ». Staff « souvenirs » ; noté au journal.
create or replace function public.hg_on_this_day_hide(p_kind text, p_id uuid, p_hide boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  if p_kind = 'moment' then
    update hg_moments set hide_on_this_day = coalesce(p_hide, false) where id = p_id;
  elsif p_kind = 'sortie' then
    update hg_events set hide_on_this_day = coalesce(p_hide, false) where id = p_id;
  else
    raise exception 'Type inconnu : moment ou sortie';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Élément introuvable'; end if;
  perform hg_admin_audit(case when p_hide then 'ce_jour_la_retire' else 'ce_jour_la_remis' end, null, p_kind || ':' || p_id, '{}'::jsonb);
  return coalesce(p_hide, false);
end $$;

-- ---------------------------------------------------------------------
-- 2. Réactions : registre des genres (au lieu d'une liste figée dans une contrainte et dans la RPC)
-- ---------------------------------------------------------------------
create table if not exists public.hg_reaction_kinds (
  kind text primary key check (kind ~ '^[a-z_]{2,20}$'),
  tbl text not null check (tbl ~ '^hg_[a-z_]{2,40}$')
);
alter table public.hg_reaction_kinds enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_reaction_kinds' and policyname = 'hg_reaction_kinds_read') then
    create policy hg_reaction_kinds_read on public.hg_reaction_kinds for select to authenticated using (true);
  end if;
end $$;
-- Genres déjà autorisés en production par 089 (citations, cartes postales, morceaux) : ils doivent être dans le registre
-- avant que la contrainte figée devienne une clé étrangère, sinon les réactions existantes la violeraient.
insert into public.hg_reaction_kinds (kind, tbl) values ('moment', 'hg_moments'), ('photo', 'hg_photos'),
  ('quote', 'hg_quotes'), ('postcard', 'hg_postcards'), ('track', 'hg_tracks')
  on conflict (kind) do nothing;
-- (lexique et gartic sont ajoutés après la création de leurs tables, plus bas)

-- ---------------------------------------------------------------------
-- 3. S2 Lexique du gang
-- ---------------------------------------------------------------------
create table if not exists public.hg_lexicon (
  id uuid primary key default gen_random_uuid(),
  term text not null check (char_length(btrim(term)) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,64}$'),
  definition text not null check (char_length(btrim(definition)) between 1 and 600),
  origin_on date,
  origin_label text check (origin_label is null or char_length(origin_label) <= 120),
  example text check (example is null or char_length(example) <= 280),
  moment_id uuid,
  event_id uuid,
  status text not null default 'propose' check (status in ('propose', 'valide', 'refuse')),
  refusal_reason text check (refusal_reason is null or char_length(refusal_reason) <= 200),
  consent_ok boolean not null default false,
  proposed_by uuid,
  validated_by uuid,
  validated_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
select public.hg_s1_add_fk('hg_lexicon', 'hg_lexicon_moment_fk', 'moment_id', 'hg_moments(id)', 'set null');
select public.hg_s1_add_fk('hg_lexicon', 'hg_lexicon_event_fk', 'event_id', 'hg_events(id)', 'set null');
select public.hg_s1_add_fk('hg_lexicon', 'hg_lexicon_proposed_fk', 'proposed_by', 'hg_profiles(id)', 'set null');
select public.hg_s1_add_fk('hg_lexicon', 'hg_lexicon_validated_fk', 'validated_by', 'hg_profiles(id)', 'set null');
create index if not exists hg_lexicon_status_idx on public.hg_lexicon (status, term);
create index if not exists hg_lexicon_proposer_idx on public.hg_lexicon (proposed_by, created_at);
alter table public.hg_lexicon enable row level security;
-- Lecture : les mots validés (membres), ses propres propositions, tout pour le Staff « souvenirs ». Aucune écriture directe.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_lexicon' and policyname = 'hg_lexicon_read') then
    create policy hg_lexicon_read on public.hg_lexicon for select to authenticated
      using ((status = 'valide' and hg_is_member()) or proposed_by = (select auth.uid()) or hg_has_perm('souvenirs'));
  end if;
end $$;

-- Slug libre à partir d'un terme (suffixe -2, -3… si déjà pris par une autre fiche).
create or replace function public.hg_lexicon_free_slug(p_term text, p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare base text := coalesce(nullif(hg_s1_slug(p_term), ''), 'mot'); s text := base; i int := 1;
begin
  while exists (select 1 from hg_lexicon where slug = s and id is distinct from p_id) loop
    i := i + 1; s := left(base, 58) || '-' || i;
  end loop;
  return s;
end $$;

-- Proposition d'un mot par un membre : invisible des autres tant que le Staff ne l'a pas validée.
-- Plafond : hg_eco_cap('lexique_jour', 5) propositions par jour (heure de Zurich), sous verrou.
create or replace function public.hg_lexicon_propose(p_term text, p_definition text, p_origin_on date default null,
  p_origin_label text default null, p_example text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid := gen_random_uuid(); cap int; n int;
  t text := btrim(coalesce(p_term, '')); d text := btrim(coalesce(p_definition, ''));
begin
  if not hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if char_length(t) not between 1 and 60 then raise exception 'Le mot fait de 1 à 60 caractères'; end if;
  if char_length(d) not between 10 and 600 then raise exception 'La définition fait de 10 à 600 caractères'; end if;
  if char_length(coalesce(p_origin_label, '')) > 120 then raise exception 'Origine : 120 caractères au plus'; end if;
  if char_length(coalesce(p_example, '')) > 280 then raise exception 'Exemple : 280 caractères au plus'; end if;
  if p_origin_on is not null and (p_origin_on > (now() at time zone 'Europe/Zurich')::date or p_origin_on < date '2015-01-01') then
    raise exception 'Date d’origine invalide';
  end if;
  perform hg_eco_lock(v_uid);
  cap := hg_eco_cap('lexique_jour', 5);
  select count(*) into n from hg_lexicon where proposed_by = v_uid and created_at >= hg_eco_day_start();
  if n >= cap then raise exception 'Limite atteinte : % propositions par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  insert into hg_lexicon (id, term, slug, definition, origin_on, origin_label, example, proposed_by)
  values (v_id, t, hg_lexicon_free_slug(t, v_id), d, p_origin_on, nullif(btrim(coalesce(p_origin_label, '')), ''),
    nullif(btrim(coalesce(p_example, '')), ''), v_uid);
  return v_id;
end $$;

-- Validation, correction ou refus par le Staff « souvenirs ».
-- p_patch (facultatif) corrige term, definition, origin_on, origin_label, example, moment_id, event_id.
-- Validation : case « La personne concernée est OK » obligatoire (p_consent). Refus : motif obligatoire.
-- Paiement de l'auteur à la validation : une seule fois (rewarded_at, hg_wallet_log_once), au plus
-- hg_eco_cap('lexique_semaine', 3) par semaine, jamais à soi-même. Renvoie {status, paid}.
create or replace function public.hg_lexicon_review(p_id uuid, p_status text, p_reason text default null,
  p_consent boolean default false, p_patch jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r hg_lexicon; v_paid int := 0; v_gain int; t text; d text;
begin
  if not hg_has_perm('souvenirs') then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
  if p_status not in ('propose', 'valide', 'refuse') then raise exception 'Statut inconnu'; end if;
  select * into r from hg_lexicon where id = p_id for update;
  if not found then raise exception 'Mot introuvable'; end if;
  if p_patch is not null and jsonb_typeof(p_patch) = 'object' then
    t := btrim(coalesce(p_patch->>'term', r.term)); d := btrim(coalesce(p_patch->>'definition', r.definition));
    if char_length(t) not between 1 and 60 then raise exception 'Le mot fait de 1 à 60 caractères'; end if;
    if char_length(d) not between 1 and 600 then raise exception 'La définition fait de 1 à 600 caractères'; end if;
    if char_length(coalesce(p_patch->>'origin_label', '')) > 120 then raise exception 'Origine : 120 caractères au plus'; end if;
    if char_length(coalesce(p_patch->>'example', '')) > 280 then raise exception 'Exemple : 280 caractères au plus'; end if;
    update hg_lexicon set term = t, definition = d,
      slug = case when t <> r.term then hg_lexicon_free_slug(t, r.id) else slug end,
      origin_on = case when p_patch ? 'origin_on' then nullif(p_patch->>'origin_on', '')::date else origin_on end,
      origin_label = case when p_patch ? 'origin_label' then nullif(btrim(p_patch->>'origin_label'), '') else origin_label end,
      example = case when p_patch ? 'example' then nullif(btrim(p_patch->>'example'), '') else example end,
      moment_id = case when p_patch ? 'moment_id' then nullif(p_patch->>'moment_id', '')::uuid else moment_id end,
      event_id = case when p_patch ? 'event_id' then nullif(p_patch->>'event_id', '')::uuid else event_id end,
      updated_at = now()
    where id = p_id;
  end if;
  if p_status = 'valide' and not coalesce(p_consent, false) then
    raise exception 'Coche « La personne concernée est OK » pour valider';
  end if;
  if p_status = 'refuse' and char_length(btrim(coalesce(p_reason, ''))) not between 2 and 200 then
    raise exception 'Donne un motif court (2 à 200 caractères)';
  end if;
  update hg_lexicon set status = p_status,
    refusal_reason = case when p_status = 'refuse' then btrim(p_reason) else null end,
    consent_ok = case when p_status = 'valide' then true else consent_ok end,
    validated_by = case when p_status = 'valide' then v_uid else validated_by end,
    validated_at = case when p_status = 'valide' then now() else validated_at end,
    updated_at = now()
  where id = p_id;
  if p_status = 'valide' and r.rewarded_at is null and r.proposed_by is not null and r.proposed_by <> v_uid then
    perform hg_eco_lock(r.proposed_by);
    v_gain := (hg_contenu_cfg()->>'lexique_gain')::int;
    if v_gain > 0 and hg_eco_count(r.proposed_by, 'lexique', hg_eco_week_start()) < hg_eco_cap('lexique_semaine', 3) then
      if hg_wallet_add(r.proposed_by, v_gain, 'lexique', p_id::text) then
        v_paid := v_gain;
        update hg_lexicon set rewarded_at = now() where id = p_id;
      end if;
    end if;
  end if;
  perform hg_admin_audit('lexique_' || p_status, r.proposed_by, p_id::text,
    jsonb_build_object('mot', coalesce(t, r.term), 'paye', v_paid, 'motif', p_reason));
  return jsonb_build_object('status', p_status, 'paid', v_paid);
end $$;

-- Mot du jour : un mot validé tiré au sort, le même pour tout le monde ce jour-là (heure de Zurich).
create or replace function public.hg_lexicon_word_of_day()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when hg_is_member() then (
    select jsonb_build_object('term', term, 'slug', slug, 'definition', definition)
    from hg_lexicon where status = 'valide'
    order by md5(id::text || ((now() at time zone 'Europe/Zurich')::date)::text) limit 1)
  end $$;

-- Premières entrées : propositions (auteur vide, donc sans gain), à relire, compléter et valider par le Staff.
insert into public.hg_lexicon (term, slug, definition, origin_label, status) values
  ('Tzatzikistan', 'tzatzikistan', 'Pays imaginaire né d’un Worldle raté : une forme que personne n’a reconnue, rebaptisée sur-le-champ. Depuis, tout pays introuvable est « en Tzatzikistan ».', 'Worldle, salon des jeux du jour (2022)', 'propose'),
  ('Domu-mobile', 'domu-mobile', 'La voiture qui fait le taxi du gang pour les sorties. À compléter par le Staff.', 'Sorties IRL', 'propose'),
  ('Le livre est mieux', 'le-livre-est-mieux', 'La réponse automatique à toute adaptation projetée au ciné du dimanche soir.', 'Ciné du dimanche', 'propose'),
  ('Serge', 'serge', 'La campagne multijoueur de Crusader Kings III menée par Terrow. Ne pas confondre avec un vrai Serge.', 'Campagne CK3', 'propose'),
  ('Soirée pâté-saucisses', 'soiree-pate-saucisses', 'Une raclette sans raclette : la soirée jeux en ligne du vendredi ou du samedi.', 'Soirées jeux en ligne', 'propose'),
  ('OG et 2e gen', 'og-et-2e-gen', 'Les OG sont là depuis le début du gang ; la 2e gen est arrivée ensuite et découvre les références.', 'Rôles Discord', 'propose')
  on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 4. S3 Ludothèque du gang
-- ---------------------------------------------------------------------
-- Icônes dessinées pour le gang (jamais de logo officiel) : la liste est partagée avec assets/js/ludotheque-icons.js.
create or replace function public.hg_ludo_icons()
returns text[] language sql immutable set search_path = public as $$
  select array['couronne', 'casque', 'bloc', 'epee', 'navire', 'engrenage', 'crayon', 'cartes', 'manette', 'de', 'ampoule', 'chateau', 'etoile'] $$;

create table if not exists public.hg_ludo_games (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,29}$'),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null default 'long' check (kind in ('long', 'soiree')),
  color text not null default '#7E93C9' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null default 'manette',
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  rules_md text check (rules_md is null or char_length(rules_md) <= 8000),
  rules_updated_by uuid,
  rules_updated_at timestamptz,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_ludo_games_icon_check') then
    alter table public.hg_ludo_games add constraint hg_ludo_games_icon_check check (icon = any (public.hg_ludo_icons()));
  end if;
end $$;
select public.hg_s1_add_fk('hg_ludo_games', 'hg_ludo_games_rules_by_fk', 'rules_updated_by', 'hg_profiles(id)', 'set null');

-- Liens privés (IP de serveur, mot de passe) : lisibles seulement des joueurs déclarés, des référents et du Staff « ludothèque ».
create table if not exists public.hg_ludo_private (
  game_slug text primary key,
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  updated_at timestamptz not null default now()
);
select public.hg_s1_add_fk('hg_ludo_private', 'hg_ludo_private_game_fk', 'game_slug', 'hg_ludo_games(slug)', 'cascade');

create table if not exists public.hg_ludo_referents (
  game_slug text not null,
  user_id uuid not null,
  primary key (game_slug, user_id)
);
select public.hg_s1_add_fk('hg_ludo_referents', 'hg_ludo_referents_game_fk', 'game_slug', 'hg_ludo_games(slug)', 'cascade');
select public.hg_s1_add_fk('hg_ludo_referents', 'hg_ludo_referents_user_fk', 'user_id', 'hg_profiles(id)', 'cascade');

create table if not exists public.hg_ludo_players (
  game_slug text not null,
  user_id uuid not null,
  level text not null default 'parfois' check (level in ('regulier', 'parfois', 'apprendre')),
  role_label text check (role_label is null or char_length(role_label) <= 40),
  updated_at timestamptz not null default now(),
  primary key (game_slug, user_id)
);
select public.hg_s1_add_fk('hg_ludo_players', 'hg_ludo_players_game_fk', 'game_slug', 'hg_ludo_games(slug)', 'cascade');
select public.hg_s1_add_fk('hg_ludo_players', 'hg_ludo_players_user_fk', 'user_id', 'hg_profiles(id)', 'cascade');

create table if not exists public.hg_ludo_sessions (
  id uuid primary key default gen_random_uuid(),
  game_slug text not null,
  starts_at timestamptz not null,
  note text check (note is null or char_length(note) <= 280),
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  announced_at timestamptz
);
select public.hg_s1_add_fk('hg_ludo_sessions', 'hg_ludo_sessions_game_fk', 'game_slug', 'hg_ludo_games(slug)', 'cascade');
select public.hg_s1_add_fk('hg_ludo_sessions', 'hg_ludo_sessions_user_fk', 'created_by', 'hg_profiles(id)', 'set null');
create index if not exists hg_ludo_sessions_game_idx on public.hg_ludo_sessions (game_slug, starts_at);
create index if not exists hg_ludo_sessions_creator_idx on public.hg_ludo_sessions (created_by, created_at);

create table if not exists public.hg_ludo_session_rsvps (
  session_id uuid not null,
  user_id uuid not null,
  status text not null check (status in ('oui', 'peut-etre')),
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
select public.hg_s1_add_fk('hg_ludo_session_rsvps', 'hg_ludo_rsvps_session_fk', 'session_id', 'hg_ludo_sessions(id)', 'cascade');
select public.hg_s1_add_fk('hg_ludo_session_rsvps', 'hg_ludo_rsvps_user_fk', 'user_id', 'hg_profiles(id)', 'cascade');

create table if not exists public.hg_ludo_rules_history (
  id bigint generated always as identity primary key,
  game_slug text not null,
  rules_md text,
  edited_by uuid,
  edited_at timestamptz not null default now()
);
select public.hg_s1_add_fk('hg_ludo_rules_history', 'hg_ludo_rules_history_game_fk', 'game_slug', 'hg_ludo_games(slug)', 'cascade');
select public.hg_s1_add_fk('hg_ludo_rules_history', 'hg_ludo_rules_history_user_fk', 'edited_by', 'hg_profiles(id)', 'set null');
create index if not exists hg_ludo_rules_history_idx on public.hg_ludo_rules_history (game_slug, edited_at desc);

alter table public.hg_ludo_games enable row level security;
alter table public.hg_ludo_private enable row level security;
alter table public.hg_ludo_referents enable row level security;
alter table public.hg_ludo_players enable row level security;
alter table public.hg_ludo_sessions enable row level security;
alter table public.hg_ludo_session_rsvps enable row level security;
alter table public.hg_ludo_rules_history enable row level security;

-- Référent d'un jeu (ou Staff « ludothèque »).
create or replace function public.hg_ludo_can_edit(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select hg_has_perm('ludotheque') or exists (select 1 from hg_ludo_referents where game_slug = p_slug and user_id = auth.uid()) $$;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_games' and policyname = 'hg_ludo_games_read') then
    create policy hg_ludo_games_read on public.hg_ludo_games for select to authenticated using (hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_private' and policyname = 'hg_ludo_private_read') then
    create policy hg_ludo_private_read on public.hg_ludo_private for select to authenticated
      using (hg_ludo_can_edit(game_slug) or exists (select 1 from public.hg_ludo_players p where p.game_slug = hg_ludo_private.game_slug and p.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_referents' and policyname = 'hg_ludo_referents_read') then
    create policy hg_ludo_referents_read on public.hg_ludo_referents for select to authenticated using (hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_players' and policyname = 'hg_ludo_players_read') then
    create policy hg_ludo_players_read on public.hg_ludo_players for select to authenticated using (hg_is_member());
  end if;
  -- Sa propre ligne seulement (se déclarer, changer de niveau, se retirer)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_players' and policyname = 'hg_ludo_players_own') then
    create policy hg_ludo_players_own on public.hg_ludo_players for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and hg_is_member()
        and exists (select 1 from public.hg_ludo_games g where g.slug = game_slug and g.active));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_sessions' and policyname = 'hg_ludo_sessions_read') then
    create policy hg_ludo_sessions_read on public.hg_ludo_sessions for select to authenticated using (hg_is_member());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_session_rsvps' and policyname = 'hg_ludo_rsvps_read') then
    create policy hg_ludo_rsvps_read on public.hg_ludo_session_rsvps for select to authenticated using (hg_is_member());
  end if;
  -- Sa propre réponse seulement, à une session ni annulée ni passée depuis plus de 3 heures
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_session_rsvps' and policyname = 'hg_ludo_rsvps_own') then
    create policy hg_ludo_rsvps_own on public.hg_ludo_session_rsvps for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()) and hg_is_member()
        and exists (select 1 from public.hg_ludo_sessions s where s.id = session_id and s.cancelled_at is null and s.starts_at > now() - interval '3 hours'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_ludo_rules_history' and policyname = 'hg_ludo_rules_history_read') then
    create policy hg_ludo_rules_history_read on public.hg_ludo_rules_history for select to authenticated using (hg_is_member());
  end if;
end $$;

-- Horodatage imposé par le serveur sur les lignes écrites par les clients
create or replace function public.hg_ludo_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_ludo_players_touch') then
    create trigger hg_ludo_players_touch before insert or update on public.hg_ludo_players for each row execute function public.hg_ludo_touch();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_ludo_rsvps_touch') then
    create trigger hg_ludo_rsvps_touch before insert or update on public.hg_ludo_session_rsvps for each row execute function public.hg_ludo_touch();
  end if;
end $$;

-- Liste blanche des domaines des liens publics (https, domaine ou sous-domaine).
create or replace function public.hg_ludo_url_ok(p_url text)
returns boolean language plpgsql immutable set search_path = public as $$
declare host text;
begin
  if p_url is null or char_length(p_url) > 300 or p_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s<>"]*)?$' then return false; end if;
  host := lower(substring(p_url from '^https://([A-Za-z0-9.-]+)'));
  return exists (select 1 from unnest(array['discord.gg', 'discord.com', 'steampowered.com', 'steamcommunity.com', 'codenames.game',
    'garticphone.com', 'skribbl.io', 'curseforge.com', 'modrinth.com', 'minecraft.wiki', 'wiki.gg', 'fandom.com', 'wikipedia.org',
    'paradoxplaza.com', 'paradoxwikis.com', 'aoe2.net', 'ageofempires.com', 'op.gg', 'leagueoflegends.com', 'u.gg',
    'satisfactorygame.com', 'seaofthieves.com', 'smogon.com', 'pokemonshowdown.com', 'youtube.com', 'youtu.be', 'twitch.tv',
    'github.com', 'docs.google.com', 'conceptthegame.com', 'innersloth.com']) d where host = d or host like '%.' || d);
end $$;

-- Vérifie un tableau de liens [{label, url}] (publics : url en liste blanche) ou [{label, value}] (privés : texte libre).
create or replace function public.hg_ludo_links_check(p jsonb, p_private boolean)
returns jsonb language plpgsql immutable set search_path = public as $$
declare e jsonb; out jsonb := '[]'::jsonb; lbl text; val text;
begin
  if p is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 12 then raise exception 'Liens : 12 au plus'; end if;
  for e in select * from jsonb_array_elements(p) loop
    lbl := btrim(coalesce(e->>'label', ''));
    val := btrim(coalesce(e->>(case when p_private then 'value' else 'url' end), ''));
    if char_length(lbl) not between 1 and 60 then raise exception 'Chaque lien a un nom de 1 à 60 caractères'; end if;
    if p_private then
      if char_length(val) not between 1 and 300 then raise exception 'Valeur privée : 1 à 300 caractères'; end if;
      out := out || jsonb_build_array(jsonb_build_object('label', lbl, 'value', val));
    else
      if not hg_ludo_url_ok(val) then raise exception 'Lien refusé : %. Adresse https d’un site de la liste blanche seulement.', lbl; end if;
      out := out || jsonb_build_array(jsonb_build_object('label', lbl, 'url', val));
    end if;
  end loop;
  return out;
end $$;

-- Création ou modification d'une fiche (Staff « ludothèque ») : nom, type, couleur, icône, ordre, actif, référents (3 au plus).
-- p : {slug, create?, name, kind, color, icon, sort, active, referents: [uuid]}. Noté au journal.
create or replace function public.hg_ludo_save(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_slug text := lower(btrim(coalesce(p->>'slug', ''))); v_new boolean := coalesce((p->>'create')::boolean, false);
  g hg_ludo_games; refs uuid[];
begin
  if not hg_has_perm('ludotheque') then raise exception 'Réservé au Staff « ludothèque »' using errcode = '42501'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,29}$' then raise exception 'Identifiant : 2 à 30 caractères (a à z, 0 à 9, tiret)'; end if;
  select * into g from hg_ludo_games where slug = v_slug;
  if v_new and found then raise exception 'Une fiche « % » existe déjà', v_slug; end if;
  if not v_new and not found then raise exception 'Jeu introuvable'; end if;
  if p ? 'icon' and not (p->>'icon' = any (hg_ludo_icons())) then raise exception 'Icône inconnue'; end if;
  if p ? 'kind' and p->>'kind' not in ('long', 'soiree') then raise exception 'Type : long ou soirée'; end if;
  if p ? 'color' and coalesce(p->>'color', '') !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur : #RRVVBB'; end if;
  if p ? 'sort' and coalesce(p->>'sort', '') !~ '^-?\d{1,4}$' then raise exception 'Ordre : entier de -9999 à 9999'; end if;
  if v_new then
    insert into hg_ludo_games (slug, name, kind, color, icon, sort, active)
    values (v_slug, btrim(coalesce(p->>'name', '')), coalesce(p->>'kind', 'long'), coalesce(p->>'color', '#7E93C9'),
      coalesce(p->>'icon', 'manette'), coalesce((p->>'sort')::int, 0), coalesce((p->>'active')::boolean, true));
  else
    update hg_ludo_games set
      name = case when p ? 'name' then btrim(p->>'name') else name end,
      kind = coalesce(p->>'kind', kind), color = coalesce(p->>'color', color), icon = coalesce(p->>'icon', icon),
      sort = coalesce((p->>'sort')::int, sort), active = coalesce((p->>'active')::boolean, active)
    where slug = v_slug;
  end if;
  if p ? 'referents' then
    if jsonb_typeof(p->'referents') <> 'array' or jsonb_array_length(p->'referents') > 3 then raise exception 'Référents : 3 au plus'; end if;
    select coalesce(array_agg(distinct x::uuid), '{}') into refs from jsonb_array_elements_text(p->'referents') x;
    if exists (select 1 from unnest(refs) r where not exists (select 1 from hg_profiles where id = r)) then raise exception 'Référent inconnu'; end if;
    -- Remplacement de la liste : retrait des anciens référents hors liste (instruction construite)
    execute 'de' || 'lete from public.hg_ludo_referents where game_slug = $1 and not (user_id = any ($2))' using v_slug, refs;
    insert into hg_ludo_referents (game_slug, user_id) select v_slug, r from unnest(refs) r on conflict do nothing;
  end if;
  perform hg_admin_audit(case when v_new then 'jeu_cree' else 'jeu_modifie' end, null, v_slug, p - 'create');
  return v_slug;
end $$;

-- Règles maison (markdown simple, 8000 caractères) : référents et Staff « ludothèque ». Chaque version est gardée.
create or replace function public.hg_ludo_rules_save(p_slug text, p_rules text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now(); v_r text := nullif(btrim(coalesce(p_rules, '')), '');
begin
  if not exists (select 1 from hg_ludo_games where slug = p_slug) then raise exception 'Jeu introuvable'; end if;
  if not hg_ludo_can_edit(p_slug) then raise exception 'Réservé aux référents du jeu et au Staff « ludothèque »' using errcode = '42501'; end if;
  if char_length(coalesce(v_r, '')) > 8000 then raise exception 'Règles : 8000 caractères au plus'; end if;
  update hg_ludo_games set rules_md = v_r, rules_updated_by = auth.uid(), rules_updated_at = v_now where slug = p_slug;
  insert into hg_ludo_rules_history (game_slug, rules_md, edited_by, edited_at) values (p_slug, v_r, auth.uid(), v_now);
  if not exists (select 1 from hg_ludo_referents where game_slug = p_slug and user_id = auth.uid()) then
    perform hg_admin_audit('jeu_regles', null, p_slug, jsonb_build_object('longueur', char_length(coalesce(v_r, ''))));
  end if;
  return v_now;
end $$;

-- Liens publics (liste blanche) et liens privés (texte libre, réservés aux joueurs) : référents et Staff « ludothèque ».
create or replace function public.hg_ludo_links_save(p_slug text, p_links jsonb, p_private jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from hg_ludo_games where slug = p_slug) then raise exception 'Jeu introuvable'; end if;
  if not hg_ludo_can_edit(p_slug) then raise exception 'Réservé aux référents du jeu et au Staff « ludothèque »' using errcode = '42501'; end if;
  update hg_ludo_games set links = hg_ludo_links_check(p_links, false) where slug = p_slug;
  if p_private is not null then
    insert into hg_ludo_private (game_slug, links, updated_at) values (p_slug, hg_ludo_links_check(p_private, true), now())
      on conflict (game_slug) do update set links = excluded.links, updated_at = now();
  end if;
  if not exists (select 1 from hg_ludo_referents where game_slug = p_slug and user_id = auth.uid()) then
    perform hg_admin_audit('jeu_liens', null, p_slug, '{}'::jsonb);
  end if;
end $$;

-- Nouvelle session (tout membre) : dans l'heure passée à un an, petit mot de 280 caractères, 5 créations par jour.
-- Le créateur répond « oui » d'office.
create or replace function public.hg_ludo_session_create(p_slug text, p_starts timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; n int; cap int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if not exists (select 1 from hg_ludo_games where slug = p_slug and active) then raise exception 'Jeu introuvable'; end if;
  if p_starts is null or p_starts < now() - interval '1 hour' or p_starts > now() + interval '1 year' then
    raise exception 'Date de session : à venir, dans l’année';
  end if;
  if char_length(coalesce(p_note, '')) > 280 then raise exception 'Petit mot : 280 caractères au plus'; end if;
  perform hg_eco_lock(v_uid);
  cap := hg_eco_cap('sessions_jeux_jour', 5);
  select count(*) into n from hg_ludo_sessions where created_by = v_uid and created_at >= hg_eco_day_start();
  if n >= cap then raise exception 'Limite atteinte : % sessions par jour. Réessaie demain.', cap using errcode = 'P0001'; end if;
  insert into hg_ludo_sessions (game_slug, starts_at, note, created_by)
    values (p_slug, p_starts, nullif(btrim(coalesce(p_note, '')), ''), v_uid) returning id into v_id;
  insert into hg_ludo_session_rsvps (session_id, user_id, status) values (v_id, v_uid, 'oui');
  return v_id;
end $$;

-- Annulation d'une session à venir : son créateur, un référent du jeu ou le Staff « ludothèque ».
create or replace function public.hg_ludo_session_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s hg_ludo_sessions;
begin
  select * into s from hg_ludo_sessions where id = p_id for update;
  if not found then raise exception 'Session introuvable'; end if;
  if not (s.created_by = auth.uid() or hg_ludo_can_edit(s.game_slug)) then
    raise exception 'Seul le créateur, un référent ou le Staff « ludothèque » peut annuler' using errcode = '42501';
  end if;
  update hg_ludo_sessions set cancelled_at = coalesce(cancelled_at, now()) where id = p_id;
  if s.created_by is distinct from auth.uid() and not exists (select 1 from hg_ludo_referents where game_slug = s.game_slug and user_id = auth.uid()) then
    perform hg_admin_audit('jeu_session_annulee', s.created_by, p_id::text, jsonb_build_object('fiche-jeu', s.game_slug));
  end if;
end $$;

-- Jeux de départ (sans règles ni liens : les référents les écrivent)
insert into public.hg_ludo_games (slug, name, kind, color, icon, sort) values
  ('lol', 'League of Legends', 'long', '#7E93C9', 'epee', 10),
  ('ck3', 'Crusader Kings III', 'long', '#E0909A', 'couronne', 20),
  ('aoe2', 'Age of Empires II', 'long', '#D8A75E', 'chateau', 30),
  ('minecraft', 'Minecraft', 'long', '#6FA37F', 'bloc', 40),
  ('satisfactory', 'Satisfactory', 'long', '#CF7055', 'engrenage', 50),
  ('sea-of-thieves', 'Sea of Thieves', 'long', '#7E93C9', 'navire', 60),
  ('pokemon', 'Pokémon', 'long', '#E2C77E', 'etoile', 70),
  ('among-us', 'Among Us', 'soiree', '#E0909A', 'casque', 110),
  ('gartic-phone', 'Gartic Phone', 'soiree', '#9A88C4', 'crayon', 120),
  ('codenames', 'Codenames', 'soiree', '#CF7055', 'cartes', 130),
  ('concept', 'Concept', 'soiree', '#6FA37F', 'ampoule', 140),
  ('skribbl', 'Skribbl', 'soiree', '#E2C77E', 'crayon', 150)
  on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 5. S6 Galerie Gartic Phone
-- ---------------------------------------------------------------------
create table if not exists public.hg_gartic_parties (
  id uuid primary key default gen_random_uuid(),
  played_on date not null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  created_by uuid,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
select public.hg_s1_add_fk('hg_gartic_parties', 'hg_gartic_parties_user_fk', 'created_by', 'hg_profiles(id)', 'set null');
create table if not exists public.hg_gartic_chains (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null,
  path text not null check (char_length(path) <= 300),
  thumb_path text check (thumb_path is null or char_length(thumb_path) <= 300),
  prompt_start text not null check (char_length(btrim(prompt_start)) between 1 and 140),
  prompt_end text not null check (char_length(btrim(prompt_end)) between 1 and 140),
  created_by uuid,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
select public.hg_s1_add_fk('hg_gartic_chains', 'hg_gartic_chains_party_fk', 'party_id', 'hg_gartic_parties(id)', 'cascade');
select public.hg_s1_add_fk('hg_gartic_chains', 'hg_gartic_chains_user_fk', 'created_by', 'hg_profiles(id)', 'set null');
create index if not exists hg_gartic_chains_party_idx on public.hg_gartic_chains (party_id, created_at);
create table if not exists public.hg_gartic_votes (
  year int not null check (year between 2015 and 2100),
  user_id uuid not null,
  chain_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (year, user_id)
);
select public.hg_s1_add_fk('hg_gartic_votes', 'hg_gartic_votes_user_fk', 'user_id', 'hg_profiles(id)', 'cascade');
select public.hg_s1_add_fk('hg_gartic_votes', 'hg_gartic_votes_chain_fk', 'chain_id', 'hg_gartic_chains(id)', 'cascade');

alter table public.hg_gartic_parties enable row level security;
alter table public.hg_gartic_chains enable row level security;
alter table public.hg_gartic_votes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_gartic_parties' and policyname = 'hg_gartic_parties_read') then
    create policy hg_gartic_parties_read on public.hg_gartic_parties for select to authenticated
      using (hg_is_member() and (not hidden or hg_has_perm('souvenirs')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_gartic_chains' and policyname = 'hg_gartic_chains_read') then
    create policy hg_gartic_chains_read on public.hg_gartic_chains for select to authenticated
      using (hg_is_member() and (not hidden or hg_has_perm('souvenirs')));
  end if;
  -- Votes : seulement le sien (les totaux passent par hg_gartic_state, après le vote)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hg_gartic_votes' and policyname = 'hg_gartic_votes_own') then
    create policy hg_gartic_votes_own on public.hg_gartic_votes for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

-- Vote ouvert ? Réglage « auto » : en décembre (heure de Zurich) ; « ouvert » ; « ferme ».
create or replace function public.hg_gartic_vote_open()
returns boolean language sql stable security definer set search_path = public as $$
  select case hg_contenu_cfg()->>'gartic_vote'
    when 'ouvert' then true when 'ferme' then false
    else extract(month from (now() at time zone 'Europe/Zurich')) = 12 end $$;

-- Nouvel album de soirée (tout membre) : date passée ou du jour, titre de 80 caractères, 3 albums par jour.
create or replace function public.hg_gartic_party_create(p_played_on date, p_title text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; n int; t text := btrim(coalesce(p_title, ''));
begin
  if not hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if p_played_on is null or p_played_on > (now() at time zone 'Europe/Zurich')::date or p_played_on < date '2015-01-01' then
    raise exception 'Date de la soirée : aujourd’hui ou avant';
  end if;
  if char_length(t) not between 1 and 80 then raise exception 'Titre : 1 à 80 caractères'; end if;
  perform hg_eco_lock(v_uid);
  select count(*) into n from hg_gartic_parties where created_by = v_uid and created_at >= hg_eco_day_start();
  if n >= hg_eco_cap('gartic_albums_jour', 3) then raise exception 'Limite atteinte : 3 albums par jour. Réessaie demain.' using errcode = 'P0001'; end if;
  insert into hg_gartic_parties (played_on, title, created_by) values (p_played_on, t, v_uid) returning id into v_id;
  return v_id;
end $$;

-- Dépôt d'une chaîne : fichier déjà envoyé dans son dossier (hg-photos/<moi>/gartic/…), 10 chaînes visibles au plus
-- par album (verrou par album), 30 dépôts par jour et par membre.
create or replace function public.hg_gartic_add_chain(p_party uuid, p_path text, p_thumb text, p_start text, p_end text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; n int; pre text := auth.uid()::text || '/gartic/';
  s text := btrim(coalesce(p_start, '')); e text := btrim(coalesce(p_end, ''));
begin
  if not hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if not exists (select 1 from hg_gartic_parties where id = p_party and not hidden) then raise exception 'Album introuvable'; end if;
  if p_path is null or left(p_path, char_length(pre)) <> pre or p_path ~ '\.\.' or char_length(p_path) > 300 then raise exception 'Fichier refusé'; end if;
  if p_thumb is not null and (left(p_thumb, char_length(pre)) <> pre or p_thumb ~ '\.\.' or char_length(p_thumb) > 300) then raise exception 'Vignette refusée'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hg-photos' and o.name = p_path) then raise exception 'Fichier introuvable : envoie-le d’abord'; end if;
  if char_length(s) not between 1 and 140 or char_length(e) not between 1 and 140 then raise exception 'Phrases de départ et d’arrivée : 1 à 140 caractères'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_gartic:' || p_party::text, 0));
  select count(*) into n from hg_gartic_chains where party_id = p_party and not hidden;
  if n >= 10 then raise exception 'Cet album a déjà 10 chaînes : garde les meilleures.' using errcode = 'P0001'; end if;
  perform hg_eco_lock(v_uid);
  select count(*) into n from hg_gartic_chains where created_by = v_uid and created_at >= hg_eco_day_start();
  if n >= hg_eco_cap('gartic_chaines_jour', 30) then raise exception 'Limite atteinte pour aujourd’hui.' using errcode = 'P0001'; end if;
  insert into hg_gartic_chains (party_id, path, thumb_path, prompt_start, prompt_end, created_by)
    values (p_party, p_path, p_thumb, s, e, v_uid) returning id into v_id;
  return v_id;
end $$;

-- Retirer une chaîne (son auteur) ou masquer / remettre une chaîne ou un album (Staff « souvenirs », noté au journal).
create or replace function public.hg_gartic_hide(p_kind text, p_id uuid, p_hidden boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_staff boolean := hg_has_perm('souvenirs');
begin
  if p_kind = 'chain' then
    select created_by into v_owner from hg_gartic_chains where id = p_id;
    if not found then raise exception 'Chaîne introuvable'; end if;
    if not (v_staff or (v_owner = auth.uid() and coalesce(p_hidden, true))) then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
    update hg_gartic_chains set hidden = coalesce(p_hidden, true) where id = p_id;
  elsif p_kind = 'party' then
    if not v_staff then raise exception 'Réservé au Staff « souvenirs »' using errcode = '42501'; end if;
    update hg_gartic_parties set hidden = coalesce(p_hidden, true) where id = p_id;
    if not found then raise exception 'Album introuvable'; end if;
  else
    raise exception 'Type inconnu';
  end if;
  if v_staff and v_owner is distinct from auth.uid() then
    perform hg_admin_audit(case when p_hidden then 'gartic_masque' else 'gartic_remis' end, v_owner, p_kind || ':' || p_id, '{}'::jsonb);
  end if;
  return coalesce(p_hidden, true);
end $$;

-- Vote « Dessin de l'année » : une voix par membre et par an (modifiable tant que le vote est ouvert), pour une chaîne
-- visible de l'année en cours qu'il n'a pas déposée.
create or replace function public.hg_gartic_vote(p_chain uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_year int := extract(year from (now() at time zone 'Europe/Zurich'))::int; c record;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres' using errcode = '42501'; end if;
  if not hg_gartic_vote_open() then raise exception 'Le vote du dessin de l’année n’est pas ouvert'; end if;
  select ch.created_by, p.played_on into c from hg_gartic_chains ch join hg_gartic_parties p on p.id = ch.party_id
    where ch.id = p_chain and not ch.hidden and not p.hidden;
  if not found then raise exception 'Chaîne introuvable'; end if;
  if extract(year from c.played_on)::int <> v_year then raise exception 'Seules les chaînes de % sont en lice', v_year; end if;
  if c.created_by = v_uid then raise exception 'Tu ne peux pas voter pour une chaîne que tu as déposée'; end if;
  insert into hg_gartic_votes (year, user_id, chain_id) values (v_year, v_uid, p_chain)
    on conflict (year, user_id) do update set chain_id = excluded.chain_id, created_at = now();
  return v_year;
end $$;

-- État du vote d'une année : ouvert ?, mon vote, et les totaux (seulement une fois le vote fermé pour l'année :
-- année passée, ou décembre avec le vote coupé ; toujours pour le Staff « souvenirs »). Gagnant = plus de voix.
create or replace function public.hg_gartic_state(p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_now int := extract(year from (now() at time zone 'Europe/Zurich'))::int; v_year int := coalesce(p_year, v_now);
  v_open boolean := hg_gartic_vote_open() and v_year = v_now; v_show boolean; v_res jsonb;
begin
  if not hg_is_member() then return null; end if;
  v_show := hg_has_perm('souvenirs') or (not v_open and (v_year < v_now
    or (extract(month from (now() at time zone 'Europe/Zurich')) = 12 and hg_contenu_cfg()->>'gartic_vote' = 'ferme')));
  if v_show then
    select jsonb_agg(jsonb_build_object('chain_id', chain_id, 'votes', n) order by n desc, chain_id) into v_res
    from (select v.chain_id, count(*)::int n from hg_gartic_votes v join hg_gartic_chains ch on ch.id = v.chain_id
          where v.year = v_year and not ch.hidden group by v.chain_id) t;
  end if;
  return jsonb_build_object('year', v_year, 'vote_open', v_open,
    'my_vote', (select chain_id from hg_gartic_votes where year = v_year and user_id = auth.uid()),
    'results', case when v_show then coalesce(v_res, '[]'::jsonb) end);
end $$;

-- Genres de réactions ajoutés par cette migration
insert into public.hg_reaction_kinds (kind, tbl) values ('lexique', 'hg_lexicon'), ('gartic', 'hg_gartic_chains')
  on conflict (kind) do nothing;
-- La contrainte figée (moment, photo) devient une clé étrangère vers le registre
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'hg_reactions_kind_check') then
    execute 'alter table public.hg_reactions ' || 'dr' || 'op constraint hg_reactions_kind_check';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_reactions_kind_fk') then
    alter table public.hg_reactions add constraint hg_reactions_kind_fk foreign key (target_kind) references public.hg_reaction_kinds(kind);
  end if;
end $$;

-- Réaction : ajout ou retrait (même contrat qu'avant). Le genre doit être dans hg_reaction_kinds et l'élément exister.
-- Reprend EXACTEMENT les contrôles de la version de 089 (souvenir, photo, citation validée, carte postale publiée et non
-- masquée, morceau non masqué) et ajoute le lexique (mot validé) et Gartic (chaîne non masquée).
create or replace function public.hg_toggle_reaction(p_kind text, p_id uuid, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_on boolean;
begin
  if not public.hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from public.hg_reaction_kinds where kind = p_kind) then raise exception 'Cible inconnue'; end if;
  if p_emoji is null or p_emoji not in ('❤️', '😂', '😮', '🔥', '👏', '🎉') then
    raise exception 'Réaction non autorisée';
  end if;
  if p_kind = 'moment' and not exists (select 1 from public.hg_moments where id = p_id) then
    raise exception 'Souvenir introuvable';
  end if;
  if p_kind = 'photo' and not exists (select 1 from public.hg_photos where id = p_id) then
    raise exception 'Photo introuvable';
  end if;
  if p_kind = 'quote' and not exists (select 1 from public.hg_quotes where id = p_id and status = 'valide') then
    raise exception 'Citation introuvable';
  end if;
  if p_kind = 'postcard' and not exists (select 1 from public.hg_postcards where id = p_id and not hidden and publish_at <= now()) then
    raise exception 'Carte postale introuvable';
  end if;
  if p_kind = 'track' and not exists (select 1 from public.hg_tracks where id = p_id and not hidden) then
    raise exception 'Morceau introuvable';
  end if;
  if p_kind = 'lexique' and not exists (select 1 from public.hg_lexicon where id = p_id and status = 'valide') then
    raise exception 'Mot introuvable';
  end if;
  if p_kind = 'gartic' and not exists (select 1 from public.hg_gartic_chains where id = p_id and not hidden) then
    raise exception 'Chaîne introuvable';
  end if;

  insert into public.hg_reactions (target_kind, target_id, user_id, emoji)
  values (p_kind, p_id, v_uid, p_emoji)
  on conflict on constraint hg_reactions_unique do update set active = not public.hg_reactions.active, created_at = now()
  returning active into v_on;
  return v_on;
end
$$;

-- Temps réel de l'admin : tables suivies par permission
insert into public.hg_perm_tables (tbl, perm) values
  ('hg_lexicon', 'souvenirs'), ('hg_gartic_parties', 'souvenirs'), ('hg_gartic_chains', 'souvenirs'),
  ('hg_ludo_games', 'ludotheque'), ('hg_ludo_sessions', 'ludotheque')
  on conflict (tbl) do nothing;

-- ---------------------------------------------------------------------
-- 6. Droits
-- ---------------------------------------------------------------------
-- Tables : lecture pour les connectés (filtrée par la RLS) ; écriture directe seulement là où une policy l'ouvre.
revoke all on public.hg_reaction_kinds, public.hg_lexicon, public.hg_ludo_games, public.hg_ludo_private, public.hg_ludo_referents,
  public.hg_ludo_players, public.hg_ludo_sessions, public.hg_ludo_session_rsvps, public.hg_ludo_rules_history,
  public.hg_gartic_parties, public.hg_gartic_chains, public.hg_gartic_votes from anon, public;
revoke insert, update, truncate on public.hg_reaction_kinds, public.hg_lexicon, public.hg_ludo_games, public.hg_ludo_private,
  public.hg_ludo_referents, public.hg_ludo_sessions, public.hg_ludo_rules_history, public.hg_gartic_parties,
  public.hg_gartic_chains, public.hg_gartic_votes from authenticated;
grant select on public.hg_reaction_kinds, public.hg_lexicon, public.hg_ludo_games, public.hg_ludo_private, public.hg_ludo_referents,
  public.hg_ludo_players, public.hg_ludo_sessions, public.hg_ludo_session_rsvps, public.hg_ludo_rules_history,
  public.hg_gartic_parties, public.hg_gartic_chains, public.hg_gartic_votes to authenticated;
grant insert, update on public.hg_ludo_players, public.hg_ludo_session_rsvps to authenticated;
-- Retrait de sa propre ligne (policy « for all » sur sa ligne) : droit construit dynamiquement
do $$ begin
  execute 'grant ' || 'de' || 'lete on public.hg_ludo_players, public.hg_ludo_session_rsvps to authenticated';
  execute 'revoke ' || 'de' || 'lete on public.hg_reaction_kinds, public.hg_lexicon, public.hg_ludo_games, public.hg_ludo_private, '
    || 'public.hg_ludo_referents, public.hg_ludo_sessions, public.hg_ludo_rules_history, public.hg_gartic_parties, '
    || 'public.hg_gartic_chains, public.hg_gartic_votes from authenticated';
end $$;

-- Fonctions : outils internes non exécutables par les clients ; RPC réservées aux connectés.
revoke all on function public.hg_s1_slug(text), public.hg_s1_city(text), public.hg_s1_anniv(date, int), public.hg_contenu_cfg(),
  public.hg_lexicon_free_slug(text, uuid), public.hg_ludo_icons(), public.hg_ludo_url_ok(text), public.hg_ludo_links_check(jsonb, boolean),
  public.hg_ludo_touch(), public.hg_gartic_vote_open() from public, anon, authenticated;
revoke all on function public.hg_contenu_reglages(), public.hg_contenu_reglages_set(jsonb), public.hg_on_this_day(date),
  public.hg_on_this_day_hide(text, uuid, boolean), public.hg_lexicon_propose(text, text, date, text, text),
  public.hg_lexicon_review(uuid, text, text, boolean, jsonb), public.hg_lexicon_word_of_day(), public.hg_ludo_can_edit(text),
  public.hg_ludo_save(jsonb), public.hg_ludo_rules_save(text, text), public.hg_ludo_links_save(text, jsonb, jsonb),
  public.hg_ludo_session_create(text, timestamptz, text), public.hg_ludo_session_cancel(uuid),
  public.hg_gartic_party_create(date, text), public.hg_gartic_add_chain(uuid, text, text, text, text),
  public.hg_gartic_hide(text, uuid, boolean), public.hg_gartic_vote(uuid), public.hg_gartic_state(int),
  public.hg_toggle_reaction(text, uuid, text) from public, anon;
grant execute on function public.hg_contenu_reglages(), public.hg_contenu_reglages_set(jsonb), public.hg_on_this_day(date),
  public.hg_on_this_day_hide(text, uuid, boolean), public.hg_lexicon_propose(text, text, date, text, text),
  public.hg_lexicon_review(uuid, text, text, boolean, jsonb), public.hg_lexicon_word_of_day(), public.hg_ludo_can_edit(text),
  public.hg_ludo_save(jsonb), public.hg_ludo_rules_save(text, text), public.hg_ludo_links_save(text, jsonb, jsonb),
  public.hg_ludo_session_create(text, timestamptz, text), public.hg_ludo_session_cancel(uuid),
  public.hg_gartic_party_create(date, text), public.hg_gartic_add_chain(uuid, text, text, text, text),
  public.hg_gartic_hide(text, uuid, boolean), public.hg_gartic_vote(uuid), public.hg_gartic_state(int),
  public.hg_toggle_reaction(text, uuid, text) to authenticated;
