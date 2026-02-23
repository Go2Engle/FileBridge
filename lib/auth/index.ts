import NextAuth from "next-auth";
import type { Session, NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import AzureADProvider from "next-auth/providers/azure-ad";
import GitHub from "next-auth/providers/github";
import { authConfig } from "./config";
import { logAudit } from "@/lib/audit";
import {
  getUserByUsername,
  getUserByEmail,
  getUserBySsoId,
  verifyPassword,
  updateLastLogin,
} from "@/lib/db/users";
import { getAllEnabledSsoConfigs } from "@/lib/db/sso-config";

// Lazy-init cache — re-created when SSO config changes
let _auth: NextAuthResult | null = null;

function buildProviders() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providers: any[] = [];

  // Always add Credentials provider for local auth
  providers.push(
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!username || !password) return null;

        const user = getUserByUsername(username);
        if (!user || !user.passwordHash || !user.isActive) return null;

        const valid = await verifyPassword(user, password);
        if (!valid) return null;

        updateLastLogin(user.id);
        return {
          id: String(user.id),
          name: user.displayName,
          email: user.email,
          role: user.role,
          isLocal: true,
        };
      },
    })
  );

  // Dynamic SSO providers from DB
  try {
    const ssoConfigs = getAllEnabledSsoConfigs();
    for (const { provider, config } of ssoConfigs) {
      if (provider === "azure-ad" && config.clientId && config.clientSecret) {
        providers.push(
          AzureADProvider({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            issuer: config.tenantId
              ? `https://login.microsoftonline.com/${config.tenantId}/v2.0`
              : undefined,
            authorization: {
              params: {
                scope: "openid profile email User.Read",
              },
            },
          })
        );
      } else if (
        provider === "github" &&
        config.clientId &&
        config.clientSecret
      ) {
        providers.push(
          GitHub({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
          })
        );
      }
    }
  } catch {
    // DB may not be ready yet during build — skip SSO providers
  }

  return providers;
}

function initAuth(): NextAuthResult {
  const result = NextAuth({
    ...authConfig,
    providers: buildProviders(),
    callbacks: {
      ...authConfig.callbacks,
      async signIn({ user, account }) {
        // Local credentials — already verified in authorize()
        if (account?.provider === "credentials") {
          return true;
        }

        // SSO login — match to a pre-created user in the DB
        if (account) {
          let dbUser = getUserBySsoId(
            account.provider,
            account.providerAccountId
          );

          if (!dbUser && user.email) {
            // Try matching by email
            dbUser = getUserByEmail(user.email);
            if (dbUser && !dbUser.ssoProvider) {
              // Link SSO identity to existing user
              const { updateUser } = require("@/lib/db/users");
              updateUser(dbUser.id, {
                ssoProvider: account.provider,
                ssoId: account.providerAccountId,
                isLocal: false,
              });
            }
          }

          if (!dbUser || !dbUser.isActive) {
            // SSO user not pre-created in DB — deny access
            return false;
          }

          // Stamp role info onto the user object for JWT callback
          user.id = String(dbUser.id);
          user.role = dbUser.role;
          user.isLocal = false;
          user.name = dbUser.displayName;

          updateLastLogin(dbUser.id);
        }

        return true;
      },
    },
    events: {
      async signIn({ user }) {
        logAudit({
          userId: user.email ?? user.name ?? "unknown",
          action: "login",
          resource: "auth",
          details: { outcome: "success" },
        });
      },
    },
  });

  return result;
}

function getAuth(): NextAuthResult {
  if (!_auth) {
    _auth = initAuth();
  }
  return _auth;
}

/** Call after SSO config changes to reload providers on next request. */
export function refreshAuthConfig(): void {
  _auth = null;
}

// Proxy exports — delegate to lazy-initialized instance
export const handlers = {
  GET: (...args: Parameters<NextAuthResult["handlers"]["GET"]>) =>
    getAuth().handlers.GET(...args),
  POST: (...args: Parameters<NextAuthResult["handlers"]["POST"]>) =>
    getAuth().handlers.POST(...args),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth = (...args: any[]): any => (getAuth().auth as any)(...args);

export const signIn = (
  ...args: Parameters<NextAuthResult["signIn"]>
): ReturnType<NextAuthResult["signIn"]> => getAuth().signIn(...args);

export const signOut = (
  ...args: Parameters<NextAuthResult["signOut"]>
): ReturnType<NextAuthResult["signOut"]> => getAuth().signOut(...args);

// Dev bypass
const isDevBypass =
  process.env.NODE_ENV === "development" &&
  process.env.AUTH_BYPASS_DEV === "true";

const DEV_SESSION: Session = {
  user: {
    id: "0",
    name: "Dev User",
    email: "dev@localhost",
    image: null,
    role: "admin",
    isLocal: true,
  },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

export async function getSession(): Promise<Session | null> {
  if (isDevBypass) return DEV_SESSION;
  return auth() as Promise<Session | null>;
}
