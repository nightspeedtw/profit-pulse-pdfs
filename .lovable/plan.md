# Rebrand: Printly → SecretPDF

Replace the "Printly" brand and its brutalist "P" mark with the uploaded **SecretPDF** identity (navy #0F2A47 + teal #2AA9B8, document + shield/keyhole icon). Refine the visual language so the site reads as a world-class, trust-forward digital product brand — **not** a brutalist print shop.

## 1. Logo asset

- Save the uploaded logo (`user-uploads://ChatGPT_Image_4_ก.ค._2569_14_07_21.png`) as source, then create three trimmed, transparent assets via `imagegen--edit_image`:
  - `src/assets/secretpdf-logo-horizontal.png` — main lockup (icon + wordmark)
  - `src/assets/secretpdf-icon.png` — icon only (rounded-square favicon/app)
  - `src/assets/secretpdf-logo-stacked.png` — icon over "SecretPDF / PRIVATE. SECURE. TRUSTED."
- Publish each via `lovable-assets` → `src/assets/*.asset.json`, import as ES modules.
- Replace `public/favicon.ico` with a 512px PNG derived from the icon-only asset; update `<link rel="icon">` in `index.html` and delete the old `.ico`.

## 2. Brand tokens (`src/index.css`, `tailwind.config.ts`)

Retire the brutalist "PRINTLY" palette. Introduce SecretPDF tokens (HSL):

```text
--background:      210 40% 98%     (near-white)
--foreground:      212 55% 12%     (navy ink #0F2A47)
--primary:         212 55% 17%     (deep navy)
--primary-foreground: 0 0% 100%
--accent:          188 63% 44%     (teal #2AA9B8)
--accent-foreground:  0 0% 100%
--highlight:       188 80% 92%     (soft teal wash, replaces yellow)
--muted:           210 30% 94%
--border:          212 20% 88%
--ring:            188 63% 44%
--shadow-elegant:  0 20px 60px -20px hsl(212 55% 12% / 0.18)
--gradient-brand:  linear-gradient(135deg, hsl(212 55% 17%), hsl(188 63% 44%))
```

- Fonts: swap display font from brutalist condensed to **Fraunces** (serif, authority) for headings + **Inter** for body via `@fontsource`. Keep tracking tight, no all-caps chunky slabs.
- Rename the `/* PRINTLY */` comment header and any leftover yellow highlight utilities.
- Soften the brutalist defaults: reduce default `border-2` chrome, allow `rounded-lg/xl`, add subtle `shadow-elegant` instead of hard offset shadows in shared UI wrappers (only where already used — no component behavior changes).

## 3. Text/brand renames

Replace every user-facing "Printly" string with **SecretPDF**:

- `index.html` — `<title>`, meta author, og:title, twitter:title, meta description ("SecretPDF — Private, Secure, Trusted Digital PDFs. Instant Download.").
- `src/components/Header.tsx` — swap the "P" tile + text for `<img src={logoHorizontal} alt="SecretPDF" className="h-9 w-auto" />`, aria-label "SecretPDF home".
- `src/components/Footer.tsx` — stacked logo + `© {year} SecretPDF. Private. Secure. Trusted.`
- `src/pages/About.tsx`, `Bundles.tsx`, `Categories.tsx`, `Category.tsx` — update `document.title` and body copy mentioning Printly.
- Marquee/tagline copy: keep functional text, replace "Trusted by 50K+ Creators" wording only if it names Printly.

## 4. Header/Footer polish

- Header: white/near-white surface, thin bottom border in `--border`, logo left, nav center, teal CTA button for primary action (cart/checkout stays functional — only styling changes).
- Footer: navy background (`--primary`) with white text, stacked logo + tagline, quiet legal row. Keep existing links/columns, only restyle.

## 5. Out of scope (do NOT touch)

- No changes to product data, PDFs, manuscripts, prices, store thumbnails, cover generation, or Shopify calls.
- No routing, auth, or backend/edge-function logic changes.
- No changes to `ProductCard` layout beyond inheriting the new tokens.

## 6. Verification

- `tsgo --noEmit` typecheck.
- Playwright: screenshot `/`, `/product/<id>`, `/about` at 1280×1800; visually confirm new logo in header/footer, navy+teal palette, no remaining "Printly" text (`rg -i printly src index.html` returns 0 user-facing hits).

## Deliverables

- Logo assets + favicon
- Updated tokens (`index.css`, `tailwind.config.ts`)
- Header, Footer, index.html, About/Bundles/Categories/Category title updates
- Screenshots before/after
