-- ===== Humane Gang — migration 125 : socle commun des jeux de plateau (Cluedo, Shadow Hunters, Destins, Monopoly, Risk) =====
-- Une seule infrastructure pour les 5 jeux de groupe : parties, joueurs, salle d'attente, invités sans compte, chat, journal
-- (avec lignes privées), chrono et jeu automatique pour les absents, Paillettes, statistiques, administration.
-- Chaque jeu fournit ses règles dans sa propre migration (126 à 130) sous forme de fonctions internes nommées
--   hg_plat__<jeu>_options(p jsonb) → jsonb      réglages validés de la partie (valeurs par défaut comprises)
--   hg_plat__<jeu>_lancer(p_id uuid)             distribue, tire au sort, donne le premier tour
--   hg_plat__<jeu>_agir(p_id, p_user, p_action, p_args) → jsonb   une action d'un joueur (vérifiée)
--   hg_plat__<jeu>_auto(p_id) → boolean          joue pour le joueur attendu dont le chrono est écoulé
--   hg_plat__<jeu>_vue(p_id, p_moi) → jsonb      état du jeu vu par un joueur (ses secrets seulement)
--   hg_plat__<jeu>_badges(p_id)                  (facultatif) badges de fin de partie
-- Contenus paramétrables (noms des suspects, rues, territoires, personnages, cartes…) : table hg_plat_contenus,
--   modifiable dans le panel admin ; les règles s'appuient sur des identifiants fixes, seuls les textes et couleurs changent.
-- Fonctions publiques (authenticated) : hg_plat_creer, hg_plat_rejoindre, hg_plat_quitter, hg_plat_pret, hg_plat_exclure,
--   hg_plat_lancer, hg_plat_agir, hg_plat_avancer, hg_plat_etat, hg_plat_message, hg_plat_messages, hg_plat_rejouer,
--   hg_plat_publiques, hg_plat_mes_parties, hg_plat_stats, hg_plat_contenus, hg_plat_admin_reglages, hg_plat_admin_enregistrer,
--   hg_plat_admin_arreter, hg_plat_admin_contenu. Invités (anon) : hg_plat_invite(action, code, jeton, args).
-- Accès : une page par jeu (cluedo, shadow-hunters, destins, monopoly, risk), en mode admin au lancement.

/* =====================================================================
   1. Réglages et pages
   ===================================================================== */

insert into public.hg_settings(key, value) values ('plateaux', jsonb_build_object(
  'paillettes', jsonb_build_object(
    'cluedo', jsonb_build_object('partie', 30, 'victoire', 100),
    'shadow', jsonb_build_object('partie', 30, 'victoire', 80),
    'destins', jsonb_build_object('partie', 30, 'victoire', 80),
    'monopoly', jsonb_build_object('partie', 40, 'victoire', 120),
    'risk', jsonb_build_object('partie', 40, 'victoire', 150)),
  'plafond_jour', 800,
  'badges_inactifs', '[]'::jsonb,
  'testeurs', '[]'::jsonb
)) on conflict (key) do nothing;

insert into public.hg_pages(slug, label, mode, in_nav, sort) values
  ('cluedo', 'Cluedo', 'admin', false, 20),
  ('shadow-hunters', 'Shadow Hunters', 'admin', false, 21),
  ('destins', 'Destins', 'admin', false, 22),
  ('monopoly', 'Monopoly', 'admin', false, 23),
  ('risk', 'Risk', 'admin', false, 24)
on conflict (slug) do nothing;

/* =====================================================================
   2. Tables
   ===================================================================== */

