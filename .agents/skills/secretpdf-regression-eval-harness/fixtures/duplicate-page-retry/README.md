# Fixture: duplicate-page-retry

Class: `idempotency`. Chef Pip's Sticky Sticky Jam shipped with pages 4-8
repeated at 9-13 because the retry path appended batches without an
idempotency key.

Guarded by the page-ledger unit tests in `src/lib/pageLedger.test.ts` and
the runtime check `appendUniqueSpreads` in
`supabase/functions/_shared/kids-picture-pdf.ts`.
