"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import axios from "axios";
import { formatDistanceToNow } from "date-fns";
import { parseDBDate } from "@/lib/utils";

interface JobStatus {
  id: number;
  name: string;
  status: "active" | "inactive" | "running" | "error";
  schedule: string;
  lastRunAt?: string | null;
}

const statusVariant: Record<
  JobStatus["status"],
  "success" | "secondary" | "warning" | "destructive"
> = {
  active: "success",
  inactive: "secondary",
  running: "warning",
  error: "destructive",
};

export function JobStatusList() {
  const { data, isLoading } = useQuery<JobStatus[]>({
    queryKey: ["jobs"],
    queryFn: () => axios.get("/api/jobs").then((r) => r.data),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No jobs configured
          </p>
        ) : (
          <div className="space-y-3">
            {data.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{job.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.lastRunAt
                      ? `Last run ${formatDistanceToNow(parseDBDate(job.lastRunAt), { addSuffix: true })}`
                      : "Never run"}
                  </p>
                </div>
                <Badge variant={statusVariant[job.status]} className="shrink-0 capitalize">
                  {job.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
