import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
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

  const response = await auth(request);
  if (response instanceof NextResponse) {
    response.headers.set("x-request-id", requestId);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|api/setup|api/health|_next/static|_next/image|favicon.ico|login|setup).*)",
  ],
};
