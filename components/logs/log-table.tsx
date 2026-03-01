"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import axios from "axios";
import { formatBytes, parseDBDate } from "@/lib/utils";
import { format } from "date-fns";
import { CircleAlert, Search, Webhook, Terminal } from "lucide-react";
import { useTimeFormat, TIME_FORMATS } from "@/hooks/use-time-format";
import type { Job } from "@/lib/db/schema";

// Raw snake_case from SQLite UNION query
interface TransferLogEntry {
  log_type: "transfer";
  id: number;
  job_id: number;
  job_run_id: number;
  job_name: string | null;
  file_name: string;
  source_path: string;
  destination_path: string;
  file_size: number;
  timestamp: string;
  status: "success" | "failure";
  error_message: string | null;
}

interface HookLogEntry {
  log_type: "hook";
  id: number;
  job_id: number;
  job_run_id: number;
  job_name: string | null;
  hook_name: string;
  hook_type: string;
  trigger: string;
  duration_ms: number | null;
  timestamp: string;
  status: "success" | "failure";
  error_message: string | null;
}

type LogEntry = TransferLogEntry | HookLogEntry;

const PAGE_SIZE = 25;

export function LogTable() {
  const timeFormat = useTimeFormat();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failure">("all");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "transfer" | "hook">("all");

  const { data: jobsList } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: () => axios.get("/api/jobs").then((r) => r.data),
  });

  const { data, isLoading } = useQuery<{ logs: LogEntry[]; total: number }>({
    queryKey: ["logs", page, search, statusFilter, jobFilter, typeFilter],
    queryFn: () =>
      axios
        .get("/api/logs", {
          params: {
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
            search: search || undefined,
            status: statusFilter !== "all" ? statusFilter : undefined,
            jobId: jobFilter !== "all" ? jobFilter : undefined,
            type: typeFilter !== "all" ? typeFilter : undefined,
          },
        })
        .then((r) => r.data),
    refetchInterval: 30_000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  function resetPage() { setPage(0); }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
          />
        </div>
        <Select value={jobFilter} onValueChange={(v) => { setJobFilter(v); resetPage(); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {jobsList?.map((job) => (
              <SelectItem key={job.id} value={String(job.id)}>{job.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); resetPage(); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as typeof typeFilter); resetPage(); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="transfer">Transfers</SelectItem>
            <SelectItem value="hook">Hooks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data?.logs.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No logs found.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Size / Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logs.map((log) => {
                const isHook = log.log_type === "hook";
                const hookLog = isHook ? (log as HookLogEntry) : null;
                const transferLog = !isHook ? (log as TransferLogEntry) : null;

                return (
                  <TableRow key={`${log.log_type}-${log.id}`} className={isHook ? "bg-muted/30" : undefined}>
                    {/* Job */}
                    <TableCell className="text-sm max-w-36 truncate">
                      {log.job_name ?? <span className="text-muted-foreground italic">deleted</span>}
                    </TableCell>

                    {/* Name */}
                    <TableCell className="font-medium max-w-48">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 max-w-48 cursor-default">
                              {isHook && (
                                hookLog!.hook_type === "webhook"
                                  ? <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                  : <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              )}
                              <span className="truncate">
                                {isHook ? hookLog!.hook_name : transferLog!.file_name}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-sm break-all">
                            <p className="text-xs">
                              {isHook ? hookLog!.hook_name : transferLog!.file_name}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>

                    {/* Details */}
                    <TableCell className="text-xs text-muted-foreground max-w-52">
                      {isHook ? (
                        <span className="capitalize">
                          {hookLog!.trigger?.replace("_", " ")} · {hookLog!.hook_type}
                        </span>
                      ) : (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block font-mono max-w-52 cursor-default">
                                {transferLog!.source_path} → {transferLog!.destination_path}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm break-all">
                              <p className="text-xs font-mono">{transferLog!.source_path}</p>
                              <p className="text-xs font-mono mt-1">{transferLog!.destination_path}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>

                    {/* Size / Duration */}
                    <TableCell className="text-sm whitespace-nowrap">
                      {isHook
                        ? (hookLog!.duration_ms != null ? `${hookLog!.duration_ms}ms` : "—")
                        : formatBytes(transferLog!.file_size)}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={log.status === "success" ? "success" : "destructive"}>
                          {log.status}
                        </Badge>
                        {log.status === "failure" && log.error_message && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs">
                                <p className="text-xs">{log.error_message}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>

                    {/* Time */}
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(parseDBDate(log.timestamp), `MMM d, ${TIME_FORMATS[timeFormat].withSec}`)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data.total.toLocaleString()} total entries
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages || 1}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
