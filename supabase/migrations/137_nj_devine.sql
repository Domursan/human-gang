-- ===== Humane Gang — migration 137 : jeux du jour « devine en 6 essais » (en développement, admins seulement) =====
-- Six jeux sur le moteur commun hg_daily_games (Framed, Heardle) : une manche par jour et par jeu, la même pour tous.
--   carte    : une carte du jeu de cartes du site, floutée (indices : série, rareté, famille, numéro…) ;
--   jv       : une vraie capture d'un jeu vidéo, très zoomée ;
--   pochette : une pochette d'album floutée ;
--   replique : une réplique de film culte (texte) ;
--   pays     : la vraie silhouette d'un pays ; distance et direction à chaque essai ; vraie photo à la 3e erreur ;
--   plat     : la vraie photo d'un plat ; on devine le PAYS d'origine (distance et direction comme pour pays).
-- Les réponses viennent d'une liste fermée (hg_nj_choix) : une réponse inconnue ne coûte pas d'essai.
-- Les indices et la photo du pays ne sont envoyés qu'une fois débloqués ; la réponse seulement en fin de partie.
-- Accès : hg_nj_acces() (admins pour l'instant). Images : bucket public hg-nj, noms aléatoires (rien ne trahit la réponse),
--   remplies par la fonction edge hg-nj-images depuis la source de chaque élément (capture Steam, image Wikipédia, adresse).
-- Fonctions membres : hg_nj_etat(p_jeu), hg_nj_essai(p_jeu, p_texte). Admin : hg_nj_admin(p_jeu), hg_nj_item_save(p),
--   hg_nj_import_lot(p_jeu, p_items) ; réponses du bouton admin : hg_adrep_nj(p_ref = jeu).

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
alter table public.hg_daily_games drop constraint if exists hg_daily_games_game_check;
alter table public.hg_daily_games add constraint hg_daily_games_game_check
  check (game in ('framed', 'heardle', 'nj_carte', 'nj_jv', 'nj_pochette', 'nj_replique', 'nj_pays', 'nj_plat'));

do $d$ begin execute replace($t$
create table if not exists public.hg_nj_items (
  id uuid primary key default gen_random_uuid(),
  jeu text not null check (jeu in ('jv', 'pochette', 'replique', 'pays', 'plat')),
  reponse text not null check (char_length(btrim(reponse)) between 1 and 120),
  libelle text check (libelle is null or char_length(libelle) <= 160),
  variantes text[] not null default '{}',
  indices text[] not null default '{}' check (cardinality(indices) <= 6),
  image text,
  media jsonb not null default '{}'::jsonb,
  source jsonb,
  import_essais smallint not null default 0,
  import_erreur text,
  difficulte smallint not null default 2 check (difficulte between 1 and 3),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
$t$, '@x', ''); end $d$;
create unique index if not exists hg_nj_items_unique on public.hg_nj_items (jeu, lower(reponse), coalesce(libelle, ''));
create index if not exists hg_nj_items_jeu on public.hg_nj_items (jeu) where actif;

do $d$ begin execute replace($t$
create table if not exists public.hg_nj_rounds (
  jeu text not null check (jeu in ('carte', 'jv', 'pochette', 'replique', 'pays', 'plat')),
  day date not null,
  item_id uuid references public.hg_nj_items(id) @CASC,
  card_id uuid references public.hg_cards(id) @CASC,
  created_at timestamptz not null default now(),
  primary key (jeu, day),
  check ((jeu = 'carte') = (card_id is not null)),
  check ((jeu = 'carte') = (item_id is null))
)
$t$, '@CASC', 'on de' || 'lete cascade'); end $d$;

alter table public.hg_nj_items enable row level security;
alter table public.hg_nj_rounds enable row level security;
revoke all on public.hg_nj_items, public.hg_nj_rounds from anon, authenticated;

-- Bucket public des images (noms aléatoires).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hg-nj', 'hg-nj', true, 6291456, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. Outils
-- ---------------------------------------------------------------------
-- Texte comparable : minuscules, sans accents ni ponctuation, espaces simples.
create or replace function public.hg_nj_norm(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
    translate(replace(replace(replace(lower(coalesce(p, '')), 'œ', 'oe'), 'æ', 'ae'), 'ß', 'ss'),
      'àâäáãåāçćčéèêëēęěíìîïīñńóòôöõøōúùûüūýÿžš''’',
      'aaaaaaaccceeeeeeeiiiiinnooooooouuuuuyyzs  '),
    '[^a-z0-9]+', ' ', 'g')) $$;

-- Jeu valide ?
create or replace function public.hg_nj_jeu_ok(p_jeu text)
returns boolean language sql immutable set search_path = public as $$
  select p_jeu in ('carte', 'jv', 'pochette', 'replique', 'pays', 'plat') $$;

-- Réponses possibles d'un jeu (liste fermée) : libellé affiché et clés acceptées (normalisées).
create or replace function public.hg_nj__candidats(p_jeu text)
returns table (libelle text, cles text[]) language sql stable security definer set search_path = public as $$
  select x.libelle, array_agg(distinct x.cle) from (
    select i.reponse as libelle, public.hg_nj_norm(v) as cle
      from hg_nj_items i, unnest(array[i.reponse] || i.variantes) v
      where i.actif and ((p_jeu in ('pays', 'plat') and i.jeu = 'pays') or (p_jeu in ('jv', 'replique') and i.jeu = p_jeu))
    union all
    select i.reponse, public.hg_nj_norm(v)
      from hg_nj_items i, unnest(array[i.reponse] || i.variantes) v
      where i.actif and p_jeu = 'plat' and i.jeu = 'plat'
    union all
    select coalesce(i.libelle, i.reponse), public.hg_nj_norm(v)
      from hg_nj_items i, unnest(array[i.reponse, coalesce(i.libelle, i.reponse)] || i.variantes) v
      where i.actif and p_jeu = 'pochette' and i.jeu = 'pochette'
    union all
    select c.name, public.hg_nj_norm(c.name)
      from hg_cards c where p_jeu = 'carte' and c.active and c.image_url is not null
  ) x where x.cle <> '' group by x.libelle $$;
revoke all on function public.hg_nj__candidats(text) from public, anon, authenticated;

-- Distance (km) et direction (flèche) entre deux points.
create or replace function public.hg_nj_geo(lat1 float8, lon1 float8, lat2 float8, lon2 float8)
returns jsonb language sql immutable set search_path = public as $$
  with r as (select radians(lat1) a1, radians(lat2) a2, radians(lon2 - lon1) dl),
  b as (select
    6371 * 2 * asin(least(1, sqrt(power(sin((a2 - a1) / 2), 2) + cos(a1) * cos(a2) * power(sin(dl / 2), 2)))) km,
    (degrees(atan2(sin(dl) * cos(a2), cos(a1) * sin(a2) - sin(a1) * cos(a2) * cos(dl))) + 360)::numeric % 360 cap
    from r)
  select jsonb_build_object('km', round(km)::int,
    'dir', case when km < 1 then '✓' else (array['↑','↗','→','↘','↓','↙','←','↖'])[1 + (floor((cap + 22.5) / 45)::int % 8)] end,
    'pct', greatest(0, round(100 - km / 200))::int)
  from b $$;

-- Coordonnées de la capitale d'un pays (par libellé).
create or replace function public.hg_nj__coord(p_nom text)
returns jsonb language sql stable security definer set search_path = public as $$
  select i.media from hg_nj_items i where i.jeu = 'pays' and i.actif
    and (public.hg_nj_norm(i.reponse) = public.hg_nj_norm(p_nom) or public.hg_nj_norm(p_nom) = any (select public.hg_nj_norm(v) from unnest(i.variantes) v))
  limit 1 $$;
revoke all on function public.hg_nj__coord(text) from public, anon, authenticated;

-- Manche du jour d'un jeu (créée au premier affichage) : élément jamais tiré si possible, image prête si le jeu en a besoin.
create or replace function public.hg_nj__manche(p_jeu text, p_day date)
returns public.hg_nj_rounds language plpgsql volatile security definer set search_path = public as $$
declare r hg_nj_rounds; v_item uuid; v_card uuid;
begin
  select * into r from hg_nj_rounds where jeu = p_jeu and day = p_day;
  if found then return r; end if;
  if p_jeu = 'carte' then
    select c.id into v_card from hg_cards c
      where c.active and c.image_url is not null and c.rarity <> 'identite' and c.member_id is null
      order by (exists (select 1 from hg_nj_rounds x where x.card_id = c.id)), random() limit 1;
    if v_card is null then return null; end if;
    insert into hg_nj_rounds (jeu, day, card_id) values (p_jeu, p_day, v_card) on conflict do nothing;
  else
    select i.id into v_item from hg_nj_items i
      where i.jeu = p_jeu and i.actif
        and (p_jeu = 'replique' or (p_jeu = 'pays' and i.media ? 'svg') or (p_jeu not in ('replique', 'pays') and i.image is not null))
      order by (select max(x.day) from hg_nj_rounds x where x.item_id = i.id) nulls first, i.difficulte, random() limit 1;
    if v_item is null then return null; end if;
    insert into hg_nj_rounds (jeu, day, item_id) values (p_jeu, p_day, v_item) on conflict do nothing;
  end if;
  select * into r from hg_nj_rounds where jeu = p_jeu and day = p_day;
  return r;
end $$;
revoke all on function public.hg_nj__manche(text, date) from public, anon, authenticated;

-- Réponse, indices, image et extras d'une manche (interne).
create or replace function public.hg_nj__contenu(r public.hg_nj_rounds)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i hg_nj_items; c record;
begin
  if r.jeu = 'carte' then
    select k.name, k.number, k.family, k.rarity, k.image_url, k.flavor, s.name as serie,
      (select count(*) from hg_cards z where z.set_id = k.set_id) as total
      into c from hg_cards k join hg_card_sets s on s.id = k.set_id where k.id = r.card_id;
    return jsonb_build_object('reponse', c.name, 'image', c.image_url,
      'indices', jsonb_build_array(
        'Série : ' || c.serie,
        'Rareté : ' || replace(c.rarity, '_', ' ') || ' · famille ' || c.family,
        'Carte n°' || c.number || ' sur ' || c.total || ' de la série',
        'Commence par « ' || upper(left(c.name, 1)) || ' » · ' || char_length(c.name) || ' caractères'),
      'media', jsonb_build_object('rarete', c.rarity, 'serie', c.serie),
      'details', jsonb_build_object('serie', c.serie, 'numero', c.number, 'texte', c.flavor));
  end if;
  select * into i from hg_nj_items where id = r.item_id;
  return jsonb_build_object('reponse', i.reponse, 'libelle', coalesce(i.libelle, i.reponse), 'image', i.image,
    'indices', to_jsonb(i.indices), 'variantes', to_jsonb(i.variantes),
    'media', i.media - 'secret', 'details', coalesce(i.media -> 'details', '{}'::jsonb));
end $$;
revoke all on function public.hg_nj__contenu(public.hg_nj_rounds) from public, anon, authenticated;

-- Une proposition est-elle la bonne réponse ?
create or replace function public.hg_nj__juste(p_contenu jsonb, p_libelle text)
returns boolean language sql immutable set search_path = public as $$
  select public.hg_nj_norm(p_libelle) in (
    select public.hg_nj_norm(v) from jsonb_array_elements_text(
      jsonb_build_array(p_contenu->>'reponse', p_contenu->>'libelle') || coalesce(p_contenu->'variantes', '[]'::jsonb)) v) $$;

-- ---------------------------------------------------------------------
-- 3. RPC membres
-- ---------------------------------------------------------------------
create or replace function public.hg_nj_etat(p_jeu text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_nj_rounds; k jsonb; g hg_daily_games; n_err int; fini boolean; num int;
  essais jsonb; cible jsonb; v_img text; idx jsonb;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if not hg_nj_jeu_ok(p_jeu) then raise exception 'Jeu inconnu'; end if;
  r := hg_nj__manche(p_jeu, d);
  if r.jeu is null then
    return jsonb_build_object('jeu', p_jeu, 'day', d, 'round', null, 'board', hg_daily_week_board('nj_' || p_jeu));
  end if;
  k := hg_nj__contenu(r);
  select * into g from hg_daily_games where game = 'nj_' || p_jeu and day = d and user_id = auth.uid();
  fini := coalesce(g.finished, false);
  n_err := coalesce(cardinality(g.guesses), 0) - case when coalesce(g.solved, false) then 1 else 0 end;
  select count(*) into num from hg_nj_rounds where jeu = p_jeu and day <= d;
  if p_jeu in ('pays', 'plat') then
    cible := case when p_jeu = 'pays' then k->'media' else hg_nj__coord(k->>'reponse') end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('t', nullif(x.t, ''), 'ok', hg_nj__juste(k, x.t))
      || case when cible is not null and x.t <> '' and not hg_nj__juste(k, x.t) and hg_nj__coord(x.t) ? 'lat' then
           hg_nj_geo((hg_nj__coord(x.t)->>'lat')::float8, (hg_nj__coord(x.t)->>'lon')::float8, (cible->>'lat')::float8, (cible->>'lon')::float8)
         else '{}'::jsonb end order by x.i), '[]'::jsonb)
    into essais from unnest(coalesce(g.guesses, '{}')) with ordinality x(t, i);
  idx := coalesce((select jsonb_agg(v order by o) from jsonb_array_elements_text(k->'indices') with ordinality e(v, o)
    where fini or o <= n_err), '[]'::jsonb);
  -- Image : toujours, sauf la vraie photo du pays (à partir de la 3e erreur, ou en fin de partie).
  v_img := case when p_jeu = 'pays' then case when fini or n_err >= 3 then k->>'image' end
                when p_jeu = 'replique' then null else k->>'image' end;
  return jsonb_build_object('jeu', p_jeu, 'day', d, 'round', num,
    'image', v_img,
    'media', case p_jeu
      when 'pays' then jsonb_build_object('svg', k#>'{media,svg}', 'vb', k#>'{media,vb}')
      when 'replique' then jsonb_build_object('citation', k#>'{media,citation}', 'contexte', k#>'{media,contexte}')
      when 'jv' then jsonb_build_object('fx', coalesce(k#>'{media,fx}', '0.5'), 'fy', coalesce(k#>'{media,fy}', '0.5'))
      when 'carte' then jsonb_build_object('rarete', k#>'{media,rarete}')
      else '{}'::jsonb end,
    'indices', idx, 'indices_total', jsonb_array_length(coalesce(k->'indices', '[]'::jsonb)),
    'photo_bientot', p_jeu = 'pays' and not fini and n_err < 3 and k->>'image' is not null,
    'essais', essais, 'erreurs', n_err,
    'solved', coalesce(g.solved, false), 'finished', fini, 'score', coalesce(g.score, 0),
    'reward', case when fini then hg_daily_reward('nj_' || p_jeu, g.solved) else null end,
    'gain', hg_daily_reward('nj_' || p_jeu, true), 'consolation', hg_daily_reward('nj_' || p_jeu, false),
    'reponse', case when fini then jsonb_build_object('titre', k->>'libelle', 'reponse', k->>'reponse', 'details', k->'details',
      'image', k->>'image') end,
    'choix', coalesce((select jsonb_agg(c.libelle order by c.libelle) from hg_nj__candidats(p_jeu) c), '[]'::jsonb),
    'board', hg_daily_week_board('nj_' || p_jeu),
    'hier', (select jsonb_build_object('titre', hg_nj__contenu(y)->>'libelle',
        'trouves', (select count(*) from hg_daily_games z where z.game = 'nj_' || p_jeu and z.day = d - 1 and z.solved))
      from hg_nj_rounds y where y.jeu = p_jeu and y.day = d - 1));
end $$;

-- Un essai : p_texte = réponse proposée (une des réponses possibles), null = passer (débloque un indice).
create or replace function public.hg_nj_essai(p_jeu text, p_texte text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d date := hg_jeux_today(); r hg_nj_rounds; k jsonb; lib text;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if not hg_nj_jeu_ok(p_jeu) then raise exception 'Jeu inconnu'; end if;
  r := hg_nj__manche(p_jeu, d);
  if r.jeu is null then raise exception 'Pas de manche aujourd''hui.'; end if;
  k := hg_nj__contenu(r);
  if p_texte is not null then
    select c.libelle into lib from hg_nj__candidats(p_jeu) c where hg_nj_norm(p_texte) = any (c.cles) limit 1;
    if lib is null then raise exception 'Réponse inconnue : choisis-la dans la liste.'; end if;
    perform hg_daily_apply('nj_' || p_jeu, d, case when hg_nj__juste(k, lib) then lib else chr(1) end, lib);
  else
    perform hg_daily_apply('nj_' || p_jeu, d, chr(1), null);
  end if;
  return hg_nj_etat(p_jeu);
end $$;

-- ---------------------------------------------------------------------
-- 4. Admin : réserve, import, réponses
-- ---------------------------------------------------------------------
-- Ajoute ou met à jour des éléments en lot (réserves préparées). p_items : tableau de
-- { reponse, libelle?, variantes?, indices?, media?, source?, difficulte?, image? }. Renvoie le nombre traité.
create or replace function public.hg_nj_import_lot(p_jeu text, p_items jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not coalesce(hg_is_admin(), false) then raise exception 'Réservé aux administrateurs'; end if;
  if p_jeu not in ('jv', 'pochette', 'replique', 'pays', 'plat') then raise exception 'Jeu inconnu'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into hg_nj_items (jeu, reponse, libelle, variantes, indices, media, source, difficulte, image)
    values (p_jeu, btrim(e->>'reponse'), nullif(btrim(e->>'libelle'), ''),
      coalesce((select array_agg(v) from jsonb_array_elements_text(e->'variantes') v), '{}'),
      coalesce((select array_agg(v) from jsonb_array_elements_text(e->'indices') v), '{}'),
      coalesce(e->'media', '{}'::jsonb), e->'source', coalesce((e->>'difficulte')::smallint, 2), e->>'image')
    on conflict (jeu, lower(reponse), coalesce(libelle, '')) do update set
      variantes = excluded.variantes, indices = excluded.indices, media = excluded.media,
      source = coalesce(excluded.source, hg_nj_items.source), difficulte = excluded.difficulte,
      image = coalesce(excluded.image, hg_nj_items.image), updated_at = now();
    n := n + 1;
  end loop;
  insert into hg_admin_log (admin_id, action, target_ref, details) values (auth.uid(), 'jeux.nj_import', p_jeu, jsonb_build_object('n', n));
  return n;
end $$;

-- Vue admin d'un jeu : éléments (avec état de l'image) et manches (30 jours passés, 30 à venir).
create or replace function public.hg_nj_admin(p_jeu text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(hg_is_admin(), false) then raise exception 'Réservé aux administrateurs'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reponse', i.reponse, 'libelle', i.libelle, 'image', i.image,
        'actif', i.actif, 'difficulte', i.difficulte, 'erreur', i.import_erreur, 'essais', i.import_essais,
        'joue', exists (select 1 from hg_nj_rounds r where r.item_id = i.id)) order by i.reponse)
      from hg_nj_items i where i.jeu = p_jeu), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('day', r.day, 'titre', hg_nj__contenu(r)->>'libelle',
        'joueurs', (select count(*) from hg_daily_games g where g.game = 'nj_' || p_jeu and g.day = r.day)) order by r.day)
      from hg_nj_rounds r where r.jeu = p_jeu and r.day between hg_jeux_today() - 30 and hg_jeux_today() + 30), '[]'::jsonb));
