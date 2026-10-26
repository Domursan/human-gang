-- ===== Humane Gang — migration 151 : Blackjack, le journal détaille le jeu de la banque =====
-- Avant : « La banque a 22 : elle saute ! » sans les cartes (la carte cachée et les tirages n'apparaissaient nulle part).
-- Maintenant : « La banque retourne 2 ♥ (12), tire 10 ♣ : 22, elle saute ! ».
select public.hg__patch('public.hg_bj__banque(uuid)'::regprocedure,
  $o$declare b jsonb; t record; c text; n int := 0;$o$,
  $n$declare b jsonb; t record; c text; n int := 0; v_msg text;$n$);

select public.hg__patch('public.hg_bj__banque(uuid)'::regprocedure,
  $o$  perform hg_plat__log(p_id, null, 'info', 'La banque a ' || t.total || case when t.total > 21 then ' : elle saute !' else '.' end);$o$,
  $n$  v_msg := 'La banque retourne ' || hg_cartes__nom(b->>1);
  if jsonb_array_length(b) > 2 then
    v_msg := v_msg || ' (' || (hg_bj__total(jsonb_build_array(b->0, b->1))).total || '), tire '
      || (select string_agg(hg_cartes__nom(b->>i), ', ' order by i) from generate_series(2, jsonb_array_length(b) - 1) i);
  end if;
  perform hg_plat__log(p_id, null, 'info', v_msg || ' : ' || t.total || case when t.total > 21 then ', elle saute !' else '.' end);$n$);
