import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.AUTH_SECRET = "test-secret-for-device-tokens-0123456789";

/*
  The database is stubbed to one row, which is all `requireDevice` reads. What is
  under test is the decision: who does this token belong to, and is that Device
  still allowed. Everything else is drizzle's job.
*/
const row = vi.hoisted(() => ({
  current: null as { device: { id: string; revokedAt: Date | null }; handle: string } | null,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => (row.current ? [row.current] : []) }),
        }),
      }),
    }),
  },
}));

const { bearerToken, issueDeviceToken, requireDevice } = await import("./device-auth");

const DEVICE_ID = "c52d6777-b5f0-470f-81b2-33eb61c2c33a";
const withToken = (token: string) =>
  new Request("https://tokenburnmarket.com/api/sync", {
    headers: { authorization: `Bearer ${token}` },
  });

beforeEach(() => {
  row.current = { device: { id: DEVICE_ID, revokedAt: null }, handle: "ada" };
});

describe("bearerToken", () => {
  it("reads the scheme case insensitively and ignores anything else", () => {
    expect(bearerToken(withToken("abc"))).toBe("abc");
    expect(
      bearerToken(new Request("https://x.test", { headers: { authorization: "bearer abc" } })),
    ).toBe("abc");
    expect(
      bearerToken(new Request("https://x.test", { headers: { authorization: "Basic abc" } })),
    ).toBeNull();
    expect(
      bearerToken(new Request("https://x.test", { headers: { authorization: "Bearer  " } })),
    ).toBeNull();
    expect(bearerToken(new Request("https://x.test"))).toBeNull();
  });
});

describe("requireDevice", () => {
  it("accepts a token it issued and returns the Device with its Builder's handle", async () => {
    const result = await requireDevice(withToken(await issueDeviceToken(DEVICE_ID)));
    expect(result).toMatchObject({ ok: true, handle: "ada" });
  });

  it("refuses a request with no token", async () => {
    const result = await requireDevice(new Request("https://x.test"));
    expect(result).toEqual({ ok: false, status: 401, error: "missing_token" });
  });

  it("refuses a token that is not one of ours", async () => {
    for (const token of ["not.a.jwt", "", "a.b.c"]) {
      expect(await requireDevice(withToken(token))).toMatchObject({ status: 401 });
    }
  });

  it("refuses a token whose Device no longer exists", async () => {
    row.current = null;
    const result = await requireDevice(withToken(await issueDeviceToken(DEVICE_ID)));
    expect(result).toEqual({ ok: false, status: 401, error: "bad_token" });
  });

  it("refuses a revoked Device on its next request, token or not", async () => {
    row.current = { device: { id: DEVICE_ID, revokedAt: new Date() }, handle: "ada" };
    const result = await requireDevice(withToken(await issueDeviceToken(DEVICE_ID)));
    expect(result).toEqual({ ok: false, status: 403, error: "revoked" });
  });
});
