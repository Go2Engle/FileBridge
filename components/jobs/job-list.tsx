"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle, Edit2, Play, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Job, JobRun } from "@/lib/db/schema";

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
}

export function JobList({ onNew, onEdit }: JobListProps) {
  const queryClient = useQueryClient();

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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Job
        </Button>
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
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Filter</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Run</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((job) => (
              <TableRow key={job.id}>
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
                    ? formatDistanceToNow(new Date(job.lastRunAt), { addSuffix: true })
                    : "Never"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
