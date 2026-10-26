-- ===== Humane Gang — migration 122 : Duels (Puissance 4, Morpion, Mastermind, Bataille navale, Qui est-ce ?) =====
-- Jeux à deux, tout côté serveur : grille, règles, tour, robot, manches, récompenses.
-- Le client envoie des intentions (hg_duel_jouer, hg_duel_essayer…) et relit son état (hg_duel_etat).
-- Mastermind : les codes secrets ne sont jamais lisibles directement ; chacun ne voit que ses essais et les indices de l'autre.
-- Jeux : 'p4' (Puissance 4 : classique 7×6, grande 9×7, Pop Out), 'morpion' (classique 3×3, ultime 9×9, gomoku 15×15),
--   'mastermind' (duel : chacun perce le code de l'autre ; code du jour : défi solo quotidien avec classement),
--   'bataille' (Bataille navale : classique ou salve ; flottes cachées, radar), 'quiestce' (Qui est-ce ? : plateau « quartier », 24 personnages).
-- Adversaire : un membre défié, un code à partager (membre ou invité), ou le robot (facile, moyen, difficile ; sans Paillettes).
-- Fonctions publiques (authenticated) : hg_duel_creer, hg_duel_rejoindre, hg_duel_refuser, hg_duel_quitter, hg_duel_jouer,
--   hg_duel_code_secret, hg_duel_essayer, hg_duel_avancer, hg_duel_message, hg_duel_messages, hg_duel_rejouer, hg_duel_etat,
--   hg_duel_accueil, hg_duel_membres, hg_duel_stats, hg_duel_jour, hg_duel_jour_essayer,
--   hg_duel_admin_reglages, hg_duel_admin_enregistrer, hg_duel_admin_arreter.
-- Invités (anon) : hg_duel_invite(action, code, jeton, args). Fonctions internes : hg_duel__* (non exécutables par les clients).
-- Notifications : nouvelle catégorie « jeux » (hg_set_notif_prefs), MP du bot au membre défié (hg-notify, duel_defi).
-- Accès : page « duels » (mode admin au lancement), testeurs listés dans hg_settings.duels.testeurs, invités d'une partie.

/* =====================================================================
   1. Réglages, page, badges
   ===================================================================== */

insert into public.hg_settings(key, value) values ('duels', jsonb_build_object(
  'paillettes', jsonb_build_object(
    'p4', jsonb_build_object('partie', 20, 'victoire', 60),
    'morpion_classique', jsonb_build_object('partie', 10, 'victoire', 30),
    'morpion', jsonb_build_object('partie', 20, 'victoire', 60),
    'mastermind', jsonb_build_object('partie', 20, 'victoire', 60),
    'bataille', jsonb_build_object('partie', 20, 'victoire', 60),
    'quiestce', jsonb_build_object('partie', 20, 'victoire', 60),
    'code_du_jour', 30),
  'plafond_jour', 500,
  'max_meme_adversaire', 3,
  'badges_inactifs', '[]'::jsonb,
  'testeurs', '[]'::jsonb
)) on conflict (key) do nothing;

insert into public.hg_pages(slug, label, mode, in_nav, sort)
values ('duels', 'Duels', 'admin', false, 16)
on conflict (slug) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('duel_p4_premiere', 'Premier alignement', 'Gagner un duel de Puissance 4.', 960),
  ('duel_p4_diagonale', 'Diagonale du fou', 'Gagner une manche de Puissance 4 avec une diagonale.', 961),
  ('duel_p4_eclair', 'Coup de foudre', 'Gagner une manche de Puissance 4 en moins de 10 jetons.', 962),
  ('duel_p4_dix', 'Maître des jetons', 'Gagner 10 duels de Puissance 4.', 963),
  ('duel_morpion_premiere', 'Premier trait', 'Gagner un duel de Morpion.', 964),
  ('duel_morpion_ultime', 'Stratège ultime', 'Gagner 10 duels de Morpion Ultime.', 965),
  ('duel_morpion_mur', 'Mur de briques', 'Faire 10 manches nulles au Morpion.', 966),
  ('duel_mm_premiere', 'Casseur de code', 'Gagner un duel de Mastermind.', 967),
  ('duel_mm_eclair', 'Intuition', 'Percer un code de Mastermind en 4 essais ou moins.', 968),
  ('duel_mm_jour', 'Fidèle au poste', 'Trouver le code du jour 7 jours de suite.', 969),
  ('duel_bn_premiere', 'Amiral', 'Gagner un duel de Bataille navale.', 972),
  ('duel_bn_sniper', 'Sniper', 'Gagner une manche de Bataille navale avec plus de 60 % de tirs réussis.', 973),
  ('duel_bn_fantome', 'Vaisseau fantôme', 'Gagner une manche de Bataille navale sans perdre un seul navire.', 974),
  ('duel_qec_premiere', 'Physionomiste', 'Gagner un duel de Qui est-ce ?.', 975),
  ('duel_qec_flair', 'Du flair', 'Trouver le personnage de l''autre en 3 questions ou moins.', 976),
  ('duel_robot', 'Plus fort que la machine', 'Battre le robot en mode Difficile.', 970),
  ('duel_rival', 'Rivalité', 'Jouer 20 duels contre le même membre.', 971)
on conflict (code) do nothing;

/* =====================================================================
   2. Tables
   ===================================================================== */

create table if not exists public.hg_duel_parties (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^HG(P4|MO|MM|BN|QE)-[0-9]{4}$'),
  jeu text not null check (jeu in ('p4', 'morpion', 'mastermind', 'bataille', 'quiestce')),
  variante text not null,                                -- p4 : classique|grande|popout ; morpion : classique|ultime|gomoku ; mastermind : duel ;
                                                         -- bataille : classique|salve ; quiestce : plateau (quartier)
  hote uuid not null,
  defie uuid,                                            -- membre défié (null : code à partager ou robot)
  defi_expire timestamptz,
  defi_notifie_at timestamptz,                           -- MP du bot envoyé au membre défié (hg-notify, duel_defi)
  robot int not null default 0 check (robot between 0 and 3), -- 0 : humain ; 1 facile, 2 moyen, 3 difficile
  visibilite text not null default 'privee' check (visibilite in ('privee', 'publique')), -- publique : spectateurs admis
  invites boolean not null default false,
  commence text not null default 'hasard' check (commence in ('moi', 'lui', 'hasard')),
  format int not null default 1 check (format in (1, 3, 5)),
  t_coup int not null default 30 check (t_coup in (15, 30, 60, 90, 120)),
  options jsonb not null default '{}'::jsonb,            -- mastermind {codes: 'choisis'|'hasard'} ; bataille {contact, rejouer} ; quiestce {libres}
  statut text not null default 'attente' check (statut in ('attente', 'en_cours', 'terminee', 'annulee')),
  manche int not null default 0,
  phase text not null default 'jeu' check (phase in ('codes', 'placement', 'jeu')),
  restant int,                                           -- bataille navale (salve) : tirs restants dans le tour
  grille text not null default '',
  petites text,                                          -- morpion ultime : état des 9 petites grilles ('.', '1', '2', '=')
  cible int,                                             -- morpion ultime : petite grille imposée (null : libre)
  tour uuid,
  tour_fin timestamptz,
  premier uuid,                                          -- qui a commencé la manche en cours
  nb_coups int not null default 0,
  dernier jsonb,                                         -- dernier coup : {user_id, case, col, action}
  vainqueur uuid,
  etat jsonb not null default '{}'::jsonb,               -- historique des manches, suite (revanche), forfait
  version int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  activite_at timestamptz not null default now()
);
create index if not exists hg_duel_parties_statut on public.hg_duel_parties(statut, jeu);
create index if not exists hg_duel_parties_defie on public.hg_duel_parties(defie) where statut = 'attente';
create unique index if not exists hg_duel_parties_code_actif on public.hg_duel_parties(code) where statut in ('attente', 'en_cours');
alter table public.hg_duel_parties enable row level security;

create table if not exists public.hg_duel_joueurs (
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  user_id uuid not null,
  pseudo text not null,
  couleur text,
  avatar_url text,
  invite boolean not null default false,
  robot boolean not null default false,
  place int not null check (place in (1, 2)),
  manches int not null default 0,          -- manches gagnées
  nuls int not null default 0,
  manques int not null default 0,          -- coups joués par le robot d'affilée pour ce joueur
  coups int not null default 0,            -- coups joués dans la manche en cours
  fin timestamptz,                         -- mastermind : échéance personnelle (chacun joue à son rythme)
  essais int not null default 0,           -- mastermind : essais de la manche en cours
  trouve_en int,                           -- mastermind : nombre d'essais pour percer le code (null : pas encore)
  trouve_at timestamptz,
  pret boolean not null default false,     -- bataille navale : flotte placée
  radar boolean not null default false,    -- bataille navale : radar utilisé dans la manche
  baisses int[] not null default '{}',     -- qui est-ce : personnages baissés (aide-mémoire du joueur)
  rang int,
  gagne boolean,
  paillettes int not null default 0,
  rejoint_at timestamptz not null default now(),
  primary key (partie, user_id)
);
create index if not exists hg_duel_joueurs_user on public.hg_duel_joueurs(user_id);
alter table public.hg_duel_joueurs enable row level security;

-- Manches terminées (pour les statistiques et les badges).
create table if not exists public.hg_duel_manches (
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  gagnant uuid,                            -- null : nulle
  coups int not null default 0,            -- coups (ou essais) du gagnant
  diagonale boolean not null default false,
  grille text,
  ligne int[],
  created_at timestamptz not null default now(),
  primary key (partie, manche)
);
alter table public.hg_duel_manches enable row level security;

create table if not exists public.hg_duel_coups (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null default 0,
  user_id uuid,
  type text not null,
  texte text not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_duel_coups_partie on public.hg_duel_coups(partie, id);
alter table public.hg_duel_coups enable row level security;

-- Mastermind : code à percer par « pour » (choisi par l'adversaire, ou tiré au hasard). Jamais lisible directement.
create table if not exists public.hg_duel_codes (
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  pour uuid not null,
  secret text not null check (secret ~ '^[roygbp]{4}$'),
  primary key (partie, manche, pour)
);
alter table public.hg_duel_codes enable row level security;

create table if not exists public.hg_duel_essais (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  user_id uuid not null,
  n int not null,
  essai text not null check (essai ~ '^[roygbp]{4}$'),
  bien int not null,
  mal int not null,
  auto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists hg_duel_essais_partie on public.hg_duel_essais(partie, manche, user_id, n);
alter table public.hg_duel_essais enable row level security;

create table if not exists public.hg_duel_messages (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  user_id uuid not null,
  texte text not null check (char_length(texte) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists hg_duel_messages_partie on public.hg_duel_messages(partie, id);
alter table public.hg_duel_messages enable row level security;

create table if not exists public.hg_duel_invites (
  user_id uuid primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  pseudo text not null,
  jeton_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.hg_duel_invites enable row level security;

-- Code du jour (Mastermind solo) : un code par jour (heure suisse), dix essais chacun.
create table if not exists public.hg_duel_jour (
  jour date primary key,
  secret text not null check (secret ~ '^[roygbp]{4}$')
);
alter table public.hg_duel_jour enable row level security;
create table if not exists public.hg_duel_jour_essais (
  jour date not null,
  user_id uuid not null,
  n int not null check (n between 1 and 10),
  essai text not null check (essai ~ '^[roygbp]{4}$'),
  bien int not null,
  mal int not null,
  created_at timestamptz not null default now(),
  primary key (jour, user_id, n)
);
alter table public.hg_duel_jour_essais enable row level security;

-- Bataille navale : flottes (jamais lisibles directement) et tirs.
create table if not exists public.hg_duel_navires (
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  user_id uuid not null,
  type text not null check (type in ('porte_avions', 'cuirasse', 'croiseur', 'sous_marin', 'torpilleur')),
  cases int[] not null,
  coule boolean not null default false,
  primary key (partie, manche, user_id, type)
);
alter table public.hg_duel_navires enable row level security;
create table if not exists public.hg_duel_tirs (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  tireur uuid not null,
  case_n int not null check (case_n between 0 and 99),
  resultat text not null check (resultat in ('eau', 'touche', 'coule', 'radar')),
  navire text,
  valeur int,
  created_at timestamptz not null default now()
);
create index if not exists hg_duel_tirs_partie on public.hg_duel_tirs(partie, manche, tireur);
alter table public.hg_duel_tirs enable row level security;

-- Qui est-ce ? : personnages des plateaux (publics), personnage secret de chacun (caché), questions posées.
create table if not exists public.hg_duel_qec_persos (
  plateau text not null,
  id int not null,
  prenom text not null,
  attributs jsonb not null,              -- {cheveux, longs, lunettes, chapeau, barbe, boucles, yeux, peau (1-5), haut (couleur)}
  primary key (plateau, id)
);
alter table public.hg_duel_qec_persos enable row level security;
create table if not exists public.hg_duel_qec_secrets (
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  user_id uuid not null,
  perso int not null,
  primary key (partie, manche, user_id)
);
alter table public.hg_duel_qec_secrets enable row level security;
create table if not exists public.hg_duel_qec_questions (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_duel_parties(id) on delete cascade,
  manche int not null,
  auteur uuid not null,
  type text not null check (type in ('attribut', 'libre')),
  cle text,
  valeur text,
  texte text not null,
  reponse boolean,
  repondu boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists hg_duel_qec_questions_partie on public.hg_duel_qec_questions(partie, manche);
alter table public.hg_duel_qec_questions enable row level security;

-- Plateau « Les habitants du quartier » : 24 personnages originaux.
insert into public.hg_duel_qec_persos(plateau, id, prenom, attributs) values
  ('quartier', 0, 'Abel', '{"cheveux":"bruns","longs":false,"lunettes":false,"chapeau":"aucun","barbe":true,"boucles":false,"yeux":"marron","peau":3,"haut":"#4E73C4"}'),
  ('quartier', 1, 'Bianca', '{"cheveux":"blonds","longs":true,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"bleus","peau":1,"haut":"#8466B8"}'),
  ('quartier', 2, 'Cyril', '{"cheveux":"gris","longs":false,"lunettes":true,"chapeau":"aucun","barbe":true,"boucles":false,"yeux":"bleus","peau":2,"haut":"#4F9A6A"}'),
  ('quartier', 3, 'Dalia', '{"cheveux":"noirs","longs":true,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"marron","peau":4,"haut":"#C4574B"}'),
  ('quartier', 4, 'Elio', '{"cheveux":"bruns","longs":false,"lunettes":false,"chapeau":"casquette","barbe":false,"boucles":false,"yeux":"verts","peau":2,"haut":"#D4B54A"}'),
  ('quartier', 5, 'Fanny', '{"cheveux":"roux","longs":true,"lunettes":true,"chapeau":"aucun","barbe":false,"boucles":false,"yeux":"verts","peau":1,"haut":"#4E73C4"}'),
  ('quartier', 6, 'Gaspard', '{"cheveux":"aucun","longs":false,"lunettes":true,"chapeau":"aucun","barbe":true,"boucles":false,"yeux":"marron","peau":3,"haut":"#5A6475"}'),
  ('quartier', 7, 'Hana', '{"cheveux":"noirs","longs":true,"lunettes":false,"chapeau":"bonnet","barbe":false,"boucles":false,"yeux":"marron","peau":2,"haut":"#D08A3E"}'),
  ('quartier', 8, 'Igor', '{"cheveux":"blonds","longs":false,"lunettes":false,"chapeau":"chapeau","barbe":true,"boucles":false,"yeux":"bleus","peau":1,"haut":"#8F4A3A"}'),
  ('quartier', 9, 'Jade', '{"cheveux":"bruns","longs":true,"lunettes":true,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"verts","peau":3,"haut":"#4F9A6A"}'),
  ('quartier', 10, 'Kenji', '{"cheveux":"noirs","longs":false,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":false,"yeux":"marron","peau":2,"haut":"#C4574B"}'),
  ('quartier', 11, 'Léa', '{"cheveux":"blonds","longs":false,"lunettes":false,"chapeau":"chapeau","barbe":false,"boucles":true,"yeux":"bleus","peau":1,"haut":"#4E73C4"}'),
  ('quartier', 12, 'Malo', '{"cheveux":"roux","longs":false,"lunettes":false,"chapeau":"aucun","barbe":true,"boucles":false,"yeux":"verts","peau":1,"haut":"#5A6475"}'),
  ('quartier', 13, 'Nadia', '{"cheveux":"noirs","longs":true,"lunettes":true,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"marron","peau":5,"haut":"#D4B54A"}'),
  ('quartier', 14, 'Oscar', '{"cheveux":"gris","longs":false,"lunettes":false,"chapeau":"casquette","barbe":false,"boucles":false,"yeux":"marron","peau":4,"haut":"#4F9A6A"}'),
  ('quartier', 15, 'Paula', '{"cheveux":"bruns","longs":true,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":false,"yeux":"bleus","peau":2,"haut":"#C4574B"}'),
  ('quartier', 16, 'Quentin', '{"cheveux":"aucun","longs":false,"lunettes":false,"chapeau":"aucun","barbe":true,"boucles":false,"yeux":"bleus","peau":5,"haut":"#4E73C4"}'),
  ('quartier', 17, 'Rosa', '{"cheveux":"roux","longs":true,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"marron","peau":3,"haut":"#C4574B"}'),
  ('quartier', 18, 'Samy', '{"cheveux":"noirs","longs":false,"lunettes":true,"chapeau":"casquette","barbe":false,"boucles":false,"yeux":"marron","peau":4,"haut":"#5A6475"}'),
  ('quartier', 19, 'Thea', '{"cheveux":"gris","longs":true,"lunettes":true,"chapeau":"aucun","barbe":false,"boucles":true,"yeux":"verts","peau":1,"haut":"#8466B8"}'),
  ('quartier', 20, 'Ugo', '{"cheveux":"roux","longs":false,"lunettes":false,"chapeau":"bonnet","barbe":true,"boucles":false,"yeux":"verts","peau":2,"haut":"#D08A3E"}'),
  ('quartier', 21, 'Vera', '{"cheveux":"bruns","longs":false,"lunettes":false,"chapeau":"bonnet","barbe":false,"boucles":true,"yeux":"marron","peau":4,"haut":"#8F4A3A"}'),
  ('quartier', 22, 'Willy', '{"cheveux":"blonds","longs":false,"lunettes":true,"chapeau":"aucun","barbe":false,"boucles":false,"yeux":"bleus","peau":2,"haut":"#4F9A6A"}'),
  ('quartier', 23, 'Zoé', '{"cheveux":"noirs","longs":true,"lunettes":false,"chapeau":"aucun","barbe":false,"boucles":false,"yeux":"marron","peau":5,"haut":"#8466B8"}')
on conflict (plateau, id) do update set prenom = excluded.prenom, attributs = excluded.attributs;

/* =====================================================================
   3. Accès et lecture (temps réel)
   ===================================================================== */

create or replace function public.hg_duel_peut()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), 'duels')
    or exists (select 1 from hg_settings s where s.key = 'duels' and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text)
    or exists (select 1 from hg_duel_invites i where i.user_id = auth.uid()))
$$;

create or replace function public.hg_duel_dans(p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_duel_joueurs where partie = p_partie and user_id = auth.uid())
$$;

drop policy if exists hg_duel_parties_read on public.hg_duel_parties;
create policy hg_duel_parties_read on public.hg_duel_parties for select to authenticated
  using (public.hg_duel_peut() and (public.hg_duel_dans(id) or defie = auth.uid() or visibilite = 'publique'));
drop policy if exists hg_duel_messages_read on public.hg_duel_messages;
create policy hg_duel_messages_read on public.hg_duel_messages for select to authenticated
  using (public.hg_duel_peut() and public.hg_duel_dans(partie));

revoke all on public.hg_duel_parties, public.hg_duel_joueurs, public.hg_duel_manches, public.hg_duel_coups, public.hg_duel_codes,
  public.hg_duel_essais, public.hg_duel_messages, public.hg_duel_invites, public.hg_duel_jour, public.hg_duel_jour_essais,
  public.hg_duel_navires, public.hg_duel_tirs, public.hg_duel_qec_persos, public.hg_duel_qec_secrets, public.hg_duel_qec_questions
  from anon, authenticated;
grant select on public.hg_duel_parties, public.hg_duel_messages to authenticated;

do $$
declare t text;
begin
  foreach t in array array['hg_duel_parties', 'hg_duel_messages'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* =====================================================================
   4. Outils internes
   ===================================================================== */

-- Identifiant du robot (pas de profil : jamais de Paillettes ni de badges).
create or replace function public.hg_duel__robot_id()
returns uuid language sql immutable as $$ select '00000000-0000-0000-0000-00000000b007'::uuid $$;

create or replace function public.hg_duel__partie(p_code text, p_lock boolean default false)
returns public.hg_duel_parties language plpgsql security definer set search_path = public as $$
declare v hg_duel_parties;
begin
  select * into v from hg_duel_parties where code = upper(trim(coalesce(p_code, '')))
    order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if found and p_lock then select * into v from hg_duel_parties where id = v.id for update; end if;
  if not found then raise exception 'Partie introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hg_duel__bump(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_duel_parties set version = version + 1, activite_at = now() where id = p_id
$$;

create or replace function public.hg_duel__nom(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from hg_duel_joueurs where partie = p_id and user_id = p_user), '?')
$$;

create or replace function public.hg_duel__log(p_id uuid, p_user uuid, p_type text, p_texte text)
returns void language sql security definer set search_path = public as $$
  insert into hg_duel_coups(partie, manche, user_id, type, texte)
  select p_id, manche, p_user, p_type, p_texte from hg_duel_parties where id = p_id
$$;

create or replace function public.hg_duel__jeu_nom(p_jeu text, p_variante text)
returns text language sql immutable as $$
  select case p_jeu when 'p4' then 'Puissance 4' when 'mastermind' then 'Mastermind' when 'bataille' then 'Bataille navale' when 'quiestce' then 'Qui est-ce ?'
    else case p_variante when 'ultime' then 'Morpion Ultime' when 'gomoku' then 'Gomoku' else 'Morpion' end end
$$;

create or replace function public.hg_duel__code(p_jeu text)
returns text language plpgsql security definer set search_path = public as $$
declare v text; i int := 0; pre text := case p_jeu when 'p4' then 'HGP4-' when 'morpion' then 'HGMO-' when 'bataille' then 'HGBN-' when 'quiestce' then 'HGQE-' else 'HGMM-' end;
begin
  loop
    v := pre || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from hg_duel_parties where code = v and statut in ('attente', 'en_cours'));
    i := i + 1;
    if i > 50 then raise exception 'Impossible de générer un code, réessaie.'; end if;
  end loop;
  return v;
end $$;

-- Dimensions d'une grille : largeur, hauteur, alignement gagnant, alignement exact (gomoku : 5 exactement).
create or replace function public.hg_duel__dims(p_jeu text, p_variante text, out w int, out h int, out n int, out exact boolean)
language sql immutable as $$
  select case when p_jeu = 'p4' then case when p_variante = 'grande' then 9 else 7 end when p_jeu = 'bataille' then 10
              when p_variante = 'gomoku' then 15 when p_variante = 'ultime' then 9 else 3 end,
         case when p_jeu = 'p4' then case when p_variante = 'grande' then 7 else 6 end when p_jeu = 'bataille' then 10
              when p_variante = 'gomoku' then 15 when p_variante = 'ultime' then 9 else 3 end,
         case when p_jeu = 'p4' then 4 when p_variante = 'gomoku' then 5 else 3 end,
         p_variante = 'gomoku'
$$;

-- Case (0-based) de la grille.
create or replace function public.hg_duel__at(g text, i int)
returns text language sql immutable as $$ select substr(g, i + 1, 1) $$;
create or replace function public.hg_duel__set(g text, i int, c text)
returns text language sql immutable as $$ select overlay(g placing c from i + 1 for 1) $$;

-- Cherche un alignement de n pions identiques ('1' ou '2', ou p_qui seul). Renvoie les cases, la direction et le pion.
-- exact : un alignement de plus de n pions ne compte pas (gomoku).
create or replace function public.hg_duel__aligne(g text, w int, h int, n int, exact boolean default false, p_qui text default null,
  out qui text, out cases int[], out diagonale boolean)
language plpgsql immutable as $$
declare x int; y int; d int; dx int; dy int; c text; k int; xx int; yy int; run int[];
begin
  for y in 0 .. h - 1 loop
    for x in 0 .. w - 1 loop
      c := substr(g, y * w + x + 1, 1);
      continue when c not in ('1', '2') or (p_qui is not null and c <> p_qui);
      for d in 1 .. 4 loop
        dx := (array[1, 0, 1, 1])[d]; dy := (array[0, 1, 1, -1])[d];
        -- Début de ligne seulement : la case précédente n'est pas du même pion.
        xx := x - dx; yy := y - dy;
        continue when xx between 0 and w - 1 and yy between 0 and h - 1 and substr(g, yy * w + xx + 1, 1) = c;
        run := array[y * w + x]; k := 1; xx := x + dx; yy := y + dy;
        while xx between 0 and w - 1 and yy between 0 and h - 1 and substr(g, yy * w + xx + 1, 1) = c loop
          run := run || (yy * w + xx); k := k + 1; xx := xx + dx; yy := yy + dy;
        end loop;
        if (exact and k = n) or (not exact and k >= n) then
          qui := c; cases := run[1:n]; diagonale := d >= 3; return;
        end if;
      end loop;
    end loop;
  end loop;
  qui := null; cases := null; diagonale := false;
end $$;

-- Morpion ultime : la petite grille k (0..8) extraite de la grande (81 cases, 9 par petite grille).
create or replace function public.hg_duel__petite(g text, k int)
returns text language sql immutable as $$ select substr(g, k * 9 + 1, 9) $$;

-- Mastermind : bien placés et mal placés.
create or replace function public.hg_duel__mm_score(p_secret text, p_essai text, out bien int, out mal int)
language plpgsql immutable as $$
declare i int; c text; total int := 0;
begin
  bien := 0;
  for i in 1 .. 4 loop if substr(p_secret, i, 1) = substr(p_essai, i, 1) then bien := bien + 1; end if; end loop;
  foreach c in array array['r', 'o', 'y', 'g', 'b', 'p'] loop
    total := total + least(length(p_secret) - length(replace(p_secret, c, '')), length(p_essai) - length(replace(p_essai, c, '')));
  end loop;
  mal := total - bien;
end $$;

create or replace function public.hg_duel__mm_hasard()
returns text language sql volatile as $$
  select string_agg(substr('roygbp', 1 + floor(random() * 6)::int, 1), '') from generate_series(1, 4)
$$;

create or replace function public.hg_duel__mm_nom(p_code text)
returns text language sql immutable as $$
  select string_agg(case c when 'r' then 'rouge' when 'o' then 'orange' when 'y' then 'jaune' when 'g' then 'vert'
    when 'b' then 'bleu' else 'violet' end, ', ' order by i)
  from unnest(string_to_array(p_code, null)) with ordinality t(c, i)
$$;

-- Tous les codes encore possibles après une liste d'essais [{essai, bien, mal}].
create or replace function public.hg_duel__mm_possibles(p_essais jsonb)
returns setof text language sql stable as $$
  with c as (select a || b || cc || d code
             from unnest(array['r','o','y','g','b','p']) a, unnest(array['r','o','y','g','b','p']) b,
                  unnest(array['r','o','y','g','b','p']) cc, unnest(array['r','o','y','g','b','p']) d)
  select code from c
  where not exists (select 1 from jsonb_array_elements(coalesce(p_essais, '[]'::jsonb)) e,
                    lateral hg_duel__mm_score(c.code, e->>'essai') s
                    where s.bien <> (e->>'bien')::int or s.mal <> (e->>'mal')::int)
$$;

-- L'adversaire d'un joueur dans un duel.
create or replace function public.hg_duel__autre(p_id uuid, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from hg_duel_joueurs where partie = p_id and user_id <> p_user limit 1
$$;

-- Pion d'un joueur ('1' ou '2' selon sa place).
create or replace function public.hg_duel__pion(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select place::text from hg_duel_joueurs where partie = p_id and user_id = p_user
$$;

create or replace function public.hg_duel__donner_tour(p_id uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update hg_duel_parties set tour = p_user, tour_fin = now() + make_interval(secs => t_coup) where id = p_id
$$;

/* =====================================================================
   5. Règles : coups, manches, fin de partie
   ===================================================================== */

-- Puissance 4 : grille après avoir lâché un pion dans la colonne (null si la colonne est pleine).
create or replace function public.hg_duel__p4_lacher(g text, w int, h int, col int, c text)
returns text language plpgsql immutable as $$
declare y int;
begin
  if col < 0 or col >= w then return null; end if;
  for y in reverse h - 1 .. 0 loop
    if substr(g, y * w + col + 1, 1) = '.' then return overlay(g placing c from y * w + col + 1 for 1); end if;
  end loop;
  return null;
end $$;

-- Puissance 4 (Pop Out) : retire le pion du bas de la colonne (il doit être à c) et fait descendre la colonne.
create or replace function public.hg_duel__p4_retirer(g text, w int, h int, col int, c text)
returns text language plpgsql immutable as $$
declare y int; r text := g;
begin
  if col < 0 or col >= w or substr(g, (h - 1) * w + col + 1, 1) <> c then return null; end if;
  for y in reverse h - 1 .. 1 loop
    r := overlay(r placing substr(g, (y - 1) * w + col + 1, 1) from y * w + col + 1 for 1);
  end loop;
  return overlay(r placing '.' from col + 1 for 1);
end $$;

-- Puissance 4 : valeur d'une position pour « me » (fenêtres de 4 ouvertes, colonne centrale).
create or replace function public.hg_duel__p4_eval(g text, w int, h int, me text, opp text)
returns int language plpgsql immutable as $$
declare x int; y int; d int; dx int; dy int; k int; nm int; no int; s int := 0; c text;
begin
  for y in 0 .. h - 1 loop
    for x in 0 .. w - 1 loop
      for d in 1 .. 4 loop
        dx := (array[1, 0, 1, 1])[d]; dy := (array[0, 1, 1, -1])[d];
        continue when x + 3 * dx not between 0 and w - 1 or y + 3 * dy not between 0 and h - 1;
        nm := 0; no := 0;
        for k in 0 .. 3 loop
          c := substr(g, (y + k * dy) * w + x + k * dx + 1, 1);
          if c = me then nm := nm + 1; elsif c = opp then no := no + 1; end if;
        end loop;
        if no = 0 then s := s + case nm when 3 then 6 when 2 then 2 else 0 end;
        elsif nm = 0 then s := s - case no when 3 then 7 when 2 then 1 else 0 end; end if;
      end loop;
    end loop;
  end loop;
  for y in 0 .. h - 1 loop
    if substr(g, y * w + (w / 2) + 1, 1) = me then s := s + 3; end if;
  end loop;
  return s;
end $$;

-- Robot du Puissance 4 : colonne choisie (niveau 1 facile, 2 moyen, 3 difficile).
create or replace function public.hg_duel__p4_robot(g text, w int, h int, me text, opp text, lvl int)
returns int language plpgsql volatile as $$
declare c int; g2 text; g3 text; c2 int; best int := null; best_s int := -100000; s int; libres int[] := '{}'; surs int[] := '{}'; perd boolean;
begin
  for c in 0 .. w - 1 loop if hg_duel__p4_lacher(g, w, h, c, me) is not null then libres := libres || c; end if; end loop;
  if lvl <= 1 and random() < 0.5 then return libres[1 + floor(random() * array_length(libres, 1))::int]; end if;
  -- Gagner tout de suite
  foreach c in array libres loop
    if (hg_duel__aligne(hg_duel__p4_lacher(g, w, h, c, me), w, h, 4, false, me)).qui is not null then return c; end if;
  end loop;
  -- Bloquer une victoire adverse
  foreach c in array libres loop
    g2 := hg_duel__p4_lacher(g, w, h, c, opp);
    if g2 is not null and (hg_duel__aligne(g2, w, h, 4, false, opp)).qui is not null then return c; end if;
  end loop;
  if lvl <= 1 then return libres[1 + floor(random() * array_length(libres, 1))::int]; end if;
  -- Coups qui ne donnent pas la victoire à l'adversaire au coup suivant
  foreach c in array libres loop
    g2 := hg_duel__p4_lacher(g, w, h, c, me); perd := false;
    for c2 in 0 .. w - 1 loop
      g3 := hg_duel__p4_lacher(g2, w, h, c2, opp);
      if g3 is not null and (hg_duel__aligne(g3, w, h, 4, false, opp)).qui is not null then perd := true; exit; end if;
    end loop;
    if not perd then surs := surs || c; end if;
  end loop;
  if array_length(surs, 1) is null then surs := libres; end if;
  foreach c in array surs loop
    g2 := hg_duel__p4_lacher(g, w, h, c, me);
    s := case when lvl >= 3 then hg_duel__p4_eval(g2, w, h, me, opp) else 0 end - abs(c - w / 2) * 2 + floor(random() * 3)::int;
    if s > best_s then best_s := s; best := c; end if;
  end loop;
  return best;
end $$;

-- Robot du Morpion classique (3×3) : case choisie.
create or replace function public.hg_duel__morpion_robot(g text, me text, opp text, lvl int)
returns int language plpgsql volatile as $$
declare i int; libres int[] := '{}'; ordre int[];
begin
  for i in 0 .. 8 loop if substr(g, i + 1, 1) = '.' then libres := libres || i; end if; end loop;
  if lvl <= 1 and random() < 0.5 then return libres[1 + floor(random() * array_length(libres, 1))::int]; end if;
  foreach i in array libres loop
    if (hg_duel__aligne(overlay(g placing me from i + 1 for 1), 3, 3, 3, false, me)).qui is not null then return i; end if;
  end loop;
  foreach i in array libres loop
    if (hg_duel__aligne(overlay(g placing opp from i + 1 for 1), 3, 3, 3, false, opp)).qui is not null then return i; end if;
  end loop;
  if lvl <= 2 then return libres[1 + floor(random() * array_length(libres, 1))::int]; end if;
  -- Difficile : fourchette adverse évitée par un côté si l'adversaire tient deux coins opposés.
  if substr(g, 5, 1) = me and ((substr(g, 1, 1) = opp and substr(g, 9, 1) = opp) or (substr(g, 3, 1) = opp and substr(g, 7, 1) = opp)) then
    foreach i in array array[1, 3, 5, 7] loop if i = any(libres) then return i; end if; end loop;
  end if;
  ordre := array[4];
  -- Coin opposé à un coin adverse, puis coins, puis côtés.
  foreach i in array array[0, 2, 6, 8] loop
    if substr(g, i + 1, 1) = opp then ordre := ordre || (8 - i); end if;
  end loop;
  ordre := ordre || array[0, 2, 6, 8] || array[1, 3, 5, 7];
  foreach i in array ordre loop if i = any(libres) then return i; end if; end loop;
  return libres[1];
end $$;

-- Gomoku : potentiel d'une case pour un joueur (longueur des lignes qu'il prolongerait).
create or replace function public.hg_duel__gomoku_pot(g text, w int, i int, c text)
returns int language plpgsql immutable as $$
declare d int; dx int; dy int; x int := i % w; y int := i / w; k int; xx int; yy int; n int; ouv int; s int := 0;
begin
  for d in 1 .. 4 loop
    dx := (array[1, 0, 1, 1])[d]; dy := (array[0, 1, 1, -1])[d]; n := 1; ouv := 0;
    for k in 1 .. 4 loop
      xx := x + k * dx; yy := y + k * dy;
      exit when xx not between 0 and w - 1 or yy not between 0 and w - 1;
      if substr(g, yy * w + xx + 1, 1) = c then n := n + 1;
      else if substr(g, yy * w + xx + 1, 1) = '.' then ouv := ouv + 1; end if; exit; end if;
    end loop;
    for k in 1 .. 4 loop
      xx := x - k * dx; yy := y - k * dy;
      exit when xx not between 0 and w - 1 or yy not between 0 and w - 1;
      if substr(g, yy * w + xx + 1, 1) = c then n := n + 1;
      else if substr(g, yy * w + xx + 1, 1) = '.' then ouv := ouv + 1; end if; exit; end if;
    end loop;
    s := s + case when n >= 5 then 100000 when n = 4 then case ouv when 2 then 20000 when 1 then 3000 else 0 end
                  when n = 3 then case ouv when 2 then 1500 when 1 then 200 else 0 end
                  when n = 2 then case ouv when 2 then 120 when 1 then 30 else 0 end else ouv * 3 end;
  end loop;
  return s;
end $$;

-- Robot du Gomoku : la meilleure case près des pions déjà posés (plus de hasard aux niveaux faciles).
create or replace function public.hg_duel__gomoku_robot(g text, me text, opp text, lvl int)
returns int language plpgsql volatile as $$
declare w int := 15; i int; x int; y int; xx int; yy int; voisin boolean; s int; best int := 112; best_s int := -1;
begin
  if position('1' in g) = 0 and position('2' in g) = 0 then return 112; end if;
  for i in 0 .. w * w - 1 loop
    continue when substr(g, i + 1, 1) <> '.';
    x := i % w; y := i / w; voisin := false;
    <<v>> for yy in greatest(0, y - 2) .. least(w - 1, y + 2) loop
      for xx in greatest(0, x - 2) .. least(w - 1, x + 2) loop
        if substr(g, yy * w + xx + 1, 1) in ('1', '2') then voisin := true; exit v; end if;
      end loop;
    end loop;
    continue when not voisin;
    s := hg_duel__gomoku_pot(g, w, i, me) + (hg_duel__gomoku_pot(g, w, i, opp) * 9) / 10
       + floor(random() * case lvl when 1 then 3000 when 2 then 120 else 10 end)::int;
    if s > best_s then best_s := s; best := i; end if;
  end loop;
  return best;
end $$;

-- Morpion ultime : la petite grille k est-elle gagnable par c au prochain coup ?
create or replace function public.hg_duel__ultime_menace(g text, k int, c text)
returns boolean language plpgsql immutable as $$
declare p text := substr(g, k * 9 + 1, 9); i int;
begin
  for i in 0 .. 8 loop
    if substr(p, i + 1, 1) = '.' and (hg_duel__aligne(overlay(p placing c from i + 1 for 1), 3, 3, 3, false, c)).qui is not null then return true; end if;
  end loop;
  return false;
end $$;

-- Robot du Morpion ultime : case (0..80) choisie.
create or replace function public.hg_duel__ultime_robot(g text, petites text, cible int, me text, opp text, lvl int)
returns int language plpgsql volatile as $$
declare i int; k int; c int; p text; s int; best int := null; best_s int := -1000000; pet2 text;
begin
  for i in 0 .. 80 loop
    k := i / 9; c := i % 9;
    continue when substr(g, i + 1, 1) <> '.' or substr(petites, k + 1, 1) <> '.' or (cible is not null and k <> cible);
    s := floor(random() * case lvl when 1 then 200 else 4 end)::int;
    if lvl >= 2 then
      p := overlay(substr(g, k * 9 + 1, 9) placing me from c + 1 for 1);
      if (hg_duel__aligne(p, 3, 3, 3, false, me)).qui is not null then
        s := s + 100;
        pet2 := overlay(petites placing me from k + 1 for 1);
        if (hg_duel__aligne(pet2, 3, 3, 3, false, me)).qui is not null then s := s + 100000; end if;
      end if;
      if (hg_duel__aligne(overlay(substr(g, k * 9 + 1, 9) placing opp from c + 1 for 1), 3, 3, 3, false, opp)).qui is not null then s := s + 80; end if;
    end if;
    if lvl >= 3 then
      -- Où j'envoie l'adversaire : grille qu'il peut gagner tout de suite, ou choix libre.
      if substr(petites, c + 1, 1) <> '.' or c = k then s := s - 25;
      elsif hg_duel__ultime_menace(overlay(g placing me from i + 1 for 1), c, opp) then s := s - 70; end if;
      if c = 4 then s := s + 5; end if;
      if k = 4 then s := s + 3; end if;
    end if;
    if s > best_s then best_s := s; best := i; end if;
  end loop;
  return best;
end $$;

-- Coup du robot (ou du jeu pour un absent) dans un duel à grille : case ou colonne.
create or replace function public.hg_duel__coup_robot(p hg_duel_parties, p_user uuid, lvl int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare me text := hg_duel__pion(p.id, p_user); opp text; dm record;
begin
  opp := case me when '1' then '2' else '1' end;
  select * into dm from hg_duel__dims(p.jeu, p.variante);
  if p.jeu = 'p4' then return hg_duel__p4_robot(p.grille, dm.w, dm.h, me, opp, lvl); end if;
  if p.variante = 'gomoku' then return hg_duel__gomoku_robot(p.grille, me, opp, lvl); end if;
  if p.variante = 'ultime' then return hg_duel__ultime_robot(p.grille, p.petites, p.cible, me, opp, lvl); end if;
  return hg_duel__morpion_robot(p.grille, me, opp, lvl);
end $$;

-- Fin de partie : classement, Paillettes, badges. p_vainqueur null : match nul (ou partie arrêtée si p_annulee).
create or replace function public.hg_duel__terminer(p_id uuid, p_vainqueur uuid, p_annulee boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; cfg jsonb; pts jsonb; r record; v_gain int; v_jour int; v_plafond int; v_max int; v_off jsonb;
  v_cle text; v_autre uuid; v_deja int; v_debut timestamptz;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut in ('terminee', 'annulee') then return; end if;
  cfg := coalesce((select value from hg_settings where key = 'duels'), '{}'::jsonb);
  v_plafond := coalesce((cfg->>'plafond_jour')::int, 500);
  v_max := coalesce((cfg->>'max_meme_adversaire')::int, 3);
  v_off := coalesce(cfg->'badges_inactifs', '[]'::jsonb);
  v_cle := case when p.jeu = 'morpion' and p.variante = 'classique' then 'morpion_classique' else p.jeu end;  -- p4, morpion, mastermind, bataille, quiestce
  pts := coalesce(cfg->'paillettes'->v_cle, '{}'::jsonb);
  v_debut := date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';

  update hg_duel_joueurs j set gagne = (j.user_id = p_vainqueur),
    rang = case when p_vainqueur is null then 1 when j.user_id = p_vainqueur then 1 else 2 end
  where j.partie = p_id;
  update hg_duel_parties set statut = case when p_annulee then 'annulee' else 'terminee' end, vainqueur = p_vainqueur,
    tour = null, tour_fin = null, ended_at = now(), version = version + 1 where id = p_id;
  update hg_duel_joueurs set fin = null where partie = p_id;
  perform hg_duel__log(p_id, p_vainqueur, 'fin', case when p_annulee then 'La partie a été arrêtée.'
    when p_vainqueur is null then 'Match nul !' else hg_duel__nom(p_id, p_vainqueur) || ' gagne le duel !' end);

  if p_annulee or p.robot > 0 then
    -- Contre le robot : pas de Paillettes, seulement le badge du mode Difficile.
    if not p_annulee and p.robot = 3 and p_vainqueur is not null and p_vainqueur <> hg_duel__robot_id() and not v_off ? 'duel_robot'
       and exists (select 1 from hg_profiles where id = p_vainqueur and not is_ghost) then
      insert into hg_user_badges(user_id, badge_code) values (p_vainqueur, 'duel_robot') on conflict do nothing;
    end if;
    return;
  end if;
  -- Abandon ou forfait avant la fin de la première manche : ni Paillettes ni badges (évite les duels « express » entre deux comptes).
  if not exists (select 1 from hg_duel_manches m where m.partie = p_id) then return; end if;

  for r in select x.* from hg_duel_joueurs x where x.partie = p_id and not x.invite and not x.robot
           and exists (select 1 from hg_profiles pr where pr.id = x.user_id and not pr.is_ghost) loop
    v_autre := hg_duel__autre(p_id, r.user_id);
    -- Pas de Paillettes contre un invité ; au plus v_max duels récompensés par jour contre le même adversaire.
    select count(*) into v_deja from hg_duel_joueurs a join hg_duel_parties pp on pp.id = a.partie
      join hg_duel_joueurs b on b.partie = a.partie and b.user_id = v_autre
      where a.user_id = r.user_id and a.paillettes > 0 and pp.ended_at >= v_debut and pp.id <> p_id;
    if not (select invite from hg_duel_joueurs where partie = p_id and user_id = v_autre) and v_deja < v_max then
      v_gain := coalesce((pts->>'partie')::int, 20) + case when r.user_id = p_vainqueur then coalesce((pts->>'victoire')::int, 60) else 0 end;
      select coalesce(sum(delta), 0) into v_jour from hg_wallet_log where user_id = r.user_id and reason = 'duels' and created_at >= v_debut;
      v_gain := greatest(0, least(v_gain, v_plafond - v_jour));
      if v_gain > 0 and hg_wallet_add(r.user_id, v_gain, 'duels', 'duel:' || p_id || ':' || r.user_id) then
        update hg_duel_joueurs set paillettes = v_gain where partie = p_id and user_id = r.user_id;
      end if;
    end if;

    -- Badges
    if r.user_id = p_vainqueur then
      if p.jeu = 'p4' and not v_off ? 'duel_p4_premiere' then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_p4_premiere') on conflict do nothing; end if;
      if p.jeu = 'morpion' and not v_off ? 'duel_morpion_premiere' then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_morpion_premiere') on conflict do nothing; end if;
      if p.jeu = 'mastermind' and not v_off ? 'duel_mm_premiere' then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_mm_premiere') on conflict do nothing; end if;
      if p.jeu = 'bataille' and not v_off ? 'duel_bn_premiere' then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_bn_premiere') on conflict do nothing; end if;
      if p.jeu = 'quiestce' and not v_off ? 'duel_qec_premiere' then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_qec_premiere') on conflict do nothing; end if;
      if p.jeu = 'p4' and not v_off ? 'duel_p4_dix' and (select count(*) from hg_duel_joueurs a join hg_duel_parties pp on pp.id = a.partie
          where a.user_id = r.user_id and a.gagne and pp.jeu = 'p4' and pp.robot = 0 and pp.statut = 'terminee') >= 10 then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_p4_dix') on conflict do nothing; end if;
      if p.jeu = 'morpion' and p.variante = 'ultime' and not v_off ? 'duel_morpion_ultime' and (select count(*) from hg_duel_joueurs a
          join hg_duel_parties pp on pp.id = a.partie where a.user_id = r.user_id and a.gagne and pp.variante = 'ultime'
          and pp.jeu = 'morpion' and pp.robot = 0 and pp.statut = 'terminee') >= 10 then
        insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_morpion_ultime') on conflict do nothing; end if;
    end if;
    if p.jeu = 'p4' and not v_off ? 'duel_p4_diagonale' and exists (select 1 from hg_duel_manches m where m.partie = p_id
        and m.gagnant = r.user_id and m.diagonale) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_p4_diagonale') on conflict do nothing; end if;
    if p.jeu = 'p4' and not v_off ? 'duel_p4_eclair' and exists (select 1 from hg_duel_manches m where m.partie = p_id
        and m.gagnant = r.user_id and m.coups < 10) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_p4_eclair') on conflict do nothing; end if;
    if p.jeu = 'morpion' and not v_off ? 'duel_morpion_mur' and (select count(*) from hg_duel_manches m join hg_duel_joueurs a
        on a.partie = m.partie and a.user_id = r.user_id join hg_duel_parties pp on pp.id = m.partie
        where pp.jeu = 'morpion' and m.gagnant is null) >= 10 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_morpion_mur') on conflict do nothing; end if;
    if p.jeu = 'mastermind' and not v_off ? 'duel_mm_eclair' and exists (select 1 from hg_duel_manches m where m.partie = p_id
        and m.gagnant = r.user_id and m.coups <= 4) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_mm_eclair') on conflict do nothing; end if;
    -- Bataille navale : précision (> 60 % de tirs réussis) et aucun navire perdu, sur une manche gagnée.
    if p.jeu = 'bataille' and not v_off ? 'duel_bn_sniper' and exists (select 1 from hg_duel_manches m where m.partie = p_id and m.gagnant = r.user_id
        and (select count(*) filter (where t.resultat in ('touche', 'coule')) * 100 > 60 * count(*) from hg_duel_tirs t
             where t.partie = p_id and t.manche = m.manche and t.tireur = r.user_id and t.resultat <> 'radar')) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_bn_sniper') on conflict do nothing; end if;
    if p.jeu = 'bataille' and not v_off ? 'duel_bn_fantome' and exists (select 1 from hg_duel_manches m where m.partie = p_id and m.gagnant = r.user_id
        and not exists (select 1 from hg_duel_navires nv where nv.partie = p_id and nv.manche = m.manche and nv.user_id = r.user_id and nv.coule)) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_bn_fantome') on conflict do nothing; end if;
    if p.jeu = 'quiestce' and not v_off ? 'duel_qec_flair' and exists (select 1 from hg_duel_manches m where m.partie = p_id and m.gagnant = r.user_id
        and (select count(*) from hg_duel_qec_questions q where q.partie = p_id and q.manche = m.manche and q.auteur = r.user_id) <= 3
        and exists (select 1 from hg_duel_coups c where c.partie = p_id and c.manche = m.manche and c.user_id = r.user_id and c.type = 'devine')) then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_qec_flair') on conflict do nothing; end if;
    if not v_off ? 'duel_rival' and (select count(*) from hg_duel_joueurs a join hg_duel_parties pp on pp.id = a.partie
        join hg_duel_joueurs b on b.partie = a.partie and b.user_id = v_autre
        where a.user_id = r.user_id and pp.statut = 'terminee') >= 20 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'duel_rival') on conflict do nothing; end if;
  end loop;
end $$;

-- Nouvelle manche : grille vide, le premier joueur alterne, codes du Mastermind.
create or replace function public.hg_duel__nouvelle_manche(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; dm record; v_premier uuid; a uuid; b uuid; r record;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  select * into dm from hg_duel__dims(p.jeu, p.variante);
  select user_id into a from hg_duel_joueurs where partie = p_id and place = 1;
  select user_id into b from hg_duel_joueurs where partie = p_id and place = 2;
  if p.manche = 0 then
    v_premier := case p.commence when 'moi' then p.hote when 'lui' then (case when a = p.hote then b else a end)
                 else (case when random() < 0.5 then a else b end) end;
  else
    v_premier := case when p.premier = a then b else a end;
  end if;
  update hg_duel_parties set manche = manche + 1, premier = v_premier, nb_coups = 0, dernier = null, cible = null,
    grille = case when p.jeu in ('mastermind', 'bataille', 'quiestce') then '' else repeat('.', dm.w * dm.h) end, restant = null,
    petites = case when p.variante = 'ultime' then '.........' else null end,
    phase = 'jeu', tour = null, tour_fin = null
  where id = p_id;
  update hg_duel_joueurs set coups = 0, essais = 0, trouve_en = null, trouve_at = null, fin = null, pret = false, radar = false,
    baisses = '{}' where partie = p_id;
  select * into p from hg_duel_parties where id = p_id;

  if p.jeu = 'bataille' then
    update hg_duel_parties set phase = 'placement' where id = p_id;
    update hg_duel_joueurs set fin = now() + interval '90 seconds' where partie = p_id and not robot;
    for r in select user_id from hg_duel_joueurs where partie = p_id and robot loop
      perform hg_duel__bn_poser(p_id, r.user_id, hg_duel__bn_hasard(coalesce((p.options->>'contact')::boolean, false)));
    end loop;
    perform hg_duel__log(p_id, null, 'info', 'Manche ' || p.manche || ' : placez vos flottes.');
  elsif p.jeu = 'quiestce' then
    for r in select user_id from hg_duel_joueurs where partie = p_id loop
      insert into hg_duel_qec_secrets(partie, manche, user_id, perso)
      values (p_id, p.manche, r.user_id, (select id from hg_duel_qec_persos where plateau = p.variante order by random() limit 1));
    end loop;
    update hg_duel_parties set etat = etat - 'question_libre' where id = p_id;
    perform hg_duel__donner_tour(p_id, v_premier);
    perform hg_duel__log(p_id, v_premier, 'info', 'Manche ' || p.manche || ' : chacun a son personnage secret. ' || hg_duel__nom(p_id, v_premier) || ' commence.');
  elsif p.jeu = 'mastermind' then
    if p.robot > 0 or coalesce(p.options->>'codes', 'choisis') = 'hasard' then
      for r in select user_id from hg_duel_joueurs where partie = p_id loop
        insert into hg_duel_codes(partie, manche, pour, secret) values (p_id, p.manche, r.user_id, hg_duel__mm_hasard());
      end loop;
      update hg_duel_joueurs set fin = case when robot then null else now() + make_interval(secs => p.t_coup) end where partie = p_id;
      perform hg_duel__log(p_id, null, 'info', 'Manche ' || p.manche || ' : les codes sont tirés au hasard. À vous de jouer !');
    else
      update hg_duel_parties set phase = 'codes' where id = p_id;
      update hg_duel_joueurs set fin = now() + interval '60 seconds' where partie = p_id and not robot;
      perform hg_duel__log(p_id, null, 'info', 'Manche ' || p.manche || ' : choisissez chacun le code que l''autre devra percer.');
    end if;
  else
    perform hg_duel__donner_tour(p_id, v_premier);
    perform hg_duel__log(p_id, v_premier, 'info', 'Manche ' || p.manche || ' : ' || hg_duel__nom(p_id, v_premier) || ' commence.');
  end if;
end $$;

-- Fin d'une manche : score, historique, puis fin du duel ou manche suivante.
create or replace function public.hg_duel__fin_manche(p_id uuid, p_gagnant uuid, p_cases int[] default null, p_diag boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_besoin int; v_coups int; a record; b record; v_txt text;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  v_coups := case when p.jeu = 'mastermind' then coalesce((select trouve_en from hg_duel_joueurs where partie = p_id and user_id = p_gagnant), 0)
                  else coalesce((select coups from hg_duel_joueurs where partie = p_id and user_id = p_gagnant), 0) end;
  insert into hg_duel_manches(partie, manche, gagnant, coups, diagonale, grille, ligne)
  values (p_id, p.manche, p_gagnant, v_coups, coalesce(p_diag, false), p.grille, p_cases)
  on conflict (partie, manche) do nothing;
  if p_gagnant is null then
    update hg_duel_joueurs set nuls = nuls + 1 where partie = p_id;
    v_txt := 'Manche ' || p.manche || ' : nulle.';
  else
    update hg_duel_joueurs set manches = manches + 1 where partie = p_id and user_id = p_gagnant;
    v_txt := 'Manche ' || p.manche || ' : ' || hg_duel__nom(p_id, p_gagnant) || ' gagne'
      || case when p.jeu = 'mastermind' then ' en ' || v_coups || ' essai' || case when v_coups > 1 then 's' else '' end else '' end || '.';
  end if;
  update hg_duel_parties set tour = null, tour_fin = null,
    etat = jsonb_set(etat, '{historique}', coalesce(etat->'historique', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'manche', p.manche, 'gagnant', p_gagnant, 'coups', v_coups, 'grille', p.grille, 'petites', p.petites, 'ligne', to_jsonb(p_cases),
      'codes', case when p.jeu = 'mastermind' then (select jsonb_object_agg(pour, secret) from hg_duel_codes where partie = p_id and manche = p.manche) end)))
  where id = p_id;
  perform hg_duel__log(p_id, p_gagnant, 'manche', v_txt);

  v_besoin := p.format / 2 + 1;
  select * into a from hg_duel_joueurs where partie = p_id and place = 1;
  select * into b from hg_duel_joueurs where partie = p_id and place = 2;
  if a.manches >= v_besoin then perform hg_duel__terminer(p_id, a.user_id);
  elsif b.manches >= v_besoin then perform hg_duel__terminer(p_id, b.user_id);
  elsif p.manche >= p.format * 2 or (p.format = 1 and p_gagnant is null) then
    -- Trop de nulles (ou manche unique nulle) : le meilleur score l'emporte, sinon match nul.
    perform hg_duel__terminer(p_id, case when a.manches > b.manches then a.user_id when b.manches > a.manches then b.user_id end);
  else
    perform hg_duel__nouvelle_manche(p_id);
  end if;
end $$;

-- Applique un coup (vérifié ici) sur une grille : P4 (colonne, action « pose » ou « retire »), Morpion (case).
-- p_auto : coup joué par le robot pour un absent (son compteur de coups manqués n'est pas remis à zéro).
create or replace function public.hg_duel__appliquer(p_id uuid, p_user uuid, p_coup int, p_action text default 'pose', p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; dm record; c text; opp text; g text; al record; al2 record; k int; pk text; pet text; v_autre uuid; v_texte text;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu = 'mastermind' then raise exception 'La partie n''est pas en cours.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  select * into dm from hg_duel__dims(p.jeu, p.variante);
  c := hg_duel__pion(p_id, p_user); opp := case c when '1' then '2' else '1' end;
  v_autre := hg_duel__autre(p_id, p_user);
  if p_coup is null then raise exception 'Coup invalide.'; end if;

  if p.jeu = 'p4' then
    if coalesce(p_action, 'pose') = 'retire' then
      if p.variante <> 'popout' then raise exception 'Cette variante ne permet pas de retirer un pion.'; end if;
      g := hg_duel__p4_retirer(p.grille, dm.w, dm.h, p_coup, c);
      if g is null then raise exception 'Tu ne peux retirer qu''un de tes pions, en bas d''une colonne.'; end if;
      v_texte := hg_duel__nom(p_id, p_user) || ' retire un pion de la colonne ' || (p_coup + 1) || '.';
    else
      g := hg_duel__p4_lacher(p.grille, dm.w, dm.h, p_coup, c);
      if g is null then raise exception 'Cette colonne est pleine.'; end if;
      v_texte := hg_duel__nom(p_id, p_user) || ' joue en colonne ' || (p_coup + 1) || '.';
    end if;
  elsif p.variante = 'ultime' then
    if p_coup not between 0 and 80 or hg_duel__at(p.grille, p_coup) <> '.' then raise exception 'Cette case est prise.'; end if;
    k := p_coup / 9;
    if p.cible is not null and k <> p.cible then raise exception 'Tu dois jouer dans la petite grille indiquée.'; end if;
    if substr(p.petites, k + 1, 1) <> '.' then raise exception 'Cette petite grille est terminée.'; end if;
    g := hg_duel__set(p.grille, p_coup, c);
    v_texte := hg_duel__nom(p_id, p_user) || ' joue en case ' || (p_coup % 9 + 1) || ' de la grille ' || (k + 1) || '.';
  else
    if p_coup < 0 or p_coup >= dm.w * dm.h or hg_duel__at(p.grille, p_coup) <> '.' then raise exception 'Cette case est prise.'; end if;
    g := hg_duel__set(p.grille, p_coup, c);
    v_texte := hg_duel__nom(p_id, p_user) || ' joue en case ' || (p_coup + 1) || '.';
  end if;

  update hg_duel_parties set grille = g, nb_coups = nb_coups + 1,
    dernier = jsonb_build_object('user_id', p_user, 'case', p_coup, 'action', coalesce(p_action, 'pose'))
  where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'coup', v_texte);

  if p.variante = 'ultime' then
    pk := substr(g, k * 9 + 1, 9); pet := p.petites;
    al := hg_duel__aligne(pk, 3, 3, 3, false, c);
    if al.qui is not null then
      pet := overlay(pet placing c from k + 1 for 1);
      perform hg_duel__log(p_id, p_user, 'info', hg_duel__nom(p_id, p_user) || ' gagne la petite grille ' || (k + 1) || '.');
    elsif position('.' in pk) = 0 then
      pet := overlay(pet placing '=' from k + 1 for 1);
    end if;
    update hg_duel_parties set petites = pet,
      cible = case when substr(pet, p_coup % 9 + 1, 1) = '.' then p_coup % 9 else null end where id = p_id;
    al := hg_duel__aligne(pet, 3, 3, 3, false, c);
    if al.qui is not null then perform hg_duel__fin_manche(p_id, p_user, al.cases, al.diagonale); return; end if;
    if position('.' in pet) = 0 then perform hg_duel__fin_manche(p_id, null); return; end if;
  else
    al := hg_duel__aligne(g, dm.w, dm.h, dm.n, dm.exact, c);
    if p.jeu = 'p4' and coalesce(p_action, 'pose') = 'retire' and al.qui is null then
      -- Pop Out : un retrait peut aussi faire aligner l'adversaire (il gagne alors).
      al2 := hg_duel__aligne(g, dm.w, dm.h, dm.n, false, opp);
      if al2.qui is not null then perform hg_duel__fin_manche(p_id, v_autre, al2.cases, al2.diagonale); return; end if;
    end if;
    if al.qui is not null then perform hg_duel__fin_manche(p_id, p_user, al.cases, al.diagonale); return; end if;
    if position('.' in g) = 0 then perform hg_duel__fin_manche(p_id, null); return; end if;
  end if;
  perform hg_duel__donner_tour(p_id, v_autre);
end $$;

/* ---------- Mastermind ---------- */

-- Fin de manche du Mastermind dès que le résultat est certain.
create or replace function public.hg_duel__mm_verifier(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a record; b record; g uuid := null; fa boolean; fb boolean;
begin
  select * into a from hg_duel_joueurs where partie = p_id and place = 1;
  select * into b from hg_duel_joueurs where partie = p_id and place = 2;
  fa := a.trouve_en is not null or a.essais >= 10;
  fb := b.trouve_en is not null or b.essais >= 10;
  if fa and fb then
    if a.trouve_en is not null and b.trouve_en is not null then
      g := case when a.trouve_en < b.trouve_en then a.user_id when b.trouve_en < a.trouve_en then b.user_id
                when a.trouve_at <= b.trouve_at then a.user_id else b.user_id end;
    elsif a.trouve_en is not null then g := a.user_id;
    elsif b.trouve_en is not null then g := b.user_id;
    end if;
    perform hg_duel__fin_manche(p_id, g);
  elsif a.trouve_en is not null and not fb and b.essais >= a.trouve_en - 1 then
    perform hg_duel__fin_manche(p_id, a.user_id);
  elsif b.trouve_en is not null and not fa and a.essais >= b.trouve_en - 1 then
    perform hg_duel__fin_manche(p_id, b.user_id);
  end if;
end $$;

-- Enregistre un essai (vérifié ici) pour un joueur.
create or replace function public.hg_duel__mm_essai(p_id uuid, p_user uuid, p_essai text, p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; j hg_duel_joueurs; v_secret text; sc record; v_e text := lower(trim(coalesce(p_essai, '')));
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'mastermind' then raise exception 'La partie n''est pas en cours.'; end if;
  if p.phase <> 'jeu' then raise exception 'Les codes ne sont pas encore choisis.'; end if;
  select * into j from hg_duel_joueurs where partie = p_id and user_id = p_user for update;
  if j.trouve_en is not null then raise exception 'Tu as déjà trouvé le code.'; end if;
  if j.essais >= 10 then raise exception 'Tu as utilisé tes 10 essais.'; end if;
  if v_e !~ '^[roygbp]{4}$' then raise exception 'Choisis 4 couleurs.'; end if;
  select secret into v_secret from hg_duel_codes where partie = p_id and manche = p.manche and pour = p_user;
  sc := hg_duel__mm_score(v_secret, v_e);
  insert into hg_duel_essais(partie, manche, user_id, n, essai, bien, mal, auto) values (p_id, p.manche, p_user, j.essais + 1, v_e, sc.bien, sc.mal, p_auto);
  update hg_duel_joueurs set essais = essais + 1, manques = case when p_auto then manques else 0 end,
    trouve_en = case when sc.bien = 4 then j.essais + 1 else null end, trouve_at = case when sc.bien = 4 then now() else null end,
    fin = case when robot or sc.bien = 4 or j.essais + 1 >= 10 then null else now() + make_interval(secs => p.t_coup) end
  where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'essai', hg_duel__nom(p_id, p_user) || ' : essai ' || (j.essais + 1) || ', '
    || sc.bien || ' bien placé' || case when sc.bien > 1 then 's' else '' end || ', ' || sc.mal || ' mal placé' || case when sc.mal > 1 then 's' else '' end
    || case when sc.bien = 4 then ' : code trouvé !' else '.' end);
end $$;

-- Essai du robot (ou du jeu pour un absent) : un code encore possible (au hasard parmi tous en mode facile).
create or replace function public.hg_duel__mm_robot(p_id uuid, p_user uuid, lvl int)
returns text language plpgsql volatile security definer set search_path = public as $$
declare p hg_duel_parties; v jsonb; c text;
begin
  select * into p from hg_duel_parties where id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('essai', essai, 'bien', bien, 'mal', mal)), '[]'::jsonb) into v
    from hg_duel_essais where partie = p_id and manche = p.manche and user_id = p_user;
  if lvl <= 1 and random() < 0.6 then
    return hg_duel__mm_hasard();
  end if;
  select code into c from hg_duel__mm_possibles(v) code order by random() limit 1;
  return coalesce(c, hg_duel__mm_hasard());
end $$;

-- Le robot de la partie joue ses essais : un essai par essai humain, puis jusqu'au bout si l'humain a fini.
create or replace function public.hg_duel__mm_robot_suite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; rb hg_duel_joueurs; h hg_duel_joueurs; n int := 0;
begin
  loop
    select * into p from hg_duel_parties where id = p_id;
    exit when p.statut <> 'en_cours' or p.robot = 0 or p.jeu <> 'mastermind' or p.phase <> 'jeu' or n > 12;
    select * into rb from hg_duel_joueurs where partie = p_id and robot;
    select * into h from hg_duel_joueurs where partie = p_id and not robot;
    exit when rb.trouve_en is not null or rb.essais >= 10;
    exit when rb.essais >= h.essais and h.trouve_en is null and h.essais < 10;
    perform hg_duel__mm_essai(p_id, rb.user_id, hg_duel__mm_robot(p_id, rb.user_id, p.robot));
    perform hg_duel__mm_verifier(p_id);
    n := n + 1;
  end loop;
end $$;

-- Mastermind : un joueur fixe le code que son adversaire devra percer.
create or replace function public.hg_duel__mm_poser_code(p_id uuid, p_user uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); v_c text := lower(trim(coalesce(p_code, '')));
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.phase <> 'codes' then raise exception 'Ce n''est pas le moment de choisir un code.'; end if;
  if v_c !~ '^[roygbp]{4}$' then raise exception 'Choisis 4 couleurs.'; end if;
  insert into hg_duel_codes(partie, manche, pour, secret) values (p_id, p.manche, v_autre, v_c)
  on conflict (partie, manche, pour) do update set secret = excluded.secret;
  update hg_duel_joueurs set fin = null where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'info', hg_duel__nom(p_id, p_user) || ' a choisi son code.');
  if (select count(*) from hg_duel_codes where partie = p_id and manche = p.manche) >= 2 then
    update hg_duel_parties set phase = 'jeu' where id = p_id;
    update hg_duel_joueurs set fin = case when robot then null else now() + make_interval(secs => p.t_coup) end where partie = p_id;
    perform hg_duel__log(p_id, null, 'info', 'Les deux codes sont prêts : à vous de jouer !');
  end if;
end $$;

/* ---------- Bataille navale ---------- */

-- Flotte : type, longueur, nom.
create or replace function public.hg_duel__bn_flotte()
returns table(type text, longueur int, nom text) language sql immutable as $$
  values ('porte_avions', 5, 'Porte-avions'), ('cuirasse', 4, 'Cuirassé'), ('croiseur', 3, 'Croiseur'),
         ('sous_marin', 3, 'Sous-marin'), ('torpilleur', 2, 'Torpilleur')
$$;

-- Vérifie une flotte [{type, cases:[0..99]}] : 5 navires, bonnes longueurs, en ligne droite, dans la grille,
-- sans chevauchement, et sans contact (même en diagonale) si p_contact est faux. Renvoie la flotte normalisée (cases triées).
create or replace function public.hg_duel__bn_valider(p_navires jsonb, p_contact boolean)
returns jsonb language plpgsql immutable as $$
declare f record; n jsonb; cs int[]; i int; occ int[] := '{}'; zone int[] := '{}'; c int; x int; y int; dx int; dy int; out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_navires) <> 'array' or jsonb_array_length(p_navires) <> 5 then raise exception 'Place tes 5 navires.'; end if;
  for f in select * from hg_duel__bn_flotte() loop
    select x2 into n from jsonb_array_elements(p_navires) x2 where x2->>'type' = f.type limit 1;
    if n is null then raise exception 'Il manque le % .', lower(f.nom); end if;
    select array_agg(v::int order by v::int) into cs from jsonb_array_elements_text(n->'cases') v;
    if cs is null or array_length(cs, 1) <> f.longueur then raise exception 'Le % fait % cases.', lower(f.nom), f.longueur; end if;
    if cs[1] < 0 or cs[array_length(cs, 1)] > 99 then raise exception 'Un navire sort de la grille.'; end if;
    -- En ligne droite : même ligne et cases consécutives, ou même colonne et pas de 10.
    if cs[array_length(cs, 1)] - cs[1] = f.longueur - 1 and cs[1] / 10 = cs[array_length(cs, 1)] / 10 then dx := 1;
    elsif cs[array_length(cs, 1)] - cs[1] = (f.longueur - 1) * 10 then dx := 10;
    else raise exception 'Le % doit être en ligne droite.', lower(f.nom); end if;
    for i in 2 .. array_length(cs, 1) loop
      if cs[i] - cs[i - 1] <> dx then raise exception 'Le % doit être en ligne droite.', lower(f.nom); end if;
    end loop;
    foreach c in array cs loop
      if c = any(occ) then raise exception 'Deux navires se chevauchent.'; end if;
      if not p_contact and c = any(zone) then raise exception 'Deux navires se touchent : laisse une case entre eux.'; end if;
    end loop;
    occ := occ || cs;
    foreach c in array cs loop
      x := c % 10; y := c / 10;
      for dy in -1 .. 1 loop for dx in -1 .. 1 loop
        if x + dx between 0 and 9 and y + dy between 0 and 9 then zone := zone || ((y + dy) * 10 + x + dx); end if;
      end loop; end loop;
    end loop;
    out := out || jsonb_build_array(jsonb_build_object('type', f.type, 'cases', to_jsonb(cs)));
    n := null;
  end loop;
  return out;
end $$;

-- Flotte tirée au hasard (valide) : chaque navire est posé à une place libre (et sans contact si demandé).
create or replace function public.hg_duel__bn_hasard(p_contact boolean)
returns jsonb language plpgsql volatile as $$
declare essai int; f record; out jsonb; hor boolean; x int; y int; cs int[]; ok boolean; k int; occ int[]; zone int[]; c int; dx int; dy int;
begin
  for essai in 1 .. 50 loop
    out := '[]'::jsonb; occ := '{}'; zone := '{}'; ok := true;
    for f in select * from hg_duel__bn_flotte() loop
      ok := false;
      for k in 1 .. 200 loop
        hor := random() < 0.5;
        x := floor(random() * case when hor then 11 - f.longueur else 10 end)::int;
        y := floor(random() * case when hor then 10 else 11 - f.longueur end)::int;
        select array_agg(case when hor then y * 10 + x + i else (y + i) * 10 + x end order by i) into cs from generate_series(0, f.longueur - 1) i;
        continue when cs && occ or (not p_contact and cs && zone);
        ok := true; exit;
      end loop;
      exit when not ok;
      out := out || jsonb_build_array(jsonb_build_object('type', f.type, 'cases', to_jsonb(cs)));
      occ := occ || cs;
      foreach c in array cs loop
        for dy in -1 .. 1 loop for dx in -1 .. 1 loop
          if c % 10 + dx between 0 and 9 and c / 10 + dy between 0 and 9 then zone := zone || (c + dy * 10 + dx); end if;
        end loop; end loop;
      end loop;
    end loop;
    if ok then return hg_duel__bn_valider(out, p_contact); end if;
  end loop;
  raise exception 'Placement au hasard impossible, réessaie.';
end $$;

-- Pose la flotte d'un joueur pour la manche en cours ; quand les deux sont prêtes, les tirs commencent.
create or replace function public.hg_duel__bn_poser(p_id uuid, p_user uuid, p_navires jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v jsonb; n jsonb;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'bataille' or p.phase <> 'placement' then raise exception 'Ce n''est pas le moment de placer ta flotte.'; end if;
  v := hg_duel__bn_valider(p_navires, coalesce((p.options->>'contact')::boolean, false));
  delete from hg_duel_navires where partie = p_id and manche = p.manche and user_id = p_user;
  for n in select * from jsonb_array_elements(v) loop
    insert into hg_duel_navires(partie, manche, user_id, type, cases)
    values (p_id, p.manche, p_user, n->>'type', array(select x::int from jsonb_array_elements_text(n->'cases') x));
  end loop;
  update hg_duel_joueurs set fin = null, pret = true where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'info', hg_duel__nom(p_id, p_user) || ' a placé sa flotte.');
  if (select count(*) from hg_duel_joueurs where partie = p_id and pret) >= 2 then
    update hg_duel_parties set phase = 'jeu' where id = p_id;
    perform hg_duel__bn_donner_tour(p_id, p.premier);
    perform hg_duel__log(p_id, p.premier, 'info', 'Les flottes sont en place : ' || hg_duel__nom(p_id, p.premier) || ' tire le premier.');
  end if;
end $$;

-- Donne le tour pour une salve (Salve : autant de tirs que de navires encore à flot).
create or replace function public.hg_duel__bn_donner_tour(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  select * into p from hg_duel_parties where id = p_id;
  update hg_duel_parties set restant = case when p.variante = 'salve' then
      greatest(1, (select count(*) from hg_duel_navires where partie = p_id and manche = p.manche and user_id = p_user and not coule)) else 1 end
  where id = p_id;
  perform hg_duel__donner_tour(p_id, p_user);
end $$;

-- Un tir (vérifié ici). Renvoie le résultat : 'eau', 'touche' ou 'coule'.
create or replace function public.hg_duel__bn_tirer(p_id uuid, p_user uuid, p_case int, p_auto boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); nav hg_duel_navires; v_res text; v_l text;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'bataille' or p.phase <> 'jeu' then raise exception 'Ce n''est pas le moment de tirer.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  if p_case is null or p_case not between 0 and 99 then raise exception 'Case invalide.'; end if;
  if exists (select 1 from hg_duel_tirs where partie = p_id and manche = p.manche and tireur = p_user and case_n = p_case and resultat <> 'radar') then
    raise exception 'Tu as déjà tiré sur cette case.';
  end if;
  select * into nav from hg_duel_navires where partie = p_id and manche = p.manche and user_id = v_autre and p_case = any(cases);
  if nav.type is null then v_res := 'eau';
  else
    v_res := 'touche';
    if (select count(*) from hg_duel_tirs t where t.partie = p_id and t.manche = p.manche and t.tireur = p_user
        and t.resultat <> 'radar' and t.case_n = any(nav.cases)) + 1 >= array_length(nav.cases, 1) then
      v_res := 'coule';
      update hg_duel_navires set coule = true where partie = p_id and manche = p.manche and user_id = v_autre and type = nav.type;
    end if;
  end if;
  insert into hg_duel_tirs(partie, manche, tireur, case_n, resultat, navire) values (p_id, p.manche, p_user, p_case, v_res, case when v_res = 'coule' then nav.type end);
  update hg_duel_parties set nb_coups = nb_coups + 1, dernier = jsonb_build_object('user_id', p_user, 'case', p_case, 'resultat', v_res) where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
  v_l := chr(65 + p_case % 10) || (p_case / 10 + 1);
  perform hg_duel__log(p_id, p_user, 'tir', hg_duel__nom(p_id, p_user) || ' tire en ' || v_l || ' : '
    || case v_res when 'eau' then 'à l''eau.' when 'touche' then 'touché !' else (select lower(nom) from hg_duel__bn_flotte() where type = nav.type) || ' coulé !' end);
  if not exists (select 1 from hg_duel_navires where partie = p_id and manche = p.manche and user_id = v_autre and not coule) then
    perform hg_duel__fin_manche(p_id, p_user);
    return v_res;
  end if;
  -- Suite du tour : salve (tirs restants), rejouer après un tir réussi, sinon l'adversaire.
  if p.variante = 'salve' then
    if p.restant > 1 then update hg_duel_parties set restant = restant - 1 where id = p_id; perform hg_duel__donner_tour(p_id, p_user);
    else perform hg_duel__bn_donner_tour(p_id, v_autre); end if;
  elsif v_res <> 'eau' and coalesce((p.options->>'rejouer')::boolean, true) then
    perform hg_duel__bn_donner_tour(p_id, p_user);
  else
    perform hg_duel__bn_donner_tour(p_id, v_autre);
  end if;
  return v_res;
end $$;

-- Radar (une fois par manche, compte comme le tir du tour) : nombre de cases de navire dans le carré 3 × 3 autour de la case.
create or replace function public.hg_duel__bn_radar(p_id uuid, p_user uuid, p_case int)
returns int language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); v_n int; zone int[] := '{}'; dx int; dy int; x int; y int;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'bataille' or p.phase <> 'jeu' then raise exception 'Ce n''est pas le moment.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  if (select radar from hg_duel_joueurs where partie = p_id and user_id = p_user) then raise exception 'Tu as déjà utilisé ton radar.'; end if;
  if p_case is null or p_case not between 0 and 99 then raise exception 'Case invalide.'; end if;
  x := p_case % 10; y := p_case / 10;
  for dy in -1 .. 1 loop for dx in -1 .. 1 loop
    if x + dx between 0 and 9 and y + dy between 0 and 9 then zone := zone || ((y + dy) * 10 + x + dx); end if;
  end loop; end loop;
  select count(*) into v_n from hg_duel_navires nv, unnest(nv.cases) c where nv.partie = p_id and nv.manche = p.manche and nv.user_id = v_autre and c = any(zone);
  insert into hg_duel_tirs(partie, manche, tireur, case_n, resultat, valeur) values (p_id, p.manche, p_user, p_case, 'radar', v_n);
  update hg_duel_joueurs set radar = true, manques = 0 where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'radar', hg_duel__nom(p_id, p_user) || ' utilise son radar en ' || chr(65 + x) || (y + 1) || '.');
  perform hg_duel__bn_donner_tour(p_id, v_autre);
  return v_n;
end $$;

-- Case visée par le robot (ou par le jeu pour un absent).
create or replace function public.hg_duel__bn_robot(p_id uuid, p_user uuid, lvl int)
returns int language plpgsql volatile security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); tires int[]; eau int[]; touches int[]; coules int[]; c int; best int; best_s int;
  score int[]; f record; hor boolean; x int; y int; cs int[]; i int; ok boolean; poids int; libres int[];
begin
  select * into p from hg_duel_parties where id = p_id;
  select coalesce(array_agg(case_n), '{}') into tires from hg_duel_tirs where partie = p_id and manche = p.manche and tireur = p_user and resultat <> 'radar';
  select coalesce(array_agg(case_n), '{}') into eau from hg_duel_tirs where partie = p_id and manche = p.manche and tireur = p_user and resultat = 'eau';
  select coalesce(array_agg(c2), '{}') into coules from hg_duel_navires nv, unnest(nv.cases) c2
    where nv.partie = p_id and nv.manche = p.manche and nv.user_id = v_autre and nv.coule;
  select coalesce(array_agg(case_n), '{}') into touches from hg_duel_tirs where partie = p_id and manche = p.manche and tireur = p_user
    and resultat in ('touche', 'coule') and not (case_n = any(coules));
  select array_agg(g) into libres from generate_series(0, 99) g where not (g = any(tires));
  if lvl <= 1 and random() < 0.7 then return libres[1 + floor(random() * array_length(libres, 1))::int]; end if;
  if lvl <= 2 then
    -- Chasse : autour des cases touchées (dans l'axe s'il y en a deux), sinon en damier.
    if array_length(touches, 1) > 0 then
      foreach c in array touches loop
        foreach i in array array[-1, 1, -10, 10] loop
          if c + i between 0 and 99 and not (c + i = any(tires)) and (abs(i) = 10 or (c + i) / 10 = c / 10)
             and (array_length(touches, 1) < 2 or (abs(i) = 1 and exists (select 1 from unnest(touches) t where t <> c and t / 10 = c / 10))
                  or (abs(i) = 10 and exists (select 1 from unnest(touches) t where t <> c and t % 10 = c % 10))
                  or not exists (select 1 from unnest(touches) t where t <> c and (t / 10 = c / 10 or t % 10 = c % 10))) then
            return c + i;
          end if;
        end loop;
      end loop;
    end if;
    select g into c from unnest(libres) g where (g % 10 + g / 10) % 2 = 0 order by random() limit 1;
    return coalesce(c, libres[1]);
  end if;
  -- Difficile : densité de probabilité des navires encore à flot.
  score := array_fill(0, array[100]);
  for f in select fl.* from hg_duel__bn_flotte() fl where fl.type not in (select type from hg_duel_navires
           where partie = p_id and manche = p.manche and user_id = v_autre and coule) loop
    for hor in select unnest(array[true, false]) loop
      for y in 0 .. case when hor then 9 else 10 - f.longueur end loop
        for x in 0 .. case when hor then 10 - f.longueur else 9 end loop
          select array_agg(case when hor then y * 10 + x + k else (y + k) * 10 + x end) into cs from generate_series(0, f.longueur - 1) k;
          ok := not exists (select 1 from unnest(cs) z where z = any(eau) or z = any(coules));
          continue when not ok;
          poids := 1 + 20 * (select count(*) from unnest(cs) z where z = any(touches))::int;
          foreach c in array cs loop
            if not (c = any(tires)) then score[c + 1] := score[c + 1] + poids; end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  best := libres[1]; best_s := -1;
  foreach c in array libres loop
    if score[c + 1] + floor(random() * 2)::int > best_s then best_s := score[c + 1]; best := c; end if;
  end loop;
  return best;
end $$;

/* ---------- Qui est-ce ? ---------- */

-- Personnage d'un plateau : attribut demandé, comparé à la valeur (oui / non).
create or replace function public.hg_duel__qec_vrai(p_attr jsonb, p_cle text, p_valeur text)
returns boolean language sql immutable as $$
  select case p_cle
    when 'lunettes' then coalesce((p_attr->>'lunettes')::boolean, false)
    when 'barbe' then coalesce((p_attr->>'barbe')::boolean, false)
    when 'boucles' then coalesce((p_attr->>'boucles')::boolean, false)
    when 'longs' then coalesce((p_attr->>'longs')::boolean, false)
    when 'chapeau' then case when p_valeur = 'oui' then coalesce(p_attr->>'chapeau', 'aucun') <> 'aucun' else p_attr->>'chapeau' = p_valeur end
    when 'cheveux' then p_attr->>'cheveux' = p_valeur
    when 'yeux' then p_attr->>'yeux' = p_valeur
    else false end
$$;

-- Questions toutes prêtes (réponse calculée par le serveur) : clé, valeur, texte.
create or replace function public.hg_duel__qec_questions()
returns table(cle text, valeur text, texte text) language sql immutable as $$
  values ('lunettes', 'oui', 'Ton personnage porte-t-il des lunettes ?'),
         ('chapeau', 'oui', 'Ton personnage porte-t-il quelque chose sur la tête ?'),
         ('chapeau', 'casquette', 'Ton personnage porte-t-il une casquette ?'),
         ('chapeau', 'chapeau', 'Ton personnage porte-t-il un chapeau ?'),
         ('chapeau', 'bonnet', 'Ton personnage porte-t-il un bonnet ?'),
         ('barbe', 'oui', 'Ton personnage a-t-il de la barbe ?'),
         ('boucles', 'oui', 'Ton personnage porte-t-il des boucles d''oreilles ?'),
         ('longs', 'oui', 'Ton personnage a-t-il les cheveux longs ?'),
         ('cheveux', 'aucun', 'Ton personnage est-il chauve ?'),
         ('cheveux', 'noirs', 'Ton personnage a-t-il les cheveux noirs ?'),
         ('cheveux', 'bruns', 'Ton personnage a-t-il les cheveux bruns ?'),
         ('cheveux', 'blonds', 'Ton personnage a-t-il les cheveux blonds ?'),
         ('cheveux', 'roux', 'Ton personnage a-t-il les cheveux roux ?'),
         ('cheveux', 'gris', 'Ton personnage a-t-il les cheveux gris ou blancs ?'),
         ('yeux', 'marron', 'Ton personnage a-t-il les yeux marron ?'),
         ('yeux', 'bleus', 'Ton personnage a-t-il les yeux bleus ?'),
         ('yeux', 'verts', 'Ton personnage a-t-il les yeux verts ?')
$$;

-- Personnages encore possibles pour un joueur (d'après les réponses aux questions qu'il a posées cette manche).
create or replace function public.hg_duel__qec_possibles(p_id uuid, p_user uuid)
returns setof int language sql stable security definer set search_path = public as $$
  select pe.id from hg_duel_qec_persos pe join hg_duel_parties p on p.id = p_id and pe.plateau = p.variante
  where not exists (select 1 from hg_duel_qec_questions q where q.partie = p_id and q.manche = p.manche and q.auteur = p_user
                    and q.type = 'attribut' and q.reponse is not null and hg_duel__qec_vrai(pe.attributs, q.cle, q.valeur) <> q.reponse)
$$;

-- Pose une question toute prête (réponse immédiate) ; le tour passe à l'adversaire.
create or replace function public.hg_duel__qec_question(p_id uuid, p_user uuid, p_cle text, p_valeur text, p_auto boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); q record; v_perso int; v_rep boolean;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'quiestce' then raise exception 'La partie n''est pas en cours.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.etat ? 'question_libre' then raise exception 'Une question attend sa réponse.'; end if;
  select * into q from hg_duel__qec_questions() x where x.cle = p_cle and x.valeur = p_valeur;
  if q.cle is null then raise exception 'Question inconnue.'; end if;
  select perso into v_perso from hg_duel_qec_secrets where partie = p_id and manche = p.manche and user_id = v_autre;
  v_rep := hg_duel__qec_vrai((select attributs from hg_duel_qec_persos where plateau = p.variante and id = v_perso), p_cle, p_valeur);
  insert into hg_duel_qec_questions(partie, manche, auteur, type, cle, valeur, texte, reponse)
  values (p_id, p.manche, p_user, 'attribut', p_cle, p_valeur, q.texte, v_rep);
  update hg_duel_parties set nb_coups = nb_coups + 1, dernier = jsonb_build_object('user_id', p_user, 'question', q.texte, 'reponse', v_rep) where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'question', hg_duel__nom(p_id, p_user) || ' : « ' || q.texte || ' » ' || case when v_rep then 'Oui.' else 'Non.' end);
  perform hg_duel__donner_tour(p_id, v_autre);
  return v_rep;
end $$;

-- Question libre (écrite par le joueur) : l'adversaire doit répondre avant de jouer son tour.
create or replace function public.hg_duel__qec_question_libre(p_id uuid, p_user uuid, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); t text := left(trim(coalesce(p_texte, '')), 140); v_qid bigint;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'quiestce' then raise exception 'La partie n''est pas en cours.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.robot > 0 or not coalesce((p.options->>'libres')::boolean, true) then raise exception 'Les questions libres sont désactivées pour ce duel.'; end if;
  if p.etat ? 'question_libre' then raise exception 'Une question attend sa réponse.'; end if;
  if char_length(t) < 4 then raise exception 'Écris ta question.'; end if;
  insert into hg_duel_qec_questions(partie, manche, auteur, type, texte) values (p_id, p.manche, p_user, 'libre', t) returning id into v_qid;
  update hg_duel_parties set nb_coups = nb_coups + 1, etat = etat || jsonb_build_object('question_libre', v_qid),
    dernier = jsonb_build_object('user_id', p_user, 'question', t) where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = 0 where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'question', hg_duel__nom(p_id, p_user) || ' demande : « ' || t || ' »');
  perform hg_duel__donner_tour(p_id, v_autre);
end $$;

-- Réponse à une question libre (oui, non, ou null : pas de réponse dans les temps). Le répondant joue ensuite son tour.
create or replace function public.hg_duel__qec_repondre(p_id uuid, p_user uuid, p_oui boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_qid bigint;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if not (p.etat ? 'question_libre') or p.tour is distinct from p_user then raise exception 'Aucune question ne t''attend.'; end if;
  v_qid := (p.etat->>'question_libre')::bigint;
  update hg_duel_qec_questions set reponse = p_oui, repondu = true where id = v_qid;
  update hg_duel_parties set etat = etat - 'question_libre' where id = p_id;
  perform hg_duel__log(p_id, p_user, 'reponse', hg_duel__nom(p_id, p_user) || ' répond : '
    || case when p_oui is null then 'pas de réponse.' when p_oui then 'oui.' else 'non.' end);
  perform hg_duel__donner_tour(p_id, p_user);
end $$;

-- « Je pense que c'est… » : juste, la manche est gagnée ; faux, elle est perdue.
create or replace function public.hg_duel__qec_deviner(p_id uuid, p_user uuid, p_perso int)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_autre uuid := hg_duel__autre(p_id, p_user); v_vrai int; v_nom text;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.jeu <> 'quiestce' then raise exception 'La partie n''est pas en cours.'; end if;
  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.etat ? 'question_libre' then raise exception 'Une question attend sa réponse.'; end if;
  select prenom into v_nom from hg_duel_qec_persos where plateau = p.variante and id = p_perso;
  if v_nom is null then raise exception 'Personnage inconnu.'; end if;
  select perso into v_vrai from hg_duel_qec_secrets where partie = p_id and manche = p.manche and user_id = v_autre;
  update hg_duel_joueurs set coups = coups + 1, manques = 0 where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'devine', hg_duel__nom(p_id, p_user) || ' pense que c''est ' || v_nom || ' : '
    || case when v_vrai = p_perso then 'gagné !' else 'perdu, c''était ' || (select prenom from hg_duel_qec_persos where plateau = p.variante and id = v_vrai) || '.' end);
  perform hg_duel__fin_manche(p_id, case when v_vrai = p_perso then p_user else v_autre end);
  return v_vrai = p_perso;
end $$;

-- Le robot (ou le jeu pour un absent) : devine s'il ne reste qu'un personnage, sinon pose la question la plus utile.
create or replace function public.hg_duel__qec_robot(p_id uuid, p_user uuid, lvl int)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_poss int[]; q record; best record; best_s int := 1000; n_oui int; s int; v_tot int;
begin
  select * into p from hg_duel_parties where id = p_id;
  if p.etat ? 'question_libre' then perform hg_duel__qec_repondre(p_id, p_user, null); return; end if;
  select array_agg(x) into v_poss from hg_duel__qec_possibles(p_id, p_user) x;
  v_tot := coalesce(array_length(v_poss, 1), 0);
  if v_tot = 1 or (lvl <= 1 and v_tot <= 3 and random() < 0.5) then
    perform hg_duel__qec_deviner(p_id, p_user, v_poss[1 + floor(random() * v_tot)::int]); return;
  end if;
  for q in select * from hg_duel__qec_questions() order by random() loop
    continue when exists (select 1 from hg_duel_qec_questions x where x.partie = p_id and x.manche = p.manche and x.auteur = p_user
                          and x.cle = q.cle and x.valeur = q.valeur);
    select count(*) into n_oui from hg_duel_qec_persos pe where pe.plateau = p.variante and pe.id = any(v_poss) and hg_duel__qec_vrai(pe.attributs, q.cle, q.valeur);
    continue when n_oui = 0 or n_oui = v_tot;
    s := case when lvl >= 3 then abs(v_tot - 2 * n_oui) else floor(random() * 10)::int end;
    if s < best_s then best_s := s; best := q; end if;
  end loop;
  if best.cle is null then perform hg_duel__qec_deviner(p_id, p_user, v_poss[1]); return; end if;
  perform hg_duel__qec_question(p_id, p_user, best.cle, best.valeur, true);
end $$;

/* ---------- Robot, absents, tâche planifiée ---------- */

-- Le robot de la partie joue tant que c'est son tour (duels à grille).
create or replace function public.hg_duel__robot_suite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; n int := 0;
begin
  loop
    select * into p from hg_duel_parties where id = p_id;
    exit when p.statut <> 'en_cours' or p.robot = 0 or p.jeu = 'mastermind' or p.tour is distinct from hg_duel__robot_id() or n > 40;
    if p.jeu = 'bataille' then perform hg_duel__bn_tirer(p_id, p.tour, hg_duel__bn_robot(p_id, p.tour, p.robot));
    elsif p.jeu = 'quiestce' then perform hg_duel__qec_robot(p_id, p.tour, p.robot);
    else perform hg_duel__appliquer(p_id, p.tour, hg_duel__coup_robot(p, p.tour, p.robot), 'pose'); end if;
    n := n + 1;
  end loop;
end $$;

-- Un joueur absent : 3 coups manqués d'affilée et il perd le duel par forfait.
create or replace function public.hg_duel__forfait(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update hg_duel_parties set etat = etat || jsonb_build_object('forfait', p_user) where id = p_id;
  perform hg_duel__log(p_id, p_user, 'info', hg_duel__nom(p_id, p_user) || ' a manqué 3 coups : forfait.');
  perform hg_duel__terminer(p_id, hg_duel__autre(p_id, p_user));
end $$;

-- Joue pour les absents dont l'échéance est dépassée. Renvoie true si quelque chose a été joué.
create or replace function public.hg_duel__echeances(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; j hg_duel_joueurs; n int := 0; v_m int; v_autre uuid;
begin
  loop
    select * into p from hg_duel_parties where id = p_id for update;
    exit when p.statut <> 'en_cours' or n >= 20;
    if p.jeu = 'bataille' and p.phase = 'placement' then
      select * into j from hg_duel_joueurs where partie = p_id and not robot and not pret and fin is not null and fin <= now() order by fin limit 1;
      exit when not found;
      perform hg_duel__log(p_id, j.user_id, 'auto', 'Temps écoulé : la flotte de ' || hg_duel__nom(p_id, j.user_id) || ' est placée au hasard.');
      perform hg_duel__bn_poser(p_id, j.user_id, hg_duel__bn_hasard(coalesce((p.options->>'contact')::boolean, false)));
      perform hg_duel__robot_suite(p_id);
    elsif p.jeu <> 'mastermind' then
      exit when p.tour_fin is null or now() < p.tour_fin;
      if p.jeu = 'quiestce' and p.etat ? 'question_libre' then
        -- Pas de réponse dans les temps : la question reste sans réponse (pas de pénalité), le répondant joue.
        perform hg_duel__qec_repondre(p_id, p.tour, null);
        n := n + 1; continue;
      end if;
      update hg_duel_joueurs set manques = manques + 1 where partie = p_id and user_id = p.tour returning manques into v_m;
      if v_m >= 3 then perform hg_duel__forfait(p_id, p.tour); n := n + 1; exit; end if;
      perform hg_duel__log(p_id, p.tour, 'auto', 'Temps écoulé : le jeu joue pour ' || hg_duel__nom(p_id, p.tour) || '.');
      if p.jeu = 'bataille' then perform hg_duel__bn_tirer(p_id, p.tour, hg_duel__bn_robot(p_id, p.tour, 2), true);
      elsif p.jeu = 'quiestce' then
        perform hg_duel__qec_robot(p_id, p.tour, 1);
        update hg_duel_joueurs set manques = v_m where partie = p_id and user_id = p.tour;
      else perform hg_duel__appliquer(p_id, p.tour, hg_duel__coup_robot(p, p.tour, 2), 'pose', true); end if;
      perform hg_duel__robot_suite(p_id);
    else
      select * into j from hg_duel_joueurs where partie = p_id and not robot and fin is not null and fin <= now() order by fin limit 1;
      exit when not found;
      if p.phase = 'codes' then
        v_autre := hg_duel__autre(p_id, j.user_id);
        perform hg_duel__log(p_id, j.user_id, 'auto', 'Temps écoulé : un code est tiré au hasard pour ' || hg_duel__nom(p_id, j.user_id) || '.');
        perform hg_duel__mm_poser_code(p_id, j.user_id, hg_duel__mm_hasard());
      else
        update hg_duel_joueurs set manques = manques + 1 where partie = p_id and user_id = j.user_id returning manques into v_m;
        if v_m >= 3 then perform hg_duel__forfait(p_id, j.user_id); n := n + 1; exit; end if;
        perform hg_duel__log(p_id, j.user_id, 'auto', 'Temps écoulé : le jeu tente un code pour ' || hg_duel__nom(p_id, j.user_id) || '.');
        perform hg_duel__mm_essai(p_id, j.user_id, hg_duel__mm_robot(p_id, j.user_id, 2), true);
        perform hg_duel__mm_verifier(p_id);
        perform hg_duel__mm_robot_suite(p_id);
      end if;
    end if;
    n := n + 1;
  end loop;
  if n > 0 then perform hg_duel__bump(p_id); end if;
  return n > 0;
end $$;

-- Appelée chaque minute par pg_cron : absents, défis expirés, parties abandonnées.
create or replace function public.hg_duel_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select distinct p.id from hg_duel_parties p left join hg_duel_joueurs j on j.partie = p.id
           where p.statut = 'en_cours' and (p.tour_fin < now() or j.fin < now()) loop
    if hg_duel__echeances(r.id) then n := n + 1; end if;
  end loop;
  update hg_duel_parties set statut = 'annulee', version = version + 1
    where statut = 'attente' and ((defi_expire is not null and defi_expire < now()) or activite_at < now() - interval '6 hours');
  for r in select id from hg_duel_parties where statut = 'en_cours' and activite_at < now() - interval '3 hours' loop
    perform hg_duel__terminer(r.id, null, true);
  end loop;
  return n;
end $$;

/* =====================================================================
   6. Fonctions publiques : créer, rejoindre, défier
   ===================================================================== */

create or replace function public.hg_duel__identite(p_pseudo text)
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

-- Démarre un duel dont les deux places sont prises.
create or replace function public.hg_duel__demarrer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update hg_duel_parties set statut = 'en_cours', started_at = now(), defi_expire = null where id = p_id;
  perform hg_duel__log(p_id, null, 'info', 'Le duel commence : ' || hg_duel__nom(p_id, (select user_id from hg_duel_joueurs where partie = p_id and place = 1))
    || ' contre ' || hg_duel__nom(p_id, (select user_id from hg_duel_joueurs where partie = p_id and place = 2)) || '.');
  perform hg_duel__nouvelle_manche(p_id);
  perform hg_duel__robot_suite(p_id);
end $$;

-- Prend la seconde place d'un duel en attente (membre ou invité) et le démarre.
create or replace function public.hg_duel__entrer(p_id uuid, p_pseudo text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; i record;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'attente' then raise exception 'Ce duel a déjà commencé.'; end if;
  if exists (select 1 from hg_duel_joueurs where partie = p_id and place = 2) then raise exception 'Ce duel est complet.'; end if;
  if p.defie is not null and p.defie <> auth.uid() then raise exception 'Ce défi est réservé à un autre membre.'; end if;
  for i in select * from hg_duel__identite(p_pseudo) loop
    if i.invite and not p.invites then raise exception 'Ce duel n''accepte pas les invités.'; end if;
    if lower(i.pseudo) = lower(hg_duel__nom(p_id, p.hote)) then raise exception 'Ce pseudo est déjà pris dans ce duel.'; end if;
    insert into hg_duel_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite, place)
    values (p_id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite, 2);
  end loop;
  perform hg_duel__demarrer(p_id);
end $$;

-- p : {jeu, variante, adversaire ('membre'|'code'|'robot'), membre, robot (1-3), commence, format, t_coup, visibilite, invites, codes}
create or replace function public.hg_duel_creer(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_jeu text := coalesce(p->>'jeu', ''); v_var text; v_adv text := coalesce(p->>'adversaire', 'code'); v_membre uuid; v_robot int := 0;
  v_t int; v_f int; v_code text; v_id uuid; me record;
begin
  if not hg_duel_peut() or exists (select 1 from hg_duel_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  if v_jeu not in ('p4', 'morpion', 'mastermind', 'bataille', 'quiestce') then raise exception 'Jeu inconnu.'; end if;
  v_var := coalesce(nullif(p->>'variante', ''), case v_jeu when 'p4' then 'classique' when 'morpion' then 'classique'
    when 'bataille' then 'classique' when 'quiestce' then 'quartier' else 'duel' end);
  if (v_jeu = 'p4' and v_var not in ('classique', 'grande', 'popout')) or (v_jeu = 'morpion' and v_var not in ('classique', 'ultime', 'gomoku'))
     or (v_jeu = 'mastermind' and v_var <> 'duel') or (v_jeu = 'bataille' and v_var not in ('classique', 'salve'))
     or (v_jeu = 'quiestce' and not exists (select 1 from hg_duel_qec_persos where plateau = v_var)) then raise exception 'Variante inconnue.'; end if;
  v_t := coalesce((p->>'t_coup')::int, case when v_jeu in ('mastermind', 'quiestce') then 90 else 30 end);
  if (v_jeu in ('mastermind', 'quiestce') and v_t not in (60, 90, 120)) or (v_jeu not in ('mastermind', 'quiestce') and v_t not in (15, 30, 60)) then
    raise exception 'Temps par coup invalide.';
  end if;
  v_f := coalesce((p->>'format')::int, 1);
  if v_f not in (1, 3, 5) then raise exception 'Format invalide.'; end if;
  if v_adv not in ('membre', 'code', 'robot') then raise exception 'Adversaire invalide.'; end if;
  if v_adv = 'robot' then
    v_robot := coalesce((p->>'robot')::int, 2);
    if v_robot not between 1 and 3 then raise exception 'Niveau du robot invalide.'; end if;
  elsif v_adv = 'membre' then
    v_membre := nullif(p->>'membre', '')::uuid;
    if v_membre is null or v_membre = auth.uid() then raise exception 'Choisis le membre à défier.'; end if;
    if not exists (select 1 from hg_profiles where id = v_membre and not is_ghost) or not hg_page_ok(v_membre, 'duels') then
      raise exception 'Ce membre n''a pas accès aux duels.';
    end if;
    if exists (select 1 from hg_duel_parties where hote = auth.uid() and defie = v_membre and statut = 'attente') then
      raise exception 'Tu as déjà un défi en attente pour ce membre.';
    end if;
  end if;
  if (select count(*) from hg_duel_parties x join hg_duel_joueurs j on j.partie = x.id and j.user_id = auth.uid()
      where x.statut in ('attente', 'en_cours')) >= 10 then
    raise exception 'Tu as déjà 10 duels ouverts : termine-en avant d''en créer un autre.';
  end if;

  v_code := hg_duel__code(v_jeu);
  insert into hg_duel_parties(code, jeu, variante, hote, defie, defi_expire, robot, visibilite, invites, commence, format, t_coup, options)
  values (v_code, v_jeu, v_var, auth.uid(), v_membre, case when v_membre is not null then now() + interval '10 minutes' end, v_robot,
    case when p->>'visibilite' = 'publique' then 'publique' else 'privee' end,
    v_adv = 'code' and coalesce((p->>'invites')::boolean, false),
    case when p->>'commence' in ('moi', 'lui', 'hasard') then p->>'commence' else 'hasard' end, v_f, v_t,
    case v_jeu
      when 'mastermind' then jsonb_build_object('codes', case when p->>'codes' = 'hasard' then 'hasard' else 'choisis' end)
      when 'bataille' then jsonb_build_object('contact', coalesce((p->>'contact')::boolean, false), 'rejouer', coalesce((p->>'rejouer')::boolean, true))
      when 'quiestce' then jsonb_build_object('libres', v_robot = 0 and coalesce((p->>'libres')::boolean, true))
      else '{}'::jsonb end)
  returning id into v_id;
  select * into me from hg_duel__identite(null);
  insert into hg_duel_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite, place)
  values (v_id, auth.uid(), me.pseudo, me.couleur, me.avatar_url, false, 1);
  if v_robot > 0 then
    insert into hg_duel_joueurs(partie, user_id, pseudo, couleur, invite, robot, place)
    values (v_id, hg_duel__robot_id(), 'Le robot', '#9A9A9F', false, true, 2);
    perform hg_duel__demarrer(v_id);
  else
    perform hg_duel__log(v_id, auth.uid(), 'info', case when v_membre is not null
      then me.pseudo || ' défie ' || coalesce((select pseudo from hg_profiles where id = v_membre), '?') || '.'
      else me.pseudo || ' attend un adversaire.' end);
  end if;
  perform hg_duel__bump(v_id);
  return v_code;
end $$;

create or replace function public.hg_duel_rejoindre(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  if not hg_duel_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  p := hg_duel__partie(p_code, true);
  if hg_duel_dans(p.id) then return p.code; end if;
  if p.statut <> 'attente' then raise exception 'Ce duel a déjà commencé.'; end if;
  perform hg_duel__entrer(p.id, null);
  perform hg_duel__bump(p.id);
  return p.code;
end $$;

create or replace function public.hg_duel_refuser(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__partie(p_code, true);
  if p.defie is distinct from auth.uid() or p.statut <> 'attente' then raise exception 'Ce défi n''est plus ouvert.'; end if;
  update hg_duel_parties set statut = 'annulee' where id = p.id;
  perform hg_duel__log(p.id, auth.uid(), 'info', coalesce((select pseudo from hg_profiles where id = auth.uid()), '?') || ' refuse le défi.');
  perform hg_duel__bump(p.id);
end $$;

-- Quitter : en attente, l'hôte annule ; en cours, c'est un abandon (l'adversaire gagne).
create or replace function public.hg_duel_quitter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__partie(p_code, true);
  if not hg_duel_dans(p.id) then return; end if;
  if p.statut = 'attente' then
    update hg_duel_parties set statut = 'annulee' where id = p.id;
    perform hg_duel__log(p.id, auth.uid(), 'info', 'Le duel est annulé.');
  elsif p.statut = 'en_cours' then
    update hg_duel_parties set etat = etat || jsonb_build_object('abandon', auth.uid()) where id = p.id;
    perform hg_duel__log(p.id, auth.uid(), 'info', hg_duel__nom(p.id, auth.uid()) || ' abandonne.');
    perform hg_duel__terminer(p.id, hg_duel__autre(p.id, auth.uid()));
  end if;
  perform hg_duel__bump(p.id);
end $$;

/* =====================================================================
   7. Fonctions publiques : le jeu
   ===================================================================== */

-- Duel en cours où je joue (verrouillé), échéances dépassées jouées d'abord.
create or replace function public.hg_duel__ma_partie(p_code text)
returns public.hg_duel_parties language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__partie(p_code, true);
  if not hg_duel_dans(p.id) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  perform hg_duel__echeances(p.id);
  select * into p from hg_duel_parties where id = p.id;
  if p.statut <> 'en_cours' then raise exception 'Le duel n''est pas en cours.'; end if;
  return p;
end $$;

-- p_coup : colonne (Puissance 4) ou case (Morpion ; Ultime : 0 à 80, 9 cases par petite grille) ; p_action : 'pose' ou 'retire' (Pop Out).
create or replace function public.hg_duel_jouer(p_code text, p_coup int, p_action text default 'pose')
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  perform hg_duel__appliquer(p.id, auth.uid(), p_coup, coalesce(p_action, 'pose'));
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
end $$;

-- Mastermind : le code que mon adversaire devra percer (lettres r, o, y, g, b, p).
create or replace function public.hg_duel_code_secret(p_code text, p_secret text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  perform hg_duel__mm_poser_code(p.id, auth.uid(), p_secret);
  perform hg_duel__bump(p.id);
end $$;

create or replace function public.hg_duel_essayer(p_code text, p_essai text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  perform hg_duel__mm_essai(p.id, auth.uid(), p_essai);
  perform hg_duel__mm_verifier(p.id);
  perform hg_duel__mm_robot_suite(p.id);
  perform hg_duel__bump(p.id);
end $$;

/* ---------- Bataille navale ---------- */

-- Pose ma flotte : [{type, cases:[0..99]}] (porte_avions 5, cuirasse 4, croiseur 3, sous_marin 3, torpilleur 2).
create or replace function public.hg_duel_placer(p_code text, p_navires jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  perform hg_duel__bn_poser(p.id, auth.uid(), p_navires);
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
end $$;

-- Proposition de flotte au hasard (non enregistrée : à valider avec hg_duel_placer). Sans duel : règles classiques sans contact.
create or replace function public.hg_duel_flotte_hasard(p_code text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_contact boolean := false;
begin
  if p_code is not null then
    select coalesce((options->>'contact')::boolean, false) into v_contact from hg_duel_parties where code = upper(trim(p_code))
      order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  end if;
  return hg_duel__bn_hasard(coalesce(v_contact, false));
end $$;

create or replace function public.hg_duel_tirer(p_code text, p_case int)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v text;
begin
  p := hg_duel__ma_partie(p_code);
  v := hg_duel__bn_tirer(p.id, auth.uid(), p_case);
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
  return v;
end $$;

create or replace function public.hg_duel_radar(p_code text, p_case int)
returns int language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v int;
begin
  p := hg_duel__ma_partie(p_code);
  v := hg_duel__bn_radar(p.id, auth.uid(), p_case);
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
  return v;
end $$;

/* ---------- Qui est-ce ? ---------- */

-- Question toute prête (voir hg_duel__qec_questions) : réponse immédiate, puis tour de l'adversaire.
create or replace function public.hg_duel_question(p_code text, p_cle text, p_valeur text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v boolean;
begin
  p := hg_duel__ma_partie(p_code);
  v := hg_duel__qec_question(p.id, auth.uid(), p_cle, p_valeur);
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
  return v;
end $$;

create or replace function public.hg_duel_question_libre(p_code text, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  perform hg_duel__qec_question_libre(p.id, auth.uid(), p_texte);
  perform hg_duel__bump(p.id);
end $$;

create or replace function public.hg_duel_repondre(p_code text, p_oui boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__ma_partie(p_code);
  if p_oui is null then raise exception 'Réponds par oui ou par non.'; end if;
  perform hg_duel__qec_repondre(p.id, auth.uid(), p_oui);
  perform hg_duel__bump(p.id);
end $$;

create or replace function public.hg_duel_deviner(p_code text, p_perso int)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v boolean;
begin
  p := hg_duel__ma_partie(p_code);
  v := hg_duel__qec_deviner(p.id, auth.uid(), p_perso);
  perform hg_duel__robot_suite(p.id);
  perform hg_duel__bump(p.id);
  return v;
end $$;

-- Mes personnages baissés (aide-mémoire, gardé pour la reprise sur un autre appareil).
create or replace function public.hg_duel_baisser(p_code text, p_persos int[])
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__partie(p_code);
  if not hg_duel_dans(p.id) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  update hg_duel_joueurs set baisses = array(select distinct x from unnest(coalesce(p_persos, '{}')) x where x between 0 and 99 order by x)
  where partie = p.id and user_id = auth.uid();
end $$;

-- Personnages d'un plateau (public) et questions toutes prêtes.
create or replace function public.hg_duel_plateau(p_plateau text default 'quartier')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'persos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'prenom', prenom, 'attributs', attributs) order by id)
                        from hg_duel_qec_persos where plateau = coalesce(p_plateau, 'quartier')), '[]'::jsonb),
    'questions', (select jsonb_agg(jsonb_build_object('cle', cle, 'valeur', valeur, 'texte', texte)) from hg_duel__qec_questions()))
$$;

-- À appeler quand le chrono affiché tombe à zéro : le jeu joue pour l'absent.
create or replace function public.hg_duel_avancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  p := hg_duel__partie(p_code, true);
  if not hg_duel_dans(p.id) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  perform hg_duel__echeances(p.id);
end $$;

create or replace function public.hg_duel_message(p_code text, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; t text;
begin
  p := hg_duel__partie(p_code);
  if not hg_duel_dans(p.id) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  t := left(trim(coalesce(p_texte, '')), 300);
  if t = '' then raise exception 'Message vide.'; end if;
  if (select count(*) from hg_duel_messages where partie = p.id and user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Doucement : attends quelques secondes avant d''écrire.';
  end if;
  insert into hg_duel_messages(partie, user_id, texte) values (p.id, auth.uid(), t);
end $$;

create or replace function public.hg_duel_messages(p_partie uuid, p_apres bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_duel_dans(p_partie) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'pseudo', hg_duel__nom(p_partie, m.user_id),
      'texte', m.texte, 'created_at', m.created_at) order by m.id)
    from (select * from hg_duel_messages where partie = p_partie and id > coalesce(p_apres, 0) order by id desc limit 200) m), '[]'::jsonb);
end $$;

-- Revanche : mêmes réglages, l'autre joueur commence ; contre un membre, c'est un nouveau défi ; contre le robot, elle démarre tout de suite.
create or replace function public.hg_duel_rejouer(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_code text; v_autre uuid; v_inv boolean;
begin
  p := hg_duel__partie(p_code, true);
  if not hg_duel_dans(p.id) then raise exception 'Tu ne joues pas dans ce duel.'; end if;
  if p.statut not in ('terminee', 'annulee') then raise exception 'Le duel n''est pas fini.'; end if;
  if p.etat ? 'suite' then return p.etat->>'suite'; end if;
  if exists (select 1 from hg_duel_invites where user_id = auth.uid()) then raise exception 'Seul un membre peut lancer la revanche.'; end if;
  v_autre := hg_duel__autre(p.id, auth.uid());
  v_inv := (select invite from hg_duel_joueurs where partie = p.id and user_id = v_autre);
  v_code := hg_duel_creer(jsonb_build_object('jeu', p.jeu, 'variante', p.variante,
    'adversaire', case when p.robot > 0 then 'robot' when v_inv then 'code' else 'membre' end,
    'membre', case when p.robot = 0 and not v_inv then v_autre end, 'robot', p.robot, 'commence', 'lui', 'format', p.format,
    't_coup', p.t_coup, 'visibilite', p.visibilite, 'invites', p.invites, 'codes', p.options->>'codes',
    'contact', p.options->'contact', 'rejouer', p.options->'rejouer', 'libres', p.options->'libres'));
  update hg_duel_parties set etat = etat || jsonb_build_object('suite', v_code), version = version + 1 where id = p.id;
  return v_code;
end $$;

/* =====================================================================
   8. Lecture : état d'un duel, accueil, membres, statistiques
   ===================================================================== */

create or replace function public.hg_duel_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; v_moi uuid := auth.uid(); v_joue boolean; v_spect boolean; dm record; v_autre uuid; v_mm jsonb := null;
  v_bn jsonb := null; v_qec jsonb := null; v_fini boolean;
begin
  p := hg_duel__partie(p_code);
  v_joue := hg_duel_dans(p.id);
  v_spect := not v_joue and p.defie is distinct from v_moi;
  if not v_joue and p.defie is distinct from v_moi and not (p.visibilite = 'publique' and hg_duel_peut()) then
    raise exception 'Tu ne joues pas dans ce duel.' using errcode = '42501';
  end if;
  if p.statut = 'en_cours' and v_joue then
    if hg_duel__echeances(p.id) then select * into p from hg_duel_parties where id = p.id; end if;
  end if;
  select * into dm from hg_duel__dims(p.jeu, p.variante);
  v_autre := case when v_joue then hg_duel__autre(p.id, v_moi) end;

  if p.jeu = 'mastermind' then
    v_mm := jsonb_build_object(
      -- Mes essais (couleurs visibles) ; ceux de l'adversaire : seulement les indices.
      'mes_essais', case when v_joue then coalesce((select jsonb_agg(jsonb_build_object('n', e.n, 'essai', e.essai, 'bien', e.bien, 'mal', e.mal,
          'auto', e.auto) order by e.n) from hg_duel_essais e where e.partie = p.id and e.manche = p.manche and e.user_id = v_moi), '[]'::jsonb)
        else '[]'::jsonb end,
      'essais_adverses', coalesce((select jsonb_object_agg(x.user_id, x.l) from (
          select e.user_id, jsonb_agg(jsonb_build_object('n', e.n, 'bien', e.bien, 'mal', e.mal) order by e.n) l
          from hg_duel_essais e where e.partie = p.id and e.manche = p.manche and e.user_id is distinct from v_moi group by e.user_id) x), '{}'::jsonb),
      'mon_code', case when v_joue then (select secret from hg_duel_codes where partie = p.id and manche = p.manche and pour = v_autre) end,
      'mon_code_pret', v_joue and exists (select 1 from hg_duel_codes where partie = p.id and manche = p.manche and pour = v_autre),
      'code_adverse_pret', v_joue and exists (select 1 from hg_duel_codes where partie = p.id and manche = p.manche and pour = v_moi),
      'max_essais', 10);
  end if;

  if p.jeu = 'bataille' then
    v_fini := p.statut in ('terminee', 'annulee');
    -- Ma flotte (cachée aux autres) ; tirs de chacun ; navires adverses coulés (ou tous à la fin) ; flotte restante.
    v_bn := jsonb_build_object(
      'flotte', (select jsonb_agg(jsonb_build_object('type', f.type, 'nom', f.nom, 'longueur', f.longueur)) from hg_duel__bn_flotte() f),
      'ma_flotte', case when v_joue then coalesce((select jsonb_agg(jsonb_build_object('type', nv.type, 'cases', to_jsonb(nv.cases), 'coule', nv.coule))
          from hg_duel_navires nv where nv.partie = p.id and nv.manche = p.manche and nv.user_id = v_moi), '[]'::jsonb) else '[]'::jsonb end,
      'tirs', coalesce((select jsonb_object_agg(x.tireur, x.l) from (
          select t.tireur, jsonb_agg(jsonb_build_object('case', t.case_n, 'resultat', t.resultat, 'navire', t.navire,
            'valeur', case when t.tireur = v_moi then t.valeur end) order by t.id) l
          from hg_duel_tirs t where t.partie = p.id and t.manche = p.manche and (t.resultat <> 'radar' or t.tireur = v_moi) group by t.tireur) x), '{}'::jsonb),
      'coules', coalesce((select jsonb_object_agg(x.user_id, x.l) from (
          select nv.user_id, jsonb_agg(jsonb_build_object('type', nv.type, 'cases', to_jsonb(nv.cases))) l
          from hg_duel_navires nv where nv.partie = p.id and nv.manche = p.manche and (nv.coule or v_fini) and nv.user_id is distinct from v_moi
          group by nv.user_id) x), '{}'::jsonb),
      'restants', coalesce((select jsonb_object_agg(x.user_id, x.l) from (
          select nv.user_id, jsonb_agg(nv.type) filter (where not nv.coule) l from hg_duel_navires nv
          where nv.partie = p.id and nv.manche = p.manche group by nv.user_id) x), '{}'::jsonb),
      'tirs_restants', p.restant, 'contact', coalesce((p.options->>'contact')::boolean, false),
      'rejouer', coalesce((p.options->>'rejouer')::boolean, true));
  elsif p.jeu = 'quiestce' then
    v_qec := jsonb_build_object(
      'mon_perso', case when v_joue then (select perso from hg_duel_qec_secrets where partie = p.id and manche = p.manche and user_id = v_moi) end,
      'perso_adverse', case when p.statut in ('terminee', 'annulee') then
          (select jsonb_object_agg(user_id, perso) from hg_duel_qec_secrets where partie = p.id and manche = p.manche) end,
      'mes_baisses', case when v_joue then (select to_jsonb(baisses) from hg_duel_joueurs where partie = p.id and user_id = v_moi) else '[]'::jsonb end,
      'restants_adverses', coalesce((select jsonb_object_agg(j.user_id, 24 - coalesce(array_length(j.baisses, 1), 0))
          from hg_duel_joueurs j where j.partie = p.id and j.user_id is distinct from v_moi), '{}'::jsonb),
      'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'auteur', q.auteur, 'type', q.type, 'cle', q.cle, 'valeur', q.valeur,
          'texte', q.texte, 'reponse', q.reponse, 'repondu', q.repondu or q.type = 'attribut') order by q.id)
        from hg_duel_qec_questions q where q.partie = p.id and q.manche = p.manche), '[]'::jsonb),
      'question_en_attente', (p.etat->>'question_libre')::bigint,
      'libres', coalesce((p.options->>'libres')::boolean, true) and p.robot = 0);
  end if;

  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'code', p.code, 'jeu', p.jeu, 'variante', p.variante, 'nom', hg_duel__jeu_nom(p.jeu, p.variante),
      'statut', p.statut, 'hote', p.hote, 'defie', p.defie, 'defi_expire', p.defi_expire, 'robot', p.robot, 'visibilite', p.visibilite,
      'invites', p.invites, 'commence', p.commence, 'format', p.format, 't_coup', p.t_coup, 'options', p.options, 'restant', p.restant,
      'manche', p.manche, 'phase', p.phase, 'grille', p.grille, 'w', dm.w, 'h', dm.h, 'n', dm.n,
      'petites', p.petites, 'cible', p.cible, 'tour', p.tour, 'tour_fin', p.tour_fin, 'premier', p.premier, 'nb_coups', p.nb_coups,
      'dernier', p.dernier, 'vainqueur', p.vainqueur, 'version', p.version,
      'historique', coalesce(p.etat->'historique', '[]'::jsonb), 'suite', p.etat->>'suite',
      'forfait', p.etat->>'forfait', 'abandon', p.etat->>'abandon'),
    'maintenant', now(),
    'moi', jsonb_build_object('user_id', v_moi, 'joue', v_joue, 'spectateur', v_spect and p.defie is distinct from v_moi,
      'defie', p.defie = v_moi, 'hote', p.hote = v_moi, 'invite', exists (select 1 from hg_duel_invites where user_id = v_moi),
      'place', (select place from hg_duel_joueurs where partie = p.id and user_id = v_moi)),
    'joueurs', coalesce((select jsonb_agg(jsonb_build_object('user_id', j.user_id, 'pseudo', j.pseudo, 'couleur', j.couleur,
        'avatar_url', j.avatar_url, 'invite', j.invite, 'robot', j.robot, 'place', j.place, 'manches', j.manches, 'nuls', j.nuls,
        'coups', j.coups, 'essais', j.essais, 'trouve_en', j.trouve_en, 'fin', j.fin, 'pret', j.pret, 'radar', j.radar,
        'rang', j.rang, 'gagne', j.gagne,
        'paillettes', j.paillettes) order by j.place) from hg_duel_joueurs j where j.partie = p.id), '[]'::jsonb),
    'defie_pseudo', case when p.defie is not null then (select pseudo from hg_profiles where id = p.defie) end,
    'mastermind', v_mm,
    'bataille', v_bn,
    'quiestce', v_qec,
    'journal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'type', x.type, 'texte', x.texte,
        'created_at', x.created_at) order by x.id desc)
      from (select * from hg_duel_coups where partie = p.id order by id desc limit 15) x), '[]'::jsonb),
    'badges', case when p.statut = 'terminee' and v_joue then coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name))
        from hg_user_badges ub join hg_badges b on b.code = ub.badge_code
        where ub.user_id = v_moi and b.code like 'duel\_%' and ub.awarded_at >= coalesce(p.ended_at, now()) - interval '5 seconds'), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

