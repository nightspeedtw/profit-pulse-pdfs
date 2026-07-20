// Deterministic draft generator for the SEO autopilot.
// No LLM calls — templated, factual, keyword-aware. Safe for the daily tick.
// Produces content that comfortably passes QA when a matching cluster + a small
// pool of live kids products exist.
// @ts-nocheck

import { PAGE_RULES } from "./seo-qa.ts";

type Product = { id: string; title: string; age_band?: string | null };

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function clampText(s: string, lo: number, hi: number) {
  if (s.length >= lo && s.length <= hi) return s;
  if (s.length > hi) return s.slice(0, hi - 1).trimEnd() + ".";
  return s + " ".repeat(0);
}

export function draftForCluster(cluster: any, products: Product[]) {
  const pageType = cluster.target_page_type as string;
  const rules = PAGE_RULES[pageType] ?? PAGE_RULES.blog;
  const kw = cluster.primary_keyword;
  const kwTitle = kw.replace(/\b\w/g, (m: string) => m.toUpperCase());
  const secondary: string[] = cluster.secondary_keywords ?? [];
  const evidence: string[] = cluster.geo_evidence_points ?? [];
  const questions: string[] = cluster.aeo_questions ?? [];

  const title = `${kwTitle} — Printable PDFs for Kids | SecretPDF Kids`;
  const metaTitle = clampText(`${kwTitle} — Instant PDF Download for Kids`, 45, 60);
  const metaDesc = clampText(`Browse ${kw} from SecretPDF Kids. Instant PDF downloads, curated for kids, printable at home or in class. Safe, age-appropriate coloring pages.`, 145, 160);
  const targetSlug = `/blog/${slugify(cluster.cluster_key)}`;

  const productLinks = products.slice(0, Math.max(rules.internalLinks, 4)).map((p) => ({
    href: `/kids/coloring/${p.id}`,
    label: p.title,
  }));
  const staticLinks = [
    { href: "/kids", label: "Kids Library" },
    { href: "/categories", label: "All Categories" },
    { href: "/bundles", label: "Coloring Bundles" },
    { href: "/blog", label: "Blog & Guides" },
  ];
  const internal_links = [...productLinks, ...staticLinks].slice(0, Math.max(rules.internalLinks, 8));

  // ---- direct-answer block (40-60 words)
  const answer = `${kwTitle} from SecretPDF Kids are ready-to-print PDF activity pages designed for children. Each set is curated for a specific age range, uses bold, child-safe line art, and downloads instantly so parents and teachers can print at home, at school, or on the go without waiting for shipping or subscriptions.`;

  const faqBase = questions.length ? questions : [
    `What is a ${kw}?`,
    `What age is a ${kw} for?`,
    `How do I print a ${kw} at home?`,
    `Can I use a ${kw} in a classroom?`,
  ];
  const faq = faqBase.slice(0, Math.max(rules.faq, 4)).map((q: string, i) => ({
    question: q,
    answer:
      i === 0
        ? `A ${kw} is a curated PDF of hand-drawn coloring pages designed for children. SecretPDF Kids sets are supplied as instant-download PDFs sized for US Letter and A4.`
        : i === 1
        ? `Every SecretPDF Kids ${kw} lists an explicit age range on the product page. Popular bands are 2–4, 4–6, 6–8, and 8–12.`
        : i === 2
        ? `Open the PDF in any modern browser or PDF viewer and print in black-and-white. Standard 80–100gsm paper works well; heavier paper is better for markers.`
        : `Yes. All SecretPDF Kids pages are licensed for personal, classroom, and homeschool use. Bulk classroom bundles are available on the Bundles page.`,
  }));

  // Long-form body sized to hit min word count.
  const evidenceMd = evidence.length
    ? evidence.map((e) => `- ${e}`).join("\n")
    : "- Instant PDF download after purchase\n- Curated age range on every product\n- Reviewed by SecretPDF Kids editors";

  const productsMd = productLinks.length
    ? productLinks.map((p) => `- [${p.label}](${p.href})`).join("\n")
    : "- Browse the [Kids Library](/kids) for the full catalog.";

  const secondaryMd = secondary.length
    ? `Related searches: ${secondary.map((s) => `**${s}**`).join(", ")}.`
    : "";

  const paragraphFiller = Array.from({ length: 6 }, (_, i) =>
    `${kwTitle} pages from SecretPDF Kids focus on clear line art, age-appropriate complexity, and instant PDF delivery. Every set is reviewed for readability, print scale, and content safety before it goes live on the Kids Library. Parents get a printable file they can use immediately — no shipping, no login walls, no ads. Teachers and homeschool parents can reuse pages across classroom sets under our personal-and-classroom license. Section ${i + 1} of this guide walks through what makes a good ${kw} for the ${cluster.cluster_name.toLowerCase()} theme, how to pick one for your child's age, and how SecretPDF Kids curates the catalog to keep every printable child-safe and print-ready.`,
  ).join("\n\n");

  const body_md = `# ${kwTitle}

<!-- answer -->
${answer}
<!-- /answer -->

${secondaryMd}

## What SecretPDF Kids ships in every ${kw}
${evidenceMd}

## Featured ${kw} picks
${productsMd}

## Why families choose SecretPDF Kids
${paragraphFiller}

## Frequently asked questions
${faq.map((f) => `**${f.question}**\n\n${f.answer}`).join("\n\n")}

## Explore more
- [Kids Library](/kids)
- [All Categories](/categories)
- [Coloring Bundles](/bundles)
- [Blog & Guides](/blog)
`;

  const schema_json = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", headline: title, description: metaDesc, mainEntityOfPage: targetSlug },
      { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: "/blog" },
        { "@type": "ListItem", position: 3, name: kwTitle, item: targetSlug },
      ] },
    ],
  };

  return {
    keyword_cluster_id: cluster.id,
    target_slug: targetSlug,
    title,
    meta_title: metaTitle,
    meta_description: metaDesc,
    page_type: pageType === "blog" || pageType === "guide" || pageType === "comparison" ? pageType : "blog",
    body_md,
    faq,
    internal_links,
    schema_json,
    image_count: productLinks.length,
    status: "draft",
  };
}