create table if not exists public.hg_plat_parties (
  id uuid primary key default gen_random_uuid(),
  jeu text not null check (jeu in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk')),
  code text not null check (code ~ '^HG(CLU|SHH|DES|MON|RSK)-[0-9]{4}$'),
  nom text not null check (char_length(nom) between 1 and 60),
  hote uuid not null,
  visibilite text not null default 'privee' check (visibilite in ('privee', 'publique')),
  nb_places int not null check (nb_places between 2 and 10),
  invites boolean not null default true,
  t_tour int not null default 60 check (t_tour in (30, 60, 90, 120)),
  options jsonb not null default '{}'::jsonb,
  annonce_discord boolean not null default false,
  discord_annonce_at timestamptz,
  statut text not null default 'attente' check (statut in ('attente', 'en_cours', 'terminee', 'annulee')),
  tour uuid,                                     -- joueur attendu (null : personne en particulier)
  tour_fin timestamptz,                          -- échéance du joueur attendu
  nb_tours int not null default 0,
  etat jsonb not null default '{}'::jsonb,       -- état public du jeu
  secret jsonb not null default '{}'::jsonb,     -- état caché (jamais renvoyé tel quel) : pioches, enveloppe…
  suite text,                                    -- code de la revanche
  raison text,                                   -- raison de fin
  version int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  activite_at timestamptz not null default now()
);
create index if not exists hg_plat_parties_statut on public.hg_plat_parties(jeu, statut, visibilite);
create unique index if not exists hg_plat_parties_code_actif on public.hg_plat_parties(code) where statut in ('attente', 'en_cours');
alter table public.hg_plat_parties enable row level security;

create table if not exists public.hg_plat_joueurs (
  partie uuid not null references public.hg_plat_parties(id) on delete cascade,
  user_id uuid not null,
  pseudo text not null,
  couleur text,
  avatar_url text,
  invite boolean not null default false,
  place int not null default 0,
  pret boolean not null default false,
  parti boolean not null default false,          -- a quitté la partie en cours (le jeu joue pour lui ou l'élimine selon le jeu)
  absent boolean not null default false,         -- trop de tours manqués : le jeu joue vite pour lui
  manques int not null default 0,
  elimine boolean not null default false,
  etat jsonb not null default '{}'::jsonb,       -- public (position, argent, PV…)
  prive jsonb not null default '{}'::jsonb,      -- secret du joueur (cartes, personnage, mission…)
  gagne boolean,
  rang int,
  paillettes int not null default 0,
  rejoint_at timestamptz not null default now(),
  primary key (partie, user_id)
);
create index if not exists hg_plat_joueurs_user on public.hg_plat_joueurs(user_id);
alter table public.hg_plat_joueurs enable row level security;

create table if not exists public.hg_plat_coups (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_plat_parties(id) on delete cascade,
  user_id uuid,
  pour uuid,                                     -- ligne privée (seulement ce joueur la voit) ; null : tout le monde
  type text not null,
  texte text not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_plat_coups_partie on public.hg_plat_coups(partie, id);
alter table public.hg_plat_coups enable row level security;

create table if not exists public.hg_plat_messages (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_plat_parties(id) on delete cascade,
  user_id uuid not null,
  texte text not null check (char_length(texte) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists hg_plat_messages_partie on public.hg_plat_messages(partie, id);
alter table public.hg_plat_messages enable row level security;

create table if not exists public.hg_plat_invites (
  user_id uuid primary key,
  partie uuid not null references public.hg_plat_parties(id) on delete cascade,
  pseudo text not null,
  jeton_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.hg_plat_invites enable row level security;

-- Contenus paramétrables : une ligne par liste ou texte d'un jeu (ex. cluedo / suspects).
create table if not exists public.hg_plat_contenus (
  jeu text not null,
  cle text not null,
  libelle text not null,                         -- titre affiché dans l'admin
  valeur jsonb not null,                         -- texte, ou liste d'objets {id, nom, …} (id fixe, le reste modifiable)
  defaut jsonb not null,                         -- valeur d'origine (bouton « Rétablir »)
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (jeu, cle)
);
alter table public.hg_plat_contenus enable row level security;

/* =====================================================================
   3. Accès et lecture (temps réel)
   ===================================================================== */

-- Page du site pour un jeu.
create or replace function public.hg_plat__page(p_jeu text)
returns text language sql immutable as $$
  select case p_jeu when 'shadow' then 'shadow-hunters' else p_jeu end
$$;

create or replace function public.hg_plat_peut(p_jeu text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), public.hg_plat__page(p_jeu))
    or exists (select 1 from hg_settings s where s.key = 'plateaux' and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text)
    or exists (select 1 from hg_plat_invites i join hg_plat_parties p on p.id = i.partie where i.user_id = auth.uid() and p.jeu = p_jeu))
$$;

create or replace function public.hg_plat_dans(p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_plat_joueurs where partie = p_partie and user_id = auth.uid())
$$;

drop policy if exists hg_plat_parties_read on public.hg_plat_parties;
create policy hg_plat_parties_read on public.hg_plat_parties for select to authenticated
  using (public.hg_plat_peut(jeu) and (public.hg_plat_dans(id) or (visibilite = 'publique' and statut = 'attente')));
drop policy if exists hg_plat_messages_read on public.hg_plat_messages;
create policy hg_plat_messages_read on public.hg_plat_messages for select to authenticated
  using (public.hg_plat_dans(partie));

revoke all on public.hg_plat_parties, public.hg_plat_joueurs, public.hg_plat_coups, public.hg_plat_messages,
  public.hg_plat_invites, public.hg_plat_contenus from anon, authenticated;
-- Les colonnes cachées (secret) ne sont pas lisibles en direct : seulement l'identifiant et la version servent au temps réel.
grant select (id, jeu, code, statut, visibilite, version, hote) on public.hg_plat_parties to authenticated;
grant select on public.hg_plat_messages to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hg_plat_parties', 'hg_plat_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

/* =====================================================================
   4. Outils internes
   ===================================================================== */

create or replace function public.hg_plat__partie(p_code text, p_lock boolean default false)
returns public.hg_plat_parties language plpgsql security definer set search_path = public as $$
declare v hg_plat_parties;
begin
  select * into v from hg_plat_parties where code = upper(trim(coalesce(p_code, '')))
  order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if found and p_lock then select * into v from hg_plat_parties where id = v.id for update; end if;
  if not found then raise exception 'Partie introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hg_plat__bump(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set version = version + 1, activite_at = now() where id = p_id
$$;

create or replace function public.hg_plat__nom(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from hg_plat_joueurs where partie = p_id and user_id = p_user), '?')
$$;

-- Ligne de journal ; p_pour : ligne privée pour un seul joueur.
create or replace function public.hg_plat__log(p_id uuid, p_user uuid, p_type text, p_texte text, p_pour uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into hg_plat_coups(partie, user_id, pour, type, texte) values (p_id, p_user, p_pour, p_type, p_texte)
$$;

-- Préfixe de code par jeu.
create or replace function public.hg_plat__prefixe(p_jeu text)
returns text language sql immutable as $$
  select case p_jeu when 'cluedo' then 'HGCLU-' when 'shadow' then 'HGSHH-' when 'destins' then 'HGDES-' when 'monopoly' then 'HGMON-' else 'HGRSK-' end
$$;

create or replace function public.hg_plat__code(p_jeu text)
returns text language plpgsql security definer set search_path = public as $$
declare v text; i int := 0;
begin
  loop
    v := hg_plat__prefixe(p_jeu) || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from hg_plat_parties where code = v and statut in ('attente', 'en_cours'));
    i := i + 1;
    if i > 50 then raise exception 'Impossible de générer un code, réessaie.'; end if;
  end loop;
  return v;
end $$;

-- Contenu paramétrable d'un jeu (valeur actuelle).
create or replace function public.hg_plat__c(p_jeu text, p_cle text)
returns jsonb language sql stable security definer set search_path = public as $$
  select valeur from hg_plat_contenus where jeu = p_jeu and cle = p_cle
$$;

-- Nom d'un élément {id, nom} d'une liste de contenu (ou l'id s'il manque).
create or replace function public.hg_plat__n(p_jeu text, p_cle text, p_id text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select x->>'nom' from jsonb_array_elements(hg_plat__c(p_jeu, p_cle)) x where x->>'id' = p_id limit 1), p_id)
$$;

-- Nom affiché du jeu.
create or replace function public.hg_plat__jeu_nom(p_jeu text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(hg_plat__c(p_jeu, 'nom') #>> '{}', case p_jeu when 'cluedo' then 'Cluedo' when 'shadow' then 'Shadow Hunters'
    when 'destins' then 'Destins' when 'monopoly' then 'Monopoly' else 'Risk' end)
$$;

-- Joueurs encore en jeu, dans l'ordre des places.
create or replace function public.hg_plat__actifs(p_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from hg_plat_joueurs where partie = p_id and not elimine order by place
$$;

-- Joueur suivant (dans l'ordre des places, en sautant les éliminés).
create or replace function public.hg_plat__suivant(p_id uuid, p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  with j as (select user_id, place from hg_plat_joueurs where partie = p_id and not elimine),
       m as (select place from hg_plat_joueurs where partie = p_id and user_id = p_user)
  select coalesce((select user_id from j where place > (select place from m) order by place limit 1),
                  (select user_id from j order by place limit 1))
$$;

-- Donne la main à un joueur (chrono plein, ou 5 s s'il est absent ou parti).
create or replace function public.hg_plat__donner_tour(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_vite boolean;
begin
  select absent or parti into v_vite from hg_plat_joueurs where partie = p_id and user_id = p_user;
  update hg_plat_parties set tour = p_user,
    tour_fin = case when p_user is null then null when coalesce(v_vite, false) then now() + interval '5 seconds' else now() + make_interval(secs => t_tour) end
  where id = p_id;
end $$;

-- Un joueur a joué lui-même : il n'est plus absent.
create or replace function public.hg_plat__present(p_id uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set manques = 0, absent = false where partie = p_id and user_id = p_user and (manques > 0 or absent)
$$;

-- Fin de partie : gagnants, classement (rangs donnés par le jeu dans etat->rang si fournis), Paillettes, badges.
create or replace function public.hg_plat__terminer(p_id uuid, p_gagnants uuid[], p_raison text default null, p_annulee boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; cfg jsonb; pts jsonb; r record; v_gain int; v_jour int; v_plafond int; v_n int;
  v_debut timestamptz := date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
begin
  select * into p from hg_plat_parties where id = p_id for update;
  if p.statut in ('terminee', 'annulee') then return; end if;
  cfg := coalesce((select value from hg_settings where key = 'plateaux'), '{}'::jsonb);
  pts := coalesce(cfg->'paillettes'->p.jeu, '{}'::jsonb);
  v_plafond := coalesce((cfg->>'plafond_jour')::int, 800);
  select count(*) into v_n from hg_plat_joueurs where partie = p_id;

  update hg_plat_joueurs set gagne = (user_id = any(coalesce(p_gagnants, '{}'))) where partie = p_id;
  update hg_plat_joueurs j set rang = coalesce(j.rang, case when j.gagne then 1 else 2 end) where partie = p_id;
  update hg_plat_parties set statut = case when p_annulee then 'annulee' else 'terminee' end, tour = null, tour_fin = null,
    raison = coalesce(p_raison, case when p_annulee then 'arret' end), ended_at = now(), version = version + 1 where id = p_id;
  perform hg_plat__log(p_id, null, 'fin', case when p_annulee then 'La partie a été arrêtée.'
    when coalesce(cardinality(p_gagnants), 0) = 0 then 'Partie terminée.'
    else (select string_agg(pseudo, ', ' order by place) from hg_plat_joueurs where partie = p_id and user_id = any(p_gagnants))
         || case when cardinality(p_gagnants) > 1 then ' gagnent la partie !' else ' gagne la partie !' end end);

  if p_annulee or v_n < 2 or p.started_at is null or now() - p.started_at < interval '3 minutes' then return; end if;

  for r in select x.* from hg_plat_joueurs x where x.partie = p_id and not x.invite and not x.parti
           and exists (select 1 from hg_profiles pr where pr.id = x.user_id and not pr.is_ghost) loop
    v_gain := coalesce((pts->>'partie')::int, 30) + case when r.gagne then coalesce((pts->>'victoire')::int, 80) else 0 end;
    select coalesce(sum(delta), 0) into v_jour from hg_wallet_log where user_id = r.user_id and reason = 'plateaux' and created_at >= v_debut;
    v_gain := greatest(0, least(v_gain, v_plafond - v_jour));
    if v_gain > 0 and hg_wallet_add(r.user_id, v_gain, 'plateaux', 'plat:' || p_id || ':' || r.user_id) then
      update hg_plat_joueurs set paillettes = v_gain where partie = p_id and user_id = r.user_id;
    end if;
  end loop;
  if to_regprocedure(format('public.hg_plat__%s_badges(uuid)', p.jeu)) is not null then
    execute format('select public.hg_plat__%s_badges($1)', p.jeu) using p_id;
  end if;
end $$;

-- Badge si actif (réglage badges_inactifs).
create or replace function public.hg_plat__badge(p_user uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select value->'badges_inactifs' from hg_settings where key = 'plateaux'), '[]'::jsonb) ? p_code then return; end if;
  if not exists (select 1 from hg_profiles where id = p_user and not is_ghost) then return; end if;
  insert into hg_user_badges(user_id, badge_code) values (p_user, p_code) on conflict do nothing;
end $$;

-- Échéance dépassée : le jeu joue pour le joueur attendu (3 fois de suite → absent, il joue alors vite).
create or replace function public.hg_plat__echeances(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; n int := 0; v_ok boolean; v_dernier uuid;
begin
  loop
    select * into p from hg_plat_parties where id = p_id for update;
    exit when p.statut <> 'en_cours' or p.tour_fin is null or now() < p.tour_fin or n >= 30;
    -- Un tour manqué compte une seule fois, même si le jeu joue plusieurs étapes pour ce joueur.
    if p.tour is not null and p.tour is distinct from v_dernier then
      v_dernier := p.tour;
      update hg_plat_joueurs set manques = manques + 1, absent = absent or manques + 1 >= 3 where partie = p_id and user_id = p.tour;
    end if;
    execute format('select public.hg_plat__%s_auto($1)', p.jeu) into v_ok using p_id;
    n := n + 1;
    if not coalesce(v_ok, false) then
      -- Le jeu n'a rien pu jouer : on passe la main pour ne jamais bloquer.
      update hg_plat_parties set tour_fin = now() + make_interval(secs => t_tour) where id = p_id;
      exit;
    end if;
  end loop;
  if n > 0 then perform hg_plat__bump(p_id); end if;
  return n > 0;
end $$;

-- Appelée chaque minute par pg_cron.
create or replace function public.hg_plat_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from hg_plat_parties where statut = 'en_cours' and tour_fin < now() loop
    if hg_plat__echeances(r.id) then n := n + 1; end if;
  end loop;
  update hg_plat_parties set statut = 'annulee', version = version + 1 where statut = 'attente' and activite_at < now() - interval '6 hours';
  for r in select id from hg_plat_parties where statut = 'en_cours' and activite_at < now() - interval '6 hours' loop
    perform hg_plat__terminer(r.id, null, 'abandon', true);
  end loop;
  return n;
end $$;

/* =====================================================================
   5. Salle d'attente
   ===================================================================== */

create or replace function public.hg_plat__identite(p_pseudo text)
returns table(pseudo text, couleur text, avatar_url text, invite boolean) language plpgsql stable security definer set search_path = public as $$
declare pr hg_profiles;
begin
  select * into pr from hg_profiles where id = auth.uid() and not is_ghost;
  if found then return query select pr.pseudo, pr.color, pr.avatar_url, false; return; end if;
  if p_pseudo is null or char_length(trim(p_pseudo)) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
  return query select trim(p_pseudo), null::text, null::text, true;
end $$;

create or replace function public.hg_plat__entrer(p_id uuid, p_pseudo text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; i record; v_n int;
begin
  select * into p from hg_plat_parties where id = p_id;
  select count(*) into v_n from hg_plat_joueurs where partie = p_id;
  if v_n >= p.nb_places then raise exception 'La partie est complète (% places).', p.nb_places; end if;
  for i in select * from hg_plat__identite(p_pseudo) loop
    if i.invite and not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if exists (select 1 from hg_plat_joueurs where partie = p_id and lower(pseudo) = lower(i.pseudo)) then
      raise exception 'Le pseudo « % » est déjà pris dans cette partie.', i.pseudo;
    end if;
    insert into hg_plat_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite, place, pret)
    values (p_id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite,
            coalesce((select max(place) from hg_plat_joueurs where partie = p_id), 0) + 1, auth.uid() = p.hote);
    perform hg_plat__log(p_id, auth.uid(), 'info', i.pseudo || ' rejoint la partie.');
  end loop;
end $$;

-- Limites de joueurs d'un jeu.
create or replace function public.hg_plat__limites(p_jeu text, out mini int, out maxi int)
language sql immutable as $$
  select case p_jeu when 'cluedo' then 3 when 'shadow' then 4 else 2 end,
         case p_jeu when 'cluedo' then 6 when 'shadow' then 8 when 'destins' then 6 when 'monopoly' then 6 else 6 end
$$;

create or replace function public.hg_plat_creer(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_jeu text := p->>'jeu'; v_code text; v_id uuid; v_nb int; v_t int; v_opt jsonb; l record;
begin
  if v_jeu is null or v_jeu not in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk') then raise exception 'Jeu inconnu.'; end if;
  if not hg_plat_peut(v_jeu) or exists (select 1 from hg_plat_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  select * into l from hg_plat__limites(v_jeu);
  v_nb := coalesce((p->>'nb_places')::int, l.maxi);
  if v_nb < l.mini or v_nb > l.maxi then raise exception 'Le nombre de places doit être entre % et %.', l.mini, l.maxi; end if;
  v_t := coalesce((p->>'t_tour')::int, 60);
  if v_t not in (30, 60, 90, 120) then raise exception 'Durée d''un tour invalide.'; end if;
  execute format('select public.hg_plat__%s_options($1)', v_jeu) into v_opt using coalesce(p->'options', '{}'::jsonb);
  v_code := hg_plat__code(v_jeu);
  insert into hg_plat_parties(jeu, code, nom, hote, visibilite, nb_places, invites, t_tour, options, annonce_discord)
  values (v_jeu, v_code, left(coalesce(nullif(trim(p->>'nom'), ''), 'Partie de ' || hg_plat__jeu_nom(v_jeu)), 60), auth.uid(),
          case when p->>'visibilite' = 'publique' then 'publique' else 'privee' end, v_nb,
          coalesce((p->>'invites')::boolean, true), v_t, coalesce(v_opt, '{}'::jsonb), coalesce((p->>'annonce_discord')::boolean, false))
  returning id into v_id;
  perform hg_plat__entrer(v_id, null);
  return v_code;
end $$;

create or replace function public.hg_plat_rejoindre(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties;
begin
  p := hg_plat__partie(p_code, true);
  if not hg_plat_peut(p.jeu) then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  if hg_plat_dans(p.id) then return p.code; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  perform hg_plat__entrer(p.id, null);
  perform hg_plat__bump(p.id);
  return p.code;
end $$;

create or replace function public.hg_plat_quitter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_nouvel uuid; v_restants int;
begin
  p := hg_plat__partie(p_code, true);
  if not hg_plat_dans(p.id) then return; end if;
  if p.statut = 'attente' then
    delete from hg_plat_joueurs where partie = p.id and user_id = auth.uid();
    perform hg_plat__log(p.id, auth.uid(), 'info', 'Un joueur quitte la salle.');
    if p.hote = auth.uid() then
      select user_id into v_nouvel from hg_plat_joueurs where partie = p.id and not invite order by place limit 1;
      if v_nouvel is null then update hg_plat_parties set statut = 'annulee' where id = p.id;
      else
        update hg_plat_parties set hote = v_nouvel where id = p.id;
        update hg_plat_joueurs set pret = true where partie = p.id and user_id = v_nouvel;
        perform hg_plat__log(p.id, v_nouvel, 'info', hg_plat__nom(p.id, v_nouvel) || ' devient l''hôte.');
      end if;
    end if;
  elsif p.statut = 'en_cours' then
    -- Le joueur reste dans la partie mais le jeu joue pour lui, vite (ses cartes et ses biens restent en jeu).
    update hg_plat_joueurs set parti = true, absent = true where partie = p.id and user_id = auth.uid();
    perform hg_plat__log(p.id, auth.uid(), 'info', hg_plat__nom(p.id, auth.uid()) || ' quitte la partie : le jeu jouera pour lui.');
    select count(*) into v_restants from hg_plat_joueurs where partie = p.id and not parti and not elimine;
    if v_restants = 0 then perform hg_plat__terminer(p.id, null, 'abandon', true);
    elsif p.tour = auth.uid() then update hg_plat_parties set tour_fin = least(tour_fin, now() + interval '5 seconds') where id = p.id;
    end if;
  end if;
  perform hg_plat__bump(p.id);
end $$;

create or replace function public.hg_plat_pret(p_code text, p_pret boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties;
begin
  p := hg_plat__partie(p_code, true);
  if p.statut <> 'attente' or not hg_plat_dans(p.id) then raise exception 'Action impossible.'; end if;
  update hg_plat_joueurs set pret = coalesce(p_pret, true) or user_id = p.hote where partie = p.id and user_id = auth.uid();
  perform hg_plat__bump(p.id);
end $$;

create or replace function public.hg_plat_exclure(p_code text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties;
begin
  p := hg_plat__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut retirer un joueur.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if p_user = p.hote then raise exception 'L''hôte ne peut pas se retirer lui-même.'; end if;
  perform hg_plat__log(p.id, p_user, 'info', hg_plat__nom(p.id, p_user) || ' est retiré de la salle.');
  delete from hg_plat_joueurs where partie = p.id and user_id = p_user;
  perform hg_plat__bump(p.id);
end $$;

create or replace function public.hg_plat_lancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_n int; l record;
begin
  p := hg_plat__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut lancer la partie.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  select * into l from hg_plat__limites(p.jeu);
  select count(*) into v_n from hg_plat_joueurs where partie = p.id;
  if v_n < l.mini then raise exception 'Il faut au moins % joueurs.', l.mini; end if;
  if exists (select 1 from hg_plat_joueurs where partie = p.id and not pret) then raise exception 'Tous les joueurs doivent être prêts.'; end if;
  -- Places tirées au hasard.
  with m as (select user_id, row_number() over (order by random()) rn from hg_plat_joueurs where partie = p.id)
  update hg_plat_joueurs j set place = m.rn::int from m where j.partie = p.id and j.user_id = m.user_id;
  update hg_plat_parties set statut = 'en_cours', started_at = now() where id = p.id;
  execute format('select public.hg_plat__%s_lancer($1)', p.jeu) using p.id;
  perform hg_plat__bump(p.id);
end $$;

/* =====================================================================
   6. Le jeu
   ===================================================================== */

-- Une action de jeu : vérifie que l'on joue, applique d'abord une échéance dépassée, puis délègue au jeu.
create or replace function public.hg_plat_agir(p_code text, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v jsonb;
begin
  p := hg_plat__partie(p_code, true);
  if not hg_plat_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  if p.statut <> 'en_cours' then raise exception 'La partie n''est pas en cours.'; end if;
  if (select elimine from hg_plat_joueurs where partie = p.id and user_id = auth.uid()) and p_action not in ('montrer', 'rien') then
    raise exception 'Tu es éliminé de cette partie.';
  end if;
  if p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_plat__echeances(p.id);
    select * into p from hg_plat_parties where id = p.id;
    if p.statut <> 'en_cours' then raise exception 'La partie est terminée.'; end if;
  end if;
  if coalesce(trim(p_action), '') !~ '^[a-z_]{2,30}$' then raise exception 'Action inconnue.'; end if;
  update hg_plat_joueurs set parti = false where partie = p.id and user_id = auth.uid() and parti;
  execute format('select public.hg_plat__%s_agir($1, $2, $3, $4)', p.jeu) into v using p.id, auth.uid(), p_action, coalesce(p_args, '{}'::jsonb);
  perform hg_plat__present(p.id, auth.uid());
  perform hg_plat__bump(p.id);
  return v;
end $$;

create or replace function public.hg_plat_avancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties;
begin
  p := hg_plat__partie(p_code, true);
  if not hg_plat_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  perform hg_plat__echeances(p.id);
end $$;

create or replace function public.hg_plat_message(p_code text, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; t text;
begin
  p := hg_plat__partie(p_code);
  if not hg_plat_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  t := left(trim(coalesce(p_texte, '')), 300);
  if t = '' then raise exception 'Message vide.'; end if;
  if (select count(*) from hg_plat_messages where partie = p.id and user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Doucement : attends quelques secondes avant d''écrire.';
  end if;
  insert into hg_plat_messages(partie, user_id, texte) values (p.id, auth.uid(), t);
end $$;

create or replace function public.hg_plat_messages(p_partie uuid, p_apres bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_plat_dans(p_partie) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'pseudo', hg_plat__nom(p_partie, m.user_id),
      'texte', m.texte, 'created_at', m.created_at) order by m.id)
    from (select * from hg_plat_messages where partie = p_partie and id > coalesce(p_apres, 0) order by id desc limit 200) m), '[]'::jsonb);
end $$;

-- Revanche : nouvelle salle aux mêmes réglages ; celui qui la lance en est l'hôte.
create or replace function public.hg_plat_rejouer(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_code text; v_id uuid;
begin
  p := hg_plat__partie(p_code, true);
  if not hg_plat_dans(p.id) or exists (select 1 from hg_plat_invites where user_id = auth.uid()) then
    raise exception 'Seul un membre de la partie peut lancer la revanche.';
  end if;
  if p.statut not in ('terminee', 'annulee') then raise exception 'La partie n''est pas finie.'; end if;
  if p.suite is not null then return p.suite; end if;
  v_code := hg_plat__code(p.jeu);
  insert into hg_plat_parties(jeu, code, nom, hote, visibilite, nb_places, invites, t_tour, options, annonce_discord)
  values (p.jeu, v_code, p.nom, auth.uid(), p.visibilite, p.nb_places, p.invites, p.t_tour, p.options, false)
  returning id into v_id;
  perform hg_plat__entrer(v_id, null);
  update hg_plat_parties set suite = v_code, version = version + 1 where id = p.id;
  return v_code;
end $$;

/* =====================================================================
   7. Lecture
   ===================================================================== */

create or replace function public.hg_plat_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; v_moi uuid := auth.uid(); v_joue boolean; v_jeu jsonb := null;
begin
  p := hg_plat__partie(p_code);
  v_joue := hg_plat_dans(p.id);
  if not v_joue and not (p.visibilite = 'publique' and p.statut = 'attente' and hg_plat_peut(p.jeu)) then
    raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501';
  end if;
  if p.statut = 'en_cours' and v_joue and p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_plat__echeances(p.id);
    select * into p from hg_plat_parties where id = p.id;
  end if;
  if p.statut <> 'attente' then
    execute format('select public.hg_plat__%s_vue($1, $2)', p.jeu) into v_jeu using p.id, v_moi;
  end if;
  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'jeu', p.jeu, 'nom_jeu', hg_plat__jeu_nom(p.jeu), 'code', p.code, 'nom', p.nom,
      'statut', p.statut, 'hote', p.hote, 'visibilite', p.visibilite, 'invites', p.invites, 'nb_places', p.nb_places,
      't_tour', p.t_tour, 'options', p.options, 'tour', p.tour, 'tour_fin', p.tour_fin, 'nb_tours', p.nb_tours,
      'suite', p.suite, 'raison', p.raison, 'version', p.version, 'started_at', p.started_at, 'ended_at', p.ended_at),
    'maintenant', now(),
    'moi', jsonb_build_object('user_id', v_moi, 'joue', v_joue, 'hote', p.hote = v_moi,
      'invite', exists (select 1 from hg_plat_invites where user_id = v_moi)),
    'joueurs', coalesce((select jsonb_agg(jsonb_build_object('user_id', j.user_id, 'pseudo', j.pseudo, 'couleur', j.couleur,
        'avatar_url', j.avatar_url, 'invite', j.invite, 'place', j.place, 'pret', j.pret, 'parti', j.parti, 'absent', j.absent,
        'elimine', j.elimine, 'etat', j.etat, 'gagne', j.gagne, 'rang', j.rang, 'paillettes', j.paillettes) order by j.place)
      from hg_plat_joueurs j where j.partie = p.id), '[]'::jsonb),
    'jeu', v_jeu,
    'journal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'type', x.type, 'texte', x.texte,
        'prive', x.pour is not null, 'created_at', x.created_at) order by x.id desc)
      from (select * from hg_plat_coups where partie = p.id and (pour is null or pour = v_moi) order by id desc limit 25) x), '[]'::jsonb),
    'badges', case when p.statut = 'terminee' and v_joue then coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name))
        from hg_user_badges ub join hg_badges b on b.code = ub.badge_code
        where ub.user_id = v_moi and b.code like 'plat\_' || p.jeu || '\_%' and ub.awarded_at >= coalesce(p.ended_at, now()) - interval '5 seconds'), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

-- Contenus d'un jeu pour l'affichage (noms, couleurs) : {cle: valeur}.
create or replace function public.hg_plat_contenus(p_jeu text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) from hg_plat_contenus where jeu = p_jeu
$$;

create or replace function public.hg_plat_publiques(p_jeu text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_plat_peut(p_jeu) then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_plat__nom(p.id, p.hote),
      'hote_couleur', (select couleur from hg_plat_joueurs where partie = p.id and user_id = p.hote),
      'inscrits', (select count(*) from hg_plat_joueurs where partie = p.id), 'nb_places', p.nb_places, 't_tour', p.t_tour) order by p.created_at desc)
    from hg_plat_parties p where p.jeu = p_jeu and p.statut = 'attente' and p.visibilite = 'publique'), '[]'::jsonb);
end $$;

create or replace function public.hg_plat_mes_parties(p_jeu text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_plat_peut(p_jeu) then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'statut', p.statut,
      'inscrits', (select count(*) from hg_plat_joueurs where partie = p.id), 'mon_tour', p.tour = auth.uid(),
      'tour_pseudo', case when p.tour is null then null else hg_plat__nom(p.id, p.tour) end) order by p.created_at desc)
    from hg_plat_parties p join hg_plat_joueurs j on j.partie = p.id and j.user_id = auth.uid()
    where p.jeu = p_jeu and p.statut in ('attente', 'en_cours')), '[]'::jsonb);
end $$;

create or replace function public.hg_plat_stats(p_jeu text, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_u uuid := coalesce(p_user, auth.uid());
begin
  if not hg_plat_peut(p_jeu) then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'parties', (select count(*) from hg_plat_joueurs j join hg_plat_parties p on p.id = j.partie where j.user_id = v_u and p.jeu = p_jeu and p.statut = 'terminee'),
    'victoires', (select count(*) from hg_plat_joueurs j join hg_plat_parties p on p.id = j.partie where j.user_id = v_u and p.jeu = p_jeu and p.statut = 'terminee' and j.gagne),
    'paillettes', (select coalesce(sum(j.paillettes), 0) from hg_plat_joueurs j join hg_plat_parties p on p.id = j.partie where j.user_id = v_u and p.jeu = p_jeu),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'obtenu', ub.user_id is not null, 'date', ub.awarded_at) order by b.sort)
      from hg_badges b left join hg_user_badges ub on ub.badge_code = b.code and ub.user_id = v_u where b.code like 'plat\_' || p_jeu || '\_%'), '[]'::jsonb),
    'dernieres', coalesce((select jsonb_agg(x order by (x->>'date') desc) from (
        select jsonb_build_object('code', p.code, 'nom', p.nom, 'date', p.ended_at, 'joueurs', (select count(*) from hg_plat_joueurs j2 where j2.partie = p.id),
          'gagne', j.gagne, 'rang', j.rang, 'paillettes', j.paillettes) x
        from hg_plat_joueurs j join hg_plat_parties p on p.id = j.partie
        where j.user_id = v_u and p.jeu = p_jeu and p.statut = 'terminee' order by p.ended_at desc limit 8) s), '[]'::jsonb)
  );
