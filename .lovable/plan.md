## Login + User Dashboard — Continue Work

Priorities (in order): (1) Managed Google OAuth + Header sign-in, (2) Notifications + Privacy end-to-end, (3) Orders/Invoices/Downloads real, (4) Profile + Security full.

---

### 1. Managed Google OAuth + Header sign-in menu

- Enable managed Google via `configure_social_auth(["google"])` so it works in Lovable preview iframe + custom domain (`secretpdf.co`, `www.secretpdf.co`).
- Replace direct `supabase.auth.signInWithOAuth("google", …)` in `src/pages/account/SignIn.tsx` with `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth/callback" })`.
- Add public callback route `/auth/callback` that reads intended `next` path from `sessionStorage` and navigates after Supabase session hydrates.
- Preserve intended destination: before sign-in, save `next` (same-origin path only) in `sessionStorage`.
- Add `AccountMenu` component to the main site header (desktop + mobile): shows "Sign in" button when logged-out; avatar + dropdown (Overview, My Library, Orders, Sign out) when logged-in. Wire into `Header.tsx` / storefront navbars.

### 2. Notifications + Privacy end-to-end

- `/account/notifications`:
  - Read/write `acct_profiles.notification_prefs` (marketing, order updates, royalty updates, product news). Toggles persist via RLS-guarded update.
  - List history from `acct_notifications` with mark-as-read.
- `/account/privacy`:
  - **Data export**: button inserts row into `acct_data_requests` (status=pending). Edge function `account-data-export` compiles user's orders/downloads/holdings into JSON, uploads to storage, emails signed link via Resend, updates row to `ready`.
  - **Account deletion**: confirmation dialog → inserts into `acct_deletion_requests` (status=pending, purge_after=now()+7d). Admin cron `account-deletion-worker` runs daily: anonymizes profile, revokes download grants, deletes auth user via service-role. Show "cancel deletion" while pending.
  - Add `/admin/account-requests` page for admin visibility.

### 3. Orders / Invoices / Downloads — real

- Orders list already queries `orders`; add empty-state + status badges + link to detail.
- `OrderDetail`: show `order_items`, totals, payment method, download links per item (call `account-signed-download` for each grant).
- Invoices: generate PDF on-demand via new edge function `account-invoice-pdf` (uses pdf-lib, EU VAT compliant, saves to `ebook-pdfs`-style private bucket `account-invoices`, returns signed URL). List cached invoices per order.
- Downloads page: show `acct_download_events` history (last 90d) — file, timestamp, IP city — and re-download button that hits `account-signed-download`.

### 4. Profile + Security full

- Profile:
  - Avatar upload (new public bucket `account-avatars`, 2MB max, image/*), display name, country, language.
  - Persist to `acct_profiles`; show verified-email badge.
- Security:
  - Email verification banner + "resend confirmation" (`supabase.auth.resend`).
  - Change password form (`supabase.auth.updateUser({ password })`, requires recent login → re-auth prompt on error).
  - Active sessions: list via `supabase.auth.admin` is service-role only, so show current session + "Sign out everywhere" (`supabase.auth.signOut({ scope: 'global' })`).
  - Optional TOTP 2FA (`supabase.auth.mfa.enroll/verify/challenge`) with recovery-code display.

---

### Technical notes

- New tables: none required (reuse `acct_profiles`, `acct_notifications`, `acct_data_requests`, `acct_deletion_requests`, `acct_download_events`).
- New storage buckets: `account-avatars` (public), `account-invoices` (private, RLS: buyer_user_id = auth.uid()).
- New edge functions: `account-data-export`, `account-deletion-worker` (cron), `account-invoice-pdf`.
- Header component location: find existing `Header`/nav in `src/components/` and inject `AccountMenu` — keep visual style unchanged.
- Google OAuth `redirect_uri` must be `window.location.origin + "/auth/callback"` (public route), not `/account` — memory + cloud-google-auth rule.
- All new RLS policies use `auth.uid()`; grants: `authenticated` only.

### Out of scope

- Payment gateway changes.
- Kids/coloring production pipeline.
- SEO/marketing autopilots.
