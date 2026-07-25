// Opens Paddle overlay for a per-book Personal or Commercial license.
// The catalog holds two shared prices — book_personal_license ($14.99) and
// book_commercial_license ($39). We pass customData so the webhook knows
// which user/book/license to attach.
import { useState } from "react";
import { initializePaddle, getPaddlePriceId } from "@/lib/paddle";

export type LicenseType = "personal" | "commercial";

interface Opts {
  bookId: string;
  userId: string;
  licenseType: LicenseType;
  customerEmail?: string;
  successUrl?: string;
}

const PRICE_ID: Record<LicenseType, string> = {
  personal: "book_personal_license",
  commercial: "book_commercial_license",
};

export function useLicenseCheckout() {
  const [loading, setLoading] = useState(false);

  const openLicenseCheckout = async (opts: Opts) => {
    setLoading(true);
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(PRICE_ID[opts.licenseType]);
      // @ts-ignore Paddle is loaded via script tag
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        customer: opts.customerEmail ? { email: opts.customerEmail } : undefined,
        customData: {
          kind: "book_license",
          userId: opts.userId,
          bookId: opts.bookId,
          licenseType: opts.licenseType,
        },
        settings: {
          displayMode: "overlay",
          successUrl: opts.successUrl || `${window.location.origin}/account/commercial-library?purchase=success`,
          allowLogout: false,
          variant: "one-page",
        },
      });
    } finally {
      setLoading(false);
    }
  };

  return { openLicenseCheckout, loading };
}
