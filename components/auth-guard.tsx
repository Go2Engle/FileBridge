"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeftRight, Lock, LogIn, LogOut } from "lucide-react";

// Isolated so useSearchParams lives inside its own Suspense boundary
function AuthErrorReader({ onError }: { onError: (err: string | null) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "AccessDenied") onError("access_denied");
    else if (error) onError("unknown");
  }, [searchParams, onError]);
  return null;
}

const DEV_BYPASS =
  process.env.NEXT_PUBLIC_AUTH_BYPASS_DEV === "true" &&
  process.env.NODE_ENV === "development";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [authError, setAuthError] = useState<string | null>(null);

  // Skip all auth checks when dev bypass is active
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

  if (authError === "access_denied") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md border-destructive">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Access Denied</CardTitle>
            <CardDescription className="text-destructive">
              Your account is not authorized to access FileBridge
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Your Azure account was authenticated, but you don&apos;t have
              permission to access this portal.
            </p>
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Need access?</strong>
                <br />
                Contact your administrator to be added to an authorized group or
                email allowlist.
              </p>
            </div>
            <div className="flex justify-center pt-2">
              <Button onClick={() => signOut({ callbackUrl: "/" })} variant="outline" size="sm">
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <Suspense>
          <AuthErrorReader onError={setAuthError} />
        </Suspense>
        <div className="fixed inset-0 w-screen h-screen">
          <div className="grid h-full lg:grid-cols-[1.1fr_1fr]">
            {/* Login panel */}
            <div className="flex items-center justify-center px-6 py-12 bg-background">
              <div className="w-full max-w-md space-y-8">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                      <Lock className="h-4 w-4 text-primary" />
                    </span>
                    Secure access
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="h-7 w-7" />
                      <h1 className="text-3xl font-bold tracking-tight">FileBridge</h1>
                    </div>
                    <p className="text-muted-foreground">
                      Automated file transfer scheduling and monitoring. Sign in
                      with your Azure AD account to continue.
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  <Button onClick={() => signIn("azure-ad")} size="lg" className="w-full">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign in with Microsoft
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Need access? Contact your administrator.
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-4 text-xs text-muted-foreground">
                  FileBridge automates file transfers between SFTP and SMB shares
                  with job scheduling, audit logging, and real-time monitoring.
                </div>
              </div>
            </div>
            {/* Background panel */}
            <div className="relative hidden overflow-hidden lg:flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
              <div className="absolute inset-0 opacity-10">
                <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
              </div>
              <div className="relative z-10 text-center text-white p-8 space-y-4">
                <ArrowLeftRight className="h-16 w-16 mx-auto opacity-80" />
                <h2 className="text-3xl font-bold">FileBridge</h2>
                <p className="text-slate-300 max-w-xs mx-auto">
                  Enterprise file transfer automation — SFTP, SMB, and beyond.
                </p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return <>{children}</>;
}
