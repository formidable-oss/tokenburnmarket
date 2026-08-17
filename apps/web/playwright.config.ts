import { defineConfig, devices } from "@playwright/test";

/*
  The smoke suite. It only visits pages anyone can visit, so the same run works
  against a local `next start` and against production:

    pnpm --filter @tokenburnmarket/web e2e
    BASE_URL=https://tokenburnmarket.vercel.app pnpm --filter @tokenburnmarket/web e2e

  Nothing here signs in. OAuth against a real GitHub app is not something a
  smoke test should own.
*/
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
