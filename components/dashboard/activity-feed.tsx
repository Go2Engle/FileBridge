"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import axios from "axios";
import { formatBytes, parseDBDate } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface LogEntry {
  id: number;
  file_name: string;
  source_path: string;
  destination_path: string;
  file_size: number;
  timestamp: string;
  status: "success" | "failure";
  error_message?: string | null;
  job_name?: string;
}

export function ActivityFeed() {
  const { data, isLoading } = useQuery<LogEntry[]>({
    queryKey: ["activity-feed"],
    queryFn: () =>
      axios.get("/api/logs?limit=20&type=transfer").then((r) => r.data.logs),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-80 overflow-y-auto">
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
                  className="flex items-center gap-3 px-4 py-4 hover:bg-muted/30 transition-colors"
                >
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      log.status === "success"
                        ? "bg-emerald-500"
                        : "bg-destructive"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{log.file_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {log.source_path} → {log.destination_path}
                    </p>
                    {log.error_message && (
                      <p className="text-xs text-destructive truncate mt-0.5">
                        {log.error_message}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      variant={log.status === "success" ? "success" : "destructive"}
                      className="text-xs"
                    >
                      {log.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(log.file_size)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(parseDBDate(log.timestamp), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
