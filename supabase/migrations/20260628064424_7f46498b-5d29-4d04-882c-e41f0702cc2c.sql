alter table public.ebooks
  add column if not exists qc_status text default 'qc_pending',
  add column if not exists failed_gate text,
  add column if not exists failed_component text,
  add column if not exists failed_score numeric,
  add column if not exists required_score numeric,
  add column if not exists auto_fix_attempt_count int not null default 0,
  add column if not exists max_auto_fix_attempts int not null default 3,
  add column if not exists last_auto_fix_action text,
  add column if not exists auto_fix_history jsonb not null default '[]'::jsonb,
  add column if not exists admin_review_reason text,
  add column if not exists next_recommended_action text,
  add column if not exists blocked_at timestamptz,
  add column if not exists resolved_at timestamptz;

do $$ begin
  if exists (select 1 from pg_constraint where conname='ebooks_qc_status_check') then
    alter table public.ebooks drop constraint ebooks_qc_status_check;
  end if;
end $$;

alter table public.ebooks add constraint ebooks_qc_status_check
  check (qc_status = any (array['qc_pending','qc_passed','auto_fixing','auto_fix_failed','needs_admin_review','ready_to_continue']));

update public.ebooks set qc_status='ready_to_continue', resolved_at=coalesce(resolved_at, now())
where pdf_status='pdf_ready' and (qc_status is null or qc_status='qc_pending');