/*
  Run the daily mint against a running app, the way Vercel Cron would.

    pnpm --filter @tokenburnmarket/web mint:run

  Reads CRON_SECRET and NEXT_PUBLIC_APP_URL from .env.local; pass a different
  base URL as the first argument to point it at a preview deployment.
*/
const base = process.argv[2] ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set. Add it to apps/web/.env.local.");
  process.exit(1);
}

const response = await fetch(new URL("/api/cron/mint", base), {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
});

const body = await response.text();
console.log(response.status, body);
process.exit(response.ok ? 0 : 1);
