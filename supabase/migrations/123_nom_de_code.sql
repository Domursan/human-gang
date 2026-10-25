-- ===== Humane Gang — migration 123 : Nom de code (jeu d'équipes à mots, tables, moteur, invités, récompenses) =====
-- Deux équipes, Jaune et Rose. Dans chacune, un espion voit la carte secrète et fait deviner les mots de son équipe
-- avec un indice d'un seul mot et un nombre. Les agents de l'équipe proposent des mots ; un mot est révélé
-- à la majorité des agents (ou dès qu'un agent valide, selon le réglage). Assassin : l'équipe perd aussitôt.
-- Tout est côté serveur : la couleur d'une carte n'est renvoyée qu'aux espions, ou une fois la carte révélée.
-- Fonctions publiques (authenticated) : hg_ndc_creer, hg_ndc_rejoindre, hg_ndc_quitter, hg_ndc_pret, hg_ndc_exclure,
--   hg_ndc_equipe, hg_ndc_espion, hg_ndc_equilibrer, hg_ndc_lancer, hg_ndc_indice, hg_ndc_proposer, hg_ndc_valider,
--   hg_ndc_arreter, hg_ndc_message, hg_ndc_messages, hg_ndc_avancer, hg_ndc_rejouer, hg_ndc_etat, hg_ndc_publiques,
--   hg_ndc_mes_parties, hg_ndc_stats, hg_ndc_admin_reglages, hg_ndc_admin_enregistrer, hg_ndc_admin_arreter,
--   hg_ndc_admin_mots, hg_ndc_admin_enregistrer_mots.
-- Invités (anon) : hg_ndc_invite(action, code, jeton, args). Fonctions internes : hg_ndc__* (non exécutables par les clients).
-- Accès : page « nom-de-code » (mode admin au lancement), testeurs listés dans hg_settings.nom_de_code.testeurs, invités d'une partie.

/* =====================================================================
   1. Réglages, page, badges
   ===================================================================== */

insert into public.hg_settings(key, value) values ('nom_de_code', jsonb_build_object(
  'paillettes', jsonb_build_object('partie', 30, 'victoire', 80, 'bonus_espion', 20),
  'plafond_jour', 800,
  'min_joueurs', 4,
  'badges_inactifs', '[]'::jsonb,
  'testeurs', '[]'::jsonb
)) on conflict (key) do nothing;

insert into public.hg_pages(slug, label, mode, in_nav, sort)
values ('nom-de-code', 'Nom de code', 'admin', false, 17)
on conflict (slug) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('ndc_premiere', 'Mission accomplie', 'Gagner une partie de Nom de code.', 980),
  ('ndc_telepathe', 'Télépathe', 'Donner un indice qui fait trouver 4 mots ou plus.', 981),
  ('ndc_sans_faute', 'Sans faute', 'Gagner une partie de Nom de code sans que ton équipe révèle un mot neutre ou adverse.', 982),
  ('ndc_kamikaze', 'Kamikaze', 'Révéler l''assassin au Nom de code.', 983),
  ('ndc_maitre_espion', 'Maître espion', 'Gagner 10 parties de Nom de code comme espion.', 984)
on conflict (code) do nothing;

/* =====================================================================
   2. Tables
   ===================================================================== */

create table if not exists public.hg_ndc_parties (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^HGNDC-[0-9]{4}$'),
  nom text not null check (char_length(nom) between 1 and 60),
  hote uuid not null,
  visibilite text not null default 'privee' check (visibilite in ('privee', 'publique')),
  nb_places int not null check (nb_places between 4 and 20),
  invites boolean not null default true,
  t_espion int not null default 90 check (t_espion in (60, 90, 120)),
  t_equipe int not null default 120 check (t_equipe in (0, 60, 120)),   -- 0 : sans limite
  validation text not null default 'majorite' check (validation in ('majorite', 'libre')),
  paquet text not null default 'classique',
  annonce_discord boolean not null default false,
  discord_annonce_at timestamptz,
  statut text not null default 'attente' check (statut in ('attente', 'en_cours', 'terminee', 'annulee')),
  equipe_debut text check (equipe_debut in ('jaune', 'rose')),
  tour_equipe text check (tour_equipe in ('jaune', 'rose')),
  phase text check (phase in ('indice', 'devine')),
  indice bigint,                                   -- indice en cours (hg_ndc_indices.id)
  essais int not null default 0,                   -- mots encore possibles ce tour
  tour_fin timestamptz,
  vainqueur text check (vainqueur in ('jaune', 'rose')),
  etat jsonb not null default '{}'::jsonb,         -- suite (revanche), raison de fin, assassin
  version int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  activite_at timestamptz not null default now()
);
create index if not exists hg_ndc_parties_statut on public.hg_ndc_parties(statut, visibilite);
create unique index if not exists hg_ndc_parties_code_actif on public.hg_ndc_parties(code) where statut in ('attente', 'en_cours');
alter table public.hg_ndc_parties enable row level security;

create table if not exists public.hg_ndc_joueurs (
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  user_id uuid not null,
  pseudo text not null,
  couleur text,
  avatar_url text,
  invite boolean not null default false,
  place int not null default 0,
  equipe text check (equipe in ('jaune', 'rose')),
  espion boolean not null default false,
  pret boolean not null default false,
  parti boolean not null default false,            -- a quitté la partie en cours
  trouves int not null default 0,                  -- mots de son équipe révélés par lui
  gagne boolean,
  paillettes int not null default 0,
  rejoint_at timestamptz not null default now(),
  primary key (partie, user_id)
);
create index if not exists hg_ndc_joueurs_user on public.hg_ndc_joueurs(user_id);
alter table public.hg_ndc_joueurs enable row level security;

create table if not exists public.hg_ndc_cartes (
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  pos int not null check (pos between 0 and 24),
  mot text not null,
  couleur text not null check (couleur in ('jaune', 'rose', 'neutre', 'assassin')),
  revelee boolean not null default false,
  revele_par uuid,
  revele_equipe text,
  revele_at timestamptz,
  primary key (partie, pos)
);
alter table public.hg_ndc_cartes enable row level security;

create table if not exists public.hg_ndc_propositions (
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  user_id uuid not null,
  pos int not null,
  created_at timestamptz not null default now(),
  primary key (partie, user_id)
);
alter table public.hg_ndc_propositions enable row level security;

create table if not exists public.hg_ndc_indices (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  equipe text not null,
  espion uuid not null,
  mot text not null,
  nombre int not null,
  trouves int not null default 0,                  -- mots de l'équipe trouvés sur cet indice
  mots text[] not null default '{}',               -- mots révélés sur cet indice (dans l'ordre)
  created_at timestamptz not null default now()
);
create index if not exists hg_ndc_indices_partie on public.hg_ndc_indices(partie, id);
alter table public.hg_ndc_indices enable row level security;

create table if not exists public.hg_ndc_mots (
  paquet text not null,
  mot text not null check (char_length(mot) between 1 and 24),
  actif boolean not null default true,
  primary key (paquet, mot)
);
alter table public.hg_ndc_mots enable row level security;

create table if not exists public.hg_ndc_coups (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  user_id uuid,
  type text not null,
  texte text not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_ndc_coups_partie on public.hg_ndc_coups(partie, id);
alter table public.hg_ndc_coups enable row level security;

create table if not exists public.hg_ndc_messages (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  user_id uuid not null,
  canal text not null default 'general' check (canal in ('general', 'jaune', 'rose')),
  texte text not null check (char_length(texte) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists hg_ndc_messages_partie on public.hg_ndc_messages(partie, id);
alter table public.hg_ndc_messages enable row level security;

create table if not exists public.hg_ndc_invites (
  user_id uuid primary key,
  partie uuid not null references public.hg_ndc_parties(id) on delete cascade,
  pseudo text not null,
  jeton_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.hg_ndc_invites enable row level security;

/* =====================================================================
   3. Accès et lecture (temps réel)
   ===================================================================== */

create or replace function public.hg_ndc_peut()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), 'nom-de-code')
    or exists (select 1 from hg_settings s where s.key = 'nom_de_code' and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text)
    or exists (select 1 from hg_ndc_invites i where i.user_id = auth.uid()))
$$;

create or replace function public.hg_ndc_dans(p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_ndc_joueurs where partie = p_partie and user_id = auth.uid())
$$;

-- Mon équipe dans une partie (null si aucune).
create or replace function public.hg_ndc_mon_equipe(p_partie uuid)
returns text language sql stable security definer set search_path = public as $$
  select equipe from hg_ndc_joueurs where partie = p_partie and user_id = auth.uid()
$$;

drop policy if exists hg_ndc_parties_read on public.hg_ndc_parties;
create policy hg_ndc_parties_read on public.hg_ndc_parties for select to authenticated
  using (public.hg_ndc_peut() and (public.hg_ndc_dans(id) or (visibilite = 'publique' and statut = 'attente')));
-- Messages : le canal général, et le canal de mon équipe seulement.
drop policy if exists hg_ndc_messages_read on public.hg_ndc_messages;
create policy hg_ndc_messages_read on public.hg_ndc_messages for select to authenticated
  using (public.hg_ndc_peut() and public.hg_ndc_dans(partie) and (canal = 'general' or canal = public.hg_ndc_mon_equipe(partie)));

revoke all on public.hg_ndc_parties, public.hg_ndc_joueurs, public.hg_ndc_cartes, public.hg_ndc_propositions, public.hg_ndc_indices,
  public.hg_ndc_mots, public.hg_ndc_coups, public.hg_ndc_messages, public.hg_ndc_invites from anon, authenticated;
grant select on public.hg_ndc_parties, public.hg_ndc_messages to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hg_ndc_parties', 'hg_ndc_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

/* =====================================================================
   4. Outils internes
   ===================================================================== */

create or replace function public.hg_ndc__partie(p_code text, p_lock boolean default false)
returns public.hg_ndc_parties language plpgsql security definer set search_path = public as $$
declare v hg_ndc_parties;
begin
  select * into v from hg_ndc_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if found and p_lock then select * into v from hg_ndc_parties where id = v.id for update; end if;
  if not found then raise exception 'Partie introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hg_ndc__bump(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_ndc_parties set version = version + 1, activite_at = now() where id = p_id
$$;

create or replace function public.hg_ndc__nom(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from hg_ndc_joueurs where partie = p_id and user_id = p_user), '?')
$$;

create or replace function public.hg_ndc__equipe_nom(p_equipe text)
returns text language sql immutable as $$
  select case p_equipe when 'jaune' then 'Jaune' when 'rose' then 'Rose' else '?' end
$$;

create or replace function public.hg_ndc__autre(p_equipe text)
returns text language sql immutable as $$
  select case p_equipe when 'jaune' then 'rose' else 'jaune' end
$$;

create or replace function public.hg_ndc__log(p_id uuid, p_user uuid, p_type text, p_texte text)
returns void language sql security definer set search_path = public as $$
  insert into hg_ndc_coups(partie, user_id, type, texte) values (p_id, p_user, p_type, p_texte)
$$;

create or replace function public.hg_ndc__code()
returns text language plpgsql security definer set search_path = public as $$
declare v text; i int := 0;
begin
  loop
    v := 'HGNDC-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from hg_ndc_parties where code = v and statut in ('attente', 'en_cours'));
    i := i + 1;
    if i > 50 then raise exception 'Impossible de générer un code, réessaie.'; end if;
  end loop;
  return v;
end $$;

-- Forme simplifiée d'un mot pour comparer : minuscules, sans accents ni signes.
create or replace function public.hg_ndc__norme(p text)
returns text language sql immutable as $$
  select regexp_replace(translate(lower(coalesce(p, '')),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]', '', 'g')
$$;

-- Joueurs présents d'une équipe ; agents = sans l'espion.
create or replace function public.hg_ndc__presents(p_id uuid, p_equipe text, p_agents boolean default false)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_ndc_joueurs where partie = p_id and equipe = p_equipe and not parti and (not p_agents or not espion)
$$;

-- Mots qui restent à trouver pour une équipe.
create or replace function public.hg_ndc__restants(p_id uuid, p_equipe text)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_ndc_cartes where partie = p_id and couleur = p_equipe and not revelee
$$;

-- Donne la main à une équipe : son espion doit donner un indice.
create or replace function public.hg_ndc__tour(p_id uuid, p_equipe text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  select * into p from hg_ndc_parties where id = p_id;
  delete from hg_ndc_propositions where partie = p_id;
  update hg_ndc_parties set tour_equipe = p_equipe, phase = 'indice', indice = null, essais = 0,
    tour_fin = now() + make_interval(secs => p.t_espion) where id = p_id;
end $$;

-- Fin de partie : équipe gagnante, Paillettes, badges.
create or replace function public.hg_ndc__terminer(p_id uuid, p_equipe text, p_raison text default null, p_annulee boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; cfg jsonb; pts jsonb; r record; v_gain int; v_jour int; v_plafond int; v_min int; v_n int; v_off jsonb;
  v_debut timestamptz := date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  select * into p from hg_ndc_parties where id = p_id for update;
  if p.statut in ('terminee', 'annulee') then return; end if;
  cfg := coalesce((select value from hg_settings where key = 'nom_de_code'), '{}'::jsonb);
  pts := coalesce(cfg->'paillettes', '{}'::jsonb);
  v_plafond := coalesce((cfg->>'plafond_jour')::int, 800);
  v_min := coalesce((cfg->>'min_joueurs')::int, 4);
  v_off := coalesce(cfg->'badges_inactifs', '[]'::jsonb);
  select count(*) into v_n from hg_ndc_joueurs where partie = p_id and equipe is not null;

  update hg_ndc_joueurs set gagne = (equipe = p_equipe) where partie = p_id and equipe is not null;
  delete from hg_ndc_propositions where partie = p_id;
  update hg_ndc_parties set statut = case when p_annulee then 'annulee' else 'terminee' end, vainqueur = p_equipe,
    tour_fin = null, phase = null, ended_at = now(), version = version + 1,
    etat = etat || jsonb_build_object('raison', coalesce(p_raison, case when p_annulee then 'arret' else 'mots' end)) where id = p_id;
  perform hg_ndc__log(p_id, null, 'fin', case when p_annulee then 'La partie a été arrêtée.'
    else 'L''équipe ' || hg_ndc__equipe_nom(p_equipe) || ' gagne la partie !' end);

  if p_annulee or p_equipe is null or v_n < v_min then return; end if;

  for r in select x.* from hg_ndc_joueurs x where x.partie = p_id and x.equipe is not null and not x.invite and not x.parti
           and exists (select 1 from hg_profiles pr where pr.id = x.user_id and not pr.is_ghost) loop
    v_gain := coalesce((pts->>'partie')::int, 30)
      + case when r.gagne then coalesce((pts->>'victoire')::int, 80) + case when r.espion then coalesce((pts->>'bonus_espion')::int, 20) else 0 end else 0 end;
    select coalesce(sum(delta), 0) into v_jour from hg_wallet_log where user_id = r.user_id and reason = 'nom_de_code' and created_at >= v_debut;
    v_gain := greatest(0, least(v_gain, v_plafond - v_jour));
    if v_gain > 0 and hg_wallet_add(r.user_id, v_gain, 'nom_de_code', 'ndc:' || p_id || ':' || r.user_id) then
      update hg_ndc_joueurs set paillettes = v_gain where partie = p_id and user_id = r.user_id;
    end if;
    if r.gagne and not v_off ? 'ndc_premiere' then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'ndc_premiere') on conflict do nothing;
    end if;
    if r.gagne and not v_off ? 'ndc_sans_faute' and not exists (select 1 from hg_ndc_cartes c where c.partie = p_id
         and c.revelee and c.revele_equipe = r.equipe and c.couleur <> r.equipe) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'ndc_sans_faute') on conflict do nothing;
    end if;
    if r.gagne and r.espion and not v_off ? 'ndc_maitre_espion' and (select count(*) from hg_ndc_joueurs j2 join hg_ndc_parties p2 on p2.id = j2.partie
         where j2.user_id = r.user_id and j2.espion and j2.gagne and p2.statut = 'terminee') >= 10 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'ndc_maitre_espion') on conflict do nothing;
    end if;
    if r.espion and not v_off ? 'ndc_telepathe' and exists (select 1 from hg_ndc_indices i where i.partie = p_id and i.espion = r.user_id and i.trouves >= 4) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'ndc_telepathe') on conflict do nothing;
    end if;
    if not v_off ? 'ndc_kamikaze' and exists (select 1 from hg_ndc_cartes c where c.partie = p_id and c.couleur = 'assassin' and c.revele_par = r.user_id) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'ndc_kamikaze') on conflict do nothing;
    end if;
  end loop;
end $$;

-- Révèle une carte pour l'équipe au tour : suite du tour, ou fin de partie.
create or replace function public.hg_ndc__reveler(p_id uuid, p_pos int, p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; c hg_ndc_cartes; v_eq text; v_autre text; v_qui text;
begin
  select * into p from hg_ndc_parties where id = p_id for update;
  select * into c from hg_ndc_cartes where partie = p_id and pos = p_pos for update;
  if not found or c.revelee then raise exception 'Ce mot est déjà révélé.'; end if;
  v_eq := p.tour_equipe; v_autre := hg_ndc__autre(v_eq);
  v_qui := case when p_user is null then 'L''équipe ' || hg_ndc__equipe_nom(v_eq) else hg_ndc__nom(p_id, p_user) end;
  update hg_ndc_cartes set revelee = true, revele_par = p_user, revele_equipe = v_eq, revele_at = now() where partie = p_id and pos = p_pos;
  delete from hg_ndc_propositions where partie = p_id and pos = p_pos;
  update hg_ndc_indices set mots = mots || c.mot, trouves = trouves + case when c.couleur = v_eq then 1 else 0 end where id = p.indice;
  if c.couleur = v_eq and p_user is not null then
    update hg_ndc_joueurs set trouves = trouves + 1 where partie = p_id and user_id = p_user;
  end if;
  perform hg_ndc__log(p_id, p_user, 'revele', v_qui || ' révèle « ' || c.mot || ' » : '
    || case c.couleur when v_eq then 'bien joué !' when v_autre then 'un mot de l''équipe ' || hg_ndc__equipe_nom(v_autre) || '.'
                      when 'neutre' then 'un passant.' else 'l''assassin !' end);

  if c.couleur = 'assassin' then
    update hg_ndc_parties set etat = etat || jsonb_build_object('assassin', p_user) where id = p_id;
    perform hg_ndc__terminer(p_id, v_autre, 'assassin');
  elsif hg_ndc__restants(p_id, 'jaune') = 0 then
    perform hg_ndc__terminer(p_id, 'jaune', 'mots');
  elsif hg_ndc__restants(p_id, 'rose') = 0 then
    perform hg_ndc__terminer(p_id, 'rose', 'mots');
  elsif c.couleur <> v_eq then
    perform hg_ndc__tour(p_id, v_autre);
  elsif p.essais <= 1 then
    perform hg_ndc__log(p_id, null, 'info', 'Plus d''essai pour l''équipe ' || hg_ndc__equipe_nom(v_eq) || '.');
    perform hg_ndc__tour(p_id, v_autre);
  else
    update hg_ndc_parties set essais = essais - 1 where id = p_id;
  end if;
  return c.couleur;
end $$;

-- Vérifie la majorité des agents présents sur une carte ; la révèle si elle est atteinte (au nom de l'agent qui l'a fait basculer).
create or replace function public.hg_ndc__majorite(p_id uuid, p_user uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_n int; r record;
begin
  select * into p from hg_ndc_parties where id = p_id;
  if p.statut <> 'en_cours' or p.phase <> 'devine' or p.validation <> 'majorite' then return; end if;
  v_n := hg_ndc__presents(p_id, p.tour_equipe, true);
  select pr.pos, count(*) n into r from hg_ndc_propositions pr join hg_ndc_joueurs j on j.partie = pr.partie and j.user_id = pr.user_id
    where pr.partie = p_id and j.equipe = p.tour_equipe and not j.espion and not j.parti group by pr.pos order by count(*) desc limit 1;
  if r.pos is not null and r.n * 2 > v_n then
    perform hg_ndc__reveler(p_id, r.pos, p_user);
  end if;
end $$;

-- Échéance dépassée : l'espion n'a pas donné d'indice, ou l'équipe n'a pas fini : le tour passe.
create or replace function public.hg_ndc__echeances(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  select * into p from hg_ndc_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.tour_fin is null or now() < p.tour_fin then return false; end if;
  perform hg_ndc__log(p_id, null, 'auto', case when p.phase = 'indice' then 'Temps écoulé : pas d''indice de l''espion ' || hg_ndc__equipe_nom(p.tour_equipe) || '.'
    else 'Temps écoulé pour l''équipe ' || hg_ndc__equipe_nom(p.tour_equipe) || '.' end);
  perform hg_ndc__tour(p_id, hg_ndc__autre(p.tour_equipe));
  perform hg_ndc__bump(p_id);
  return true;
end $$;

-- Un joueur quitte une partie en cours : nouvel espion si besoin ; une équipe réduite à moins de 2 joueurs perd.
create or replace function public.hg_ndc__depart(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare j hg_ndc_joueurs; v_nouvel uuid; p hg_ndc_parties;
begin
  select * into j from hg_ndc_joueurs where partie = p_id and user_id = p_user;
  if not found or j.parti then return; end if;
  update hg_ndc_joueurs set parti = true, espion = false where partie = p_id and user_id = p_user;
  delete from hg_ndc_propositions where partie = p_id and user_id = p_user;
  perform hg_ndc__log(p_id, p_user, 'info', j.pseudo || ' quitte la partie.');
  if j.equipe is null then return; end if;
  if hg_ndc__presents(p_id, j.equipe) < 2 then
    perform hg_ndc__terminer(p_id, hg_ndc__autre(j.equipe), 'forfait');
    return;
  end if;
  if j.espion then
    select user_id into v_nouvel from hg_ndc_joueurs where partie = p_id and equipe = j.equipe and not parti order by random() limit 1;
    update hg_ndc_joueurs set espion = true where partie = p_id and user_id = v_nouvel;
    perform hg_ndc__log(p_id, v_nouvel, 'info', hg_ndc__nom(p_id, v_nouvel) || ' devient l''espion de l''équipe ' || hg_ndc__equipe_nom(j.equipe) || '.');
  end if;
  select * into p from hg_ndc_parties where id = p_id;
  perform hg_ndc__majorite(p_id);
end $$;

-- Appelée chaque minute par pg_cron.
create or replace function public.hg_ndc_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from hg_ndc_parties where statut = 'en_cours' and tour_fin < now() loop
    if hg_ndc__echeances(r.id) then n := n + 1; end if;
  end loop;
  update hg_ndc_parties set statut = 'annulee', version = version + 1 where statut = 'attente' and activite_at < now() - interval '6 hours';
  for r in select id from hg_ndc_parties where statut = 'en_cours' and activite_at < now() - interval '3 hours' loop
    perform hg_ndc__terminer(r.id, null, 'abandon', true);
  end loop;
  return n;
end $$;

/* =====================================================================
   5. Fonctions publiques : salle d'attente
   ===================================================================== */

create or replace function public.hg_ndc__identite(p_pseudo text)
returns table(pseudo text, couleur text, avatar_url text, invite boolean) language plpgsql stable security definer set search_path = public as $$
declare pr hg_profiles;
begin
  select * into pr from hg_profiles where id = auth.uid() and not is_ghost;
  if found then return query select pr.pseudo, pr.color, pr.avatar_url, false; return; end if;
  if p_pseudo is null or char_length(trim(p_pseudo)) not between 2 and 24 then
    raise exception 'Choisis un pseudo de 2 à 24 caractères.';
  end if;
  return query select trim(p_pseudo), null::text, null::text, true;
end $$;

create or replace function public.hg_ndc__entrer(p_id uuid, p_pseudo text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; i record; v_n int;
begin
  select * into p from hg_ndc_parties where id = p_id;
  select count(*) into v_n from hg_ndc_joueurs where partie = p_id;
  if v_n >= p.nb_places then raise exception 'La partie est complète (% places).', p.nb_places; end if;
  for i in select * from hg_ndc__identite(p_pseudo) loop
    if i.invite and not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if exists (select 1 from hg_ndc_joueurs where partie = p_id and lower(pseudo) = lower(i.pseudo)) then
      raise exception 'Le pseudo « % » est déjà pris dans cette partie.', i.pseudo;
    end if;
    insert into hg_ndc_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite, place, pret)
    values (p_id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite,
            coalesce((select max(place) from hg_ndc_joueurs where partie = p_id), 0) + 1, auth.uid() = p.hote);
    perform hg_ndc__log(p_id, auth.uid(), 'info', i.pseudo || ' rejoint la partie.');
  end loop;
end $$;

create or replace function public.hg_ndc_creer(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_nb int; v_te int; v_tq int; v_paq text;
begin
  if not hg_ndc_peut() or exists (select 1 from hg_ndc_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  v_nb := coalesce((p->>'nb_places')::int, 12);
  if v_nb < 4 or v_nb > 20 then raise exception 'Le nombre de places doit être entre 4 et 20.'; end if;
  v_te := coalesce((p->>'t_espion')::int, 90);
  if v_te not in (60, 90, 120) then raise exception 'Temps de l''espion invalide.'; end if;
  v_tq := coalesce((p->>'t_equipe')::int, 120);
  if v_tq not in (0, 60, 120) then raise exception 'Temps de l''équipe invalide.'; end if;
  v_paq := coalesce(nullif(p->>'paquet', ''), 'classique');
  if (select count(*) from hg_ndc_mots where paquet = v_paq and actif) < 25 then raise exception 'Ce paquet de mots n''est pas disponible.'; end if;
  v_code := hg_ndc__code();
  insert into hg_ndc_parties(code, nom, hote, visibilite, nb_places, invites, t_espion, t_equipe, validation, paquet, annonce_discord)
  values (v_code, left(coalesce(nullif(trim(p->>'nom'), ''), 'Partie de Nom de code'), 60), auth.uid(),
          case when p->>'visibilite' = 'publique' then 'publique' else 'privee' end, v_nb,
          coalesce((p->>'invites')::boolean, true), v_te, v_tq,
          case when p->>'validation' = 'libre' then 'libre' else 'majorite' end, v_paq,
          coalesce((p->>'annonce_discord')::boolean, false))
  returning id into v_id;
  perform hg_ndc__entrer(v_id, null);
  return v_code;
end $$;

create or replace function public.hg_ndc_rejoindre(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  if not hg_ndc_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  p := hg_ndc__partie(p_code, true);
  if hg_ndc_dans(p.id) then return p.code; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  perform hg_ndc__entrer(p.id, null);
  perform hg_ndc__bump(p.id);
  return p.code;
end $$;

create or replace function public.hg_ndc_quitter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_nouvel uuid;
begin
  p := hg_ndc__partie(p_code, true);
  if not hg_ndc_dans(p.id) then return; end if;
  if p.statut = 'attente' then
    delete from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
    perform hg_ndc__log(p.id, auth.uid(), 'info', 'Un joueur quitte la salle.');
    if p.hote = auth.uid() then
      select user_id into v_nouvel from hg_ndc_joueurs where partie = p.id and not invite order by place limit 1;
      if v_nouvel is null then
        update hg_ndc_parties set statut = 'annulee' where id = p.id;
      else
        update hg_ndc_parties set hote = v_nouvel where id = p.id;
        update hg_ndc_joueurs set pret = true where partie = p.id and user_id = v_nouvel;
        perform hg_ndc__log(p.id, v_nouvel, 'info', hg_ndc__nom(p.id, v_nouvel) || ' devient l''hôte.');
      end if;
    end if;
  elsif p.statut = 'en_cours' then
    perform hg_ndc__depart(p.id, auth.uid());
  end if;
  perform hg_ndc__bump(p.id);
end $$;

create or replace function public.hg_ndc_pret(p_code text, p_pret boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  p := hg_ndc__partie(p_code, true);
  if p.statut <> 'attente' or not hg_ndc_dans(p.id) then raise exception 'Action impossible.'; end if;
  update hg_ndc_joueurs set pret = coalesce(p_pret, true) or user_id = p.hote where partie = p.id and user_id = auth.uid();
  perform hg_ndc__bump(p.id);
end $$;

create or replace function public.hg_ndc_exclure(p_code text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  p := hg_ndc__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut retirer un joueur.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if p_user = p.hote then raise exception 'L''hôte ne peut pas se retirer lui-même.'; end if;
  perform hg_ndc__log(p.id, p_user, 'info', hg_ndc__nom(p.id, p_user) || ' est retiré de la salle.');
  delete from hg_ndc_joueurs where partie = p.id and user_id = p_user;
  perform hg_ndc__bump(p.id);
end $$;

-- Rejoindre une équipe (jaune, rose, ou null pour « sans équipe »). L'hôte peut placer un autre joueur.
create or replace function public.hg_ndc_equipe(p_code text, p_equipe text, p_user uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_u uuid := coalesce(p_user, auth.uid());
begin
  p := hg_ndc__partie(p_code, true);
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if not hg_ndc_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  if v_u <> auth.uid() and p.hote <> auth.uid() then raise exception 'Seul l''hôte peut changer l''équipe d''un autre joueur.'; end if;
  if p_equipe is not null and p_equipe not in ('jaune', 'rose') then raise exception 'Équipe inconnue.'; end if;
  update hg_ndc_joueurs set equipe = p_equipe, espion = case when equipe is distinct from p_equipe then false else espion end
  where partie = p.id and user_id = v_u;
  if not found then raise exception 'Joueur introuvable.'; end if;
  perform hg_ndc__bump(p.id);
end $$;

-- Devenir (ou désigner, pour l'hôte) l'espion de son équipe ; p_oui faux : redevenir agent.
create or replace function public.hg_ndc_espion(p_code text, p_user uuid default null, p_oui boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_u uuid := coalesce(p_user, auth.uid()); v_eq text;
begin
  p := hg_ndc__partie(p_code, true);
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if v_u <> auth.uid() and p.hote <> auth.uid() then raise exception 'Seul l''hôte peut désigner un espion.'; end if;
  select equipe into v_eq from hg_ndc_joueurs where partie = p.id and user_id = v_u;
  if v_eq is null then raise exception 'Choisis d''abord une équipe.'; end if;
  if coalesce(p_oui, true) then
    update hg_ndc_joueurs set espion = (user_id = v_u) where partie = p.id and equipe = v_eq;
  else
    update hg_ndc_joueurs set espion = false where partie = p.id and user_id = v_u;
  end if;
  perform hg_ndc__bump(p.id);
end $$;

-- Hôte : répartit tout le monde au hasard en deux équipes équilibrées, espions tirés au sort.
create or replace function public.hg_ndc_equilibrer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  p := hg_ndc__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut équilibrer les équipes.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  with m as (select user_id, row_number() over (order by random()) rn from hg_ndc_joueurs where partie = p.id)
  update hg_ndc_joueurs j set equipe = case when m.rn % 2 = 1 then 'jaune' else 'rose' end, espion = false
  from m where j.partie = p.id and j.user_id = m.user_id;
  perform hg_ndc__log(p.id, auth.uid(), 'info', 'Les équipes sont tirées au sort.');
  perform hg_ndc__bump(p.id);
end $$;

create or replace function public.hg_ndc_lancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_n int; v_min int; r record; v_eq text; v_debut text; v_mots text[]; v_coul text[]; i int;
begin
  p := hg_ndc__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut lancer la partie.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  v_min := greatest(4, coalesce((select (value->>'min_joueurs')::int from hg_settings where key = 'nom_de_code'), 4));
  select count(*) into v_n from hg_ndc_joueurs where partie = p.id;
  if v_n < v_min then raise exception 'Il faut au moins % joueurs.', v_min; end if;
  if exists (select 1 from hg_ndc_joueurs where partie = p.id and not pret) then raise exception 'Tous les joueurs doivent être prêts.'; end if;
  -- Les joueurs sans équipe complètent la plus petite.
  for r in select user_id from hg_ndc_joueurs where partie = p.id and equipe is null order by random() loop
    v_eq := case when hg_ndc__presents(p.id, 'jaune') <= hg_ndc__presents(p.id, 'rose') then 'jaune' else 'rose' end;
    update hg_ndc_joueurs set equipe = v_eq where partie = p.id and user_id = r.user_id;
  end loop;
  if hg_ndc__presents(p.id, 'jaune') < 2 or hg_ndc__presents(p.id, 'rose') < 2 then
    raise exception 'Chaque équipe doit avoir au moins 2 joueurs : un espion et un agent.';
  end if;
  -- Un espion par équipe (tiré au sort s'il n'est pas choisi).
  foreach v_eq in array array['jaune', 'rose'] loop
    if not exists (select 1 from hg_ndc_joueurs where partie = p.id and equipe = v_eq and espion) then
      update hg_ndc_joueurs set espion = true where partie = p.id and user_id =
        (select user_id from hg_ndc_joueurs where partie = p.id and equipe = v_eq order by random() limit 1);
    end if;
  end loop;
  -- Grille : 25 mots ; 9 pour l'équipe qui commence, 8 pour l'autre, 7 passants, 1 assassin.
  v_debut := case when random() < 0.5 then 'jaune' else 'rose' end;
  select array_agg(mot) into v_mots from (select mot from hg_ndc_mots where paquet = p.paquet and actif order by random() limit 25) x;
  if coalesce(array_length(v_mots, 1), 0) < 25 then raise exception 'Le paquet de mots est trop petit.'; end if;
  select array_agg(c order by random()) into v_coul from unnest(
    array_fill(v_debut, array[9]) || array_fill(hg_ndc__autre(v_debut), array[8]) || array_fill('neutre'::text, array[7]) || array['assassin']) c;
  delete from hg_ndc_cartes where partie = p.id;
  for i in 1 .. 25 loop
    insert into hg_ndc_cartes(partie, pos, mot, couleur) values (p.id, i - 1, v_mots[i], v_coul[i]);
  end loop;
  update hg_ndc_parties set statut = 'en_cours', started_at = now(), equipe_debut = v_debut where id = p.id;
  perform hg_ndc__log(p.id, null, 'info', 'La partie commence : l''équipe ' || hg_ndc__equipe_nom(v_debut) || ' joue en premier (9 mots contre 8).');
  perform hg_ndc__tour(p.id, v_debut);
  perform hg_ndc__bump(p.id);
end $$;

/* =====================================================================
   6. Fonctions publiques : le jeu
   ===================================================================== */

-- Partie en cours où je joue (verrouillée) ; une échéance dépassée est d'abord appliquée.
create or replace function public.hg_ndc__ma_partie(p_code text)
returns public.hg_ndc_parties language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  p := hg_ndc__partie(p_code, true);
  if not hg_ndc_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  if p.statut <> 'en_cours' then raise exception 'La partie n''est pas en cours.'; end if;
  if (select parti from hg_ndc_joueurs where partie = p.id and user_id = auth.uid()) then raise exception 'Tu as quitté la partie.'; end if;
  if p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_ndc__echeances(p.id);
    raise exception 'Temps écoulé : le tour est passé.';
  end if;
  return p;
end $$;

-- L'espion de l'équipe au tour donne son indice : un seul mot, et un nombre de 0 à 9 (0 : autant d'essais que voulu).
create or replace function public.hg_ndc_indice(p_code text, p_mot text, p_nombre int)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; j hg_ndc_joueurs; v_mot text := trim(coalesce(p_mot, '')); v_n text; c record; v_id bigint;
begin
  p := hg_ndc__ma_partie(p_code);
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
  if not j.espion or j.equipe <> p.tour_equipe then raise exception 'Seul l''espion de l''équipe au tour donne l''indice.'; end if;
  if p.phase <> 'indice' then raise exception 'L''indice est déjà donné.'; end if;
  if v_mot !~ '^[[:alpha:]][[:alpha:]''-]{0,23}$' then raise exception 'L''indice doit être un seul mot, sans espace ni chiffre.'; end if;
  if p_nombre is null or p_nombre not between 0 and 9 then raise exception 'Le nombre doit être entre 0 et 9.'; end if;
  v_n := hg_ndc__norme(v_mot);
  for c in select mot from hg_ndc_cartes where partie = p.id and not revelee loop
    -- Égalité, ou l'un contient l'autre (seulement à partir de 4 lettres : « Or » ne bloque pas « Porte »).
    if hg_ndc__norme(c.mot) = v_n
       or (char_length(hg_ndc__norme(c.mot)) >= 4 and position(hg_ndc__norme(c.mot) in v_n) > 0)
       or (char_length(v_n) >= 4 and position(v_n in hg_ndc__norme(c.mot)) > 0) then
      raise exception 'Indice refusé : il ressemble trop à un mot de la grille.';
    end if;
  end loop;
  insert into hg_ndc_indices(partie, equipe, espion, mot, nombre) values (p.id, p.tour_equipe, auth.uid(), upper(left(v_mot, 1)) || lower(substr(v_mot, 2)), p_nombre)
  returning id into v_id;
  delete from hg_ndc_propositions where partie = p.id;
  update hg_ndc_parties set phase = 'devine', indice = v_id, essais = case when p_nombre = 0 then 25 else p_nombre + 1 end,
    tour_fin = case when t_equipe = 0 then null else now() + make_interval(secs => t_equipe) end where id = p.id;
  perform hg_ndc__log(p.id, auth.uid(), 'indice', 'Indice de ' || j.pseudo || ' : « ' || upper(left(v_mot, 1)) || lower(substr(v_mot, 2)) || ' » '
    || case when p_nombre = 0 then '(illimité)' else p_nombre::text end || '.');
  perform hg_ndc__bump(p.id);
end $$;

-- Un agent de l'équipe au tour pose son jeton sur un mot (p_pos null : retire son jeton). Majorité : le mot est révélé.
create or replace function public.hg_ndc_proposer(p_code text, p_pos int)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; j hg_ndc_joueurs;
begin
  p := hg_ndc__ma_partie(p_code);
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
  if j.espion or j.equipe <> p.tour_equipe then raise exception 'Seuls les agents de l''équipe au tour proposent des mots.'; end if;
  if p.phase <> 'devine' then raise exception 'Attends l''indice de ton espion.'; end if;
  if p_pos is null then
    delete from hg_ndc_propositions where partie = p.id and user_id = auth.uid();
  else
    if not exists (select 1 from hg_ndc_cartes where partie = p.id and pos = p_pos and not revelee) then raise exception 'Ce mot est déjà révélé.'; end if;
    insert into hg_ndc_propositions(partie, user_id, pos) values (p.id, auth.uid(), p_pos)
    on conflict (partie, user_id) do update set pos = excluded.pos, created_at = now();
    perform hg_ndc__majorite(p.id, auth.uid());
  end if;
  perform hg_ndc__bump(p.id);
end $$;

-- Mode « libre » : un agent valide un mot, il est révélé tout de suite. Renvoie la couleur révélée.
create or replace function public.hg_ndc_valider(p_code text, p_pos int)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; j hg_ndc_joueurs; v text;
begin
  p := hg_ndc__ma_partie(p_code);
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
  if j.espion or j.equipe <> p.tour_equipe then raise exception 'Seuls les agents de l''équipe au tour valident un mot.'; end if;
  if p.phase <> 'devine' then raise exception 'Attends l''indice de ton espion.'; end if;
  if p.validation <> 'libre' then raise exception 'Dans cette partie, un mot est révélé à la majorité de l''équipe.'; end if;
  v := hg_ndc__reveler(p.id, p_pos, auth.uid());
  perform hg_ndc__bump(p.id);
  return v;
end $$;

-- « On s'arrête » : l'équipe finit son tour (au moins un mot révélé sur l'indice).
create or replace function public.hg_ndc_arreter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; j hg_ndc_joueurs;
begin
  p := hg_ndc__ma_partie(p_code);
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
  if j.espion or j.equipe <> p.tour_equipe then raise exception 'Seuls les agents de l''équipe au tour peuvent s''arrêter.'; end if;
  if p.phase <> 'devine' then raise exception 'Attends l''indice de ton espion.'; end if;
  if coalesce((select cardinality(mots) from hg_ndc_indices where id = p.indice), 0) = 0 then raise exception 'Révélez au moins un mot avant de vous arrêter.'; end if;
  perform hg_ndc__log(p.id, auth.uid(), 'info', j.pseudo || ' arrête le tour de l''équipe ' || hg_ndc__equipe_nom(j.equipe) || '.');
  perform hg_ndc__tour(p.id, hg_ndc__autre(p.tour_equipe));
  perform hg_ndc__bump(p.id);
end $$;

create or replace function public.hg_ndc_avancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  p := hg_ndc__partie(p_code, true);
  if not hg_ndc_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  perform hg_ndc__echeances(p.id);
end $$;

-- Chat : canal 'general' ou 'equipe' (le canal de mon équipe ; l'espion ne peut pas y écrire).
create or replace function public.hg_ndc_message(p_code text, p_texte text, p_canal text default 'general')
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; t text; j hg_ndc_joueurs; v_canal text := 'general';
begin
  p := hg_ndc__partie(p_code);
  if not hg_ndc_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = auth.uid();
  if p_canal = 'equipe' then
    if j.equipe is null then raise exception 'Choisis d''abord une équipe.'; end if;
    if j.espion and p.statut = 'en_cours' then raise exception 'L''espion ne peut pas écrire dans le chat de son équipe.'; end if;
    v_canal := j.equipe;
  end if;
  t := left(trim(coalesce(p_texte, '')), 300);
  if t = '' then raise exception 'Message vide.'; end if;
  if (select count(*) from hg_ndc_messages where partie = p.id and user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Doucement : attends quelques secondes avant d''écrire.';
  end if;
  insert into hg_ndc_messages(partie, user_id, canal, texte) values (p.id, auth.uid(), v_canal, t);
end $$;

create or replace function public.hg_ndc_messages(p_partie uuid, p_apres bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_eq text;
begin
  if not hg_ndc_dans(p_partie) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  v_eq := hg_ndc_mon_equipe(p_partie);
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'pseudo', hg_ndc__nom(p_partie, m.user_id),
      'canal', case when m.canal = 'general' then 'general' else 'equipe' end, 'texte', m.texte, 'created_at', m.created_at) order by m.id)
    from (select * from hg_ndc_messages where partie = p_partie and id > coalesce(p_apres, 0) and (canal = 'general' or canal = v_eq)
          order by id desc limit 200) m), '[]'::jsonb);
end $$;

-- Revanche : mêmes réglages, nouvelle salle ; l'hôte y entre, les autres la rejoignent (les espions changent).
create or replace function public.hg_ndc_rejouer(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_code text; v_id uuid;
begin
  p := hg_ndc__partie(p_code, true);
  if not hg_ndc_dans(p.id) or exists (select 1 from hg_ndc_invites where user_id = auth.uid()) then raise exception 'Seul un membre de la partie peut lancer la revanche.'; end if;
  if p.statut not in ('terminee', 'annulee') then raise exception 'La partie n''est pas finie.'; end if;
  if p.etat ? 'suite' then return p.etat->>'suite'; end if;
  v_code := hg_ndc__code();
  insert into hg_ndc_parties(code, nom, hote, visibilite, nb_places, invites, t_espion, t_equipe, validation, paquet, annonce_discord)
  values (v_code, p.nom, auth.uid(), p.visibilite, p.nb_places, p.invites, p.t_espion, p.t_equipe, p.validation, p.paquet, false)
  returning id into v_id;
  perform hg_ndc__entrer(v_id, null);
  -- Même équipe qu'avant pour celui qui lance la revanche.
  update hg_ndc_joueurs set equipe = (select equipe from hg_ndc_joueurs where partie = p.id and user_id = auth.uid())
  where partie = v_id and user_id = auth.uid();
  update hg_ndc_parties set etat = etat || jsonb_build_object('suite', v_code), version = version + 1 where id = p.id;
  return v_code;
end $$;

/* =====================================================================
   7. Lecture : état, listes, statistiques
   ===================================================================== */

create or replace function public.hg_ndc_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; v_moi uuid := auth.uid(); v_joue boolean; j hg_ndc_joueurs; v_voit boolean; v_fini boolean;
begin
  p := hg_ndc__partie(p_code);
  v_joue := hg_ndc_dans(p.id);
  if not v_joue and not (p.visibilite = 'publique' and p.statut = 'attente' and hg_ndc_peut()) then
    raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501';
  end if;
  if p.statut = 'en_cours' and p.tour_fin is not null and now() >= p.tour_fin and v_joue then
    perform hg_ndc__echeances(p.id);
    select * into p from hg_ndc_parties where id = p.id;
  end if;
  select * into j from hg_ndc_joueurs where partie = p.id and user_id = v_moi;
  v_fini := p.statut in ('terminee', 'annulee');
  -- Couleurs secrètes : espions encore en jeu, ou tout le monde à la fin.
  v_voit := v_fini or (coalesce(j.espion, false) and not coalesce(j.parti, false));

  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'code', p.code, 'nom', p.nom, 'statut', p.statut, 'hote', p.hote,
      'visibilite', p.visibilite, 'invites', p.invites, 'nb_places', p.nb_places, 't_espion', p.t_espion, 't_equipe', p.t_equipe,
      'validation', p.validation, 'paquet', p.paquet, 'equipe_debut', p.equipe_debut, 'tour_equipe', p.tour_equipe, 'phase', p.phase,
      'essais', case when p.phase = 'devine' then p.essais end, 'tour_fin', p.tour_fin, 'vainqueur', p.vainqueur,
      'raison', p.etat->>'raison', 'assassin', p.etat->>'assassin', 'suite', p.etat->>'suite', 'version', p.version,
      'restants', jsonb_build_object('jaune', hg_ndc__restants(p.id, 'jaune'), 'rose', hg_ndc__restants(p.id, 'rose')),
      'totaux', jsonb_build_object('jaune', (select count(*) from hg_ndc_cartes where partie = p.id and couleur = 'jaune'),
                                   'rose', (select count(*) from hg_ndc_cartes where partie = p.id and couleur = 'rose'))),
    'maintenant', now(),
    'moi', jsonb_build_object('user_id', v_moi, 'joue', v_joue, 'hote', p.hote = v_moi,
      'invite', exists (select 1 from hg_ndc_invites where user_id = v_moi),
      'equipe', j.equipe, 'espion', coalesce(j.espion, false), 'parti', coalesce(j.parti, false)),
    'joueurs', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'pseudo', x.pseudo, 'couleur', x.couleur,
        'avatar_url', x.avatar_url, 'invite', x.invite, 'place', x.place, 'equipe', x.equipe, 'espion', x.espion, 'pret', x.pret,
        'parti', x.parti, 'trouves', x.trouves, 'gagne', x.gagne, 'paillettes', x.paillettes) order by x.place)
      from hg_ndc_joueurs x where x.partie = p.id), '[]'::jsonb),
    'cartes', coalesce((select jsonb_agg(jsonb_build_object('pos', c.pos, 'mot', c.mot,
        'couleur', case when c.revelee or v_voit then c.couleur end, 'revelee', c.revelee, 'revele_par', c.revele_par,
        'propositions', coalesce((select jsonb_agg(pr.user_id order by pr.created_at) from hg_ndc_propositions pr
                                  where pr.partie = p.id and pr.pos = c.pos), '[]'::jsonb)) order by c.pos)
      from hg_ndc_cartes c where c.partie = p.id), '[]'::jsonb),
    'indice', (select jsonb_build_object('id', i.id, 'equipe', i.equipe, 'mot', i.mot, 'nombre', i.nombre, 'trouves', i.trouves, 'mots', to_jsonb(i.mots))
      from hg_ndc_indices i where i.id = p.indice),
    'indices', coalesce((select jsonb_agg(jsonb_build_object('equipe', i.equipe, 'espion', i.espion, 'mot', i.mot, 'nombre', i.nombre,
        'trouves', i.trouves, 'mots', to_jsonb(i.mots)) order by i.id) from hg_ndc_indices i where i.partie = p.id), '[]'::jsonb),
    'journal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'type', x.type, 'texte', x.texte,
        'created_at', x.created_at) order by x.id desc)
      from (select * from hg_ndc_coups where partie = p.id order by id desc limit 20) x), '[]'::jsonb),
    'badges', case when p.statut = 'terminee' and v_joue then coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name))
        from hg_user_badges ub join hg_badges b on b.code = ub.badge_code
        where ub.user_id = v_moi and b.code like 'ndc\_%' and ub.awarded_at >= coalesce(p.ended_at, now()) - interval '5 seconds'), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

create or replace function public.hg_ndc_publiques()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_ndc_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_ndc__nom(p.id, p.hote),
      'hote_couleur', (select couleur from hg_ndc_joueurs where partie = p.id and user_id = p.hote),
      'inscrits', (select count(*) from hg_ndc_joueurs where partie = p.id), 'nb_places', p.nb_places,
      't_espion', p.t_espion, 't_equipe', p.t_equipe, 'validation', p.validation) order by p.created_at desc)
    from hg_ndc_parties p where p.statut = 'attente' and p.visibilite = 'publique'), '[]'::jsonb);
