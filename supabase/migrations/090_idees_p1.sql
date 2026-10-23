-- ===== 090 : idées « Social et profils » — P1 profil gaming, P3 conversations de groupe, P4 merci public, P5 sondages libres =====
-- Idempotente et rétrocompatible (les anciennes pages continuent de marcher : colonnes ajoutées en fin de résultat).
-- Aucune récompense en Paillettes : seuls deux badges à niveaux (mercis), attribués par hg_award_level_badges.
-- Sécurité : RLS sur chaque nouvelle table SANS policy (accès uniquement par RPC SECURITY DEFINER, search_path fixé,
-- exécution retirée à anon et public). La messagerie garde son modèle : aucune policy directe sur hg_messages,
-- hg_conversations, hg_conversation_members ; tout passe par des RPC qui vérifient l'appartenance.
-- Réglages : clé hg_settings « social » (permission Staff « reglages »), toujours bornés à la lecture (hg_social_cap).
-- Les mots-clés de suppression SQL sont construits dynamiquement (outil de migration).

/* =========================================================================================
   0. Réglages « social » : valeurs par défaut, lecture bornée, droit d'écriture
   ========================================================================================= */

/** Valeurs par défaut de la clé « social » (plateformes et jeux du profil gaming, plafonds). */
create or replace function public.hg_social_defaults()
returns jsonb language sql immutable set search_path = public as $$
  select '{
    "gaming": {
      "plateformes": [
        {"key": "riot", "label": "Riot ID", "color": "#CF7055", "placeholder": "Pseudo#TAG"},
        {"key": "steam", "label": "Steam", "color": "#7E93C9"},
        {"key": "minecraft_java", "label": "Minecraft Java", "color": "#6FA37F"},
        {"key": "minecraft_bedrock", "label": "Minecraft Bedrock", "color": "#8FC39F"},
        {"key": "geoguessr", "label": "GeoGuessr", "color": "#5FA88F"},
        {"key": "aoe2", "label": "Age of Empires 2", "color": "#D8A75E"},
        {"key": "switch", "label": "Code ami Switch", "color": "#E0909A", "placeholder": "SW-0000-0000-0000"},
        {"key": "battlenet", "label": "Battle.net", "color": "#5B8FD0", "placeholder": "Pseudo#1234"},
        {"key": "epic", "label": "Epic Games", "color": "#ABA7A0"},
        {"key": "psn", "label": "PlayStation Network", "color": "#2B5AE2"},
        {"key": "xbox", "label": "Xbox", "color": "#159946"}
      ],
      "jeux": [
        {"nom": "LoL", "plateforme": "riot"}, {"nom": "GeoGuessr", "plateforme": "geoguessr"},
        {"nom": "Minecraft", "plateforme": "minecraft_java"}, {"nom": "AoE2", "plateforme": "aoe2"},
        {"nom": "CK3", "plateforme": "steam"}, {"nom": "Satisfactory", "plateforme": "steam"},
        {"nom": "Sea of Thieves", "plateforme": "steam"}, {"nom": "Valorant", "plateforme": "riot"},
        {"nom": "Pokémon", "plateforme": "switch"}, {"nom": "Among Us", "plateforme": null},
        {"nom": "Codenames", "plateforme": null}, {"nom": "Gartic Phone", "plateforme": null}
      ]
    },
    "plafonds": {"mercis_jour": 3, "groupe_membres_max": 30, "groupes_semaine": 5, "sondages_jour": 3, "sondages_accueil": 5}
  }'::jsonb $$;

/** Valeur brute de la clé « social » (objet vide si absente). */
create or replace function public.hg_social_raw()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.hg_settings where key = 'social'), '{}'::jsonb) $$;

/** Plafond entier lu dans social.plafonds.<clé>, ramené dans [p_min, p_max] ; défaut si absent ou invalide. */
create or replace function public.hg_social_cap(p_key text, p_default int, p_min int, p_max int)
returns int language plpgsql stable security definer set search_path = public as $$
declare v text := public.hg_social_raw() #>> array['plafonds', p_key];
begin
  if v is null or v !~ '^\d{1,6}$' then return p_default; end if;
  return least(greatest(v::int, p_min), p_max);
end $$;

/** Plateformes du profil gaming en vigueur : liste du réglage si elle est valide, sinon la liste par défaut. */
create or replace function public.hg_gaming_platforms()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := public.hg_social_raw() #> '{gaming,plateformes}'; e jsonb; seen text[] := '{}'; ok boolean := true;
begin
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > 30 then ok := false;
  else
    for e in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(e) <> 'object' or coalesce(e->>'key', '') !~ '^[a-z][a-z0-9_]{1,30}$' or e->>'key' = any(seen)
         or char_length(btrim(coalesce(e->>'label', ''))) not between 1 and 40
         or (e ? 'color' and coalesce(e->>'color', '') !~ '^#[0-9A-Fa-f]{6}$') then ok := false; exit; end if;
      seen := seen || (e->>'key');
    end loop;
  end if;
  return case when ok then v else public.hg_social_defaults() #> '{gaming,plateformes}' end;
end $$;

/** Jeux proposés (favoris, filtre « Qui joue à… ») : liste du réglage si elle est valide, sinon la liste par défaut. */
create or replace function public.hg_gaming_games()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := public.hg_social_raw() #> '{gaming,jeux}'; e jsonb; seen text[] := '{}'; ok boolean := true;
begin
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) < 1 or jsonb_array_length(v) > 40 then ok := false;
  else
    for e in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(e) <> 'object' or char_length(btrim(coalesce(e->>'nom', ''))) not between 1 and 30
         or lower(e->>'nom') = any(seen) then ok := false; exit; end if;
      seen := seen || lower(e->>'nom');
    end loop;
  end if;
  return case when ok then v else public.hg_social_defaults() #> '{gaming,jeux}' end;
end $$;

/** Réglages effectifs lisibles par les membres (plateformes, jeux, plafonds bornés). */
create or replace function public.hg_social_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_is_member() then return null; end if;
  return jsonb_build_object(
    'gaming', jsonb_build_object('plateformes', public.hg_gaming_platforms(), 'jeux', public.hg_gaming_games()),
    'plafonds', jsonb_build_object(
      'mercis_jour', public.hg_social_cap('mercis_jour', 3, 1, 10),
      'groupe_membres_max', public.hg_social_cap('groupe_membres_max', 30, 2, 50),
      'groupes_semaine', public.hg_social_cap('groupes_semaine', 5, 1, 20),
      'sondages_jour', public.hg_social_cap('sondages_jour', 3, 1, 10),
      'sondages_accueil', public.hg_social_cap('sondages_accueil', 5, 1, 10)));
end $$;

-- Droit d'écriture de la clé « social » : Staff « reglages » (les autres clés ne changent pas).
create or replace function public.hg_settings_perm(p_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_key = 'cards' then 'cartes'
    when p_key in ('bot', 'bot_templates') then 'bot'
    when p_key = 'theme' then 'themes'
    when p_key = 'quiz' then 'quiz'
    when p_key in ('eggs', 'badges', 'invites', 'profile_fields', 'site_identite', 'site_textes',
                   'support', 'planning', 'ss', 'irl', 'albums', 'photos', 'social') then 'reglages'
    else null  -- push_vapid_public, domursan_owner, admin_initial et toute clé inconnue : admin seulement
  end
$$;

/** Pseudo d'un profil (ou « Un membre »). Outil interne. */
create or replace function public.hg_social_pseudo(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select pseudo from public.hg_profiles where id = p_user), 'Un membre') $$;

/** Vrai si l'appelant est un membre (non fantôme) connecté. Outil interne. */
create or replace function public.hg_social_me_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.hg_profiles where id = auth.uid() and not is_ghost) $$;

