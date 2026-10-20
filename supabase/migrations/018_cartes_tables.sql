-- ===== 018 (a) : jeu de cartes à collectionner — tables (déjà appliqué) =====
-- Raretés : commune < peu_commune < rare < epique < legendaire < mythique < identite
-- « identite » = carte d'identité d'un membre, numérotée (max_copies), la plus rare du jeu.
create table public.hg_card_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, description text,
  starts_at timestamptz, ends_at timestamptz,          -- null = toujours disponible
  active boolean not null default true, sort int not null default 0,
  created_at timestamptz not null default now()
);
create table public.hg_cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.hg_card_sets(id) on delete cascade,
  number int not null, name text not null,
  family text not null check (family in ('membre','moment','lieu','objet','evenement')),
  rarity text not null check (rarity in ('commune','peu_commune','rare','epique','legendaire','mythique','identite')),
  image_url text, flavor text,
  member_id uuid references public.hg_profiles(id) on delete set null,
  can_shiny boolean not null default true, tradeable boolean not null default true, craftable boolean not null default true,
  max_copies int check (max_copies is null or max_copies > 0),
  active boolean not null default true, created_at timestamptz not null default now(),
  unique (set_id, number)
);
create table public.hg_card_copies (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.hg_cards(id) on delete cascade,
  owner_id uuid references public.hg_profiles(id) on delete set null,
  shiny boolean not null default false, serial int,
  source text not null default 'booster' check (source in ('booster','cadeau','admin','fabrication','evenement','echange')),
  obtained_at timestamptz not null default now(),
  locked_trade uuid, recycled_at timestamptz
);
create index hg_card_copies_owner on public.hg_card_copies(owner_id) where recycled_at is null;
create unique index hg_card_copies_serial on public.hg_card_copies(card_id, serial) where serial is not null;
create table public.hg_wallets (
  user_id uuid primary key references public.hg_profiles(id) on delete cascade,
  paillettes int not null default 0 check (paillettes >= 0),
  boosters_opened int not null default 0, pity_epique int not null default 0,
  last_free_booster timestamptz, last_daily date, daily_streak int not null default 0,
  updated_at timestamptz not null default now()
);
create table public.hg_wallet_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  delta int not null, reason text not null, ref text, created_at timestamptz not null default now()
);
create unique index hg_wallet_log_once on public.hg_wallet_log(user_id, reason, ref) where ref is not null;
create table public.hg_card_trades (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.hg_profiles(id) on delete cascade,
  to_user uuid not null references public.hg_profiles(id) on delete cascade,
  status text not null default 'proposee' check (status in ('proposee','acceptee','refusee','annulee','remplacee')),
  from_paillettes int not null default 0 check (from_paillettes >= 0),
  to_paillettes int not null default 0 check (to_paillettes >= 0),
  message text check (message is null or char_length(message) <= 500),
  parent_id uuid references public.hg_card_trades(id) on delete set null,
  created_at timestamptz not null default now(), resolved_at timestamptz,
  check (from_user <> to_user)
);
create table public.hg_card_trade_items (
  trade_id uuid not null references public.hg_card_trades(id) on delete cascade,
  copy_id bigint not null references public.hg_card_copies(id) on delete cascade,
  side text not null check (side in ('from','to')), primary key (trade_id, copy_id)
);
create table public.hg_card_wishlist (
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  card_id uuid not null references public.hg_cards(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, card_id)
);
create table public.hg_card_showcase (
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  slot int not null check (slot between 1 and 3),
  copy_id bigint not null references public.hg_card_copies(id) on delete cascade,
  primary key (user_id, slot)
);
-- Réglages (modifiables dans l'admin) : hg_settings.key = 'cards'
-- booster_price 100, booster_size 5, free_booster_hours 24, shiny_rate 3, pity_epique 10, max_open_trades 10,
-- rates {commune 60, peu_commune 25, rare 10, epique 4, legendaire 0.88, mythique 0.1, identite 0.02},
-- recycle {5,10,25,60,150,400, identite 1000 (non recyclable en pratique), shiny_multiplier 3},
-- craft {40,80,200,500,1500, shiny_multiplier 4}, rewards {daily 20, streak_bonus 5, streak_max 7, rsvp 15,
-- presence 30, photo 2, moment 15, gift_sent 50, badge 40, capture 10, event_created 25, set_complete 300}
-- RLS : admin = tout ; membres = lecture catalogue/collections/vitrines/souhaits ; souhaits et vitrine en écriture
-- pour soi ; portefeuille, journal et échanges visibles par les concernés. Le reste passe par les fonctions (018 b).