end $$;

/* =====================================================================
   8. Administration
   ===================================================================== */

create or replace function public.hg_plat_admin_reglages(p_jeu text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'plateaux'), '{}'::jsonb);
  return jsonb_build_object(
    'paillettes', coalesce(cfg->'paillettes'->p_jeu, '{}'::jsonb),
    'plafond_jour', coalesce((cfg->>'plafond_jour')::int, 800),
    'contenus', coalesce((select jsonb_agg(jsonb_build_object('cle', c.cle, 'libelle', c.libelle, 'valeur', c.valeur, 'defaut', c.defaut,
        'modifie', c.valeur <> c.defaut) order by c.sort) from hg_plat_contenus c where c.jeu = p_jeu), '[]'::jsonb),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'actif', not coalesce(cfg->'badges_inactifs', '[]'::jsonb) ? b.code,
        'membres', (select count(*) from hg_user_badges u where u.badge_code = b.code)) order by b.sort)
      from hg_badges b where b.code like 'plat\_' || p_jeu || '\_%'), '[]'::jsonb),
    'parties', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_plat__nom(p.id, p.hote),
        'joueurs', (select count(*) from hg_plat_joueurs where partie = p.id), 'statut', p.statut,
        'tour_pseudo', case when p.tour is null then null else hg_plat__nom(p.id, p.tour) end,
        'started_at', coalesce(p.started_at, p.created_at)) order by p.created_at desc)
      from hg_plat_parties p where p.jeu = p_jeu and p.statut in ('attente', 'en_cours')), '[]'::jsonb),
    'terminees', (select count(*) from hg_plat_parties where jeu = p_jeu and statut = 'terminee')
  );
