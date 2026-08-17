/*
  GET /api/me/markets: the open Markets this machine's Builder can trade.

  Same visibility rule as /markets, read through the same query: everything
  global, their Region's, and the Communities they are in. `scope` narrows that
  list, and `communitySlug` picks one Community, which they must be a member of.

  Prices come from the query too, so a list here and the site quote the same book.
*/
import { deviceCaller } from "@/lib/me-api";
import { communityBySlug, isMember } from "@/lib/community-queries";
import { openMarketsFor, openMarketsForCommunity, type MarketSummary } from "@/lib/market-queries";

export const dynamic = "force-dynamic";

const SCOPES = new Set(["community", "global", "all"]);

function serialize(market: MarketSummary) {
  return {
    id: market.id,
    question: market.question,
    scope: market.scope,
    closesAt: market.closesAt.toISOString(),
    communitySlug: market.communitySlug,
    communityName: market.communityName,
    country: market.country,
    outcomes: market.outcomes.map((outcome) => ({
      id: outcome.id,
      label: outcome.label,
      // Reads as a probability, and the price a share is quoted at right now.
      price: outcome.price,
    })),
  };
}

export async function GET(request: Request) {
  const guard = await deviceCaller(request);
  if (!guard.ok) return guard.response;
  const { caller } = guard;

  const params = new URL(request.url).searchParams;
  const scope = params.get("scope") ?? "all";
  if (!SCOPES.has(scope)) {
    return Response.json({ error: "scope is community, global or all" }, { status: 400 });
  }
  const slug = params.get("communitySlug")?.trim();

  if (slug) {
    const community = await communityBySlug(slug);
    if (!community) return Response.json({ error: "unknown_community" }, { status: 404 });
    // Membership is what makes a Community's Markets visible, here as on the site.
    if (!(await isMember(community.id, caller.builderId))) {
      return Response.json({ error: "not_a_member" }, { status: 403 });
    }
    const markets = await openMarketsForCommunity(community.id);
    return Response.json({ markets: markets.map(serialize) });
  }

  const visible = await openMarketsFor(caller.builderId, caller.country);
  const markets =
    scope === "all" ? visible : visible.filter((market) => market.scope === scope);
  return Response.json({ markets: markets.map(serialize) });
}
