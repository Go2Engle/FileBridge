import NextAuth from "next-auth";
import type { Session } from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

const isDevBypass =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_BYPASS_DEV === "true";

/** Dev bypass session — only ever populated when AUTH_BYPASS_DEV=true in development */
const DEV_SESSION: Session = {
  user: {
    name: "Dev User",
    email: "dev@localhost",
    image: null,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

/**
 * Drop-in replacement for `auth()` in API routes.
 * Returns a mock session when AUTH_BYPASS_DEV=true in development,
 * otherwise delegates to the real NextAuth `auth()`.
 */
export async function getSession(): Promise<Session | null> {
  if (isDevBypass) return DEV_SESSION;
  return auth();
}
