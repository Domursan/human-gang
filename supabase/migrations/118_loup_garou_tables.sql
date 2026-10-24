-- ===== Humane Gang — Loup-Garou (1/2) : tables, accès et sécurité =====
-- Le jeu vit dans la page loup-garou.html. Toutes les écritures passent par les fonctions hg_lg_* (migration 119) ;
-- les tables ne sont lisibles que pour le temps réel (partie, joueurs, messages), jamais les rôles secrets.
-- Accès : hg_lg_peut() = accès à la page « loup-garou » (hg_page_ok : admins tant que la page est en mode « admin »)
-- ou compte testeur listé dans hg_settings.loup_garou.testeurs. Ouvrir la page aux membres ouvre le jeu.

/* ---------- Réglages ---------- */
insert into public.hg_settings(key, value) values ('loup_garou', jsonb_build_object(
  'paillettes', jsonb_build_object('participation', 10, 'victoire', 30, 'survie', 10, 'mvp', 20, 'loup_decouvert', 5),
  'plafond_jour', 200,
  'min_joueurs_paillettes', 6,
  'testeurs', '[]'::jsonb
)) on conflict (key) do nothing;

/* ---------- Page (réservée aux admins au lancement) ---------- */
insert into public.hg_pages(slug, label, mode, in_nav, sort)
values ('loup-garou', 'Loup-Garou', 'admin', false, 14)
on conflict (slug) do nothing;

/* ---------- Catalogue des rôles (logique serveur ; textes et icônes dans assets/js/loup-garou/roles.js) ---------- */
create table if not exists public.hg_lg_roles (
  id text primary key,
  nom text not null,
  camp text not null check (camp in ('village', 'loups', 'solo')),
  extension text not null,
  actif boolean not null default false,      -- géré par le moteur
  mj_seul boolean not null default false,    -- jouable seulement avec un meneur humain
  sort int not null default 0
);
alter table public.hg_lg_roles enable row level security;

/* ---------- Parties ---------- */
create table if not exists public.hg_lg_parties (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^HGLG-[0-9]{4}$'),
  nom text not null check (char_length(nom) between 1 and 60),
  hote uuid not null,
  mode text not null default 'auto' check (mode in ('auto', 'mj')),
  visibilite text not null default 'privee' check (visibilite in ('privee', 'publique')),
  nb_joueurs int not null check (nb_joueurs between 4 and 50),
  invites boolean not null default true,
  t_nuit int not null default 90 check (t_nuit between 20 and 600),
  t_jour int not null default 180 check (t_jour between 20 and 900),
  t_vote int not null default 60 check (t_vote between 15 and 600),
  annonce_discord boolean not null default false,
  discord_annonce_at timestamptz,  -- réservation de l'annonce par le bot (une seule par partie)
  composition jsonb not null default '{}'::jsonb,       -- {"loup-garou": 3, ...}
  statut text not null default 'attente' check (statut in ('attente', 'revelation', 'en_cours', 'terminee', 'annulee')),
  phase text,                                           -- revelation, nuit_1, nuit, reveil, debat, vote, chasseur, succession, fin
  manche int not null default 0,                        -- numéro de nuit / jour
  phase_fin timestamptz,
  pause_reste int,                                      -- secondes restantes pendant une pause du meneur
  etat jsonb not null default '{}'::jsonb,              -- file des réactions, cible du corbeau, pouvoirs perdus...
  vainqueur text,
  version int not null default 0,                       -- incrémenté à chaque changement : les clients relisent l'état
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);
create index if not exists hg_lg_parties_statut on public.hg_lg_parties(statut, visibilite);
create index if not exists hg_lg_parties_code on public.hg_lg_parties(code, created_at desc);
-- Un code n'est réservé que pendant la partie : il peut resservir une fois la partie finie.
create unique index if not exists hg_lg_parties_code_actif on public.hg_lg_parties(code) where statut in ('attente', 'revelation', 'en_cours');
alter table public.hg_lg_parties enable row level security;

/* ---------- Joueurs (informations publiques de la partie) ---------- */
create table if not exists public.hg_lg_joueurs (
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  user_id uuid not null,
  pseudo text not null,
  couleur text,
  avatar_url text,
  invite boolean not null default false,
  place int,
  pret boolean not null default false,
  vu_role boolean not null default false,
  vivant boolean not null default true,
  role_revele text,
  mort_manche int,
  mort_cause text,
  capitaine boolean not null default false,
  peut_voter boolean not null default true,
  gagne boolean,                                        -- rempli en fin de partie
  paillettes int not null default 0,                    -- Paillettes gagnées dans cette partie
  rejoint_at timestamptz not null default now(),
  primary key (partie, user_id)
);
create index if not exists hg_lg_joueurs_user on public.hg_lg_joueurs(user_id);
alter table public.hg_lg_joueurs enable row level security;

/* ---------- Cartes (rôles secrets) : jamais lisibles par le client ---------- */
create table if not exists public.hg_lg_cartes (
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  user_id uuid not null,
  role text not null references public.hg_lg_roles(id),
  role_initial text not null,
  camp text not null,
  etat jsonb not null default '{}'::jsonb,
  primary key (partie, user_id)
);
alter table public.hg_lg_cartes enable row level security;

