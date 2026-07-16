import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Strip Deno `npm:` prefix so edge-function source files can be
      // imported directly from vitest (node) tests.
      { find: /^npm:(@?[^@]+)(?:@[^/]+)?(\/.*)?$/, replacement: "$1$2" },
    ],
  },
});
