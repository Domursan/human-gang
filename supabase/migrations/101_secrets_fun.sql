-- ===== Humane Gang — 101 : secrets « clins d'œil du gang » (catégorie F : F1, F4, F5, F6, F7, F8, F9) =====
-- S'applique après 096. Idempotente. Tout reste anonyme (aucun pseudo ni prénom dans les textes).
-- Nouveaux codes de hg_egg_found (récompense lue dans hg_settings.eggs.recompenses, valeurs par défaut ci-dessous) :
--   tzatziki      F1  « tzatzikistan » tapé n'importe où          once   25  carte « Drapeau du Tzatzikistan »
--   champi_<saison> F4 champignon de la saison (vérifiée ici)      once   20  les 4 saisons : carte « Mycena » + badge « Cueilleur »
--   livre         F5  triple clic sur l'affiche d'un film vu        once   10  carte « Le Projectionniste »
--   kc            F6  « kc » tapé n'importe où                       once   10
--   creeper       F7  monstre vert touché à temps (toutes pages)    jour    1
--   serge         F8  « serge » tapé n'importe où                    once   25  carte « Le Maître de Serge »
--   domumobile    F8  « domu » tapé n'importe où                     once   15  carte « La Domu-mobile »
-- F9 : badge à niveaux « Pentakill » (1, 3, 10) : hg_pentakill_check() vérifie la dernière ouverture du membre.
-- hg_eggs_count regroupe champi_% (comme lettre_%) ; hg_eggs_me calcule le total au lieu du 12 écrit en dur.

-- 1. Cartes de la série Secrets (jamais en booster, non fabricables, échangeables)
do $c$
declare sid uuid := (select id from hg_card_sets where code = 'secrets');
begin
  if sid is null then return; end if;
  insert into hg_cards (set_id, number, name, rarity, family, flavor, craftable, tradeable, can_shiny, active)
  select sid, v.n, v.name, v.rarity, v.family, v.flavor, false, true, v.shiny, true
  from (values
    (3, 'Drapeau du Tzatzikistan', 'rare', 'objet', 'Fond blanc, bande concombre, une gousse d''ail. Population : le gang.', false),
    (4, 'Mycena', 'epique', 'objet', 'Certains brillent dans le noir. Quatre saisons pour les trouver tous.', true),
    (5, 'Le Projectionniste', 'epique', 'objet', 'Dimanche, 21 h. Le vote est clos, la séance commence.', false),
    (6, 'Le Maître de Serge', 'legendaire', 'objet', 'Les règles de la campagne sont non négociables.', false),
    (7, 'La Domu-mobile', 'rare', 'objet', 'Quatre places, cinq passagers, une playlist.', false)
  ) v(n, name, rarity, family, flavor, shiny)
  where not exists (select 1 from hg_cards k where k.set_id = sid and k.name = v.name);
end $c$;

-- 2. Badges : Cueilleur (F4) et Pentakill à niveaux (F9)
insert into hg_badges (code, name, description, sort)
  select 'cueilleur', 'Cueilleur', 'A trouvé le champignon caché des quatre saisons.', 900
  where not exists (select 1 from hg_badges where code = 'cueilleur');
insert into hg_badges (code, name, description, sort, levels_enabled, metric, levels)
  select 'pentakill', 'Pentakill', 'Un booster de 5 cartes parfait : 5 cartes de même rareté (rare ou mieux), ou 5 cartes jamais possédées.', 901,
    true, 'pentakills', '[{"level":1,"threshold":1},{"level":2,"threshold":3},{"level":3,"threshold":10}]'::jsonb
  where not exists (select 1 from hg_badges where code = 'pentakill');

-- 3. Pentakills enregistrés (une ligne par ouverture)
create table if not exists public.hg_pentakills (
  open_id bigint primary key,
  user_id uuid not null,
  kind text not null check (kind in ('rarete', 'nouvelles')),
  created_at timestamptz not null default now()
);
create index if not exists hg_pentakills_user on public.hg_pentakills (user_id);
alter table public.hg_pentakills enable row level security;
revoke all on public.hg_pentakills from public, anon, authenticated;

-- Saison de Zurich (printemps, ete, automne, hiver).
create or replace function public.hg_zurich_season()
returns text language sql stable set search_path to 'public' as $$
  select case when m between 3 and 5 then 'printemps' when m between 6 and 8 then 'ete' when m between 9 and 11 then 'automne' else 'hiver' end
  from (select extract(month from now() at time zone 'Europe/Zurich')::int m) x $$;

