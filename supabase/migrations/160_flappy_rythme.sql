-- =====================================================================
-- 160 : Flappy Domu accélère désormais sans plafond (vitesse +7 % toutes les 10 s). Sur une très longue partie,
--   la moyenne de points par seconde peut dépasser l'ancien contrôle (2 par seconde) : il passe à 4.
-- =====================================================================
select public.hg__patch('public.hg_arcade_rules(text)'::regprocedure,
$o$when 'flappy'     then '{"max": 100000, "rate": 2, "min_s": 3,  "titre": "Flappy Domu"}'::jsonb$o$,
$n$when 'flappy'     then '{"max": 100000, "rate": 4, "min_s": 3,  "titre": "Flappy Domu"}'::jsonb$n$);
