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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import axios from "axios";
import { parseDBDate } from "@/lib/utils";
import { format } from "date-fns";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import type { AuditLog } from "@/lib/db/schema";

interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
}

const PAGE_SIZE = 50;

const ACTION_COLORS: Record<AuditLog["action"], string> = {
  create: "bg-green-500/15 text-green-700 dark:text-green-400",
  update: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/15 text-red-700 dark:text-red-400",
  execute: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  login: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  logout: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
  settings_change: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const ACTION_LABELS: Record<AuditLog["action"], string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  execute: "Execute",
  login: "Login",
  logout: "Logout",
  settings_change: "Settings",
};

const RESOURCE_LABELS: Record<AuditLog["resource"], string> = {
  connection: "Connection",
  job: "Job",
  settings: "Settings",
  job_run: "Job Run",
  auth: "Auth",
  user: "User",
};

export function AuditLogTable() {
  const [page, setPage] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceFilter, setResourceFilter] = useState<string>("all");

  const { data, isLoading } = useQuery<AuditLogResponse>({
    queryKey: ["audit-logs", page, userSearch, actionFilter, resourceFilter],
    queryFn: () =>
      axios
        .get("/api/audit-logs", {
          params: {
            offset: page * PAGE_SIZE,
            limit: PAGE_SIZE,
            ...(userSearch ? { userId: userSearch } : {}),
            ...(actionFilter !== "all" ? { action: actionFilter } : {}),
            ...(resourceFilter !== "all" ? { resource: resourceFilter } : {}),
          },
        })
        .then((r) => r.data),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function resetPage() {
    setPage(0);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by user..."
            className="pl-8"
            value={userSearch}
            onChange={(e) => { setUserSearch(e.target.value); resetPage(); }}
          />
        </div>

        <Select
          value={actionFilter}
          onValueChange={(v) => { setActionFilter(v); resetPage(); }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="update">Update</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
            <SelectItem value="execute">Execute</SelectItem>
            <SelectItem value="login">Login</SelectItem>
            <SelectItem value="settings_change">Settings</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={resourceFilter}
          onValueChange={(v) => { setResourceFilter(v); resetPage(); }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Resource" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All resources</SelectItem>
            <SelectItem value="connection">Connection</SelectItem>
            <SelectItem value="job">Job</SelectItem>
            <SelectItem value="settings">Settings</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground ml-auto">
          {total.toLocaleString()} event{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="w-28">Action</TableHead>
              <TableHead className="w-28">Resource</TableHead>
              <TableHead>Name / ID</TableHead>
              <TableHead className="w-32">IP Address</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                  No audit events found.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(parseDBDate(log.timestamp), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell className="text-sm font-medium max-w-[180px] truncate">
                    {log.userId}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={ACTION_COLORS[log.action]}
                    >
                      {ACTION_LABELS[log.action]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">
                    {RESOURCE_LABELS[log.resource]}
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.resourceName ?? (log.resourceId != null ? `#${log.resourceId}` : "—")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {log.ipAddress ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                    {log.details ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default truncate block">
                              {Object.entries(log.details as Record<string, unknown>)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(", ")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs font-mono text-xs">
                            <pre className="whitespace-pre-wrap">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
