import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { builders } from "@/db/schema";
import { grantSignupCredits } from "@/lib/mint";
import { drizzleMintStore } from "@/lib/mint-store";

export type AuthBuilderIdentity = {
  provider: string;
  githubId: string;
  handle: string;
  avatarUrl: string | null;
};

export type AuthBuilder = {
  id: string;
  handle: string;
  avatarUrl: string | null;
};

export interface AuthBuilderStore {
  hasGithubId(githubId: string): Promise<boolean>;
  claimLegacyHandle(identity: AuthBuilderIdentity): Promise<AuthBuilder | null>;
  upsertByGithubId(identity: AuthBuilderIdentity): Promise<AuthBuilder>;
}

type AuthAccount = { provider: string; providerAccountId: string } | null | undefined;
type AuthUser = { id: string; name: string; image?: string | null };

/** Auth.js generates `user.id` for OAuth, while the provider subject lives on the Account. */
export function authBuilderIdentity(account: AuthAccount, user: AuthUser): AuthBuilderIdentity {
  return {
    provider: account?.provider ?? "",
    githubId:
      account?.provider === "github" && account.providerAccountId
        ? account.providerAccountId
        : user.id,
    handle: user.name,
    avatarUrl: user.image ?? null,
  };
}

const isVerifiedGitHubIdentity = (identity: AuthBuilderIdentity) =>
  identity.provider === "github" && /^\d+$/.test(identity.githubId);

/**
 * Upgrade seeded and development identities when their current handle owner
 * proves ownership through GitHub. Real GitHub subjects are numeric, so a
 * nonnumeric stored subject is legacy data rather than another GitHub account.
 */
export async function persistAuthenticatedBuilder(
  store: AuthBuilderStore,
  identity: AuthBuilderIdentity,
): Promise<AuthBuilder> {
  if (isVerifiedGitHubIdentity(identity) && !(await store.hasGithubId(identity.githubId))) {
    const claimed = await store.claimLegacyHandle(identity);
    if (claimed) return claimed;
  }

  return store.upsertByGithubId(identity);
}

const builderColumns = {
  id: builders.id,
  handle: builders.handle,
  avatarUrl: builders.avatarUrl,
};

const drizzleAuthBuilderStore: AuthBuilderStore = {
  async hasGithubId(githubId) {
    const [builder] = await db
      .select({ id: builders.id })
      .from(builders)
      .where(eq(builders.githubId, githubId))
      .limit(1);
    return Boolean(builder);
  },

  async claimLegacyHandle(identity) {
    const [builder] = await db
      .update(builders)
      .set({
        githubId: identity.githubId,
        handle: identity.handle,
        avatarUrl: identity.avatarUrl,
      })
      .where(
        and(
          eq(builders.handle, identity.handle),
          sql`${builders.githubId} !~ '^[0-9]+$'`,
        ),
      )
      .returning(builderColumns);
    return builder ?? null;
  },

  async upsertByGithubId(identity) {
    const { githubId, handle, avatarUrl } = identity;
    const [builder] = await db
      .insert(builders)
      .values({ githubId, handle, avatarUrl })
      .onConflictDoUpdate({
        target: builders.githubId,
        set: { handle, avatarUrl },
      })
      .returning(builderColumns);
    if (!builder) throw new Error("Failed to persist authenticated Builder.");
    return builder;
  },
};

/**
 * Persist the authenticated identity, then idempotently ensure it has the
 * signup grant. Existing Builder ids survive a legacy identity claim, so every
 * Device, Usage row, membership, position and ledger entry stays attached.
 */
export async function upsertAuthenticatedBuilder(identity: AuthBuilderIdentity) {
  const builder = await persistAuthenticatedBuilder(drizzleAuthBuilderStore, identity);
  await grantSignupCredits(drizzleMintStore, builder.id);
  return builder;
}
