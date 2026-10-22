-- ===== 068 : questions du gang — choix « Vrai / Faux » manquants, « et » = « & » =====
-- Idempotent.
-- 1. Les questions vrai_faux importées en masse (sans passer par hg_quiz_save) n'avaient pas leurs deux choix :
--    la carte n'affichait aucun bouton. On remet [{vrai}, {faux}] partout où ils manquent.
-- 2. hg_quiz_norm : « & » est lu comme « et » (« Pâté & saucisse » = « Pâté et saucisse »).
--    La fonction sert aussi au regroupement des réponses dans les statistiques : même effet, voulu.

update public.hg_quiz_questions
   set options = '[{"id":"vrai","text":"Vrai"},{"id":"faux","text":"Faux"}]'::jsonb
 where qtype = 'vrai_faux' and (options is null or options = '[]'::jsonb);

create or replace function public.hg_quiz_norm(p text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select btrim(regexp_replace(regexp_replace(
    translate(replace(lower(coalesce(p, '')), '&', ' et '),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'),
    '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$function$;
