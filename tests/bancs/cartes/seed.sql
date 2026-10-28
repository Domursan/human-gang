-- Jeu de données du banc « économie des cartes » (superutilisateur, hors production).
-- Membres 2 à 5 (comptes de plus de 7 jours, pour les règles d'ancienneté), une série de test, une carte par rareté
-- (plus une identité limitée à 2 exemplaires et une carte non échangeable), des Paillettes et un départ en cartes.
-- Réglages « cards » et « echanges » recopiés ici avec des valeurs fixes (en production ils ne sont pas dans le dépôt).

insert into auth.users (id, email, created_at)
  select t_uid(n), 'membre' || n || '@banc.invalid', now() - interval '30 days' from generate_series(2, 5) n
  on conflict (id) do update set created_at = excluded.created_at;

-- joined_on pilote created_at (trigger hg_profiles_sync_joined) : l'ancienneté des comptes vient de là.
insert into hg_profiles (id, pseudo, is_admin, joined_on, account_created_at)
  select t_uid(n), 'Banc' || n, false, current_date - 30, now() - interval '30 days' from generate_series(2, 5) n
  on conflict (id) do update set joined_on = excluded.joined_on, account_created_at = excluded.account_created_at;

insert into hg_settings (key, value) values
  ('cards', '{"recycle": {"commune": 1, "peu_commune": 2, "rare": 5, "epique": 10, "legendaire": 25, "mythique": 50, "identite": 100, "shiny_multiplier": 3}, "free_booster_hours": 24, "max_open_trades": 50}'),
  ('echanges', '{"paillettes_max_semaine": 5000, "anciennete_jours": 7, "dons_valeur_max_semaine": 100000}')
on conflict (key) do update set value = excluded.value;

insert into hg_card_sets (id, code, name, active, sort, booster_scope)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'banc', 'Série de test', true, 900, null)
  on conflict (id) do nothing;

-- Une carte par rareté (4 exemplaires chacune), sauf l'identité (limitée à 2) et une carte non échangeable.
insert into hg_cards (id, set_id, number, name, family, rarity, can_shiny, tradeable, craftable, max_copies, active)
  select md5('banc-' || r.rarity || '-' || i)::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', r.ord * 10 + i,
         'Carte ' || r.rarity || ' ' || i, 'objet', r.rarity, true, true, true, null, true
    from (values ('commune', 1), ('peu_commune', 2), ('rare', 3), ('epique', 4), ('legendaire', 5), ('mythique', 6)) r(rarity, ord)
    cross join generate_series(1, 4) i
  on conflict (id) do nothing;
insert into hg_cards (id, set_id, number, name, family, rarity, can_shiny, tradeable, craftable, max_copies, active)
  values
    (md5('banc-identite')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 90, 'Identité limitée', 'objet', 'identite', true, true, false, 2, true),
    (md5('banc-non-echangeable')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 91, 'Carte non échangeable', 'objet', 'rare', true, false, true, null, true)
  on conflict (id) do nothing;

insert into hg_wallets (user_id, paillettes)
  select t_uid(n), 2000 from generate_series(2, 5) n
  on conflict (user_id) do update set paillettes = excluded.paillettes;

-- Départ : membre 2 et 3 : 10 cartes chacun ; membre 4 : 5 cartes ; membre 5 : aucune.
select hg_card_give(t_uid(2), md5('banc-' || r.rarity || '-' || i)::uuid, false, 'admin')
  from (values ('commune'), ('peu_commune'), ('rare'), ('epique'), ('legendaire')) r(rarity)
  cross join generate_series(1, 2) i;
select hg_card_give(t_uid(3), md5('banc-' || r.rarity || '-' || i)::uuid, false, 'admin')
  from (values ('commune'), ('peu_commune'), ('rare'), ('epique'), ('legendaire')) r(rarity)
  cross join generate_series(1, 2) i;
select hg_card_give(t_uid(4), md5('banc-' || r.rarity || '-' || i)::uuid, false, 'admin')
  from (values ('commune'), ('peu_commune'), ('rare'), ('epique'), ('legendaire')) r(rarity)
  cross join generate_series(3, 3) i;
select hg_card_give(t_uid(3), md5('banc-non-echangeable')::uuid, false, 'admin');
select hg_card_give(t_uid(3), md5('banc-non-echangeable')::uuid, false, 'admin');
