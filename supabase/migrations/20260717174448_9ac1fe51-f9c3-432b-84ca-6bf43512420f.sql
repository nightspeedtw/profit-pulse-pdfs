UPDATE ebooks_kids
SET metadata = metadata || jsonb_build_object('qc_mode_override','learning')
WHERE id='05792915-65c5-4691-9f1c-88ac760b0aab';