-- Boosters : achat, ouverture depuis le stock, débit des Paillettes, cartes créées, plafonds (semaine, exemplaires),
-- idempotence des requêtes rejouées, refus sans Paillettes.
do $$
declare
  u2 uuid := t_uid(2); u4 uuid := t_uid(4); u5 uuid := t_uid(5);
  ident uuid := md5('banc-identite')::uuid;
  pl0 int; pl1 int; r jsonb; n0 bigint; n1 bigint; msg text;
begin
  -- 1. Achat d'un booster classique (100 Paillettes) : débit, stock, achat enregistré
  pl0 := t_pl(u2);
  r := t_call(u2, 'hg_booster_buy(''classique'', 1, ''achat-1'')');
  perform t_ok((r->>'cost')::int = 100 and t_pl(u2) = pl0 - 100, 'achat : 100 Paillettes débitées');
  perform t_ok((r->>'stock')::int = 1, 'achat : le booster rejoint le stock');
  msg := t_err(u2, 'hg_booster_buy(''classique'', 1, ''achat-1'')');
  perform t_ok(msg like 'achat_deja_fait%' and t_pl(u2) = pl0 - 100, 'achat : la même requête rejouée est refusée, sans second débit');

  -- 2. Ouverture depuis le stock : 5 cartes données au membre, stock vidé, aucun débit
  n0 := (select count(*) from hg_card_copies where owner_id = u2 and recycled_at is null);
  pl1 := t_pl(u2);
  r := t_call(u2, 'hg_booster_open(''classique'', ''stock'', ''ouv-1'', null)');
  n1 := (select count(*) from hg_card_copies where owner_id = u2 and recycled_at is null);
  perform t_ok(jsonb_array_length(r->'cards') = 5 and (r->>'livrees')::int = 5, 'ouverture : 5 cartes tirées (taille du booster classique)');
  perform t_ok(n1 = n0 + 5, 'ouverture : 5 exemplaires créés pour le membre, aucun en moins');
  perform t_ok((select count(*) from hg_card_copies where owner_id = u2 and source = 'booster') = 5,
               'ouverture : les 5 exemplaires portent la source « booster »');
  perform t_ok(t_pl(u2) = pl1, 'ouverture depuis le stock : aucun débit de Paillettes');
  perform t_ok(coalesce((select qty from hg_booster_stock where user_id = u2 and type_id = 'classique'), 0) = 0,
               'ouverture : le booster sort du stock');

  -- 3. Sans stock : refus
  msg := t_err(u2, 'hg_booster_open(''classique'', ''stock'', null, null)');
  perform t_ok(msg like 'Aucun booster%', 'ouverture sans booster en stock : refusée');

  -- 4. Requête d'ouverture rejouée : refusée, le booster n'est consommé qu'une fois
  perform t_call(u2, 'hg_booster_buy(''classique'', 1, ''achat-2'')');
  perform t_call(u2, 'hg_booster_open(''classique'', ''stock'', ''ouv-2'', null)');
  n0 := (select count(*) from hg_card_copies where owner_id = u2 and recycled_at is null);
  msg := t_err(u2, 'hg_booster_open(''classique'', ''stock'', ''ouv-2'', null)');
  n1 := (select count(*) from hg_card_copies where owner_id = u2 and recycled_at is null);
  perform t_ok(msg like 'booster_deja_ouvert%' and n1 = n0, 'ouverture : la même requête rejouée ne donne aucune carte de plus');

  -- 5. Plafond hebdomadaire (diamant : 5 par semaine, 500 Paillettes l'unité)
  update hg_wallets set paillettes = 5000 where user_id = u4;
  r := t_call(u4, 'hg_booster_buy(''diamant'', 5, ''lim-1'')');
  perform t_ok((r->>'remaining_week')::int = 0 and t_pl(u4) = 5000 - 2500, 'plafond : 5 diamants achetés d''un coup, 2 500 Paillettes débitées');
  msg := t_err(u4, 'hg_booster_buy(''diamant'', 1, ''lim-2'')');
  perform t_ok(msg like 'Limite atteinte%' and t_pl(u4) = 5000 - 2500, 'plafond hebdomadaire : le sixième diamant est refusé, rien débité');

  -- 6. Paillettes insuffisantes : rien débité, rien acheté, rien stocké
  update hg_wallets set paillettes = 50 where user_id = u5;
  msg := t_err(u5, 'hg_booster_buy(''classique'', 1, null)');
  perform t_ok(msg like 'Pas assez de Paillettes%' and t_pl(u5) = 50
               and (select count(*) from hg_booster_purchases where user_id = u5) = 0
               and coalesce((select qty from hg_booster_stock where user_id = u5 and type_id = 'classique'), 0) = 0,
               'achat sans Paillettes suffisantes : refusé, aucun débit, aucun booster stocké');

  -- 7. Plafond d'exemplaires : « Identité limitée » ne tire que 2 exemplaires
  loop
    exit when (select count(*) from hg_card_copies where card_id = ident and recycled_at is null) >= 2;
    perform hg_card_give(u5, ident, false, 'admin');
  end loop;
  begin
    perform hg_card_give(u5, ident, false, 'admin');
    msg := 'accepté';
  exception when others then msg := sqlerrm;
  end;
  perform t_ok(msg like 'Plus aucun exemplaire%', 'plafond d''exemplaires : la 3e « Identité limitée » est refusée');

  perform t_bilan_fin();
end $$;
