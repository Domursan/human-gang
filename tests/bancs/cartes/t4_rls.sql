-- Droits d'accès (RLS et privilèges) vus par un membre connecté : lectures privées, offres d'autrui, écritures directes,
-- fonctions d'économie non appelables directement.
-- Constat attendu et voulu : la collection d'un membre est lisible par les autres membres (lecture seule, PLAN-DU-SITE).
do $$
declare
  u2 uuid := t_uid(2); u3 uuid := t_uid(3); u4 uuid := t_uid(4);
  tid uuid; r text; pl0 int; live0 bigint := t_vivants(); stock0 int; msg text; n bigint;
begin
  -- A. Lectures privées : rien de ce qui appartient à un autre membre
  perform t_ok(t_count(u2, format('select count(*) from hg_wallets where user_id = %L', u3)) = 0,
               'portefeuille : un membre ne lit pas le solde d''un autre');
  perform t_ok(t_count(u2, format('select count(*) from hg_wallet_log where user_id = %L', u3)) = 0,
               'journal des Paillettes : pas celui d''un autre');
  perform t_ok(t_count(u2, format('select count(*) from hg_booster_stock where user_id = %L', u3)) = 0,
               'stock de boosters : pas celui d''un autre');
  perform t_ok(t_count(u2, format('select count(*) from hg_booster_pity where user_id = %L', u3)) = 0,
               'garantie des boosters : pas celle d''un autre');
  perform t_ok(t_count(u2, format('select count(*) from hg_booster_purchases where user_id = %L', u3)) = 0,
               'achats de boosters : pas ceux d''un autre');
  -- Table sans privilège pour authenticated (ou sans politique) : l'erreur « permission denied » vaut refus
  begin
    perform t_asu(u2); execute 'set local role authenticated';
    execute 'select count(*) from hg_booster_opens' into n;
    execute 'reset role'; msg := 'lecture : ' || n || ' ligne(s)';
  exception when others then execute 'reset role'; msg := sqlerrm;
  end;
  perform t_ok(msg like '%permission denied%' or msg = 'lecture : 0 ligne(s)',
               'journal des ouvertures de boosters : illisible pour un membre (' || msg || ')');
  perform t_ok(t_count(u2, format('select count(*) from hg_wallet_log where user_id = %L', u4)) = 0
               and t_count(u4, format('select count(*) from hg_booster_stock where user_id = %L', u2)) = 0,
               'lecture croisée : aucun journal ni stock d''un membre vu par un autre (sens inverse aussi)');

  -- B. Ses propres lignes restent lisibles
  perform t_ok(t_count(u2, format('select count(*) from hg_booster_purchases where user_id = %L', u2)) >= 1,
               'achats de boosters : ses propres achats sont lisibles');
  perform t_ok(t_count(u2, format('select count(*) from hg_card_copies where owner_id = %L', u2)) > 0,
               'collection : ses propres cartes sont lisibles');

  -- C. Collection d'autrui : lecture seule, voulue (constat)
  perform t_ok(t_count(u2, format('select count(*) from hg_card_copies where owner_id = %L', u3)) > 0,
               'collection : les cartes d''un autre membre sont lisibles (voulu : #collection/<id> en lecture seule)');

  -- D. Offres : une offre entre deux autres membres est invisible
  tid := (t_call(u3, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u4,
            t_arr(array[t_copie(u3, 4)]), t_arr(array[t_copie(u4, 2)])))#>>'{}')::uuid;
  perform t_ok(t_count(u2, format('select count(*) from hg_card_trades where id = %L', tid)) = 0
               and t_count(u2, format('select count(*) from hg_card_trade_items where trade_id = %L', tid)) = 0,
               'offre entre deux autres membres : invisible (ni l''offre, ni ses cartes)');
  perform t_ok(t_count(u4, format('select count(*) from hg_card_trades where id = %L', tid)) = 1,
               'offre : le destinataire la voit');
  perform t_do(u3, format('hg_trade_cancel(%L)', tid));

  -- E. Écritures directes refusées (erreur de privilège ou RLS sans effet : aucune ligne touchée)
  pl0 := t_pl(u2); live0 := t_vivants();
  stock0 := coalesce((select qty from hg_booster_stock where user_id = u2 and type_id = 'classique'), 0);
  r := t_exec(u2, format('update hg_wallets set paillettes = 999999 where user_id = %L', u2));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'solde : pas de modification directe (' || r || ')');
  r := t_exec(u2, format('insert into hg_wallet_log (user_id, delta, reason) values (%L, 5000, ''banc'')', u2));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'journal des Paillettes : pas d''écriture directe (' || r || ')');
  r := t_exec(u2, format('insert into hg_card_copies (card_id, owner_id, source) select id, %L, ''admin'' from hg_cards limit 1', u2));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'cartes : pas de création directe d''exemplaire (' || r || ')');
  r := t_exec(u2, format('update hg_card_copies set owner_id = %L where owner_id = %L', u2, u3));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'cartes : pas de vol direct d''exemplaire (' || r || ')');
  r := t_exec(u2, format('delete from hg_card_copies where owner_id = %L', u2));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'cartes : pas de suppression directe (' || r || ')');
  r := t_exec(u2, format('insert into hg_booster_stock (user_id, type_id, qty) values (%L, ''classique'', 50)', u2));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'stock de boosters : pas d''ajout direct (' || r || ')');
  r := t_exec(u2, 'update hg_cards set rarity = ''legendaire''');
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'catalogue : pas de modification des cartes (' || r || ')');
  r := t_exec(u2, format('insert into hg_card_trades (from_user, to_user, status, from_paillettes, to_paillettes) values (%L, %L, ''acceptee'', 0, 0)', u2, u3));
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'échanges : pas d''échange écrit directement (' || r || ')');
  r := t_exec(u2, 'update hg_booster_types set price = 0');
  perform t_ok(r like 'ERR%' or r = '0 ligne(s)', 'boosters : pas de changement de prix (' || r || ')');
  perform t_ok(t_pl(u2) = pl0 and t_vivants() = live0
               and coalesce((select qty from hg_booster_stock where user_id = u2 and type_id = 'classique'), 0) = stock0,
               'après ces tentatives : Paillettes, cartes et stock inchangés');

  -- F. Fonctions d'économie : pas appelables directement par un membre (seulement par les RPC prévues)
  msg := t_err(u2, format('hg_wallet_add(%L, 100000, ''banc'', null)', u2));
  perform t_ok(msg is not null and t_pl(u2) = pl0, 'hg_wallet_add : appel direct par un membre refusé (' || coalesce(msg, 'ACCEPTÉ') || ')');
  msg := t_err(u2, format('hg_card_give(%L, %L, false, ''admin'')', u2, md5('banc-rare-1')::uuid));
  perform t_ok(msg is not null and t_vivants() = live0, 'hg_card_give : création directe de carte refusée (' || coalesce(msg, 'ACCEPTÉE') || ')');
  msg := t_err(u2, format('hg_cards_admin_paillettes(%L, 100000, ''banc'')', u2));
  perform t_ok(msg is not null and t_pl(u2) = pl0, 'RPC d''administration : refusée à un membre (' || coalesce(msg, 'ACCEPTÉE') || ')');

  perform t_bilan_fin();
end $$;
