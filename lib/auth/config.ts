import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config — used by middleware (edge runtime).
 * Must NOT import anything that requires Node.js (fs, crypto, better-sqlite3, etc.).
 * Providers are NOT defined here — they're only needed for sign-in, not JWT validation.
 */

// Use secure cookies only when the configured URL is actually HTTPS.
// NODE_ENV=production on a plain-HTTP install would otherwise set __Secure-/__Host-
// prefixed cookies that browsers silently discard, causing MissingCSRF errors.
const configuredUrl =
  process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
const secureCookies = configuredUrl.startsWith("https://");

export const authConfig = {
  providers: [], // Populated in lib/auth/index.ts (Node runtime only)
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;

      // Public paths that don't require auth
      const isPublicPath =
        pathname === "/" ||
        pathname === "/login" ||
        pathname === "/setup" ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/setup") ||
        pathname === "/api/health";

      if (isPublicPath) return true;
      if (!isLoggedIn) return false;
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "viewer";
        token.isLocal = user.isLocal ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "admin" | "viewer") ?? "viewer";
        session.user.isLocal = (token.isLocal as boolean) ?? false;
      }
      return session;
    },
  },
  session: { strategy: "jwt", maxAge: 3600 },
  trustHost: true,
  cookies: {
    sessionToken: {
      name: secureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: secureCookies,
      },
    },
    callbackUrl: {
      name: secureCookies
        ? "__Secure-authjs.callback-url"
        : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: secureCookies,
      },
    },
    csrfToken: {
      name: secureCookies
        ? "__Host-authjs.csrf-token"
        : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: secureCookies,
      },
    },
  },
} satisfies NextAuthConfig;
