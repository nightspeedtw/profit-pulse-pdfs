## Diagnosis

Your screenshot of `/kids` shows the wizard rendered with **zero theme tiles** (only "Surprise me") and the loader spinner still spinning below. I verified from the sandbox:

- DB has 7 themes, 5 age groups, 3 live books.
- Anon REST calls to `kids_themes`, `kids_age_groups`, and `ebooks_kids` all return 200 with data.
- A fresh Playwright load of `/kids` renders correctly with no runtime errors.

So the data and RLS are fine. The bug is in `src/pages/Kids.tsx`'s data-loading effect: it does one `Promise.all([...])` inside an `async` IIFE with no `try/finally` around `setLoading(false)`. If any one of the three network calls hangs or rejects (expired auth refresh, dropped fetch, transient 5xx), `setLoading` is never called and the page is stuck forever — exactly what you saw.

The wizard renders regardless of `loading`, which is why the header + "Surprise me" tile appear even though themes hadn't arrived yet.

## Fix (frontend-only, no schema changes)

Edit `src/pages/Kids.tsx`:

1. Split the load into three independent, individually-caught promises so one slow/failed call cannot block the other two.
2. Wrap the whole effect in `try / finally` and always call `setLoading(false)` in `finally`, guarded by the `cancelled` flag.
3. Add a 15s hard timeout wrapper — if a request stalls, we fall back to an empty state instead of an infinite spinner.
4. When themes/age groups arrive empty, still render the results section (or a "No books yet" note) so the page never dead-ends.

No other files change. No backend or business-logic changes. Wizard/MatchedResults/Hero components stay identical.

## Verification

- Reload `/kids` — full page renders (themes populate, spinner disappears).
- Simulate slow network in DevTools; spinner still resolves within 15s.
- `bun run build` clean.
