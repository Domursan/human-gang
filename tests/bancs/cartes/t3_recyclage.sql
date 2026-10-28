-- Recyclage : valeur versée (brillante ×3), cartes marquées et non supprimées, refus (déjà recyclée, carte d'un autre,
-- carte bloquée sur une offre, identité), liste vide.
do $$
declare
  u3 uuid := t_uid(3); u4 uuid := t_uid(4); u5 uuid := t_uid(5);
  ident uuid := md5('banc-identite')::uuid;
  a bigint; b bigint; c bigint; d bigint; e bigint; i5 bigint; tid uuid;
  v int; r int; pl0 int; live0 bigint := t_vivants(); rows0 bigint := (select count(*) from hg_card_copies);
  msg text;
begin
  -- A. Recyclage de deux cartes du membre 4, dont une brillante
  a := t_copie(u4, 1); b := t_copie(u4, 2);
  update hg_card_copies set shiny = true where id = b;
  v := (select sum(hg_card_recycle_value(k.rarity, x.shiny)) from hg_card_copies x join hg_cards k on k.id = x.card_id where x.id in (a, b));
  pl0 := t_pl(u4);
  r := (t_call(u4, format('hg_card_recycle(%s)', t_arr(array[a, b])))#>>'{}')::int;
  perform t_ok(r = v and v > 0, 'recyclage : la valeur versée est celle des raretés (brillante ×3)');
  perform t_ok(t_pl(u4) = pl0 + v, 'recyclage : les Paillettes sont versées au membre');
  perform t_ok((select count(*) from hg_card_copies where id in (a, b) and recycled_at is not null) = 2,
               'recyclage : les deux cartes sont marquées recyclées');
  perform t_ok((select count(*) from hg_card_copies) = rows0 and t_vivants() = live0 - 2,
               'recyclage : les lignes restent en base (rien supprimé), deux cartes sortent de la collection');
  perform t_ok(exists (select 1 from hg_wallet_log where user_id = u4 and reason = 'recyclage' and delta = v),
               'recyclage : écriture dans le journal des Paillettes');

  -- B. Une carte déjà recyclée ne se recycle pas une seconde fois : rien n'est versé
  msg := t_err(u4, format('hg_card_recycle(%s)', t_arr(array[a])));
  perform t_ok(msg like 'Certaines cartes%' and t_pl(u4) = pl0 + v, 'carte déjà recyclée : refusée, aucun versement');

  -- C. Une carte d'un autre membre ne se recycle pas
  c := t_copie(u3, 1);
  msg := t_err(u4, format('hg_card_recycle(%s)', t_arr(array[c])));
  perform t_ok(msg like 'Certaines cartes%' and (select owner_id from hg_card_copies where id = c) = u3,
               'carte d''un autre membre : refusée, propriétaire inchangé');

  -- D. Une carte bloquée sur une offre ne se recycle pas (et la liste est tout ou rien)
  d := t_copie(u4, 3);
  tid := (t_call(u4, format('hg_trade_propose(%L, %s, %s, 0, 0, null, null)', u3, t_arr(array[d]), '''{}''::bigint[]'))#>>'{}')::uuid;
  e := t_copie(u4, 1);
  msg := t_err(u4, format('hg_card_recycle(%s)', t_arr(array[e, d])));
  perform t_ok(msg like 'Certaines cartes%' and (select recycled_at from hg_card_copies where id = e) is null,
               'carte bloquée sur une offre : refusée, et l''autre carte de la liste n''est pas recyclée non plus');
  perform t_do(u4, format('hg_trade_cancel(%L)', tid));

  -- E. Une carte Identité ne se recycle pas
  i5 := (select id from hg_card_copies where owner_id = u5 and card_id = ident and recycled_at is null order by id limit 1);
  perform t_ok(i5 is not null, 'préparation : le membre 5 possède une carte Identité');
  msg := t_err(u5, format('hg_card_recycle(%s)', t_arr(array[i5])));
  perform t_ok(msg like 'Les cartes Identité ne se recyclent pas%', 'carte Identité : recyclage refusé');

  -- F. Liste vide : rien versé
  r := (t_call(u4, 'hg_card_recycle(''{}''::bigint[])')#>>'{}')::int;
  perform t_ok(r = 0, 'liste vide : aucun versement');

  perform t_bilan_fin();
end $$;
