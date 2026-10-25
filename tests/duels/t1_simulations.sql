-- Simulations : chaque jeu et variante, entre membres et contre le robot, avec et sans absents.
do $$
declare r text; v record; n int := 0;
begin
  for v in select * from (values ('p4','classique'),('p4','grande'),('p4','popout'),('morpion','classique'),('morpion','ultime'),
      ('morpion','gomoku'),('mastermind','duel'),('bataille','classique'),('bataille','salve'),('quiestce','paleto')) x(jeu, var) loop
    for i in 1 .. 4 loop
      r := t_simuler(v.jeu, v.var, (array[1,3,5,3])[i], 1 + (i % 3), 4 + (i % 3), 2, i = 4); n := n + 1;
      if i = 1 then raise notice '%', r; end if;
    end loop;
    for lvl in 1 .. 3 loop
      r := t_simuler(v.jeu, v.var, 1, 2, null, lvl); n := n + 1;
    end loop;
  end loop;
  raise notice 'ok : % duels simulés sans erreur', n;
end $$;
