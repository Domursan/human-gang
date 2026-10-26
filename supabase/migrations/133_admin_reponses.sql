-- Réponses des jeux pour les administrateurs : un point d'entrée unique, des fonctions par jeu (hg_adrep_<jeu>).
-- Le front (core/admin-reponses.js) appelle hg_admin_reponses(p_jeu, p_ref) au clic sur le bouton « Réponses ».
-- Format renvoyé : { titre, note?, sections: [{ titre, lignes?: [{ label, valeur, ton? }], liste?: [texte], grille?: [[texte]] }] }
-- Les fonctions par jeu ne sont pas appelables directement (droits retirés) : seul ce point d'entrée, réservé aux
-- administrateurs, les appelle. Chaque consultation est notée dans hg_admin_log (action « jeux.reponses »).
create or replace function public.hg_admin_reponses(p_jeu text, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare fn text; r jsonb;
begin
  if not coalesce(public.hg_is_admin(), false) then raise exception 'Réservé aux administrateurs'; end if;
  if p_jeu is null or p_jeu !~ '^[a-z0-9]{2,24}$' then raise exception 'Jeu inconnu'; end if;
  fn := 'hg_adrep_' || p_jeu;
  if to_regprocedure('public.' || fn || '(text)') is null then raise exception 'Jeu inconnu : %', p_jeu; end if;
  execute format('select public.%I($1)', fn) into r using p_ref;
  insert into public.hg_admin_log(admin_id, action, target_ref, details)
    values (auth.uid(), 'jeux.reponses', p_jeu, jsonb_build_object('ref', p_ref));
  return coalesce(r, jsonb_build_object('titre', 'Réponses', 'sections', '[]'::jsonb));
end $$;
revoke all on function public.hg_admin_reponses(text, text) from public, anon;
grant execute on function public.hg_admin_reponses(text, text) to authenticated;
