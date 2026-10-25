-- ===== Humane Gang — migration 121 : Uno (tables, moteur, invités, récompenses) =====
-- Tout le jeu est côté serveur : le paquet, les mains, les règles, le tour, les pénalités.
-- Le client n'envoie que des intentions (hg_uno_jouer, hg_uno_piocher…) et relit son état personnalisé (hg_uno_etat).
-- Personne ne lit la main d'un autre : les cartes ne sont jamais lisibles directement (fonctions seulement).
-- Règles : officielles (108 cartes, 2 paquets dès 11 joueurs, 7 cartes chacun, Joker +4 contestable, UNO contrable),
--   variantes au choix : cumul des +2/+4, pioche jusqu'à jouer, sept-zéro, interception ; manche simple ou partie en 500 points.
-- Fonctions publiques (authenticated) : hg_uno_creer, hg_uno_rejoindre, hg_uno_quitter, hg_uno_pret, hg_uno_exclure,
--   hg_uno_lancer, hg_uno_jouer, hg_uno_piocher, hg_uno_passer, hg_uno_uno, hg_uno_contrer, hg_uno_contester,
--   hg_uno_message, hg_uno_messages, hg_uno_avancer, hg_uno_rejouer, hg_uno_etat, hg_uno_publiques, hg_uno_mes_parties,
--   hg_uno_stats, hg_uno_admin_reglages, hg_uno_admin_enregistrer, hg_uno_admin_arreter.
-- Invités (anon) : hg_uno_invite(action, code, jeton, args). Fonctions internes : hg_uno__* (non exécutables par les clients).
-- Accès : page « uno » (mode admin au lancement), testeurs listés dans hg_settings.uno.testeurs, invités d'une partie.

/* =====================================================================
   1. Réglages, page, badges
   ===================================================================== */

insert into public.hg_settings(key, value) values ('uno', jsonb_build_object(
  'paillettes', jsonb_build_object('partie', 50, 'victoire', 150, 'bonus_adversaire', 10),
  'plafond_jour', 1000,
  'min_joueurs', 2,
  'badges_inactifs', '[]'::jsonb,
  'testeurs', '[]'::jsonb
)) on conflict (key) do nothing;

insert into public.hg_pages(slug, label, mode, in_nav, sort)
values ('uno', 'Uno', 'admin', false, 15)
on conflict (slug) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('uno_premiere_victoire', 'Première victoire', 'Gagner une partie de Uno.', 950),
  ('uno_main_pleine', 'Main pleine', 'Finir une partie de Uno après avoir eu 20 cartes ou plus en main.', 951),
  ('uno_arroseur_arrose', 'Arroseur arrosé', 'Gagner un défi de Joker +4 au Uno.', 952),
  ('uno_jamais_sans', 'Jamais sans mon UNO', 'Finir 20 parties de Uno sans jamais oublier de dire UNO.', 953),
  ('uno_grande_table', 'La grande table', 'Gagner une partie de Uno à 10 joueurs ou plus.', 954),
  ('uno_habitue', 'Habitué', 'Jouer 50 parties de Uno.', 955)
on conflict (code) do nothing;

/* =====================================================================
   2. Tables
   ===================================================================== */

create table if not exists public.hg_uno_parties (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^HGUNO-[0-9]{4}$'),
  nom text not null check (char_length(nom) between 1 and 60),
  hote uuid not null,
  visibilite text not null default 'privee' check (visibilite in ('privee', 'publique')),
  nb_places int not null check (nb_places between 2 and 20),
  invites boolean not null default true,
  t_tour int not null default 30 check (t_tour in (15, 30, 60)),
  mode text not null default 'manche' check (mode in ('manche', 'points')),
  variantes jsonb not null default '{}'::jsonb,         -- {cumul, pioche_jusqu, sept_zero, interception}
  annonce_discord boolean not null default false,
  discord_annonce_at timestamptz,
  statut text not null default 'attente' check (statut in ('attente', 'en_cours', 'terminee', 'annulee')),
  manche int not null default 0,
  sens int not null default 1 check (sens in (1, -1)),
  couleur text check (couleur in ('r', 'y', 'g', 'b')),  -- couleur demandée
  tour uuid,                                             -- joueur dont c'est le tour
  tour_fin timestamptz,
  cumul int not null default 0,                          -- cartes à piocher en attente (variante cumul)
  a_pioche boolean not null default false,               -- le joueur du tour a pioché une carte jouable
  pioche_carte bigint,                                   -- la carte qu'il vient de piocher
  uno_attente uuid,                                      -- joueur à une carte qui n'a pas dit UNO (contrable)
  defi jsonb,                                            -- Joker +4 en attente de réponse : {poseur, cible, legal}
  vainqueur uuid,
  etat jsonb not null default '{}'::jsonb,               -- suite (revanche), divers
  version int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  activite_at timestamptz not null default now()
);
create index if not exists hg_uno_parties_statut on public.hg_uno_parties(statut, visibilite);
create index if not exists hg_uno_parties_code on public.hg_uno_parties(code, created_at desc);
create unique index if not exists hg_uno_parties_code_actif on public.hg_uno_parties(code) where statut in ('attente', 'en_cours');
alter table public.hg_uno_parties enable row level security;

create table if not exists public.hg_uno_joueurs (
  partie uuid not null references public.hg_uno_parties(id) on delete cascade,
  user_id uuid not null,
  pseudo text not null,
  couleur text,
  avatar_url text,
  invite boolean not null default false,
  place int not null default 0,
  pret boolean not null default false,
  nb_cartes int not null default 0,
  max_cartes int not null default 0,
  uno boolean not null default false,
  exclu boolean not null default false,
  manques int not null default 0,          -- tours joués par le robot d'affilée
  points int not null default 0,           -- partie en 500 points : cumul
  main_points int,                         -- points restant en main à la fin
  rang int,
  gagne boolean,
  paillettes int not null default 0,
  cartes_jouees int not null default 0,
  oublis_uno int not null default 0,
  defis_gagnes int not null default 0,
  rejoint_at timestamptz not null default now(),
  primary key (partie, user_id)
);
create index if not exists hg_uno_joueurs_user on public.hg_uno_joueurs(user_id);
alter table public.hg_uno_joueurs enable row level security;

create table if not exists public.hg_uno_cartes (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_uno_parties(id) on delete cascade,
  couleur text not null check (couleur in ('r', 'y', 'g', 'b', 'k')),
  valeur text not null check (valeur in ('0','1','2','3','4','5','6','7','8','9','+2','inv','passe','joker','+4')),
  lieu text not null check (lieu in ('pioche', 'defausse', 'main')),
  user_id uuid,
  ordre int not null default 0
);
create index if not exists hg_uno_cartes_lieu on public.hg_uno_cartes(partie, lieu, ordre);
create index if not exists hg_uno_cartes_main on public.hg_uno_cartes(partie, user_id) where lieu = 'main';
alter table public.hg_uno_cartes enable row level security;

