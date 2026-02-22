"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  ArrowRight,
  Filter,
  FlaskConical,
  FolderInput,
  Loader2,
  PackageOpen,
  SkipForward,
  Trash2,
} from "lucide-react";
import axios from "axios";
import type { Job } from "@/lib/db/schema";
import type { DryRunFile, DryRunResult } from "@/lib/transfer/engine";
import { formatBytes } from "@/lib/utils";

interface DryRunDialogProps {
  job: Job | null;
  open: boolean;
  onClose: () => void;
}

function DestinationBadge({ file }: { file: DryRunFile }) {
  if (file.skipReason === "filter") {
    return (
      <Badge variant="secondary" className="text-xs gap-1 whitespace-nowrap opacity-60">
        <Filter className="h-3 w-3" />
        Filtered
      </Badge>
    );
  }
  if (file.skipReason === "exists") {
    return (
      <Badge variant="secondary" className="text-xs gap-1 whitespace-nowrap">
        <SkipForward className="h-3 w-3" />
        Exists
      </Badge>
    );
  }
  if (file.wouldExtract) {
    return (
      <Badge variant="warning" className="text-xs gap-1 whitespace-nowrap">
        <PackageOpen className="h-3 w-3" />
        Extract
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="text-xs gap-1 whitespace-nowrap">
      <ArrowRight className="h-3 w-3" />
      Transfer
    </Badge>
  );
}

function SourceBadge({ file }: { file: DryRunFile }) {
  if (file.wouldSkip) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (file.postAction === "delete") {
    return (
      <Badge variant="destructive" className="text-xs gap-1 whitespace-nowrap">
        <Trash2 className="h-3 w-3" />
        Delete
      </Badge>
    );
  }
  if (file.postAction === "move" && file.moveDest) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground font-mono min-w-0"
        title={file.moveDest}
      >
        <FolderInput className="h-3 w-3 shrink-0 text-blue-500" />
        <span className="truncate max-w-[160px]">{file.moveDest}</span>
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Retain</span>;
}

export function DryRunDialog({ job, open, onClose }: DryRunDialogProps) {
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (jobId: number) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await axios.post<DryRunResult>(`/api/jobs/${jobId}/dry-run`);
      setResult(data);
    } catch (err) {
      const msg =
        axios.isAxiosError(err) && err.response?.data?.error
          ? err.response.data.error
          : err instanceof Error
          ? err.message
          : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && job) {
      run(job.id);
    }
    if (!open) {
      setResult(null);
      setError(null);
      setLoading(false);
    }
  }, [open, job, run]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            Dry Run — {job?.name}
          </DialogTitle>
          <DialogDescription>
            Preview which files would be transferred without making any changes.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-4 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Scanning source files…</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-10">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-destructive text-center max-w-sm">{error}</p>
            {job && (
              <Button variant="outline" size="sm" onClick={() => run(job.id)}>
                Retry
              </Button>
            )}
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-center">
                <p className="text-2xl font-bold">{result.totalInSource}</p>
                <p className="text-xs text-muted-foreground mt-0.5">In source</p>
                {result.skippedByFilter > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.totalMatched} match{" "}
                    <span className="font-mono">{result.fileFilter}</span>
                  </p>
                )}
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {result.wouldTransfer}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Would transfer</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatBytes(result.totalBytes)}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/40 p-3 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {result.wouldSkip}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Would skip</p>
                {result.wouldSkip > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {[
                      result.skippedByFilter > 0 && `${result.skippedByFilter} filtered`,
                      result.skippedByExists > 0 && `${result.skippedByExists} exist`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
              <span className="font-mono">{result.sourcePath}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span className="font-mono">{result.destinationPath}</span>
            </div>

            {result.files.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No files found in source directory.
              </div>
            ) : (
              <ScrollArea className="h-72 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>File</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead className="text-right">Destination</TableHead>
                      <TableHead className="text-right">Source after</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.files.map((f) => (
                      <TableRow
                        key={f.name}
                        className={
                          f.skipReason === "filter"
                            ? "opacity-35"
                            : f.skipReason === "exists"
                            ? "opacity-60"
                            : undefined
                        }
                      >
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            {f.isArchive && (
                              <PackageOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                            )}
                            {f.wouldSkip ? (
                              <span className="line-through">{f.name}</span>
                            ) : (
                              f.name
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatBytes(f.size)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <DestinationBadge file={f} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <SourceBadge file={f} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
