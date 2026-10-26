-- ===== Humane Gang — migration 141 : nouveaux duels (Dames, Échecs, Othello, Pierre-feuille-ciseaux), en développement =====
-- S'ajoutent au moteur des duels (migration 122) : mêmes parties, manches, tours, robot, Paillettes, journal.
-- Réservés à hg_nj_acces() (admins) : création, défi et entrée dans une partie.
--   dames    : jeu international 10×10 (cases sombres), prise obligatoire et MAJORITAIRE, rafles, dames volantes ;
--              grille de 100 caractères : '.', '1' / '2' pions, 'A' / 'B' dames (de '1' / '2'). '1' monte (vers la ligne 0).
--              Coup : p_action = 'chemin:a,b,c' (cases 0-99, départ compris) ; 25 coups de chaque côté sans prise ni
--              mouvement de pion = nulle.
--   echecs   : grille de 64 caractères, a8 = case 0 ; blancs en majuscules (PNBRQK), noirs en minuscules. Les blancs
--              sont le joueur qui commence la manche. Coup : p_coup = de * 64 + a, p_action = pièce de promotion
--              ('q', 'r', 'b', 'n') ou 'pose'. Roques, prise en passant, promotion, mat, pat, 50 coups, matériel insuffisant.
--              État de la manche : etat.echecs = { blanc, roque, ep, demi }.
--   othello  : 8×8, grille '.', '1', '2' ; '1' = celui qui commence. Coup : case 0-63. Sans coup possible, le tour passe ;
--              personne ne peut jouer = fin, le plus de pions gagne.
--   pfc      : coups simultanés : p_action = 'pierre' | 'feuille' | 'ciseaux'. Une manche = un lancer gagnant
--              (égalité : on relance). Choix cachés jusqu'à ce que les deux aient joué. etat.pfc = { choix, lancers }.
-- Nouvelles fonctions : hg_duel_possibles(p_code) (coups jouables pour l'affichage), moteurs hg_ec__*, hg_dm__*, hg_ot__*.
-- Les fonctions existantes du moteur sont complétées par remplacement de texte (hg__patch), sans recopier leur code.

-- ---------------------------------------------------------------------
-- 0. Outil : remplacement de texte dans une fonction existante (échoue si le texte n'y est pas)
-- ---------------------------------------------------------------------
create or replace function public.hg__patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql set search_path = public as $$
declare d text := pg_get_functiondef(p_fn); motif text;
begin
  -- Les espaces et retours à la ligne ne comptent pas (l'indentation enregistrée peut différer du fichier source).
  motif := regexp_replace(btrim(p_old), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g');
  motif := regexp_replace(motif, '\s+', '\\s+', 'g');
  if not d ~ motif then raise exception 'hg__patch : texte introuvable dans % : %', p_fn, left(p_old, 120); end if;
  execute regexp_replace(d, motif, replace(p_new, '\', '\\'));
end $$;
revoke all on function public.hg__patch(regprocedure, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Tables et réglages
-- ---------------------------------------------------------------------
alter table public.hg_duel_parties drop constraint if exists hg_duel_parties_code_check;
alter table public.hg_duel_parties add constraint hg_duel_parties_code_check check (code ~ '^HG(P4|MO|MM|BN|QE|DA|EC|OT|PF)-[0-9]{4}$');
alter table public.hg_duel_parties drop constraint if exists hg_duel_parties_jeu_check;
alter table public.hg_duel_parties add constraint hg_duel_parties_jeu_check
  check (jeu in ('p4', 'morpion', 'mastermind', 'bataille', 'quiestce', 'dames', 'echecs', 'othello', 'pfc'));

update public.hg_settings set value = jsonb_set(value, '{paillettes}', coalesce(value->'paillettes', '{}'::jsonb)
  || jsonb_build_object('dames', jsonb_build_object('partie', 20, 'victoire', 60), 'echecs', jsonb_build_object('partie', 30, 'victoire', 80),
     'othello', jsonb_build_object('partie', 20, 'victoire', 60), 'pfc', jsonb_build_object('partie', 5, 'victoire', 15)))
  where key = 'duels' and not (value->'paillettes' ? 'echecs');

-- ---------------------------------------------------------------------
-- 2. Othello
-- ---------------------------------------------------------------------
-- Pions retournés si c joue en case i (tableau vide = coup impossible).
create or replace function public.hg_ot__retournes(g text, i int, c text)
returns int[] language plpgsql immutable set search_path = public as $$
declare o text := (case c when '1' then '2' else '1' end); res int[] := '{}'; ligne int[]; dr int; dc int; r int; k int;
  dirs int[] := array[-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1]; d int;
begin
  if substr(g, i + 1, 1) <> '.' then return res; end if;
  for d in 0..7 loop
    dr := dirs[d * 2 + 1]; dc := dirs[d * 2 + 2]; r := i / 8 + dr; k := i % 8 + dc; ligne := '{}';
    while r between 0 and 7 and k between 0 and 7 and substr(g, r * 8 + k + 1, 1) = o loop
      ligne := ligne || (r * 8 + k); r := r + dr; k := k + dc;
    end loop;
    if cardinality(ligne) > 0 and r between 0 and 7 and k between 0 and 7 and substr(g, r * 8 + k + 1, 1) = c then res := res || ligne; end if;
  end loop;
  return res;
end $$;

create or replace function public.hg_ot__coups(g text, c text)
returns int[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(i order by i), '{}') from generate_series(0, 63) i where cardinality(public.hg_ot__retournes(g, i, c)) > 0 $$;

create or replace function public.hg_ot__jouer(g text, i int, c text)
returns text language plpgsql immutable set search_path = public as $$
declare k int;
begin
  g := overlay(g placing c from i + 1 for 1);
  foreach k in array public.hg_ot__retournes(overlay(g placing '.' from i + 1 for 1), i, c) loop g := overlay(g placing c from k + 1 for 1); end loop;
  return g;
end $$;

-- Robot : 1 hasard (préférant les coins), 2 meilleur coup selon une table de valeurs, 3 deux coups d'avance.
create or replace function public.hg_ot__val(g text, c text)
returns int language plpgsql immutable set search_path = public as $$
declare w int[] := array[100,-20,10,5,5,10,-20,100, -20,-50,-2,-2,-2,-2,-50,-20, 10,-2,1,1,1,1,-2,10, 5,-2,1,0,0,1,-2,5,
  5,-2,1,0,0,1,-2,5, 10,-2,1,1,1,1,-2,10, -20,-50,-2,-2,-2,-2,-50,-20, 100,-20,10,5,5,10,-20,100]; s int := 0; i int; x text;
begin
  for i in 0..63 loop
    x := substr(g, i + 1, 1);
    if x = c then s := s + w[i + 1]; elsif x <> '.' then s := s - w[i + 1]; end if;
  end loop;
  return s + 3 * (cardinality(public.hg_ot__coups(g, c)) - cardinality(public.hg_ot__coups(g, (case c when '1' then '2' else '1' end))));
end $$;

create or replace function public.hg_ot__robot(g text, c text, lvl int)
returns int language plpgsql volatile set search_path = public as $$
declare cs int[] := public.hg_ot__coups(g, c); o text := (case c when '1' then '2' else '1' end); m int; m2 int; best int; bv int := -1000000; v int; pire int; g2 text;
begin
  if cardinality(cs) = 0 then return null; end if;
  if lvl <= 1 then
    select x into best from unnest(cs) x order by (x in (0, 7, 56, 63)) desc, random() limit 1;
    return best;
  end if;
  foreach m in array cs loop
    g2 := public.hg_ot__jouer(g, m, c);
    if lvl = 2 then v := public.hg_ot__val(g2, c);
    else
      pire := 1000000;
      foreach m2 in array public.hg_ot__coups(g2, o) loop pire := least(pire, public.hg_ot__val(public.hg_ot__jouer(g2, m2, o), c)); end loop;
      v := case when pire = 1000000 then public.hg_ot__val(g2, c) + 50 else pire end;
    end if;
    v := v + floor(random() * 3)::int;
    if v > bv then bv := v; best := m; end if;
  end loop;
  return best;
end $$;

-- ---------------------------------------------------------------------
-- 3. Dames internationales (10×10)
-- ---------------------------------------------------------------------
create or replace function public.hg_dm__a(g text, i int) returns text language sql immutable as $$ select substr(g, i + 1, 1) $$;
create or replace function public.hg_dm__mien(x text, c text) returns boolean language sql immutable as $$
  select case c when '1' then x in ('1', 'A') else x in ('2', 'B') end $$;
create or replace function public.hg_dm__adv(x text, c text) returns boolean language sql immutable as $$
  select case c when '1' then x in ('2', 'B') else x in ('1', 'A') end $$;

-- Rafles depuis la case sq (la pièce est déjà retirée de g). pris : pièces déjà sautées (restent sur le plateau jusqu'à la fin).
-- Renvoie les chemins 'a,b,c' (départ compris), y compris les rafles partielles ; le tri par longueur se fait ensuite.
create or replace function public.hg_dm__rafles(g text, sq int, c text, roi boolean, pris int[])
returns setof text language plpgsql immutable set search_path = public as $$
declare d int; dr int; dc int; r int; k int; cible int; suite text; n int := 0;
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1];
begin
  for d in 0..3 loop
    dr := dirs[d * 2 + 1]; dc := dirs[d * 2 + 2];
    r := sq / 10 + dr; k := sq % 10 + dc;
    if roi then
      while r between 0 and 9 and k between 0 and 9 and public.hg_dm__a(g, r * 10 + k) = '.' loop r := r + dr; k := k + dc; end loop;
    end if;
    if not (r between 0 and 9 and k between 0 and 9) then continue; end if;
    cible := r * 10 + k;
    if not public.hg_dm__adv(public.hg_dm__a(g, cible), c) or cible = any (pris) then continue; end if;
    r := r + dr; k := k + dc;
    while r between 0 and 9 and k between 0 and 9 and public.hg_dm__a(g, r * 10 + k) = '.' loop
      n := 0;
      for suite in select * from public.hg_dm__rafles(g, r * 10 + k, c, roi, pris || cible) loop
        return next sq || ',' || suite; n := n + 1;
      end loop;
      if n = 0 then return next sq || ',' || (r * 10 + k); end if;
      exit when not roi;
      r := r + dr; k := k + dc;
    end loop;
  end loop;
end $$;

-- Coups légaux de c : prises majoritaires obligatoires, sinon déplacements simples.
create or replace function public.hg_dm__coups(g text, c text)
returns text[] language plpgsql immutable set search_path = public as $$
declare i int; x text; roi boolean; prises text[] := '{}'; simples text[] := '{}'; d int; dr int; dc int; r int; k int; mx int;
  dirs int[] := array[-1,-1, -1,1, 1,-1, 1,1]; avant int := case c when '1' then -1 else 1 end; ch text;
begin
  for i in 0..99 loop
    x := public.hg_dm__a(g, i);
    if not public.hg_dm__mien(x, c) then continue; end if;
    roi := x in ('A', 'B');
    for ch in select * from public.hg_dm__rafles(overlay(g placing '.' from i + 1 for 1), i, c, roi, '{}') loop prises := prises || ch; end loop;
    for d in 0..3 loop
      dr := dirs[d * 2 + 1]; dc := dirs[d * 2 + 2];
      if not roi and dr <> avant then continue; end if;
      r := i / 10 + dr; k := i % 10 + dc;
      while r between 0 and 9 and k between 0 and 9 and public.hg_dm__a(g, r * 10 + k) = '.' loop
        simples := simples || (i || ',' || (r * 10 + k));
        exit when not roi;
        r := r + dr; k := k + dc;
      end loop;
    end loop;
  end loop;
  if cardinality(prises) > 0 then
    select max(cardinality(string_to_array(p, ','))) into mx from unnest(prises) p;
    return array(select distinct p from unnest(prises) p where cardinality(string_to_array(p, ',')) = mx order by p);
  end if;
  return simples;
end $$;

-- Joue un chemin (déjà vérifié) : retire les pièces sautées, promotion en fin de coup.
create or replace function public.hg_dm__jouer(g text, chemin text, c text)
returns jsonb language plpgsql immutable set search_path = public as $$
declare pts int[] := string_to_array(chemin, ',')::int[]; x text := public.hg_dm__a(g, pts[1]); i int; a int; b int; dr int; dc int; r int; k int;
  n int := 0; fin int := pts[cardinality(pts)];
begin
  g := overlay(g placing '.' from pts[1] + 1 for 1);
  for i in 1..cardinality(pts) - 1 loop
    a := pts[i]; b := pts[i + 1];
    dr := sign(b / 10 - a / 10); dc := sign(b % 10 - a % 10);
    r := a / 10 + dr; k := a % 10 + dc;
    while r * 10 + k <> b loop
      if public.hg_dm__adv(public.hg_dm__a(g, r * 10 + k), c) then g := overlay(g placing '.' from r * 10 + k + 1 for 1); n := n + 1; end if;
      r := r + dr; k := k + dc;
    end loop;
  end loop;
  if x = '1' and fin / 10 = 0 then x := 'A'; elsif x = '2' and fin / 10 = 9 then x := 'B'; end if;
  g := overlay(g placing x from fin + 1 for 1);
  return jsonb_build_object('grille', g, 'prises', n, 'pion', public.hg_dm__a(g, fin) in ('1', '2') and n = 0);
end $$;

create or replace function public.hg_dm__val(g text, c text)
returns int language plpgsql immutable set search_path = public as $$
declare s int := 0; i int; x text;
begin
  for i in 0..99 loop
    x := substr(g, i + 1, 1);
    if x = '.' then continue; end if;
    s := s + case when x in ('A', 'B') then 30 else 10 + case when x = '1' then (9 - i / 10) else i / 10 end end
      * case when public.hg_dm__mien(x, c) then 1 else -1 end;
  end loop;
  return s;
end $$;

-- Robot : 1 hasard, 2 meilleur matériel après la réponse adverse, 3 idem avec un coup de plus.
create or replace function public.hg_dm__robot(g text, c text, lvl int)
returns text language plpgsql volatile set search_path = public as $$
declare cs text[] := public.hg_dm__coups(g, c); o text := (case c when '1' then '2' else '1' end); m text; m2 text; m3 text; best text;
  bv int := -1000000; v int; pire int; g2 text; g3 text; mieux int;
begin
  if cardinality(cs) = 0 then return null; end if;
  if lvl <= 1 or cardinality(cs) = 1 then return cs[1 + floor(random() * cardinality(cs))::int]; end if;
  foreach m in array cs loop
    g2 := public.hg_dm__jouer(g, m, c)->>'grille';
    pire := 1000000;
    foreach m2 in array public.hg_dm__coups(g2, o) loop
      g3 := public.hg_dm__jouer(g2, m2, o)->>'grille';
      if lvl >= 3 then
        mieux := -1000000;
        foreach m3 in array public.hg_dm__coups(g3, c) loop mieux := greatest(mieux, public.hg_dm__val(public.hg_dm__jouer(g3, m3, c)->>'grille', c)); end loop;
        if mieux = -1000000 then mieux := -900000; end if;
      else mieux := public.hg_dm__val(g3, c); end if;
      pire := least(pire, mieux);
    end loop;
    v := case when pire = 1000000 then 900000 else pire end + floor(random() * 3)::int;
    if v > bv then bv := v; best := m; end if;
  end loop;
  return best;
end $$;

-- ---------------------------------------------------------------------
-- 4. Échecs
-- ---------------------------------------------------------------------
create or replace function public.hg_ec__camp(x text) returns text language sql immutable as $$
  select case when x = '.' then null when x = upper(x) then 'w' else 'b' end $$;

-- La case sq est-elle attaquée par le camp « par » ?
create or replace function public.hg_ec__attaque(g text, sq int, par text)
returns boolean language plpgsql immutable set search_path = public as $$
declare r int := sq / 8; c int := sq % 8; dr int; dc int; rr int; cc int; x text; d int;
  cav int[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  dirs int[] := array[-1,0, 1,0, 0,-1, 0,1, -1,-1, -1,1, 1,-1, 1,1];
  p text := (case par when 'w' then 'P' else 'p' end); n text := (case par when 'w' then 'N' else 'n' end);
  k text := (case par when 'w' then 'K' else 'k' end); ro text := (case par when 'w' then 'R' else 'r' end);
  fo text := (case par when 'w' then 'B' else 'b' end); da text := (case par when 'w' then 'Q' else 'q' end);
begin
  -- pions : un pion blanc attaque vers le haut (il est donc en dessous de la case)
  rr := r + case par when 'w' then 1 else -1 end;
  if rr between 0 and 7 then
    if c > 0 and substr(g, rr * 8 + c, 1) = p then return true; end if;
    if c < 7 and substr(g, rr * 8 + c + 2, 1) = p then return true; end if;
  end if;
  for d in 0..7 loop
    rr := r + cav[d * 2 + 1]; cc := c + cav[d * 2 + 2];
    if rr between 0 and 7 and cc between 0 and 7 and substr(g, rr * 8 + cc + 1, 1) = n then return true; end if;
  end loop;
  for d in 0..7 loop
    dr := dirs[d * 2 + 1]; dc := dirs[d * 2 + 2]; rr := r + dr; cc := c + dc;
    if rr between 0 and 7 and cc between 0 and 7 and substr(g, rr * 8 + cc + 1, 1) = k then return true; end if;
    while rr between 0 and 7 and cc between 0 and 7 loop
      x := substr(g, rr * 8 + cc + 1, 1);
      if x <> '.' then
        if x = da or (d < 4 and x = ro) or (d >= 4 and x = fo) then return true; end if;
        exit;
      end if;
      rr := rr + dr; cc := cc + dc;
    end loop;
  end loop;
  return false;
end $$;

-- Applique un coup (sans vérification) : prise en passant, roque (déplace la tour), promotion.
create or replace function public.hg_ec__appliquer(g text, de int, a int, promo text, ep int)
returns text language plpgsql immutable set search_path = public as $$
declare x text := substr(g, de + 1, 1);
begin
  g := overlay(g placing '.' from de + 1 for 1);
  if upper(x) = 'P' and a = ep then g := overlay(g placing '.' from (de / 8) * 8 + a % 8 + 1 for 1); end if;
  if upper(x) = 'K' and abs(a - de) = 2 then
    if a > de then g := overlay(overlay(g placing '.' from (de / 8) * 8 + 8 for 1) placing (case x when 'K' then 'R' else 'r' end) from a for 1);
    else g := overlay(overlay(g placing '.' from (de / 8) * 8 + 1 for 1) placing (case x when 'K' then 'R' else 'r' end) from a + 2 for 1); end if;
  end if;
  if upper(x) = 'P' and (a / 8 = 0 or a / 8 = 7) then
    x := case when x = 'P' then upper(coalesce(nullif(promo, ''), 'q')) else lower(coalesce(nullif(promo, ''), 'q')) end;
  end if;
  return overlay(g placing x from a + 1 for 1);
end $$;

-- Coups légaux du camp s (« w » ou « b ») : de, a, promo ('q', 'r', 'b', 'n' pour une promotion, sinon '').
create or replace function public.hg_ec__coups(g text, s text, roque text, ep int)
returns table (de int, a int, promo text) language plpgsql immutable set search_path = public as $$
declare i int; x text; r int; c int; d int; dr int; dc int; rr int; cc int; y text; t int; av int; cand int[]; pr text;
  cav int[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  dirs int[] := array[-1,0, 1,0, 0,-1, 0,1, -1,-1, -1,1, 1,-1, 1,1];
  o text := (case s when 'w' then 'b' else 'w' end); roi int; g2 text; m record;
  pseudo int[] := '{}';
begin
  for i in 0..63 loop
    x := substr(g, i + 1, 1);
    if hg_ec__camp(x) is distinct from s then continue; end if;
    r := i / 8; c := i % 8; cand := '{}';
    if upper(x) = 'P' then
      av := case s when 'w' then -1 else 1 end;
      rr := r + av;
      if rr between 0 and 7 and substr(g, rr * 8 + c + 1, 1) = '.' then
        cand := cand || (rr * 8 + c);
        if ((s = 'w' and r = 6) or (s = 'b' and r = 1)) and substr(g, (rr + av) * 8 + c + 1, 1) = '.' then cand := cand || ((rr + av) * 8 + c); end if;
      end if;
      foreach dc in array array[-1, 1] loop
        cc := c + dc;
        if rr between 0 and 7 and cc between 0 and 7 and (hg_ec__camp(substr(g, rr * 8 + cc + 1, 1)) = o or rr * 8 + cc = ep) then cand := cand || (rr * 8 + cc); end if;
      end loop;
    elsif upper(x) = 'N' then
      for d in 0..7 loop
        rr := r + cav[d * 2 + 1]; cc := c + cav[d * 2 + 2];
        if rr between 0 and 7 and cc between 0 and 7 and hg_ec__camp(substr(g, rr * 8 + cc + 1, 1)) is distinct from s then cand := cand || (rr * 8 + cc); end if;
      end loop;
    else
      for d in 0..7 loop
        if (upper(x) = 'R' and d >= 4) or (upper(x) = 'B' and d < 4) then continue; end if;
        dr := dirs[d * 2 + 1]; dc := dirs[d * 2 + 2]; rr := r + dr; cc := c + dc;
        while rr between 0 and 7 and cc between 0 and 7 loop
          y := substr(g, rr * 8 + cc + 1, 1);
          exit when hg_ec__camp(y) = s;
          cand := cand || (rr * 8 + cc);
          exit when y <> '.' or upper(x) = 'K';
          rr := rr + dr; cc := cc + dc;
        end loop;
      end loop;
      -- roques (le roi n'est pas en échec, ne traverse ni n'arrive sur une case attaquée)
      if upper(x) = 'K' and i = (case s when 'w' then 60 else 4 end) and not hg_ec__attaque(g, i, o) then
        if position(case s when 'w' then 'K' else 'k' end in roque) > 0 and substr(g, i + 2, 2) = '..'
           and substr(g, i + 4, 1) = (case s when 'w' then 'R' else 'r' end)
           and not hg_ec__attaque(g, i + 1, o) and not hg_ec__attaque(g, i + 2, o) then cand := cand || (i + 2); end if;
        if position(case s when 'w' then 'Q' else 'q' end in roque) > 0 and substr(g, i - 2, 3) = '...'
           and substr(g, i - 3, 1) = (case s when 'w' then 'R' else 'r' end)
           and not hg_ec__attaque(g, i - 1, o) and not hg_ec__attaque(g, i - 2, o) then cand := cand || (i - 2); end if;
      end if;
    end if;
    foreach t in array cand loop
      g2 := hg_ec__appliquer(g, i, t, 'q', ep);
      roi := position(case s when 'w' then 'K' else 'k' end in g2) - 1;
      if hg_ec__attaque(g2, roi, o) then continue; end if;
      if upper(x) = 'P' and (t / 8 = 0 or t / 8 = 7) then
        foreach pr in array array['q', 'r', 'b', 'n'] loop de := i; a := t; promo := pr; return next; end loop;
      else
        de := i; a := t; promo := ''; return next;
      end if;
    end loop;
  end loop;
end $$;

-- Nouvel état après un coup : droits de roque, case de prise en passant, compteur des 50 coups.
create or replace function public.hg_ec__suite(g text, de int, a int, roque text, demi int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare x text := substr(g, de + 1, 1); prise boolean := substr(g, a + 1, 1) <> '.';
begin
  if x = 'K' then roque := replace(replace(roque, 'K', ''), 'Q', ''); end if;
  if x = 'k' then roque := replace(replace(roque, 'k', ''), 'q', ''); end if;
  if de = 63 or a = 63 then roque := replace(roque, 'K', ''); end if;
  if de = 56 or a = 56 then roque := replace(roque, 'Q', ''); end if;
  if de = 7 or a = 7 then roque := replace(roque, 'k', ''); end if;
  if de = 0 or a = 0 then roque := replace(roque, 'q', ''); end if;
  return jsonb_build_object('roque', roque,
    'ep', case when upper(x) = 'P' and abs(a - de) = 16 then (a + de) / 2 else -1 end,
    'demi', case when upper(x) = 'P' or prise then 0 else demi + 1 end);
end $$;

-- Matériel insuffisant pour mater (roi seul, ou roi + un fou ou un cavalier, de chaque côté).
create or replace function public.hg_ec__insuffisant(g text)
returns boolean language sql immutable as $$
  select char_length(regexp_replace(g, '[.Kk]', '', 'g')) = 0
      or (char_length(regexp_replace(g, '[.Kk]', '', 'g')) = 1 and regexp_replace(g, '[.Kk]', '', 'g') in ('B', 'b', 'N', 'n')) $$;

-- Évaluation (point de vue du camp s) : matériel et un peu de centralisation.
create or replace function public.hg_ec__val(g text, s text)
returns int language plpgsql immutable set search_path = public as $$
declare v int := 0; i int; x text; p int; centre int[] := array[27, 28, 35, 36];
begin
  for i in 0..63 loop
    x := substr(g, i + 1, 1);
    if x = '.' then continue; end if;
    p := case upper(x) when 'P' then 100 when 'N' then 320 when 'B' then 330 when 'R' then 500 when 'Q' then 900 else 0 end
      + case when i = any (centre) then 15 else 0 end
      + case when upper(x) = 'P' then (case when x = 'P' then 6 - i / 8 else i / 8 - 1 end) * 5 else 0 end;
    v := v + case when hg_ec__camp(x) = s then p else -p end;
  end loop;
  return v;
end $$;

-- Robot : 1 hasard (préfère les prises), 2 meilleur coup après la meilleure réponse (matériel), 3 un coup de plus pour les prises.
create or replace function public.hg_ec__robot(g text, s text, roque text, ep int, lvl int)
returns jsonb language plpgsql volatile set search_path = public as $$
declare m record; m2 record; o text := (case s when 'w' then 'b' else 'w' end); best record; bv int := -10000000; v int; pire int; g2 text; st jsonb; n int;
begin
  if lvl <= 1 then
    select * into best from hg_ec__coups(g, s, roque, ep) c order by (substr(g, c.a + 1, 1) <> '.') desc, random() limit 1;
    if best.de is null then return null; end if;
    return jsonb_build_object('de', best.de, 'a', best.a, 'promo', best.promo);
  end if;
  for m in select * from hg_ec__coups(g, s, roque, ep) loop
    g2 := hg_ec__appliquer(g, m.de, m.a, m.promo, ep);
    st := hg_ec__suite(g, m.de, m.a, roque, 0);
    pire := 10000000; n := 0;
    for m2 in select * from hg_ec__coups(g2, o, st->>'roque', (st->>'ep')::int) loop
      n := n + 1;
      -- niveau 2 : seules les réponses qui prennent comptent (plus rapide) ; niveau 3 : toutes
      if lvl = 2 and substr(g2, m2.a + 1, 1) = '.' then continue; end if;
      pire := least(pire, hg_ec__val(hg_ec__appliquer(g2, m2.de, m2.a, m2.promo, (st->>'ep')::int), s));
    end loop;
    if n = 0 then
      v := case when hg_ec__attaque(g2, position(case o when 'w' then 'K' else 'k' end in g2) - 1, s) then 1000000 else 0 end;
    else v := case when pire = 10000000 then hg_ec__val(g2, s) else pire end; end if;
    v := v + floor(random() * 8)::int;
    if v > bv then bv := v; best := m; end if;
  end loop;
  if best.de is null then return null; end if;
  return jsonb_build_object('de', best.de, 'a', best.a, 'promo', best.promo);
end $$;

-- ---------------------------------------------------------------------
-- 5. Coups des nouveaux duels (appelée par hg_duel__appliquer)
-- ---------------------------------------------------------------------
create or replace function public.hg_duel__grille_depart(p_jeu text, p_variante text, w int, h int)
returns text language plpgsql immutable set search_path = public as $$
declare g text; i int;
begin
  if p_jeu in ('mastermind', 'bataille', 'quiestce', 'pfc') then return ''; end if;
  if p_jeu = 'echecs' then return 'rnbqkbnrpppppppp' || repeat('.', 32) || 'PPPPPPPPRNBQKBNR'; end if;
  g := repeat('.', w * h);
  if p_jeu = 'othello' then
    return overlay(overlay(overlay(overlay(g placing '2' from 28 for 1) placing '1' from 29 for 1) placing '1' from 36 for 1) placing '2' from 37 for 1);
  end if;
  if p_jeu = 'dames' then
    for i in 0..99 loop
      if ((i / 10) + (i % 10)) % 2 = 1 then
        if i / 10 <= 3 then g := overlay(g placing '2' from i + 1 for 1); elsif i / 10 >= 6 then g := overlay(g placing '1' from i + 1 for 1); end if;
      end if;
    end loop;
  end if;
  return g;
end $$;

-- Pion d'un joueur pour Othello et les échecs : celui qui commence la manche a '1' (noirs à Othello, blancs aux échecs).
create or replace function public.hg_duel__pion2(p hg_duel_parties, p_user uuid)
returns text language sql stable set search_path = public as $$
  select case when p.jeu in ('othello', 'echecs') then case when p_user = p.premier then '1' else '2' end
    else public.hg_duel__pion(p.id, p_user) end $$;

create or replace function public.hg_duel__appliquer2(p_id uuid, p_user uuid, p_coup int, p_action text, p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; c text; o text; v_autre uuid; g text; res jsonb; ok boolean; v_texte text; ec jsonb; s text; de int; a int; pr text;
  cs text[]; n1 int; n2 int; nom text; coups_adv int; calme int;
begin
  select * into p from hg_duel_parties where id = p_id for update;
  if p.statut <> 'en_cours' then raise exception 'La partie n''est pas en cours.'; end if;
  v_autre := hg_duel__autre(p_id, p_user); nom := hg_duel__nom(p_id, p_user);

  if p.jeu = 'pfc' then
    if p_action not in ('pierre', 'feuille', 'ciseaux') then raise exception 'Choisis pierre, feuille ou ciseaux.'; end if;
    if p.etat->'pfc'->'choix' ? p_user::text then raise exception 'Tu as déjà choisi pour ce lancer.'; end if;
    p.etat := jsonb_set(p.etat, '{pfc,choix}', coalesce(p.etat->'pfc'->'choix', '{}'::jsonb) || jsonb_build_object(p_user::text, p_action), true);
    update hg_duel_parties set etat = p.etat where id = p_id;
    update hg_duel_joueurs set fin = null, coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
    perform hg_duel__pfc_resoudre(p_id);
    return;
  end if;

  if p.tour is distinct from p_user then raise exception 'Ce n''est pas ton tour.'; end if;
  c := hg_duel__pion2(p, p_user); o := (case c when '1' then '2' else '1' end);

  if p.jeu = 'othello' then
    if p_coup is null or p_coup not between 0 and 63 or cardinality(hg_ot__retournes(p.grille, p_coup, c)) = 0 then
      raise exception 'Coup impossible : il faut encadrer au moins un pion adverse.';
    end if;
    g := hg_ot__jouer(p.grille, p_coup, c);
    v_texte := nom || ' joue en ' || chr(97 + p_coup % 8) || (8 - p_coup / 8) || ' et retourne ' || cardinality(hg_ot__retournes(p.grille, p_coup, c)) || ' pion(s).';
  elsif p.jeu = 'dames' then
    if p_action is null or p_action !~ '^chemin:\d{1,2}(,\d{1,2})+$' then raise exception 'Coup invalide.'; end if;
    cs := hg_dm__coups(p.grille, c);
    if not (substr(p_action, 8) = any (cs)) then
      if exists (select 1 from unnest(cs) x where cardinality(string_to_array(x, ',')) > 2
                 or abs(split_part(x, ',', 1)::int / 10 - split_part(x, ',', 2)::int / 10) > 1) and not (substr(p_action, 8) = any (cs)) then
        raise exception 'Coup impossible : la prise est obligatoire, et il faut prendre le plus de pièces possible.';
      end if;
      raise exception 'Coup impossible.';
    end if;
    res := hg_dm__jouer(p.grille, substr(p_action, 8), c);
    g := res->>'grille';
    calme := case when (res->>'prises')::int > 0 or (res->>'pion')::boolean then 0 else coalesce((p.etat->'dames'->>'calme')::int, 0) + 1 end;
    update hg_duel_parties set etat = jsonb_set(etat, '{dames}', jsonb_build_object('calme', calme), true) where id = p_id;
    v_texte := nom || case when (res->>'prises')::int > 0 then ' prend ' || (res->>'prises') || ' pièce' || case when (res->>'prises')::int > 1 then 's' else '' end || '.'
      else ' avance.' end;
  else -- echecs
    ec := coalesce(p.etat->'echecs', '{}'::jsonb);
    s := (case c when '1' then 'w' else 'b' end);
    if p_coup is null then raise exception 'Coup invalide.'; end if;
    de := p_coup / 64; a := p_coup % 64; pr := case when p_action in ('q', 'r', 'b', 'n') then p_action else '' end;
    if not exists (select 1 from hg_ec__coups(p.grille, s, coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1)) m
                   where m.de = de and m.a = a and (m.promo = pr or (m.promo = 'q' and pr = ''))) then
      raise exception 'Coup impossible.';
    end if;
    if pr = '' and upper(substr(p.grille, de + 1, 1)) = 'P' and (a / 8 = 0 or a / 8 = 7) then pr := 'q'; end if;
    g := hg_ec__appliquer(p.grille, de, a, pr, coalesce((ec->>'ep')::int, -1));
    ec := ec || hg_ec__suite(p.grille, de, a, coalesce(ec->>'roque', ''), coalesce((ec->>'demi')::int, 0));
    update hg_duel_parties set etat = jsonb_set(etat, '{echecs}', ec, true) where id = p_id;
    v_texte := nom || ' joue ' || chr(97 + de % 8) || (8 - de / 8) || '-' || chr(97 + a % 8) || (8 - a / 8)
      || case when pr <> '' then ' (promotion)' else '' end || '.';
  end if;

  update hg_duel_parties set grille = g, nb_coups = nb_coups + 1,
    dernier = jsonb_build_object('user_id', p_user, 'case', p_coup, 'action', coalesce(p_action, 'pose')) where id = p_id;
  update hg_duel_joueurs set coups = coups + 1, manques = case when p_auto then manques else 0 end where partie = p_id and user_id = p_user;
  perform hg_duel__log(p_id, p_user, 'coup', v_texte);
  select * into p from hg_duel_parties where id = p_id;

  -- Fin de manche ?
  if p.jeu = 'othello' then
    if cardinality(hg_ot__coups(g, o)) > 0 then perform hg_duel__donner_tour(p_id, v_autre); return; end if;
    if cardinality(hg_ot__coups(g, c)) > 0 then
      perform hg_duel__log(p_id, v_autre, 'info', hg_duel__nom(p_id, v_autre) || ' ne peut pas jouer : il passe son tour.');
      perform hg_duel__donner_tour(p_id, p_user); return;
    end if;
    n1 := char_length(g) - char_length(replace(g, c, '')); n2 := char_length(g) - char_length(replace(g, o, ''));
    perform hg_duel__log(p_id, null, 'info', 'Plus aucun coup possible : ' || n1 || ' pions contre ' || n2 || '.');
    perform hg_duel__fin_manche(p_id, case when n1 > n2 then p_user when n2 > n1 then v_autre end);
  elsif p.jeu = 'dames' then
    if cardinality(hg_dm__coups(g, o)) = 0 then perform hg_duel__fin_manche(p_id, p_user); return; end if;
    if coalesce((p.etat->'dames'->>'calme')::int, 0) >= 50 then
      perform hg_duel__log(p_id, null, 'info', '25 coups de chaque côté sans prise ni mouvement de pion : partie nulle.');
      perform hg_duel__fin_manche(p_id, null); return;
    end if;
    perform hg_duel__donner_tour(p_id, v_autre);
  else
    s := (case o when '1' then 'w' else 'b' end);
    ec := p.etat->'echecs';
    select count(*) into coups_adv from hg_ec__coups(g, s, coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1));
    if coups_adv = 0 then
      if hg_ec__attaque(g, position(case s when 'w' then 'K' else 'k' end in g) - 1, (case s when 'w' then 'b' else 'w' end)) then
        perform hg_duel__log(p_id, p_user, 'info', 'Échec et mat !');
        perform hg_duel__fin_manche(p_id, p_user);
      else
        perform hg_duel__log(p_id, null, 'info', 'Pat : partie nulle.');
        perform hg_duel__fin_manche(p_id, null);
      end if;
      return;
    end if;
    if coalesce((ec->>'demi')::int, 0) >= 100 or hg_ec__insuffisant(g) then
      perform hg_duel__log(p_id, null, 'info', case when hg_ec__insuffisant(g) then 'Matériel insuffisant pour mater : partie nulle.' else 'Règle des 50 coups : partie nulle.' end);
      perform hg_duel__fin_manche(p_id, null); return;
    end if;
    if hg_ec__attaque(g, position(case s when 'w' then 'K' else 'k' end in g) - 1, (case s when 'w' then 'b' else 'w' end)) then
      perform hg_duel__log(p_id, v_autre, 'info', 'Échec !');
    end if;
    perform hg_duel__donner_tour(p_id, v_autre);
  end if;
end $$;

-- Pierre-feuille-ciseaux : quand les deux ont choisi, le lancer est révélé.
create or replace function public.hg_duel__pfc_resoudre(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; a record; b record; ca text; cb text; g uuid; lancer jsonb;
  nom text := 'pierre'; bat jsonb := '{"pierre": "ciseaux", "feuille": "pierre", "ciseaux": "feuille"}';
begin
  select * into p from hg_duel_parties where id = p_id for update;
  select * into a from hg_duel_joueurs where partie = p_id and place = 1;
  select * into b from hg_duel_joueurs where partie = p_id and place = 2;
  ca := p.etat->'pfc'->'choix'->>a.user_id::text; cb := p.etat->'pfc'->'choix'->>b.user_id::text;
  if ca is null or cb is null then return; end if;
  g := case when ca = cb then null when bat->>ca = cb then a.user_id else b.user_id end;
  lancer := jsonb_build_object('manche', p.manche, a.user_id::text, ca, b.user_id::text, cb, 'gagnant', g);
  update hg_duel_parties set etat = jsonb_set(jsonb_set(etat, '{pfc,choix}', '{}'::jsonb), '{pfc,lancers}',
      coalesce(etat->'pfc'->'lancers', '[]'::jsonb) || lancer), nb_coups = nb_coups + 1 where id = p_id;
  perform hg_duel__log(p_id, g, 'coup', a.pseudo || ' : ' || ca || ' · ' || b.pseudo || ' : ' || cb || ' → '
    || case when g is null then 'égalité, on relance !' else hg_duel__nom(p_id, g) || ' gagne le lancer.' end);
  if g is null then perform hg_duel__pfc_lancer(p_id); return; end if;
  perform hg_duel__fin_manche(p_id, g);
end $$;

-- Nouveau lancer : échéance pour chacun, le robot choisit tout de suite.
create or replace function public.hg_duel__pfc_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; r record; choix text; adv uuid; freq text;
begin
  select * into p from hg_duel_parties where id = p_id;
  update hg_duel_joueurs set fin = case when robot then null else now() + make_interval(secs => p.t_coup) end where partie = p_id;
  for r in select user_id from hg_duel_joueurs where partie = p_id and robot loop
    adv := hg_duel__autre(p_id, r.user_id);
    -- niveau 3 : joue ce qui bat le choix le plus fréquent de l'adversaire ; sinon au hasard
    if p.robot >= 3 then
      select x into freq from (select l->>adv::text x from jsonb_array_elements(coalesce(p.etat->'pfc'->'lancers', '[]'::jsonb)) l) z
        where x is not null group by x order by count(*) desc, random() limit 1;
    end if;
    choix := case when freq is not null and random() < 0.7 then case freq when 'pierre' then 'feuille' when 'feuille' then 'ciseaux' else 'pierre' end
      else (array['pierre', 'feuille', 'ciseaux'])[1 + floor(random() * 3)::int] end;
    update hg_duel_parties set etat = jsonb_set(etat, '{pfc,choix}', coalesce(etat->'pfc'->'choix', '{}'::jsonb) || jsonb_build_object(r.user_id::text, choix), true)
      where id = p_id;
  end loop;
end $$;

-- Coup du robot (ou du jeu pour un absent) pour les nouveaux duels.
create or replace function public.hg_duel__robot2(p_id uuid, p_user uuid, lvl int, p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_duel_parties; c text; m jsonb; ec jsonb; k int; ch text;
begin
  select * into p from hg_duel_parties where id = p_id;
  c := hg_duel__pion2(p, p_user);
  if p.jeu = 'othello' then
    k := hg_ot__robot(p.grille, c, lvl);
    if k is null then return; end if;
    perform hg_duel__appliquer2(p_id, p_user, k, 'pose', p_auto);
  elsif p.jeu = 'dames' then
    ch := hg_dm__robot(p.grille, c, lvl);
    if ch is null then return; end if;
    perform hg_duel__appliquer2(p_id, p_user, split_part(ch, ',', 1)::int, 'chemin:' || ch, p_auto);
  elsif p.jeu = 'echecs' then
    ec := coalesce(p.etat->'echecs', '{}'::jsonb);
    m := hg_ec__robot(p.grille, (case c when '1' then 'w' else 'b' end), coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1), lvl);
    if m is null then return; end if;
    perform hg_duel__appliquer2(p_id, p_user, (m->>'de')::int * 64 + (m->>'a')::int, coalesce(nullif(m->>'promo', ''), 'pose'), p_auto);
  elsif p.jeu = 'pfc' then
    perform hg_duel__appliquer2(p_id, p_user, 0, (array['pierre', 'feuille', 'ciseaux'])[1 + floor(random() * 3)::int], p_auto);
  end if;
end $$;

-- Coups jouables par le membre connecté (affichage) : othello [cases], dames [chemins], echecs [{de, a, promo}].
create or replace function public.hg_duel_possibles(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_duel_parties; c text; ec jsonb;
begin
  p := hg_duel__partie(p_code);
  if not hg_duel_dans(p.id) or p.statut <> 'en_cours' or p.tour is distinct from auth.uid() then return '[]'::jsonb; end if;
  c := hg_duel__pion2(p, auth.uid());
  if p.jeu = 'othello' then return to_jsonb(hg_ot__coups(p.grille, c)); end if;
  if p.jeu = 'dames' then return to_jsonb(hg_dm__coups(p.grille, c)); end if;
  if p.jeu = 'echecs' then
    ec := coalesce(p.etat->'echecs', '{}'::jsonb);
    return coalesce((select jsonb_agg(jsonb_build_object('de', m.de, 'a', m.a, 'promo', m.promo))
      from hg_ec__coups(p.grille, (case c when '1' then 'w' else 'b' end), coalesce(ec->>'roque', ''), coalesce((ec->>'ep')::int, -1)) m), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
revoke all on function public.hg_duel_possibles(text) from public, anon;
grant execute on function public.hg_duel_possibles(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Raccordement au moteur existant (remplacements de texte)
-- ---------------------------------------------------------------------
select public.hg__patch('public.hg_duel__jeu_nom(text, text)'::regprocedure,
  $o$when 'quiestce' then 'Qui est-ce ?'$o$,
  $n$when 'quiestce' then 'Qui est-ce ?' when 'dames' then 'Dames' when 'echecs' then 'Échecs' when 'othello' then 'Othello' when 'pfc' then 'Pierre-feuille-ciseaux'$n$);

select public.hg__patch('public.hg_duel__code(text)'::regprocedure,
  $o$when 'quiestce' then 'HGQE-'$o$,
  $n$when 'quiestce' then 'HGQE-' when 'dames' then 'HGDA-' when 'echecs' then 'HGEC-' when 'othello' then 'HGOT-' when 'pfc' then 'HGPF-'$n$);

select public.hg__patch('public.hg_duel__dims(text, text)'::regprocedure,
  $o$  select case when p_jeu = 'p4' then case when p_variante = 'grande' then 9 else 7 end when p_jeu = 'bataille' then 10$o$,
  $n$  select case when p_jeu = 'p4' then case when p_variante = 'grande' then 9 else 7 end when p_jeu in ('bataille', 'dames') then 10
              when p_jeu in ('echecs', 'othello') then 8 when p_jeu = 'pfc' then 0$n$);
select public.hg__patch('public.hg_duel__dims(text, text)'::regprocedure,
  $o$         case when p_jeu = 'p4' then case when p_variante = 'grande' then 7 else 6 end when p_jeu = 'bataille' then 10$o$,
  $n$         case when p_jeu = 'p4' then case when p_variante = 'grande' then 7 else 6 end when p_jeu in ('bataille', 'dames') then 10
              when p_jeu in ('echecs', 'othello') then 8 when p_jeu = 'pfc' then 0$n$);

-- Création : nouveaux jeux (admins), variantes, temps par coup.
select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$  if v_jeu not in ('p4', 'morpion', 'mastermind', 'bataille', 'quiestce') then raise exception 'Jeu inconnu.'; end if;$o$,
  $n$  if v_jeu not in ('p4', 'morpion', 'mastermind', 'bataille', 'quiestce', 'dames', 'echecs', 'othello', 'pfc') then raise exception 'Jeu inconnu.'; end if;
  if v_jeu in ('dames', 'echecs', 'othello', 'pfc') and not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;$n$);
select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$    when 'bataille' then 'classique' when 'quiestce' then 'quartier' else 'duel' end);$o$,
  $n$    when 'bataille' then 'classique' when 'quiestce' then 'quartier' when 'dames' then 'internationales'
    when 'echecs' then 'classique' when 'othello' then 'classique' when 'pfc' then 'classique' else 'duel' end);
  if v_jeu in ('dames', 'echecs', 'othello', 'pfc') and v_var <> (case v_jeu when 'dames' then 'internationales' else 'classique' end) then raise exception 'Variante inconnue.'; end if;$n$);
select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$     or (v_jeu = 'quiestce' and not exists$o$,
  $n$     or (v_jeu = 'quiestce' and v_jeu not in ('dames', 'echecs', 'othello', 'pfc') and not exists$n$);
select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$  if (v_jeu in ('mastermind', 'quiestce') and v_t not in (60, 90, 120)) or (v_jeu not in ('mastermind', 'quiestce') and v_t not in (15, 30, 60)) then$o$,
  $n$  if v_jeu in ('echecs', 'dames') and v_t not in (30, 60, 90, 120) then raise exception 'Temps par coup invalide.'; end if;
  if v_jeu not in ('echecs', 'dames') and ((v_jeu in ('mastermind', 'quiestce') and v_t not in (60, 90, 120)) or (v_jeu not in ('mastermind', 'quiestce') and v_t not in (15, 30, 60))) then$n$);
select public.hg__patch('public.hg_duel_creer(jsonb)'::regprocedure,
  $o$    if not exists (select 1 from hg_profiles where id = v_membre and not is_ghost) or not hg_page_ok(v_membre, 'duels') then$o$,
  $n$    if v_jeu in ('dames', 'echecs', 'othello', 'pfc') and not exists (select 1 from hg_profiles where id = v_membre and is_admin) then
      raise exception 'Ce jeu est encore en développement : seuls les admins peuvent y jouer.';
    end if;
    if not exists (select 1 from hg_profiles where id = v_membre and not is_ghost) or not hg_page_ok(v_membre, 'duels') then$n$);

-- Rejoindre un nouveau duel : admins seulement pendant le développement.
select public.hg__patch('public.hg_duel_rejoindre(text)'::regprocedure,
  $o$begin$o$,
  $n$begin
  if exists (select 1 from hg_duel_parties x where x.code = upper(btrim(p_code)) and x.jeu in ('dames', 'echecs', 'othello', 'pfc') and x.statut = 'attente')
     and not hg_nj_acces() then
    raise exception 'Jeu en développement : réservé aux admins pour l''instant.';
  end if;$n$);

-- Nouvelle manche : grille de départ, état des échecs, lancer de pierre-feuille-ciseaux.
select public.hg__patch('public.hg_duel__nouvelle_manche(uuid)'::regprocedure,
  $o$    grille = case when p.jeu in ('mastermind', 'bataille', 'quiestce') then '' else repeat('.', dm.w * dm.h) end, restant = null,$o$,
  $n$    grille = hg_duel__grille_depart(p.jeu, p.variante, dm.w, dm.h), restant = null,$n$);
select public.hg__patch('public.hg_duel__nouvelle_manche(uuid)'::regprocedure,
  $o$  else
    perform hg_duel__donner_tour(p_id, v_premier);
    perform hg_duel__log(p_id, v_premier, 'info', 'Manche ' || p.manche || ' : ' || hg_duel__nom(p_id, v_premier) || ' commence.');
  end if;$o$,
  $n$  elsif p.jeu = 'pfc' then
    update hg_duel_parties set etat = jsonb_set(etat, '{pfc}', jsonb_build_object('choix', '{}'::jsonb,
      'lancers', coalesce(etat->'pfc'->'lancers', '[]'::jsonb)), true) where id = p_id;
    perform hg_duel__pfc_lancer(p_id);
    perform hg_duel__log(p_id, null, 'info', 'Manche ' || p.manche || ' : choisissez pierre, feuille ou ciseaux !');
  else
    if p.jeu = 'echecs' then
      update hg_duel_parties set etat = jsonb_set(etat, '{echecs}', jsonb_build_object('blanc', v_premier, 'roque', 'KQkq', 'ep', -1, 'demi', 0), true) where id = p_id;
    elsif p.jeu = 'dames' then
      update hg_duel_parties set etat = jsonb_set(etat, '{dames}', jsonb_build_object('calme', 0), true) where id = p_id;
    end if;
    perform hg_duel__donner_tour(p_id, v_premier);
    perform hg_duel__log(p_id, v_premier, 'info', 'Manche ' || p.manche || ' : ' || hg_duel__nom(p_id, v_premier) || ' commence'
      || case p.jeu when 'echecs' then ' avec les blancs.' when 'othello' then ' avec les noirs.' else '.' end);
  end if;$n$);

-- Coups : les nouveaux jeux passent par hg_duel__appliquer2.
select public.hg__patch('public.hg_duel__appliquer(uuid, uuid, integer, text, boolean)'::regprocedure,
  $o$  select * into p from hg_duel_parties where id = p_id for update;$o$,
  $n$  select * into p from hg_duel_parties where id = p_id for update;
  if p.jeu in ('dames', 'echecs', 'othello', 'pfc') then perform hg_duel__appliquer2(p_id, p_user, p_coup, p_action, p_auto); return; end if;$n$);

-- Robot et absents.
select public.hg__patch('public.hg_duel__robot_suite(uuid)'::regprocedure,
  $o$    if p.jeu = 'bataille' then$o$,
  $n$    if p.jeu in ('dames', 'echecs', 'othello') then perform hg_duel__robot2(p_id, p.tour, p.robot);
    elsif p.jeu = 'bataille' then$n$);
select public.hg__patch('public.hg_duel__echeances(uuid)'::regprocedure,
  $o$    elsif p.jeu <> 'mastermind' then$o$,
  $n$    elsif p.jeu = 'pfc' then
      select * into j from hg_duel_joueurs where partie = p_id and not robot and fin is not null and fin <= now() order by fin limit 1;
      exit when not found;
      update hg_duel_joueurs set manques = manques + 1 where partie = p_id and user_id = j.user_id returning manques into v_m;
      if v_m >= 3 then perform hg_duel__forfait(p_id, j.user_id); n := n + 1; exit; end if;
      perform hg_duel__log(p_id, j.user_id, 'auto', 'Temps écoulé : le jeu choisit au hasard pour ' || hg_duel__nom(p_id, j.user_id) || '.');
      perform hg_duel__robot2(p_id, j.user_id, 1, true);
    elsif p.jeu <> 'mastermind' then$n$);
select public.hg__patch('public.hg_duel__echeances(uuid)'::regprocedure,
  $o$      else perform hg_duel__appliquer(p_id, p.tour, hg_duel__coup_robot(p, p.tour, 2), 'pose', true); end if;$o$,
  $n$      elsif p.jeu in ('dames', 'echecs', 'othello') then perform hg_duel__robot2(p_id, p.tour, 1, true);
      else perform hg_duel__appliquer(p_id, p.tour, hg_duel__coup_robot(p, p.tour, 2), 'pose', true); end if;$n$);

-- État : pierre-feuille-ciseaux (choix cachés), échecs (droits de roque, prise en passant, couleur), pions par joueur.
select public.hg__patch('public.hg_duel_etat(text)'::regprocedure,
  $o$    'quiestce', v_qec,$o$,
  $n$    'quiestce', v_qec,
    'pfc', case when p.jeu = 'pfc' then jsonb_build_object(
      'mon_choix', case when v_joue then p.etat->'pfc'->'choix'->>v_moi::text end,
      'a_choisi', coalesce((select jsonb_object_agg(k, true) from jsonb_object_keys(coalesce(p.etat->'pfc'->'choix', '{}'::jsonb)) k), '{}'::jsonb),
      'lancers', coalesce(p.etat->'pfc'->'lancers', '[]'::jsonb)) end,
    'echecs', case when p.jeu = 'echecs' then p.etat->'echecs' end,
    'pions', case when p.jeu in ('othello', 'echecs', 'dames') then coalesce((select jsonb_object_agg(j.user_id, hg_duel__pion2(p, j.user_id))
      from hg_duel_joueurs j where j.partie = p.id), '{}'::jsonb) end,$n$);

-- Réponses admin des duels : rien de caché aux dames, échecs, othello ; pfc : choix en attente.
grant execute on function public.hg_duel__grille_depart(text, text, int, int) to authenticated;
revoke all on function public.hg_duel__appliquer2(uuid, uuid, int, text, boolean), public.hg_duel__robot2(uuid, uuid, int, boolean),
  public.hg_duel__pfc_resoudre(uuid), public.hg_duel__pfc_lancer(uuid) from public, anon, authenticated;