create table if not exists public.hg_uno_coups (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_uno_parties(id) on delete cascade,
  manche int not null default 0,
  user_id uuid,
  type text not null,
  texte text not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_uno_coups_partie on public.hg_uno_coups(partie, id);
alter table public.hg_uno_coups enable row level security;

create table if not exists public.hg_uno_messages (
  id bigint generated always as identity primary key,
  partie uuid not null references public.hg_uno_parties(id) on delete cascade,
  user_id uuid not null,
  texte text not null check (char_length(texte) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists hg_uno_messages_partie on public.hg_uno_messages(partie, id);
alter table public.hg_uno_messages enable row level security;

create table if not exists public.hg_uno_invites (
  user_id uuid primary key,
  partie uuid not null references public.hg_uno_parties(id) on delete cascade,
  pseudo text not null,
  jeton_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.hg_uno_invites enable row level security;

/* =====================================================================
   3. Accès et lecture (temps réel)
   ===================================================================== */

create or replace function public.hg_uno_peut()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), 'uno')
    or exists (select 1 from hg_settings s where s.key = 'uno' and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text)
    or exists (select 1 from hg_uno_invites i where i.user_id = auth.uid()))
$$;
revoke all on function public.hg_uno_peut() from public, anon;
grant execute on function public.hg_uno_peut() to authenticated;

create or replace function public.hg_uno_dans(p_partie uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hg_uno_joueurs where partie = p_partie and user_id = auth.uid())
$$;
revoke all on function public.hg_uno_dans(uuid) from public, anon;
grant execute on function public.hg_uno_dans(uuid) to authenticated;

drop policy if exists hg_uno_parties_read on public.hg_uno_parties;
create policy hg_uno_parties_read on public.hg_uno_parties for select to authenticated
  using (public.hg_uno_peut() and (public.hg_uno_dans(id) or (visibilite = 'publique' and statut = 'attente')));
drop policy if exists hg_uno_messages_read on public.hg_uno_messages;
create policy hg_uno_messages_read on public.hg_uno_messages for select to authenticated
  using (public.hg_uno_peut() and public.hg_uno_dans(partie));

revoke all on public.hg_uno_parties, public.hg_uno_joueurs, public.hg_uno_cartes, public.hg_uno_coups,
  public.hg_uno_messages, public.hg_uno_invites from anon, authenticated;
grant select on public.hg_uno_parties, public.hg_uno_messages to authenticated;

do $$
declare t text;
begin
  foreach t in array array['hg_uno_parties', 'hg_uno_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

/* =====================================================================
   4. Outils internes
   ===================================================================== */

create or replace function public.hg_uno__partie(p_code text, p_lock boolean default false)
returns public.hg_uno_parties language plpgsql security definer set search_path = public as $$
declare v hg_uno_parties;
begin
  select * into v from hg_uno_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if found and p_lock then select * into v from hg_uno_parties where id = v.id for update; end if;
  if not found then raise exception 'Partie introuvable.' using errcode = 'P0002'; end if;
  return v;
end $$;

create or replace function public.hg_uno__bump(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_uno_parties set version = version + 1, activite_at = now() where id = p_id
$$;

create or replace function public.hg_uno__nom(p_id uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from hg_uno_joueurs where partie = p_id and user_id = p_user), '?')
$$;

create or replace function public.hg_uno__carte_nom(p_couleur text, p_valeur text)
returns text language sql immutable as $$
  select case
    when p_valeur = 'joker' then 'Joker'
    when p_valeur = '+4' then 'Joker +4'
    else (case p_couleur when 'r' then 'Rouge' when 'y' then 'Jaune' when 'g' then 'Vert' when 'b' then 'Bleu' else '' end)
         || ' ' || (case p_valeur when 'inv' then 'Inversion' when 'passe' then 'Passe' else p_valeur end) end
$$;

create or replace function public.hg_uno__couleur_nom(p_couleur text)
returns text language sql immutable as $$
  select case p_couleur when 'r' then 'rouge' when 'y' then 'jaune' when 'g' then 'vert' when 'b' then 'bleu' else '' end
$$;

create or replace function public.hg_uno__log(p_id uuid, p_user uuid, p_type text, p_texte text)
returns void language sql security definer set search_path = public as $$
  insert into hg_uno_coups(partie, manche, user_id, type, texte)
  select p_id, manche, p_user, p_type, p_texte from hg_uno_parties where id = p_id
$$;

create or replace function public.hg_uno__code()
returns text language plpgsql security definer set search_path = public as $$
declare v text; i int := 0;
begin
  loop
    v := 'HGUNO-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from hg_uno_parties where code = v and statut in ('attente', 'en_cours'));
    i := i + 1;
    if i > 50 then raise exception 'Impossible de générer un code, réessaie.'; end if;
  end loop;
  return v;
end $$;

-- Recompte les cartes en main de chaque joueur (et garde le maximum atteint).
create or replace function public.hg_uno__compter(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update hg_uno_joueurs j set nb_cartes = x.n, max_cartes = greatest(j.max_cartes, x.n),
    uno = case when x.n > 2 then false else j.uno end
  from (select jj.user_id, (select count(*)::int from hg_uno_cartes c where c.partie = p_id and c.lieu = 'main' and c.user_id = jj.user_id) n
        from hg_uno_joueurs jj where jj.partie = p_id) x
  where j.partie = p_id and j.user_id = x.user_id
$$;

-- Carte du dessus de la défausse.
create or replace function public.hg_uno__dessus(p_id uuid)
returns public.hg_uno_cartes language sql stable security definer set search_path = public as $$
  select * from hg_uno_cartes where partie = p_id and lieu = 'defausse' order by ordre desc limit 1
$$;

-- Remet la défausse (sauf la carte du dessus) dans la pioche, mélangée.
create or replace function public.hg_uno__melanger(p_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_dessus bigint; n int;
begin
  select id into v_dessus from hg_uno_cartes where partie = p_id and lieu = 'defausse' order by ordre desc limit 1;
  with m as (select id, row_number() over (order by random()) rn from hg_uno_cartes
             where partie = p_id and lieu = 'defausse' and id is distinct from v_dessus)
  update hg_uno_cartes c set lieu = 'pioche', user_id = null, ordre = m.rn::int from m where c.id = m.id;
  get diagnostics n = row_count;
  if n > 0 then perform hg_uno__log(p_id, null, 'info', 'La défausse est mélangée et devient la pioche.'); end if;
  return n;
end $$;

-- Fait piocher n cartes à un joueur (mélange la défausse si la pioche est vide). Renvoie l'id de la dernière carte piochée.
create or replace function public.hg_uno__piocher_n(p_id uuid, p_user uuid, p_n int)
returns bigint language plpgsql security definer set search_path = public as $$
declare i int; v_carte bigint; v_derniere bigint;
begin
  for i in 1..greatest(p_n, 0) loop
    select id into v_carte from hg_uno_cartes where partie = p_id and lieu = 'pioche' order by ordre desc limit 1;
    if not found then
      perform hg_uno__melanger(p_id);
      select id into v_carte from hg_uno_cartes where partie = p_id and lieu = 'pioche' order by ordre desc limit 1;
      exit when not found;   -- plus aucune carte disponible (cas extrême) : on arrête de piocher
    end if;
    update hg_uno_cartes set lieu = 'main', user_id = p_user, ordre = 0 where id = v_carte;
    v_derniere := v_carte;
  end loop;
  perform hg_uno__compter(p_id);
  return v_derniere;
end $$;

-- Joueur suivant dans le sens du jeu (en sautant les exclus) ; p_pas = 1 : le suivant, 2 : celui d'après.
create or replace function public.hg_uno__suivant(p_id uuid, p_depuis uuid, p_pas int default 1)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare arr uuid[]; ex boolean[]; n int; i int; s int; k int := 0; tours int := 0;
begin
  select array_agg(user_id order by place), array_agg(exclu order by place) into arr, ex from hg_uno_joueurs where partie = p_id;
  n := coalesce(array_length(arr, 1), 0);
  if n = 0 then return null; end if;
  select sens into s from hg_uno_parties where id = p_id;
  i := coalesce(array_position(arr, p_depuis), 1);
  loop
    i := ((i - 1 + s) % n + n) % n + 1;
    tours := tours + 1;
    if not ex[i] then
      k := k + 1;
      if k >= p_pas then return arr[i]; end if;
    end if;
    exit when tours > n * (p_pas + 1);
  end loop;
  return p_depuis;
end $$;

create or replace function public.hg_uno__actifs(p_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from hg_uno_joueurs where partie = p_id and not exclu
$$;

-- Donne le tour à un joueur (chrono relancé).
create or replace function public.hg_uno__donner_tour(p_id uuid, p_user uuid)
returns void language sql security definer set search_path = public as $$
  update hg_uno_parties set tour = p_user, tour_fin = now() + make_interval(secs => t_tour), a_pioche = false, pioche_carte = null
  where id = p_id
$$;

-- Une carte peut-elle être posée maintenant (règles de base, sans l'interception) ?
create or replace function public.hg_uno__jouable(p hg_uno_parties, c hg_uno_cartes)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare d hg_uno_cartes;
begin
  d := hg_uno__dessus(p.id);
  if p.cumul > 0 then
    -- On ne peut répondre à un cumul qu'avec un +2 (sur un +2) ou un +4.
    return c.valeur = '+4' or (c.valeur = '+2' and d.valeur = '+2');
  end if;
  if c.couleur = 'k' then return true; end if;
  return c.couleur = p.couleur or (d.id is not null and c.valeur = d.valeur);
end $$;

-- Points d'une carte en fin de manche.
create or replace function public.hg_uno__points(p_valeur text)
returns int language sql immutable as $$
  select case when p_valeur ~ '^[0-9]$' then p_valeur::int when p_valeur in ('joker', '+4') then 50 else 20 end
$$;

/* =====================================================================
   5. Distribution, fin de manche, fin de partie
   ===================================================================== */

-- Nouvelle manche : paquet(s) mélangé(s), 7 cartes chacun, première carte retournée (un chiffre).
create or replace function public.hg_uno__distribuer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_paquets int; r record; v_premier uuid; c hg_uno_cartes; v_ordre int;
begin
  delete from hg_uno_cartes where partie = p_id;
  v_paquets := case when (select count(*) from hg_uno_joueurs where partie = p_id and not exclu) >= 11 then 2 else 1 end;
  insert into hg_uno_cartes(partie, couleur, valeur, lieu, ordre)
  select p_id, x.couleur, x.valeur, 'pioche', 0 from (
    select co as couleur, '0' as valeur from unnest(array['r','y','g','b']) co
    union all select co, v from unnest(array['r','y','g','b']) co, unnest(array['1','2','3','4','5','6','7','8','9','+2','inv','passe']) v, generate_series(1, 2)
    union all select 'k', 'joker' from generate_series(1, 4)
    union all select 'k', '+4' from generate_series(1, 4)
  ) x, generate_series(1, v_paquets);
  with m as (select id, row_number() over (order by random()) rn from hg_uno_cartes where partie = p_id)
  update hg_uno_cartes cc set ordre = m.rn::int from m where cc.id = m.id;

  update hg_uno_joueurs set nb_cartes = 0, uno = false, manques = 0, main_points = null where partie = p_id;
  for r in select user_id from hg_uno_joueurs where partie = p_id and not exclu order by place loop
    perform hg_uno__piocher_n(p_id, r.user_id, 7);
  end loop;

  -- Première carte : on retourne jusqu'à tomber sur un chiffre (les cartes spéciales repartent au fond de la pioche).
  loop
    select * into c from hg_uno_cartes where partie = p_id and lieu = 'pioche' order by ordre desc limit 1;
    exit when not found;
    if c.valeur ~ '^[0-9]$' then
      update hg_uno_cartes set lieu = 'defausse', ordre = 1 where id = c.id;
      exit;
    end if;
    select coalesce(min(ordre), 0) - 1 into v_ordre from hg_uno_cartes where partie = p_id and lieu = 'pioche';
    update hg_uno_cartes set ordre = v_ordre where id = c.id;
  end loop;

  select user_id into v_premier from hg_uno_joueurs where partie = p_id and not exclu order by random() limit 1;
  update hg_uno_parties set manche = manche + 1, sens = 1, couleur = c.couleur, cumul = 0, a_pioche = false, pioche_carte = null,
    uno_attente = null, defi = null where id = p_id;
  perform hg_uno__donner_tour(p_id, v_premier);
  perform hg_uno__log(p_id, null, 'manche', 'Manche ' || (select manche from hg_uno_parties where id = p_id)
    || ' : 7 cartes chacun. Première carte : ' || hg_uno__carte_nom(c.couleur, c.valeur) || '. '
    || hg_uno__nom(p_id, v_premier) || ' commence.');
end $$;

-- Fin de partie : classement, Paillettes, badges.
create or replace function public.hg_uno__terminer(p_id uuid, p_vainqueur uuid, p_annulee boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; cfg jsonb; pts jsonb; r record; v_gain int; v_jour int; v_plafond int; v_min int; v_n int; v_off jsonb;
begin
  select * into p from hg_uno_parties where id = p_id for update;
  if p.statut in ('terminee', 'annulee') then return; end if;
  cfg := coalesce((select value from hg_settings where key = 'uno'), '{}'::jsonb);
  pts := coalesce(cfg->'paillettes', '{}'::jsonb);
  v_plafond := coalesce((cfg->>'plafond_jour')::int, 1000);
  v_min := coalesce((cfg->>'min_joueurs')::int, 2);
  v_off := coalesce(cfg->'badges_inactifs', '[]'::jsonb);
  select count(*) into v_n from hg_uno_joueurs where partie = p_id;

  -- Points restant en main (pour l'affichage et le classement d'une manche simple)
  update hg_uno_joueurs j set main_points = coalesce((select sum(hg_uno__points(c.valeur)) from hg_uno_cartes c
    where c.partie = p_id and c.lieu = 'main' and c.user_id = j.user_id), 0) where j.partie = p_id;

  -- Classement : vainqueur premier ; puis (partie en points) le plus de points, ou (manche) le moins de points en main ; exclus derniers.
  with cl as (
    select user_id, row_number() over (order by (user_id = p_vainqueur) desc, exclu,
      case when p.mode = 'points' then -points else main_points end, nb_cartes, place) rn
    from hg_uno_joueurs where partie = p_id)
  update hg_uno_joueurs j set rang = cl.rn, gagne = (j.user_id = p_vainqueur) from cl where j.partie = p_id and j.user_id = cl.user_id;

  update hg_uno_parties set statut = case when p_annulee then 'annulee' else 'terminee' end, vainqueur = p_vainqueur,
    tour = null, tour_fin = null, ended_at = now(), version = version + 1 where id = p_id;
  perform hg_uno__log(p_id, p_vainqueur, 'fin', case when p_annulee then 'La partie a été arrêtée.'
    else hg_uno__nom(p_id, p_vainqueur) || ' gagne la partie !' end);

  if p_annulee or p_vainqueur is null or v_n < v_min then return; end if;

  for r in select x.* from hg_uno_joueurs x where x.partie = p_id and not x.invite and not x.exclu
           and exists (select 1 from hg_profiles pr where pr.id = x.user_id and not pr.is_ghost) loop
    v_gain := coalesce((pts->>'partie')::int, 50)
      + case when r.gagne then coalesce((pts->>'victoire')::int, 150) + greatest(0, v_n - 3) * coalesce((pts->>'bonus_adversaire')::int, 10) else 0 end;
    select coalesce(sum(delta), 0) into v_jour from hg_wallet_log
      where user_id = r.user_id and reason = 'uno' and created_at >= date_trunc('day', now() at time zone 'Europe/Zurich') at time zone 'Europe/Zurich';
    v_gain := greatest(0, least(v_gain, v_plafond - v_jour));
    if v_gain > 0 and hg_wallet_add(r.user_id, v_gain, 'uno', 'uno:' || p_id || ':' || r.user_id) then
      update hg_uno_joueurs set paillettes = v_gain where partie = p_id and user_id = r.user_id;
    end if;

    if r.gagne and not v_off ? 'uno_premiere_victoire' then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_premiere_victoire') on conflict do nothing;
    end if;
    if r.max_cartes >= 20 and not v_off ? 'uno_main_pleine' then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_main_pleine') on conflict do nothing;
    end if;
    if r.defis_gagnes > 0 and not v_off ? 'uno_arroseur_arrose' then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_arroseur_arrose') on conflict do nothing;
    end if;
    if r.gagne and v_n >= 10 and not v_off ? 'uno_grande_table' then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_grande_table') on conflict do nothing;
    end if;
    if not v_off ? 'uno_jamais_sans' and (select count(*) from hg_uno_joueurs x2 join hg_uno_parties p2 on p2.id = x2.partie
        where x2.user_id = r.user_id and p2.statut = 'terminee' and not x2.exclu and x2.oublis_uno = 0) >= 20 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_jamais_sans') on conflict do nothing;
    end if;
    if not v_off ? 'uno_habitue' and (select count(*) from hg_uno_joueurs x3 join hg_uno_parties p3 on p3.id = x3.partie
        where x3.user_id = r.user_id and p3.statut = 'terminee') >= 50 then
      insert into hg_user_badges(user_id, badge_code) values (r.user_id, 'uno_habitue') on conflict do nothing;
    end if;
  end loop;
end $$;

-- Un joueur a vidé sa main : points de la manche, puis fin de partie ou manche suivante (partie en 500 points).
create or replace function public.hg_uno__fin_manche(p_id uuid, p_gagnant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_pts int;
begin
  select * into p from hg_uno_parties where id = p_id;
  select coalesce(sum(hg_uno__points(valeur)), 0) into v_pts from hg_uno_cartes where partie = p_id and lieu = 'main' and user_id <> p_gagnant;
  update hg_uno_joueurs set points = points + v_pts where partie = p_id and user_id = p_gagnant;
  perform hg_uno__log(p_id, p_gagnant, 'manche', hg_uno__nom(p_id, p_gagnant) || ' vide sa main et marque ' || v_pts || ' points.');
  if p.mode = 'points' and (select points from hg_uno_joueurs where partie = p_id and user_id = p_gagnant) < 500
     and hg_uno__actifs(p_id) >= 2 then
    perform hg_uno__distribuer(p_id);
    perform hg_uno__bump(p_id);
  else
    perform hg_uno__terminer(p_id, p_gagnant);
  end if;
end $$;

-- Retire un joueur d'une partie en cours (départ ou trop de tours manqués) : ses cartes repartent sous la pioche.
create or replace function public.hg_uno__exclure_en_jeu(p_id uuid, p_user uuid, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_suiv uuid; v_min int; v_dernier uuid;
begin
  select * into p from hg_uno_parties where id = p_id;
  v_suiv := hg_uno__suivant(p_id, p_user, 1);
  select coalesce(min(ordre), 0) into v_min from hg_uno_cartes where partie = p_id and lieu = 'pioche';
  with m as (select id, row_number() over (order by random()) rn from hg_uno_cartes where partie = p_id and lieu = 'main' and user_id = p_user)
  update hg_uno_cartes c set lieu = 'pioche', user_id = null, ordre = v_min - m.rn::int from m where c.id = m.id;
  update hg_uno_joueurs set exclu = true, nb_cartes = 0, uno = false where partie = p_id and user_id = p_user;
  perform hg_uno__log(p_id, p_user, 'exclu', p_texte);
  update hg_uno_parties set uno_attente = case when uno_attente = p_user then null else uno_attente end,
    defi = case when defi->>'poseur' = p_user::text or defi->>'cible' = p_user::text then null else defi end
  where id = p_id;
  if hg_uno__actifs(p_id) <= 1 then
    select user_id into v_dernier from hg_uno_joueurs where partie = p_id and not exclu limit 1;
    perform hg_uno__terminer(p_id, v_dernier);
    return;
  end if;
  if p.tour = p_user then perform hg_uno__donner_tour(p_id, v_suiv); end if;
end $$;

/* =====================================================================
   6. Les coups
   ===================================================================== */

-- Pose une carte (vérifications faites par l'appelant) et applique son effet.
create or replace function public.hg_uno__poser(p_id uuid, p_user uuid, p_carte bigint, p_couleur text, p_cible uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; c hg_uno_cartes; v_ordre int; v_reste int; v_suiv uuid; v_txt text; v_avant text; v_legal boolean;
  r record; arr uuid[]; mains bigint[][]; i int; n int;
begin
  select * into p from hg_uno_parties where id = p_id;
  select * into c from hg_uno_cartes where id = p_carte;
  v_avant := p.couleur;
  -- Légalité du +4 : le poseur n'avait aucune carte de la couleur demandée (avant de poser).
  v_legal := not exists (select 1 from hg_uno_cartes where partie = p_id and lieu = 'main' and user_id = p_user and couleur = v_avant and id <> p_carte);

  select coalesce(max(ordre), 0) + 1 into v_ordre from hg_uno_cartes where partie = p_id and lieu = 'defausse';
  update hg_uno_cartes set lieu = 'defausse', user_id = null, ordre = v_ordre where id = p_carte;
  update hg_uno_joueurs set cartes_jouees = cartes_jouees + 1, manques = 0 where partie = p_id and user_id = p_user;
  perform hg_uno__compter(p_id);
  select nb_cartes into v_reste from hg_uno_joueurs where partie = p_id and user_id = p_user;

  update hg_uno_parties set couleur = case when c.couleur = 'k' then p_couleur else c.couleur end, a_pioche = false, pioche_carte = null,
    uno_attente = case when v_reste = 1 and not (select uno from hg_uno_joueurs where partie = p_id and user_id = p_user) then p_user
                       when uno_attente = p_user then null else uno_attente end
  where id = p_id;
  if v_reste = 1 and not (select uno from hg_uno_joueurs where partie = p_id and user_id = p_user) then
    update hg_uno_joueurs set oublis_uno = oublis_uno + 1 where partie = p_id and user_id = p_user;
  end if;
  if v_reste = 0 then update hg_uno_parties set uno_attente = null where id = p_id; end if;

  v_txt := hg_uno__nom(p_id, p_user) || ' pose ' || hg_uno__carte_nom(c.couleur, c.valeur)
    || case when c.couleur = 'k' then ' et choisit le ' || hg_uno__couleur_nom(p_couleur) else '' end || '.';
  perform hg_uno__log(p_id, p_user, 'jouer', v_txt);

  -- Effets
  if c.valeur = '+2' or c.valeur = '+4' then
    v_suiv := hg_uno__suivant(p_id, p_user, 1);
    if coalesce((p.variantes->>'cumul')::boolean, false) then
      update hg_uno_parties set cumul = cumul + case when c.valeur = '+2' then 2 else 4 end where id = p_id;
      if v_reste = 0 then
        -- Dernière carte : le suivant pioche tout de suite le cumul, puis la manche s'arrête.
        perform hg_uno__piocher_n(p_id, v_suiv, (select cumul from hg_uno_parties where id = p_id));
        update hg_uno_parties set cumul = 0 where id = p_id;
      else
        perform hg_uno__donner_tour(p_id, v_suiv);
      end if;
    elsif c.valeur = '+2' then
      perform hg_uno__piocher_n(p_id, v_suiv, 2);
      perform hg_uno__log(p_id, v_suiv, 'pioche', hg_uno__nom(p_id, v_suiv) || ' pioche 2 cartes et passe son tour.');
      if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 2)); end if;
    else
      if v_reste = 0 then
        perform hg_uno__piocher_n(p_id, v_suiv, 4);
      else
        -- Joker +4 : la cible peut contester.
        update hg_uno_parties set defi = jsonb_build_object('poseur', p_user, 'cible', v_suiv, 'legal', v_legal) where id = p_id;
        perform hg_uno__donner_tour(p_id, v_suiv);
      end if;
    end if;
  elsif c.valeur = 'inv' then
    update hg_uno_parties set sens = -sens where id = p_id;
    if v_reste > 0 then
      if hg_uno__actifs(p_id) = 2 then perform hg_uno__donner_tour(p_id, p_user);
      else perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1)); end if;
    end if;
  elsif c.valeur = 'passe' then
    v_suiv := hg_uno__suivant(p_id, p_user, 1);
    perform hg_uno__log(p_id, v_suiv, 'info', hg_uno__nom(p_id, v_suiv) || ' passe son tour.');
    if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 2)); end if;
  elsif c.valeur = '7' and coalesce((p.variantes->>'sept_zero')::boolean, false) and p_cible is not null and v_reste > 0 then
    -- Sept : échange de mains avec la cible.
    update hg_uno_cartes set user_id = case when user_id = p_user then p_cible else p_user end
      where partie = p_id and lieu = 'main' and user_id in (p_user, p_cible);
    perform hg_uno__compter(p_id);
    update hg_uno_joueurs set uno = false where partie = p_id and user_id in (p_user, p_cible);
    perform hg_uno__log(p_id, p_user, 'info', hg_uno__nom(p_id, p_user) || ' échange sa main avec ' || hg_uno__nom(p_id, p_cible) || '.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
  elsif c.valeur = '0' and coalesce((p.variantes->>'sept_zero')::boolean, false) and v_reste > 0 then
    -- Zéro : toutes les mains tournent dans le sens du jeu.
    create temp table if not exists _uno_rot(de uuid, vers uuid) on commit drop;
    delete from _uno_rot;
    insert into _uno_rot select user_id, hg_uno__suivant(p_id, user_id, 1) from hg_uno_joueurs where partie = p_id and not exclu;
    update hg_uno_cartes c2 set user_id = r2.vers from _uno_rot r2 where c2.partie = p_id and c2.lieu = 'main' and c2.user_id = r2.de;
    perform hg_uno__compter(p_id);
    update hg_uno_joueurs set uno = false where partie = p_id;
    perform hg_uno__log(p_id, p_user, 'info', 'Toutes les mains tournent dans le sens du jeu.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
  else
    if v_reste > 0 then perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1)); end if;
  end if;

  -- Après un échange ou une rotation, la règle UNO s'applique aux nouvelles mains.
  if c.valeur in ('0', '7') and coalesce((p.variantes->>'sept_zero')::boolean, false) then
    update hg_uno_parties set uno_attente = null where id = p_id;
  end if;

  if v_reste = 0 then
    perform hg_uno__fin_manche(p_id, p_user);
  end if;
end $$;

-- Piocher (cumul, pioche simple ou jusqu'à pouvoir jouer). Renvoie true si le joueur garde la main (carte jouable piochée).
create or replace function public.hg_uno__piocher(p_id uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_carte bigint; c hg_uno_cartes; n int := 0; v_jusqu boolean;
begin
  select * into p from hg_uno_parties where id = p_id;
  update hg_uno_joueurs set manques = 0 where partie = p_id and user_id = p_user;
  if p.uno_attente is not null and p.uno_attente <> p_user then update hg_uno_parties set uno_attente = null where id = p_id; end if;
  if p.cumul > 0 then
    perform hg_uno__piocher_n(p_id, p_user, p.cumul);
    perform hg_uno__log(p_id, p_user, 'pioche', hg_uno__nom(p_id, p_user) || ' pioche ' || p.cumul || ' cartes.');
    update hg_uno_parties set cumul = 0 where id = p_id;
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
    return false;
  end if;
  v_jusqu := coalesce((p.variantes->>'pioche_jusqu')::boolean, false);
  loop
    v_carte := hg_uno__piocher_n(p_id, p_user, 1);
    exit when v_carte is null;
    n := n + 1;
    select * into c from hg_uno_cartes where id = v_carte;
    exit when hg_uno__jouable(p, c) or not v_jusqu or n >= 40;
  end loop;
  perform hg_uno__log(p_id, p_user, 'pioche', hg_uno__nom(p_id, p_user) || case when n > 1 then ' pioche ' || n || ' cartes.' else ' pioche une carte.' end);
  if v_carte is not null and hg_uno__jouable(p, c) then
    update hg_uno_parties set a_pioche = true, pioche_carte = v_carte, tour_fin = greatest(tour_fin, now() + interval '10 seconds') where id = p_id;
    return true;
  end if;
  perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, p_user, 1));
  return false;
end $$;

-- Réponse à un Joker +4.
create or replace function public.hg_uno__repondre_defi(p_id uuid, p_contester boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_poseur uuid; v_cible uuid; v_legal boolean;
begin
  select * into p from hg_uno_parties where id = p_id;
  v_poseur := (p.defi->>'poseur')::uuid; v_cible := (p.defi->>'cible')::uuid; v_legal := (p.defi->>'legal')::boolean;
  update hg_uno_parties set defi = null where id = p_id;
  update hg_uno_joueurs set manques = 0 where partie = p_id and user_id = v_cible;
  if not p_contester then
    perform hg_uno__piocher_n(p_id, v_cible, 4);
    perform hg_uno__log(p_id, v_cible, 'pioche', hg_uno__nom(p_id, v_cible) || ' pioche 4 cartes et passe son tour.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, v_cible, 1));
  elsif not v_legal then
    perform hg_uno__piocher_n(p_id, v_poseur, 4);
    update hg_uno_joueurs set defis_gagnes = defis_gagnes + 1 where partie = p_id and user_id = v_cible;
    perform hg_uno__log(p_id, v_cible, 'defi', hg_uno__nom(p_id, v_cible) || ' conteste avec raison : ' || hg_uno__nom(p_id, v_poseur)
      || ' avait une carte de la bonne couleur et pioche 4 cartes.');
    perform hg_uno__donner_tour(p_id, v_cible);
  else
    perform hg_uno__piocher_n(p_id, v_cible, 6);
    update hg_uno_joueurs set defis_gagnes = defis_gagnes + 1 where partie = p_id and user_id = v_poseur;
    perform hg_uno__log(p_id, v_cible, 'defi', hg_uno__nom(p_id, v_cible) || ' conteste à tort et pioche 6 cartes.');
    perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, v_cible, 1));
  end if;
end $$;

-- Le robot joue pour un joueur absent dont le chrono est écoulé. 3 tours d'affilée : le joueur est retiré.
create or replace function public.hg_uno__auto(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; u uuid; c hg_uno_cartes; v_coul text; v_cible uuid; v_manques int;
begin
  select * into p from hg_uno_parties where id = p_id for update;
  if p.statut <> 'en_cours' or p.tour is null then return; end if;
  u := p.tour;
  update hg_uno_joueurs set manques = manques + 1 where partie = p_id and user_id = u returning manques into v_manques;
  if v_manques >= 3 then
    perform hg_uno__exclure_en_jeu(p_id, u, hg_uno__nom(p_id, u) || ' a manqué 3 tours et quitte la table.');
    perform hg_uno__bump(p_id);
    return;
  end if;
  perform hg_uno__log(p_id, u, 'auto', 'Temps écoulé : le jeu joue pour ' || hg_uno__nom(p_id, u) || '.');
  if p.defi is not null and (p.defi->>'cible')::uuid = u then
    perform hg_uno__repondre_defi(p_id, false);
  elsif p.cumul > 0 then
    perform hg_uno__piocher(p_id, u);
  else
    if p.a_pioche then
      select * into c from hg_uno_cartes where id = p.pioche_carte;
    else
      select * into c from hg_uno_cartes x where x.partie = p_id and x.lieu = 'main' and x.user_id = u and hg_uno__jouable(p, x)
        order by (x.couleur = 'k'), random() limit 1;
      if not found then
        if hg_uno__piocher(p_id, u) then
          select * into p from hg_uno_parties where id = p_id;
          select * into c from hg_uno_cartes where id = p.pioche_carte;
        else
          c := null;
        end if;
      end if;
    end if;
    if c.id is not null then
      select couleur into v_coul from hg_uno_cartes where partie = p_id and lieu = 'main' and user_id = u and couleur <> 'k' and id <> c.id
        group by couleur order by count(*) desc, random() limit 1;
      select user_id into v_cible from hg_uno_joueurs where partie = p_id and not exclu and user_id <> u order by nb_cartes, random() limit 1;
      perform hg_uno__poser(p_id, u, c.id, coalesce(v_coul, 'r'), v_cible);
    elsif (select tour from hg_uno_parties where id = p_id) = u then
      perform hg_uno__donner_tour(p_id, hg_uno__suivant(p_id, u, 1));
    end if;
  end if;
  -- Le robot n'efface pas le compteur de tours manqués du joueur absent.
  update hg_uno_joueurs set manques = v_manques where partie = p_id and user_id = u;
  perform hg_uno__bump(p_id);
end $$;

-- Joue pour les absents tant que le chrono est dépassé.
create or replace function public.hg_uno__essayer(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; n int := 0;
begin
  loop
    select * into p from hg_uno_parties where id = p_id;
    exit when p.statut <> 'en_cours' or p.tour_fin is null or now() < p.tour_fin;
    perform hg_uno__auto(p_id);
    n := n + 1;
    exit when n >= 25;
  end loop;
  return n > 0;
end $$;

-- Appelée chaque minute par pg_cron.
create or replace function public.hg_uno_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from hg_uno_parties where statut = 'en_cours' and tour_fin < now() loop
    if hg_uno__essayer(r.id) then n := n + 1; end if;
  end loop;
  update hg_uno_parties set statut = 'annulee', version = version + 1 where statut = 'attente' and activite_at < now() - interval '6 hours';
  for r in select id from hg_uno_parties where statut = 'en_cours' and activite_at < now() - interval '3 hours' loop
    perform hg_uno__terminer(r.id, null, true);
  end loop;
  return n;
end $$;

/* =====================================================================
   7. Fonctions publiques : salle d'attente
   ===================================================================== */

create or replace function public.hg_uno__identite(p_pseudo text)
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

create or replace function public.hg_uno__entrer(p_id uuid, p_pseudo text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; i record; v_n int;
begin
  select * into p from hg_uno_parties where id = p_id;
  select count(*) into v_n from hg_uno_joueurs where partie = p_id;
  if v_n >= p.nb_places then raise exception 'La partie est complète (% places).', p.nb_places; end if;
  for i in select * from hg_uno__identite(p_pseudo) loop
    if i.invite and not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if exists (select 1 from hg_uno_joueurs where partie = p_id and lower(pseudo) = lower(i.pseudo)) then
      raise exception 'Le pseudo « % » est déjà pris dans cette partie.', i.pseudo;
    end if;
    insert into hg_uno_joueurs(partie, user_id, pseudo, couleur, avatar_url, invite, place, pret)
    values (p_id, auth.uid(), i.pseudo, i.couleur, i.avatar_url, i.invite,
            coalesce((select max(place) from hg_uno_joueurs where partie = p_id), 0) + 1, auth.uid() = p.hote);
    perform hg_uno__log(p_id, auth.uid(), 'info', i.pseudo || ' rejoint la partie.');
  end loop;
end $$;

create or replace function public.hg_uno_creer(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_nb int; v_t int; v_var jsonb;
begin
  if not hg_uno_peut() or exists (select 1 from hg_uno_invites where user_id = auth.uid()) then
    raise exception 'Accès réservé.' using errcode = '42501';
  end if;
  v_nb := coalesce((p->>'nb_places')::int, 8);
  if v_nb < 2 or v_nb > 20 then raise exception 'Le nombre de places doit être entre 2 et 20.'; end if;
  v_t := coalesce((p->>'t_tour')::int, 30);
  if v_t not in (15, 30, 60) then raise exception 'Durée d''un tour invalide.'; end if;
  v_var := jsonb_build_object(
    'cumul', coalesce((p->'variantes'->>'cumul')::boolean, false),
    'pioche_jusqu', coalesce((p->'variantes'->>'pioche_jusqu')::boolean, false),
    'sept_zero', coalesce((p->'variantes'->>'sept_zero')::boolean, false),
    'interception', coalesce((p->'variantes'->>'interception')::boolean, false));
  v_code := hg_uno__code();
  insert into hg_uno_parties(code, nom, hote, visibilite, nb_places, invites, t_tour, mode, variantes, annonce_discord)
  values (v_code, left(coalesce(nullif(trim(p->>'nom'), ''), 'Partie de Uno'), 60), auth.uid(),
          case when p->>'visibilite' = 'publique' then 'publique' else 'privee' end, v_nb,
          coalesce((p->>'invites')::boolean, true), v_t, case when p->>'mode' = 'points' then 'points' else 'manche' end,
          v_var, coalesce((p->>'annonce_discord')::boolean, false))
  returning id into v_id;
  perform hg_uno__entrer(v_id, null);
  return v_code;
end $$;

create or replace function public.hg_uno_rejoindre(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  if not hg_uno_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  p := hg_uno__partie(p_code, true);
  if hg_uno_dans(p.id) then return p.code; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  perform hg_uno__entrer(p.id, null);
  perform hg_uno__bump(p.id);
  return p.code;
end $$;

create or replace function public.hg_uno_quitter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_nouvel uuid;
begin
  p := hg_uno__partie(p_code, true);
  if not hg_uno_dans(p.id) then return; end if;
  if p.statut = 'attente' then
    delete from hg_uno_joueurs where partie = p.id and user_id = auth.uid();
    perform hg_uno__log(p.id, auth.uid(), 'info', 'Un joueur quitte la salle.');
    if p.hote = auth.uid() then
      select user_id into v_nouvel from hg_uno_joueurs where partie = p.id and not invite order by place limit 1;
      if v_nouvel is null then
        update hg_uno_parties set statut = 'annulee' where id = p.id;
      else
        update hg_uno_parties set hote = v_nouvel where id = p.id;
        update hg_uno_joueurs set pret = true where partie = p.id and user_id = v_nouvel;
        perform hg_uno__log(p.id, v_nouvel, 'info', hg_uno__nom(p.id, v_nouvel) || ' devient l''hôte.');
      end if;
    end if;
  elsif p.statut = 'en_cours' then
    if not (select exclu from hg_uno_joueurs where partie = p.id and user_id = auth.uid()) then
      perform hg_uno__exclure_en_jeu(p.id, auth.uid(), hg_uno__nom(p.id, auth.uid()) || ' quitte la table.');
    end if;
  end if;
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_pret(p_code text, p_pret boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__partie(p_code, true);
  if p.statut <> 'attente' or not hg_uno_dans(p.id) then raise exception 'Action impossible.'; end if;
  update hg_uno_joueurs set pret = coalesce(p_pret, true) or user_id = p.hote where partie = p.id and user_id = auth.uid();
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_exclure(p_code text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut retirer un joueur.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  if p_user = p.hote then raise exception 'L''hôte ne peut pas se retirer lui-même.'; end if;
  perform hg_uno__log(p.id, p_user, 'info', hg_uno__nom(p.id, p_user) || ' est retiré de la salle.');
  delete from hg_uno_joueurs where partie = p.id and user_id = p_user;
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_lancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_n int;
begin
  p := hg_uno__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut lancer la partie.'; end if;
  if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
  select count(*) into v_n from hg_uno_joueurs where partie = p.id;
  if v_n < 2 then raise exception 'Il faut au moins 2 joueurs.'; end if;
  if exists (select 1 from hg_uno_joueurs where partie = p.id and not pret) then
    raise exception 'Tous les joueurs doivent être prêts.';
  end if;
  -- Places tirées au hasard autour de la table.
  with m as (select user_id, row_number() over (order by random()) rn from hg_uno_joueurs where partie = p.id)
  update hg_uno_joueurs j set place = m.rn::int from m where j.partie = p.id and j.user_id = m.user_id;
  update hg_uno_parties set statut = 'en_cours', started_at = now() where id = p.id;
  perform hg_uno__distribuer(p.id);
  perform hg_uno__bump(p.id);
end $$;

/* =====================================================================
   8. Fonctions publiques : le jeu
   ===================================================================== */

-- Partie en cours où je joue (verrouillée), sinon erreur.
create or replace function public.hg_uno__ma_partie(p_code text)
returns public.hg_uno_parties language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__partie(p_code, true);
  if not hg_uno_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  if p.statut <> 'en_cours' then raise exception 'La partie n''est pas en cours.'; end if;
  if (select exclu from hg_uno_joueurs where partie = p.id and user_id = auth.uid()) then raise exception 'Tu as quitté la table.'; end if;
  -- Un tour expiré est d'abord joué par le robot.
  if p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_uno__essayer(p.id);
    select * into p from hg_uno_parties where id = p.id;
    if p.statut <> 'en_cours' then raise exception 'La partie est terminée.'; end if;
  end if;
  return p;
end $$;

create or replace function public.hg_uno_jouer(p_code text, p_carte bigint, p_couleur text default null, p_cible uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; c hg_uno_cartes; d hg_uno_cartes; v_inter boolean := false;
begin
  p := hg_uno__ma_partie(p_code);
  select * into c from hg_uno_cartes where id = p_carte and partie = p.id and lieu = 'main' and user_id = auth.uid();
  if not found then raise exception 'Cette carte n''est pas dans ta main.'; end if;
  if p.tour <> auth.uid() then
    -- Interception : carte identique à celle du dessus, hors de son tour.
    d := hg_uno__dessus(p.id);
    if coalesce((p.variantes->>'interception')::boolean, false) and c.couleur <> 'k' and d.couleur = c.couleur and d.valeur = c.valeur
       and p.cumul = 0 and p.defi is null then
      v_inter := true;
    else
      raise exception 'Ce n''est pas ton tour.';
    end if;
  else
    if p.defi is not null then raise exception 'Réponds d''abord au Joker +4 : contester ou accepter.'; end if;
    if p.a_pioche and c.id <> p.pioche_carte then raise exception 'Après avoir pioché, tu ne peux poser que la carte piochée.'; end if;
    if not hg_uno__jouable(p, c) then
      raise exception '%', case when p.cumul > 0 then 'Pose un +2 ou un +4, ou pioche ' || p.cumul || ' cartes.' else 'Cette carte ne peut pas être posée.' end;
    end if;
  end if;
  if c.couleur = 'k' and (p_couleur is null or p_couleur not in ('r', 'y', 'g', 'b')) then raise exception 'Choisis une couleur.'; end if;
  if c.valeur = '7' and coalesce((p.variantes->>'sept_zero')::boolean, false)
     and (select nb_cartes from hg_uno_joueurs where partie = p.id and user_id = auth.uid()) > 1 then
    if p_cible is null or p_cible = auth.uid() or not exists (select 1 from hg_uno_joueurs where partie = p.id and user_id = p_cible and not exclu) then
      raise exception 'Choisis le joueur avec qui échanger ta main.';
    end if;
  end if;
  if p.uno_attente is not null and p.uno_attente <> auth.uid() then update hg_uno_parties set uno_attente = null where id = p.id; end if;
  if v_inter then perform hg_uno__log(p.id, auth.uid(), 'info', hg_uno__nom(p.id, auth.uid()) || ' intercepte !'); end if;
  perform hg_uno__poser(p.id, auth.uid(), c.id, p_couleur, p_cible);
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_piocher(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__ma_partie(p_code);
  if p.tour <> auth.uid() then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.defi is not null then raise exception 'Réponds d''abord au Joker +4 : contester ou accepter.'; end if;
  if p.a_pioche then raise exception 'Tu as déjà pioché : pose la carte ou passe.'; end if;
  perform hg_uno__piocher(p.id, auth.uid());
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_passer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__ma_partie(p_code);
  if p.tour <> auth.uid() then raise exception 'Ce n''est pas ton tour.'; end if;
  if not p.a_pioche then raise exception 'Pioche d''abord une carte.'; end if;
  perform hg_uno__log(p.id, auth.uid(), 'info', hg_uno__nom(p.id, auth.uid()) || ' garde sa carte et passe.');
  perform hg_uno__donner_tour(p.id, hg_uno__suivant(p.id, auth.uid(), 1));
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_uno(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_n int; v_deja boolean;
begin
  p := hg_uno__ma_partie(p_code);
  select nb_cartes, uno into v_n, v_deja from hg_uno_joueurs where partie = p.id and user_id = auth.uid();
  if v_n > 2 then raise exception 'Tu as encore trop de cartes pour dire UNO.'; end if;
  if v_deja then return; end if;
  if v_n = 2 and p.tour <> auth.uid() then raise exception 'Dis UNO pendant ton tour, juste avant de poser ton avant-dernière carte.'; end if;
  update hg_uno_joueurs set uno = true where partie = p.id and user_id = auth.uid();
  if p.uno_attente = auth.uid() then
    update hg_uno_parties set uno_attente = null where id = p.id;
    update hg_uno_joueurs set oublis_uno = greatest(oublis_uno - 1, 0) where partie = p.id and user_id = auth.uid();
  end if;
  perform hg_uno__log(p.id, auth.uid(), 'uno', hg_uno__nom(p.id, auth.uid()) || ' crie UNO !');
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_contrer(p_code text, p_cible uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__ma_partie(p_code);
  if p.uno_attente is null or p.uno_attente <> p_cible or p_cible = auth.uid() then
    raise exception 'Trop tard : ce joueur ne peut plus être contré.';
  end if;
  update hg_uno_parties set uno_attente = null where id = p.id;
  perform hg_uno__piocher_n(p.id, p_cible, 2);
  perform hg_uno__log(p.id, auth.uid(), 'contre', hg_uno__nom(p.id, auth.uid()) || ' contre ' || hg_uno__nom(p.id, p_cible)
    || ' qui a oublié de dire UNO : 2 cartes de pénalité.');
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_contester(p_code text, p_contester boolean)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__ma_partie(p_code);
  if p.defi is null or (p.defi->>'cible')::uuid <> auth.uid() then raise exception 'Il n''y a rien à contester.'; end if;
  perform hg_uno__repondre_defi(p.id, coalesce(p_contester, false));
  perform hg_uno__bump(p.id);
end $$;

create or replace function public.hg_uno_avancer(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  p := hg_uno__partie(p_code, true);
  if not hg_uno_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  perform hg_uno__essayer(p.id);
end $$;

create or replace function public.hg_uno_message(p_code text, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; t text;
begin
  p := hg_uno__partie(p_code);
  if not hg_uno_dans(p.id) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  t := left(trim(coalesce(p_texte, '')), 300);
  if t = '' then raise exception 'Message vide.'; end if;
  if (select count(*) from hg_uno_messages where partie = p.id and user_id = auth.uid() and created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Doucement : attends quelques secondes avant d''écrire.';
  end if;
  insert into hg_uno_messages(partie, user_id, texte) values (p.id, auth.uid(), t);
end $$;

create or replace function public.hg_uno_messages(p_partie uuid, p_apres bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_uno_dans(p_partie) then raise exception 'Tu ne joues pas dans cette partie.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.user_id, 'pseudo', hg_uno__nom(p_partie, m.user_id),
      'texte', m.texte, 'created_at', m.created_at) order by m.id)
    from (select * from hg_uno_messages where partie = p_partie and id > coalesce(p_apres, 0) order by id desc limit 200) m), '[]'::jsonb);
end $$;

create or replace function public.hg_uno_rejouer(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; v_code text; v_id uuid;
begin
  p := hg_uno__partie(p_code, true);
  if p.hote <> auth.uid() then raise exception 'Seul l''hôte peut lancer la revanche.'; end if;
  if p.statut not in ('terminee', 'annulee') then raise exception 'La partie n''est pas finie.'; end if;
  if p.etat ? 'suite' then return p.etat->>'suite'; end if;
  v_code := hg_uno__code();
  insert into hg_uno_parties(code, nom, hote, visibilite, nb_places, invites, t_tour, mode, variantes, annonce_discord)
  values (v_code, p.nom, p.hote, p.visibilite, p.nb_places, p.invites, p.t_tour, p.mode, p.variantes, false)
  returning id into v_id;
  perform hg_uno__entrer(v_id, null);
  update hg_uno_parties set etat = etat || jsonb_build_object('suite', v_code), version = version + 1 where id = p.id;
  return v_code;
end $$;

/* =====================================================================
   9. Lecture : état d'une partie, listes, statistiques
   ===================================================================== */

create or replace function public.hg_uno_etat(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; d hg_uno_cartes; v_moi uuid := auth.uid(); v_joue boolean; v_main jsonb; v_inter boolean;
begin
  p := hg_uno__partie(p_code);
  v_joue := hg_uno_dans(p.id);
  if not v_joue and not (p.visibilite = 'publique' and p.statut = 'attente' and hg_uno_peut()) then
    raise exception 'Tu ne joues pas dans cette partie.' using errcode = '42501';
  end if;
  -- Un tour expiré est joué avant de répondre.
  if p.statut = 'en_cours' and p.tour_fin is not null and now() >= p.tour_fin then
    perform hg_uno__essayer(p.id);
    select * into p from hg_uno_parties where id = p.id;
  end if;
  d := hg_uno__dessus(p.id);
  v_inter := coalesce((p.variantes->>'interception')::boolean, false) and p.cumul = 0 and p.defi is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'couleur', c.couleur, 'valeur', c.valeur,
      'jouable', p.statut = 'en_cours' and (
        (p.tour = v_moi and p.defi is null and (not p.a_pioche or c.id = p.pioche_carte) and hg_uno__jouable(p, c))
        or (p.tour <> v_moi and v_inter and c.couleur <> 'k' and c.couleur = d.couleur and c.valeur = d.valeur)))
      order by position(c.couleur in 'rygbk'),
        case when c.valeur ~ '^[0-9]$' then c.valeur::int else 10 + position(c.valeur in '+2 inv passe joker +4') end, c.id), '[]'::jsonb)
    into v_main from hg_uno_cartes c where c.partie = p.id and c.lieu = 'main' and c.user_id = v_moi;

  return jsonb_build_object(
    'partie', jsonb_build_object('id', p.id, 'code', p.code, 'nom', p.nom, 'statut', p.statut, 'hote', p.hote,
      'visibilite', p.visibilite, 'invites', p.invites, 'nb_places', p.nb_places, 't_tour', p.t_tour, 'mode', p.mode,
      'variantes', p.variantes, 'manche', p.manche, 'sens', p.sens, 'couleur', p.couleur, 'cumul', p.cumul, 'tour', p.tour,
      'tour_fin', p.tour_fin, 'pioche', (select count(*) from hg_uno_cartes where partie = p.id and lieu = 'pioche'),
      'dessus', case when d.id is null then null else jsonb_build_object('id', d.id, 'couleur', d.couleur, 'valeur', d.valeur) end,
      'version', p.version, 'uno_attente', p.uno_attente,
      'defi', case when p.defi is null then null else jsonb_build_object('poseur', p.defi->'poseur', 'cible', p.defi->'cible') end,
      'a_pioche', p.a_pioche, 'suite', p.etat->>'suite', 'vainqueur', p.vainqueur),
    'maintenant', now(),
    'moi', jsonb_build_object('user_id', v_moi, 'hote', p.hote = v_moi,
      'invite', exists (select 1 from hg_uno_invites where user_id = v_moi), 'joue', v_joue),
    'joueurs', coalesce((select jsonb_agg(jsonb_build_object('user_id', j.user_id, 'pseudo', j.pseudo, 'couleur', j.couleur,
        'avatar_url', j.avatar_url, 'invite', j.invite, 'place', j.place, 'pret', j.pret, 'nb_cartes', j.nb_cartes, 'uno', j.uno,
        'exclu', j.exclu, 'points', j.points, 'rang', j.rang, 'gagne', j.gagne, 'paillettes', j.paillettes,
        'main_points', j.main_points) order by j.place) from hg_uno_joueurs j where j.partie = p.id), '[]'::jsonb),
    'main', v_main,
    'pioche_carte', case when p.tour = v_moi and p.a_pioche then p.pioche_carte else null end,
    'journal', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'user_id', x.user_id, 'type', x.type, 'texte', x.texte,
        'created_at', x.created_at) order by x.id desc)
      from (select * from hg_uno_coups where partie = p.id order by id desc limit 15) x), '[]'::jsonb),
    'badges', case when p.statut = 'terminee' and v_moi is not null then coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name))
        from hg_user_badges ub join hg_badges b on b.code = ub.badge_code
        where ub.user_id = v_moi and b.code like 'uno\_%' and ub.awarded_at >= coalesce(p.ended_at, now()) - interval '5 seconds'), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

create or replace function public.hg_uno_publiques()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_uno_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_uno__nom(p.id, p.hote),
      'hote_couleur', (select couleur from hg_uno_joueurs where partie = p.id and user_id = p.hote),
      'inscrits', (select count(*) from hg_uno_joueurs where partie = p.id), 'nb_places', p.nb_places,
      'variantes', p.variantes, 't_tour', p.t_tour, 'mode', p.mode) order by p.created_at desc)
    from hg_uno_parties p where p.statut = 'attente' and p.visibilite = 'publique'), '[]'::jsonb);
end $$;

create or replace function public.hg_uno_mes_parties()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not hg_uno_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'statut', p.statut,
      'inscrits', (select count(*) from hg_uno_joueurs where partie = p.id and not exclu), 'mes_cartes', j.nb_cartes,
      'tour_pseudo', case when p.tour is null then null else hg_uno__nom(p.id, p.tour) end, 'mon_tour', p.tour = auth.uid())
      order by p.created_at desc)
    from hg_uno_parties p join hg_uno_joueurs j on j.partie = p.id and j.user_id = auth.uid()
    where p.statut in ('attente', 'en_cours') and not j.exclu), '[]'::jsonb);
end $$;

create or replace function public.hg_uno_stats(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_u uuid := coalesce(p_user, auth.uid()); r record; v_serie int := 0; v_best int := 0; v_cur int := 0; v_fini boolean := false;
  v_parties int; v_vict int;
begin
  if not hg_uno_peut() then raise exception 'Accès réservé.' using errcode = '42501'; end if;
  select count(*), count(*) filter (where j.gagne) into v_parties, v_vict
    from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie where j.user_id = v_u and p.statut = 'terminee';
  for r in select j.gagne from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie
           where j.user_id = v_u and p.statut = 'terminee' order by p.ended_at desc loop
    if r.gagne then v_cur := v_cur + 1; if not v_fini then v_serie := v_serie + 1; end if;
    else v_cur := 0; v_fini := true; end if;
    v_best := greatest(v_best, v_cur);
  end loop;
  return jsonb_build_object(
    'parties', v_parties, 'victoires', v_vict,
    'taux', case when v_parties > 0 then round(100.0 * v_vict / v_parties) else 0 end,
    'serie', v_serie, 'meilleure_serie', v_best,
    'cartes_jouees', (select coalesce(sum(j.cartes_jouees), 0) from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie
                      where j.user_id = v_u and p.statut = 'terminee'),
    'oublis_uno', (select coalesce(sum(j.oublis_uno), 0) from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie
                   where j.user_id = v_u and p.statut = 'terminee'),
    'defis_gagnes', (select coalesce(sum(j.defis_gagnes), 0) from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie
                     where j.user_id = v_u and p.statut = 'terminee'),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'obtenu', ub.user_id is not null, 'date', ub.awarded_at) order by b.sort)
      from hg_badges b left join hg_user_badges ub on ub.badge_code = b.code and ub.user_id = v_u where b.code like 'uno\_%'), '[]'::jsonb),
    'dernieres', coalesce((select jsonb_agg(x order by (x->>'date') desc) from (
        select jsonb_build_object('code', p.code, 'date', p.ended_at,
          'joueurs', (select count(*) from hg_uno_joueurs j2 where j2.partie = p.id), 'rang', j.rang, 'paillettes', j.paillettes) x
        from hg_uno_joueurs j join hg_uno_parties p on p.id = j.partie
        where j.user_id = v_u and p.statut = 'terminee' order by p.ended_at desc limit 5) s), '[]'::jsonb)
  );
