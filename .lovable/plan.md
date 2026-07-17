## Canva Round-Trip Integration — Plan

Wire the generated coloring-book PDF into Canva for editing, then pull the edited PDF/PNGs back into the book row. One shared admin Canva account (OAuth once, stored server-side).

### Architecture

```text
Lovable PDF (pdf_url in ebook-pdfs bucket, signed URL)
        │
        ▼  canva-connect-import  (POST /v1/imports, url mode)
Canva Design (design_id, edit_url)
        │  admin edits in Canva
        ▼  canva-connect-export  (POST /v1/exports pdf + png-per-page)
        ▼  canva-connect-webhook (design.updated) OR manual "Pull from Canva"
Storage: ebook-pdfs/canva/{book}.pdf  +  ebook-covers/canva/{book}-p{n}.png
        │
        ▼
ebooks_kids.metadata.canva = { design_id, edit_url, last_import_at,
                               last_export_at, exported_pdf_url,
                               exported_page_urls[], status }
```

### Backend

**New table** `canva_oauth_tokens` (single-row, admin-shared):
- `id uuid pk`, `access_token text`, `refresh_token text`, `expires_at timestamptz`, `scope text`, `updated_at`
- RLS: no anon/authenticated access; service_role only.

**Secrets**: `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` (owner will paste after creating a Canva Developer App; redirect URI = `https://<project>.functions.supabase.co/canva-connect-oauth/callback`).

**Edge functions**:
1. `canva-connect-oauth` — `GET /start` (admin passcode → redirect to Canva authorize with PKCE), `GET /callback` (exchange code, upsert token row).
2. `canva-connect-token` (shared helper module `_shared/canva.ts`) — returns valid access token, auto-refreshes when `expires_at < now+60s`.
3. `canva-connect-import` — body `{ ebook_id }`. Signs pdf_url, calls `POST https://api.canva.com/rest/v1/imports` with `url` mode + `mime_type: application/pdf`, polls job until `success`, persists `design_id`/`edit_url` into `ebooks_kids.metadata.canva`.
4. `canva-connect-export` — body `{ ebook_id, formats: ['pdf','png'] }`. Creates export job(s), polls, downloads bytes, uploads to `ebook-pdfs/canva/` and `ebook-covers/canva/`, writes signed URLs into `metadata.canva.exported_*`.
5. `canva-connect-status` — `GET ?ebook_id=` returns cached `metadata.canva` + connection health (token present, expires_at).

Rate-limit: single in-flight import/export per book (use existing `production_locks` pattern with name `canva:<book_id>`). Errors relayed with provider status + body per project convention.

### Frontend

**Shared component** `src/components/admin/CanvaBookActions.tsx`:
- Buttons: `Edit in Canva` (calls import → opens `edit_url` in new tab), `Pull from Canva` (calls export → toast + refresh), status chip showing "Not synced / Synced <ts> / Canva design linked".
- If no admin token, button is disabled with tooltip "Connect Canva first" + link to `/admin/settings#canva`.

**Wire into**:
- `src/pages/admin/KidsLibrary.tsx` — row action column, only for `book_type='coloring_book'` rows with `pdf_url`.
- `src/components/admin/ColoringAutopilotCard.tsx` — recent-book list; render actions for rows where `pipeline_status='published'` or `listing_status='live'`.

**Admin settings**: add `CanvaConnectionCard` on `/admin/settings` — shows "Connect Canva" button (opens `canva-connect-oauth/start?passcode=…`), post-callback shows connected account + "Reconnect / Disconnect".

### Explicitly out of scope (v1)

- Per-user (public) Canva OAuth — admin-shared only.
- Auto-replacing `pdf_url`/`cover_url` from the Canva export (writes to `metadata.canva.exported_*` only; owner promotes manually via existing Kids Library actions).
- Autofill templates / Enterprise-only APIs.
- Webhooks (v1 uses manual "Pull from Canva"; can add `design.updated` webhook later without schema change).

### Deliverables

- Migration: `canva_oauth_tokens` table + grants.
- Edge functions: `_shared/canva.ts`, `canva-connect-oauth`, `canva-connect-import`, `canva-connect-export`, `canva-connect-status`.
- UI: `CanvaBookActions.tsx`, `CanvaConnectionCard.tsx`, integrations in `KidsLibrary.tsx` + `ColoringAutopilotCard.tsx`.
- Docs: short section in `mem://features/canva-roundtrip` capturing the doctrine (Lovable generates, Canva edits, only `metadata.canva.*` is written back).

### What I need from you before coding

1. **Create the Canva Developer App** at canva.com/developers → new integration → enable scopes: `design:content:read`, `design:content:write`, `design:meta:read`, `asset:read`, `asset:write`. Set redirect URI to the callback URL I'll give you after the functions deploy (I'll surface it in the settings card).
2. **Paste `CANVA_CLIENT_ID` + `CANVA_CLIENT_SECRET`** when I request them via secrets.

Approve and I'll ship in this order: migration → shared helper + OAuth function (so you can connect) → import/export → UI.