create table if not exists public.hg_lg_centre (
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  idx int not null,
  role text not null references public.hg_lg_roles(id),
  primary key (partie, idx)
);
alter table public.hg_lg_centre enable row level security;

/* ---------- Actions de nuit et votes ---------- */
create table if not exists public.hg_lg_actions (
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  manche int not null,
  etape text not null,
  user_id uuid not null,
  type text not null,
  cible uuid,
  cible2 uuid,
  choix text,
  created_at timestamptz not null default now(),
  primary key (partie, manche, etape, user_id, type)
);
alter table public.hg_lg_actions enable row level security;

create table if not exists public.hg_lg_votes (
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  manche int not null,
  user_id uuid not null,
  cible uuid not null,
  created_at timestamptz not null default now(),
  primary key (partie, manche, user_id)
);
alter table public.hg_lg_votes enable row level security;

/* ---------- Chat et journal ---------- */
create table if not exists public.hg_lg_messages (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  canal text not null check (canal in ('salon', 'general', 'loups', 'morts', 'famille', 'meneur')),
  user_id uuid not null,
  texte text not null check (char_length(texte) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists hg_lg_messages_partie on public.hg_lg_messages(partie, canal, id);
alter table public.hg_lg_messages enable row level security;

create table if not exists public.hg_lg_journal (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  manche int not null default 0,
  phase text,
  type text not null default 'info',          -- info, mort, vote, nuit, prive, fin
  texte text not null,
  pour uuid,                                  -- null : public ; sinon visible seulement par ce joueur (et le meneur)
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hg_lg_journal_partie on public.hg_lg_journal(partie, id);
alter table public.hg_lg_journal enable row level security;

/* ---------- Accès ---------- */
-- Le compte connecté peut-il jouer ? Page « loup-garou » accessible, ou compte testeur.
create or replace function public.hg_lg_peut()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), 'loup-garou')
    or exists (select 1 from hg_settings s where s.key = 'loup_garou'
               and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text))
$$;
revoke all on function public.hg_lg_peut() from public, anon;
grant execute on function public.hg_lg_peut() to authenticated;

-- Le compte connecté participe-t-il à cette partie (joueur ou meneur) ?
create or replace function public.hg_lg_dans(p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_lg_joueurs where partie = p_partie and user_id = auth.uid())
      or exists (select 1 from hg_lg_parties where id = p_partie and mode = 'mj' and hote = auth.uid())
$$;
revoke all on function public.hg_lg_dans(uuid) from public, anon;
grant execute on function public.hg_lg_dans(uuid) to authenticated;