-- 4. Comptage des secrets trouvés (lettres et champignons regroupés)
create or replace function public.hg_eggs_count(p_user uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(distinct case when egg like 'lettre_%' then 'lettres' when egg like 'champi_%' then 'champis' else egg end)::int
  from hg_egg_log where user_id = p_user and egg not in ('lettres', 'champis') $$;

create or replace function public.hg_eggs_me()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  return jsonb_build_object('found', hg_eggs_count(auth.uid()),
    -- konami, logo, humane, jeu404, heure_gang, anniversaire, console, lettres, secousse, nuit, rembobine (11)
    -- + tzatziki, champis, livre, kc, creeper, serge, domumobile (7)
    'total', 18,
    'eggs', coalesce((select jsonb_agg(jsonb_build_object('egg', egg, 'first', first) order by first)
      from (select egg, min(found_at) first from hg_egg_log where user_id = auth.uid() group by egg) z), '[]'::jsonb),
    'letters', (select count(distinct egg) from hg_egg_log where user_id = auth.uid() and egg like 'lettre_%'),
    'champis', (select count(distinct egg) from hg_egg_log where user_id = auth.uid() and egg like 'champi\_%' escape '\'));
end $$;

-- 5. Réglages publics des secrets : + champignon de la saison en cours (page et anecdote), jamais les autres saisons
create or replace function public.hg_eggs_public()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when not hg_is_member() then '{}'::jsonb else jsonb_build_object(
    'recompenses', coalesce(s.value->'recompenses', '{}'::jsonb),
    'anniversaire_aujourdhui', coalesce(s.value->>'anniversaire_gang', '') = to_char(now() at time zone 'Europe/Zurich', 'MM-DD'),
    'anniversaire_age', (a->>'age')::int,
    'anniversaire_fenetre', coalesce((a->>'dans_fenetre')::boolean, false),
    'champi', jsonb_build_object('saison', hg_zurich_season(),
      'page', coalesce(s.value#>>array['champi', 'pages', hg_zurich_season()],
        case hg_zurich_season() when 'printemps' then 'irl' when 'ete' then 'historique' when 'automne' then 'compte' else 'cartes' end),
      'fact', coalesce(
        (select f from jsonb_array_elements_text(case when jsonb_typeof(s.value#>'{champi,facts}') = 'array' then s.value#>'{champi,facts}' else '[]'::jsonb end) f
          order by md5(f || to_char(now() at time zone 'Europe/Zurich', 'YYYY-MM-DD')) limit 1),
        (array['Certains Mycena brillent dans le noir.', 'Un champignon n''est ni une plante ni un animal.',
               'Le plus grand être vivant connu est un champignon souterrain.', 'Les champignons respirent de l''oxygène, comme nous.'])
          [1 + (extract(doy from now())::int % 4)])))
  end
  from (select (select value from hg_settings where key = 'eggs') as value, hg_anniv_info() as a) s $$;

-- 6. hg_egg_found : nouveaux codes
create or replace function public.hg_egg_found(p_egg text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid();
  z timestamp := now() at time zone 'Europe/Zurich';
  cfg jsonb := coalesce((select value from hg_settings where key = 'eggs'), '{}'::jsonb);
  per text := 'once'; gain int; msg text; card_name text; badge text; cid uuid; inserted int; extra_msg text := '';
  base text := case when p_egg like 'lettre_%' then 'lettre' when p_egg like 'champi_%' then 'champi' else p_egg end;
  sc text := coalesce(p_extra->>'score', '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_egg is null or p_egg !~ '^(konami|logo|humane|jeu404|heure_gang|anniversaire|console|lettre_[1-7]|secousse|nuit|rembobine|tzatziki|champi_(printemps|ete|automne|hiver)|livre|kc|creeper|serge|domumobile)$' then
    raise exception 'Secret inconnu';
  end if;
  -- Conditions vérifiées côté serveur (heure, date et saison de Zurich).
  if p_egg = 'heure_gang' and to_char(z, 'HH24:MI') not in ('13:36', '13:37', '13:38') then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'nuit' and extract(hour from z) <> 3 then raise exception 'Ce n''est pas l''heure'; end if;
  if p_egg = 'anniversaire' and coalesce(cfg->>'anniversaire_gang', '') <> to_char(z, 'MM-DD') then raise exception 'Ce n''est pas le bon jour'; end if;
  if base = 'champi' and p_egg <> 'champi_' || hg_zurich_season() then raise exception 'Ce champignon n''est pas de saison'; end if;
  if p_egg = 'jeu404' then
    if sc !~ '^\d{1,9}$' then raise exception 'Score invalide'; end if;
    if sc::int < 1 then raise exception 'Attrape au moins une paillette'; end if;
    if sc::int > 150 then raise exception 'Score impossible'; end if;
  end if;
  per := case p_egg when 'jeu404' then to_char(z, 'YYYY-MM-DD') when 'creeper' then to_char(z, 'YYYY-MM-DD')
                    when 'secousse' then to_char(z, 'YYYY-MM') when 'anniversaire' then to_char(z, 'YYYY') else 'once' end;
  gain := case when base = 'lettre' then 0 else coalesce((cfg#>>array['recompenses', base])::int,
            case base when 'jeu404' then 5 when 'heure_gang' then 13 when 'champi' then 20 when 'livre' then 10 when 'kc' then 10
              when 'creeper' then 1 when 'domumobile' then 15 else 25 end) end;
  gain := least(greatest(gain, 0), 500);

  insert into hg_egg_log (user_id, egg, period, reward) values (me, p_egg, per, gain) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('new', false, 'reward', 0, 'found', hg_eggs_count(me),
      'message', case when per = 'once' then 'Tu avais déjà trouvé ce secret.' else 'Déjà trouvé pour cette fois-ci. Reviens plus tard !' end);
  end if;

  if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:' || p_egg || ':' || per); end if;

  if p_egg = 'konami' then
    insert into hg_user_badges (user_id, badge_code) values (me, 'initie') on conflict do nothing; badge := 'Initié';
  elsif p_egg in ('logo', 'tzatziki', 'livre', 'serge', 'domumobile') then
    card_name := case p_egg when 'logo' then 'Le Curieux' when 'tzatziki' then 'Drapeau du Tzatzikistan' when 'livre' then 'Le Projectionniste'
                   when 'serge' then 'Le Maître de Serge' else 'La Domu-mobile' end;
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = card_name;
    if cid is not null then perform hg_card_give(me, cid, false, 'evenement'); else card_name := null; end if;
  elsif p_egg = 'anniversaire' then
    select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Gâteau du gang';
    if cid is not null then perform hg_card_give(me, cid, random() < 0.1, 'evenement'); card_name := 'Gâteau du gang'; end if;
  elsif p_egg = 'secousse' then
    insert into hg_wallets (user_id) values (me) on conflict do nothing;
    update hg_wallets set gift_boosters = coalesce(gift_boosters, 0) + 1, updated_at = now() where user_id = me;
    extra_msg := ' Un booster offert t''attend sur la page Cartes.';
  elsif base = 'lettre' then
    if (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') = 7 then
      insert into hg_user_badges (user_id, badge_code) values (me, 'chasseur_secrets') on conflict do nothing; badge := 'Chasseur de secrets';
      insert into hg_egg_log (user_id, egg, period, reward)
        values (me, 'lettres', 'once', coalesce((cfg#>>'{recompenses,lettres}')::int, 200)) on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        gain := coalesce((cfg#>>'{recompenses,lettres}')::int, 200);
        if gain > 0 then perform hg_wallet_add(me, gain, 'secret', 'secret:lettres'); end if;
        extra_msg := ' Tu as réuni les 7 lettres : « ' || coalesce(cfg->>'mot_secret', 'SECRETS') || ' » !';
      end if;
    else
      extra_msg := ' Lettre ' || (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'lettre_%') || ' sur 7.';
    end if;
  elsif base = 'champi' then
    if (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'champi\_%' escape '\') = 4 then
      insert into hg_egg_log (user_id, egg, period, reward) values (me, 'champis', 'once', 0) on conflict do nothing;
      get diagnostics inserted = row_count;
      if inserted > 0 then
        select k.id into cid from hg_cards k join hg_card_sets s on s.id = k.set_id where s.code = 'secrets' and k.name = 'Mycena';
        if cid is not null then perform hg_card_give(me, cid, random() < 0.1, 'evenement'); card_name := 'Mycena'; end if;
        insert into hg_user_badges (user_id, badge_code) values (me, 'cueilleur') on conflict do nothing; badge := 'Cueilleur';
        extra_msg := ' Les quatre saisons sont cueillies !';
      end if;
    else
      extra_msg := ' Cueillette : ' || (select count(distinct egg) from hg_egg_log where user_id = me and egg like 'champi\_%' escape '\') || ' saison(s) sur 4.';
    end if;
  end if;

  if per = 'once' and base not in ('lettre', 'champi') then
    insert into hg_activity (user_id, kind, text)
      select me, 'secret', p.pseudo || ' a trouvé un secret caché sur le site…' from hg_profiles p where p.id = me and not p.is_ghost;
  end if;

  msg := case base
    when 'konami' then 'Code secret accepté. Bienvenue parmi les initiés !'
    when 'logo' then 'Tu es curieux… La carte « Le Curieux » rejoint ta collection.'
    when 'humane' then 'Le gang en couleurs !'
    when 'jeu404' then 'Bien joué ! Une partie par jour est récompensée.'
    when 'heure_gang' then 'Il est 13 h 37. Tu connais l''heure du gang.'
    when 'anniversaire' then 'Joyeux anniversaire au gang ! Une part de gâteau pour toi.'
    when 'console' then 'Tu as résolu l''énigme de la console. Respect.'
    when 'secousse' then 'Ça secoue !'
    when 'nuit' then 'Toi aussi tu ne dors pas ? La chouette te salue.'
    when 'rembobine' then 'Rembobinage complet. Les souvenirs repartent du début.'
    when 'tzatziki' then 'Bienvenue au Tzatzikistan. Population : le gang.'
    when 'champi' then 'Joli champignon !'
    when 'livre' then 'Le livre est mieux. Tout le monde le sait.'
    when 'kc' then 'Le gang pousse derrière son équipe !'
    when 'creeper' then 'Désamorcé de justesse !'
    when 'serge' then 'Les règles de la campagne sont non négociables.'
    when 'domumobile' then 'Quatre places, cinq passagers, une playlist.'
    else 'Tu as trouvé une lettre cachée.' end || extra_msg;
  return jsonb_build_object('new', true, 'reward', gain, 'message', msg, 'card', card_name, 'badge', badge, 'found', hg_eggs_count(me));
end $$;

-- 7. Pentakill (F9) : vérifie la dernière ouverture du membre (moins de 5 minutes), une seule fois par ouverture.
create or replace function public.hg_metric_value(p_user uuid, p_metric text, p_event uuid default null)
returns numeric language sql stable security definer set search_path to 'public' as $$
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
    when 'pentakills' then (select count(*) from hg_pentakills where user_id = p_user)
    else 0 end $$;

create or replace function public.hg_pentakill_check()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare me uuid := auth.uid(); o hg_booster_opens; ids uuid[]; rars text[]; kind text; lvl int; before_lvl int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select * into o from hg_booster_opens where user_id = me order by created_at desc limit 1;
  if o.id is null or o.created_at < now() - interval '5 minutes' or o.cards <> 5 or o.mode not in ('stock', 'gratuit') then
    return jsonb_build_object('pentakill', false);
  end if;
  if exists (select 1 from hg_pentakills where open_id = o.id) then return jsonb_build_object('pentakill', false); end if;
  select array_agg(c.card_id order by c.obtained_at), array_agg(k.rarity order by c.obtained_at) into ids, rars
    from hg_card_copies c join hg_cards k on k.id = c.card_id
    where c.owner_id = me and c.source = 'booster' and c.obtained_at between o.created_at - interval '10 seconds' and o.created_at + interval '10 seconds';
  if coalesce(array_length(ids, 1), 0) <> 5 then return jsonb_build_object('pentakill', false); end if;
  if (select count(distinct r) from unnest(rars) r) = 1 and hg_card_rank(rars[1]) >= hg_card_rank('rare') then
    kind := 'rarete';
  elsif o.type_id <> 'collectionneur' and (select count(distinct x) from unnest(ids) x) = 5
    and not exists (select 1 from hg_card_copies c where c.owner_id = me and c.card_id = any (ids) and c.obtained_at < o.created_at - interval '10 seconds') then
    kind := 'nouvelles';
  else
    return jsonb_build_object('pentakill', false);
  end if;
  select level into before_lvl from hg_user_badges where user_id = me and badge_code = 'pentakill';
  insert into hg_pentakills (open_id, user_id, kind) values (o.id, me, kind) on conflict do nothing;
  if not found then return jsonb_build_object('pentakill', false); end if;
  perform hg_award_level_badges(me);
  select level into lvl from hg_user_badges where user_id = me and badge_code = 'pentakill';
  insert into hg_activity (user_id, kind, text)
    select me, 'cartes', p.pseudo || ' a réussi un Pentakill !' from hg_profiles p where p.id = me and not p.is_ghost;
  return jsonb_build_object('pentakill', true, 'kind', kind, 'level', lvl, 'new_level', coalesce(lvl, 0) > coalesce(before_lvl, 0),
    'total', (select count(*) from hg_pentakills where user_id = me));
end $$;

do $g$ begin
  revoke all on function public.hg_zurich_season() from public, anon;
  grant execute on function public.hg_zurich_season() to authenticated;
  revoke all on function public.hg_pentakill_check() from public, anon;
  grant execute on function public.hg_pentakill_check() to authenticated;
  revoke all on function public.hg_egg_found(text, jsonb) from public, anon;
  grant execute on function public.hg_egg_found(text, jsonb) to authenticated;
  revoke all on function public.hg_eggs_me() from public, anon;
  grant execute on function public.hg_eggs_me() to authenticated;
  revoke all on function public.hg_eggs_public() from public, anon;
  grant execute on function public.hg_eggs_public() to authenticated;
end $g$;
