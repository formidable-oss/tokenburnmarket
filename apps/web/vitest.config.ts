import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests import app modules by the same `@/` specifier the app uses.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // e2e/ belongs to Playwright, which needs a running server.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
