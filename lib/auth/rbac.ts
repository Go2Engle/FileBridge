import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

export type Role = "admin" | "viewer";

type AuthSuccess = { session: Session };
type AuthFailure = { error: NextResponse };

/** Require any authenticated user. Returns session or error response. */
export async function requireAuth(): Promise<AuthSuccess | AuthFailure> {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session };
}

/** Require a specific role. Returns session or error response. */
export async function requireRole(
  role: Role
): Promise<AuthSuccess | AuthFailure> {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (role === "admin" && session.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}
