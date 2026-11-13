import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import fs from "fs";
import { writeCanonicalRoutes } from "./scripts/canonical-routes";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    {
      // SEO only (2026-11-13): one HTML file per sitemap route with its own canonical. See scripts/canonical-routes.ts.
      name: "canonical-routes",
      apply: "build" as const,
      closeBundle() {
        const dist = path.resolve(__dirname, "dist");
        if (!fs.existsSync(path.join(dist, "index.html"))) return;
        const n = writeCanonicalRoutes(dist, fs.readFileSync(path.resolve(__dirname, "public/sitemap.xml"), "utf8"));
        console.log(`canonical-routes: wrote ${n} pages`);
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