-- Accueil des duels : défis reçus, mes duels, duels ouverts, duels à regarder, résumé.
create or replace function public.hg_duel_accueil()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_moi uuid := auth.uid();
begin
  if not hg_duel_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'defis_recus', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante,
        'nom', hg_duel__jeu_nom(p.jeu, p.variante), 'format', p.format, 't_coup', p.t_coup, 'expire', p.defi_expire,
        'hote_pseudo', hg_duel__nom(p.id, p.hote), 'hote_couleur', (select couleur from hg_duel_joueurs where partie = p.id and user_id = p.hote),
        'created_at', p.created_at) order by p.created_at desc)
      from hg_duel_parties p where p.statut = 'attente' and p.defie = v_moi and p.defi_expire > now()), '[]'::jsonb),
    'mes_duels', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante,
        'nom', hg_duel__jeu_nom(p.jeu, p.variante), 'statut', p.statut, 'robot', p.robot,
        'adversaire_pseudo', coalesce((select pseudo from hg_duel_joueurs where partie = p.id and user_id <> v_moi),
                                      (select pseudo from hg_profiles where id = p.defie)),
        'adversaire_couleur', coalesce((select couleur from hg_duel_joueurs where partie = p.id and user_id <> v_moi),
                                       (select color from hg_profiles where id = p.defie)),
        'mon_tour', p.tour = v_moi or (p.jeu = 'mastermind' and j.fin is not null),
        'tour_fin', coalesce(p.tour_fin, j.fin), 'defi_en_attente', p.defie is not null and p.statut = 'attente')
        order by (p.tour = v_moi) desc nulls last, p.activite_at desc)
      from hg_duel_parties p join hg_duel_joueurs j on j.partie = p.id and j.user_id = v_moi
      where p.statut in ('attente', 'en_cours')), '[]'::jsonb),
    'ouverts', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante,
        'nom', hg_duel__jeu_nom(p.jeu, p.variante), 'format', p.format, 't_coup', p.t_coup,
        'hote_pseudo', hg_duel__nom(p.id, p.hote), 'hote_couleur', (select couleur from hg_duel_joueurs where partie = p.id and user_id = p.hote))
        order by p.created_at desc)
      from hg_duel_parties p where p.statut = 'attente' and p.visibilite = 'publique' and p.defie is null and p.robot = 0
        and p.hote <> v_moi), '[]'::jsonb),
    'en_direct', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante,
        'nom', hg_duel__jeu_nom(p.jeu, p.variante),
        'joueurs', (select jsonb_agg(jsonb_build_object('pseudo', pseudo, 'couleur', couleur) order by place) from hg_duel_joueurs where partie = p.id)))
      from (select * from hg_duel_parties x where x.statut = 'en_cours' and x.visibilite = 'publique' and x.robot = 0
            and not exists (select 1 from hg_duel_joueurs y where y.partie = x.id and y.user_id = v_moi) order by x.activite_at desc limit 6) p), '[]'::jsonb),
    'resume', hg_duel_stats(null, null)
  );
