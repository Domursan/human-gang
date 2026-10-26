-- Réponses des jeux du jour pour les administrateurs (bouton « Réponses » de chaque onglet de la page Jeux).
-- Une fonction par jeu, appelée seulement par hg_admin_reponses (migration 133), qui contrôle le compte admin.
-- Aucune écriture ici : lecture seule. Les manches / questions qui n'existent pas encore ne sont pas créées
-- (sauf le mot du jour du Sutom et la question du jour, qui sont tirés par les RPC existantes au premier affichage).

-- Sutom : mot du jour et sa définition (reprend hg_sutom_solution, migration 109, sans le contrôle de droits).
create or replace function public.hg_adrep_sutom(p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare w hg_sutom_words; v_jour date := hg_sutom_day();
begin
  w := hg_sutom_ensure(v_jour);
  if w.word is null then
    return jsonb_build_object('titre', 'Sutom : réponses', 'note', 'Pas de grille aujourd’hui : aucun mot programmé et la banque est vide.', 'sections', '[]'::jsonb);
  end if;
  return jsonb_build_object('titre', 'Sutom : réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Mot du jour', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Mot', 'valeur', w.word, 'ton', 'ok'),
      jsonb_build_object('label', 'Définition', 'valeur', coalesce(w.definition, '—')),
      jsonb_build_object('label', 'Jour', 'valeur', to_char(v_jour, 'DD.MM.YYYY'))))));
end $$;
revoke all on function public.hg_adrep_sutom(text) from public, anon, authenticated;

-- GeoGuessr : lieu réel de la manche du jour (coordonnées, nom d'origine, sortie d'origine si elle existe).
-- Lit la manche sans la réserver : si aucune n'est programmée pour aujourd'hui, la note le dit.
create or replace function public.hg_adrep_geo(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare r hg_geo_rounds; v_sortie text; v_date timestamptz; v_evt uuid;
begin
  select * into r from hg_geo_rounds where day = hg_geo_day() and active;
  if not found then
    return jsonb_build_object('titre', 'GeoGuessr : réponses', 'note', 'Pas de manche programmée pour aujourd’hui.', 'sections', '[]'::jsonb);
  end if;
  select e.title, e.starts_at, e.id into v_sortie, v_date, v_evt from hg_events e where e.id = r.event_id;
  return jsonb_build_object('titre', 'GeoGuessr : réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Vrai lieu', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Lieu', 'valeur', r.label, 'ton', 'ok'),
      jsonb_build_object('label', 'Coordonnées', 'valeur', round(r.lat::numeric, 5)::text || ', ' || round(r.lon::numeric, 5)::text),
      jsonb_build_object('label', 'Manche', 'valeur', 'n°' || hg_geo_number(r.day)::text || ' · ' || to_char(r.day, 'DD.MM.YYYY')),
      jsonb_build_object('label', 'Sortie d’origine', 'valeur', case when v_evt is null then '—'
        else coalesce(v_sortie, '—') || coalesce(' (' || to_char(v_date at time zone 'Europe/Zurich', 'DD.MM.YYYY') || ')', '') end)))));
end $$;
revoke all on function public.hg_adrep_geo(text) from public, anon, authenticated;

-- Qui a dit ça ? : auteur de la citation affichée (p_ref = identifiant de la question, hg_quiz_questions).
create or replace function public.hg_adrep_citations(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare q hg_quiz_questions; k jsonb; v_bonne text; v_uid text; v_txt text; v_nom text;
begin
  if p_ref is null or btrim(p_ref) = '' then
    return jsonb_build_object('titre', 'Qui a dit ça ? : réponses', 'note', 'Aucune citation affichée : ouvre une citation pour voir son auteur.', 'sections', '[]'::jsonb);
  end if;
  begin
    select * into q from hg_quiz_questions where id = p_ref::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('titre', 'Qui a dit ça ? : réponses', 'note', 'Référence de citation invalide.', 'sections', '[]'::jsonb);
  end;
  if not found then
    return jsonb_build_object('titre', 'Qui a dit ça ? : réponses', 'note', 'Cette citation n’existe plus.', 'sections', '[]'::jsonb);
  end if;
  select a.answer into k from hg_quiz_keys a where a.question_id = q.id;
  v_bonne := (hg_quiz_ids(k -> 'correct'))[1];
  select o.v->>'uid', o.v->>'text' into v_uid, v_txt
    from jsonb_array_elements(q.options) o(v) where o.v->>'id' = v_bonne limit 1;
  select p.pseudo into v_nom from hg_profiles p where p.id::text = v_uid;
  v_nom := coalesce(v_nom, v_txt, '—');
  return jsonb_build_object('titre', 'Qui a dit ça ? : réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Citation affichée', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Auteur', 'valeur', v_nom, 'ton', 'ok'),
      jsonb_build_object('label', 'Citation', 'valeur', q.prompt),
      jsonb_build_object('label', 'Contexte', 'valeur', coalesce(q.explanation, '—'))))));