-- Peut-il lire ce canal de chat ?
create or replace function public.hg_lg_lit_canal(p_partie uuid, p_canal text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare j hg_lg_joueurs; c hg_lg_cartes; p hg_lg_parties;
begin
  if not public.hg_lg_peut() then return false; end if;
  select * into p from hg_lg_parties where id = p_partie;
  if not found then return false; end if;
  if p.mode = 'mj' and p.hote = auth.uid() then return true; end if;   -- le meneur lit tout
  select * into j from hg_lg_joueurs where partie = p_partie and user_id = auth.uid();
  if not found then return false; end if;
  if p.statut = 'terminee' then return true; end if;                     -- partie finie : tout est public
  select * into c from hg_lg_cartes where partie = p_partie and user_id = auth.uid();
  return case p_canal
    when 'salon' then true
    when 'general' then true
    when 'meneur' then true
    when 'morts' then not j.vivant
    when 'loups' then (j.vivant and c.camp = 'loups') or (j.vivant and c.role = 'petite-fille') or not j.vivant
    when 'famille' then j.vivant and c.role in ('deux-soeurs', 'trois-freres')
    else false end;
end $$;
revoke all on function public.hg_lg_lit_canal(uuid, text) from public, anon;
grant execute on function public.hg_lg_lit_canal(uuid, text) to authenticated;

/* ---------- Règles de lecture (temps réel) : aucune écriture directe ---------- */
drop policy if exists hg_lg_roles_read on public.hg_lg_roles;
create policy hg_lg_roles_read on public.hg_lg_roles for select to authenticated using (public.hg_lg_peut());

drop policy if exists hg_lg_parties_read on public.hg_lg_parties;
create policy hg_lg_parties_read on public.hg_lg_parties for select to authenticated
  using (public.hg_lg_peut() and (public.hg_lg_dans(id) or (visibilite = 'publique' and statut = 'attente')));

drop policy if exists hg_lg_joueurs_read on public.hg_lg_joueurs;
create policy hg_lg_joueurs_read on public.hg_lg_joueurs for select to authenticated
  using (public.hg_lg_peut() and public.hg_lg_dans(partie));

drop policy if exists hg_lg_messages_read on public.hg_lg_messages;
create policy hg_lg_messages_read on public.hg_lg_messages for select to authenticated
  using (public.hg_lg_lit_canal(partie, canal));

-- hg_lg_cartes, hg_lg_centre, hg_lg_actions, hg_lg_votes, hg_lg_journal : aucune règle = aucune lecture directe.
-- Leur contenu autorisé est servi par hg_lg_etat().

revoke insert, update, delete, truncate, references, trigger on
  public.hg_lg_roles, public.hg_lg_parties, public.hg_lg_joueurs, public.hg_lg_cartes, public.hg_lg_centre,
  public.hg_lg_actions, public.hg_lg_votes, public.hg_lg_messages, public.hg_lg_journal
  from anon, authenticated;
revoke select on public.hg_lg_cartes, public.hg_lg_centre, public.hg_lg_actions, public.hg_lg_votes, public.hg_lg_journal
  from anon, authenticated;
revoke all on public.hg_lg_roles, public.hg_lg_parties, public.hg_lg_joueurs, public.hg_lg_messages from anon;

/* ---------- Temps réel ---------- */
do $$
declare t text;
begin
  foreach t in array array['hg_lg_parties', 'hg_lg_joueurs', 'hg_lg_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* ---------- Rôles ---------- */
insert into public.hg_lg_roles(id, nom, camp, extension, actif, mj_seul, sort) values
('villageois', 'Villageois', 'village', 'jeu-de-base', true, false, 1),
('chasseur', 'Chasseur', 'village', 'jeu-de-base', true, false, 2),
('cupidon', 'Cupidon', 'village', 'jeu-de-base', true, false, 3),
('petite-fille', 'Petite fille', 'village', 'jeu-de-base', true, false, 4),
('sorciere', 'Sorcière', 'village', 'jeu-de-base', true, false, 5),
('voleur', 'Voleur', 'village', 'jeu-de-base', true, false, 6),
('voyante', 'Voyante', 'village', 'jeu-de-base', true, false, 7),
('loup-garou', 'Loup-garou', 'loups', 'jeu-de-base', true, false, 8),
('capitaine', 'Capitaine', 'village', 'jeu-de-base', true, false, 9),
('ancien', 'Ancien', 'village', 'nouvelle-lune', true, false, 10),
('bouc-emissaire', 'Bouc émissaire', 'village', 'nouvelle-lune', true, false, 11),
('idiot-du-village', 'Idiot du village', 'village', 'nouvelle-lune', true, false, 12),
('joueur-de-flute', 'Joueur de flûte', 'solo', 'nouvelle-lune', true, false, 13),
('salvateur', 'Salvateur', 'village', 'nouvelle-lune', true, false, 14),
('corbeau', 'Corbeau', 'village', 'le-village', true, false, 15),
('pyromane', 'Pyromane', 'village', 'le-village', false, false, 16),
('loup-blanc', 'Loup blanc', 'loups', 'le-village', true, false, 17),
('abominable-sectaire', 'Abominable sectaire', 'solo', 'personnages', false, false, 18),
('ange', 'Ange', 'solo', 'personnages', true, false, 19),
('chevalier-epee-rouillee', 'Chevalier à l''épée rouillée', 'village', 'personnages', true, false, 20),
('chien-loup', 'Chien-loup', 'village', 'personnages', true, false, 21),
('comedien', 'Comédien', 'solo', 'personnages', true, true, 22),
('deux-soeurs', 'Deux sœurs', 'village', 'personnages', true, false, 23),
('enfant-sauvage', 'Enfant sauvage', 'village', 'personnages', true, false, 24),
('grand-mechant-loup', 'Grand méchant loup', 'loups', 'personnages', true, false, 25),
('gitane', 'Gitane', 'village', 'personnages', true, true, 26),
('infect-pere-des-loups', 'Infect père des loups', 'loups', 'personnages', true, false, 27),
('juge-begue', 'Juge bègue', 'village', 'personnages', true, true, 28),
('montreur-ours', 'Montreur d''ours', 'village', 'personnages', true, false, 29),
('renard', 'Renard', 'village', 'personnages', true, false, 30),
('servante-devouee', 'Servante dévouée', 'village', 'personnages', false, false, 31),
('trois-freres', 'Trois frères', 'village', 'personnages', true, false, 32),
('villageois-villageois', 'Villageois-villageois', 'village', 'personnages', true, false, 33),
('necromancien', 'Nécromancien', 'village', 'foret-infinie', false, false, 34),
('marionnettiste', 'Marionnettiste', 'solo', 'foret-infinie', false, false, 35),
('lapin-blanc', 'Lapin blanc', 'village', 'foret-infinie', false, false, 36),
('ankou', 'Ankou', 'solo', 'foret-infinie', false, false, 37),
('noctambule', 'Noctambule', 'village', 'foret-infinie', false, false, 38),
('loup-garou-voyant', 'Loup-garou voyant', 'loups', 'foret-infinie', true, false, 39)
on conflict (id) do update set nom = excluded.nom, camp = excluded.camp, extension = excluded.extension,
  actif = excluded.actif, mj_seul = excluded.mj_seul, sort = excluded.sort;