end $$;

-- Membres qu'on peut défier (accès aux duels), par ordre alphabétique.
create or replace function public.hg_duel_membres()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_duel_peut() or exists (select 1 from hg_duel_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', pr.id, 'pseudo', pr.pseudo, 'couleur', pr.color, 'avatar_url', pr.avatar_url)
      order by lower(pr.pseudo))
    from hg_profiles pr where not pr.is_ghost and pr.id <> auth.uid() and hg_page_ok(pr.id, 'duels')), '[]'::jsonb);
end $$;

-- Statistiques d'un membre (moi par défaut), pour un jeu ou tous (p_jeu null).
create or replace function public.hg_duel_stats(p_user uuid default null, p_jeu text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_u uuid := coalesce(p_user, auth.uid()); r record; v_serie int := 0; v_best int := 0; v_cur int := 0; v_fini boolean := false;
  v_n int; v_v int; v_nul int;
begin
  if not hg_duel_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  select count(*), count(*) filter (where j.gagne), count(*) filter (where p.vainqueur is null) into v_n, v_v, v_nul
    from hg_duel_joueurs j join hg_duel_parties p on p.id = j.partie
    where j.user_id = v_u and p.statut = 'terminee' and (p_jeu is null or p.jeu = p_jeu);
  for r in select j.gagne, p.vainqueur from hg_duel_joueurs j join hg_duel_parties p on p.id = j.partie
           where j.user_id = v_u and p.statut = 'terminee' and (p_jeu is null or p.jeu = p_jeu) order by p.ended_at desc loop
    if r.gagne then v_cur := v_cur + 1; if not v_fini then v_serie := v_serie + 1; end if;
    else v_cur := 0; v_fini := true; end if;
    v_best := greatest(v_best, v_cur);
  end loop;
  return jsonb_build_object(
    'duels', v_n, 'victoires', v_v, 'nuls', v_nul, 'defaites', v_n - v_v - v_nul,
    'taux', case when v_n > 0 then round(100.0 * v_v / v_n) else 0 end, 'serie', v_serie, 'meilleure_serie', v_best,
    'rival', (select jsonb_build_object('pseudo', b.pseudo, 'couleur', b.couleur, 'duels', count(*),
        'victoires', count(*) filter (where a.gagne), 'defaites', count(*) filter (where b.gagne))
      from hg_duel_joueurs a join hg_duel_parties p on p.id = a.partie join hg_duel_joueurs b on b.partie = a.partie and b.user_id <> a.user_id
      where a.user_id = v_u and p.statut = 'terminee' and not b.robot and not b.invite and (p_jeu is null or p.jeu = p_jeu)
      group by b.user_id, b.pseudo, b.couleur order by count(*) desc limit 1),
    'par_jeu', coalesce((select jsonb_object_agg(x.jeu, jsonb_build_object('duels', x.n, 'victoires', x.v)) from (
        select p.jeu, count(*) n, count(*) filter (where j.gagne) v from hg_duel_joueurs j join hg_duel_parties p on p.id = j.partie
        where j.user_id = v_u and p.statut = 'terminee' group by p.jeu) x), '{}'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'obtenu', ub.user_id is not null, 'date', ub.awarded_at) order by b.sort)
      from hg_badges b left join hg_user_badges ub on ub.badge_code = b.code and ub.user_id = v_u
      where b.code like 'duel\_%' and (p_jeu is null or b.code like 'duel\_' || case p_jeu when 'mastermind' then 'mm' when 'bataille' then 'bn'
        when 'quiestce' then 'qec' else p_jeu end || '\_%'
        or b.code in ('duel_robot', 'duel_rival'))), '[]'::jsonb),
    'derniers', coalesce((select jsonb_agg(x order by (x->>'date') desc) from (
        select jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante, 'nom', hg_duel__jeu_nom(p.jeu, p.variante),
          'date', p.ended_at, 'adversaire', (select pseudo from hg_duel_joueurs b where b.partie = p.id and b.user_id <> v_u),
          'adversaire_couleur', (select couleur from hg_duel_joueurs b where b.partie = p.id and b.user_id <> v_u),
          'resultat', case when j.gagne then 'victoire' when p.vainqueur is null then 'nul' else 'defaite' end,
          'score', (select string_agg(manches::text, ' – ' order by (user_id = v_u) desc) from hg_duel_joueurs where partie = p.id),
          'paillettes', j.paillettes) x
        from hg_duel_joueurs j join hg_duel_parties p on p.id = j.partie
        where j.user_id = v_u and p.statut = 'terminee' and (p_jeu is null or p.jeu = p_jeu) order by p.ended_at desc limit 8) s), '[]'::jsonb)
  );
