import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  // Allow full bypass in development — never active in production
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_BYPASS_DEV === "true"
  ) {
    return NextResponse.next();
  }
  // @ts-expect-error NextAuth middleware signature
  return auth(request);
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
