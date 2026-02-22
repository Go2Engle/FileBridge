import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth/edge";

export async function middleware(request: NextRequest) {
  // Attach a correlation ID to every request so API routes and downstream
  // code can emit logs with a shared requestId for cross-component tracing.
  const requestId =
    request.headers.get("x-request-id") ?? crypto.randomUUID();

  // Allow full bypass in development — never active in production
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_BYPASS_DEV === "true"
  ) {
    const response = NextResponse.next();
    response.headers.set("x-request-id", requestId);
    return response;
  }

  // @ts-expect-error NextAuth middleware signature
  const response = await auth(request);
  // NextAuth may return a redirect/null — only set header on NextResponse
  if (response instanceof NextResponse) {
    response.headers.set("x-request-id", requestId);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