end $$;

/* =====================================================================
   10. Administration
   ===================================================================== */

create or replace function public.hg_uno_admin_reglages()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'uno'), '{}'::jsonb);
  return jsonb_build_object(
    'paillettes', coalesce(cfg->'paillettes', '{}'::jsonb),
    'plafond_jour', coalesce((cfg->>'plafond_jour')::int, 1000),
    'min_joueurs', coalesce((cfg->>'min_joueurs')::int, 2),
    'badges', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'nom', b.name, 'description', b.description,
        'actif', not coalesce(cfg->'badges_inactifs', '[]'::jsonb) ? b.code,
        'membres', (select count(*) from hg_user_badges u where u.badge_code = b.code)) order by b.sort)
      from hg_badges b where b.code like 'uno\_%'), '[]'::jsonb),
    'parties', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'nom', p.nom, 'hote_pseudo', hg_uno__nom(p.id, p.hote),
        'joueurs', (select count(*) from hg_uno_joueurs where partie = p.id), 'statut', p.statut,
        'tour_pseudo', case when p.tour is null then null else hg_uno__nom(p.id, p.tour) end,
        'started_at', coalesce(p.started_at, p.created_at)) order by p.created_at desc)
      from hg_uno_parties p where p.statut in ('attente', 'en_cours')), '[]'::jsonb),
    'terminees', (select count(*) from hg_uno_parties where statut = 'terminee')
  );
