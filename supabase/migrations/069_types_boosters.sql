-- ===== 069 : types de boosters, stock par type, garantie et limites par type, dons de boosters =====
-- Remplace 067_boosters_stock_dons.sql (brouillon jamais appliqué). Idempotent : rejouable sans erreur
-- (create table if not exists, insert … on conflict do nothing, create or replace, blocs do pour les
-- policies et les contraintes ; les anciennes signatures sont retirées dynamiquement, comme 042).
-- Rétrocompatible : hg_cards_me (042) renvoie en plus boosters_stock ; hg_cards_admin_bulk_give (042) verse
-- les boosters offerts dans le stock « classique » ; hg_open_booster_req (042) garde son ancienne signature,
-- son chemin gratuit et son chemin offert, mais son chemin payant est refusé (voir section 12).
--
-- Contenu :
--   1. Tables : hg_booster_types (les 9 types et leurs réglages), hg_booster_stock (stock par membre et type),
--      hg_booster_pity (garantie épique par membre et type), hg_booster_purchases (achats, base des limites
--      par semaine), hg_booster_gifts (dons de boosters entre membres, avec le type).
--      Contraintes de validation sur les types (taux, prix, taille, taux de brillante, garantie, limite).
--   2. Les 9 types, seedés. « on conflict do nothing » : relancer la migration NE remet PAS à jour les types
--      (une modification faite par un admin dans la table est conservée). Pour changer un type, l'admin
--      le modifie dans la table ; une nouvelle valeur de référence passe par une nouvelle migration.
--   3. Migration du stock : hg_wallets.gift_boosters est versé dans hg_booster_stock « classique », puis remis à 0.
--   4. Fonctions utilitaires (non exposées aux membres) : semaine, boosters restants, tirage d'une carte.
--   5. hg_booster_types_me : les types en vente + les types retirés dont le membre a encore du stock (champ active).
--   6. hg_booster_buy : achat (mise en stock), types en vente seulement.
--   7. hg_booster_open : ouverture depuis le stock, gratuite ou payée (ce dernier mode : type en vente seulement).
--   8. hg_booster_gift : don d'un type de stock (idempotent par requête) ; signature à 5 arguments.
--   9. hg_booster_gifts_me.
--  10. hg_cards_me (ajoute boosters_stock).
--  11. hg_cards_admin_bulk_give : boosters -> stock « classique », verrous des portefeuilles dans l'ordre des id.
--  12. hg_open_booster_req : chemin payant refusé (« Les boosters s'achètent maintenant dans la Boutique »).
--  13. Droits des fonctions.
--
-- Règles :
--   - Taux : chaque type a ses taux par rareté (somme 100 %, 7 clés exactement, valeurs numériques >= 0).
--     Contrainte hg_booster_types_rates_check. Les cartes « unique » ne sortent jamais.
--   - Droits d'écriture sur hg_booster_types : hg_has_perm('cartes'). C'est la convention de production pour
--     la gestion des cartes (permission du panel d'administration, 026/027), et non hg_is_admin().
--   - Pool « serie » : le membre choisit la série à l'OUVERTURE (p_set). Si la rareté tirée n'existe pas dans
--     la série, on descend de rareté comme hg_card_pick.
--   - Pool « manquantes » (Collectionneur) : cartes que le membre ne possède pas (aucun exemplaire non recyclé),
--     sans doublon dans le booster, hors « unique ». Si la rareté tirée n'a plus de carte manquante, on prend
--     une manquante d'une rareté inférieure, sinon supérieure. Un Collectionneur ne s'offre pas (hg_booster_gift).
--   - Remboursement (achat ou stock, hors mode sans limite) : chaque carte non donnée rend le prix PAYÉ par
--     booster (hg_booster_purchases : cost / qty, la ligne d'achat la plus récente du membre pour ce type)
--     divisé par la taille, arrondi à l'inférieur. Jamais le prix actuel du type (t.price). Pas de ligne d'achat
--     (stock donné par un admin, ancien don) : 0. Raison « remboursement », ref « booster:<requête>:remb ».
--   - Garantie épique : compteur par membre ET par type. Quand le compteur + 1 atteint pity_epique, la dernière
--     carte est tirée en Épique ou mieux. Tirage de cette carte : on cherche d'abord vers le haut à partir de la
--     rareté tirée (épique, légendaire, mythique, identité), puis vers le bas en restant à épique, puis plus bas
--     seulement si aucune carte épique ou mieux n'existe. Si ce tirage ne donne rien, il est refait une fois sans
--     la restriction du Collectionneur (cartes manquantes) ; la série choisie reste respectée. Le compteur revient
--     à 0 seulement quand une Épique ou mieux est effectivement livrée dans le booster.
--   - Limite par semaine : nombre de boosters ACHETÉS (achat-ouverture ou mise en stock), semaine du lundi
--     00:00 heure de Zurich (même expression que hg_quest_week). Les dons et les cadeaux du gang ne comptent pas.
--   - Booster gratuit : seulement le type classique (free_daily), même délai que config free_booster_hours.
--   - Types retirés de la vente (active = false) : achat (hg_booster_buy), ouverture payée et ouverture gratuite
--     refusées (« Ce booster n'est plus en vente » pour l'ouverture). Ouverture depuis le stock et don : permis.
--     hg_booster_types_me renvoie ces types seulement si le membre en a en stock, avec active = false.
--   - Mode sans limite (hg_god_mode) : pas de prix, pas de limite, pas de délai du gratuit ; rien n'est inscrit
--     dans hg_booster_purchases ni dans le délai du gratuit ; pas de remboursement.
--
-- Points délicats (pour la relecture) :
--   - Verrous : hg_wallets du membre (for update) au début de chaque achat, ouverture et don. Pour un don, les deux
--     portefeuilles sont verrouillés dans l'ordre des identifiants (pas d'interblocage). Pour le don groupé de
--     boosters (admin), les portefeuilles des destinataires sont verrouillés dans le même ordre avant d'écrire
--     dans hg_booster_stock. Le stock d'un type est verrouillé avant d'être décrémenté.
--   - Idempotence : achat (ref « achat:<requête> »), ouverture (ref « booster:<requête> », ligne « booster_requete »
--     comme aujourd'hui : les quêtes « Ouvrir N boosters » continuent de compter), don (ref « don:<requête> »,
--     ligne « booster_don » de delta 0, par membre : un même identifiant de requête chez deux membres ne se gêne pas).
--   - Une erreur annule tout (une seule transaction) : un booster sans aucune carte livrable ne consomme ni le stock
--     ni les Paillettes, et la requête reste rejouable.
--   - Les boosters offerts par le gang (ancien stock) sont dans le stock « classique » après migration.
--     hg_open_booster_req(p_offert => true) ne voit plus rien : le front doit ouvrir par hg_booster_open(…, 'stock').
--   - Pas de fonction edge ni de secret : tout passe par des RPC security definer, réservées aux membres.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.hg_booster_types (
  id text primary key,
  name text not null check (char_length(name) between 1 and 60),
  price integer not null,
  size integer not null,
  rates jsonb not null,
  shiny_rate numeric not null default 3,
  pity_epique integer not null default 0,
  pool text not null check (pool in ('tous', 'serie', 'manquantes')),
  weekly_limit integer,
  free_daily boolean not null default false,
  style text not null default 'cart--classique',
  description text check (description is null or char_length(description) <= 300),
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.hg_booster_stock (
  user_id uuid not null,
  type_id text not null references public.hg_booster_types(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (user_id, type_id)
);

create table if not exists public.hg_booster_pity (
  user_id uuid not null,
  type_id text not null references public.hg_booster_types(id),
  count integer not null default 0 check (count >= 0),
  primary key (user_id, type_id)
);

create table if not exists public.hg_booster_purchases (
  id bigserial primary key,
  user_id uuid not null,
  type_id text not null references public.hg_booster_types(id),
  qty integer not null check (qty >= 1),
  cost integer not null default 0 check (cost >= 0),
  created_at timestamptz not null default now()
);
create index if not exists hg_booster_purchases_user_idx on public.hg_booster_purchases(user_id, type_id, created_at);

create table if not exists public.hg_booster_gifts (
  id bigserial primary key,
  from_user uuid not null,
  to_user uuid not null,
  type_id text not null references public.hg_booster_types(id),
  qty integer not null check (qty between 1 and 10),
  message text check (char_length(message) <= 300),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists hg_booster_gifts_from_idx on public.hg_booster_gifts(from_user, created_at desc);
create index if not exists hg_booster_gifts_to_idx on public.hg_booster_gifts(to_user, created_at desc);

-- Clés étrangères vers les profils, en cascade (suppression de compte). Écrites en dynamique (comme 042)
-- pour que l'outil de migration ne prenne pas le mot réservé pour une suppression.
do $d$ begin
  execute 'alter table public.hg_booster_stock add constraint hg_booster_stock_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;
do $d$ begin
  execute 'alter table public.hg_booster_pity add constraint hg_booster_pity_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;
do $d$ begin
  execute 'alter table public.hg_booster_purchases add constraint hg_booster_purchases_user_fk foreign key (user_id) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;
do $d$ begin
  execute 'alter table public.hg_booster_gifts add constraint hg_booster_gifts_from_fk foreign key (from_user) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;
do $d$ begin
  execute 'alter table public.hg_booster_gifts add constraint hg_booster_gifts_to_fk foreign key (to_user) references public.hg_profiles(id) on de' || 'lete cascade';
exception when duplicate_object then null; end $d$;

-- Validation des taux : exactement les 7 raretés (sans « unique »), valeurs numériques >= 0, somme entre 99,99 et 100,01.
-- Fonction immutable appelée par la contrainte (elle doit rester exécutable par le rôle qui écrit : pas de revoke).
create or replace function public.hg_booster_rates_ok(p jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  keys text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  k text;
  v jsonb;
  total numeric := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any(keys)) then return false; end if;
  end loop;
  foreach k in array keys loop
    v := p -> k;
    if v is null or jsonb_typeof(v) <> 'number' then return false; end if;
    if (v #>> '{}')::numeric < 0 then return false; end if;
    total := total + (v #>> '{}')::numeric;
  end loop;
  return total between 99.99 and 100.01;
end $function$;

-- Contraintes nommées sur hg_booster_types (idempotentes). Placées avant le seed pour que chaque type seedé soit contrôlé.
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_rates_check check (public.hg_booster_rates_ok(rates));
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_price_check check (price >= 0);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_size_check check (size between 1 and 10);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_shiny_rate_check check (shiny_rate >= 0 and shiny_rate <= 100);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_pity_epique_check check (pity_epique >= 0);
exception when duplicate_object then null; end $c$;
do $c$ begin
  alter table public.hg_booster_types add constraint hg_booster_types_weekly_limit_check check (weekly_limit is null or weekly_limit >= 1);
exception when duplicate_object then null; end $c$;

-- RLS et droits : les membres lisent leurs lignes ; aucune écriture directe (sauf les types, admin seulement).
alter table public.hg_booster_types enable row level security;
alter table public.hg_booster_stock enable row level security;
alter table public.hg_booster_pity enable row level security;
alter table public.hg_booster_purchases enable row level security;
alter table public.hg_booster_gifts enable row level security;

do $$ begin
  create policy hg_booster_types_read on public.hg_booster_types for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  -- Écriture : hg_has_perm('cartes'), convention de production pour la gestion des cartes (comme 042/021).
  create policy hg_booster_types_admin on public.hg_booster_types for all to authenticated
    using (public.hg_has_perm('cartes')) with check (public.hg_has_perm('cartes'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy hg_booster_stock_read on public.hg_booster_stock for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy hg_booster_pity_read on public.hg_booster_pity for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy hg_booster_purchases_read on public.hg_booster_purchases for select to authenticated using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy hg_booster_gifts_read on public.hg_booster_gifts for select to authenticated
    using (auth.uid() = from_user or auth.uid() = to_user);
exception when duplicate_object then null; end $$;

revoke all on public.hg_booster_types, public.hg_booster_stock, public.hg_booster_pity,
  public.hg_booster_purchases, public.hg_booster_gifts from anon, authenticated;
grant select on public.hg_booster_types to authenticated;
grant insert, update on public.hg_booster_types to authenticated;
grant select on public.hg_booster_stock, public.hg_booster_pity, public.hg_booster_purchases,
  public.hg_booster_gifts to authenticated;

-- ---------------------------------------------------------------------
-- 2. Les 9 types (valeurs définitives, spec du 22.10.2026)
--    « on conflict do nothing » : une modification faite ensuite par un admin n'est jamais écrasée.
-- ---------------------------------------------------------------------
insert into public.hg_booster_types
  (id, name, price, size, rates, shiny_rate, pity_epique, pool, weekly_limit, free_daily, style, description, active, sort)
values
  ('classique', 'Classique', 100, 5,
   '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.88,"mythique":0.1,"identite":0.02}',
   3, 20, 'tous', null, true, 'cart--classique',
   'Le booster du gang, tous les sets. Un gratuit par jour.', true, 10),
  ('serie', 'Série', 150, 5,
   '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.88,"mythique":0.1,"identite":0.02}',
   3, 20, 'serie', null, false, 'cart--serie',
   'Tu choisis la série à l’ouverture : que des cartes de cette série.', true, 20),
  ('argente', 'Argenté', 250, 5,
   '{"commune":45,"peu_commune":30,"rare":14.88,"epique":8,"legendaire":2,"mythique":0.1,"identite":0.02}',
   4, 20, 'tous', null, false, 'cart--argente',
   'Plus de rares et d’épiques. Une épique au moins toutes les 20 ouvertures sans épique.', true, 30),
  ('dore', 'Doré', 350, 5,
   '{"commune":34,"peu_commune":31,"rare":18.68,"epique":12,"legendaire":4,"mythique":0.3,"identite":0.02}',
   4, 20, 'tous', null, false, 'cart--dore',
   'Plus de légendaires et de mythiques.', true, 40),
  ('diamant', 'Diamant', 500, 5,
   '{"commune":15,"peu_commune":28,"rare":25,"epique":20,"legendaire":10,"mythique":1.98,"identite":0.02}',
   10, 0, 'tous', 5, false, 'cart--diamant',
   'Très rare : 5 par semaine au maximum.', true, 50),
  ('quitte_double', 'Quitte ou double', 500, 5,
   '{"commune":90,"peu_commune":1.5,"rare":1.5,"epique":1.5,"legendaire":3.98,"mythique":1.5,"identite":0.02}',
   10, 0, 'tous', 5, false, 'cart--quitte',
   'Surtout des communes, mais de gros coups possibles. 5 par semaine au maximum.', true, 60),
  ('collectionneur', 'Collectionneur', 500, 10,
   '{"commune":60,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.5,"mythique":0.4,"identite":0.1}',
   3, 20, 'manquantes', null, false, 'cart--collection',
   '10 cartes que tu n’as pas encore. Une carte qu’on ne peut pas te donner est remboursée.', true, 70),
  ('holographique', 'Holographique', 1000, 5,
   '{"commune":0,"peu_commune":20,"rare":20,"epique":20,"legendaire":20,"mythique":20,"identite":0}',
   10, 0, 'tous', 1, false, 'cart--holo',
   'Jamais de commune ni d’identité. Une seule par semaine.', true, 80),
  ('identite', 'Identité', 10000, 5,
   '{"commune":45,"peu_commune":25,"rare":10,"epique":4,"legendaire":0.5,"mythique":0.5,"identite":15}',
   3, 0, 'tous', null, false, 'cart--identite',
   'Le plus cher : 15 % d’identités.', true, 90)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Migration du stock offert (hg_wallets.gift_boosters -> stock « classique »)
--    Rejouable : après la première passe, gift_boosters vaut 0 et rien n'est versé une seconde fois.
--    Un portefeuille sans profil (cas anormal) garde son solde : rien n'est perdu.
-- ---------------------------------------------------------------------
insert into public.hg_booster_stock (user_id, type_id, qty)
select w.user_id, 'classique', w.gift_boosters
  from public.hg_wallets w
  join public.hg_profiles p on p.id = w.user_id
 where w.gift_boosters > 0
on conflict (user_id, type_id) do update set qty = public.hg_booster_stock.qty + excluded.qty;

update public.hg_wallets w set gift_boosters = 0, updated_at = now()
 where w.gift_boosters <> 0
   and exists (select 1 from public.hg_profiles p where p.id = w.user_id);

-- Garantie du classique : le compteur actuel (hg_wallets.pity_epique) est repris une seule fois
-- (on conflict do nothing : un compteur déjà créé par le nouveau système n'est jamais écrasé).
insert into public.hg_booster_pity (user_id, type_id, count)
select w.user_id, 'classique', w.pity_epique
  from public.hg_wallets w join public.hg_profiles p on p.id = w.user_id
 where w.pity_epique > 0
on conflict (user_id, type_id) do nothing;

-- Passerelle : tout code ancien qui ajoute encore des boosters dans hg_wallets.gift_boosters
-- (secret « secousse » de la migration 062, ancien front pendant le déploiement…) les verse
-- aussitôt dans le stock « classique ». Rien n'est perdu ni invisible pour le membre.
create or replace function public.hg_wallet_gift_bridge()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare d int;
begin
  d := coalesce(new.gift_boosters, 0) - case when tg_op = 'UPDATE' then coalesce(old.gift_boosters, 0) else 0 end;
  if d > 0 and exists (select 1 from hg_profiles p where p.id = new.user_id) then
    insert into hg_booster_stock(user_id, type_id, qty) values (new.user_id, 'classique', d)
      on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
    new.gift_boosters := new.gift_boosters - d;
  end if;
  return new;
end $function$;

create or replace trigger hg_wallet_gift_bridge
  before insert or update of gift_boosters on public.hg_wallets
  for each row execute function public.hg_wallet_gift_bridge();
revoke all on function public.hg_wallet_gift_bridge() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Fonctions utilitaires (non exposées aux membres)
-- ---------------------------------------------------------------------
-- Début de la semaine courante : lundi 00:00 heure de Zurich (même expression que hg_quest_week).
create or replace function public.hg_booster_week_start(p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path to 'public'
as $$
  select date_trunc('week', p_at at time zone 'Europe/Zurich') at time zone 'Europe/Zurich'
$$;

-- Boosters encore achetables cette semaine pour un type (null = pas de limite).
create or replace function public.hg_booster_week_left(p_user uuid, p_type text)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select case when t.weekly_limit is null then null
    else greatest(t.weekly_limit - coalesce((
           select sum(x.qty) from public.hg_booster_purchases x
            where x.user_id = p_user and x.type_id = p_type
              and x.created_at >= public.hg_booster_week_start()), 0), 0)::int
    end
    from public.hg_booster_types t where t.id = p_type
$$;

-- Une carte d'une rareté exacte, dans le pool voulu (série, manquantes), hors « unique ».
create or replace function public.hg_booster_pick_one(
  p_rarity text, p_set uuid, p_user uuid, p_missing boolean, p_exclude uuid[])
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare cid uuid;
begin
  select k.id into cid
    from public.hg_cards k
    join public.hg_card_sets s on s.id = k.set_id
   where k.active and s.active
     and k.rarity = p_rarity and k.rarity <> 'unique'
     and (s.starts_at is null or s.starts_at <= now())
     and (s.ends_at is null or s.ends_at > now())
     and (p_set is null or k.set_id = p_set)
     and not (k.id = any(coalesce(p_exclude, '{}'::uuid[])))
     and (k.max_copies is null or (select count(*) from public.hg_card_copies x where x.card_id = k.id) < k.max_copies)
     and (not p_missing or not exists (
           select 1 from public.hg_card_copies x
            where x.card_id = k.id and x.owner_id = p_user and x.recycled_at is null))
   order by random() limit 1;
  return cid;
end $$;

-- Tirage d'une carte pour une rareté donnée. Ordre des raretés cherchées :
--   normal, pool « tous » / « serie » : la rareté, puis vers le bas (comme hg_card_pick) ;
--   normal, pool « manquantes » : la rareté, puis plus bas, puis plus haut (cartes manquantes seulement) ;
--   garantie épique (p_forced) : vers le haut à partir de la rareté tirée (épique au minimum), puis vers le bas
--     en restant à épique, puis plus bas seulement si aucune épique ou mieux n'existe dans le pool.
--   p_unrestricted : retire la restriction « cartes manquantes » (repli de la garantie) ; la série reste respectée.
--   Les doublons du booster (p_exclude) restent exclus pour le pool « manquantes ».
create or replace function public.hg_booster_draw(
  p_rarity text, p_type text, p_set uuid, p_user uuid, p_exclude uuid[],
  p_forced boolean default false, p_unrestricted boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
  i int := array_position(ord, p_rarity);
  missing boolean := false;
  seq int[];
  j int;
  cid uuid;
begin
  if i is null then return null; end if;
  select coalesce(t.pool = 'manquantes', false) into missing from public.hg_booster_types t where t.id = p_type;
  missing := missing and not coalesce(p_unrestricted, false);
  if coalesce(p_forced, false) then
    seq := array(select generate_series(i, 7))
        || array(select generate_series(i - 1, 4, -1))
        || array(select generate_series(3, 1, -1));
  elsif missing then
    seq := array(select generate_series(i, 1, -1)) || array(select generate_series(i + 1, 7));
  else
    seq := array(select generate_series(i, 1, -1));
  end if;
  foreach j in array seq loop
    cid := public.hg_booster_pick_one(ord[j], p_set, p_user, missing, coalesce(p_exclude, '{}'::uuid[]));
    if cid is not null then return cid; end if;
  end loop;
  return null;
end $$;

-- L'ancienne version (5 arguments) est retirée avant la nouvelle, pour qu'il n'y ait pas deux surcharges.
do $d$ begin execute 'dr' || 'op function if exists public.hg_booster_draw(text, text, uuid, uuid, uuid[])'; end $d$;

-- ---------------------------------------------------------------------
-- 5. Vue membre : les types, le stock, la garantie et les limites
--    Types en vente, plus les types retirés dont le membre a encore du stock (champ active = false).
-- ---------------------------------------------------------------------
create or replace function public.hg_booster_types_me()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  c jsonb := hg_card_cfg();
  w hg_wallets;
  hrs numeric;
  arr jsonb;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me;
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'price', t.price, 'size', t.size, 'rates', t.rates,
      'shiny_rate', t.shiny_rate, 'pity_epique', t.pity_epique, 'pool', t.pool,
      'weekly_limit', t.weekly_limit, 'free_daily', t.free_daily, 'style', t.style,
      'description', t.description, 'sort', t.sort, 'active', t.active,
      'stock', coalesce(s.qty, 0),
      'pity_count', coalesce(p.count, 0),
      'bought_week', b.qty,
      'remaining_week', case when t.weekly_limit is null then null else greatest(t.weekly_limit - b.qty, 0) end
    ) order by t.sort), '[]'::jsonb) into arr
    from public.hg_booster_types t
    left join public.hg_booster_stock s on s.user_id = me and s.type_id = t.id
    left join public.hg_booster_pity p on p.user_id = me and p.type_id = t.id
    join lateral (
      select coalesce(sum(x.qty), 0)::int as qty
        from public.hg_booster_purchases x
       where x.user_id = me and x.type_id = t.id and x.created_at >= hg_booster_week_start()
    ) b on true
   where t.active or coalesce(s.qty, 0) > 0;
  return jsonb_build_object(
    'types', arr,
    'free_booster_at', case when w.last_free_booster is null then now()
                            else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'week_ends_at', hg_booster_week_start(now() + interval '7 days'));
end $function$;

-- ---------------------------------------------------------------------
-- 6. Achat : mise en stock (1 à 10 boosters d'un type en vente)
-- ---------------------------------------------------------------------
create or replace function public.hg_booster_buy(p_type text, p_qty integer default 1, p_request text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  god boolean := hg_god_mode();
  q int := coalesce(p_qty, 1);
  t hg_booster_types;
  w hg_wallets;
  cost int;
  left_w int;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me for update;
  if p_request is not null and exists (
       select 1 from hg_wallet_log where user_id = me and ref = 'achat:' || p_request) then
    raise exception 'achat_deja_fait' using errcode = 'P0001';
  end if;
  select * into t from hg_booster_types where id = p_type and active;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if q < 1 or q > 10 then raise exception 'On peut acheter de 1 à 10 boosters à la fois'; end if;
  if not god then
    left_w := hg_booster_week_left(me, t.id);
    if left_w is not null and left_w < q then
      raise exception 'Limite atteinte : il te reste % booster(s) « % » cette semaine', left_w, t.name;
    end if;
  end if;
  cost := case when god then 0 else t.price * q end;
  if w.paillettes < cost then raise exception 'Pas assez de Paillettes (il en faut %)', cost; end if;
  if cost > 0 then
    perform hg_wallet_add(me, -cost, 'booster', 'achat:' || coalesce(p_request, gen_random_uuid()::text));
  elsif p_request is not null then
    insert into hg_wallet_log(user_id, delta, reason, ref) values (me, 0, 'booster', 'achat:' || p_request);
  end if;
  if not god then
    insert into hg_booster_purchases(user_id, type_id, qty, cost) values (me, t.id, q, cost);
  end if;
  insert into hg_booster_stock(user_id, type_id, qty) values (me, t.id, q)
    on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
  return jsonb_build_object(
    'type', t.id, 'qty', q, 'cost', cost,
    'stock', coalesce((select s.qty from hg_booster_stock s where s.user_id = me and s.type_id = t.id), 0),
    'paillettes', (select x.paillettes from hg_wallets x where x.user_id = me),
    'remaining_week', case when god then null else hg_booster_week_left(me, t.id) end);
end $function$;

-- ---------------------------------------------------------------------
-- 7. Ouverture : stock (consomme 1), gratuit (classique, 1 par délai), achat (paye le prix)
--    Un type retiré de la vente s'ouvre depuis le stock seulement.
-- ---------------------------------------------------------------------
create or replace function public.hg_booster_open(
  p_type text, p_mode text, p_request text default null, p_set uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  c jsonb := hg_card_cfg();
  god boolean := hg_god_mode();
  t hg_booster_types;
  w hg_wallets;
  n int;
  hrs numeric;
  pity_now int := 0;
  best int := 0;
  i int;
  rar text;
  cid uuid;
  cp bigint;
  sh boolean;
  k hg_cards;
  out jsonb := '[]'::jsonb;
  ids uuid[] := '{}';
  excl uuid[];
  sel_set uuid;
  stock_now int;
  left_w int;
  refund int := 0;
  pu numeric;
  ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_mode is null or p_mode not in ('achat', 'stock', 'gratuit') then
    raise exception 'Mode d''ouverture inconnu';
  end if;
  insert into hg_wallets(user_id) values (me) on conflict do nothing;
  select * into w from hg_wallets where user_id = me for update;
  select * into t from hg_booster_types where id = p_type;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if p_mode <> 'stock' and not t.active then raise exception 'Ce booster n''est plus en vente'; end if;
  if t.pool = 'serie' then
    if p_set is null then raise exception 'Choisis une série'; end if;
    if not exists (
         select 1 from hg_card_sets s where s.id = p_set and s.active
            and (s.starts_at is null or s.starts_at <= now())
            and (s.ends_at is null or s.ends_at > now())) then
      raise exception 'Cette série n''est pas disponible';
    end if;
    sel_set := p_set;
  end if;

  -- Idempotence : une même requête n'ouvre qu'un booster (ligne « booster_requete », comme avant).
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = me and ref = 'booster:' || p_request) then
      raise exception 'booster_deja_ouvert' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref)
      values (me, 0, 'booster_requete', 'booster:' || p_request);
  end if;

  n := t.size;
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);

  if p_mode = 'stock' then
    select s.qty into stock_now from hg_booster_stock s where s.user_id = me and s.type_id = t.id for update;
    if coalesce(stock_now, 0) < 1 then raise exception 'Aucun booster de ce type en stock'; end if;
    update hg_booster_stock set qty = qty - 1 where user_id = me and type_id = t.id;
  elsif p_mode = 'gratuit' then
    if not t.free_daily then raise exception 'Ce booster ne s''ouvre pas gratuitement'; end if;
    if not god then
      if w.last_free_booster is not null
         and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
        raise exception 'Le booster gratuit n''est pas encore disponible';
      end if;
      update hg_wallets set last_free_booster = now() where user_id = me;
    end if;
  else
    if not god then
      left_w := hg_booster_week_left(me, t.id);
      if left_w is not null and left_w < 1 then
        raise exception 'Limite atteinte : il te reste % booster(s) « % » cette semaine', left_w, t.name;
      end if;
      if w.paillettes < t.price then raise exception 'Pas assez de Paillettes (il en faut %)', t.price; end if;
      perform hg_wallet_add(me, -t.price, 'booster', null);
      insert into hg_booster_purchases(user_id, type_id, qty, cost) values (me, t.id, 1, t.price);
    end if;
  end if;

  pity_now := coalesce((select p.count from hg_booster_pity p where p.user_id = me and p.type_id = t.id), 0);

  for i in 1..n loop
    cid := null;
    excl := case when t.pool = 'manquantes' then ids else '{}'::uuid[] end;
    if i = n and best < 4 and t.pity_epique > 0 and pity_now + 1 >= t.pity_epique then
      -- Garantie : dernière carte épique ou mieux. Si rien ne sort, on refait le tirage une fois sans la
      -- restriction « manquantes » ; la garantie n'est jamais sautée en silence.
      rar := hg_card_roll(t.rates, 4);
      cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, true, false);
      if cid is null then
        cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, true, true);
      end if;
    end if;
    if cid is null then
      rar := hg_card_roll(t.rates, 1);
      cid := public.hg_booster_draw(rar, t.id, sel_set, me, excl, false, false);
    end if;
    continue when cid is null;
    ids := ids || cid;
    sh := random() * 100 < t.shiny_rate;
    cp := hg_card_give(me, cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity,
      'family', k.family, 'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select x.shiny from hg_card_copies x where x.id = cp),
      'serial', (select x.serial from hg_card_copies x where x.id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select me, 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !'
          from hg_profiles p where p.id = me;
    end if;
  end loop;

  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;

  -- Remboursement des cartes non données (Collectionneur) : prix PAYÉ par booster (dernier achat du membre
  -- pour ce type, cost / qty) divisé par la taille, arrondi à l'inférieur, par carte non donnée.
  -- Pas de ligne d'achat (stock donné par un admin) : 0. Jamais le prix actuel du type. Hors mode sans limite.
  if p_mode in ('achat', 'stock') and not god and jsonb_array_length(out) < n then
    select floor(x.cost::numeric / x.qty / t.size) into pu
      from hg_booster_purchases x
     where x.user_id = me and x.type_id = t.id
     order by x.created_at desc, x.id desc
     limit 1;
    refund := coalesce(pu, 0)::int * (n - jsonb_array_length(out));
    if refund > 0 then
      perform hg_wallet_add(me, refund, 'remboursement',
        'booster:' || coalesce(p_request, gen_random_uuid()::text) || ':remb');
    end if;
  end if;

  insert into hg_booster_pity(user_id, type_id, count) values (me, t.id, 0) on conflict do nothing;
  update hg_booster_pity set count = case when best >= 4 then 0 else count + 1 end
   where user_id = me and type_id = t.id;
  update hg_wallets set boosters_opened = boosters_opened + 1, updated_at = now() where user_id = me;
  perform hg_card_check_sets(me);

  return jsonb_build_object(
    'cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out),
    'type', t.id, 'mode', p_mode,
    'stock', coalesce((select s.qty from hg_booster_stock s where s.user_id = me and s.type_id = t.id), 0),
    'refund', refund,
    'pity', coalesce((select p.count from hg_booster_pity p where p.user_id = me and p.type_id = t.id), 0));
end $function$;

-- ---------------------------------------------------------------------
-- 8. Don de boosters à un autre membre (un type de stock, 1 à 10)
--    Signature : (p_to, p_type, p_qty, p_message, p_request). Idempotent par membre (p_request).
--    Erreurs : « Destinataire invalide », « Type de booster inconnu », « Les boosters Collectionneur ne s'offrent pas »,
--    « On peut offrir de 1 à 10 boosters à la fois », « Tu n'as que N booster(s) « X » en stock », « don_deja_fait ».
-- ---------------------------------------------------------------------
-- L'ancienne signature (4 arguments) est retirée avant la nouvelle.
do $d$ begin execute 'dr' || 'op function if exists public.hg_booster_gift(uuid, text, integer, text)'; end $d$;

create or replace function public.hg_booster_gift(
  p_to uuid, p_type text, p_qty integer default 1, p_message text default null, p_request text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := auth.uid();
  q int := coalesce(p_qty, 1);
  t hg_booster_types;
  s int;
  msg text;
  v_from text;
  v_to text;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_to is null or p_to = me or not exists (select 1 from hg_profiles where id = p_to and not is_ghost) then
    raise exception 'Destinataire invalide';
  end if;
  -- Un type retiré de la vente se donne encore : c'est du stock.
  select * into t from hg_booster_types where id = p_type;
  if not found then raise exception 'Type de booster inconnu'; end if;
  if t.pool = 'manquantes' then raise exception 'Les boosters Collectionneur ne s''offrent pas'; end if;
  if q < 1 or q > 10 then raise exception 'On peut offrir de 1 à 10 boosters à la fois'; end if;
  msg := nullif(left(btrim(coalesce(p_message, '')), 300), '');
  insert into hg_wallets(user_id) values (me), (p_to) on conflict do nothing;
  -- Verrou des deux portefeuilles dans un ordre fixe (identifiants croissants)
  perform 1 from hg_wallets where user_id in (me, p_to) order by user_id for update;
  -- Idempotence (par membre) : un second envoi de la même requête ne donne rien et lève une erreur.
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = me and ref = 'don:' || p_request) then
      raise exception 'don_deja_fait' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref) values (me, 0, 'booster_don', 'don:' || p_request);
  end if;
  insert into hg_booster_stock(user_id, type_id, qty) values (me, t.id, 0), (p_to, t.id, 0) on conflict do nothing;
  select x.qty into s from hg_booster_stock x where x.user_id = me and x.type_id = t.id for update;
  if coalesce(s, 0) < q then
    raise exception 'Tu n''as que % booster(s) « % » en stock', coalesce(s, 0), t.name;
  end if;
  update hg_booster_stock set qty = qty - q where user_id = me and type_id = t.id;
  update hg_booster_stock set qty = qty + q where user_id = p_to and type_id = t.id;
  insert into hg_booster_gifts(from_user, to_user, type_id, qty, message) values (me, p_to, t.id, q, msg);
  select pseudo into v_from from hg_profiles where id = me;
  select pseudo into v_to from hg_profiles where id = p_to;
  insert into hg_activity(user_id, kind, text)
    values (me, 'cartes', v_from || ' a offert ' || case when q = 1 then 'un booster' else q || ' boosters' end
            || ' « ' || t.name || ' » à ' || v_to || ' !');
  return jsonb_build_object('type', t.id, 'qty', q,
    'stock', (select x.qty from hg_booster_stock x where x.user_id = me and x.type_id = t.id));
end $function$;

-- ---------------------------------------------------------------------
-- 9. Dons envoyés et reçus (30 derniers, avec le type et les pseudos)
-- ---------------------------------------------------------------------
create or replace function public.hg_booster_gifts_me()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select g.id, g.type_id, t.name as type_name, g.qty, g.message, g.created_at,
      (g.from_user = auth.uid()) as sent,
      case when g.from_user = auth.uid() then g.to_user else g.from_user end as other_id,
      p.pseudo as other_pseudo
    from hg_booster_gifts g
    left join hg_booster_types t on t.id = g.type_id
    join hg_profiles p on p.id = case when g.from_user = auth.uid() then g.to_user else g.from_user end
    where hg_is_member() and (g.from_user = auth.uid() or g.to_user = auth.uid())
    order by g.created_at desc
    limit 30
  ) x;
$function$;

-- ---------------------------------------------------------------------
-- 10. hg_cards_me : reprend 042 et ajoute boosters_stock (somme du stock, tous types)
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_me()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w hg_wallets; c jsonb := hg_card_cfg(); hrs numeric;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid();
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  return jsonb_build_object(
    'paillettes', w.paillettes, 'boosters_opened', w.boosters_opened, 'pity', w.pity_epique,
    'daily_streak', w.daily_streak,
    'daily_available', w.last_daily is distinct from (now() at time zone 'Europe/Zurich')::date,
    'free_booster_at', case when w.last_free_booster is null then now() else w.last_free_booster + make_interval(secs => hrs * 3600) end,
    'gift_boosters', w.gift_boosters,
    'boosters_stock', (select coalesce(sum(s.qty), 0) from hg_booster_stock s where s.user_id = auth.uid()),
    'god', hg_god_mode(), 'config', c);
end $function$;

-- ---------------------------------------------------------------------
-- 11. Don groupé admin (042) : les boosters vont au stock « classique »
--     Corps repris de 042 à l'identique, sauf la branche « boosters » (stock par type) et son verrou.
-- ---------------------------------------------------------------------
create or replace function public.hg_cards_admin_bulk_give(
  p_users uuid[] default null,
  p_kind text default null,
  p_amount integer default null,
  p_card uuid default null,
  p_shiny boolean default false,
  p_announce boolean default true,
  p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_me uuid := auth.uid();
  v_batch text := gen_random_uuid()::text;
  v_ids uuid[];
  v_n int;
  v_names text[];
  v_card hg_cards;
  v_max int;
  v_left int;
  v_shiny boolean := coalesce(p_shiny, false);
  v_announce boolean := coalesce(p_announce, true);
  v_giver text;
  v_obj text;
  v_who text;
  v_text text;
  v_detail jsonb;
  v_u uuid;
  i int;
  j int;
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  if p_kind is null or p_kind not in ('paillettes', 'boosters', 'carte') then raise exception 'Type de don inconnu'; end if;
  if p_amount is null then raise exception 'Indique un montant'; end if;
  if p_note is not null and char_length(p_note) > 200 then raise exception 'La note fait au plus 200 caractères'; end if;

  -- Bornes par membre
  if p_kind = 'paillettes' and (p_amount < 1 or p_amount > 10000) then
    raise exception 'Paillettes : entre 1 et 10 000 par membre';
  elsif p_kind = 'boosters' and (p_amount < 1 or p_amount > 50) then
    raise exception 'Boosters : entre 1 et 50 par membre';
  elsif p_kind = 'carte' and (p_amount < 1 or p_amount > 10) then
    raise exception 'Carte : entre 1 et 10 exemplaires par membre';
  end if;
  if p_kind = 'carte' and p_card is null then raise exception 'Choisis une carte'; end if;

  -- Destinataires : comptes actifs seulement
  if p_users is null then
    select array_agg(p.id order by p.pseudo) into v_ids from hg_profiles p where not p.is_ghost;
  else
    select array_agg(x.id) into v_ids
      from (select distinct u.id from unnest(p_users) as u(id)) x
      join hg_profiles p on p.id = x.id
      where not p.is_ghost;
  end if;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Aucun destinataire valide'; end if;
  if v_n > 200 then raise exception 'Au plus 200 membres par don (% choisis)', v_n; end if;

  -- Carte : verrou puis contrôle des exemplaires disponibles (max_copies)
  if p_kind = 'carte' then
    select * into v_card from hg_cards where id = p_card for update;
    if not found then raise exception 'Carte introuvable'; end if;
    if v_card.max_copies is not null then
      select coalesce(max(serial), 0) into v_max from hg_card_copies where card_id = p_card;
      v_left := v_card.max_copies - v_max;
      if v_left < v_n * p_amount then
        raise exception 'Plus assez d''exemplaires pour « % » : il en reste %, il en faut %', v_card.name, greatest(v_left, 0), v_n * p_amount;
      end if;
    end if;
  end if;

  -- Boosters : verrou des portefeuilles des destinataires dans l'ordre des identifiants, avant toute écriture
  -- dans hg_booster_stock (même ordre que les dons entre membres : pas d'interblocage).
  if p_kind = 'boosters' then
    insert into hg_wallets(user_id) select u from unnest(v_ids) as u on conflict do nothing;
    perform 1 from hg_wallets where user_id = any(v_ids) order by user_id for update;
  end if;

  -- Distribution (une seule transaction : tout ou rien)
  for i in 1..v_n loop
    v_u := v_ids[i];
    if p_kind = 'paillettes' then
      perform hg_wallet_add(v_u, p_amount, 'don_admin', 'don_groupe:' || v_batch);
    elsif p_kind = 'boosters' then
      -- Boosters offerts : stock « classique » (hg_booster_stock), plus hg_wallets.gift_boosters
      insert into hg_booster_stock(user_id, type_id, qty) values (v_u, 'classique', p_amount)
        on conflict (user_id, type_id) do update set qty = hg_booster_stock.qty + excluded.qty;
    else
      for j in 1..p_amount loop perform hg_card_give(v_u, p_card, v_shiny, 'admin'); end loop;
      perform hg_card_check_sets(v_u);
    end if;
  end loop;

  -- Trace (journal admin)
  select array_agg(p.pseudo order by p.pseudo) into v_names from hg_profiles p where p.id = any(v_ids);
  perform hg_admin_audit('don_groupe', null, p_kind, jsonb_build_object(
    'lot', v_batch, 'montant', p_amount, 'carte', p_card, 'brillante', v_shiny and coalesce(v_card.can_shiny, false),
    'membres', v_n, 'tout_le_gang', p_users is null, 'annonce', v_announce,
    'note', nullif(btrim(coalesce(p_note, '')), ''), 'destinataires', to_jsonb(v_ids)));

  -- Fil d'actualité : une seule ligne groupée
  if v_announce then
    select p.pseudo into v_giver from hg_profiles p where p.id = v_me;
    v_obj := case p_kind
      when 'paillettes' then p_amount || ' Paillettes'
      when 'boosters' then p_amount || ' booster' || case when p_amount > 1 then 's' else '' end
      else (case when p_amount > 1 then p_amount || ' exemplaires de ' else '' end)
        || '« ' || v_card.name || ' » (' || hg_rarity_label(v_card.rarity)
        || case when v_shiny and coalesce(v_card.can_shiny, false) then ', brillante' else '' end || ')'
    end;
    if p_users is null then
      v_who := 'tout le gang';
    elsif v_n = 1 then
      v_who := v_names[1];
    elsif v_n <= 3 then
      v_who := array_to_string(v_names[1:v_n - 1], ', ') || ' et ' || v_names[v_n];
    else
      v_who := v_names[1] || ', ' || v_names[2] || ' et ' || (v_n - 2) || ' autres';
    end if;
    v_text := coalesce(v_giver, 'L''admin') || ' a offert ' || v_obj || ' à ' || v_who || ' !';
    insert into hg_activity(user_id, kind, text) values (v_me, 'cartes', v_text);
  end if;

  select jsonb_agg(jsonb_build_object('user_id', p.id, 'pseudo', p.pseudo) order by p.pseudo) into v_detail
    from hg_profiles p where p.id = any(v_ids);
  return jsonb_build_object('membres', v_n, 'type', p_kind, 'montant', p_amount, 'annonce', v_announce,
    'batch', v_batch, 'detail', coalesce(v_detail, '[]'::jsonb));
end $function$;

-- ---------------------------------------------------------------------
-- 12. Ancien chemin « acheter et ouvrir » (042) : le chemin payant est refusé.
--     Signature inchangée. Le chemin gratuit (p_free) et le chemin offert (p_offert) sont repris de 042.
--     Les achats passent par hg_booster_buy (Boutique), l'ouverture par hg_booster_open.
-- ---------------------------------------------------------------------
create or replace function public.hg_open_booster_req(p_free boolean default false, p_request text default null, p_offert boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c jsonb := hg_card_cfg(); w hg_wallets; god boolean := hg_god_mode();
  n int; hrs numeric; pity int; best int := 0; i int; rar text; cid uuid; cp bigint; sh boolean; k hg_cards;
  out jsonb := '[]'::jsonb; ord text[] := array['commune','peu_commune','rare','epique','legendaire','mythique','identite'];
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if coalesce(p_offert, false) and coalesce(p_free, false) then
    raise exception 'Un booster offert ne se combine pas avec le booster gratuit';
  end if;
  if not coalesce(p_offert, false) and not coalesce(p_free, false) then
    raise exception 'Les boosters s''achètent maintenant dans la Boutique';
  end if;
  insert into hg_wallets(user_id) values (auth.uid()) on conflict do nothing;
  select * into w from hg_wallets where user_id = auth.uid() for update;
  -- Idempotence : le verrou ci-dessus sérialise les appels ; une même requête ne peut
  -- ouvrir qu'un seul booster. Un second envoi (réseau coupé, double clic) lève cette erreur.
  if p_request is not null then
    if exists (select 1 from hg_wallet_log where user_id = auth.uid() and ref = 'booster:' || p_request) then
      raise exception 'booster_deja_ouvert' using errcode = 'P0001';
    end if;
    insert into hg_wallet_log(user_id, delta, reason, ref)
      values (auth.uid(), 0, 'booster_requete', 'booster:' || p_request);
  end if;
  n := greatest(coalesce((c->>'booster_size')::int, 5), 1);
  hrs := coalesce((c->>'free_booster_hours')::numeric, 24);
  pity := coalesce((c->>'pity_epique')::int, 10);
  if coalesce(p_offert, false) then
    -- Booster offert : on consomme un booster du stock (annulé avec le reste si l'ouverture échoue).
    if w.gift_boosters < 1 then raise exception 'Aucun booster offert disponible'; end if;
    update hg_wallets set gift_boosters = gift_boosters - 1 where user_id = auth.uid();
  elsif not god then
    -- Booster gratuit (p_free) : une fois par délai.
    if w.last_free_booster is not null and w.last_free_booster + make_interval(secs => hrs * 3600) > now() then
      raise exception 'Le booster gratuit n''est pas encore disponible';
    end if;
    update hg_wallets set last_free_booster = now() where user_id = auth.uid();
  end if;
  for i in 1..n loop
    if i = n and best < 4 and pity > 0 and w.pity_epique + 1 >= pity then rar := hg_card_roll(c->'rates', 4);
    else rar := hg_card_roll(c->'rates', 1); end if;
    cid := hg_card_pick(rar);
    continue when cid is null;
    sh := random() * 100 < coalesce((c->>'shiny_rate')::numeric, 3);
    cp := hg_card_give(auth.uid(), cid, sh, 'booster');
    select * into k from hg_cards where id = cid;
    best := greatest(best, hg_card_rank(k.rarity));
    out := out || jsonb_build_object('copy_id', cp, 'card_id', k.id, 'name', k.name, 'rarity', k.rarity, 'family', k.family,
      'image_url', k.image_url, 'flavor', k.flavor, 'number', k.number,
      'shiny', (select shiny from hg_card_copies where id = cp), 'serial', (select serial from hg_card_copies where id = cp), 'max_copies', k.max_copies);
    if hg_card_rank(k.rarity) >= 5 then
      insert into hg_activity(user_id, kind, text)
        select auth.uid(), 'cartes', p.pseudo || ' a obtenu « ' || k.name || ' » (' || replace(k.rarity, '_', ' ') || ') !' from hg_profiles p where p.id = auth.uid();
    end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Aucune carte n''est disponible pour le moment'; end if;
  update hg_wallets set boosters_opened = boosters_opened + 1,
    pity_epique = case when best >= 4 then 0 else pity_epique + 1 end, updated_at = now() where user_id = auth.uid();
  perform hg_card_check_sets(auth.uid());
  return jsonb_build_object('cards', out, 'best', ord[best],
    'demandees', n, 'livrees', jsonb_array_length(out),
    'offert', coalesce(p_offert, false),
    'offerts_restants', (select gift_boosters from hg_wallets where user_id = auth.uid()));
end $function$;

-- ---------------------------------------------------------------------
-- 13. Droits des fonctions : membres seulement
-- ---------------------------------------------------------------------
revoke all on function public.hg_booster_week_start(timestamptz), public.hg_booster_week_left(uuid, text),
  public.hg_booster_pick_one(text, uuid, uuid, boolean, uuid[]),
  public.hg_booster_draw(text, text, uuid, uuid, uuid[], boolean, boolean)
  from public, anon, authenticated;

revoke all on function public.hg_booster_types_me(), public.hg_booster_buy(text, integer, text),
  public.hg_booster_open(text, text, text, uuid), public.hg_booster_gift(uuid, text, integer, text, text),
  public.hg_booster_gifts_me(), public.hg_cards_me(),
  public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text),
  public.hg_open_booster_req(boolean, text, boolean)
  from public, anon;
grant execute on function public.hg_booster_types_me(), public.hg_booster_buy(text, integer, text),
  public.hg_booster_open(text, text, text, uuid), public.hg_booster_gift(uuid, text, integer, text, text),
  public.hg_booster_gifts_me(), public.hg_cards_me(),
  public.hg_cards_admin_bulk_give(uuid[], text, integer, uuid, boolean, boolean, text),
  public.hg_open_booster_req(boolean, text, boolean)
  to authenticated;