end $$;

/* =====================================================================
   9. Code du jour (Mastermind solo)
   ===================================================================== */

create or replace function public.hg_duel__aujourdhui()
returns date language sql stable as $$ select (now() at time zone 'Europe/Zurich')::date $$;

create or replace function public.hg_duel__jour_secret(p_jour date)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  select secret into v from hg_duel_jour where jour = p_jour;
  if not found then
    insert into hg_duel_jour(jour, secret) values (p_jour, hg_duel__mm_hasard()) on conflict (jour) do nothing;
    select secret into v from hg_duel_jour where jour = p_jour;
  end if;
  return v;
end $$;

create or replace function public.hg_duel_jour()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_duel__aujourdhui(); v_trouve int; v_n int; v_serie int := 0; x date;
begin
  if not hg_duel_peut() or exists (select 1 from hg_duel_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  perform hg_duel__jour_secret(d);
  select min(n) filter (where bien = 4), count(*) into v_trouve, v_n from hg_duel_jour_essais where jour = d and user_id = auth.uid();
  -- Série : jours consécutifs (jusqu'à aujourd'hui ou hier) où le code a été trouvé.
  x := case when v_trouve is not null then d else d - 1 end;
  while exists (select 1 from hg_duel_jour_essais where jour = x and user_id = auth.uid() and bien = 4) loop
    v_serie := v_serie + 1; x := x - 1;
  end loop;
  return jsonb_build_object('jour', d, 'essais', coalesce((select jsonb_agg(jsonb_build_object('n', n, 'essai', essai, 'bien', bien, 'mal', mal) order by n)
      from hg_duel_jour_essais where jour = d and user_id = auth.uid()), '[]'::jsonb),
    'trouve_en', v_trouve, 'fini', v_trouve is not null or v_n >= 10, 'serie', v_serie,
    'secret', case when v_trouve is not null or v_n >= 10 then (select secret from hg_duel_jour where jour = d) end,
    'classement', coalesce((select jsonb_agg(jsonb_build_object('pseudo', pr.pseudo, 'couleur', pr.color, 'essais', t.n, 'at', t.created_at,
        'moi', t.user_id = auth.uid()) order by t.n, t.created_at)
      from (select * from hg_duel_jour_essais where jour = d and bien = 4 order by n, created_at limit 10) t
      join hg_profiles pr on pr.id = t.user_id), '[]'::jsonb),
    'trouveurs', (select count(*) from hg_duel_jour_essais where jour = d and bien = 4));
end $$;

create or replace function public.hg_duel_jour_essayer(p_essai text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := hg_duel__aujourdhui(); v_e text := lower(trim(coalesce(p_essai, ''))); v_n int; sc record; cfg jsonb; v_gain int; v_jour int;
  v_debut timestamptz := date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich'; v_serie int := 0; x date;
begin
  if not hg_duel_peut() or exists (select 1 from hg_duel_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  if v_e !~ '^[roygbp]{4}$' then raise exception 'Choisis 4 couleurs.'; end if;
  perform pg_advisory_xact_lock(hashtext('hg_duel_jour:' || auth.uid()::text));
  if exists (select 1 from hg_duel_jour_essais where jour = d and user_id = auth.uid() and bien = 4) then raise exception 'Tu as déjà trouvé le code du jour.'; end if;
  select count(*) into v_n from hg_duel_jour_essais where jour = d and user_id = auth.uid();
  if v_n >= 10 then raise exception 'Tu as utilisé tes 10 essais. Reviens demain !'; end if;
  sc := hg_duel__mm_score(hg_duel__jour_secret(d), v_e);
  insert into hg_duel_jour_essais(jour, user_id, n, essai, bien, mal) values (d, auth.uid(), v_n + 1, v_e, sc.bien, sc.mal);
  if sc.bien = 4 and exists (select 1 from hg_profiles where id = auth.uid() and not is_ghost) then
    cfg := coalesce((select value from hg_settings where key = 'duels'), '{}'::jsonb);
    v_gain := coalesce((cfg->'paillettes'->>'code_du_jour')::int, 30);
    select coalesce(sum(delta), 0) into v_jour from hg_wallet_log where user_id = auth.uid() and reason = 'duels' and created_at >= v_debut;
    v_gain := greatest(0, least(v_gain, coalesce((cfg->>'plafond_jour')::int, 500) - v_jour));
    if v_gain > 0 then perform hg_wallet_add(auth.uid(), v_gain, 'duels', 'duel_jour:' || d || ':' || auth.uid()); end if;
    x := d;
    while exists (select 1 from hg_duel_jour_essais where jour = x and user_id = auth.uid() and bien = 4) loop v_serie := v_serie + 1; x := x - 1; end loop;
    if v_serie >= 7 and not coalesce(cfg->'badges_inactifs', '[]'::jsonb) ? 'duel_mm_jour' then
      insert into hg_user_badges(user_id, badge_code) values (auth.uid(), 'duel_mm_jour') on conflict do nothing;
    end if;
  end if;
  return hg_duel_jour();
end $$;

/* =====================================================================
   10. Administration
   ===================================================================== */

create or replace function public.hg_duel_admin_reglages()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'duels'), '{}'::jsonb);
  return jsonb_build_object(
    'paillettes', coalesce(cfg->'paillettes', '{}'::jsonb),
    'plafond_jour', coalesce((cfg->>'plafond_jour')::int, 500),
    'max_meme_adversaire', coalesce((cfg->>'max_meme_adversaire')::int, 3),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'actif', not coalesce(cfg->'badges_inactifs', '[]'::jsonb) ? b.code,
        'membres', (select count(*) from hg_user_badges u where u.badge_code = b.code)) order by b.sort)
      from hg_badges b where b.code like 'duel\_%'), '[]'::jsonb),
    'parties', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'jeu', p.jeu, 'nom', hg_duel__jeu_nom(p.jeu, p.variante),
        'joueurs', (select string_agg(pseudo, ' contre ' order by place) from hg_duel_joueurs where partie = p.id),
        'statut', p.statut, 'robot', p.robot, 'started_at', coalesce(p.started_at, p.created_at)) order by p.created_at desc)
      from hg_duel_parties p where p.statut in ('attente', 'en_cours')), '[]'::jsonb),
    'terminees', (select jsonb_object_agg(jeu, n) from (select jeu, count(*) n from hg_duel_parties where statut = 'terminee' group by jeu) x)
  );
