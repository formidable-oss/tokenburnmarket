import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";
import smokeConfig from "./playwright.config";

/*
  DATABASE_URL=<migrated test database> pnpm --filter @tokenburnmarket/web e2e:setup
  The database is never read from .env.local, so a run cannot write to an
  everyday database by accident. Starts its own development server for the
  local sign-in; stop any apps/web dev server first, even on another port.
*/
if (!process.env.DATABASE_URL) {
  throw new Error("e2e:setup requires DATABASE_URL=<migrated test database> on the command line.");
}

const baseURL = "http://127.0.0.1:3102";
const handle = `tbm-setup-e2e-${randomUUID().replaceAll("-", "").slice(0, 12)}`;

export default defineConfig({
  ...smokeConfig,
  testMatch: "setup.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  metadata: { setupHandle: handle },
  use: { ...smokeConfig.use, baseURL },
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3102",
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      DEV_USER: handle,
      AUTH_GITHUB_ID: "",
      AUTH_GITHUB_SECRET: "",
      AUTH_SECRET: randomUUID(),
      AUTH_TRUST_HOST: "true",
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
