"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import axios from "axios";
import { formatBytes } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface LogEntry {
  id: number;
  fileName: string;
  sourcePath: string;
  destinationPath: string;
  fileSize: number;
  transferredAt: string;
  status: "success" | "failure";
  errorMessage?: string | null;
  jobName?: string;
}

export function ActivityFeed() {
  const { data, isLoading } = useQuery<LogEntry[]>({
    queryKey: ["activity-feed"],
    queryFn: () =>
      axios.get("/api/logs?limit=20").then((r) => r.data.logs),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-80">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No recent transfers
            </p>
          ) : (
            <div className="divide-y">
              {data.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div
                    className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                      log.status === "success"
                        ? "bg-emerald-500"
                        : "bg-destructive"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{log.fileName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {log.sourcePath} → {log.destinationPath}
                    </p>
                    {log.errorMessage && (
                      <p className="text-xs text-destructive truncate mt-0.5">
                        {log.errorMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant={log.status === "success" ? "success" : "destructive"}
                      className="text-[10px] py-0"
                    >
                      {log.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatBytes(log.fileSize)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(log.transferredAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
