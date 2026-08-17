/*
  GET /api/connect/:code: the Collector's poll. Three answers:
  `pending` (keep polling), `approved` (here is your token, once), `expired`
  (stop). An unknown, rejected or already collected code all read as `expired`,
  so polling reveals nothing about codes belonging to other people.
*/
import { claimConnectCode } from "@/lib/connect";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/connect/[code]">) {
  const { code } = await params;
  const result = await claimConnectCode(code);
  // Poll responses must never be cached: the second read is deliberately different.
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
