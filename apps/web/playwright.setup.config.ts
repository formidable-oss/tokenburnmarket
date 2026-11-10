import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import smokeConfig from "./playwright.config";

/*
  pnpm --filter @tokenburnmarket/web e2e:setup
  Requires a migrated test database in DATABASE_URL or .env.local. This starts
  its own development server so the existing local sign-in can be exercised.
  Stop any existing apps/web `pnpm dev` server first, even on another port.
  Each run owns one temporary account; the test removes it and its devices.
  The public smoke suite stays safe to run against a deployment.
*/
loadEnv({ path: join(__dirname, ".env.local"), quiet: true });
if (!process.env.DATABASE_URL) throw new Error("e2e:setup requires a migrated test DATABASE_URL.");

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
