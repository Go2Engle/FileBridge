import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "viewer";
      isLocal: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "admin" | "viewer";
    isLocal?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "admin" | "viewer";
    isLocal?: boolean;
  }
}