end $$;

create or replace function public.hg_ndc_mes_parties()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_ndc_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'statut', p.statut,
      'inscrits', (select count(*) from hg_ndc_joueurs where partie = p.id and not parti), 'equipe', j.equipe, 'espion', j.espion,
      'tour_equipe', p.tour_equipe, 'phase', p.phase,
      'a_moi', p.statut = 'en_cours' and p.tour_equipe = j.equipe and ((p.phase = 'indice') = j.espion))
      order by p.created_at desc)
    from hg_ndc_parties p join hg_ndc_joueurs j on j.partie = p.id and j.user_id = auth.uid()
    where p.statut in ('attente', 'en_cours') and not j.parti), '[]'::jsonb);
end $$;

create or replace function public.hg_ndc_stats(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_u uuid := coalesce(p_user, auth.uid());
begin
  if not hg_ndc_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'parties', (select count(*) from hg_ndc_joueurs j join hg_ndc_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee' and j.equipe is not null),
    'victoires', (select count(*) from hg_ndc_joueurs j join hg_ndc_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee' and j.gagne),
    'espion', (select count(*) from hg_ndc_joueurs j join hg_ndc_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee' and j.espion),
    'victoires_espion', (select count(*) from hg_ndc_joueurs j join hg_ndc_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee' and j.espion and j.gagne),
    'mots_trouves', (select coalesce(sum(j.trouves), 0) from hg_ndc_joueurs j join hg_ndc_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee'),
    'meilleur_indice', (select jsonb_build_object('mot', i.mot, 'nombre', i.nombre, 'trouves', i.trouves) from hg_ndc_indices i
        join hg_ndc_parties p on p.id = i.partie where i.espion = v_u and p.statut = 'terminee' order by i.trouves desc, i.id desc limit 1),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'obtenu', ub.user_id is not null, 'date', ub.awarded_at) order by b.sort)
      from hg_badges b left join hg_user_badges ub on ub.badge_code = b.code and ub.user_id = v_u where b.code like 'ndc\_%'), '[]'::jsonb)
  );
end $$;

/* =====================================================================
   8. Administration
   ===================================================================== */

create or replace function public.hg_ndc_admin_reglages()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'nom_de_code'), '{}'::jsonb);
  return jsonb_build_object(
    'paillettes', coalesce(cfg->'paillettes', '{}'::jsonb),
    'plafond_jour', coalesce((cfg->>'plafond_jour')::int, 800),
    'min_joueurs', coalesce((cfg->>'min_joueurs')::int, 4),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'actif', not coalesce(cfg->'badges_inactifs', '[]'::jsonb) ? b.code,
        'membres', (select count(*) from hg_user_badges u where u.badge_code = b.code)) order by b.sort)
      from hg_badges b where b.code like 'ndc\_%'), '[]'::jsonb),
    'paquets', coalesce((select jsonb_agg(jsonb_build_object('paquet', x.paquet, 'actifs', x.a, 'total', x.t) order by x.paquet)
      from (select paquet, count(*) filter (where actif) a, count(*) t from hg_ndc_mots group by paquet) x), '[]'::jsonb),
    'parties', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_ndc__nom(p.id, p.hote),
        'joueurs', (select count(*) from hg_ndc_joueurs where partie = p.id), 'statut', p.statut, 'tour_equipe', p.tour_equipe,
        'started_at', coalesce(p.started_at, p.created_at)) order by p.created_at desc)
      from hg_ndc_parties p where p.statut in ('attente', 'en_cours')), '[]'::jsonb),
    'terminees', (select count(*) from hg_ndc_parties where statut = 'terminee')
  );
