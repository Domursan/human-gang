-- 165 : referme les fonctions internes des plateaux ajoutées par les migrations 143 à 145.
-- Ces migrations n'avaient pas relancé hg_plat__droits() : hg_plat__poker_vue, hg_plat__blackjack_vue, hg_plat__catan_vue et
-- hg_plat__pictionary_vue (security definer, paramètre p_moi libre) restaient exécutables par tout compte connecté et même
-- anonyme, ce qui permettait de lire la main ou le mot d'un autre joueur. Les fonctions publiques hg_plat_* gardent leurs droits.
select public.hg_plat__droits();
