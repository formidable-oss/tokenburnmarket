/*
  POST /api/connect/start: the Collector's first call, before it has any
  credential. It hands over the public key it just generated and gets back a
  short code plus the URL to open. Nothing here identifies a Builder; that only
  happens when someone signed in approves the code.
*/
import { ConnectStartSchema, pruneExpiredConnectCodes, startConnect } from "@/lib/connect";

export const dynamic = "force-dynamic";

/** Where the approval link points. The env var wins so the link is right behind a proxy. */
function baseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const parsed = ConnectStartSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "publicKey must be a base64 Ed25519 key and deviceName must be 1 to 64 characters" },
      { status: 400 },
    );
  }

  // Cheap opportunistic sweep: connect is rare, and it keeps the table to codes in flight.
  await pruneExpiredConnectCodes();
  const started = await startConnect(parsed.data, baseUrl(request));
  return Response.json(started, { status: 201 });
}