end $$;
revoke all on function public.hg_adrep_citations(text) from public, anon, authenticated;

-- Question du jour : question, bonne réponse et explication. Même tirage que l'onglet (hg_quiz_daily_ensure).
create or replace function public.hg_adrep_jour(p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = public
as $$
declare dd date := hg_quiz_daily_day(); qid uuid; q hg_quiz_questions;
begin
  qid := hg_quiz_daily_ensure(dd);
  if qid is null then
    return jsonb_build_object('titre', 'Question du jour : réponses', 'note', 'Pas de question du jour : aucune question utilisable n’est programmée.', 'sections', '[]'::jsonb);
  end if;
  select * into q from hg_quiz_questions where id = qid;
  return jsonb_build_object('titre', 'Question du jour : réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Question', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Question', 'valeur', q.prompt),
      jsonb_build_object('label', 'Jour', 'valeur', to_char(dd, 'DD.MM.YYYY')),
      jsonb_build_object('label', 'Catégorie', 'valeur', coalesce(q.category, '—')))),
    jsonb_build_object('titre', 'Réponse', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Bonne réponse', 'valeur', coalesce(hg_quiz_daily_solution_text(qid), '—'), 'ton', 'ok'),
      jsonb_build_object('label', 'Explication', 'valeur', coalesce(q.explanation, '—'))))));
end $$;
revoke all on function public.hg_adrep_jour(text) from public, anon, authenticated;

-- Framed : film du jour (titre, année, date de séance, nombre d'images).
create or replace function public.hg_adrep_framed(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare d date := hg_jeux_today(); r hg_framed_rounds; f hg_framed_films;
begin
  select * into r from hg_framed_rounds where day = d;
  if not found then
    return jsonb_build_object('titre', 'Framed : réponses', 'note', 'Pas d’image programmée pour aujourd’hui.', 'sections', '[]'::jsonb);
  end if;
  select * into f from hg_framed_films where id = r.film_id;
  return jsonb_build_object('titre', 'Framed : réponses', 'note', null, 'sections', jsonb_build_array(
    jsonb_build_object('titre', 'Film du jour', 'lignes', jsonb_build_array(
      jsonb_build_object('label', 'Film', 'valeur', f.title || case when f.year is not null then ' (' || f.year::text || ')' else '' end, 'ton', 'ok'),
      jsonb_build_object('label', 'Vu en séance le', 'valeur', coalesce(to_char(f.seen_on, 'DD.MM.YYYY'), '—')),
      jsonb_build_object('label', 'Spectateurs', 'valeur', coalesce(f.viewers::text, '—')),
      jsonb_build_object('label', 'Images', 'valeur', cardinality(f.frames)::text)))));
end $$;
revoke all on function public.hg_adrep_framed(text) from public, anon, authenticated;

-- Heardle : morceau du jour (titre, artiste, vidéo, départ de l'extrait, proposé par).
create or replace function public.hg_adrep_heardle(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare d date := hg_jeux_today(); r hg_heardle_rounds; t hg_heardle_tracks; v_par text;
begin
  select * into r from hg_heardle_rounds where day = d;
  if not found then
    return jsonb_build_object('titre', 'Heardle : réponses', 'note', 'Pas de morceau programmé pour aujourd’hui.', 'sections', '[]'::jsonb);
  end if;
  select * into t from hg_heardle_tracks where id = r.track_id;
  select p.pseudo into v_par from hg_profiles p where p.id = t.proposed_by and not coalesce(p.is_ghost, false);
  return jsonb_build_object('titre', 'Heardle : réponses',
    'note', case when r.cancelled then 'Manche annulée aujourd’hui (la vidéo ne se lit plus).' else null end,
    'sections', jsonb_build_array(
      jsonb_build_object('titre', 'Morceau du jour', 'lignes', jsonb_build_array(
        jsonb_build_object('label', 'Titre', 'valeur', t.title, 'ton', 'ok'),
        jsonb_build_object('label', 'Artiste', 'valeur', t.artist),
        jsonb_build_object('label', 'Vidéo', 'valeur', 'https://youtu.be/' || t.youtube_id),
        jsonb_build_object('label', 'Départ de l’extrait', 'valeur', t.start_s::text || ' s'),
        jsonb_build_object('label', 'Proposé par', 'valeur', coalesce(v_par, '—'))))));
end $$;
revoke all on function public.hg_adrep_heardle(text) from public, anon, authenticated;
