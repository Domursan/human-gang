-- ===== Humane Gang — 081 : idées du gang, paquet C2 (thème « Cartes et économie ») =====
-- Idées retenues par Ethan le 23/10/2026 :
--   C7  Série « Le gang joue » : colonne hg_cards.tag (regroupement par jeu), titres « Pilier de … » calculés
--       (hg_card_tags_complete), série « le-gang-joue » créée inactive avec 24 cartes inactives, illustrées (SVG dans
--       assets/cards/le-gang-joue/) ; le Staff valide les légendes puis active la série depuis l'admin.
--   C8  Générations « OG » / « 2e gen » des membres : réglage cards.generations.og_before, préférence
--       hg_profiles.show_generation, lecture hg_card_generations() (aucune récompense, aucune rareté différente).
--   C9  Codes cadeaux à usage unique (QR) : lots hg_gift_code_batches, codes hachés hg_gift_codes (sha256 intégré à
--       PostgreSQL, sans extension), utilisations hg_gift_code_claims, essais hg_gift_code_attempts (10 essais faux
--       par heure). RPC membre hg_gift_code_peek / hg_gift_code_redeem ; Staff « cartes » : hg_gift_codes_create
--       (codes en clair renvoyés une seule fois), hg_gift_codes_batches, hg_gift_codes_batch_active.
--   C10 Recettes de l'Atelier : hg_card_recipes, hg_card_recipe_uses, hg_card_copies.consumed_by, source « atelier ».
--       RPC hg_card_recipes_me, hg_card_recipe_craft ; Staff : hg_card_recipes_admin, hg_card_recipe_save.
--   C11 Enchère d'une carte unique : hg_card_auctions, hg_card_bids. RPC hg_auction_current, hg_auction_bid ;
--       clôture idempotente hg_auction_close (appelée par hg_auction_current et par le service) ; Staff :
--       hg_auction_create, hg_auction_cancel, hg_auctions_admin.
--   C12 Tableau « Je cherche / Je donne » : hg_profiles.trade_board (inscription volontaire) et trade_board_note
--       (80 caractères). RPC hg_trade_board, hg_trade_board_set ; Staff : hg_trade_board_note_clear.
-- Règles : toute carte, Paillette ou booster gagné passe par une RPC SECURITY DEFINER plafonnée, avec une clé
-- d'idempotence dans hg_wallet_log (index hg_wallet_log_once) ; RLS sur toutes les nouvelles tables (aucune écriture
-- directe) ; search_path fixé ; droits Staff par hg_has_perm('cartes') ; journal hg_admin_audit pour le Staff.
-- Idempotente (create or replace, if not exists, contraintes recréées dans des blocs do) et rétrocompatible
-- (colonnes facultatives avec valeur par défaut, aucune fonction existante modifiée).
-- Les mots-clés de retrait sont construits dynamiquement (outil de migration).

