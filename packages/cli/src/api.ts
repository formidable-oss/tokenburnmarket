/*
  The Collector's client for /api/me/*, the routes a connected Device may call
  on behalf of its Builder.

  One credential here, the Device token, and no signature: these are reads and
  one trade, not Usage. Signing exists so uploaded Usage cannot be forged; a
  trade spends the caller's own Credits, so the token is the whole authority.

  `fetch` is injected rather than reached for, which is what lets the tools be
  tested without a server.
*/
import type { DeviceConfig } from "./config.js";

export type Fetch = typeof globalThis.fetch;

export interface UsageWindow {
  costUsd: number;
  tokens: number;
}

export interface Stats {
  handle: string;
  credits: { balance: number };
  usage: { today: UsageWindow; week: UsageWindow; month: UsageWindow };
  trust: { provider: string; level: string }[];
  quarantinedDays: number;
}

export interface CommunityRow {
  slug: string;
  name: string;
}

export interface MarketOutcome {
  id: string;
  label: string;
  price: number;
}

export interface MarketRow {
  id: string;
  question: string;
  scope: "community" | "country" | "global";
  closesAt: string;
  communitySlug: string | null;
  communityName: string | null;
  country: string | null;
  outcomes: MarketOutcome[];
}

export interface TradeQuote {
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  shares: number;
  credits: number;
  averagePrice: number;
  priceBefore: number;
  priceAfter: number;
  balance: number;
  balanceAfter: number;
}

export interface TradeFill {
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  shares: number;
  credits: number;
  averagePrice: number;
  priceAfter: number;
}

export type TradeAnswer =
  | { placed: false; quote: TradeQuote }
  | { placed: true; tradeId: string; filled: TradeFill; balanceAfter: number };

export interface TradeRequestBody {
  marketId: string;
  outcomeId: string;
  side: "buy" | "sell";
  credits?: number;
  shares?: number;
  /** Absent or false means quote only. Nothing is ever spent without `true`. */
  confirm?: boolean;
}

export interface MarketsQuery {
  scope?: "community" | "global" | "all";
  communitySlug?: string;
}

/** What the server said when it refused, carrying the status so a caller can tell why. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MESSAGES: Record<string, string> = {
  missing_token: "This machine is not connected. Run: tokenburnmarket connect",
  bad_token: "This device is no longer recognised. Run: tokenburnmarket connect",
  revoked: "This device was revoked. Approve a new one in settings.",
};

export class ApiClient {
  constructor(
    private readonly config: DeviceConfig,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.config.serverUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${this.config.deviceToken}`,
        ...init?.headers,
      },
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? {} : JSON.parse(text);
    } catch {
      throw new ApiError(response.status, `${path} answered ${response.status} with no JSON.`);
    }

    if (!response.ok) {
      const body = parsed as { error?: string; message?: string };
      const code = body.error ?? "";
      throw new ApiError(
        response.status,
        body.message ?? MESSAGES[code] ?? `${path} answered ${response.status}. ${code}`.trim(),
      );
    }
    return parsed as T;
  }

  stats(): Promise<Stats> {
    return this.request<Stats>("/api/me/stats");
  }

  communities(): Promise<{ communities: CommunityRow[] }> {
    return this.request<{ communities: CommunityRow[] }>("/api/me/communities");
  }

  markets(query: MarketsQuery = {}): Promise<{ markets: MarketRow[] }> {
    const params = new URLSearchParams();
    if (query.scope) params.set("scope", query.scope);
    if (query.communitySlug) params.set("communitySlug", query.communitySlug);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<{ markets: MarketRow[] }>(`/api/me/markets${suffix}`);
  }

  trade(body: TradeRequestBody): Promise<TradeAnswer> {
    return this.request<TradeAnswer>("/api/me/trade", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
