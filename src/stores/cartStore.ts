import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StorefrontEbook } from "@/lib/storefront";

export interface CartItem {
  ebook_id: string;
  title: string;
  price: number;
  cover_url: string | null;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (ebook: StorefrontEbook) => void;
  removeItem: (ebook_id: string) => void;
  setQuantity: (ebook_id: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      addItem: (ebook) => {
        if (!ebook.price || ebook.price <= 0) return;
        const items = get().items;
        const existing = items.find((i) => i.ebook_id === ebook.id);
        if (existing) {
          set({ items: items.map((i) => (i.ebook_id === ebook.id ? { ...i, quantity: i.quantity + 1 } : i)) });
        } else {
          set({
            items: [
              ...items,
              {
                ebook_id: ebook.id,
                title: ebook.title,
                price: Number(ebook.price),
                cover_url: ebook.cover_url,
                quantity: 1,
              },
            ],
          });
        }
      },
      removeItem: (id) => set({ items: get().items.filter((i) => i.ebook_id !== id) }),
      setQuantity: (id, q) => {
        if (q <= 0) {
          set({ items: get().items.filter((i) => i.ebook_id !== id) });
          return;
        }
        set({ items: get().items.map((i) => (i.ebook_id === id ? { ...i, quantity: q } : i)) });
      },
      clearCart: () => set({ items: [] }),
      totalItems: () => get().items.reduce((s, i) => s + i.quantity, 0),
      totalPrice: () => get().items.reduce((s, i) => s + i.price * i.quantity, 0),
    }),
    {
      name: "secretpdf-cart",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