end $$;

create or replace function public.hg_ndc_admin_enregistrer(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb; v_pts jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'nom_de_code'), '{}'::jsonb);
  v_pts := jsonb_build_object(
    'partie', least(greatest(coalesce((p->'paillettes'->>'partie')::int, 30), 0), 1000),
    'victoire', least(greatest(coalesce((p->'paillettes'->>'victoire')::int, 80), 0), 1000),
    'bonus_espion', least(greatest(coalesce((p->'paillettes'->>'bonus_espion')::int, 20), 0), 1000));
  cfg := cfg || jsonb_build_object('paillettes', v_pts,
    'plafond_jour', least(greatest(coalesce((p->>'plafond_jour')::int, 800), 0), 100000),
    'min_joueurs', least(greatest(coalesce((p->>'min_joueurs')::int, 4), 4), 20),
    'badges_inactifs', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p->'badges_inactifs', '[]'::jsonb)) x
                                 where x like 'ndc\_%'), '[]'::jsonb));
  insert into hg_settings(key, value) values ('nom_de_code', cfg) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'ndc_reglages', 'nom_de_code', cfg);
end $$;

create or replace function public.hg_ndc_admin_arreter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  p := hg_ndc__partie(p_code, true);
  if p.statut = 'attente' then
    update hg_ndc_parties set statut = 'annulee', version = version + 1 where id = p.id;
  elsif p.statut = 'en_cours' then
    perform hg_ndc__terminer(p.id, null, 'arret', true);
  end if;
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'ndc_arreter', p.code, '{}'::jsonb);
end $$;

