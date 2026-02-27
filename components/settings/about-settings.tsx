"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleArrowUp, Copy, ExternalLink, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRole } from "@/hooks/use-role";

interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releasesUrl: string;
  installType: string;
  installOS: string;
}

const DOCKER_IMAGE = "ghcr.io/go2engle/filebridge:latest";
const INSTALL_SCRIPT = "curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --upgrade";
const WINDOWS_SCRIPT = "$env:FILEBRIDGE_MODE = 'upgrade'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex";

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground">
      <span className="flex-1 truncate">{command}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={copy}
        title="Copy to clipboard"
      >
        <Copy className="h-3 w-3" />
        <span className="sr-only">Copy</span>
      </Button>
      {copied && <span className="text-xs text-green-600">Copied!</span>}
    </div>
  );
}

export function AboutSettings() {
  const { isAdmin } = useRole();
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState(false);

  const { data, isLoading } = useQuery<VersionInfo>({
    queryKey: ["version"],
    queryFn: () => fetch("/api/version").then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      fetch("/api/admin/update/apply", { method: "POST" }).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Update failed");
        }
        return r.json();
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Update initiated — the service will restart shortly.");
      setRestarting(true);
      // Poll /api/health until it responds, then reload
      const poll = setInterval(async () => {
        try {
          const hres = await fetch("/api/health");
          if (hres.ok) {
            clearInterval(poll);
            queryClient.invalidateQueries({ queryKey: ["version"] });
            window.location.reload();
          }
        } catch {
          // still down — keep polling
        }
      }, 3000);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to initiate update";
      toast.error(msg);
    },
  });

  const installType = data?.installType ?? "manual";
  const installOS = data?.installOS ?? "";
  const isNative = installType === "native";
  const isDocker = installType === "docker";
  const isWindows = installOS === "windows";
  const updateAvailable = data?.updateAvailable ?? false;

  const installTypeLabel =
    installType === "native"
      ? "Native install"
      : installType === "docker"
        ? "Docker"
        : "Manual / development";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">About &amp; Updates</CardTitle>
        <CardDescription>
          FileBridge version information and update management
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Version info */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Current version</span>
          <span className="font-mono">
            {isLoading ? "…" : `v${data?.currentVersion ?? "unknown"}`}
          </span>

          <span className="text-muted-foreground">Latest version</span>
          <span className="font-mono flex items-center gap-2">
            {isLoading ? (
              "…"
            ) : data?.latestVersion ? (
              <>
                v{data.latestVersion}
                {updateAvailable && (
                  <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px] gap-0.5 py-0">
                    <CircleArrowUp className="h-3 w-3" />
                    Update available
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-muted-foreground/60">Unable to check</span>
            )}
          </span>

          <span className="text-muted-foreground">Install type</span>
          <span>{isLoading ? "…" : installTypeLabel}</span>
        </div>

        {/* Native: one-click update (admin only) */}
        {isNative && updateAvailable && isAdmin && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 space-y-2">
            {restarting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RotateCcw className="h-4 w-4 animate-spin" />
                Service is restarting — this page will reload automatically…
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">A new version is available</p>
                <p className="text-xs text-muted-foreground">
                  Clicking &quot;Update Now&quot; will download the new release and restart the service.
                  Expect approximately 30 seconds of downtime.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={applyMutation.isPending || restarting}
                      >
                        {applyMutation.isPending ? (
                          <>
                            <RotateCcw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            Initiating…
                          </>
                        ) : (
                          <>
                            <CircleArrowUp className="h-3.5 w-3.5 mr-1.5" />
                            Update Now
                          </>
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Update FileBridge?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will upgrade FileBridge from{" "}
                          <strong>v{data?.currentVersion}</strong> to{" "}
                          <strong>v{data?.latestVersion}</strong>. The service
                          will stop briefly (~30 seconds) while the new version
                          is installed. Any transfers currently in progress may
                          be interrupted.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => applyMutation.mutate()}
                        >
                          Update Now
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <a
                    href={data?.releasesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View release notes
                  </a>
                </div>
              </>
            )}
          </div>
        )}

        {/* Native: no update or not admin — show manual upgrade command */}
        {isNative && (!updateAvailable || !isAdmin) && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">To upgrade manually:</p>
            {!isWindows ? (
              <CopyableCommand command={INSTALL_SCRIPT} />
            ) : (
              <CopyableCommand command={WINDOWS_SCRIPT} />
            )}
          </div>
        )}

        {/* Docker instructions */}
        {isDocker && (
          <div className="space-y-3">
            {updateAvailable && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                <CircleArrowUp className="h-4 w-4 shrink-0" />
                <span>
                  v{data?.latestVersion} is available. Pull the latest image to upgrade.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Pull the latest Docker image:</p>
              <CopyableCommand command={`docker pull ${DOCKER_IMAGE}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: Use{" "}
              <a
                href="https://containrrr.dev/watchtower/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                Watchtower
              </a>{" "}
              to keep your Docker container automatically up to date.
            </p>
          </div>
        )}

        {/* View release notes link (always) */}
        <div className="pt-1">
          <a
            href={data?.releasesUrl ?? "https://github.com/Go2Engle/FileBridge/releases/latest"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            View all releases on GitHub
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