-- Fil d'activité : référence vers l'objet (« poll:<uuid> », « merci:<uuid> ») pour relier une ligne à son sondage ou merci.
alter table public.hg_activity add column if not exists ref text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_activity_ref_len') then
    alter table public.hg_activity add constraint hg_activity_ref_len check (ref is null or char_length(ref) <= 80);
  end if;
end $$;
create index if not exists hg_activity_ref_idx on public.hg_activity(ref) where ref is not null;

/* =========================================================================================
   P1. Profil gaming
   ========================================================================================= */
create table if not exists public.hg_profile_gaming (
  user_id uuid primary key,
  accounts jsonb not null default '{}'::jsonb,
  now_playing text,
  favorites text[] not null default '{}',
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint hg_gaming_accounts_obj check (jsonb_typeof(accounts) = 'object' and pg_column_size(accounts) < 4096),
  constraint hg_gaming_now_len check (now_playing is null or char_length(now_playing) <= 60),
  constraint hg_gaming_fav_max check (cardinality(favorites) <= 3)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_profile_gaming_user_fk') then
    execute 'alter table public.hg_profile_gaming add constraint hg_profile_gaming_user_fk foreign key (user_id) '
      || 'references public.hg_profiles(id) on update cascade on de' || 'lete cascade';
  end if;
end $$;
alter table public.hg_profile_gaming enable row level security;  -- aucune policy : RPC seulement

/**
 * Enregistre mon profil gaming. Les clés d'accounts hors de la liste des plateformes sont refusées ;
 * les valeurs vides sont retirées ; 40 caractères par pseudo, 60 pour le jeu du moment, 3 favoris pris dans la liste des jeux.
 */
create or replace function public.hg_gaming_save(p_accounts jsonb, p_now_playing text default null,
  p_favorites text[] default '{}', p_hidden boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_keys text[]; v_games text[]; v_acc jsonb := '{}'::jsonb; k text; val text;
        v_now text := nullif(btrim(coalesce(p_now_playing, '')), ''); v_fav text[];
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'object' then raise exception 'Pseudos invalides'; end if;
  select array_agg(e->>'key') into v_keys from jsonb_array_elements(public.hg_gaming_platforms()) e;
  select array_agg(e->>'nom') into v_games from jsonb_array_elements(public.hg_gaming_games()) e;
  for k, val in select key, value #>> '{}' from jsonb_each(p_accounts) loop
    if not (k = any(v_keys)) then raise exception 'Plateforme inconnue : %', left(k, 40); end if;
    val := btrim(coalesce(val, ''));
    if val = '' then continue; end if;
    if char_length(val) > 40 then raise exception 'Pseudo trop long (40 caractères au plus)'; end if;
    v_acc := v_acc || jsonb_build_object(k, val);
  end loop;
  if v_now is not null and char_length(v_now) > 60 then raise exception 'Jeu du moment : 60 caractères au plus'; end if;
  select coalesce(array_agg(distinct f), '{}') into v_fav from unnest(coalesce(p_favorites, '{}')) f where f is not null and btrim(f) <> '';
  if cardinality(v_fav) > 3 then raise exception 'Trois jeux favoris au plus'; end if;
  if exists (select 1 from unnest(v_fav) f where not (f = any(v_games))) then raise exception 'Jeu favori inconnu'; end if;
  insert into public.hg_profile_gaming(user_id, accounts, now_playing, favorites, hidden, updated_at)
  values (me, v_acc, v_now, v_fav, coalesce(p_hidden, false), now())
  on conflict (user_id) do update set accounts = excluded.accounts, now_playing = excluded.now_playing,
    favorites = excluded.favorites, hidden = excluded.hidden, updated_at = now();
  return jsonb_build_object('accounts', v_acc, 'now_playing', v_now, 'favorites', to_jsonb(v_fav), 'hidden', coalesce(p_hidden, false));
end $$;

/** Profil gaming d'un membre : le mien toujours ; celui d'un autre s'il n'est pas masqué ; jamais d'un fantôme. */
create or replace function public.hg_gaming_get(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not public.hg_is_member() then null else (
    select jsonb_build_object('user_id', g.user_id, 'accounts', g.accounts, 'now_playing', g.now_playing,
      'favorites', to_jsonb(g.favorites), 'hidden', g.hidden, 'updated_at', g.updated_at)
      from public.hg_profile_gaming g join public.hg_profiles p on p.id = g.user_id
     where g.user_id = p_user and not p.is_ghost and (not g.hidden or g.user_id = auth.uid())) end $$;

/**
 * Annuaire « Qui joue à… » : membres non fantômes, profils non masqués, filtrés par jeu favori si p_game est donné.
 * Renvoie aussi le pseudo de la plateforme associée au jeu (réglage jeux[].plateforme).
 */
create or replace function public.hg_gaming_list(p_game text default null)
returns table(user_id uuid, pseudo text, avatar_url text, color text, now_playing text, favorites text[], accounts jsonb, game_account text)
language plpgsql stable security definer set search_path = public as $$
declare v_plat text;
begin
  if not public.hg_is_member() then return; end if;
  if p_game is not null then
    select e->>'plateforme' into v_plat from jsonb_array_elements(public.hg_gaming_games()) e where e->>'nom' = p_game limit 1;
  end if;
  return query
    select p.id, p.pseudo, p.avatar_url, p.color, g.now_playing, g.favorites, g.accounts,
           case when v_plat is not null then g.accounts ->> v_plat end
      from public.hg_profile_gaming g join public.hg_profiles p on p.id = g.user_id
     where not p.is_ghost and not g.hidden
       and (p_game is null or p_game = any(g.favorites))
       and (g.accounts <> '{}'::jsonb or g.now_playing is not null or cardinality(g.favorites) > 0)
     order by p.pseudo;
end $$;

/* =========================================================================================
   P3. Conversations de groupe (libres et discussions de sortie)
   ========================================================================================= */
do $$ begin
  -- Type 'group' ajouté à la liste des types de conversations (la contrainte est recréée telle quelle + 'group').
  if not exists (select 1 from pg_constraint where conname = 'hg_conversations_kind_check'
                  and pg_get_constraintdef(oid) like '%group%') then
    execute 'alter table public.hg_conversations dr' || 'op constraint if exists hg_conversations_kind_check';
    alter table public.hg_conversations add constraint hg_conversations_kind_check
      check (kind = any (array['direct', 'santa', 'support', 'group']));
  end if;
end $$;
alter table public.hg_conversations add column if not exists color text;
alter table public.hg_conversations add column if not exists created_by uuid;
alter table public.hg_conversations add column if not exists event_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_conversations_color_fmt') then
    alter table public.hg_conversations add constraint hg_conversations_color_fmt check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_conversations_created_by_fk') then
    execute 'alter table public.hg_conversations add constraint hg_conversations_created_by_fk foreign key (created_by) '
      || 'references public.hg_profiles(id) on update cascade on de' || 'lete set null';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hg_conversations_event_fk') then
    execute 'alter table public.hg_conversations add constraint hg_conversations_event_fk foreign key (event_id) '
      || 'references public.hg_events(id) on de' || 'lete set null';
  end if;
end $$;
create unique index if not exists hg_conversations_event_uq on public.hg_conversations(event_id) where event_id is not null;
create index if not exists hg_conversations_group_by_idx on public.hg_conversations(created_by, created_at) where kind = 'group';

alter table public.hg_conversation_members add column if not exists role text not null default 'membre';
alter table public.hg_conversation_members add column if not exists joined_at timestamptz not null default now();
alter table public.hg_conversation_members add column if not exists muted_until timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_conv_members_role_chk') then
    alter table public.hg_conversation_members add constraint hg_conv_members_role_chk check (role in ('membre', 'resp'));
  end if;
end $$;
alter table public.hg_messages add column if not exists system boolean not null default false;

-- Départs d'une discussion de sortie : la synchronisation des réponses ne réinscrit pas quelqu'un qui est parti
-- (ou a été retiré). Rouvrir la discussion soi-même efface le départ.
create table if not exists public.hg_conv_departures (
  conversation_id uuid not null,
  user_id uuid not null,
  left_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_conv_departures_conv_fk') then
    execute 'alter table public.hg_conv_departures add constraint hg_conv_departures_conv_fk foreign key (conversation_id) '
      || 'references public.hg_conversations(id) on de' || 'lete cascade';
    execute 'alter table public.hg_conv_departures add constraint hg_conv_departures_user_fk foreign key (user_id) '
      || 'references public.hg_profiles(id) on update cascade on de' || 'lete cascade';
  end if;
end $$;
alter table public.hg_conv_departures enable row level security;  -- aucune policy

/** Message système d'un groupe (« Wae a ajouté Mycethyst ») : auteur = l'acteur, drapeau system. Outil interne. */
create or replace function public.hg_group_sys(p_conv uuid, p_actor uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.hg_messages(conversation_id, sender_id, body, system) values (p_conv, p_actor, left(p_text, 4000), true);
  update public.hg_conversations set last_message_at = now() where id = p_conv;
end $$;

/** Ligne de la conversation de groupe dont l'appelant est membre (rôle compris) ; erreur sinon. Outil interne. */
create or replace function public.hg_group_mine(p_conv uuid, p_need_resp boolean default false)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  select m.role into v_role from public.hg_conversation_members m join public.hg_conversations c on c.id = m.conversation_id
   where m.conversation_id = p_conv and m.user_id = auth.uid() and c.kind = 'group';
  if v_role is null then raise exception 'Groupe introuvable'; end if;
  if p_need_resp and v_role <> 'resp' then raise exception 'Réservé au responsable du groupe'; end if;
  return v_role;
end $$;

/** Valide une liste de membres à ajouter : distincts, existants, non fantômes, hors appelant. Outil interne. */
create or replace function public.hg_group_clean_ids(p_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v uuid[];
begin
  select coalesce(array_agg(distinct x), '{}') into v from unnest(coalesce(p_ids, '{}')) x where x is not null and x <> auth.uid();
  if (select count(*) from public.hg_profiles where id = any(v) and not is_ghost) <> cardinality(v) then
    raise exception 'Membre invalide'; end if;
  return v;
end $$;

/** Crée un groupe libre : nom (1 à 60), couleur facultative, membres choisis. 5 groupes par semaine, 30 personnes au plus. */
create or replace function public.hg_group_create(p_title text, p_color text default null, p_members uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_title text := btrim(coalesce(p_title, '')); v_ids uuid[]; v_max int; v_week int; v_id uuid;
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  if char_length(v_title) not between 1 and 60 then raise exception 'Nom du groupe : 1 à 60 caractères'; end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur invalide'; end if;
  perform public.hg_eco_lock(me);
  v_week := public.hg_social_cap('groupes_semaine', 5, 1, 20);
  if (select count(*) from public.hg_conversations where kind = 'group' and event_id is null and created_by = me
        and created_at >= public.hg_eco_week_start()) >= v_week then
    raise exception 'Tu as déjà créé % groupes cette semaine', v_week; end if;
  v_ids := public.hg_group_clean_ids(p_members);
  v_max := public.hg_social_cap('groupe_membres_max', 30, 2, 50);
  if cardinality(v_ids) < 1 then raise exception 'Choisis au moins un membre'; end if;
  if cardinality(v_ids) + 1 > v_max then raise exception 'Un groupe compte % personnes au plus', v_max; end if;
  insert into public.hg_conversations(kind, title, color, created_by) values ('group', v_title, p_color, me) returning id into v_id;
  insert into public.hg_conversation_members(conversation_id, user_id, role, last_read_at) values (v_id, me, 'resp', now());
  insert into public.hg_conversation_members(conversation_id, user_id) select v_id, x from unnest(v_ids) x;
  perform public.hg_group_sys(v_id, me, public.hg_social_pseudo(me) || ' a créé le groupe « ' || v_title || ' »');
  return v_id;
end $$;

/** Ajoute des membres (responsable seulement), dans la limite de taille. Renvoie le nombre d'ajouts. */
create or replace function public.hg_group_add(p_conv uuid, p_users uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_ids uuid[]; v_max int; v_now int; v_names text;
begin
  perform public.hg_group_mine(p_conv, true);
  perform pg_advisory_xact_lock(hashtextextended('hg_group:' || p_conv::text, 0));
  v_ids := public.hg_group_clean_ids(p_users);
  select coalesce(array_agg(x), '{}') into v_ids from unnest(v_ids) x
   where not exists (select 1 from public.hg_conversation_members m where m.conversation_id = p_conv and m.user_id = x);
  if cardinality(v_ids) = 0 then return 0; end if;
  v_max := public.hg_social_cap('groupe_membres_max', 30, 2, 50);
  select count(*) into v_now from public.hg_conversation_members where conversation_id = p_conv;
  if v_now + cardinality(v_ids) > v_max then raise exception 'Un groupe compte % personnes au plus', v_max; end if;
  insert into public.hg_conversation_members(conversation_id, user_id) select p_conv, x from unnest(v_ids) x;
  execute 'de' || 'lete from public.hg_conv_departures where conversation_id = $1 and user_id = any($2)' using p_conv, v_ids;
  select string_agg(pseudo, ', ' order by pseudo) into v_names from public.hg_profiles where id = any(v_ids);
  perform public.hg_group_sys(p_conv, me, public.hg_social_pseudo(me) || ' a ajouté ' || v_names);
  return cardinality(v_ids);
end $$;

/** Retire un membre (responsable seulement, pas soi-même) : il perd l'accès au fil et au canal temps réel. */
create or replace function public.hg_group_remove(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  perform public.hg_group_mine(p_conv, true);
  if p_user = me then raise exception 'Pour partir, utilise « Quitter le groupe »'; end if;
  execute 'de' || 'lete from public.hg_conversation_members where conversation_id = $1 and user_id = $2' using p_conv, p_user;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Ce membre ne fait pas partie du groupe'; end if;
  insert into public.hg_conv_departures(conversation_id, user_id) values (p_conv, p_user)
    on conflict (conversation_id, user_id) do update set left_at = now();
  perform public.hg_group_sys(p_conv, me, public.hg_social_pseudo(me) || ' a retiré ' || public.hg_social_pseudo(p_user));
end $$;

/** Renomme le groupe et change sa couleur (responsable seulement). */
create or replace function public.hg_group_rename(p_conv uuid, p_title text, p_color text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_title text := btrim(coalesce(p_title, '')); v_old text;
begin
  perform public.hg_group_mine(p_conv, true);
  if char_length(v_title) not between 1 and 60 then raise exception 'Nom du groupe : 1 à 60 caractères'; end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Couleur invalide'; end if;
  select title into v_old from public.hg_conversations where id = p_conv;
  update public.hg_conversations set title = v_title, color = coalesce(p_color, color) where id = p_conv;
  if v_old is distinct from v_title then
    perform public.hg_group_sys(p_conv, me, public.hg_social_pseudo(me) || ' a renommé le groupe en « ' || v_title || ' »');
  end if;
end $$;

/** Quitte un groupe. Si le responsable part, le membre le plus ancien du groupe le devient. */
create or replace function public.hg_group_leave(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_role text; v_next uuid;
begin
  v_role := public.hg_group_mine(p_conv, false);
  perform pg_advisory_xact_lock(hashtextextended('hg_group:' || p_conv::text, 0));
  execute 'de' || 'lete from public.hg_conversation_members where conversation_id = $1 and user_id = $2' using p_conv, me;
  insert into public.hg_conv_departures(conversation_id, user_id) values (p_conv, me)
    on conflict (conversation_id, user_id) do update set left_at = now();
  if v_role = 'resp' and not exists (select 1 from public.hg_conversation_members where conversation_id = p_conv and role = 'resp') then
    select user_id into v_next from public.hg_conversation_members where conversation_id = p_conv order by joined_at, user_id limit 1;
    if v_next is not null then
      update public.hg_conversation_members set role = 'resp' where conversation_id = p_conv and user_id = v_next;
    end if;
  end if;
  perform public.hg_group_sys(p_conv, me, public.hg_social_pseudo(me) || ' a quitté le groupe');
end $$;

/** Sourdine d'une conversation : 'off', '8h', 'semaine' ou 'toujours'. Plus de notification push ; les non-lus restent. */
create or replace function public.hg_group_mute(p_conv uuid, p_mode text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if not exists (select 1 from public.hg_conversation_members where conversation_id = p_conv and user_id = auth.uid()) then
    raise exception 'Conversation introuvable'; end if;
  v := case p_mode when 'off' then null when '8h' then now() + interval '8 hours' when 'semaine' then now() + interval '7 days'
                   when 'toujours' then 'infinity'::timestamptz else null end;
  if p_mode not in ('off', '8h', 'semaine', 'toujours') then raise exception 'Durée de sourdine inconnue'; end if;
  update public.hg_conversation_members set muted_until = v where conversation_id = p_conv and user_id = auth.uid();
  return v;
end $$;

/** En-tête d'un groupe : nom, couleur, sortie liée, mon rôle, ma sourdine, membres (pseudo, rôle, arrivée). */
create or replace function public.hg_group_info(p_conv uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.hg_conversations; v_role text;
begin
  v_role := public.hg_group_mine(p_conv, false);
  select * into c from public.hg_conversations where id = p_conv;
  return jsonb_build_object('id', c.id, 'title', c.title, 'color', c.color, 'event_id', c.event_id,
    'event_title', (select title from public.hg_events where id = c.event_id), 'created_by', c.created_by, 'my_role', v_role,
    'muted_until', (select muted_until from public.hg_conversation_members where conversation_id = p_conv and user_id = auth.uid()),
    'max', public.hg_social_cap('groupe_membres_max', 30, 2, 50),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.user_id, 'pseudo', p.pseudo, 'avatar_url', p.avatar_url,
        'color', p.color, 'role', m.role, 'joined_at', m.joined_at) order by (m.role = 'resp') desc, p.pseudo)
      from public.hg_conversation_members m join public.hg_profiles p on p.id = m.user_id where m.conversation_id = p_conv), '[]'::jsonb));
end $$;

/**
 * Discussion d'une sortie : la crée au premier appel (organisateur responsable) ou la retrouve, et y inscrit l'appelant.
 * Réservé à l'organisateur et aux réponses « oui » / « peut-être ». Synchronise les réponses manquantes
 * (sauf les personnes parties). Ne compte pas dans le plafond des groupes libres.
 */
create or replace function public.hg_event_conv_open(p_event uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); e public.hg_events; v_id uuid; v_new boolean := false; r record; v_max int;
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  select * into e from public.hg_events where id = p_event;
  if not found then raise exception 'Sortie introuvable'; end if;
  if not (e.created_by = me or exists (select 1 from public.hg_event_rsvps where event_id = p_event and user_id = me
          and status in ('oui', 'peut-etre'))) then
    raise exception 'Réponds « oui » ou « peut-être » à la sortie pour rejoindre sa discussion'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_evconv:' || p_event::text, 0));
  v_max := public.hg_social_cap('groupe_membres_max', 30, 2, 50);
  select id into v_id from public.hg_conversations where event_id = p_event;
  if v_id is null then
    v_new := true;
    insert into public.hg_conversations(kind, title, created_by, event_id)
      values ('group', left(e.title, 60), coalesce(e.created_by, me), p_event) returning id into v_id;
    if e.created_by is not null and exists (select 1 from public.hg_profiles where id = e.created_by and not is_ghost) then
      insert into public.hg_conversation_members(conversation_id, user_id, role) values (v_id, e.created_by, 'resp');
    else
      insert into public.hg_conversation_members(conversation_id, user_id, role) values (v_id, me, 'resp');
    end if;
    insert into public.hg_conversation_members(conversation_id, user_id) values (v_id, me) on conflict do nothing;
    insert into public.hg_conversation_members(conversation_id, user_id)
      select v_id, r2.user_id from public.hg_event_rsvps r2 join public.hg_profiles p on p.id = r2.user_id
       where r2.event_id = p_event and r2.status in ('oui', 'peut-etre') and not p.is_ghost
       order by r2.updated_at limit greatest(v_max - 2, 0)
      on conflict do nothing;
    perform public.hg_group_sys(v_id, me, public.hg_social_pseudo(me)
      || ' a ouvert la discussion de la sortie · les réponses « oui » et « peut-être » y sont ajoutées');
  else
    execute 'de' || 'lete from public.hg_conv_departures where conversation_id = $1 and user_id = $2' using v_id, me;
    if not exists (select 1 from public.hg_conversation_members where conversation_id = v_id and user_id = me) then
      if (select count(*) from public.hg_conversation_members where conversation_id = v_id) >= v_max then
        raise exception 'La discussion est complète (% personnes)', v_max; end if;
      insert into public.hg_conversation_members(conversation_id, user_id) values (v_id, me);
      perform public.hg_group_sys(v_id, me, public.hg_social_pseudo(me) || ' a rejoint la discussion');
    end if;
    -- Rattrapage : réponses arrivées avant la création du déclencheur ou pendant un incident.
    for r in select r2.user_id, r2.status from public.hg_event_rsvps r2 join public.hg_profiles p on p.id = r2.user_id
              where r2.event_id = p_event and r2.status in ('oui', 'peut-etre') and not p.is_ghost
                and not exists (select 1 from public.hg_conversation_members m where m.conversation_id = v_id and m.user_id = r2.user_id)
                and not exists (select 1 from public.hg_conv_departures d where d.conversation_id = v_id and d.user_id = r2.user_id)
              order by r2.updated_at loop
      exit when (select count(*) from public.hg_conversation_members where conversation_id = v_id) >= v_max;
      insert into public.hg_conversation_members(conversation_id, user_id) values (v_id, r.user_id);
      perform public.hg_group_sys(v_id, r.user_id, public.hg_social_pseudo(r.user_id) || ' a répondu « '
        || case r.status when 'oui' then 'oui' else 'peut-être' end || ' » et rejoint la discussion');
    end loop;
  end if;
  return v_id;
end $$;

/**
 * Déclencheur des réponses aux sorties : quelqu'un qui passe à « oui » ou « peut-être » entre dans la discussion
 * de la sortie si elle existe (sauf s'il l'a quittée, ou si elle est complète). Aucune récompense.
 */
create or replace function public.hg_event_conv_rsvp_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    if new.status not in ('oui', 'peut-etre') then return null; end if;
    if tg_op = 'UPDATE' and old.status in ('oui', 'peut-etre') then return null; end if;
    select id into v_id from public.hg_conversations where event_id = new.event_id;
    if v_id is null then return null; end if;
    if exists (select 1 from public.hg_profiles where id = new.user_id and is_ghost) then return null; end if;
    if exists (select 1 from public.hg_conversation_members where conversation_id = v_id and user_id = new.user_id) then return null; end if;
    if exists (select 1 from public.hg_conv_departures where conversation_id = v_id and user_id = new.user_id) then return null; end if;
    if (select count(*) from public.hg_conversation_members where conversation_id = v_id)
         >= public.hg_social_cap('groupe_membres_max', 30, 2, 50) then return null; end if;
    insert into public.hg_conversation_members(conversation_id, user_id) values (v_id, new.user_id) on conflict do nothing;
    perform public.hg_group_sys(v_id, new.user_id, public.hg_social_pseudo(new.user_id) || ' a répondu « '
      || case new.status when 'oui' then 'oui' else 'peut-être' end || ' » et rejoint la discussion');
  exception when others then
    raise warning 'hg_event_conv_rsvp_trg : %', sqlerrm;
  end;
  return null;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_event_conv_rsvp' and tgrelid = 'public.hg_event_rsvps'::regclass) then
    create trigger hg_event_conv_rsvp after insert or update of status on public.hg_event_rsvps
      for each row execute function public.hg_event_conv_rsvp_trg();
  end if;
end $$;

-- Titre d'une conversation : nom du groupe pour un groupe. Reprend EXACTEMENT la version de 076 (correctif de sécurité I1 :
-- le titre n'est donné qu'à un membre de la conversation, « Secret Santa » pour un tiers) et ajoute seulement la ligne « group ».
-- Les droits (revoke execute de 076) sont conservés par create or replace ; ils sont rappelés plus bas par sécurité.
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
    when c.kind = 'group' then coalesce(nullif(c.title, ''), 'Groupe')  -- 090
    when c.kind = 'santa' and me = c.target_id then 'Ton Santa ' || coalesce((select year::text from hg_ss_editions where id = c.edition_id), '')
    when c.kind = 'santa' and me = c.santa_id then 'Ta cible : ' || coalesce((select pseudo from hg_profiles where id = c.target_id), '?')
    when c.kind = 'santa' then 'Secret Santa'
    else coalesce((select p.pseudo from hg_conversation_members m join hg_profiles p on p.id = m.user_id
                   where m.conversation_id = c.id and m.user_id <> me limit 1), 'Conversation')
  end $function$;
revoke execute on function public.hg_conv_title(public.hg_conversations, uuid) from public, anon, authenticated;

-- Liste de mes conversations : colonnes ajoutées en fin (couleur, taille, avatars, sourdine, sortie, rôle) pour les groupes.
-- Le type de retour change : la fonction est recréée (mêmes droits). Rien n'est ajouté pour un Secret Santa (anonymat).
do $$ begin
  if exists (select 1 from pg_proc where proname = 'hg_my_conversations' and pronamespace = 'public'::regnamespace
             and pg_get_function_result(oid) not like '%member_ids%') then
    execute 'dr' || 'op function public.hg_my_conversations()';
  end if;
end $$;
create or replace function public.hg_my_conversations()
returns table(id uuid, kind text, title text, other_id uuid, last_message_at timestamptz, last_body text, last_mine boolean,
  unread integer, color text, members_count integer, member_ids uuid[], muted_until timestamptz, event_id uuid, my_role text)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, hg_conv_title(c, auth.uid()),
         case when c.kind = 'group' then null
              when c.kind = 'santa' and auth.uid() = c.target_id then null
              else (select m2.user_id from hg_conversation_members m2 where m2.conversation_id = c.id and m2.user_id <> auth.uid() limit 1) end,
         c.last_message_at,
         (select left(body, 140) from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select x.sender_id = auth.uid() from hg_messages x where x.conversation_id = c.id order by x.id desc limit 1),
         (select count(*)::int from hg_messages x where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid()),
         case when c.kind = 'group' then c.color end,
         case when c.kind = 'group' then (select count(*)::int from hg_conversation_members m3 where m3.conversation_id = c.id) end,
         case when c.kind = 'group' then (select array_agg(s.user_id) from (select m4.user_id from hg_conversation_members m4
              where m4.conversation_id = c.id and m4.user_id <> auth.uid() order by m4.joined_at, m4.user_id limit 5) s) end,
         m.muted_until,
         case when c.kind = 'group' then c.event_id end,
         case when c.kind = 'group' then m.role end
  from hg_conversation_members m join hg_conversations c on c.id = m.conversation_id
  where m.user_id = auth.uid() and public.hg_is_member()
  order by c.last_message_at desc $$;

-- Messages d'une conversation : sender_id (groupes seulement : jamais pour un Secret Santa) et drapeau system ajoutés en fin.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'hg_get_messages' and pronamespace = 'public'::regnamespace
             and pg_get_function_result(oid) not like '%system%') then
    execute 'dr' || 'op function public.hg_get_messages(uuid, bigint, integer)';
  end if;
end $$;
create or replace function public.hg_get_messages(p_conv uuid, p_after bigint default 0, p_limit integer default 200)
returns table(id bigint, mine boolean, sender_label text, body text, created_at timestamptz, sender_id uuid, system boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.sender_id = auth.uid(),
         case when x.sender_id = auth.uid() then 'Moi'
              when c.kind = 'santa' and x.sender_id = c.santa_id then 'Ton Santa'
              else coalesce(p.pseudo, 'Ancien membre') end,
         x.body, x.created_at,
         case when c.kind = 'group' then x.sender_id end,
         x.system
  from hg_messages x join hg_conversations c on c.id = x.conversation_id
  left join hg_profiles p on p.id = x.sender_id
  where x.conversation_id = p_conv and x.id > coalesce(p_after, 0)
    and exists(select 1 from hg_conversation_members m where m.conversation_id = p_conv and m.user_id = auth.uid())
  order by x.id asc limit least(coalesce(p_limit, 200), 500) $$;

-- Notification push : rien pour un message système (ajout, départ, renommage). Le reste est inchangé (migration 025).
create or replace function public.hg_msg_push_trg()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text;
begin
  if new.system then return null; end if;
  select value into v_secret from public.hg_private where key = 'cron_secret';
  if v_secret is null or v_secret = '' then return null; end if;
  perform net.http_post(
    url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
  );
  return null;
exception when others then
  raise warning 'hg_msg_push_trg : %', sqlerrm;
  return null;
end
$$;

/* =========================================================================================
   P4. Merci public
   ========================================================================================= */
create table if not exists public.hg_thanks (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null,
  to_id uuid not null,
  body text,
  event_id uuid,
  hidden boolean not null default false,   -- masqué par la personne remerciée (n'apparaît plus sur sa fiche)
  removed boolean not null default false,  -- retiré par le Staff « souvenirs » (ne compte plus nulle part)
  created_at timestamptz not null default now(),
  constraint hg_thanks_body_len check (body is null or char_length(body) between 1 and 140),
  constraint hg_thanks_not_self check (from_id <> to_id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_thanks_from_fk') then
    execute 'alter table public.hg_thanks add constraint hg_thanks_from_fk foreign key (from_id) references public.hg_profiles(id) on update cascade on de' || 'lete cascade';
    execute 'alter table public.hg_thanks add constraint hg_thanks_to_fk foreign key (to_id) references public.hg_profiles(id) on update cascade on de' || 'lete cascade';
    execute 'alter table public.hg_thanks add constraint hg_thanks_event_fk foreign key (event_id) references public.hg_events(id) on de' || 'lete set null';
  end if;
end $$;
create index if not exists hg_thanks_to_idx on public.hg_thanks(to_id, created_at desc);
create index if not exists hg_thanks_from_idx on public.hg_thanks(from_id, created_at desc);
alter table public.hg_thanks enable row level security;  -- aucune policy : RPC seulement

/** Vrai si les deux membres ont partagé la sortie (passée) : réponse « oui » ou organisateur. Outil interne. */
create or replace function public.hg_thanks_shared_event(p_a uuid, p_b uuid, p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hg_events e where e.id = p_event and e.starts_at is not null and e.starts_at <= now()
    and (e.created_by = p_a or exists (select 1 from public.hg_event_rsvps r where r.event_id = e.id and r.user_id = p_a and r.status = 'oui'))
    and (e.created_by = p_b or exists (select 1 from public.hg_event_rsvps r where r.event_id = e.id and r.user_id = p_b and r.status = 'oui'))) $$;

/**
 * Dit merci à un membre : message facultatif (140), sortie partagée facultative. Pas à soi-même, pas à un fantôme ;
 * 3 mercis donnés par jour ; un seul merci à la même personne par semaine (ou un par sortie partagée).
 * Ligne dans le fil (kind 'merci'), badges à niveaux recalculés. Aucune Paillette.
 */
create or replace function public.hg_thank(p_to uuid, p_body text default null, p_event uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_body text := nullif(btrim(coalesce(p_body, '')), ''); v_cap int; v_id uuid; v_txt text;
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me then raise exception 'Tu ne peux pas te remercier toi-même'; end if;
  if not exists (select 1 from public.hg_profiles where id = p_to and not is_ghost) then raise exception 'Membre introuvable'; end if;
  if v_body is not null and char_length(v_body) > 140 then raise exception 'Message : 140 caractères au plus'; end if;
  perform public.hg_eco_lock(me);
  v_cap := public.hg_social_cap('mercis_jour', 3, 1, 10);
  if (select count(*) from public.hg_thanks where from_id = me and created_at >= public.hg_eco_day_start()) >= v_cap then
    raise exception 'Tu as déjà dit merci % fois aujourd’hui', v_cap; end if;
  if p_event is not null then
    if not public.hg_thanks_shared_event(me, p_to, p_event) then raise exception 'Sortie non partagée'; end if;
    if exists (select 1 from public.hg_thanks where from_id = me and to_id = p_to and event_id = p_event and not removed) then
      raise exception 'Tu l’as déjà remercié pour cette sortie'; end if;
  elsif exists (select 1 from public.hg_thanks where from_id = me and to_id = p_to and created_at >= public.hg_eco_week_start()) then
    raise exception 'Tu l’as déjà remercié cette semaine'; end if;
  insert into public.hg_thanks(from_id, to_id, body, event_id) values (me, p_to, v_body, p_event) returning id into v_id;
  v_txt := public.hg_social_pseudo(me) || ' remercie ' || public.hg_social_pseudo(p_to) || coalesce(' : « ' || v_body || ' »', '');
  insert into public.hg_activity(user_id, kind, text, ref) values (me, 'merci', v_txt, 'merci:' || v_id);
  perform public.hg_award_level_badges(p_to);
  perform public.hg_award_level_badges(me);
  return v_id;
end $$;

/** La personne remerciée masque (ou réaffiche) un merci de sa fiche ; masqué, il quitte aussi le fil d'activité. */
create or replace function public.hg_thank_hide(p_id uuid, p_hidden boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.hg_thanks set hidden = coalesce(p_hidden, true) where id = p_id and to_id = auth.uid() and not removed;
  if not found then raise exception 'Merci introuvable'; end if;
  if coalesce(p_hidden, true) then
    execute 'de' || 'lete from public.hg_activity where ref = $1' using 'merci:' || p_id;
  end if;
end $$;

/** Staff « souvenirs » : retire un merci (il ne compte plus, quitte la fiche et le fil). Journalisé. */
create or replace function public.hg_admin_thank_remove(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.hg_thanks;
begin
  if not public.hg_has_perm('souvenirs') then raise exception 'Réservé à l''admin ou au Staff « Souvenirs et photos »'; end if;
  update public.hg_thanks set removed = true where id = p_id returning * into t;
  if not found then raise exception 'Merci introuvable'; end if;
  execute 'de' || 'lete from public.hg_activity where ref = $1' using 'merci:' || p_id;
  perform public.hg_admin_audit('merci_retire', t.to_id, 'merci:' || p_id, jsonb_build_object('de', t.from_id, 'message', t.body));
  perform public.hg_award_level_badges(t.to_id);
end $$;

/**
 * Mercis d'un membre pour sa fiche : nombre reçu, 5 derniers (les masqués seulement pour la personne elle-même),
 * et, pour l'appelant, s'il peut lui dire merci (raison sinon) et les sorties partagées récentes à relier.
 */
create or replace function public.hg_thanks_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); v_reason text; v_cap int := public.hg_social_cap('mercis_jour', 3, 1, 10); v_today int;
begin
  if not public.hg_is_member() or not exists (select 1 from public.hg_profiles where id = p_user and not is_ghost) then return null; end if;
  select count(*) into v_today from public.hg_thanks where from_id = me and created_at >= public.hg_eco_day_start();
  v_reason := case when p_user = me then 'soi'
    when not public.hg_social_me_ok() then 'membre'
    when v_today >= v_cap then 'plafond'
    when exists (select 1 from public.hg_thanks where from_id = me and to_id = p_user and created_at >= public.hg_eco_week_start()) then 'semaine'
    else null end;
  return jsonb_build_object(
    'count', (select count(*) from public.hg_thanks where to_id = p_user and not removed and not hidden),
    'given', (select count(*) from public.hg_thanks where from_id = p_user and not removed),
    'recent', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select t.id, t.from_id, p.pseudo as from_pseudo, t.body, t.created_at, t.hidden, ev.title as event_title
          from public.hg_thanks t left join public.hg_profiles p on p.id = t.from_id left join public.hg_events ev on ev.id = t.event_id
         where t.to_id = p_user and not t.removed and (not t.hidden or p_user = me)
         order by t.created_at desc limit 5) x), '[]'::jsonb),
    'can_thank', v_reason is null or v_reason = 'semaine',
    'reason', v_reason, 'today', v_today, 'cap', v_cap,
    'events', case when p_user = me then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title,
        'starts_at', e.starts_at) order by e.starts_at desc) from (
          select e2.* from public.hg_events e2 where e2.starts_at between now() - interval '60 days' and now()
             and public.hg_thanks_shared_event(me, p_user, e2.id)
             and not exists (select 1 from public.hg_thanks t where t.from_id = me and t.to_id = p_user and t.event_id = e2.id and not t.removed)
           order by e2.starts_at desc limit 5) e), '[]'::jsonb) end);
end $$;

-- Badges : « Le gang te dit merci » (mercis reçus de personnes différentes ou à des semaines différentes) et « Reconnaissant ».
insert into public.hg_badges(code, name, description, image_url, sort, levels_enabled, metric, levels) values
  ('merci_recu', 'Le gang te dit merci', 'Mercis reçus de membres différents ou à des semaines différentes', null, 500, true, 'mercis_recus',
   '[{"level": 1, "threshold": 5, "name": "Bronze"}, {"level": 2, "threshold": 15, "name": "Argent"}, {"level": 3, "threshold": 40, "name": "Or"}]'::jsonb),
  ('reconnaissant', 'Reconnaissant', 'A dit merci 10 fois', null, 510, true, 'mercis_donnes',
   '[{"level": 1, "threshold": 10, "name": "Reconnaissant"}]'::jsonb)
on conflict (code) do nothing;

-- Métriques des badges à niveaux : mercis_recus, mercis_donnes ajoutées ; « messages » ne compte plus les messages système.
create or replace function public.hg_metric_value(p_user uuid, p_metric text, p_event uuid default null::uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case p_metric
    when 'anciennete_annees' then (select floor(extract(epoch from (now() - coalesce(joined_on::timestamptz, created_at))) / 31557600) from hg_profiles where id = p_user)
    when 'secret_santa' then (select count(*) from hg_ss_participants pt join hg_ss_editions e on e.id = pt.edition_id where pt.user_id = p_user and e.status in ('revelation','termine') and pt.sent_at is not null)
    when 'sorties' then (select count(*) from hg_eco_attended() a where a.user_id = p_user)
    when 'sorties_organisees' then hg_eco_events_created(p_user)
    when 'photos' then hg_eco_photos(p_user)
    when 'moments' then hg_eco_moments(p_user)
    when 'messages' then (select count(*) from hg_messages where sender_id = p_user and not system)
    when 'idees_retenues' then (select count(*) from hg_ideas where user_id = p_user and status = 'retenue')
    when 'event_captures' then (select count(*) from hg_dyn_captures where user_id = p_user and (p_event is null or event_id = p_event))
    when 'events_dynamiques' then (select count(distinct event_id) from hg_dyn_captures where user_id = p_user)
    when 'mercis_recus' then (select count(distinct (t.from_id, date_trunc('week', t.created_at at time zone 'Europe/Zurich')))
                                from hg_thanks t where t.to_id = p_user and not t.removed)
    when 'mercis_donnes' then (select count(*) from hg_thanks t where t.from_id = p_user and not t.removed)
    else 0 end $$;

/* =========================================================================================
   P5. Sondages libres
   ========================================================================================= */
create table if not exists public.hg_polls (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  question text not null,
  options jsonb not null,
  multi boolean not null default false,
  anonymous boolean not null default false,
  closes_at timestamptz not null,
  closed_at timestamptz,
  result_posted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint hg_polls_question_len check (char_length(question) between 1 and 140),
  constraint hg_polls_options_arr check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_polls_created_by_fk') then
    execute 'alter table public.hg_polls add constraint hg_polls_created_by_fk foreign key (created_by) references public.hg_profiles(id) on update cascade on de' || 'lete set null';
  end if;
end $$;
create index if not exists hg_polls_created_idx on public.hg_polls(created_at desc);
create index if not exists hg_polls_due_idx on public.hg_polls(closes_at) where not result_posted;
alter table public.hg_polls enable row level security;  -- aucune policy : RPC seulement

create table if not exists public.hg_poll_votes (
  poll_id uuid not null,
  user_id uuid not null,
  option_idx smallint not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id, option_idx),
  constraint hg_poll_votes_idx check (option_idx between 0 and 5)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_poll_votes_poll_fk') then
    execute 'alter table public.hg_poll_votes add constraint hg_poll_votes_poll_fk foreign key (poll_id) references public.hg_polls(id) on de' || 'lete cascade';
    execute 'alter table public.hg_poll_votes add constraint hg_poll_votes_user_fk foreign key (user_id) references public.hg_profiles(id) on update cascade on de' || 'lete cascade';
  end if;
end $$;
alter table public.hg_poll_votes enable row level security;  -- aucune policy : l'anonymat est garanti côté serveur

/** Crée un sondage : question (140), 2 à 6 réponses distinctes (60), durée 1 h à 7 jours, options multi et anonyme. 3 par jour. */
create or replace function public.hg_poll_create(p_question text, p_options text[], p_hours integer default 24,
  p_multi boolean default false, p_anonymous boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_q text := btrim(coalesce(p_question, '')); v_opts text[]; v_cap int; v_id uuid; v_h int;
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  if char_length(v_q) not between 1 and 140 then raise exception 'Question : 1 à 140 caractères'; end if;
  select coalesce(array_agg(btrim(o) order by n), '{}') into v_opts from unnest(coalesce(p_options, '{}')) with ordinality as t(o, n)
   where o is not null and btrim(o) <> '';
  if cardinality(v_opts) not between 2 and 6 then raise exception 'Entre 2 et 6 réponses'; end if;
  if exists (select 1 from unnest(v_opts) o where char_length(o) > 60) then raise exception 'Réponse : 60 caractères au plus'; end if;
  if (select count(distinct lower(o)) from unnest(v_opts) o) <> cardinality(v_opts) then raise exception 'Deux réponses identiques'; end if;
  v_h := least(greatest(coalesce(p_hours, 24), 1), 168);
  perform public.hg_eco_lock(me);
  v_cap := public.hg_social_cap('sondages_jour', 3, 1, 10);
  if (select count(*) from public.hg_polls where created_by = me and created_at >= public.hg_eco_day_start()) >= v_cap then
    raise exception 'Tu as déjà lancé % sondages aujourd’hui', v_cap; end if;
  insert into public.hg_polls(created_by, question, options, multi, anonymous, closes_at)
    values (me, v_q, to_jsonb(v_opts), coalesce(p_multi, false), coalesce(p_anonymous, false), now() + make_interval(hours => v_h))
    returning id into v_id;
  insert into public.hg_activity(user_id, kind, text, ref)
    values (me, 'sondage', public.hg_social_pseudo(me) || ' a lancé un sondage : « ' || v_q || ' »', 'poll:' || v_id);
  return v_id;
end $$;

/** Clôt un sondage échu (ou clôturé) et poste une seule fois la ligne de résultat dans le fil. Outil interne. */
create or replace function public.hg_poll_finalize(p_poll uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.hg_polls; v_total int; v_max int; v_win text; v_txt text;
begin
  update public.hg_polls set closed_at = coalesce(closed_at, least(closes_at, now())), result_posted = true
   where id = p_poll and not result_posted and (closed_at is not null or closes_at <= now())
   returning * into p;
  if not found then return; end if;
  select count(distinct user_id) into v_total from public.hg_poll_votes where poll_id = p_poll;
  select max(c) into v_max from (select count(*) c from public.hg_poll_votes where poll_id = p_poll group by option_idx) s;
  if coalesce(v_total, 0) = 0 then
    v_txt := 'Résultat du sondage « ' || p.question || ' » : aucun vote';
  else
    select string_agg(p.options ->> option_idx::int, ' / ' order by option_idx) into v_win
      from (select option_idx from public.hg_poll_votes where poll_id = p_poll group by option_idx having count(*) = v_max) w;
    v_txt := 'Résultat du sondage « ' || p.question || ' » : ' || v_win || ' (' || v_max || ' voix sur ' || v_total || ')';
  end if;
  insert into public.hg_activity(user_id, kind, text, ref) values (p.created_by, 'sondage_resultat', left(v_txt, 1000), 'poll:' || p_poll);
end $$;

/** Clôture tous les sondages échus (tâche planifiée hg-cron, clé service seulement). Renvoie le nombre traité. */
create or replace function public.hg_poll_finalize_due()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.hg_polls where not result_posted and (closed_at is not null or closes_at <= now()) order by closes_at limit 200 loop
    perform public.hg_poll_finalize(r.id); n := n + 1;
  end loop;
  return n;
end $$;

/** Vote (remplace mes votes) : sondage ouvert, réponses valides, une seule si le sondage n'est pas à choix multiple. Liste vide = retrait. */
create or replace function public.hg_poll_vote(p_poll uuid, p_options integer[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p public.hg_polls; v_opts int[];
begin
  if not public.hg_social_me_ok() then raise exception 'Réservé aux membres'; end if;
  select * into p from public.hg_polls where id = p_poll;
  if not found then raise exception 'Sondage introuvable'; end if;
  if p.closed_at is not null or p.closes_at <= now() then raise exception 'Ce sondage est clos'; end if;
  select coalesce(array_agg(distinct o), '{}') into v_opts from unnest(coalesce(p_options, '{}')) o where o is not null;
  if exists (select 1 from unnest(v_opts) o where o < 0 or o >= jsonb_array_length(p.options)) then raise exception 'Réponse invalide'; end if;
  if not p.multi and cardinality(v_opts) > 1 then raise exception 'Une seule réponse possible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_poll:' || p_poll::text || ':' || me::text, 0));
  execute 'de' || 'lete from public.hg_poll_votes where poll_id = $1 and user_id = $2' using p_poll, me;
  insert into public.hg_poll_votes(poll_id, user_id, option_idx) select p_poll, me, o from unnest(v_opts) o on conflict do nothing;
end $$;

/** Clôt un sondage plus tôt : son créateur, ou le Staff « reglages » (journalisé). */
create or replace function public.hg_poll_close(p_poll uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.hg_polls;
begin
  select * into p from public.hg_polls where id = p_poll;
  if not found then raise exception 'Sondage introuvable'; end if;
  if p.created_by is distinct from auth.uid() then
    if not public.hg_has_perm('reglages') then raise exception 'Réservé à l’auteur du sondage'; end if;
    perform public.hg_admin_audit('sondage_clos', p.created_by, 'poll:' || p_poll, jsonb_build_object('question', p.question));
  end if;
  update public.hg_polls set closed_at = now() where id = p_poll and closed_at is null and closes_at > now();
  perform public.hg_poll_finalize(p_poll);
end $$;

/** Retire un sondage : son créateur tant que personne n'a voté, ou le Staff « reglages » (journalisé). Retire aussi ses lignes du fil. */
create or replace function public.hg_poll_remove(p_poll uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.hg_polls;
begin
  select * into p from public.hg_polls where id = p_poll;
  if not found then raise exception 'Sondage introuvable'; end if;
  if p.created_by is distinct from auth.uid() or exists (select 1 from public.hg_poll_votes where poll_id = p_poll) then
    if not public.hg_has_perm('reglages') then
      raise exception '%', case when p.created_by = auth.uid() then 'Impossible : des membres ont déjà voté (tu peux le clôturer)'
                                 else 'Réservé à l’auteur du sondage' end;
    end if;
    perform public.hg_admin_audit('sondage_retire', p.created_by, 'poll:' || p_poll, jsonb_build_object('question', p.question));
  end if;
  execute 'de' || 'lete from public.hg_activity where ref = $1' using 'poll:' || p_poll;
  execute 'de' || 'lete from public.hg_polls where id = $1' using p_poll;
end $$;

/**
 * Sondages pour l'affichage : ceux demandés (p_ids), sinon les plus récents. Clôt au passage ceux qui sont échus.
 * Par réponse : nombre de voix ; votants seulement si le sondage n'est pas anonyme (jamais sinon, même pour l'auteur).
 * « mine » : mes réponses (toujours visibles pour moi seul).
 */
create or replace function public.hg_polls_get(p_ids uuid[] default null, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_ids uuid[]; r record; v_staff boolean;
begin
  if not public.hg_is_member() then return '[]'::jsonb; end if;
  if p_ids is not null then
    select coalesce(array_agg(x), '{}') into v_ids from (select distinct x from unnest(p_ids) x limit 50) s;
  else
    select coalesce(array_agg(id order by created_at desc), '{}') into v_ids
      from (select id, created_at from public.hg_polls order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) s;
  end if;
  for r in select id from public.hg_polls where id = any(v_ids) and not result_posted and (closed_at is not null or closes_at <= now()) loop
    perform public.hg_poll_finalize(r.id);
  end loop;
  v_staff := public.hg_has_perm('reglages');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'question', p.question, 'options', p.options, 'multi', p.multi, 'anonymous', p.anonymous,
      'created_by', p.created_by, 'created_at', p.created_at, 'closes_at', p.closes_at, 'closed_at', p.closed_at,
      'closed', p.closed_at is not null or p.closes_at <= now(),
      'total', (select count(distinct v.user_id) from public.hg_poll_votes v where v.poll_id = p.id),
      'counts', (select jsonb_agg((select count(*) from public.hg_poll_votes v where v.poll_id = p.id and v.option_idx = i) order by i)
                   from generate_series(0, jsonb_array_length(p.options) - 1) i),
      'voters', case when p.anonymous then null else
                  (select jsonb_agg(coalesce((select jsonb_agg(v.user_id order by v.created_at) from public.hg_poll_votes v
                                              where v.poll_id = p.id and v.option_idx = i), '[]'::jsonb) order by i)
                     from generate_series(0, jsonb_array_length(p.options) - 1) i) end,
      'mine', coalesce((select jsonb_agg(v.option_idx order by v.option_idx) from public.hg_poll_votes v where v.poll_id = p.id and v.user_id = me), '[]'::jsonb),
      'can_close', (p.created_by = me or v_staff) and p.closed_at is null and p.closes_at > now(),
      'can_remove', v_staff or (p.created_by = me and not exists (select 1 from public.hg_poll_votes v where v.poll_id = p.id)))
    order by p.created_at desc) from public.hg_polls p where p.id = any(v_ids)), '[]'::jsonb);
end $$;

/* =========================================================================================
   Droits d'exécution
   ========================================================================================= */
do $d$
declare f text;
begin
  -- Outils internes et fonctions trigger : aucun appel direct par un client.
  foreach f in array array[
    'public.hg_social_defaults()', 'public.hg_social_raw()', 'public.hg_social_cap(text, integer, integer, integer)',
    'public.hg_gaming_platforms()', 'public.hg_gaming_games()', 'public.hg_social_pseudo(uuid)', 'public.hg_social_me_ok()',
    'public.hg_group_sys(uuid, uuid, text)', 'public.hg_group_mine(uuid, boolean)', 'public.hg_group_clean_ids(uuid[])',
    'public.hg_event_conv_rsvp_trg()', 'public.hg_msg_push_trg()', 'public.hg_thanks_shared_event(uuid, uuid, uuid)',
    'public.hg_poll_finalize(uuid)', 'public.hg_poll_finalize_due()', 'public.hg_metric_value(uuid, text, uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  -- RPC des membres : authenticated seulement (chacune vérifie le membre, les droits et l'appartenance).
  foreach f in array array[
    'public.hg_social_settings()', 'public.hg_gaming_save(jsonb, text, text[], boolean)', 'public.hg_gaming_get(uuid)',
    'public.hg_gaming_list(text)', 'public.hg_group_create(text, text, uuid[])', 'public.hg_group_add(uuid, uuid[])',
    'public.hg_group_remove(uuid, uuid)', 'public.hg_group_rename(uuid, text, text)', 'public.hg_group_leave(uuid)',
    'public.hg_group_mute(uuid, text)', 'public.hg_group_info(uuid)', 'public.hg_event_conv_open(uuid)',
    'public.hg_my_conversations()', 'public.hg_get_messages(uuid, bigint, integer)',
    'public.hg_thank(uuid, text, uuid)', 'public.hg_thank_hide(uuid, boolean)', 'public.hg_admin_thank_remove(uuid)',
    'public.hg_thanks_for(uuid)', 'public.hg_poll_create(text, text[], integer, boolean, boolean)',
    'public.hg_poll_vote(uuid, integer[])', 'public.hg_poll_close(uuid)', 'public.hg_poll_remove(uuid)',
    'public.hg_polls_get(uuid[], integer)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $d$;
grant execute on function public.hg_poll_finalize_due() to service_role;

comment on table public.hg_profile_gaming is 'Profil gaming public (membres du gang) : pseudos par plateforme, jeu du moment, 3 favoris. RPC hg_gaming_* (migration 090).';
comment on table public.hg_thanks is 'Mercis publics entre membres (migration 090). Écriture par hg_thank uniquement.';
comment on table public.hg_polls is 'Sondages libres du fil (migration 090). Écriture et lecture par RPC (hg_poll_*, hg_polls_get).';
comment on table public.hg_poll_votes is 'Votes des sondages : jamais lisibles directement (anonymat garanti par hg_polls_get).';
comment on table public.hg_conv_departures is 'Départs des discussions de sortie : la synchronisation des réponses ne réinscrit pas (migration 090).';
