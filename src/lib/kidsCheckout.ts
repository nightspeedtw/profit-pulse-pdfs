// Helpers for the paid (Paddle) kids/coloring checkout.
// Kept pure so the routing contract can be unit-tested.

/** Route of the single-book checkout page for an ebooks_kids id. */
export function kidsCheckoutPath(bookId: string): string {
  return `/kids/checkout/${encodeURIComponent(bookId)}`;
}

/** Only same-origin, absolute-path targets may be stored as the post-sign-in return path. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//");
}

/** Remember where to return after sign-in (read by /account/sign-in as "auth:next"). */
export function rememberReturnPath(path: string, storage: Pick<Storage, "setItem"> = sessionStorage): boolean {
  if (!isSafeReturnPath(path)) return false;
  storage.setItem("auth:next", path);
  return true;
}

/** "$24.99" — always USD, always two decimals; never NaN. */
export function formatUsd(cents: number | null | undefined): string {
  const n = Number(cents);
  return `$${((Number.isFinite(n) && n > 0 ? n : 0) / 100).toFixed(2)}`;
}
