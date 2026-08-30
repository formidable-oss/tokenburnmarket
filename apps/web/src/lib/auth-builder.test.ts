import { describe, expect, it, vi } from "vitest";
import {
  persistAuthenticatedBuilder,
  type AuthBuilder,
  type AuthBuilderIdentity,
  type AuthBuilderStore,
} from "./auth-builder";

const identity: AuthBuilderIdentity = {
  provider: "github",
  githubId: "12345678",
  handle: "ada",
  avatarUrl: "https://avatars.githubusercontent.com/u/12345678",
};

const builder: AuthBuilder = {
  id: "builder-1",
  handle: identity.handle,
  avatarUrl: identity.avatarUrl,
};

function store(overrides: Partial<AuthBuilderStore> = {}): AuthBuilderStore {
  return {
    hasGithubId: vi.fn().mockResolvedValue(false),
    claimLegacyHandle: vi.fn().mockResolvedValue(null),
    upsertByGithubId: vi.fn().mockResolvedValue(builder),
    ...overrides,
  };
}

describe("persistAuthenticatedBuilder", () => {
  it("claims a legacy same-handle Builder before inserting the verified GitHub identity", async () => {
    const claimed = { ...builder, id: "legacy-builder" };
    const authStore = store({ claimLegacyHandle: vi.fn().mockResolvedValue(claimed) });

    await expect(persistAuthenticatedBuilder(authStore, identity)).resolves.toEqual(claimed);
    expect(authStore.hasGithubId).toHaveBeenCalledWith(identity.githubId);
    expect(authStore.claimLegacyHandle).toHaveBeenCalledWith(identity);
    expect(authStore.upsertByGithubId).not.toHaveBeenCalled();
  });

  it("uses the normal upsert when the GitHub identity already exists", async () => {
    const authStore = store({ hasGithubId: vi.fn().mockResolvedValue(true) });

    await expect(persistAuthenticatedBuilder(authStore, identity)).resolves.toEqual(builder);
    expect(authStore.claimLegacyHandle).not.toHaveBeenCalled();
    expect(authStore.upsertByGithubId).toHaveBeenCalledWith(identity);
  });

  it("falls back to the normal upsert when no legacy handle exists", async () => {
    const authStore = store();

    await expect(persistAuthenticatedBuilder(authStore, identity)).resolves.toEqual(builder);
    expect(authStore.claimLegacyHandle).toHaveBeenCalledWith(identity);
    expect(authStore.upsertByGithubId).toHaveBeenCalledWith(identity);
  });

  it("never claims a legacy row for the local development provider", async () => {
    const authStore = store();
    const devIdentity = { ...identity, provider: "dev", githubId: "dev:ada" };

    await expect(persistAuthenticatedBuilder(authStore, devIdentity)).resolves.toEqual(builder);
    expect(authStore.hasGithubId).not.toHaveBeenCalled();
    expect(authStore.claimLegacyHandle).not.toHaveBeenCalled();
    expect(authStore.upsertByGithubId).toHaveBeenCalledWith(devIdentity);
  });
});
