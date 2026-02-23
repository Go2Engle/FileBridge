"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, Edit2, FlaskConical, Play, Plus, Search, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Job, JobRun } from "@/lib/db/schema";
import { parseDBDate } from "@/lib/utils";
import { DryRunDialog } from "@/components/jobs/dry-run-dialog";
import { useRole } from "@/hooks/use-role";

type StatusFilter = "all" | "active" | "inactive" | "error";
type JobSortOption = "name-asc" | "name-desc" | "created-desc" | "created-asc" | "last-run";

const statusVariant: Record<
  Job["status"],
  "success" | "secondary" | "warning" | "destructive"
> = {
  active: "success",
  inactive: "secondary",
  running: "warning",
  error: "destructive",
};

/** Fetches and shows the last run error for a job in error state. */
function JobErrorInfo({ jobId }: { jobId: number }) {
  const { data } = useQuery<JobRun[]>({
    queryKey: ["job-runs", jobId],
    queryFn: () => axios.get(`/api/jobs/${jobId}/runs`).then((r) => r.data),
    staleTime: 30_000,
  });
  const lastError = data?.[0]?.errorMessage;
  if (!lastError) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertCircle className="h-3.5 w-3.5 text-destructive cursor-help shrink-0" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs break-words">
        {lastError}
      </TooltipContent>
    </Tooltip>
  );
}

interface JobListProps {
  onNew: () => void;
  onEdit: (job: Job) => void;
  onSelect: (job: Job) => void;
}

export function JobList({ onNew, onEdit, onSelect }: JobListProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<JobSortOption>("created-desc");
  const [dryRunJob, setDryRunJob] = useState<Job | null>(null);

  const { data, isLoading } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: () => axios.get("/api/jobs").then((r) => r.data),
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/jobs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job deleted");
    },
    onError: () => toast.error("Failed to delete job"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      axios.patch(`/api/jobs/${id}`, {
        status: status === "active" ? "inactive" : "active",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job updated");
    },
    onError: () => toast.error("Failed to update job"),
  });

  const runMutation = useMutation({
    mutationFn: (id: number) => axios.post(`/api/jobs/${id}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job triggered");
    },
    onError: () => toast.error("Failed to run job"),
  });

  const statusCounts = useMemo(() => {
    if (!data) return { all: 0, active: 0, inactive: 0, error: 0 };
    return {
      all: data.length,
      active: data.filter((j) => j.status === "active" || j.status === "running").length,
      inactive: data.filter((j) => j.status === "inactive").length,
      error: data.filter((j) => j.status === "error").length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data;

    // Status filter
    if (statusFilter === "active") {
      list = list.filter((j) => j.status === "active" || j.status === "running");
    } else if (statusFilter !== "all") {
      list = list.filter((j) => j.status === statusFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((j) => j.name.toLowerCase().includes(q));
    }

    // Sort
    const sorted = [...list];
    switch (sort) {
      case "name-asc":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "created-asc":
        sorted.sort(
          (a, b) =>
            parseDBDate(a.createdAt).getTime() - parseDBDate(b.createdAt).getTime()
        );
        break;
      case "last-run":
        sorted.sort((a, b) => {
          if (!a.lastRunAt && !b.lastRunAt) return 0;
          if (!a.lastRunAt) return 1;
          if (!b.lastRunAt) return -1;
          return parseDBDate(b.lastRunAt).getTime() - parseDBDate(a.lastRunAt).getTime();
        });
        break;
      case "created-desc":
      default:
        sorted.sort(
          (a, b) =>
            parseDBDate(b.createdAt).getTime() - parseDBDate(a.createdAt).getTime()
        );
        break;
    }
    return sorted;
  }, [data, statusFilter, search, sort]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[200px]"
            />
          </div>
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            {(["all", "active", "inactive", "error"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs font-medium rounded-sm capitalize transition-colors ${
                  statusFilter === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
                <span className="ml-1 text-muted-foreground">
                  {statusCounts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as JobSortOption)}>
            <SelectTrigger className="w-[160px] h-9 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A–Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z–A)</SelectItem>
              <SelectItem value="created-desc">Newest first</SelectItem>
              <SelectItem value="created-asc">Oldest first</SelectItem>
              <SelectItem value="last-run">Last run</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button onClick={onNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Job
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No transfer jobs yet.</p>
          <p className="text-xs mt-1">Create a job to start automating file transfers.</p>
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No jobs match your filters.</p>
          <p className="text-xs mt-1">Try adjusting your search or filter.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Filter</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Run</TableHead>
              {isAdmin && <TableHead className="w-32" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((job) => (
              <TableRow
                key={job.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onSelect(job)}
              >
                <TableCell className="font-medium">{job.name}</TableCell>
                <TableCell className="font-mono text-sm">{job.schedule}</TableCell>
                <TableCell className="font-mono text-sm">{job.fileFilter}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={statusVariant[job.status]} className="capitalize">
                      {job.status}
                    </Badge>
                    {job.status === "error" && <JobErrorInfo jobId={job.id} />}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {job.lastRunAt
                    ? formatDistanceToNow(parseDBDate(job.lastRunAt), { addSuffix: true })
                    : "Never"}
                </TableCell>
                {isAdmin && (
                  <TableCell>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              toggleMutation.mutate({ id: job.id, status: job.status })
                            }
                            disabled={job.status === "running"}
                          >
                            {job.status === "active" ? (
                              <ToggleRight className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {job.status === "active" ? "Disable" : "Enable"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => runMutation.mutate(job.id)}
                            disabled={job.status === "running"}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Run now</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDryRunJob(job)}
                            disabled={job.status === "running"}
                          >
                            <FlaskConical className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Dry run</TooltipContent>
                      </Tooltip>
                      <Button variant="ghost" size="icon" onClick={() => onEdit(job)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete job "${job.name}"?`)) {
                            deleteMutation.mutate(job.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <DryRunDialog
        job={dryRunJob}
        open={!!dryRunJob}
        onClose={() => setDryRunJob(null)}
      />
    </div>
  );
}
