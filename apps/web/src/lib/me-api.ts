/*
  The shared front door for /api/me/*: the routes a connected Device calls on
  behalf of its Builder, which is how the CLI and its MCP server read stats,
  list Markets and place bets.

  Everything under /api/me is device-authenticated, never session-authenticated:
  the caller is a machine holding a Device token, and the Builder it acts for is
  read from the Device row rather than taken from the request.
*/
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { builders } from "@/db/schema";
import { requireDevice } from "./device-auth";

export interface DeviceCaller {
  builderId: string;
  handle: string;
  country: string | null;
  /** Cached balance, kept in step with the ledger by every write that touches it. */
  creditBalance: number;
}

type Guarded = { ok: true; caller: DeviceCaller } | { ok: false; response: Response };

/** Authenticate the Device and load the Builder it speaks for, or the answer to send back. */
export async function deviceCaller(request: Request): Promise<Guarded> {
  const auth = await requireDevice(request);
  if (!auth.ok) {
    return { ok: false, response: Response.json({ error: auth.error }, { status: auth.status }) };
  }

  const [builder] = await db
    .select({
      id: builders.id,
      handle: builders.handle,
      country: builders.country,
      creditBalance: builders.creditBalance,
    })
    .from(builders)
    .where(eq(builders.id, auth.device.builderId))
    .limit(1);

  // A Device whose Builder is gone is as good as a forged token.
  if (!builder) {
    return { ok: false, response: Response.json({ error: "bad_token" }, { status: 401 }) };
  }

  return {
    ok: true,
    caller: {
      builderId: builder.id,
      handle: builder.handle,
      country: builder.country,
      creditBalance: builder.creditBalance,
    },
  };
}