end $$;

create or replace function public.hg_plat_admin_enregistrer(p_jeu text, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  if p_jeu not in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk') then raise exception 'Jeu inconnu.'; end if;
  cfg := coalesce((select value from hg_settings where key = 'plateaux'), '{}'::jsonb);
  cfg := jsonb_set(cfg, array['paillettes', p_jeu], jsonb_build_object(
    'partie', least(greatest(coalesce((p->'paillettes'->>'partie')::int, 30), 0), 1000),
    'victoire', least(greatest(coalesce((p->'paillettes'->>'victoire')::int, 80), 0), 1000)), true);
  if p ? 'plafond_jour' then cfg := cfg || jsonb_build_object('plafond_jour', least(greatest((p->>'plafond_jour')::int, 0), 100000)); end if;
  if p ? 'badges_inactifs' then
    cfg := cfg || jsonb_build_object('badges_inactifs', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select x from jsonb_array_elements_text(coalesce(cfg->'badges_inactifs', '[]'::jsonb)) x where x not like 'plat\_' || p_jeu || '\_%'
      union select x from jsonb_array_elements_text(p->'badges_inactifs') x where x like 'plat\_' || p_jeu || '\_%') s));
  end if;
  insert into hg_settings(key, value) values ('plateaux', cfg) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'plateaux_reglages', p_jeu, p);
