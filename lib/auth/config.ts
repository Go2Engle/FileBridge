import type { NextAuthConfig } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";

function isUserAuthorized(email?: string | null, groups?: string[]): boolean {
  const allowedEmails = process.env.ALLOWED_EMAILS;
  const allowedGroupIds = process.env.ALLOWED_GROUP_IDS;

  // No restrictions — allow all authenticated users
  if (!allowedEmails && !allowedGroupIds) {
    return true;
  }

  if (allowedEmails && email) {
    const emailList = allowedEmails.split(",").map((e) => e.trim().toLowerCase());
    if (emailList.includes(email.toLowerCase())) return true;
  }

  if (allowedGroupIds && groups && groups.length > 0) {
    const groupList = allowedGroupIds.split(",").map((g) => g.trim());
    if (groups.some((group) => groupList.includes(group))) return true;
  }

  return false;
}

export const authConfig = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`,
      authorization: {
        params: {
          scope: "openid profile email User.Read GroupMember.Read.All",
        },
      },
    }),
  ],
  pages: {
    signIn: "/",
    error: "/",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      let groups: string[] = [];

      if ((profile as Record<string, unknown>)?.groups) {
        groups = (profile as Record<string, unknown>).groups as string[];
      } else if (account?.access_token) {
        try {
          const response = await fetch(
            "https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.group?$select=id",
            { headers: { Authorization: `Bearer ${account.access_token}` } }
          );
          if (response.ok) {
            const data = await response.json();
            groups = data.value?.map((g: { id: string }) => g.id) || [];
          }
        } catch (error) {
          console.error("[Auth] Error fetching groups:", error);
        }
      }

      const authorized = isUserAuthorized(user.email, groups);
      if (!authorized) {
        console.log(`[Auth] Access denied for: ${user.email}`);
        return false;
      }
      console.log(`[Auth] Access granted for: ${user.email}`);
      return true;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublicPath =
        nextUrl.pathname === "/" ||
        nextUrl.pathname.startsWith("/api/auth");
      if (isPublicPath) return true;
      if (!isLoggedIn) return false;
      return true;
    },
    async jwt({ token, account, user }) {
      if (account && user) {
        return { ...token };
      }
      return token;
    },
    async session({ session }) {
      return session;
    },
  },
  session: { strategy: "jwt" },
  trustHost: true,
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.callback-url"
          : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-authjs.csrf-token"
          : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
} satisfies NextAuthConfig;
