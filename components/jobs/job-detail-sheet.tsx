"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play, Edit2, AlertCircle, CheckCircle2, XCircle, Clock, FileText,
  ArrowLeft, Loader2,
} from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import type { Job, JobRun, TransferLog, Connection } from "@/lib/db/schema";
import { formatBytes, formatDuration, parseDBDate } from "@/lib/utils";
import { useRole } from "@/hooks/use-role";

const statusVariant: Record<
  Job["status"],
  "success" | "secondary" | "warning" | "destructive"
> = {
  active: "success",
  inactive: "secondary",
  running: "warning",
  error: "destructive",
};

const runStatusVariant: Record<
  JobRun["status"],
  "success" | "warning" | "destructive"
> = {
  success: "success",
  running: "warning",
  failure: "destructive",
};

interface JobDetailSheetProps {
  job: Job | null;
  open: boolean;
  onClose: () => void;
  onEdit: (job: Job) => void;
}

export function JobDetailSheet({ job, open, onClose, onEdit }: JobDetailSheetProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();

  // Fetch fresh job data to keep status current
  const { data: freshJob } = useQuery<Job>({
    queryKey: ["job", job?.id],
    queryFn: () => axios.get(`/api/jobs/${job!.id}`).then((r) => r.data),
    enabled: open && !!job,
    refetchInterval: (query) => {
      const j = query.state.data;
      return j?.status === "running" ? 3_000 : 10_000;
    },
    initialData: job ?? undefined,
  });

  const currentJob = freshJob ?? job;
  const isRunning = currentJob?.status === "running";

  // Fetch runs
  const { data: runs } = useQuery<JobRun[]>({
    queryKey: ["job-runs", job?.id],
    queryFn: () => axios.get(`/api/jobs/${job!.id}/runs`).then((r) => r.data),
    enabled: open && !!job,
    refetchInterval: isRunning ? 3_000 : 30_000,
  });

  // Fetch connections for display names
  const { data: connections } = useQuery<Connection[]>({
    queryKey: ["connections"],
    queryFn: () => axios.get("/api/connections").then((r) => r.data),
    enabled: open && !!job,
  });

  const runMutation = useMutation({
    mutationFn: (id: number) => axios.post(`/api/jobs/${id}/run`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", job?.id] });
      queryClient.invalidateQueries({ queryKey: ["job-runs", job?.id] });
      toast.success("Job triggered");
    },
    onError: () => toast.error("Failed to run job"),
  });

  const latestRun = runs?.[0];
  const connMap = new Map(connections?.map((c) => [c.id, c.name]) ?? []);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-[600px] sm:max-w-[700px] flex flex-col p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-lg">{currentJob?.name}</SheetTitle>
            {currentJob && (
              <Badge variant={statusVariant[currentJob.status]} className="capitalize">
                {currentJob.status}
              </Badge>
            )}
          </div>
          <SheetDescription className="text-xs">
            {currentJob && (
              <>
                {connMap.get(currentJob.sourceConnectionId) ?? "Source"}:{currentJob.sourcePath}
                {" → "}
                {connMap.get(currentJob.destinationConnectionId) ?? "Destination"}:{currentJob.destinationPath}
              </>
            )}
          </SheetDescription>
          {currentJob && isAdmin && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => runMutation.mutate(currentJob.id)}
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                )}
                Run Now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(currentJob)}
              >
                <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            </div>
          )}
        </SheetHeader>

        <Separator />

        <Tabs defaultValue="progress" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-2">
            <TabsTrigger value="progress">
              {isRunning ? "Live Progress" : "Overview"}
            </TabsTrigger>
            <TabsTrigger value="history">Run History</TabsTrigger>
          </TabsList>

          <TabsContent value="progress" className="flex-1 min-h-0 px-6 pb-6">
            <ScrollArea className="h-full">
              {currentJob && (
                isRunning && latestRun ? (
                  <LiveProgressPanel
                    job={currentJob}
                    run={latestRun}
                  />
                ) : (
                  <OverviewPanel
                    job={currentJob}
                    latestRun={latestRun}
                    connMap={connMap}
                  />
                )
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="flex-1 min-h-0 px-6 pb-6">
            <ScrollArea className="h-full">
              {currentJob && (
                <RunHistoryPanel
                  job={currentJob}
                  runs={runs ?? []}
                />
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// --- Live Progress Panel ---

function LiveProgressPanel({ job, run }: { job: Job; run: JobRun }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const startTime = parseDBDate(run.startedAt).getTime();
    const tick = () => {
      setElapsed(formatDuration(Date.now() - startTime));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [run.startedAt]);

  const totalFiles = run.totalFiles ?? 0;
  const progressPct = totalFiles > 0
    ? Math.round((run.filesTransferred / totalFiles) * 100)
    : 0;

  const { data: logs } = useQuery<TransferLog[]>({
    queryKey: ["run-logs", job.id, run.id],
    queryFn: () =>
      axios.get(`/api/jobs/${job.id}/runs/${run.id}/logs`).then((r) => r.data),
    refetchInterval: 3_000,
  });

  return (
    <div className="space-y-4 pt-2">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Transferring...
          </span>
          <span className="font-medium">{progressPct}%</span>
        </div>
        <Progress value={progressPct} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {run.filesTransferred} / {totalFiles > 0 ? totalFiles : "?"} files
          </span>
          <span>{formatBytes(run.bytesTransferred)}</span>
        </div>
      </div>

      {run.currentFile && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-2">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Current: {run.currentFile}</span>
        </div>
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" />
        Elapsed: {elapsed}
      </div>

      {logs && logs.length > 0 && (
        <>
          <Separator />
          <div className="text-sm font-medium">Completed Files</div>
          <TransferLogTable logs={logs} compact />
        </>
      )}
    </div>
  );
}

// --- Overview Panel ---

function OverviewPanel({
  job,
  latestRun,
  connMap,
}: {
  job: Job;
  latestRun?: JobRun;
  connMap: Map<number, string>;
}) {
  return (
    <div className="space-y-4 pt-2">
      {latestRun && (
        <LastRunSummary run={latestRun} />
      )}

      <div className="text-sm font-medium">Job Configuration</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="text-muted-foreground">Source</div>
        <div className="truncate">
          {connMap.get(job.sourceConnectionId) ?? `Connection #${job.sourceConnectionId}`}:{job.sourcePath}
        </div>
        <div className="text-muted-foreground">Destination</div>
        <div className="truncate">
          {connMap.get(job.destinationConnectionId) ?? `Connection #${job.destinationConnectionId}`}:{job.destinationPath}
        </div>
        <div className="text-muted-foreground">File Filter</div>
        <div className="font-mono text-xs">{job.fileFilter}</div>
        <div className="text-muted-foreground">Schedule</div>
        <div className="font-mono text-xs">{job.schedule}</div>
        <div className="text-muted-foreground">Post-Transfer</div>
        <div className="capitalize">{job.postTransferAction}</div>
        {job.postTransferAction === "move" && job.movePath && (
          <>
            <div className="text-muted-foreground">Move Path</div>
            <div className="truncate">{job.movePath}</div>
          </>
        )}
        <div className="text-muted-foreground">Options</div>
        <div className="flex flex-wrap gap-1.5">
          {job.overwriteExisting && <Badge variant="outline" className="text-xs">Overwrite</Badge>}
          {job.skipHiddenFiles && <Badge variant="outline" className="text-xs">Skip Hidden</Badge>}
          {job.extractArchives && <Badge variant="outline" className="text-xs">Extract Archives</Badge>}
          {!job.overwriteExisting && !job.skipHiddenFiles && !job.extractArchives && (
            <span className="text-muted-foreground">Default</span>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Last Run Summary ---

function LastRunSummary({ run }: { run: JobRun }) {
  const duration = run.completedAt
    ? formatDuration(
        parseDBDate(run.completedAt).getTime() - parseDBDate(run.startedAt).getTime()
      )
    : null;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Last Run</span>
        <Badge variant={runStatusVariant[run.status]} className="capitalize">
          {run.status}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-lg font-semibold">{run.filesTransferred}</div>
          <div className="text-xs text-muted-foreground">Files</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{formatBytes(run.bytesTransferred)}</div>
          <div className="text-xs text-muted-foreground">Transferred</div>
        </div>
        <div>
          <div className="text-lg font-semibold">{duration ?? "—"}</div>
          <div className="text-xs text-muted-foreground">Duration</div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {formatDistanceToNow(parseDBDate(run.startedAt), { addSuffix: true })}
      </div>
      {run.errorMessage && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{run.errorMessage}</span>
        </div>
      )}
    </div>
  );
}

// --- Run History Panel ---

function RunHistoryPanel({ job, runs }: { job: Job; runs: JobRun[] }) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: runLogs, isLoading: logsLoading } = useQuery<TransferLog[]>({
    queryKey: ["run-logs", job.id, selectedRunId],
    queryFn: () =>
      axios.get(`/api/jobs/${job.id}/runs/${selectedRunId}/logs`).then((r) => r.data),
    enabled: !!selectedRunId,
  });

  if (selectedRunId) {
    const selectedRun = runs.find((r) => r.id === selectedRunId);
    return (
      <div className="space-y-3 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2"
          onClick={() => setSelectedRunId(null)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to runs
        </Button>

        {selectedRun && <LastRunSummary run={selectedRun} />}

        <div className="text-sm font-medium">Transfer Details</div>
        {logsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : runLogs && runLogs.length > 0 ? (
          <TransferLogTable logs={runLogs} />
        ) : (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No file transfers recorded for this run.
          </div>
        )}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No runs yet. Trigger a run manually or wait for the schedule.
      </div>
    );
  }

  return (
    <div className="pt-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Files</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const duration = run.completedAt
              ? formatDuration(
                  parseDBDate(run.completedAt).getTime() -
                    parseDBDate(run.startedAt).getTime()
                )
              : "—";
            return (
              <TableRow
                key={run.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedRunId(run.id)}
              >
                <TableCell className="text-sm">
                  {format(parseDBDate(run.startedAt), "MMM d, HH:mm")}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={runStatusVariant[run.status]} className="capitalize">
                      {run.status}
                    </Badge>
                    {run.errorMessage && (
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs break-words">
                          {run.errorMessage}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm">{run.filesTransferred}</TableCell>
                <TableCell className="text-right text-sm">
                  {formatBytes(run.bytesTransferred)}
                </TableCell>
                <TableCell className="text-right text-sm">{duration}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Transfer Log Table ---

function TransferLogTable({ logs, compact }: { logs: TransferLog[]; compact?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Status</TableHead>
          {!compact && <TableHead>Time</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="max-w-[200px]">
              <div className="flex items-center gap-1.5">
                {log.status === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className="truncate text-sm">{log.fileName}</span>
                {log.errorMessage && (
                  <Tooltip>
                    <TooltipTrigger>
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs break-words">
                      {log.errorMessage}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {formatBytes(log.fileSize)}
            </TableCell>
            <TableCell>
              <Badge
                variant={log.status === "success" ? "success" : "destructive"}
                className="capitalize text-xs"
              >
                {log.status}
              </Badge>
            </TableCell>
            {!compact && (
              <TableCell className="text-sm text-muted-foreground">
                {format(parseDBDate(log.transferredAt), "HH:mm:ss")}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
