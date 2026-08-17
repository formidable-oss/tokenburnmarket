/*
  The admin desk exists only for admins. 404 rather than 403, so the page does
  not tell a stranger it is there.
*/
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth }));

const quarantineQueue = vi.fn(async () => []);
const openSiteMarkets = vi.fn(async () => []);
vi.mock("@/lib/admin-queries", () => ({ quarantineQueue, openSiteMarkets, QUEUE_LIMIT: 200 }));

vi.mock("./actions", () => ({ reviewQuarantinedUsage: async () => {} }));

const { default: AdminPage } = await import("./page");

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_HANDLES;
});

/** Next signals a 404 by throwing; the digest is what the router matches on. */
async function statusOf(page: () => Promise<unknown>): Promise<string> {
  try {
    await page();
    return "rendered";
  } catch (error) {
    return String((error as { digest?: string }).digest ?? error);
  }
}

describe("/admin", () => {
  it("is not found for a signed out visitor", async () => {
    process.env.ADMIN_HANDLES = "alex";
    auth.mockResolvedValue(null);

    expect(await statusOf(AdminPage)).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("is not found for a signed in builder who is not on the list", async () => {
    process.env.ADMIN_HANDLES = "alex";
    auth.mockResolvedValue({ user: { id: "b1", handle: "theo" } });

    expect(await statusOf(AdminPage)).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(quarantineQueue).not.toHaveBeenCalled();
  });

  it("renders for a handle on the list, and reads the queue", async () => {
    process.env.ADMIN_HANDLES = "@Alex, theo";
    auth.mockResolvedValue({ user: { id: "b1", handle: "alex" } });

    expect(await statusOf(AdminPage)).toBe("rendered");
    expect(quarantineQueue).toHaveBeenCalledOnce();
    expect(openSiteMarkets).toHaveBeenCalledOnce();
  });
});