end $$;

-- Modifie un contenu (ou le rétablit si p_valeur est null). Les listes gardent leurs identifiants et leur nombre d'éléments ;
-- seuls les champs texte affichés (nom, texte, description, couleur, victoire, pouvoir, libelle, court) changent ;
-- les nombres et les champs de règles (prix, salaire, effet…) restent ceux du défaut.
create or replace function public.hg_plat_admin_contenu(p_jeu text, p_cle text, p_valeur jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c hg_plat_contenus; v jsonb; i int; d jsonb; n jsonb; k text;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  select * into c from hg_plat_contenus where jeu = p_jeu and cle = p_cle for update;
  if not found then raise exception 'Contenu inconnu.'; end if;
  if p_valeur is null then v := c.defaut;
  elsif jsonb_typeof(c.defaut) = 'string' then
    if jsonb_typeof(p_valeur) <> 'string' or char_length(trim(p_valeur #>> '{}')) not between 1 and 300 then raise exception 'Texte invalide (1 à 300 caractères).'; end if;
    v := to_jsonb(trim(p_valeur #>> '{}'));
  elsif jsonb_typeof(c.defaut) = 'array' then
    if jsonb_typeof(p_valeur) <> 'array' or jsonb_array_length(p_valeur) <> jsonb_array_length(c.defaut) then
      raise exception 'La liste doit garder ses % éléments.', jsonb_array_length(c.defaut);
    end if;
    v := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(c.defaut) - 1 loop
      d := c.defaut->i;
      n := (select x from jsonb_array_elements(p_valeur) x where x->>'id' = d->>'id' limit 1);
      if n is null then raise exception 'Élément manquant : %.', d->>'id'; end if;
      for k in select jsonb_object_keys(d) loop
        -- Seuls les textes affichés changent ; les champs de règles (effet, type…) restent ceux d'origine.
        continue when k not in ('nom', 'texte', 'description', 'couleur', 'victoire', 'pouvoir', 'libelle', 'court') or jsonb_typeof(d->k) <> 'string' or not (n ? k);
        if jsonb_typeof(n->k) <> 'string' or char_length(trim(n->>k)) not between 1 and 300 then raise exception 'Texte invalide pour %.', d->>'id'; end if;
        if k = 'couleur' and n->>k !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur invalide pour %.', d->>'id'; end if;
        d := jsonb_set(d, array[k], to_jsonb(trim(n->>k)));
      end loop;
      v := v || jsonb_build_array(d);
    end loop;
  else
    raise exception 'Contenu non modifiable.';
  end if;
  update hg_plat_contenus set valeur = v, updated_at = now() where jeu = p_jeu and cle = p_cle;
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'plateaux_contenu', p_jeu || '/' || p_cle, jsonb_build_object('retabli', p_valeur is null));
  return v;
end $$;

create or replace function public.hg_plat_admin_arreter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  p := hg_plat__partie(p_code, true);
  if p.statut = 'attente' then update hg_plat_parties set statut = 'annulee', version = version + 1 where id = p.id;
  elsif p.statut = 'en_cours' then perform hg_plat__terminer(p.id, null, 'arret', true);
  end if;
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'plateaux_arreter', p.code, '{}'::jsonb);
end $$;

/* =====================================================================
   9. Invités (sans compte)
   ===================================================================== */

create or replace function public.hg_plat__devenir(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function public.hg_plat_invite(p_action text, p_code text, p_jeton text default null, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; inv hg_plat_invites; v_uid uuid; v_jeton text; v_pseudo text; v_out jsonb;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  select * into p from hg_plat_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';
  end if;
  if p_action = 'apercu' then
    return jsonb_build_object('jeu', p.jeu, 'nom_jeu', hg_plat__jeu_nom(p.jeu), 'nom', p.nom, 'code', p.code, 'statut', p.statut, 'invites', p.invites,
      'nb_places', p.nb_places, 'inscrits', (select count(*) from hg_plat_joueurs where partie = p.id), 'hote_pseudo', hg_plat__nom(p.id, p.hote), 't_tour', p.t_tour);
  end if;
  if p_action = 'contenus' then return hg_plat_contenus(p.jeu); end if;
  if p_action = 'rejoindre' then
    if not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
    v_pseudo := trim(coalesce(p_args->>'pseudo', ''));
    if char_length(v_pseudo) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
    v_uid := gen_random_uuid();
    v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into hg_plat_invites(user_id, partie, pseudo, jeton_hash) values (v_uid, p.id, v_pseudo, encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'));
    perform hg_plat__devenir(v_uid);
    perform hg_plat__entrer(p.id, v_pseudo);
    perform hg_plat__bump(p.id);
    return jsonb_build_object('jeton', v_jeton, 'code', p.code, 'user_id', v_uid);
  end if;
  select * into inv from hg_plat_invites where jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if not found or inv.partie <> p.id then raise exception 'Invitation expirée : rejoins à nouveau la partie.' using errcode = '42501'; end if;
  perform hg_plat__devenir(inv.user_id);
  case p_action
    when 'etat' then v_out := hg_plat_etat(p.code);
    when 'pret' then perform hg_plat_pret(p.code, coalesce((p_args->>'pret')::boolean, true));
    when 'quitter' then perform hg_plat_quitter(p.code);
    when 'agir' then v_out := hg_plat_agir(p.code, p_args->>'action', coalesce(p_args->'args', '{}'::jsonb));
    when 'message' then perform hg_plat_message(p.code, p_args->>'texte');
    when 'avancer' then perform hg_plat_avancer(p.code);
    when 'messages' then v_out := hg_plat_messages(p.id, coalesce((p_args->>'apres')::bigint, 0));
    else raise exception 'Action inconnue.';
  end case;
  return v_out;
end $$;

/* =====================================================================
   10. Droits d'exécution et tâche planifiée (à relancer après chaque migration de jeu : voir hg_plat__droits)
   ===================================================================== */

create or replace function public.hg_plat__droits()
returns void language plpgsql security definer set search_path = public as $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hg\_plat%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'hg\_plat\_\_%' and f.proname <> 'hg_plat_tick' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  execute 'grant execute on function public.hg_plat_invite(text, text, text, jsonb) to anon, authenticated';
  execute 'grant execute on function public.hg_plat_contenus(text) to anon, authenticated';
end $$;
select public.hg_plat__droits();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hg-plat-tick') then perform cron.unschedule('hg-plat-tick'); end if;
    perform cron.schedule('hg-plat-tick', '* * * * *', 'select public.hg_plat_tick()');
  end if;
end $$;