end $$;

create or replace function public.hg_duel_admin_enregistrer(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb; v_pts jsonb := '{}'::jsonb; k text;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'duels'), '{}'::jsonb);
  foreach k in array array['p4', 'morpion_classique', 'morpion', 'mastermind', 'bataille', 'quiestce'] loop
    v_pts := v_pts || jsonb_build_object(k, jsonb_build_object(
      'partie', least(greatest(coalesce((p->'paillettes'->k->>'partie')::int, (cfg->'paillettes'->k->>'partie')::int, 20), 0), 1000),
      'victoire', least(greatest(coalesce((p->'paillettes'->k->>'victoire')::int, (cfg->'paillettes'->k->>'victoire')::int, 60), 0), 1000)));
  end loop;
  v_pts := v_pts || jsonb_build_object('code_du_jour',
    least(greatest(coalesce((p->'paillettes'->>'code_du_jour')::int, (cfg->'paillettes'->>'code_du_jour')::int, 30), 0), 1000));
  cfg := cfg || jsonb_build_object('paillettes', v_pts,
    'plafond_jour', least(greatest(coalesce((p->>'plafond_jour')::int, 500), 0), 100000),
    'max_meme_adversaire', least(greatest(coalesce((p->>'max_meme_adversaire')::int, 3), 0), 50),
    'badges_inactifs', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p->'badges_inactifs', '[]'::jsonb)) x
                                 where x like 'duel\_%'), '[]'::jsonb));
  insert into hg_settings(key, value) values ('duels', cfg) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'duels_reglages', 'duels', cfg);
