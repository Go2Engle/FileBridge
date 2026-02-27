"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play, PenLine, CircleAlert, CircleCheckBig, CircleX, Clock, FileText,
  ArrowLeft, Loader2, Search,
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

  // Fetch runs — poll at 2 s when running for smoother per-file progress updates
  const { data: runs } = useQuery<JobRun[]>({
    queryKey: ["job-runs", job?.id],
    queryFn: () => axios.get(`/api/jobs/${job!.id}/runs`).then((r) => r.data),
    enabled: open && !!job,
    refetchInterval: isRunning ? 2_000 : 30_000,
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

  const [width, setWidth] = useState(600);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const next = Math.min(Math.max(dragRef.current.startWidth - delta, 420), 1100);
      setWidth(next);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex flex-col p-0"
        style={{ width, maxWidth: "95vw" }}
      >
        {/* Resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize group z-10"
          onMouseDown={handleDragStart}
        >
          <div className="absolute inset-y-0 left-0 w-px bg-border group-hover:bg-primary/50 group-active:bg-primary transition-colors" />
        </div>
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
                <span className="font-medium text-foreground">
                  {connMap.get(currentJob.sourceConnectionId) ?? "Source"}
                </span>
                {" "}
                <span className="font-mono">{currentJob.sourcePath}</span>
                {" → "}
                <span className="font-medium text-foreground">
                  {connMap.get(currentJob.destinationConnectionId) ?? "Destination"}
                </span>
                {" "}
                <span className="font-mono">{currentJob.destinationPath}</span>
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
                <PenLine className="h-3.5 w-3.5 mr-1.5" />
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
            <TabsTrigger value="logs">Logs</TabsTrigger>
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

          <TabsContent value="logs" className="flex-1 min-h-0 px-6 pb-6">
            <ScrollArea className="h-full">
              {currentJob && <JobLogsPanel job={currentJob} />}
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

  // Elapsed timer — ticks every second
  useEffect(() => {
    const startTime = parseDBDate(run.startedAt).getTime();
    const tick = () => setElapsed(formatDuration(Date.now() - startTime));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [run.startedAt]);

  // Transfer speed — computed from consecutive poll snapshots
  const speedRef = useRef<{ bytes: number; time: number } | null>(null);
  const [speed, setSpeed] = useState(0); // bytes / second

  const totalBytesInFlight = (run.bytesTransferred ?? 0) + (run.currentFileBytesTransferred ?? 0);
  useEffect(() => {
    const now = Date.now();
    if (speedRef.current) {
      const deltaBytes = totalBytesInFlight - speedRef.current.bytes;
      const deltaSecs = (now - speedRef.current.time) / 1000;
      if (deltaSecs > 0 && deltaBytes >= 0) {
        setSpeed(deltaBytes / deltaSecs);
      }
    }
    speedRef.current = { bytes: totalBytesInFlight, time: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.bytesTransferred, run.currentFileBytesTransferred]);

  // Overall progress
  const totalFiles = run.totalFiles ?? 0;
  const totalBytes = run.totalBytes ?? 0;
  const filePct = totalFiles > 0 ? Math.round((run.filesTransferred / totalFiles) * 100) : 0;
  const bytesPct = totalBytes > 0 ? Math.min(100, Math.round((totalBytesInFlight / totalBytes) * 100)) : null;
  const displayPct = bytesPct ?? filePct;

  // Per-file progress
  const fileSize = run.currentFileSize ?? 0;
  const fileBytesTransferred = run.currentFileBytesTransferred ?? 0;
  const fileProgressPct = run.currentFileSize != null && fileSize > 0
    ? Math.min(100, Math.round((fileBytesTransferred / fileSize) * 100))
    : null;

  // ETA
  const eta = useMemo(() => {
    if (speed <= 0 || totalBytes <= 0) return null;
    const remaining = totalBytes - totalBytesInFlight;
    if (remaining <= 0) return null;
    return formatDuration(Math.round(remaining / speed) * 1000);
  }, [speed, totalBytes, totalBytesInFlight]);

  const { data: logs } = useQuery<TransferLog[]>({
    queryKey: ["run-logs", job.id, run.id],
    queryFn: () =>
      axios.get(`/api/jobs/${job.id}/runs/${run.id}/logs`).then((r) => r.data),
    refetchInterval: 2_000,
  });

  return (
    <div className="space-y-4 pt-2">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Transferring...
          </span>
          <span className="font-medium">{displayPct}%</span>
        </div>
        <Progress value={displayPct} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{run.currentFile ? run.filesTransferred + 1 : run.filesTransferred} / {totalFiles > 0 ? totalFiles : "?"} files</span>
          <span>
            {formatBytes(totalBytesInFlight)}
            {totalBytes > 0 && ` / ${formatBytes(totalBytes)}`}
          </span>
        </div>
      </div>

      {/* Current file with per-file progress bar */}
      {run.currentFile && (
        <div className="space-y-1.5 bg-muted/50 rounded-md px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs font-medium truncate">{run.currentFile}</span>
          </div>
          {fileProgressPct !== null && (
            <>
              <Progress value={fileProgressPct} className="h-1.5" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatBytes(fileBytesTransferred)} / {formatBytes(fileSize)}</span>
                <span>{fileProgressPct}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Speed · elapsed · ETA */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span>Elapsed: {elapsed}</span>
          {eta && <span>· ETA: {eta}</span>}
        </div>
        {speed > 0 && <span>{formatBytes(Math.round(speed))}/s</span>}
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
        <div className="min-w-0">
          <div className="font-medium truncate">
            {connMap.get(job.sourceConnectionId) ?? `Connection #${job.sourceConnectionId}`}
          </div>
          <div className="font-mono text-xs text-muted-foreground truncate">{job.sourcePath}</div>
        </div>
        <div className="text-muted-foreground">Destination</div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            {connMap.get(job.destinationConnectionId) ?? `Connection #${job.destinationConnectionId}`}
          </div>
          <div className="font-mono text-xs text-muted-foreground truncate">{job.destinationPath}</div>
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
          <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
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
                          <CircleAlert className="h-3.5 w-3.5 text-destructive" />
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

// --- Job Logs Panel ---

const JOB_LOG_PAGE_SIZE = 25;

interface JobLogEntry {
  id: number;
  fileName: string;
  sourcePath: string;
  destinationPath: string;
  fileSize: number;
  transferredAt: string;
  status: "success" | "failure";
  errorMessage: string | null;
}

function JobLogsPanel({ job }: { job: Job }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failure">("all");

  const { data, isLoading } = useQuery<{ logs: JobLogEntry[]; total: number }>({
    queryKey: ["job-logs", job.id, page, search, statusFilter],
    queryFn: () =>
      axios.get("/api/logs", {
        params: {
          jobId: job.id,
          offset: page * JOB_LOG_PAGE_SIZE,
          limit: JOB_LOG_PAGE_SIZE,
          search: search || undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
        },
      }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / JOB_LOG_PAGE_SIZE);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search file name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(0); }}
        >
          <SelectTrigger className="w-36 h-8 text-sm">
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
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !data?.logs.length ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No transfer logs found.
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell className="max-w-[140px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate block text-sm cursor-default">{log.fileName}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs break-all">
                        <p className="text-xs">{log.fileName}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[100px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate block cursor-default text-muted-foreground">{log.sourcePath}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs break-all">
                        <p className="text-xs font-mono">{log.sourcePath}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[100px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate block cursor-default text-muted-foreground">{log.destinationPath}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs break-all">
                        <p className="text-xs font-mono">{log.destinationPath}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatBytes(log.fileSize)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={log.status === "success" ? "success" : "destructive"}
                        className="capitalize text-xs"
                      >
                        {log.status}
                      </Badge>
                      {log.status === "failure" && log.errorMessage && (
                        <Tooltip>
                          <TooltipTrigger>
                            <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs">
                            <p className="text-xs">{log.errorMessage}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(parseDBDate(log.transferredAt), "MMM d, HH:mm:ss")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">
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
              <span className="text-xs text-muted-foreground">
                {page + 1} / {totalPages || 1}
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
                  <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <CircleX className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className="truncate text-sm">{log.fileName}</span>
                {log.errorMessage && (
                  <Tooltip>
                    <TooltipTrigger>
                      <CircleAlert className="h-3 w-3 text-destructive shrink-0" />
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
