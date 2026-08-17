import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside Next.js, so it loads .env.local itself.
process.loadEnvFile?.(".env.local");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