end $$;

create or replace function public.hg_duel_admin_arreter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  p := hg_duel__partie(p_code, true);
  if p.statut = 'attente' then
    update hg_duel_parties set statut = 'annulee', version = version + 1 where id = p.id;
  elsif p.statut = 'en_cours' then
    perform hg_duel__terminer(p.id, null, true);
  end if;
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'duels_arreter', p.code, '{}'::jsonb);
end $$;

/* =====================================================================
   11. Invités (sans compte)
   ===================================================================== */

create or replace function public.hg_duel__devenir(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function public.hg_duel_invite(p_action text, p_code text, p_jeton text default null, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; inv hg_duel_invites; v_uid uuid; v_jeton text; v_pseudo text; v_out jsonb;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  select * into p from hg_duel_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';
  end if;

  if p_action = 'apercu' then
    return jsonb_build_object('code', p.code, 'jeu', p.jeu, 'variante', p.variante, 'nom', hg_duel__jeu_nom(p.jeu, p.variante),
      'statut', p.statut, 'invites', p.invites and p.defie is null and p.robot = 0, 'format', p.format, 't_coup', p.t_coup,
      'hote_pseudo', hg_duel__nom(p.id, p.hote), 'complet', exists (select 1 from hg_duel_joueurs where partie = p.id and place = 2));
  end if;

  if p_action = 'rejoindre' then
    if not p.invites or p.defie is not null or p.robot > 0 then raise exception 'Ce duel n''accepte pas les invités.'; end if;
    if p.statut <> 'attente' then raise exception 'Ce duel a déjà commencé.'; end if;
    v_pseudo := trim(coalesce(p_args->>'pseudo', ''));
    if char_length(v_pseudo) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
    v_uid := gen_random_uuid();
    v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into hg_duel_invites(user_id, partie, pseudo, jeton_hash) values (v_uid, p.id, v_pseudo, encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'));
    perform hg_duel__devenir(v_uid);
    perform hg_duel__entrer(p.id, v_pseudo);
    perform hg_duel__bump(p.id);
    return jsonb_build_object('jeton', v_jeton, 'code', p.code, 'user_id', v_uid);
  end if;

  select * into inv from hg_duel_invites where jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if not found or inv.partie <> p.id then raise exception 'Invitation expirée : rejoins à nouveau le duel.' using errcode = '42501'; end if;
  perform hg_duel__devenir(inv.user_id);

  case p_action
    when 'etat' then v_out := hg_duel_etat(p.code);
    when 'quitter' then perform hg_duel_quitter(p.code);
    when 'jouer' then perform hg_duel_jouer(p.code, (p_args->>'coup')::int, coalesce(p_args->>'action', 'pose'));
    when 'code' then perform hg_duel_code_secret(p.code, p_args->>'secret');
    when 'essayer' then perform hg_duel_essayer(p.code, p_args->>'essai');
    when 'placer' then perform hg_duel_placer(p.code, p_args->'navires');
    when 'flotte_hasard' then v_out := hg_duel_flotte_hasard(p.code);
    when 'tirer' then v_out := to_jsonb(hg_duel_tirer(p.code, (p_args->>'case')::int));
    when 'radar' then v_out := to_jsonb(hg_duel_radar(p.code, (p_args->>'case')::int));
    when 'question' then v_out := to_jsonb(hg_duel_question(p.code, p_args->>'cle', p_args->>'valeur'));
    when 'question_libre' then perform hg_duel_question_libre(p.code, p_args->>'texte');
    when 'repondre' then perform hg_duel_repondre(p.code, (p_args->>'oui')::boolean);
    when 'deviner' then v_out := to_jsonb(hg_duel_deviner(p.code, (p_args->>'perso')::int));
    when 'baisser' then perform hg_duel_baisser(p.code, array(select x::int from jsonb_array_elements_text(coalesce(p_args->'persos', '[]'::jsonb)) x));
    when 'plateau' then v_out := hg_duel_plateau(p.variante);
    when 'message' then perform hg_duel_message(p.code, p_args->>'texte');
    when 'avancer' then perform hg_duel_avancer(p.code);
    when 'messages' then v_out := hg_duel_messages(p.id, coalesce((p_args->>'apres')::bigint, 0));
    else raise exception 'Action inconnue.';
  end case;
  return v_out;
end $$;

/* =====================================================================
   12. Notifications : catégorie « jeux » (MP du bot quand on reçoit un défi)
   ===================================================================== */

create or replace function public.hg_set_notif_prefs(p_prefs jsonb, p_quiet_start int default null, p_quiet_end int default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed text[] := array[
    'messages.push', 'messages.discord', 'sorties.push', 'sorties.discord', 'echanges.push', 'echanges.discord',
    'souhaits.push', 'souhaits.discord', 'santa.push', 'santa.discord', 'anniversaires.push', 'anniversaires.discord',
    'quiz.push', 'quiz.discord', 'jeux.push', 'jeux.discord'];
  v_key text;
  v_val jsonb;
  v_row public.hg_notif_prefs;
begin
  if v_uid is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if not exists (select 1 from public.hg_profiles where id = v_uid) then raise exception 'Profil introuvable' using errcode = '42501'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'Préférences invalides' using errcode = '22023'; end if;
  if octet_length(p_prefs::text) > 2000 then raise exception 'Préférences trop longues' using errcode = '22023'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_prefs) loop
    if not (v_key = any (v_allowed)) then raise exception 'Catégorie inconnue : %', left(v_key, 40) using errcode = '22023'; end if;
    if jsonb_typeof(v_val) <> 'boolean' then raise exception 'Valeur invalide pour %', v_key using errcode = '22023'; end if;
  end loop;
  if (p_quiet_start is null) <> (p_quiet_end is null) then raise exception 'Heures calmes incomplètes' using errcode = '22023'; end if;
  if p_quiet_start is not null and (p_quiet_start not between 0 and 23 or p_quiet_end not between 0 and 23 or p_quiet_start = p_quiet_end) then
    raise exception 'Heures calmes invalides (0 à 23, début différent de la fin)' using errcode = '22023';
  end if;

  insert into public.hg_notif_prefs as n (user_id, prefs, quiet_start, quiet_end, updated_at)
  values (v_uid, p_prefs, p_quiet_start, p_quiet_end, now())
  on conflict (user_id) do update set prefs = excluded.prefs, quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end, updated_at = now()
  returning * into v_row;

  -- Colonnes encore lues par les fonctions edge (rappels de sortie, alerte de souhait)
  update public.hg_profiles set
    remind_irl = coalesce((p_prefs ->> 'sorties.discord')::boolean, remind_irl),
    notify_card_wish = coalesce((p_prefs ->> 'souhaits.discord')::boolean, notify_card_wish)
  where id = v_uid
    and (remind_irl is distinct from coalesce((p_prefs ->> 'sorties.discord')::boolean, remind_irl)
      or notify_card_wish is distinct from coalesce((p_prefs ->> 'souhaits.discord')::boolean, notify_card_wish));

  return jsonb_build_object('prefs', v_row.prefs, 'quiet_start', v_row.quiet_start, 'quiet_end', v_row.quiet_end, 'updated_at', v_row.updated_at);
end $$;
comment on function public.hg_set_notif_prefs(jsonb, int, int) is 'Enregistre les notifications par catégorie du membre connecté (liste blanche, heures 0 à 23). Migrations 095 et 122 (catégorie « jeux »).';
revoke all on function public.hg_set_notif_prefs(jsonb, int, int) from public, anon;
grant execute on function public.hg_set_notif_prefs(jsonb, int, int) to authenticated;

/* =====================================================================
   13. Droits d'exécution et tâche planifiée
   ===================================================================== */

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hg\_duel%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'hg\_duel\_\_%' and f.proname <> 'hg_duel_tick' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.hg_duel_invite(text, text, text, jsonb) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hg-duel-tick') then perform cron.unschedule('hg-duel-tick'); end if;
    perform cron.schedule('hg-duel-tick', '* * * * *', 'select public.hg_duel_tick()');
  end if;
end $$;
