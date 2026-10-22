-- =====================================================================
-- 062 : easter eggs (secrets cachés sur le site).
--
-- hg_egg_log : un secret trouvé par un membre, pour une période (« once » = une seule fois ; « AAAA-MM-JJ » = une fois par jour ;
--              « AAAA-MM » = une fois par mois ; « AAAA » = une fois par an). Une ligne = une récompense versée au plus.
-- hg_egg_found(code, extra) : le site signale un secret trouvé ; le serveur vérifie ce qui peut l'être (heure de Zurich,
--              date anniversaire du gang…), verse la récompense une seule fois par période et renvoie un message.
-- hg_eggs_me() : secrets déjà trouvés par le membre (pour la page secrète et la question bonus).
-- Réglages : hg_settings.eggs = { anniversaire_gang: "MM-JJ" | null, mot_secret: "SECRETS", recompenses: { code: Paillettes } }.
-- Récompenses spéciales : konami → badge « Initié » ; logo → carte « Le Curieux » ; lettres (7/7) → badge « Chasseur de secrets » ;
--   anniversaire → carte « Gâteau du gang » (une fois par an) ; secousse → un booster offert (une fois par mois) ;
--   heure du gang (13 h 37) → 13 Paillettes ; jeu de la page 404 → 5 Paillettes par jour.
-- Les cartes secrètes sont dans la série « Secrets » (inactive : jamais dans les boosters).
-- Question bonus du quiz : hg_quiz_questions.secret = true ; visible seulement après 3 secrets trouvés.
-- Ces secrets sont des jeux : un membre bricoleur peut les déclencher à la main ; les gains sont petits et plafonnés par période.
-- (Appliquée en plusieurs parties : l'outil de migration refuse les envois trop gros.)
-- =====================================================================

create table if not exists public.hg_egg_log (
  id bigserial primary key,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  egg text not null check (egg ~ '^[a-z0-9_]{2,30}$'),
  period text not null default 'once' check (period ~ '^(once|[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?)$'),
  reward int not null default 0,
  found_at timestamptz not null default now(),
  unique (user_id, egg, period)
);
alter table public.hg_egg_log enable row level security;
revoke all on public.hg_egg_log from anon;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_egg_log' and policyname = 'hg_egg_log_own') then
    create policy hg_egg_log_own on public.hg_egg_log for select to authenticated using (user_id = auth.uid() or hg_is_admin());
  end if;
end $$;

insert into public.hg_settings (key, value)
  values ('eggs', '{"anniversaire_gang": null, "mot_secret": "SECRETS", "recompenses": {"konami": 100, "logo": 50, "humane": 25, "jeu404": 5, "heure_gang": 13, "anniversaire": 100, "console": 50, "lettres": 200, "secousse": 0, "nuit": 30, "rembobine": 25}}'::jsonb)
  on conflict (key) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'hg_settings' and policyname = 'hg_settings_read_eggs') then
    create policy hg_settings_read_eggs on public.hg_settings for select to authenticated using (key = 'eggs');
  end if;
end $$;

-- Série cachée « Secrets » (inactive : jamais tirée dans un booster) et ses deux cartes.
insert into public.hg_card_sets (code, name, description, active, sort)
  select 'secrets', 'Secrets', 'Cartes cachées : on ne les obtient qu''en trouvant les secrets du site.', false, 9998
  where not exists (select 1 from public.hg_card_sets where code = 'secrets');
insert into public.hg_cards (set_id, number, name, family, rarity, flavor, can_shiny, tradeable, craftable, active)
  select s.id, 1, 'Le Curieux', 'objet', 'epique', 'Il a cliqué sept fois sur le logo. Juste pour voir.', false, true, false, true
  from public.hg_card_sets s where s.code = 'secrets'
    and not exists (select 1 from public.hg_cards k where k.set_id = s.id and k.name = 'Le Curieux');
insert into public.hg_cards (set_id, number, name, family, rarity, flavor, can_shiny, tradeable, craftable, active)
  select s.id, 2, 'Gâteau du gang', 'evenement', 'legendaire', 'Une part par an, le jour de l''anniversaire du gang.', true, true, false, true
  from public.hg_card_sets s where s.code = 'secrets'
    and not exists (select 1 from public.hg_cards k where k.set_id = s.id and k.name = 'Gâteau du gang');

-- Badges secrets (attribués par hg_egg_found ; la récompense de badge habituelle s'applique).
insert into public.hg_badges (code, name, description, sort)
  values ('initie', 'Initié', 'A trouvé le code secret du gang.', 900),
         ('chasseur_secrets', 'Chasseur de secrets', 'A trouvé les 7 lettres cachées du site.', 901)
  on conflict (code) do nothing;

-- Question bonus secrète du quiz.
alter table public.hg_quiz_questions add column if not exists secret boolean not null default false;

-- Nombre de secrets différents trouvés par un membre.
create or replace function public.hg_eggs_count(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct case when egg like 'lettre_%' then 'lettres' else egg end)::int from hg_egg_log where user_id = p_user
$$;
revoke execute on function public.hg_eggs_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fonctions (appliquées en 062b et 062c) : hg_egg_found, hg_eggs_me, question secrète du quiz.
-- Le texte exact appliqué est celui de la base ; résumé du contrat :
--   hg_egg_found(p_egg, p_extra) : p_egg ∈ konami, logo, humane, jeu404 (p_extra.score ≥ 1), heure_gang (13 h 36 à 13 h 38 à Zurich),
--     anniversaire (jour = eggs.anniversaire_gang), console, lettre_1 … lettre_7, secousse, nuit (3 h à 3 h 59 à Zurich), rembobine.
--     Renvoie { new, reward, message, card, badge, found }. Paillettes : wallet_log reason 'secret'.
--     Premier secret « une fois » trouvé : ligne « … a trouvé un secret caché sur le site… » dans le fil (kind 'secret').
--   hg_eggs_me() : { found, total: 12, eggs: [{ egg, first }], letters }.
--   hg_quiz_list / hg_quiz_answer : une question secrete n'est visible et ouverte qu'avec au moins 3 secrets trouvés ; hg_quiz_list
--     renvoie le champ secret. hg_quiz_set_secret(id, bool) : réglage admin, appelé après hg_quiz_save.
-- ---------------------------------------------------------------------------