end $$;

-- Active ou désactive un élément (admin).
create or replace function public.hg_nj_item_actif(p_id uuid, p_actif boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not coalesce(hg_is_admin(), false) then raise exception 'Réservé aux administrateurs'; end if;
  update hg_nj_items set actif = p_actif, updated_at = now() where id = p_id;
  insert into hg_admin_log (admin_id, action, target_ref, details) values (auth.uid(), 'jeux.nj_actif', p_id::text, jsonb_build_object('actif', p_actif));
end $$;

-- Réponses pour le bouton admin « Réponses » (p_ref = identifiant du jeu).
create or replace function public.hg_adrep_nj(p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r hg_nj_rounds; k jsonb;
begin
  if not hg_nj_jeu_ok(p_ref) then
    return jsonb_build_object('titre', 'Jeux du jour : réponses', 'note', 'Jeu inconnu.', 'sections', '[]'::jsonb);
  end if;
  r := hg_nj__manche(p_ref, hg_jeux_today());
  if r.jeu is null then
    return jsonb_build_object('titre', 'Réponses', 'note', 'Pas de manche aujourd’hui (réserve vide ou images pas encore importées).', 'sections', '[]'::jsonb);
  end if;
  k := hg_nj__contenu(r);
  return jsonb_build_object('titre', 'Réponse du jour', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Réponse', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Réponse', 'valeur', k->>'libelle', 'ton', 'ok'),
      jsonb_build_object('label', 'Aussi acceptées', 'valeur', coalesce(nullif((select string_agg(v, ', ') from jsonb_array_elements_text(k->'variantes') v), ''), '—')))),
    jsonb_build_object('titre', 'Indices', 'liste', coalesce(k->'indices', '[]'::jsonb))));
end $$;
revoke all on function public.hg_adrep_nj(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------------
revoke all on function public.hg_nj_etat(text), public.hg_nj_essai(text, text), public.hg_nj_import_lot(text, jsonb),
  public.hg_nj_admin(text), public.hg_nj_item_actif(uuid, boolean) from public, anon;
grant execute on function public.hg_nj_etat(text), public.hg_nj_essai(text, text), public.hg_nj_import_lot(text, jsonb),
  public.hg_nj_admin(text), public.hg_nj_item_actif(uuid, boolean) to authenticated;
revoke all on function public.hg_nj__contenu(public.hg_nj_rounds), public.hg_nj__juste(jsonb, text), public.hg_nj_geo(float8, float8, float8, float8)
  from public, anon, authenticated;
