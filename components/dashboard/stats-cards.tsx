"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, CheckCircle, Files, HardDrive } from "lucide-react";
import axios from "axios";
import { formatBytes } from "@/lib/utils";

interface DashboardStats {
  filesLast24h: number;
  filesLast7d: number;
  filesAllTime: number;
  bytesLast7d: number;
  successRate: number;
  activeJobs: number;
}

export function StatsCards() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => axios.get("/api/dashboard/stats").then((r) => r.data),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="py-4 gap-2">
            <CardHeader>
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 mb-1" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: "Files Transferred",
      value: (data?.filesLast24h ?? 0).toLocaleString(),
      sub: `${(data?.filesLast7d ?? 0).toLocaleString()} this week`,
      icon: Files,
    },
    {
      title: "Data Volume (7d)",
      value: formatBytes(data?.bytesLast7d ?? 0),
      sub: `${(data?.filesAllTime ?? 0).toLocaleString()} files all-time`,
      icon: HardDrive,
    },
    {
      title: "Success Rate",
      value: `${(data?.successRate ?? 0).toFixed(1)}%`,
      sub: "Last 7 days",
      icon: CheckCircle,
    },
    {
      title: "Active Jobs",
      value: (data?.activeJobs ?? 0).toString(),
      sub: "Scheduled transfers",
      icon: ArrowUpRight,
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ title, value, sub, icon: Icon }) => (
        <Card key={title} className="py-4 gap-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {title}
            </CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground mt-1">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
