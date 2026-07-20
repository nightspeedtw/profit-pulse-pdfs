// Wishlist / "Add to collection" — localStorage first.
// When Supabase auth exists in the future, sync via a `user_collections` table.

import { useCallback, useEffect, useState } from "react";

const KEY = "secretpdf_wishlist_v1";

function readAll(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeAll(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(new Set(ids))));
    window.dispatchEvent(new CustomEvent("wishlist:change"));
  } catch {}
}

export function useWishlist(ebookId: string) {
  const [ids, setIds] = useState<string[]>(() => readAll());

  useEffect(() => {
    const onChange = () => setIds(readAll());
    window.addEventListener("wishlist:change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("wishlist:change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const inWishlist = ids.includes(ebookId);
  const toggle = useCallback(() => {
    const cur = readAll();
    const next = cur.includes(ebookId) ? cur.filter((x) => x !== ebookId) : [...cur, ebookId];
    writeAll(next);
    setIds(next);
  }, [ebookId]);

  return { inWishlist, toggle, count: ids.length, all: ids };
}

export function getWishlistIds(): string[] {
  return readAll();
}