end $$;

create or replace function public.hg_uno_admin_enregistrer(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cfg jsonb; v_pts jsonb;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  cfg := coalesce((select value from hg_settings where key = 'uno'), '{}'::jsonb);
  v_pts := jsonb_build_object(
    'partie', least(greatest(coalesce((p->'paillettes'->>'partie')::int, 50), 0), 1000),
    'victoire', least(greatest(coalesce((p->'paillettes'->>'victoire')::int, 150), 0), 1000),
    'bonus_adversaire', least(greatest(coalesce((p->'paillettes'->>'bonus_adversaire')::int, 10), 0), 1000));
  cfg := cfg || jsonb_build_object('paillettes', v_pts,
    'plafond_jour', least(greatest(coalesce((p->>'plafond_jour')::int, 1000), 0), 100000),
    'min_joueurs', least(greatest(coalesce((p->>'min_joueurs')::int, 2), 2), 20),
    'badges_inactifs', coalesce((select jsonb_agg(x) from jsonb_array_elements_text(coalesce(p->'badges_inactifs', '[]'::jsonb)) x
                                 where x like 'uno\_%'), '[]'::jsonb));
  insert into hg_settings(key, value) values ('uno', cfg) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'uno_reglages', 'uno', cfg);
end $$;

create or replace function public.hg_uno_admin_arreter(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties;
begin
  if not hg_is_admin() then raise exception 'Réservé aux administrateurs.' using errcode = '42501'; end if;
  p := hg_uno__partie(p_code, true);
  if p.statut = 'attente' then
    update hg_uno_parties set statut = 'annulee', version = version + 1 where id = p.id;
  elsif p.statut = 'en_cours' then
    perform hg_uno__terminer(p.id, null, true);
  end if;
  insert into hg_admin_log(admin_id, action, target_ref, details) values (auth.uid(), 'uno_arreter', p.code, '{}'::jsonb);
end $$;

/* =====================================================================
   11. Invités (sans compte)
   ===================================================================== */

create or replace function public.hg_uno__devenir(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function public.hg_uno_invite(p_action text, p_code text, p_jeton text default null, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_uno_parties; inv hg_uno_invites; v_uid uuid; v_jeton text; v_pseudo text; v_out jsonb;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  select * into p from hg_uno_parties where code = upper(trim(coalesce(p_code, ''))) order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1;
  if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';
  end if;

  if p_action = 'apercu' then
    return jsonb_build_object('nom', p.nom, 'code', p.code, 'statut', p.statut, 'invites', p.invites, 'nb_places', p.nb_places,
      'inscrits', (select count(*) from hg_uno_joueurs where partie = p.id), 'hote_pseudo', hg_uno__nom(p.id, p.hote),
      'variantes', p.variantes, 't_tour', p.t_tour, 'mode', p.mode);
  end if;

  if p_action = 'rejoindre' then
    if not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
    v_pseudo := trim(coalesce(p_args->>'pseudo', ''));
    if char_length(v_pseudo) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
    v_uid := gen_random_uuid();
    v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into hg_uno_invites(user_id, partie, pseudo, jeton_hash) values (v_uid, p.id, v_pseudo, encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'));
    perform hg_uno__devenir(v_uid);
    perform hg_uno__entrer(p.id, v_pseudo);
    perform hg_uno__bump(p.id);
    return jsonb_build_object('jeton', v_jeton, 'code', p.code, 'user_id', v_uid);
  end if;

  select * into inv from hg_uno_invites where jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if not found or inv.partie <> p.id then raise exception 'Invitation expirée : rejoins à nouveau la partie.' using errcode = '42501'; end if;
  perform hg_uno__devenir(inv.user_id);

  case p_action
    when 'etat' then v_out := hg_uno_etat(p.code);
    when 'pret' then perform hg_uno_pret(p.code, coalesce((p_args->>'pret')::boolean, true));
    when 'quitter' then perform hg_uno_quitter(p.code);
    when 'jouer' then perform hg_uno_jouer(p.code, (p_args->>'carte')::bigint, p_args->>'couleur', nullif(p_args->>'cible', '')::uuid);
    when 'piocher' then perform hg_uno_piocher(p.code);
    when 'passer' then perform hg_uno_passer(p.code);
    when 'uno' then perform hg_uno_uno(p.code);
    when 'contrer' then perform hg_uno_contrer(p.code, nullif(p_args->>'cible', '')::uuid);
    when 'contester' then perform hg_uno_contester(p.code, coalesce((p_args->>'contester')::boolean, false));
    when 'message' then perform hg_uno_message(p.code, p_args->>'texte');
    when 'avancer' then perform hg_uno_avancer(p.code);
    when 'messages' then v_out := hg_uno_messages(p.id, coalesce((p_args->>'apres')::bigint, 0));
    else raise exception 'Action inconnue.';
  end case;
  return v_out;
end $$;

/* =====================================================================
   12. Droits d'exécution et tâche planifiée
   ===================================================================== */

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hg\_uno%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname not like 'hg\_uno\_\_%' and f.proname <> 'hg_uno_tick' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.hg_uno_invite(text, text, text, jsonb) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'hg-uno-tick') then perform cron.unschedule('hg-uno-tick'); end if;
    perform cron.schedule('hg-uno-tick', '* * * * *', 'select public.hg_uno_tick()');
  end if;
end $$;
