update public.coloring_v2_books b
set stage='page_plan', stage_attempt_count=0,
    last_error='missing_dependency:page_plan_row_absent:repaired',
    stage_updated_at = now() - interval '5 minutes',
    updated_at = now()
where b.stage='interior_render'
  and not exists (select 1 from public.coloring_v2_page_plans p where p.book_id=b.id);