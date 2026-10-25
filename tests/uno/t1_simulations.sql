-- Parties complètes jouées par le pilote : 2 à 20 joueurs, chaque variante, partie en points, absents.
do $$
declare n int; v jsonb; r text; cfg jsonb;
begin
  for n in 2..20 loop
    foreach v in array array['{}'::jsonb, '{"cumul":true}', '{"pioche_jusqu":true,"interception":true}', '{"sept_zero":true}',
                              '{"cumul":true,"pioche_jusqu":true,"sept_zero":true,"interception":true}'] loop
      r := t_simuler(n, v);
      raise notice 'ok : simu % %', v, r;
    end loop;
  end loop;
  foreach n in array array[2, 3, 6, 12] loop
    r := t_simuler(n, '{"cumul":true,"sept_zero":true}', 'points');
    raise notice 'ok : simu points %', r;
  end loop;
  foreach n in array array[2, 5, 9, 15, 20] loop
    r := t_simuler(n, '{"cumul":true,"interception":true}', 'manche', true);
    raise notice 'ok : simu absents %', r;
  end loop;
end $$;
