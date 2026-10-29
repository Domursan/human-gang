-- ===== Humane Gang — migration 175 : échecs, nulle par triple répétition =====
-- Chaque coup d'échecs retient la position obtenue (pièces, camp qui vient de jouer, droits de roque, prise en passant)
-- dans etat.echecs.pos. La liste repart de zéro après un coup de pion ou une prise (la position d'avant ne peut plus
-- revenir). Quand la même position apparaît pour la troisième fois, la manche est nulle.
-- Rejouable : les remplacements ne sont faits que si la fonction ne les contient pas encore.

do $m$
begin
  if pg_get_functiondef('public.hg_duel__appliquer2(uuid, uuid, integer, text, boolean)'::regprocedure) !~ 'trois fois' then
    perform public.hg__patch('public.hg_duel__appliquer2(uuid, uuid, integer, text, boolean)'::regprocedure,
      $o$    ec := ec || hg_ec__suite(p.grille, v_de, v_a, coalesce(ec->>'roque', ''), coalesce((ec->>'demi')::int, 0));$o$,
      $n$    ec := ec || hg_ec__suite(p.grille, v_de, v_a, coalesce(ec->>'roque', ''), coalesce((ec->>'demi')::int, 0));
    ec := ec || jsonb_build_object('pos',
      (case when coalesce((ec->>'demi')::int, 0) = 0 then '[]'::jsonb else coalesce(ec->'pos', '[]'::jsonb) end)
      || to_jsonb(md5(g || s || coalesce(ec->>'roque', '') || coalesce(ec->>'ep', '-1'))));$n$);
    perform public.hg__patch('public.hg_duel__appliquer2(uuid, uuid, integer, text, boolean)'::regprocedure,
      $o$    if coalesce((ec->>'demi')::int, 0) >= 100 or hg_ec__insuffisant(g) then$o$,
      $n$    if (select count(*) from jsonb_array_elements_text(coalesce(ec->'pos', '[]'::jsonb)) x
        where x = md5(g || (case c when '1' then 'w' else 'b' end) || coalesce(ec->>'roque', '') || coalesce(ec->>'ep', '-1'))) >= 3 then
      perform hg_duel__log(p_id, null, 'info', 'Même position trois fois : partie nulle.');
      perform hg_duel__fin_manche(p_id, null); return;
    end if;
    if coalesce((ec->>'demi')::int, 0) >= 100 or hg_ec__insuffisant(g) then$n$);
  end if;
end $m$;
