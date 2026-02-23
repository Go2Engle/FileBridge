"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const DEV_BYPASS =
  process.env.NEXT_PUBLIC_AUTH_BYPASS_DEV === "true" &&
  process.env.NODE_ENV === "development";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!DEV_BYPASS && status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (DEV_BYPASS) {
    return (
      <>
        <div className="fixed bottom-3 right-3 z-50 rounded-md bg-amber-400/90 px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow-sm">
          DEV BYPASS
        </div>
        {children}
      </>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
