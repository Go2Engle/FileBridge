"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleArrowUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releasesUrl: string;
  installType: string;
}

export function VersionBadge() {
  const { data } = useQuery<VersionInfo>({
    queryKey: ["version"],
    queryFn: () => fetch("/api/version").then((r) => r.json()),
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: false,
  });

  const currentVersion = data?.currentVersion ?? "…";
  const updateAvailable = data?.updateAvailable ?? false;
  const isNative = data?.installType === "native";

  // All install types go to Settings > About — native users get the one-click
  // updater there, everyone else can view release notes from the same page.
  const tooltipText = isNative
    ? `v${data?.latestVersion} is available — click to update`
    : `v${data?.latestVersion} is available — click for details`;

  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <span className="text-[11px] text-sidebar-foreground/40 font-mono">
        v{currentVersion}
      </span>

      {updateAvailable && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href="/settings?tab=about"
                className="flex items-center gap-1 text-[11px] font-medium text-amber-500 hover:text-amber-400 transition-colors"
              >
                <CircleArrowUp className="h-3 w-3" />
                Update available
              </a>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{tooltipText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
