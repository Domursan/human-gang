-- 063 : page « Questions du gang » (quiz.html) dans le menu, réservée aux membres.
insert into public.hg_pages (slug, label, mode, in_nav, sort)
  values ('quiz', 'Questions du gang', 'membres', true, 9)
  on conflict (slug) do nothing;
