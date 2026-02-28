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
import { CircleAlert, Search } from "lucide-react";
import { useTimeFormat, TIME_FORMATS } from "@/hooks/use-time-format";
import type { TransferLog } from "@/lib/db/schema";
import type { Job } from "@/lib/db/schema";

interface LogEntry extends TransferLog {
  jobName: string | null;
}

const PAGE_SIZE = 25;

export function LogTable() {
  const timeFormat = useTimeFormat();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failure">("all");
  const [jobFilter, setJobFilter] = useState<string>("all");

  // Fetch jobs for the filter dropdown
  const { data: jobsList } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: () => axios.get("/api/jobs").then((r) => r.data),
  });

  const { data, isLoading } = useQuery<{ logs: LogEntry[]; total: number }>({
    queryKey: ["logs", page, search, statusFilter, jobFilter],
    queryFn: () =>
      axios
        .get("/api/logs", {
          params: {
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
            search: search || undefined,
            status: statusFilter !== "all" ? statusFilter : undefined,
            jobId: jobFilter !== "all" ? jobFilter : undefined,
          },
        })
        .then((r) => r.data),
    refetchInterval: 30_000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search file name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Select
          value={jobFilter}
          onValueChange={(v) => {
            setJobFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All jobs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jobs</SelectItem>
            {jobsList?.map((job) => (
              <SelectItem key={job.id} value={String(job.id)}>
                {job.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as typeof statusFilter);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failure">Failure</SelectItem>
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
          <p className="text-sm">No transfer logs found.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Transferred</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-sm max-w-36 truncate">
                    {log.jobName ?? <span className="text-muted-foreground italic">deleted</span>}
                  </TableCell>
                  <TableCell className="font-medium max-w-48 truncate">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate block max-w-48 cursor-default">{log.fileName}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-sm break-all">
                          <p className="text-xs">{log.fileName}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-40 truncate text-muted-foreground">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate block max-w-40 cursor-default">{log.sourcePath}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-sm break-all">
                          <p className="text-xs font-mono">{log.sourcePath}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-40 truncate text-muted-foreground">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate block max-w-40 cursor-default">{log.destinationPath}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-sm break-all">
                          <p className="text-xs font-mono">{log.destinationPath}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatBytes(log.fileSize)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={log.status === "success" ? "success" : "destructive"}
                      >
                        {log.status}
                      </Badge>
                      {log.status === "failure" && log.errorMessage && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-xs">
                              <p className="text-xs">{log.errorMessage}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {format(parseDBDate(log.transferredAt), `MMM d, ${TIME_FORMATS[timeFormat].withSec}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data.total.toLocaleString()} total entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 0}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
