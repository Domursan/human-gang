-- Échanges entre membres : proposition, blocage des cartes, acceptation, refus, annulation, cadeau pendant une offre,
-- Paillettes échangées, contre-proposition. Invariants : aucune carte créée, perdue ou dupliquée.
do $$
declare
  u2 uuid := t_uid(2); u3 uuid := t_uid(3); u4 uuid := t_uid(4);
  x bigint; y bigint; z bigint; tid uuid; tid2 uuid; tid3 uuid; tid4 uuid; tid5 uuid; tid6 uuid; tid7 uuid; tid8 uuid;
  x2 bigint; y2 bigint; x3 bigint; x4 bigint; y4 bigint; x5 bigint; y5 bigint; x6 bigint; y6 bigint; x7 bigint; y7 bigint;
  live0 bigint := t_vivants();
  c2 bigint := (select count(*) from hg_card_copies where owner_id = t_uid(2) and recycled_at is null);
  c3 bigint := (select count(*) from hg_card_copies where owner_id = t_uid(3) and recycled_at is null);
  b2 int; b3 int; st text; msg text;
begin
  -- A. Proposition : une carte de chacun, bloquées sur l'offre
  x := t_copie(u2, 1); y := t_copie(u3, 1);
  tid := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, %L, null)', u3, t_arr(array[x]), t_arr(array[y]), 'Bonjour'))#>>'{}')::uuid;
  perform t_ok(exists (select 1 from hg_card_trades where id = tid and status = 'proposee'), 'proposition : offre enregistrée en attente');
  perform t_ok((select locked_trade from hg_card_copies where id = x) = tid, 'proposition : la carte donnée est bloquée sur l''offre');

  -- B. Une carte déjà bloquée ne peut pas entrer dans une seconde offre
  msg := t_err(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u4, t_arr(array[x]), t_arr(array[t_copie(u4, 1)])));
  perform t_ok(msg like 'Certaines cartes%', 'une carte déjà bloquée ne peut pas être proposée une seconde fois');

  -- C. On ne propose pas une carte qu'on ne possède pas, ni une carte non échangeable
  msg := t_err(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u4, t_arr(array[t_copie(u3, 2)]), '''{}''::bigint[]'));
  perform t_ok(msg like 'Certaines cartes%', 'on ne peut pas offrir la carte d''un autre membre');
  msg := t_err(u3, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u2,
    '(select array_agg(c.id) from hg_card_copies c join hg_cards k on k.id = c.card_id where c.owner_id = ''' || u3 || ''' and not k.tradeable and c.recycled_at is null)',
    '''{}''::bigint[]'));
  perform t_ok(msg like 'Certaines cartes%', 'une carte non échangeable ne peut pas être proposée');
  msg := t_err(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u2, t_arr(array[t_copie(u2, 2)]), '''{}''::bigint[]'));
  perform t_ok(msg like 'Destinataire invalide%', 'on ne propose pas un échange à soi-même');

  -- D. Seul le destinataire répond
  msg := t_err(u2, format('hg_trade_respond(%L, true)', tid));
  perform t_ok(msg like 'Seul le destinataire%', 'l''auteur de l''offre ne peut pas l''accepter');

  -- E. Acceptation par le destinataire : les cartes changent de main une fois, rien ne se crée ni ne se perd
  st := (t_call(u3, format('hg_trade_respond(%L, true)', tid))#>>'{}');
  perform t_ok(st = 'acceptee', 'acceptation par le destinataire');
  perform t_ok((select owner_id from hg_card_copies where id = x) = u3 and (select owner_id from hg_card_copies where id = y) = u2,
               'acceptation : chaque carte change de main, une seule fois');
  perform t_ok(t_vivants() = live0, 'acceptation : aucune carte créée ni perdue');
  perform t_ok((select count(*) from hg_card_copies where owner_id = u2 and recycled_at is null) = c2
               and (select count(*) from hg_card_copies where owner_id = u3 and recycled_at is null) = c3,
               'acceptation : chaque membre garde le même nombre de cartes');
  perform t_ok((select locked_trade from hg_card_copies where id = x) is null, 'acceptation : la carte n''est plus bloquée');
  msg := t_err(u3, format('hg_trade_respond(%L, true)', tid));
  perform t_ok(msg like 'Offre introuvable%', 'une seconde acceptation de la même offre est refusée');

  -- F. Refus : la carte est rendue, aucun changement de propriétaire
  x2 := t_copie(u2, 1); y2 := t_copie(u3, 1);
  tid2 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u3, t_arr(array[x2]), t_arr(array[y2])))#>>'{}')::uuid;
  st := (t_call(u3, format('hg_trade_respond(%L, false)', tid2))#>>'{}');
  perform t_ok(st = 'refusee' and (select owner_id from hg_card_copies where id = x2) = u2
               and (select locked_trade from hg_card_copies where id = x2) is null, 'refus : carte libérée, propriétaire inchangé');

  -- G. Annulation : un tiers ne peut pas annuler, l'auteur oui
  x3 := t_copie(u2, 1);
  tid3 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u3, t_arr(array[x3]), '''{}''::bigint[]'))#>>'{}')::uuid;
  msg := t_err(u4, format('hg_trade_cancel(%L)', tid3));
  perform t_ok(msg like 'Action non autorisée%', 'annulation : un tiers ne peut pas annuler l''offre');
  perform t_do(u2, format('hg_trade_cancel(%L)', tid3));
  perform t_ok((select status from hg_card_trades where id = tid3) = 'annulee' and (select locked_trade from hg_card_copies where id = x3) is null,
               'annulation par l''auteur : offre close, carte libérée');

  -- H. Une carte donnée pendant l'offre n'est plus échangeable : l'acceptation est refusée
  x4 := t_copie(u2, 2); y4 := t_copie(u3, 2);
  tid4 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u3, t_arr(array[x4]), t_arr(array[y4])))#>>'{}')::uuid;
  perform t_do(u3, format('hg_card_gift(%L, %s, null)', u4, t_arr(array[y4])));
  msg := t_err(u3, format('hg_trade_respond(%L, true)', tid4));
  perform t_ok(msg like 'Les cartes ont changé%' and (select status from hg_card_trades where id = tid4) = 'proposee'
               and (select owner_id from hg_card_copies where id = y4) = u4,
               'carte demandée offerte entre-temps : acceptation refusée, offre toujours en attente');
  perform t_do(u2, format('hg_trade_cancel(%L)', tid4));

  -- I. Paillettes échangées : chaque solde bouge du montant convenu, le total est conservé
  b2 := t_pl(u2); b3 := t_pl(u3);
  x5 := t_copie(u2, 3); y5 := t_copie(u3, 3);
  tid5 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 200, 100, null, null)', u3, t_arr(array[x5]), t_arr(array[y5])))#>>'{}')::uuid;
  st := (t_call(u3, format('hg_trade_respond(%L, true)', tid5))#>>'{}');
  perform t_ok(st = 'acceptee' and t_pl(u2) = b2 - 200 + 100 and t_pl(u3) = b3 + 200 - 100,
               'échange avec Paillettes : 200 données par l''auteur, 100 reçues en retour');
  perform t_ok(t_pl(u2) + t_pl(u3) = b2 + b3, 'échange avec Paillettes : le total des Paillettes est conservé');

  -- J. Paillettes devenues insuffisantes entre la proposition et l'acceptation : refusé
  x6 := t_copie(u2, 4); y6 := t_copie(u3, 4);
  tid6 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 1000, 0, null, null)', u3, t_arr(array[x6]), t_arr(array[y6])))#>>'{}')::uuid;
  update hg_wallets set paillettes = 10 where user_id = u2;
  msg := t_err(u3, format('hg_trade_respond(%L, true)', tid6));
  perform t_ok(msg like 'Paillettes insuffisantes%' and (select status from hg_card_trades where id = tid6) = 'proposee'
               and (select owner_id from hg_card_copies where id = x6) = u2,
               'Paillettes insuffisantes à l''acceptation : refusé, aucune carte n''a bougé');
  update hg_wallets set paillettes = 2000 where user_id = u2;
  perform t_do(u2, format('hg_trade_cancel(%L)', tid6));

  -- K. Contre-proposition : l'offre d'origine est remplacée et ses cartes libérées
  x7 := t_copie(u2, 5); y7 := t_copie(u3, 5);
  tid7 := (t_call(u2, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u3, t_arr(array[x7]), t_arr(array[y7])))#>>'{}')::uuid;
  tid8 := (t_call(u3, format('hg_trade_propose(%L, %s, %s, 0, 0, null, %L)', u2, t_arr(array[y7]), t_arr(array[x7]), tid7))#>>'{}')::uuid;
  perform t_ok((select status from hg_card_trades where id = tid7) = 'remplacee' and (select locked_trade from hg_card_copies where id = x7) is null,
               'contre-proposition : l''offre d''origine est remplacée, ses cartes libérées');
  perform t_do(u3, format('hg_trade_cancel(%L)', tid8));

  -- L. Invariants finaux
  perform t_ok(t_vivants() = live0, 'bilan : toutes les cartes du banc existent encore (aucune créée, aucune perdue)');
  perform t_ok(t_orphelins() = 0, 'bilan : aucune carte sans propriétaire ni bloquée sur une offre close');
  perform t_ok(not exists (
      select 1 from hg_card_trade_items i join hg_card_trades t on t.id = i.trade_id
       where t.status = 'proposee' and i.side = 'from'
       group by i.copy_id having count(*) > 1),
      'bilan : une carte n''est jamais donnée dans deux offres ouvertes');

  perform t_bilan_fin();
end $$;
