/**
 * Edge-safe NextAuth instance — used ONLY by middleware.
 * Must not import anything that requires Node.js (fs, crypto, better-sqlite3, etc.).
 */
import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { auth } = NextAuth(authConfig);
