// Home page FAQ (GEO 2026-11-14). Shown on the page (HomeFaq), in the prerendered home HTML and in its FAQPage
// JSON-LD (scripts/canonical-routes.ts), so the three always match. Answers repeat facts the site already states
// (ValueProps, refund policy, footer contact); add nothing here that the site does not already promise.
export const HOME_FAQ: { q: string; a: string }[] = [
  { q: "How do I get my PDF after I pay?", a: "Your PDF is ready to download as soon as your payment clears. Nothing is shipped." },
  { q: "Can I print the PDF more than once?", a: "Yes. Print the file at home as many times as you need." },
  { q: "What if the PDF is not what I expected?", a: "Every purchase has a 30-day money-back guarantee. Paddle, our Merchant of Record, handles refunds." },
  { q: "How do I contact SecretPDF?", a: "Email support@secretpdf.co with your question or your order details." },
];