-- Mots d'un paquet (actifs et inactifs).
create or replace function public.hg_ndc_admin_mots(p_paquet text default 'classique')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('mot', mot, 'actif', actif) order by mot)
    from hg_ndc_mots where paquet = coalesce(p_paquet, 'classique')), '[]'::jsonb);
end $$;

-- Ajoute des mots (liste collée), en retire, en active ou désactive. Renvoie le nombre de mots actifs du paquet.
create or replace function public.hg_ndc_admin_enregistrer_mots(p_paquet text, p_ajouter text[] default '{}', p_retirer text[] default '{}',
  p_activer text[] default '{}', p_desactiver text[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare v_paq text := lower(trim(coalesce(p_paquet, ''))); m text; v_n int := 0;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  if v_paq !~ '^[a-z0-9_-]{2,30}$' then raise exception 'Nom de paquet invalide.'; end if;
  foreach m in array coalesce(p_ajouter, '{}') loop
    m := trim(m);
    continue when m = '' or char_length(m) > 24;
    m := upper(left(m, 1)) || substr(m, 2);
    insert into hg_ndc_mots(paquet, mot) values (v_paq, m) on conflict (paquet, mot) do update set actif = true;
    v_n := v_n + 1;
  end loop;
  delete from hg_ndc_mots where paquet = v_paq and mot = any(coalesce(p_retirer, '{}'));
  update hg_ndc_mots set actif = true where paquet = v_paq and mot = any(coalesce(p_activer, '{}'));
  update hg_ndc_mots set actif = false where paquet = v_paq and mot = any(coalesce(p_desactiver, '{}'));
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'ndc_mots', v_paq,
    jsonb_build_object('ajoutes', v_n, 'retires', cardinality(coalesce(p_retirer, '{}'))));
  return (select count(*) from hg_ndc_mots where paquet = v_paq and actif);
end $$;

/* =====================================================================
   9. Invités (sans compte)
   ===================================================================== */

create or replace function public.hg_ndc__devenir(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function public.hg_ndc_invite(p_action text, p_code text, p_jeton text default null, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_ndc_parties; inv hg_ndc_invites; v_uid uuid; v_jeton text; v_pseudo text; v_out jsonb;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  select * into p from hg_ndc_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';
  end if;

  if p_action = 'apercu' then
    return jsonb_build_object('nom', p.nom, 'code', p.code, 'statut', p.statut, 'invites', p.invites, 'nb_places', p.nb_places,
      'inscrits', (select count(*) from hg_ndc_joueurs where partie = p.id), 'hote_pseudo', hg_ndc__nom(p.id, p.hote),
      't_espion', p.t_espion, 't_equipe', p.t_equipe, 'validation', p.validation);
  end if;

  if p_action = 'rejoindre' then
    if not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
    v_pseudo := trim(coalesce(p_args->>'pseudo', ''));
    if char_length(v_pseudo) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
    v_uid := gen_random_uuid();
    v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into hg_ndc_invites(user_id, partie, pseudo, jeton_hash) values (v_uid, p.id, v_pseudo, encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'));
    perform hg_ndc__devenir(v_uid);
    perform hg_ndc__entrer(p.id, v_pseudo);
    perform hg_ndc__bump(p.id);
    return jsonb_build_object('jeton', v_jeton, 'code', p.code, 'user_id', v_uid);
  end if;

  select * into inv from hg_ndc_invites where jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if not found or inv.partie <> p.id then raise exception 'Invitation expirée : rejoins à nouveau la partie.' using errcode = '42501'; end if;
  perform hg_ndc__devenir(inv.user_id);

  case p_action
    when 'etat' then v_out := hg_ndc_etat(p.code);
    when 'pret' then perform hg_ndc_pret(p.code, coalesce((p_args->>'pret')::boolean, true));
    when 'quitter' then perform hg_ndc_quitter(p.code);
    when 'equipe' then perform hg_ndc_equipe(p.code, nullif(p_args->>'equipe', ''));
    when 'espion' then perform hg_ndc_espion(p.code, null, coalesce((p_args->>'oui')::boolean, true));
    when 'indice' then perform hg_ndc_indice(p.code, p_args->>'mot', (p_args->>'nombre')::int);
    when 'proposer' then perform hg_ndc_proposer(p.code, (p_args->>'pos')::int);
    when 'valider' then v_out := to_jsonb(hg_ndc_valider(p.code, (p_args->>'pos')::int));
    when 'arreter' then perform hg_ndc_arreter(p.code);
    when 'message' then perform hg_ndc_message(p.code, p_args->>'texte', coalesce(p_args->>'canal', 'general'));
    when 'avancer' then perform hg_ndc_avancer(p.code);
    when 'messages' then v_out := hg_ndc_messages(p.id, coalesce((p_args->>'apres')::bigint, 0));
    else raise exception 'Action inconnue.';
  end case;
  return v_out;
end $$;

/* =====================================================================
   10. Paquet « Classique »
   ===================================================================== */

insert into public.hg_ndc_mots(paquet, mot)
select 'classique', m from unnest(string_to_array(
'Abeille Acteur Aigle Aiguille Aile Aimant Alarme Album Allumette Alpes Ambulance Ampoule Ancre Ange Anneau Antenne Araignée Arbre Arc Arène Argent Armure Arrosoir Ascenseur Astronaute Atlas Atome Aube Autruche Avalanche Avion Avocat Bague Baguette Baleine Balle Ballon Banane Banc Banque Bar Barbe Barque Bateau Batterie Bazar Bec Berger Beurre Bibliothèque Biche Bijou Billard Biscuit Blé Bloc Bombe Bonbon Bonnet Bosse Botte Bouche Bougie Bouteille Boucle Boussole Bouton Branche Bras Brique Brosse Brouillard Bulle Bureau But Cabane Câble Cactus Cadeau Cadre Café Cage Caisse Calendrier Camion Camp Canard Canne Canon Cape Capitaine Carotte Carte Casino Casque Castor Cathédrale Cave Ceinture Cercle Cerise Cerveau Chaîne Chaise Champ Champignon Chance Chapeau Charbon Chat Château Chaussette Chemin Cheminée Chêne Cheval Cheveu Chien Chocolat Chou Ciel Cinéma Cirque Ciseaux Citron Clé Cloche Clou Clown Cochon Cœur Coffre Colle Collier Colonne Comète Concert Coq Coquillage Corde Corne Costume Côte Coton Couteau Couronne Course Crabe Craie Crayon Crème Crocodile Croix Cuillère Cuir Cuisine Cycle Dame Danse Dauphin Dé Désert Diable Diamant Dinosaure Disque Docteur Doigt Dragon Drapeau Échelle Éclair École Écran Écureuil Église Éléphant Élève Embouteillage Encre Enveloppe Épée Éponge Escalier Espace Étoile Éventail Fantôme Farine Fée Fenêtre Fer Ferme Fête Feu Feuille Fil Filet Flamme Flèche Fleur Fleuve Flûte Forêt Fort Fouet Four Fourchette Fraise Frein Fromage Front Fruit Fusée Galerie Gant Garage Gâteau Géant Genou Glace Gomme Gorille Gouvernail Grain Grenouille Griffe Grotte Guerre Guitare Hache Hamac Hélicoptère Herbe Hérisson Hibou Hiver Hôpital Horloge Hôtel Huile Huître Île Image Insecte Jardin Jet Jeu Journal Jupiter Jus Kangourou Lac Laine Lait Lampe Lance Langue Lapin Laser Lavabo Lettre Lézard Licorne Lien Lion Lit Livre Loup Lune Lunettes Machine Main Maison Manche Manteau Marché Mars Marteau Masque Match Médaille Méduse Mer Mère Météo Miel Miroir Mode Moine Montagne Montre Moteur Mouche Moule Moustache Mouton Mur Musée Musique Nain Neige Nez Nid Ninja Noël Nœud Note Nuage Nuit Œil Œuf Oiseau Olive Ombre Opéra Or Orage Orange Oreille Os Ours Page Paille Pain Palais Palmier Panda Panier Papier Papillon Parachute Parapluie Parc Passage Pâte Patin Pêche Peigne Peinture Pélican Pendule Perle Phare Piano Pied Pierre Pilote Pin Pingouin Pinceau Pioche Pirate Piscine Piste Pizza Placard Plage Planète Plante Plat Plume Poche Poêle Point Poire Poisson Poivre Police Pomme Pompe Pont Porte Poste Poule Poupée Prince Prison Puce Puits Pyramide Radio Raisin Rat Rayon Reine Requin Rêve Robe Robot Roche Roi Roue Ruban Ruche Rue Sable Sac Salade Salon Sapin Satellite Saturne Saut Savon Scie Science Seau Sel Serpent Serre Siège Singe Sirène Ski Soldat Soleil Sorcière Soupe Source Souris Sous-marin Stade Statue Sucre Table Tableau Talon Tambour Tank Tapis Taureau Taxi Téléphone Temple Tempête Tennis Tente Terre Tête Théâtre Tigre Tissu Toile Tomate Tonnerre Torche Tortue Tour Tracteur Train Trésor Triangle Trompette Tronc Tube Tuyau Usine Vache Vague Valise Vampire Vapeur Vase Vélo Vent Ver Verre Veste Viande Village Ville Vin Violon Vis Visage Voile Voiture Volcan Wagon Yacht Zèbre Zéro Zoo', ' ')) m
on conflict (paquet, mot) do nothing;

/* =====================================================================
   11. Notifications : catégorie « jeux » déjà ouverte par la migration 122. Droits d'exécution et tâche planifiée.
   ===================================================================== */

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hg\_ndc%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'hg\_ndc\_\_%' and f.proname <> 'hg_ndc_tick' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.hg_ndc_invite(text, text, text, jsonb) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hg-ndc-tick') then perform cron.unschedule('hg-ndc-tick'); end if;
    perform cron.schedule('hg-ndc-tick', '* * * * *', 'select public.hg_ndc_tick()');
  end if;
end $$;
