UPDATE public.ebooks
SET cover_spec = cover_spec
  || jsonb_build_object(
       'title_text', 'THE 6-MONTH DEBT EXIT STRATEGY',
       'subtitle_text', 'A tactical blueprint for high-interest payoff using the cash-flow injection method.',
       'badge_text', 'PREMIUM TACTICAL WORKBOOK',
       'brand_text', 'SECRET PDF'
     )
WHERE id = 'cfc0ab97-ec48-447a-a0ca-73513e36941f';