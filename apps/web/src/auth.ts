import NextAuth from "next-auth";
import type { DefaultSession, NextAuthConfig } from "next-auth";
// Makes the module resolvable for the JWT augmentation at the bottom of this file.
import type {} from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { builders } from "@/db/schema";
import { grantSignupCredits } from "@/lib/mint";
import { drizzleMintStore } from "@/lib/mint-store";

/*
  Auth.js v5. GitHub is the only real sign-in; the session is a JWT, so there is
  no adapter and no session table. The token carries the Builder id and handle so
  server components can render identity without a database round trip.

  Local development without OAuth credentials: when AUTH_GITHUB_ID is empty and
  DEV_USER is set, a Credentials provider signs in as that handle. It is disabled
  in production, twice over: the provider is not registered, and authorize refuses.
*/

const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID);
const devUser = process.env.DEV_USER?.replace(/^@/, "").trim();

/** True when the credentials bypass is available: development, no GitHub app, a DEV_USER. */
export const devSignInHandle =
  process.env.NODE_ENV !== "production" && !githubConfigured && devUser ? devUser : null;

/** GitHub serves a public avatar for any login, which keeps dev profiles realistic. */
const avatarForHandle = (handle: string) => `https://github.com/${handle}.png`;

type Identity = { githubId: string; handle: string; avatarUrl: string | null };

/*
  First sign-in creates the Builder, later sign-ins reuse it. github_id is the
  conflict target rather than handle, so a GitHub rename updates the handle in
  place instead of forking a second Builder.

  The signup grant is asked for on every sign-in rather than only on insert: the
  ledger ref makes the second ask a no-op, and a Builder created before the
  ledger existed still gets their Credits the next time they show up.
*/
async function upsertBuilder({ githubId, handle, avatarUrl }: Identity) {
  const [builder] = await db
    .insert(builders)
    .values({ githubId, handle, avatarUrl })
    .onConflictDoUpdate({ target: builders.githubId, set: { handle, avatarUrl } })
    .returning({ id: builders.id, handle: builders.handle, avatarUrl: builders.avatarUrl });
  if (builder) await grantSignupCredits(drizzleMintStore, builder.id);
  return builder;
}

const providers: NextAuthConfig["providers"] = [];

if (githubConfigured) {
  providers.push(
    GitHub({
      // Map GitHub's profile once so both providers hand the same shape to the jwt callback.
      profile: (profile) => ({
        id: String(profile.id),
        name: profile.login,
        image: profile.avatar_url,
      }),
    }),
  );
}

if (devSignInHandle) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Development",
      credentials: {},
      authorize: () => {
        if (process.env.NODE_ENV === "production" || !devSignInHandle) return null;
        return {
          id: `dev:${devSignInHandle}`,
          name: devSignInHandle,
          image: avatarForHandle(devSignInHandle),
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  pages: { signIn: "/signin" },
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on the sign-in request; that is where the Builder is upserted.
      if (user?.id && user.name) {
        const builder = await upsertBuilder({
          githubId: user.id,
          handle: user.name,
          avatarUrl: user.image ?? null,
        });
        token.builderId = builder.id;
        token.handle = builder.handle;
        token.picture = builder.avatarUrl;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.builderId ?? "";
      session.user.handle = token.handle ?? "";
      return session;
    },
  },
});

/** The signed-in Builder row, or null. Use on pages that need more than id and handle. */
export async function currentBuilder() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [builder] = await db.select().from(builders).where(eq(builders.id, session.user.id));
  return builder ?? null;
}

declare module "next-auth" {
  interface Session {
    user: { id: string; handle: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    builderId?: string;
    handle?: string;
  }
}
