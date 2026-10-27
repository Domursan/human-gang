-- ===== Humane Gang — migration 163 : emoji de la paillette par thème (« paillette_emoji ») =====
-- Pendant le thème Raclette, le dessin de la Paillette (étoile jaune) est remplacé partout par l'emoji 🧀.
-- Le champ est générique : null = dessin normal ; sinon l'emoji (un seul caractère, ou une petite suite) est
-- affiché à la place de l'étoile pendant que le thème est actif. Réglable dans l'admin des thèmes.
-- Rien d'autre n'est modifié : aucune fonction ne liste les colonnes de hg_themes une par une (les lectures
-- côté base et côté site se font en select *), donc le nouveau champ est transmis tel quel.
alter table public.hg_themes add column if not exists paillette_emoji text
  check (paillette_emoji is null or char_length(paillette_emoji) between 1 and 16);

update public.hg_themes set paillette_emoji = '🧀' where slug = 'raclette';