-- =====================================================================
-- 0. Commun : source « atelier » pour les exemplaires
-- =====================================================================
-- La contrainte de la colonne source est reconstruite à partir des valeurs déjà permises (celles de la
-- production et celles d'autres migrations), plus « atelier ».
do $$
declare v_def text; v_vals text[]; v_list text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.hg_card_copies'::regclass and c.conname = 'hg_card_copies_source_check';
  if v_def is not null and v_def like '%''atelier''%' then return; end if;
  select coalesce(array_agg(distinct m[1]), '{}') into v_vals
    from regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''', 'g') as m;
  v_vals := array(select distinct x from unnest(v_vals || array['booster', 'cadeau', 'admin', 'fabrication', 'evenement', 'echange', 'atelier']) x order by 1);
  select string_agg(quote_literal(x), ', ') into v_list from unnest(v_vals) x;
  if v_def is not null then
    execute 'alter table public.hg_card_copies ' || 'dr' || 'op constraint hg_card_copies_source_check';
  end if;
  execute 'alter table public.hg_card_copies add constraint hg_card_copies_source_check check (source = any (array[' || v_list || ']))';
end $$;

-- Valeur de recyclage d'une rareté (barème cards.recycle), brillante comprise. Sert au contrôle des recettes (C10).
create or replace function public.hg_card_recycle_value(p_rarity text, p_shiny boolean default false)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(case when (hg_card_cfg()#>>array['recycle', p_rarity]) ~ '^\d{1,7}$' then (hg_card_cfg()#>>array['recycle', p_rarity])::int end, 0)
       * case when p_shiny then coalesce(case when (hg_card_cfg()#>>'{recycle,shiny_multiplier}') ~ '^\d{1,3}$' then (hg_card_cfg()#>>'{recycle,shiny_multiplier}')::int end, 3) else 1 end
$$;

-- =====================================================================
-- C7. Série « Le gang joue » : tags de jeu et titres de profil
-- =====================================================================
alter table public.hg_cards add column if not exists tag text;
comment on column public.hg_cards.tag is 'Regroupement libre dans une série (ex. « minecraft ») : sous-filtre de la Collection, titres « Pilier de … » et ingrédients des recettes (migration 081).';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_cards_tag_format' and conrelid = 'public.hg_cards'::regclass) then
    alter table public.hg_cards add constraint hg_cards_tag_format check (tag is null or tag ~ '^[a-z0-9][a-z0-9-]{0,31}$');
  end if;
end $$;
create index if not exists hg_cards_tag_idx on public.hg_cards(tag) where tag is not null;

-- Libellé d'un tag : réglage cards.tag_labels.<tag>, sinon libellés connus, sinon le tag mis en forme.
create or replace function public.hg_card_tag_label(p_tag text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(left(btrim(hg_card_cfg()#>>array['tag_labels', p_tag]), 40), ''),
    case p_tag
      when 'minecraft' then 'Minecraft' when 'aoe2' then 'Age of Empires 2' when 'lol' then 'LoL'
      when 'sea-of-thieves' then 'Sea of Thieves' when 'satisfactory' then 'Satisfactory' when 'soiree' then 'Jeux de soirée'
    end,
    initcap(replace(p_tag, '-', ' ')))
$$;

-- Tags d'un membre : pour chaque tag porté par des cartes actives (hors identité et unique), le nombre de cartes
-- possédées (exemplaires non recyclés) sur le total. complete = vrai quand tout le groupe est possédé : titre
-- « Pilier de <jeu> » (aucune récompense, aucune écriture). Membres seulement ; un membre fantôme ne renvoie rien.
create or replace function public.hg_card_tags_complete(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_user uuid := coalesce(p_user, auth.uid()); res jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if not exists (select 1 from hg_profiles p where p.id = v_user and (not p.is_ghost or hg_is_admin())) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('tag', t.tag, 'label', hg_card_tag_label(t.tag), 'have', t.have, 'total', t.total,
           'complete', t.have = t.total, 'title', 'Pilier de ' || hg_card_tag_label(t.tag)) order by t.tag), '[]'::jsonb)
    into res
    from (select k.tag, count(*)::int as total,
                 count(*) filter (where exists (select 1 from hg_card_copies x where x.card_id = k.id and x.owner_id = v_user and x.recycled_at is null))::int as have
            from hg_cards k
            join hg_card_sets s on s.id = k.set_id
           where k.tag is not null and k.active and s.active and k.rarity not in ('identite', 'unique')
           group by k.tag) t;
  return res;
end $$;

-- Série « Le gang joue » : créée inactive, cartes inactives et illustrées (pixel art original en SVG, dans
-- assets/cards/le-gang-joue/, aucun logo ni capture). Le Staff valide les légendes, puis active la série et les
-- cartes depuis l'admin.
insert into public.hg_card_sets(code, name, description, active, sort)
select 'le-gang-joue', 'Le gang joue', 'Objets et lieux des jeux du gang, quatre cartes par jeu.', false, 40
 where not exists (select 1 from public.hg_card_sets where code = 'le-gang-joue');

insert into public.hg_cards(set_id, number, name, family, rarity, flavor, tag, image_url, active, can_shiny, tradeable, craftable)
select s.id, v.n, v.name, 'jeu', v.rarity, v.flavor, v.tag, v.img, false, true, true, true
  from public.hg_card_sets s
  cross join (values
    (1,  'Le portail du Torii',            'commune',     'Le passage vers l’autre monde, posé au pixel près.',          'minecraft', 'assets/cards/le-gang-joue/01-torii.svg'),
    (2,  'L’usine à fer',                  'peu_commune', 'Elle tourne même quand tout le monde est déconnecté.',        'minecraft', 'assets/cards/le-gang-joue/02-usine-a-fer.svg'),
    (3,  'La base du gang',                'rare',        'Coordonnées : sur l’ancienne carte, promis.',                   'minecraft', 'assets/cards/le-gang-joue/03-base-du-gang.svg'),
    (4,  'Le coffre des trouvailles',      'epique',      'Personne ne sait qui l’a rangé.',                              'minecraft', 'assets/cards/le-gang-joue/04-coffre-des-trouvailles.svg'),
    (5,  'La Merveille',                   'commune',     'Encore 200 ans de construction, et on gagne.',                 'aoe2', 'assets/cards/le-gang-joue/05-la-merveille.svg'),
    (6,  'Le moine qui convertit',         'peu_commune', '« Wololo » résonne encore dans le vocal.',                     'aoe2', 'assets/cards/le-gang-joue/06-moine-qui-convertit.svg'),
    (7,  'Le trébuchet',                   'rare',        'Lent, mais il finit toujours par arriver.',                    'aoe2', 'assets/cards/le-gang-joue/07-trebuchet.svg'),
    (8,  'Le villageois oisif',            'epique',      'Il attend des ordres depuis la partie de 2022.',               'aoe2', 'assets/cards/le-gang-joue/08-villageois-oisif.svg'),
    (9,  'Le Nexus',                       'commune',     'Le dernier rempart de la soirée.',                             'lol', 'assets/cards/le-gang-joue/09-le-nexus.svg'),
    (10, 'La tour du milieu',              'peu_commune', 'Elle a vu passer beaucoup de plongeons ratés.',                'lol', 'assets/cards/le-gang-joue/10-tour-du-milieu.svg'),
    (11, 'Le pick’em du gang',             'rare',        'Rempli avec le cœur, jamais avec la tête.',                    'lol', 'assets/cards/le-gang-joue/11-pickem-du-gang.svg'),
    (12, 'La balise de vision',            'epique',      'Posée trop tard, comme d’habitude.',                           'lol', 'assets/cards/le-gang-joue/12-balise-de-vision.svg'),
    (13, 'Le bateau',                      'commune',     'Trois matelots, quatre avis sur le cap.',                      'sea-of-thieves', 'assets/cards/le-gang-joue/13-le-bateau.svg'),
    (14, 'Le coffre maudit',               'peu_commune', 'Il pleure, il chante, il coule.',                              'sea-of-thieves', 'assets/cards/le-gang-joue/14-le-coffre-maudit.svg'),
    (15, 'La carte au trésor',             'rare',        'La croix était juste derrière nous.',                          'sea-of-thieves', 'assets/cards/le-gang-joue/15-la-carte-au-tresor.svg'),
    (16, 'Le seau d’eau',                  'epique',      'L’objet le plus utile de la soirée.',                          'sea-of-thieves', 'assets/cards/le-gang-joue/16-le-seau-d-eau.svg'),
    (17, 'La planète à industrialiser',    'commune',     'Une plaine verte, pour l’instant.',                            'satisfactory', 'assets/cards/le-gang-joue/17-la-planete-a-industrialiser.svg'),
    (18, 'Le convoyeur sans fin',          'peu_commune', 'Il va quelque part. Personne ne sait où.',                     'satisfactory', 'assets/cards/le-gang-joue/18-le-convoyeur-sans-fin.svg'),
    (19, 'L’usine répartie',               'rare',        'Usine répartie entre plusieurs membres du gang.',              'satisfactory', 'assets/cards/le-gang-joue/19-l-usine-repartie.svg'),
    (20, 'La foreuse géante',              'epique',      'Elle a creusé plus que prévu.',                                'satisfactory', 'assets/cards/le-gang-joue/20-la-foreuse-geante.svg'),
    (21, 'Le bouton d’urgence',            'commune',     'Appuyé « pour vérifier ».',                                    'soiree', 'assets/cards/le-gang-joue/21-le-bouton-d-urgence.svg'),
    (22, 'La bouche d’aération',           'peu_commune', 'Quelqu’un en est sorti, tout le monde l’a vu.',                'soiree', 'assets/cards/le-gang-joue/22-la-bouche-d-aeration.svg'),
    (23, 'La grille de mots',              'rare',        'Un indice, deux mots, zéro accord.',                           'soiree', 'assets/cards/le-gang-joue/23-la-grille-de-mots.svg'),
    (24, 'Le dessin incompréhensible',     'epique',      'C’était un chat. Évidemment.',                                 'soiree', 'assets/cards/le-gang-joue/24-le-dessin-incomprehensible.svg')
  ) as v(n, name, rarity, flavor, tag, img)
 where s.code = 'le-gang-joue'
   and not exists (select 1 from public.hg_cards k where k.set_id = s.id and k.number = v.n);

-- Illustrations : une carte déjà présente sans image reçoit son SVG (rejouer la migration remplit les images).
-- Chemins relatifs au site (dossier assets/cards/le-gang-joue/ du dépôt) ; les cartes déjà illustrées ne sont pas modifiées.
update public.hg_cards k set image_url = v.img
  from public.hg_card_sets s
  join (values
    (1, 'assets/cards/le-gang-joue/01-torii.svg'),
    (2, 'assets/cards/le-gang-joue/02-usine-a-fer.svg'),
    (3, 'assets/cards/le-gang-joue/03-base-du-gang.svg'),
    (4, 'assets/cards/le-gang-joue/04-coffre-des-trouvailles.svg'),
    (5, 'assets/cards/le-gang-joue/05-la-merveille.svg'),
    (6, 'assets/cards/le-gang-joue/06-moine-qui-convertit.svg'),
    (7, 'assets/cards/le-gang-joue/07-trebuchet.svg'),
    (8, 'assets/cards/le-gang-joue/08-villageois-oisif.svg'),
    (9, 'assets/cards/le-gang-joue/09-le-nexus.svg'),
    (10, 'assets/cards/le-gang-joue/10-tour-du-milieu.svg'),
    (11, 'assets/cards/le-gang-joue/11-pickem-du-gang.svg'),
    (12, 'assets/cards/le-gang-joue/12-balise-de-vision.svg'),
    (13, 'assets/cards/le-gang-joue/13-le-bateau.svg'),
    (14, 'assets/cards/le-gang-joue/14-le-coffre-maudit.svg'),
    (15, 'assets/cards/le-gang-joue/15-la-carte-au-tresor.svg'),
    (16, 'assets/cards/le-gang-joue/16-le-seau-d-eau.svg'),
    (17, 'assets/cards/le-gang-joue/17-la-planete-a-industrialiser.svg'),
    (18, 'assets/cards/le-gang-joue/18-le-convoyeur-sans-fin.svg'),
    (19, 'assets/cards/le-gang-joue/19-l-usine-repartie.svg'),
    (20, 'assets/cards/le-gang-joue/20-la-foreuse-geante.svg'),
    (21, 'assets/cards/le-gang-joue/21-le-bouton-d-urgence.svg'),
    (22, 'assets/cards/le-gang-joue/22-la-bouche-d-aeration.svg'),
    (23, 'assets/cards/le-gang-joue/23-la-grille-de-mots.svg'),
    (24, 'assets/cards/le-gang-joue/24-le-dessin-incomprehensible.svg')
  ) as v(n, img) on true
 where s.code = 'le-gang-joue'
   and k.set_id = s.id and k.number = v.n
   and (k.image_url is null or k.image_url = '');

-- =====================================================================
-- C8. Générations « OG » et « 2e gen »
-- =====================================================================
alter table public.hg_profiles add column if not exists show_generation boolean not null default true;
comment on column public.hg_profiles.show_generation is 'Afficher le bandeau de génération (OG / 2e gen) sur ses cartes et sa fiche (migration 081).';

-- Date de bascule : cards.generations.og_before (AAAA-MM-JJ), sinon le 1er septembre 2023.
create or replace function public.hg_card_og_before()
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v text := hg_card_cfg()#>>'{generations,og_before}'; d date;
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then return date '2023-09-01'; end if;
  begin d := v::date; exception when others then return date '2023-09-01'; end;
  if d < date '2015-01-01' or d > date '2100-01-01' then return date '2023-09-01'; end if;
  return d;
end $$;

-- Génération de chaque membre actif qui l'affiche : « og » (arrivé avant la bascule) ou « gen2 ».
-- Date d'arrivée : joined_on, sinon la création du profil. Membres seulement.
create or replace function public.hg_card_generations()
returns table(user_id uuid, gen text, since date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, case when coalesce(p.joined_on, p.created_at::date) < hg_card_og_before() then 'og' else 'gen2' end,
         coalesce(p.joined_on, p.created_at::date)
    from hg_profiles p
   where hg_is_member() and not p.is_ghost and p.show_generation
$$;

-- =====================================================================
-- C9. Codes cadeaux à usage unique (QR)
-- =====================================================================
create table if not exists public.hg_gift_code_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('booster', 'paillettes', 'carte')),
  type_id text,
  amount integer not null default 1 check (amount between 1 and 100000),
  card_id uuid references public.hg_cards(id),
  shiny boolean not null default false,
  codes integer not null default 0,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  one_per_member boolean not null default false,
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 200),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
comment on table public.hg_gift_code_batches is 'Lots de codes cadeaux (C9, migration 081) : ce que donne chaque code, utilisations, expiration. Lecture et écriture par RPC seulement.';
create table if not exists public.hg_gift_codes (
  code_hash text primary key,
  batch_id uuid not null references public.hg_gift_code_batches(id),
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.hg_gift_codes is 'Codes cadeaux, hachés (sha256 de « hg-code: » + code normalisé) : le code en clair n''est jamais stocké.';
create index if not exists hg_gift_codes_batch_idx on public.hg_gift_codes(batch_id);
create table if not exists public.hg_gift_code_claims (
  code_hash text not null references public.hg_gift_codes(code_hash),
  batch_id uuid not null,
  user_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (code_hash, user_id)
);
create index if not exists hg_gift_code_claims_batch_idx on public.hg_gift_code_claims(batch_id, user_id);
create table if not exists public.hg_gift_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ok boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists hg_gift_code_attempts_user_idx on public.hg_gift_code_attempts(user_id, at);
alter table public.hg_gift_code_batches enable row level security;
alter table public.hg_gift_codes enable row level security;
alter table public.hg_gift_code_claims enable row level security;
alter table public.hg_gift_code_attempts enable row level security;
revoke all on public.hg_gift_code_batches, public.hg_gift_codes, public.hg_gift_code_claims, public.hg_gift_code_attempts from anon, authenticated;

-- Normalisation d'un code saisi : majuscules, sans espace ni tiret, préfixe « HG » retiré ; 8 signes attendus.
create or replace function public.hg_gift_code_norm(p_code text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case when length(x) = 10 and left(x, 2) = 'HG' then substr(x, 3) else x end
    from (select regexp_replace(upper(coalesce(left(p_code, 64), '')), '[^A-Z0-9]', '', 'g') as x) s
$$;
-- Empreinte d'un code normalisé (fonction sha256 intégrée à PostgreSQL : pas besoin de pgcrypto).
create or replace function public.hg_gift_code_hash(p_norm text)
returns text
language sql
immutable
set search_path to 'public'
as $$ select encode(sha256(convert_to('hg-code:' || p_norm, 'UTF8')), 'hex') $$;
-- Nouveau code : 8 signes parmi 31 (sans 0, O, 1, I, L), tirés dans l'aléa fort de gen_random_uuid() (octets de
-- version et de variante écartés ; tirage par rejet, sans biais).
create or replace function public.hg_gift_code_new()
returns text
language plpgsql
volatile
set search_path to 'public'
as $$
declare a constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; b bytea; s text := ''; i int; v int;
begin
  while length(s) < 8 loop
    b := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      v := get_byte(b, i);
      if v < 248 and length(s) < 8 then s := s || substr(a, v % 31 + 1, 1); end if;
    end loop;
  end loop;
  return s;
end $$;
-- Code affiché : HG-XXXX-XXXX.
create or replace function public.hg_gift_code_fmt(p_norm text)
returns text language sql immutable set search_path to 'public'
as $$ select 'HG-' || substr(p_norm, 1, 4) || '-' || substr(p_norm, 5, 4) $$;

-- Description d'un lot (ce que donne un code), pour le membre et pour l'admin.
create or replace function public.hg_gift_code_lot(b public.hg_gift_code_batches)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('kind', b.kind, 'amount', b.amount, 'type_id', b.type_id,
    'type_name', (select t.name from hg_booster_types t where t.id = b.type_id),
    'card', (select jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family, 'image_url', k.image_url,
               'flavor', k.flavor, 'caption', k.caption, 'number', k.number, 'max_copies', k.max_copies, 'set_id', k.set_id)
               from hg_cards k where k.id = b.card_id),
    'shiny', b.shiny, 'expires_at', b.expires_at)
$$;

-- Contrôle commun (sans livraison) : renvoie le code, son lot et l'erreur éventuelle. Note les essais faux.
-- Les erreurs sont renvoyées (pas levées) : l'essai faux reste enregistré.
create or replace function public.hg_gift_code_check(p_code text, p_lock boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); n text := hg_gift_code_norm(p_code); h text; g hg_gift_codes; b hg_gift_code_batches; fails int; err text;
begin
  select count(*) into fails from hg_gift_code_attempts a where a.user_id = me and not a.ok and a.at > now() - interval '1 hour';
  if fails >= 10 then
    return jsonb_build_object('ok', false, 'error', 'trop_essais', 'message', 'Trop d’essais : réessaie dans une heure.');
  end if;
  if n ~ '^[2-9A-HJKMNP-Z]{8}$' then
    h := hg_gift_code_hash(n);
    if p_lock then select * into g from hg_gift_codes where code_hash = h for update;
    else select * into g from hg_gift_codes where code_hash = h; end if;
  end if;
  if g.code_hash is null then err := 'inconnu';
  else
    select * into b from hg_gift_code_batches where id = g.batch_id;
    if not b.active then err := 'desactive';
    elsif b.expires_at is not null and b.expires_at <= now() then err := 'expire';
    elsif exists (select 1 from hg_gift_code_claims c where c.code_hash = h and c.user_id = me) then err := 'deja';
    elsif g.uses >= b.max_uses then err := 'deja';
    elsif b.one_per_member and exists (select 1 from hg_gift_code_claims c where c.batch_id = b.id and c.user_id = me) then err := 'deja_lot';
    end if;
  end if;
  if err is not null then
    insert into hg_gift_code_attempts(user_id, ok) values (me, false);
    return jsonb_build_object('ok', false, 'error', err, 'message', case err
      when 'inconnu' then 'Ce code n’existe pas. Vérifie les 8 signes (sans 0, O, 1, I ni L).'
      when 'desactive' then 'Ce code n’est plus valable.'
      when 'expire' then 'Code expiré.'
      when 'deja_lot' then 'Tu as déjà utilisé un code de ce lot.'
      else 'Déjà utilisé.' end);
  end if;
  return jsonb_build_object('ok', true, 'hash', h, 'batch', b.id, 'code', hg_gift_code_fmt(n), 'lot', hg_gift_code_lot(b));
end $$;

-- Membre : ce que donne un code (sans l'utiliser). Un code faux compte comme un essai.
create or replace function public.hg_gift_code_peek(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare r jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_eco_lock(auth.uid());
  r := hg_gift_code_check(p_code, false);
  return r - 'hash' - 'batch';
end $$;

-- Membre : utilise un code. Verrou par membre, verrou du code ; livraison dans la même transaction :
-- booster (stock du type), Paillettes (hg_wallet_add, clé « code:<empreinte> »), ou carte (hg_card_give, source cadeau).
create or replace function public.hg_gift_code_redeem(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); r jsonb; b hg_gift_code_batches; h text; cp bigint; sh boolean; t hg_booster_types; msg text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_eco_lock(me);
  r := hg_gift_code_check(p_code, true);
  if not (r->>'ok')::boolean then return r; end if;
  h := r->>'hash';
  select * into b from hg_gift_code_batches where id = (r->>'batch')::uuid for update;
  begin
    insert into hg_gift_code_claims(code_hash, batch_id, user_id) values (h, b.id, me);
    update hg_gift_codes set uses = uses + 1 where code_hash = h;
    if b.kind = 'paillettes' then
      if not hg_wallet_add(me, b.amount, 'code', 'code:' || h) then raise exception 'Déjà utilisé.'; end if;
    elsif b.kind = 'booster' then
      select * into t from hg_booster_types where id = b.type_id and active;
      if not found then raise exception 'Ce type de booster n’est plus disponible.'; end if;
      insert into hg_wallets(user_id) values (me) on conflict do nothing;
      perform 1 from hg_wallets where user_id = me for update;
      insert into hg_booster_stock(user_id, type_id, qty) values (me, b.type_id, b.amount)
        on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
    else
      cp := hg_card_give(me, b.card_id, b.shiny, 'cadeau');
      select shiny into sh from hg_card_copies where id = cp;
      perform hg_card_check_sets(me);
    end if;
  exception when others then
    msg := sqlerrm;
    insert into hg_gift_code_attempts(user_id, ok) values (me, false);
    return jsonb_build_object('ok', false, 'error', 'livraison', 'message', msg);
  end;
  insert into hg_gift_code_attempts(user_id, ok) values (me, true);
  return jsonb_build_object('ok', true, 'code', r->>'code', 'lot', r->'lot', 'copy_id', cp, 'shiny', coalesce(sh, b.shiny),
    'serial', (select serial from hg_card_copies where id = cp));
end $$;

-- Staff « cartes » : crée un lot et renvoie les codes en clair (une seule fois ; seule l'empreinte est gardée).
-- p = { kind, count (1-200), amount, type_id, card_id, shiny, max_uses (1-500), one_per_member, expires_at, note }.
-- Plafonds : Paillettes par code ≤ plafonds.code_paillettes (1000 par défaut), boosters par code ≤ 10.
create or replace function public.hg_gift_codes_create(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_kind text := p->>'kind';
  v_count int; v_amount int; v_uses int; v_exp timestamptz; v_note text; v_card hg_cards; v_shiny boolean;
  v_type text := nullif(p->>'type_id', ''); v_batch uuid; v_codes text[] := '{}'; c text; i int := 0; v_max int;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if v_kind is null or v_kind not in ('booster', 'paillettes', 'carte') then raise exception 'Type de lot inconnu'; end if;
  if coalesce(p->>'count', '') !~ '^\d{1,4}$' then raise exception 'Nombre de codes : entre 1 et 200'; end if;
  v_count := (p->>'count')::int;
  if v_count < 1 or v_count > 200 then raise exception 'Nombre de codes : entre 1 et 200'; end if;
  if coalesce(p->>'max_uses', '1') !~ '^\d{1,4}$' then raise exception 'Utilisations par code : entre 1 et 500'; end if;
  v_uses := coalesce((p->>'max_uses')::int, 1);
  if v_uses < 1 or v_uses > 500 then raise exception 'Utilisations par code : entre 1 et 500'; end if;
  if coalesce(p->>'amount', '1') !~ '^\d{1,6}$' then raise exception 'Quantité invalide'; end if;
  v_amount := coalesce((p->>'amount')::int, 1);
  v_shiny := coalesce((p->>'shiny')::boolean, false);
  v_note := nullif(btrim(coalesce(p->>'note', '')), '');
  if v_note is not null and char_length(v_note) > 200 then raise exception 'La note fait au plus 200 caractères'; end if;
  if nullif(p->>'expires_at', '') is not null then
    v_exp := (p->>'expires_at')::timestamptz;
    if v_exp <= now() then raise exception 'La date d’expiration doit être dans le futur'; end if;
    if v_exp > now() + interval '2 years' then raise exception 'Expiration : deux ans au plus'; end if;
  end if;
  if v_kind = 'paillettes' then
    v_max := hg_eco_cap('code_paillettes', 1000);
    if v_amount < 1 or v_amount > v_max then raise exception 'Paillettes par code : entre 1 et %', v_max; end if;
    v_type := null;
  elsif v_kind = 'booster' then
    if v_amount < 1 or v_amount > 10 then raise exception 'Boosters par code : entre 1 et 10'; end if;
    if not exists (select 1 from hg_booster_types t where t.id = v_type and t.active) then raise exception 'Type de booster inconnu ou désactivé'; end if;
  else
    v_amount := 1; v_type := null;
    select * into v_card from hg_cards where id = nullif(p->>'card_id', '')::uuid;
    if not found then raise exception 'Choisis une carte'; end if;
    if v_card.rarity = 'identite' then raise exception 'Les cartes Identité ne se donnent pas par code'; end if;
    v_shiny := v_shiny and v_card.can_shiny;
    if v_card.max_copies is not null then
      if (select coalesce(max(serial), 0) from hg_card_copies where card_id = v_card.id) + v_count * v_uses > v_card.max_copies then
        raise exception 'Pas assez d’exemplaires disponibles pour « % »', v_card.name;
      end if;
    end if;
  end if;
  insert into hg_gift_code_batches(kind, type_id, amount, card_id, shiny, codes, max_uses, one_per_member, expires_at, note, created_by)
    values (v_kind, v_type, v_amount, v_card.id, v_shiny, v_count, v_uses, coalesce((p->>'one_per_member')::boolean, false), v_exp, v_note, auth.uid())
    returning id into v_batch;
  while coalesce(array_length(v_codes, 1), 0) < v_count loop
    i := i + 1;
    if i > v_count * 5 + 20 then raise exception 'Génération des codes impossible, réessaie'; end if;
    c := hg_gift_code_new();
    insert into hg_gift_codes(code_hash, batch_id) values (hg_gift_code_hash(c), v_batch) on conflict do nothing;
    if found then v_codes := v_codes || hg_gift_code_fmt(c); end if;
  end loop;
  perform hg_admin_audit('codes_cadeaux', null, v_batch::text, jsonb_build_object('type', v_kind, 'quantite', v_amount,
    'type_booster', v_type, 'carte', v_card.id, 'brillante', v_shiny, 'codes', v_count, 'utilisations', v_uses,
    'expire', v_exp, 'note', v_note,
    'total_max', jsonb_build_object('paillettes', case when v_kind = 'paillettes' then v_amount * v_count * v_uses else 0 end,
      'boosters', case when v_kind = 'booster' then v_amount * v_count * v_uses else 0 end,
      'cartes', case when v_kind = 'carte' then v_count * v_uses else 0 end)));
  return jsonb_build_object('batch_id', v_batch, 'codes', to_jsonb(v_codes));
end $$;

-- Staff « cartes » : lots (sans les codes), utilisations et total distribué.
create or replace function public.hg_gift_codes_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into res from (
    select jsonb_build_object('id', b.id, 'kind', b.kind, 'amount', b.amount, 'type_id', b.type_id, 'shiny', b.shiny,
      'lot', hg_gift_code_lot(b), 'codes', b.codes, 'max_uses', b.max_uses, 'one_per_member', b.one_per_member,
      'expires_at', b.expires_at, 'note', b.note, 'active', b.active, 'created_at', b.created_at,
      'created_by', (select p.pseudo from hg_profiles p where p.id = b.created_by),
      'used', (select count(*) from hg_gift_code_claims c where c.batch_id = b.id),
      'codes_used', (select count(*) from hg_gift_codes g where g.batch_id = b.id and g.uses > 0)) as x
    from hg_gift_code_batches b order by b.created_at desc limit 100) s;
  return res;
end $$;

-- Staff « cartes » : active ou désactive un lot entier.
create or replace function public.hg_gift_codes_batch_active(p_batch uuid, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  update hg_gift_code_batches set active = coalesce(p_active, false) where id = p_batch;
  if not found then raise exception 'Lot introuvable'; end if;
  perform hg_admin_audit('codes_cadeaux_lot', null, p_batch::text, jsonb_build_object('actif', coalesce(p_active, false)));
end $$;

-- =====================================================================
-- C10. Recettes de l'Atelier
-- =====================================================================
alter table public.hg_card_copies add column if not exists consumed_by text;
comment on column public.hg_card_copies.consumed_by is 'Exemplaire consommé par une recette de l''Atelier (« recette:<id> ») ; recycled_at est alors rempli (migration 081).';
create table if not exists public.hg_card_recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 200),
  output_card uuid not null references public.hg_cards(id),
  output_shiny boolean not null default false,
  inputs jsonb not null,
  paillettes integer not null default 0 check (paillettes between 0 and 100000),
  starts_at timestamptz,
  ends_at timestamptz,
  max_total integer check (max_total is null or max_total between 1 and 10000),
  once_per_user boolean not null default false,
  active boolean not null default true,
  sort integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hg_card_recipes is 'Recettes de l''Atelier (C10, migration 081) : inputs = [{"card":uuid,"qty":n}] ou [{"tag":"minecraft","qty":n}]. Écriture par RPC (hg_card_recipe_save).';
create table if not exists public.hg_card_recipe_uses (
  id bigint generated always as identity primary key,
  recipe_id uuid not null references public.hg_card_recipes(id),
  user_id uuid not null,
  copies bigint[] not null,
  copy_out bigint,
  created_at timestamptz not null default now()
);
create index if not exists hg_card_recipe_uses_recipe_idx on public.hg_card_recipe_uses(recipe_id, user_id);
alter table public.hg_card_recipes enable row level security;
alter table public.hg_card_recipe_uses enable row level security;
revoke all on public.hg_card_recipes, public.hg_card_recipe_uses from anon;
revoke insert, update, truncate, references, trigger on public.hg_card_recipes, public.hg_card_recipe_uses from authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'hg_card_recipes' and policyname = 'hg_card_recipes_read') then
    create policy hg_card_recipes_read on public.hg_card_recipes for select to authenticated using (hg_is_member());
  end if;
end $$;

-- Ingrédients normalisés et contrôlés : 1 à 6 lignes, 1 à 5 par ligne, 10 cartes au plus ; une carte existante
-- (ni identité ni unique) ou un tag porté par au moins une carte. Renvoie les ingrédients et leur valeur minimale
-- de recyclage (contrôle anti-boucle de Paillettes).
create or replace function public.hg_card_recipe_inputs_check(p_inputs jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare e jsonb; out jsonb := '[]'; n int := 0; q int; k hg_cards; v int; val int := 0; t text;
begin
  if jsonb_typeof(p_inputs) is distinct from 'array' or jsonb_array_length(p_inputs) not between 1 and 6 then
    raise exception 'Une recette a de 1 à 6 ingrédients';
  end if;
  for e in select * from jsonb_array_elements(p_inputs) loop
    if coalesce(e->>'qty', '') !~ '^[1-5]$' then raise exception 'Quantité d’un ingrédient : de 1 à 5'; end if;
    q := (e->>'qty')::int; n := n + q;
    if nullif(e->>'card', '') is not null then
      select * into k from hg_cards where id = (e->>'card')::uuid;
      if not found then raise exception 'Ingrédient : carte introuvable'; end if;
      if k.rarity in ('identite', 'unique') then raise exception 'Une carte Identité ou unique ne peut pas être un ingrédient'; end if;
      out := out || jsonb_build_object('card', k.id, 'qty', q);
      val := val + q * hg_card_recycle_value(k.rarity, false);
    elsif nullif(e->>'tag', '') is not null then
      t := e->>'tag';
      select min(hg_card_recycle_value(x.rarity, false)) into v from hg_cards x where x.tag = t and x.rarity not in ('identite', 'unique');
      if v is null then raise exception 'Ingrédient : aucune carte ne porte le tag « % »', t; end if;
      out := out || jsonb_build_object('tag', t, 'qty', q);
      val := val + q * v;
    else
      raise exception 'Ingrédient : choisis une carte ou un tag';
    end if;
  end loop;
  if n > 10 then raise exception 'Une recette demande 10 cartes au plus'; end if;
  return jsonb_build_object('inputs', out, 'value', val, 'count', n);
end $$;

-- Staff « cartes » : crée ou modifie une recette. La carte obtenue ne doit pas être fabricable contre des Paillettes
-- (sinon la recette ne sert à rien), et sa valeur de recyclage ne doit pas dépasser celle des ingrédients plus les
-- Paillettes demandées (sinon boucle de Paillettes).
create or replace function public.hg_card_recipe_save(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; k hg_cards; chk jsonb; v_p int; v_shiny boolean; v_max int; v_start timestamptz; v_end timestamptz;
  v_name text := btrim(coalesce(p->>'name', '')); v_desc text := nullif(btrim(coalesce(p->>'description', '')), ''); v_new boolean;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'Nom de la recette : de 2 à 80 caractères'; end if;
  if v_desc is not null and char_length(v_desc) > 200 then raise exception 'Description : 200 caractères au plus'; end if;
  select * into k from hg_cards where id = nullif(p->>'output_card', '')::uuid;
  if not found then raise exception 'Choisis la carte obtenue'; end if;
  if k.rarity = 'identite' then raise exception 'Une carte Identité ne s’obtient pas par recette'; end if;
  if k.craftable and k.rarity <> 'unique' then raise exception 'La carte obtenue est fabricable contre des Paillettes : décoche « Fabricable » dans sa fiche'; end if;
  chk := hg_card_recipe_inputs_check(p->'inputs');
  if chk->'inputs' @> jsonb_build_array(jsonb_build_object('card', k.id)) then raise exception 'La carte obtenue ne peut pas être un ingrédient'; end if;
  if coalesce(p->>'paillettes', '0') !~ '^\d{1,6}$' then raise exception 'Paillettes : de 0 à 100 000'; end if;
  v_p := coalesce((p->>'paillettes')::int, 0);
  if v_p > 100000 then raise exception 'Paillettes : de 0 à 100 000'; end if;
  v_shiny := coalesce((p->>'output_shiny')::boolean, false) and k.can_shiny;
  if hg_card_recycle_value(k.rarity, v_shiny) > (chk->>'value')::int + v_p then
    raise exception 'La carte obtenue se recycle pour % ✦, plus que ses ingrédients (% ✦) : ajoute des ingrédients ou des Paillettes',
      hg_card_recycle_value(k.rarity, v_shiny), (chk->>'value')::int + v_p;
  end if;
  if nullif(p->>'max_total', '') is not null then
    if p->>'max_total' !~ '^\d{1,5}$' or (p->>'max_total')::int not between 1 and 10000 then raise exception 'Nombre total : de 1 à 10 000'; end if;
    v_max := (p->>'max_total')::int;
  end if;
  if k.max_copies is not null and coalesce(v_max, 0) = 0 then raise exception 'Carte limitée : indique un nombre total de fabrications'; end if;
  v_start := nullif(p->>'starts_at', '')::timestamptz;
  v_end := nullif(p->>'ends_at', '')::timestamptz;
  if v_start is not null and v_end is not null and v_end <= v_start then raise exception 'La fin doit suivre le début'; end if;
  v_new := v_id is null;
  if v_new then
    insert into hg_card_recipes(name, description, output_card, output_shiny, inputs, paillettes, starts_at, ends_at, max_total,
      once_per_user, active, sort, created_by)
    values (v_name, v_desc, k.id, v_shiny, chk->'inputs', v_p, v_start, v_end, v_max, coalesce((p->>'once_per_user')::boolean, false),
      coalesce((p->>'active')::boolean, true), coalesce(nullif(p->>'sort', '')::int, 0), auth.uid())
    returning id into v_id;
  else
    update hg_card_recipes set name = v_name, description = v_desc, output_card = k.id, output_shiny = v_shiny, inputs = chk->'inputs',
      paillettes = v_p, starts_at = v_start, ends_at = v_end, max_total = v_max, once_per_user = coalesce((p->>'once_per_user')::boolean, false),
      active = coalesce((p->>'active')::boolean, true), sort = coalesce(nullif(p->>'sort', '')::int, 0), updated_at = now()
     where id = v_id;
    if not found then raise exception 'Recette introuvable'; end if;
  end if;
  perform hg_admin_audit('recette_atelier', null, v_id::text, jsonb_build_object('nouvelle', v_new, 'nom', v_name, 'carte', k.id,
    'ingredients', chk->'inputs', 'paillettes', v_p, 'active', coalesce((p->>'active')::boolean, true)));
  return v_id;
end $$;

-- Staff « cartes » : recettes et nombre de fabrications.
create or replace function public.hg_card_recipes_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('uses', (select count(*) from hg_card_recipe_uses u where u.recipe_id = r.id),
      'output_name', (select k.name from hg_cards k where k.id = r.output_card)) order by r.sort, r.created_at), '[]'::jsonb)
    into res from hg_card_recipes r;
  return res;
end $$;

-- Membre : recettes ouvertes (actives, dans leurs dates), avec la carte obtenue, les ingrédients (noms des cartes,
-- libellés des tags et cartes du tag), ce qui reste, et les exemplaires en vitrine (jamais proposés).
create or replace function public.hg_card_recipes_me()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); res jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'output_shiny', r.output_shiny, 'paillettes', r.paillettes,
      'starts_at', r.starts_at, 'ends_at', r.ends_at, 'max_total', r.max_total, 'once_per_user', r.once_per_user,
      'used_total', (select count(*) from hg_card_recipe_uses u where u.recipe_id = r.id),
      'done', exists (select 1 from hg_card_recipe_uses u where u.recipe_id = r.id and u.user_id = me),
      'output', (select jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family, 'image_url', k.image_url,
                  'flavor', k.flavor, 'caption', k.caption, 'number', k.number, 'max_copies', k.max_copies, 'set_id', k.set_id)
                  from hg_cards k where k.id = r.output_card),
      'inputs', (select coalesce(jsonb_agg(case when e.v ? 'card' then e.v || jsonb_build_object('name', k2.name, 'rarity', k2.rarity)
                   else e.v || jsonb_build_object('label', hg_card_tag_label(e.v->>'tag'),
                     'cards', (select coalesce(jsonb_agg(x.id), '[]'::jsonb) from hg_cards x where x.tag = e.v->>'tag' and x.rarity not in ('identite', 'unique'))) end), '[]'::jsonb)
                  from jsonb_array_elements(r.inputs) as e(v) left join hg_cards k2 on k2.id = nullif(e.v->>'card', '')::uuid)
    ) order by r.sort, r.created_at), '[]'::jsonb)
    into res
    from hg_card_recipes r
   where r.active and (r.starts_at is null or r.starts_at <= now()) and (r.ends_at is null or r.ends_at > now());
  return jsonb_build_object('recipes', res,
    'showcase', (select coalesce(jsonb_agg(s.copy_id), '[]'::jsonb) from hg_card_showcase s where s.user_id = me));
end $$;

-- Membre : fabrique une recette avec les exemplaires choisis. Contrôles : recette ouverte, limites (total, une fois
-- par membre), exemplaires à moi, vivants, libres (ni en échange ni en vitrine), ni identité ni unique, et qui
-- correspondent exactement aux ingrédients ; le dernier exemplaire d'une carte n'est consommé qu'avec p_confirm_last.
-- Consomme (recycled_at, consumed_by), débite les Paillettes (journal « atelier »), donne la carte (source atelier).
create or replace function public.hg_card_recipe_craft(p_recipe uuid, p_copies bigint[], p_confirm_last boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid(); r hg_card_recipes; e jsonb; v_left bigint[]; v_pick bigint[]; q int; n int; bal int; cp bigint; sh boolean;
  k hg_cards; v_need int := 0; x record; god boolean := hg_god_mode();
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_eco_lock(me);
  select * into r from hg_card_recipes where id = p_recipe for update;
  if not found or not r.active or (r.starts_at is not null and r.starts_at > now()) or (r.ends_at is not null and r.ends_at <= now()) then
    raise exception 'Cette recette n’est pas disponible';
  end if;
  if r.once_per_user and exists (select 1 from hg_card_recipe_uses u where u.recipe_id = r.id and u.user_id = me) then
    raise exception 'Tu as déjà fabriqué cette recette';
  end if;
  if r.max_total is not null and (select count(*) from hg_card_recipe_uses u where u.recipe_id = r.id) >= r.max_total then
    raise exception 'Cette recette est épuisée';
  end if;
  select coalesce(sum((i.v->>'qty')::int), 0) into v_need from jsonb_array_elements(r.inputs) as i(v);
  v_left := array(select distinct c from unnest(coalesce(p_copies, '{}')) c order by 1);
  if coalesce(array_length(v_left, 1), 0) <> coalesce(array_length(p_copies, 1), 0) or coalesce(array_length(v_left, 1), 0) <> v_need then
    raise exception 'Choisis exactement % cartes pour cette recette', v_need;
  end if;
  -- Portefeuille puis exemplaires (ordre des verrous commun au recyclage)
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select paillettes into bal from hg_wallets where user_id = me for update;
  perform 1 from hg_card_copies where id = any(v_left) order by id for update;
  for x in select c.id, c.owner_id, c.recycled_at, c.locked_trade, k2.rarity, k2.name,
                  exists (select 1 from hg_card_showcase s where s.copy_id = c.id) as shown
             from unnest(v_left) u(id) left join hg_card_copies c on c.id = u.id left join hg_cards k2 on k2.id = c.card_id loop
    if x.owner_id is distinct from me or x.recycled_at is not null then raise exception 'Une des cartes choisies ne t’appartient plus'; end if;
    if x.locked_trade is not null then raise exception '« % » est bloquée par une offre d’échange', x.name; end if;
    if x.shown then raise exception '« % » est dans ta vitrine : retire-la d’abord', x.name; end if;
    if x.rarity in ('identite', 'unique') then raise exception '« % » ne peut pas servir d’ingrédient', x.name; end if;
  end loop;
  -- Correspondance : les ingrédients « carte précise » d'abord, puis les tags.
  for e in select i.v from jsonb_array_elements(r.inputs) as i(v) order by (i.v ? 'card') desc loop
    q := (e->>'qty')::int;
    v_pick := array(select c.id from hg_card_copies c join hg_cards k2 on k2.id = c.card_id
                     where c.id = any(v_left)
                       and case when e ? 'card' then c.card_id = (e->>'card')::uuid else k2.tag = e->>'tag' end
                     order by c.shiny, c.id limit q);
    if coalesce(array_length(v_pick, 1), 0) < q then
      raise exception 'Il manque des cartes pour l’ingrédient « % »',
        coalesce((select k3.name from hg_cards k3 where k3.id = nullif(e->>'card', '')::uuid), hg_card_tag_label(e->>'tag'));
    end if;
    v_left := array(select c from unnest(v_left) c where not (c = any(v_pick)));
  end loop;
  if coalesce(array_length(v_left, 1), 0) > 0 then raise exception 'Certaines cartes choisies ne correspondent à aucun ingrédient'; end if;
  -- Dernier exemplaire : il faut le confirmer.
  if not coalesce(p_confirm_last, false) then
    for x in select c.card_id, min(k2.name) as name from hg_card_copies c join hg_cards k2 on k2.id = c.card_id
              where c.id = any(p_copies) group by c.card_id loop
      if not exists (select 1 from hg_card_copies c where c.card_id = x.card_id and c.owner_id = me and c.recycled_at is null and not (c.id = any(p_copies))) then
        raise exception 'Tu utiliserais ton dernier exemplaire de « % » : confirme pour continuer', x.name using errcode = 'P0001', hint = 'dernier';
      end if;
    end loop;
  end if;
  if not god and r.paillettes > 0 and bal < r.paillettes then raise exception 'Pas assez de Paillettes (il en faut %)', r.paillettes; end if;
  update hg_card_copies set recycled_at = now(), consumed_by = 'recette:' || r.id
   where id = any(p_copies) and owner_id = me and recycled_at is null and locked_trade is null;
  get diagnostics n = row_count;
  if n <> v_need then raise exception 'Certaines cartes ne peuvent pas être utilisées (échange en cours ?)'; end if;
  if not god and r.paillettes > 0 then perform hg_wallet_add(me, -r.paillettes, 'atelier', null); end if;
  cp := hg_card_give(me, r.output_card, r.output_shiny, 'atelier');
  insert into hg_card_recipe_uses(recipe_id, user_id, copies, copy_out) values (r.id, me, p_copies, cp);
  select * into k from hg_cards where id = r.output_card;
  select shiny into sh from hg_card_copies where id = cp;
  if hg_card_rank(k.rarity) >= 5 then
    insert into hg_activity(user_id, kind, text)
      select me, 'cartes', p.pseudo || ' a fabriqué « ' || k.name || ' » à l’Atelier (' || hg_rarity_label(k.rarity) || ') !'
        from hg_profiles p where p.id = me and not p.is_ghost;
  end if;
  perform hg_card_check_sets(me);
  return jsonb_build_object('copy_id', cp, 'card_id', k.id, 'rarity', k.rarity, 'shiny', sh, 'cost', r.paillettes,
    'serial', (select serial from hg_card_copies where id = cp), 'consumed', to_jsonb(p_copies));
end $$;

-- =====================================================================
-- C11. Enchère d'une carte unique
-- =====================================================================
create table if not exists public.hg_card_auctions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.hg_cards(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hard_end_at timestamptz not null,
  min_bid integer not null check (min_bid between 1 and 100000),
  step integer not null check (step between 1 and 10000),
  status text not null default 'prevue' check (status in ('prevue', 'ouverte', 'close', 'annulee')),
  top_bid bigint,
  winner uuid,
  price integer,
  copy_id bigint,
  closed_at timestamptz,
  announced_start_at timestamptz,
  announced_end_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and hard_end_at >= ends_at)
);
comment on table public.hg_card_auctions is 'Enchères de cartes uniques (C11, migration 081). Paillettes du gagnant détruites. announced_* : réservation des annonces du bot (modèle 075).';
create unique index if not exists hg_card_auctions_card_open on public.hg_card_auctions(card_id) where status in ('prevue', 'ouverte');
create index if not exists hg_card_auctions_status_idx on public.hg_card_auctions(status, ends_at);
create table if not exists public.hg_card_bids (
  id bigint generated always as identity primary key,
  auction_id uuid not null references public.hg_card_auctions(id),
  user_id uuid not null,
  amount integer not null check (amount between 1 and 1000000),
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hg_card_bids_auction_idx on public.hg_card_bids(auction_id, created_at desc);
alter table public.hg_card_auctions enable row level security;
alter table public.hg_card_bids enable row level security;
revoke all on public.hg_card_auctions, public.hg_card_bids from anon, authenticated;

-- Clôture des enchères échues : idempotente (statut « prevue » / « ouverte » et fin passée seulement).
-- Avec une offre : la carte va au meilleur enchérisseur (source « evenement »), ses Paillettes restent détruites.
-- Si la carte ne peut pas être donnée (exemplaire déjà attribué), l'offre est remboursée et l'enchère annulée.
-- Sans offre : enchère close, la carte reste en réserve. Renvoie le nombre d'enchères traitées.
create or replace function public.hg_auction_close()
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare a hg_card_auctions; b hg_card_bids; cp bigint; n int := 0; v_name text;
begin
  for a in select * from hg_card_auctions where status in ('prevue', 'ouverte') and ends_at <= now() order by ends_at for update skip locked loop
    select * into b from hg_card_bids where id = a.top_bid;
    if b.id is null then
      update hg_card_auctions set status = 'close', closed_at = now() where id = a.id;
    else
      begin
        cp := hg_card_give(b.user_id, a.card_id, false, 'evenement');
        update hg_card_auctions set status = 'close', closed_at = now(), winner = b.user_id, price = b.amount, copy_id = cp where id = a.id;
        select k.name into v_name from hg_cards k where k.id = a.card_id;
        insert into hg_activity(user_id, kind, text)
          select b.user_id, 'cartes', p.pseudo || ' remporte l’enchère de « ' || v_name || ' » pour ' || b.amount || ' Paillettes !'
            from hg_profiles p where p.id = b.user_id and not p.is_ghost;
        perform hg_card_check_sets(b.user_id);
      exception when others then
        perform hg_wallet_add(b.user_id, b.amount, 'enchere_remboursee', 'bid:' || b.id);
        update hg_card_bids set refunded_at = now() where id = b.id;
        update hg_card_auctions set status = 'annulee', closed_at = now() where id = a.id;
      end;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Plafond d'offre d'un membre : la moitié de son solde du début de la semaine (lundi, Zurich), recalculé à partir
-- du journal des Paillettes. Fonction interne.
create or replace function public.hg_auction_cap(p_user uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select greatest(0, (coalesce((select w.paillettes from hg_wallets w where w.user_id = p_user), 0)
    - coalesce((select sum(l.delta) from hg_wallet_log l where l.user_id = p_user and l.created_at >= hg_eco_week_start()), 0)) / 2)::int
$$;

-- Membre : enchère en cours (ou la prochaine, ou la dernière close depuis 2 jours), 10 dernières offres (pseudos et
-- montants, jamais de solde), et pour moi : plafond, offre minimale, gagnant de la précédente.
create or replace function public.hg_auction_current()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); a hg_card_auctions; top hg_card_bids; last_win uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  perform hg_auction_close();
  select * into a from hg_card_auctions where status in ('ouverte', 'prevue') order by (status = 'ouverte' or starts_at <= now()) desc, starts_at limit 1;
  if a.id is null then
    select * into a from hg_card_auctions where status = 'close' and closed_at > now() - interval '2 days' order by closed_at desc limit 1;
  end if;
  if a.id is null then return jsonb_build_object('auction', null); end if;
  select * into top from hg_card_bids where id = a.top_bid;
  select x.winner into last_win from hg_card_auctions x where x.status = 'close' and x.winner is not null and x.id <> a.id order by x.closed_at desc limit 1;
  return jsonb_build_object(
    'auction', jsonb_build_object('id', a.id, 'status', case when a.status = 'prevue' and a.starts_at <= now() then 'ouverte' else a.status end,
      'starts_at', a.starts_at, 'ends_at', a.ends_at, 'hard_end_at', a.hard_end_at, 'min_bid', a.min_bid, 'step', a.step,
      'next_min', case when top.id is null then a.min_bid else top.amount + a.step end,
      'price', a.price, 'winner', (select p.pseudo from hg_profiles p where p.id = a.winner), 'won', a.winner = me,
      'card', (select jsonb_build_object('id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family, 'image_url', k.image_url,
                 'flavor', k.flavor, 'caption', k.caption, 'number', k.number, 'max_copies', k.max_copies, 'set_id', k.set_id)
               from hg_cards k where k.id = a.card_id),
      'top', case when top.id is null then null else jsonb_build_object('amount', top.amount, 'mine', top.user_id = me,
        'pseudo', (select p.pseudo from hg_profiles p where p.id = top.user_id),
        'avatar_url', (select p.avatar_url from hg_profiles p where p.id = top.user_id),
        'color', (select p.color from hg_profiles p where p.id = top.user_id)) end),
    'bids', (select coalesce(jsonb_agg(jsonb_build_object('amount', b.amount, 'created_at', b.created_at, 'mine', b.user_id = me,
               'pseudo', p.pseudo, 'avatar_url', p.avatar_url, 'color', p.color) order by b.created_at desc), '[]'::jsonb)
             from (select * from hg_card_bids where auction_id = a.id order by created_at desc limit 10) b
             left join hg_profiles p on p.id = b.user_id),
    'me', jsonb_build_object('cap', hg_auction_cap(me), 'last_winner', last_win = me,
      'balance', (select w.paillettes from hg_wallets w where w.user_id = me)));
end $$;

-- Membre : enchérit. Verrou par enchère, contrôles (ouverte, montant ≥ meilleure offre + pas, pas déjà en tête,
-- pas gagnant de la précédente, plafond de la moitié du solde de lundi, solde suffisant), débit tout de suite
-- (« enchere », clé bid:<id>), remboursement de l'ancien meilleur dans la même transaction (« enchere_remboursee »),
-- prolongation de 5 minutes dans les 5 dernières minutes (une heure au plus, hard_end_at).
create or replace function public.hg_auction_bid(p_auction uuid, p_amount integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); a hg_card_auctions; top hg_card_bids; v_min int; v_cap int; bal int; v_bid bigint; last_win uuid; v_end timestamptz;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000 then raise exception 'Montant invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_auction:' || coalesce(p_auction::text, ''), 0));
  select * into a from hg_card_auctions where id = p_auction for update;
  if not found or a.status not in ('prevue', 'ouverte') or a.starts_at > now() then raise exception 'Cette enchère n’est pas ouverte'; end if;
  if a.ends_at <= now() then raise exception 'L’enchère est terminée'; end if;
  select * into top from hg_card_bids where id = a.top_bid;
  if top.user_id = me then raise exception 'Tu as déjà la meilleure offre'; end if;
  v_min := case when top.id is null then a.min_bid else top.amount + a.step end;
  if p_amount < v_min then raise exception 'L’offre minimale est de % Paillettes', v_min; end if;
  select x.winner into last_win from hg_card_auctions x where x.status = 'close' and x.winner is not null and x.id <> a.id order by x.closed_at desc limit 1;
  if last_win = me then raise exception 'Tu as gagné la dernière enchère : laisse sa chance aux autres cette fois'; end if;
  -- Portefeuilles : le mien et celui de l'ancien meilleur, dans l'ordre des identifiants.
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  perform 1 from hg_wallets where user_id in (me, top.user_id) order by user_id for update;
  select paillettes into bal from hg_wallets where user_id = me;
  v_cap := hg_auction_cap(me);
  if p_amount > v_cap then raise exception 'Plafond : % Paillettes (la moitié de ton solde de lundi)', v_cap; end if;
  if p_amount > bal then raise exception 'Pas assez de Paillettes (il en faut %)', p_amount; end if;
  insert into hg_card_bids(auction_id, user_id, amount) values (a.id, me, p_amount) returning id into v_bid;
  if not hg_wallet_add(me, -p_amount, 'enchere', 'bid:' || v_bid) then raise exception 'Offre déjà enregistrée'; end if;
  if top.id is not null then
    perform hg_wallet_add(top.user_id, top.amount, 'enchere_remboursee', 'bid:' || top.id);
    update hg_card_bids set refunded_at = now() where id = top.id;
  end if;
  v_end := a.ends_at;
  if a.ends_at - now() < interval '5 minutes' then v_end := least(now() + interval '5 minutes', a.hard_end_at); end if;
  update hg_card_auctions set top_bid = v_bid, status = 'ouverte', ends_at = greatest(v_end, a.ends_at) where id = a.id;
  return jsonb_build_object('bid', v_bid, 'amount', p_amount, 'ends_at', greatest(v_end, a.ends_at),
    'outbid', case when top.id is null then null else top.user_id end);
end $$;

-- Staff « cartes » : planifie une enchère. p = { card_id, starts_at, ends_at, min_bid, step }.
-- Carte unique, sans exemplaire existant, qui ne représente pas un membre, sans autre enchère prévue ou ouverte.
create or replace function public.hg_auction_create(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare k hg_cards; v_start timestamptz; v_end timestamptz; v_min int; v_step int; v_id uuid;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select * into k from hg_cards where id = nullif(p->>'card_id', '')::uuid for update;
  if not found then raise exception 'Choisis une carte'; end if;
  if k.rarity <> 'unique' then raise exception 'Seule une carte unique peut être mise aux enchères'; end if;
  if k.member_id is not null or k.family = 'membre' then raise exception 'Une carte qui représente un membre ne se met pas aux enchères'; end if;
  if exists (select 1 from hg_card_copies x where x.card_id = k.id) then raise exception 'Cette carte unique a déjà été attribuée'; end if;
  if exists (select 1 from hg_card_auctions x where x.card_id = k.id and x.status in ('prevue', 'ouverte')) then raise exception 'Cette carte est déjà aux enchères'; end if;
  v_start := coalesce(nullif(p->>'starts_at', '')::timestamptz, now());
  v_end := nullif(p->>'ends_at', '')::timestamptz;
  if v_end is null then raise exception 'Indique la fin de l’enchère'; end if;
  if v_end <= greatest(v_start, now()) + interval '30 minutes' then raise exception 'L’enchère dure au moins 30 minutes'; end if;
  if v_end - v_start > interval '7 days' then raise exception 'L’enchère dure 7 jours au plus'; end if;
  if v_start > now() + interval '60 days' then raise exception 'Début : dans 60 jours au plus'; end if;
  if coalesce(p->>'min_bid', '') !~ '^\d{1,6}$' or (p->>'min_bid')::int not between 1 and 100000 then raise exception 'Mise de départ : de 1 à 100 000'; end if;
  if coalesce(p->>'step', '') !~ '^\d{1,5}$' or (p->>'step')::int not between 1 and 10000 then raise exception 'Pas minimal : de 1 à 10 000'; end if;
  v_min := (p->>'min_bid')::int; v_step := (p->>'step')::int;
  insert into hg_card_auctions(card_id, starts_at, ends_at, hard_end_at, min_bid, step, created_by)
    values (k.id, v_start, v_end, v_end + interval '1 hour', v_min, v_step, auth.uid()) returning id into v_id;
  perform hg_admin_audit('enchere_creee', null, v_id::text, jsonb_build_object('carte', k.id, 'nom', k.name, 'debut', v_start, 'fin', v_end,
    'mise', v_min, 'pas', v_step));
  return v_id;
end $$;

-- Staff « cartes » : annule une enchère prévue ou ouverte ; la meilleure offre (seule encore débitée) est remboursée.
create or replace function public.hg_auction_cancel(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare a hg_card_auctions; b hg_card_bids;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hg_auction:' || coalesce(p_id::text, ''), 0));
  select * into a from hg_card_auctions where id = p_id for update;
  if not found then raise exception 'Enchère introuvable'; end if;
  if a.status not in ('prevue', 'ouverte') then raise exception 'Cette enchère est déjà terminée'; end if;
  select * into b from hg_card_bids where id = a.top_bid and refunded_at is null;
  if b.id is not null then
    perform hg_wallet_add(b.user_id, b.amount, 'enchere_remboursee', 'bid:' || b.id);
    update hg_card_bids set refunded_at = now() where id = b.id;
  end if;
  update hg_card_auctions set status = 'annulee', closed_at = now() where id = a.id;
  perform hg_admin_audit('enchere_annulee', b.user_id, a.id::text, jsonb_build_object('carte', a.card_id, 'rembourse', coalesce(b.amount, 0)));
end $$;

-- Staff « cartes » : 50 dernières enchères (carte, dates, meilleure offre, gagnant, nombre d'offres).
create or replace function public.hg_auctions_admin()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare res jsonb;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  perform hg_auction_close();
  select coalesce(jsonb_agg(x order by x->>'starts_at' desc), '[]'::jsonb) into res from (
    select jsonb_build_object('id', a.id, 'card_id', a.card_id, 'card_name', k.name, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'min_bid', a.min_bid, 'step', a.step, 'status', a.status, 'price', a.price,
      'winner', (select p.pseudo from hg_profiles p where p.id = a.winner),
      'top', (select b.amount from hg_card_bids b where b.id = a.top_bid),
      'top_pseudo', (select p.pseudo from hg_card_bids b join hg_profiles p on p.id = b.user_id where b.id = a.top_bid),
      'bids', (select count(*) from hg_card_bids b where b.auction_id = a.id)) as x
    from hg_card_auctions a join hg_cards k on k.id = a.card_id order by a.starts_at desc limit 50) s;
  return res;
end $$;

-- =====================================================================
-- C12. Tableau « Je cherche / Je donne »
-- =====================================================================
alter table public.hg_profiles add column if not exists trade_board boolean not null default false;
alter table public.hg_profiles add column if not exists trade_board_note text;
comment on column public.hg_profiles.trade_board is 'Apparaître sur le tableau « Je cherche / Je donne » (inscription volontaire, migration 081).';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hg_profiles_trade_board_note_len' and conrelid = 'public.hg_profiles'::regclass) then
    alter table public.hg_profiles add constraint hg_profiles_trade_board_note_len check (trade_board_note is null or char_length(trade_board_note) <= 80);
  end if;
end $$;
create index if not exists hg_card_copies_card_owner_live on public.hg_card_copies(card_id, owner_id) where recycled_at is null;

-- Membre : s'inscrit (ou se retire) et écrit son petit mot (80 caractères, vide = aucun).
create or replace function public.hg_trade_board_set(p_on boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if v_note is not null and char_length(v_note) > 80 then raise exception 'Ton petit mot fait au plus 80 caractères'; end if;
  update hg_profiles set trade_board = coalesce(p_on, false), trade_board_note = v_note where id = auth.uid();
  return jsonb_build_object('on', coalesce(p_on, false), 'note', v_note);
end $$;

-- Staff « cartes » : efface le petit mot d'un membre (modération).
create or replace function public.hg_trade_board_note_clear(p_user uuid)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare v_old text;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  select trade_board_note into v_old from hg_profiles where id = p_user;
  update hg_profiles set trade_board_note = null where id = p_user;
  perform hg_admin_audit('tableau_note_effacee', p_user, null, jsonb_build_object('note', v_old));
end $$;

-- Membre : le tableau. Participants = membres inscrits, actifs (pas fantômes). Par carte (active, échangeable, ni
-- identité ni unique) : qui la cherche (liste de souhaits) et qui la donne (doubles libres : au moins deux exemplaires
-- vivants, dont des libres, ni en vitrine ni bloqués ; n = min(vivants - 1, libres)). Jamais de solde.
-- Filtres : série, rareté, « ce qui m'intéresse » (cartes que je cherche, ou que je peux donner à quelqu'un qui la cherche).
-- Pagination : 60 cartes à partir de p_offset.
create or replace function public.hg_trade_board(p_set uuid default null, p_rarity text default null, p_mine boolean default false, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); res jsonb; v_total int; v_off int := greatest(0, least(coalesce(p_offset, 0), 100000));
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  with
  part as (select p.id, p.pseudo from hg_profiles p where p.trade_board and not p.is_ghost),
  okc as (select k.* from hg_cards k where k.active and k.tradeable and k.rarity not in ('identite', 'unique')
            and (p_set is null or k.set_id = p_set) and (p_rarity is null or p_rarity = '' or k.rarity = p_rarity)),
  live as (select c.card_id, c.owner_id, count(*)::int as n,
                  count(*) filter (where c.locked_trade is null and not exists (select 1 from hg_card_showcase s where s.copy_id = c.id))::int as free
             from hg_card_copies c join okc on okc.id = c.card_id
            where c.recycled_at is null and c.owner_id in (select id from part union select me)
            group by c.card_id, c.owner_id),
  giv as (select l.card_id, l.owner_id, least(l.n - 1, l.free) as n from live l where l.n >= 2 and l.free >= 1),
  seek as (select w.card_id, w.user_id from hg_card_wishlist w join okc on okc.id = w.card_id where w.user_id in (select id from part)),
  mywish as (select w.card_id from hg_card_wishlist w where w.user_id = me),
  brd as (
    select k.id, k.name, k.rarity, k.family, k.image_url, k.number, k.max_copies, k.set_id,
      (select coalesce(jsonb_agg(jsonb_build_object('id', pt.id, 'pseudo', pt.pseudo) order by pt.pseudo), '[]'::jsonb)
         from seek s join part pt on pt.id = s.user_id where s.card_id = k.id) as seekers,
      (select coalesce(jsonb_agg(jsonb_build_object('id', pt.id, 'pseudo', pt.pseudo, 'n', g.n) order by g.n desc, pt.pseudo), '[]'::jsonb)
         from giv g join part pt on pt.id = g.owner_id where g.card_id = k.id) as givers,
      (select count(*) from seek s where s.card_id = k.id) as ns,
      (select count(*) from giv g join part pt on pt.id = g.owner_id where g.card_id = k.id) as ng
    from okc k
    where (exists (select 1 from seek s where s.card_id = k.id) or exists (select 1 from giv g join part pt on pt.id = g.owner_id where g.card_id = k.id))
      and (not coalesce(p_mine, false)
           or k.id in (select card_id from mywish)
           or (exists (select 1 from giv g where g.card_id = k.id and g.owner_id = me)
               and exists (select 1 from seek s where s.card_id = k.id and s.user_id <> me)))
  )
  select count(*)::int, coalesce((select jsonb_agg(to_jsonb(x) - 'ns' - 'ng') from (
      select * from brd order by (ns > 0 and ng > 0) desc, ns desc, name limit 60 offset v_off) x), '[]'::jsonb)
    into v_total, res from brd;
  return jsonb_build_object('rows', res, 'total', v_total, 'offset', v_off,
    'me', (select jsonb_build_object('on', p.trade_board, 'note', p.trade_board_note) from hg_profiles p where p.id = me),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'pseudo', p.pseudo, 'note', p.trade_board_note) order by p.pseudo), '[]'::jsonb)
                from hg_profiles p where p.trade_board and not p.is_ghost and p.trade_board_note is not null));
end $$;

-- =====================================================================
-- Droits
-- =====================================================================
do $$
declare f text;
begin
  -- Fonctions internes : aucun client.
  foreach f in array array[
    'hg_card_recycle_value(text, boolean)', 'hg_card_og_before()', 'hg_gift_code_norm(text)', 'hg_gift_code_hash(text)',
    'hg_gift_code_new()', 'hg_gift_code_fmt(text)', 'hg_gift_code_lot(public.hg_gift_code_batches)', 'hg_gift_code_check(text, boolean)',
    'hg_card_recipe_inputs_check(jsonb)', 'hg_auction_cap(uuid)', 'hg_card_tag_label(text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Membres (connectés) et Staff : le contrôle des droits est fait dans chaque fonction.
  foreach f in array array[
    'hg_card_tags_complete(uuid)', 'hg_card_generations()', 'hg_gift_code_peek(text)', 'hg_gift_code_redeem(text)',
    'hg_gift_codes_create(jsonb)', 'hg_gift_codes_batches()', 'hg_gift_codes_batch_active(uuid, boolean)',
    'hg_card_recipes_me()', 'hg_card_recipe_craft(uuid, bigint[], boolean)', 'hg_card_recipe_save(jsonb)', 'hg_card_recipes_admin()',
    'hg_auction_current()', 'hg_auction_bid(uuid, integer)', 'hg_auction_create(jsonb)', 'hg_auction_cancel(uuid)', 'hg_auctions_admin()',
    'hg_trade_board(uuid, text, boolean, integer)', 'hg_trade_board_set(boolean, text)', 'hg_trade_board_note_clear(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Clôture des enchères : le service (tâche planifiée) ; les membres passent par hg_auction_current.
  revoke all on function public.hg_auction_close() from public, anon, authenticated;
  grant execute on function public.hg_auction_close() to service_role;
end $$;
