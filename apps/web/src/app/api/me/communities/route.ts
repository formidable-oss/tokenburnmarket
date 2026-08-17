/*
  GET /api/me/communities: the Communities this machine's Builder belongs to.

  The slug is the useful field: it is what /api/me/markets takes to narrow a
  list, and what a person types when they talk about a Community.
*/
import { deviceCaller } from "@/lib/me-api";
import { communitiesForBuilder } from "@/lib/market-queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await deviceCaller(request);
  if (!guard.ok) return guard.response;

  const communities = await communitiesForBuilder(guard.caller.builderId);
  return Response.json({
    communities: communities.map((community) => ({
      slug: community.slug,
      name: community.name,
    })),
  });
}
