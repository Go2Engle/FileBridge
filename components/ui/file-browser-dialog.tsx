"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Edit2,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import type { FileInfo } from "@/lib/storage/interface";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function joinPath(base: string, name: string): string {
  return base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

function parentPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : "/" + parts.join("/");
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (p: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  const MAX_VISIBLE = 4;
  const truncated = parts.length > MAX_VISIBLE;
  const visibleParts = truncated ? parts.slice(-MAX_VISIBLE) : parts;
  const startIndex = truncated ? parts.length - MAX_VISIBLE : 0;

  return (
    <div className="flex items-center gap-1 text-sm min-w-0 overflow-hidden">
      <button
        onClick={() => onNavigate("/")}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Root"
      >
        <Home className="h-3.5 w-3.5" />
      </button>
      {truncated && (
        <span className="flex items-center gap-1 shrink-0 text-muted-foreground">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span>…</span>
        </span>
      )}
      {visibleParts.map((part, i) => {
        const absoluteIndex = startIndex + i;
        const href = "/" + parts.slice(0, absoluteIndex + 1).join("/");
        const isLast = absoluteIndex === parts.length - 1;
        return (
          <span key={href} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <button
              onClick={() => onNavigate(href)}
              className={[
                "block truncate max-w-[8rem]",
                isLast
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground transition-colors",
              ].join(" ")}
              title={part}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

// ── New-Folder dialog ─────────────────────────────────────────────────────────

function NewFolderDialog({
  open,
  onClose,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4" />
            New Folder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-folder"
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) onConfirm(name.trim());
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => onConfirm(name.trim())}
              disabled={!name.trim() || isPending}
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rename dialog ─────────────────────────────────────────────────────────────

function RenameDialog({
  entry,
  onClose,
  onConfirm,
  isPending,
}: {
  entry: FileInfo | null;
  onClose: () => void;
  onConfirm: (newName: string) => void;
  isPending: boolean;
}) {
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (entry) {
      setNewName(entry.name);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [entry]);

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit2 className="h-4 w-4" />
            Rename
          </DialogTitle>
        </DialogHeader>
        {entry && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rename-input">New name</Label>
              <Input
                id="rename-input"
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim() && newName !== entry.name) {
                    onConfirm(newName.trim());
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => onConfirm(newName.trim())}
                disabled={!newName.trim() || newName === entry.name || isPending}
              >
                {isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Rename
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FileBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: number;
  connectionName: string;
  isAdmin: boolean;
  initialPath?: string;
}

export function FileBrowserDialog({
  open,
  onClose,
  connectionId,
  connectionName,
  isAdmin,
  initialPath = "/",
}: FileBrowserDialogProps) {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [renameEntry, setRenameEntry] = useState<FileInfo | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<FileInfo | null>(null);

  // Reset path when dialog opens
  useEffect(() => {
    if (open) setCurrentPath(initialPath);
  }, [open, initialPath]);

  const browseKey = ["browse", connectionId, currentPath];

  const { data, isLoading, error, isFetching } = useQuery<{
    path: string;
    entries: FileInfo[];
  }>({
    queryKey: browseKey,
    queryFn: () =>
      axios
        .get(
          `/api/connections/${connectionId}/browse?path=${encodeURIComponent(currentPath)}`
        )
        .then((r) => r.data),
    enabled: open && !!connectionId,
    retry: false,
    staleTime: 30_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: browseKey });

  // ── mutations ──────────────────────────────────────────────────────────────

  const mkdirMutation = useMutation({
    mutationFn: (dirPath: string) =>
      axios.post(`/api/connections/${connectionId}/mkdir`, { path: dirPath }),
    onSuccess: () => {
      toast.success("Folder created");
      setShowNewFolder(false);
      invalidate();
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to create folder";
      toast.error(msg);
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      axios.patch(`/api/connections/${connectionId}/files`, { from, to }),
    onSuccess: () => {
      toast.success("Renamed successfully");
      setRenameEntry(null);
      invalidate();
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to rename";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (filePath: string) =>
      axios.delete(
        `/api/connections/${connectionId}/files?path=${encodeURIComponent(filePath)}`
      ),
    onSuccess: () => {
      toast.success("File deleted");
      setDeleteEntry(null);
      invalidate();
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to delete";
      toast.error(msg);
    },
  });

  // ── handlers ───────────────────────────────────────────────────────────────

  const navigate = (entry: FileInfo) => {
    if (!entry.isDirectory) return;
    setCurrentPath(joinPath(currentPath, entry.name));
  };

  const handleNewFolder = (name: string) => {
    mkdirMutation.mutate(joinPath(currentPath, name));
  };

  const handleRename = (newName: string) => {
    if (!renameEntry) return;
    const from = joinPath(currentPath, renameEntry.name);
    const to = joinPath(currentPath, newName);
    renameMutation.mutate({ from, to });
  };

  const handleDelete = () => {
    if (!deleteEntry) return;
    deleteMutation.mutate(joinPath(currentPath, deleteEntry.name));
  };

  // ── derived stats ──────────────────────────────────────────────────────────

  const entries = data?.entries ?? [];
  const dirCount = entries.filter((e) => e.isDirectory).length;
  const fileCount = entries.filter((e) => !e.isDirectory).length;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="truncate">{connectionName}</span>
            </DialogTitle>
          </DialogHeader>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/30 shrink-0">
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setCurrentPath(parentPath(currentPath))}
                    disabled={currentPath === "/"}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Go up</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="flex-1 min-w-0 flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
              <Breadcrumb path={currentPath} onNavigate={setCurrentPath} />
            </div>

            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={invalidate}
                    disabled={isFetching}
                  >
                    <RefreshCcw
                      className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>

              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setShowNewFolder(true)}
                    >
                      <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New folder</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>

          {/* File table */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {isLoading ? (
              <div className="p-4 space-y-1.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive p-8 text-center">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm font-medium">Failed to load directory</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {(
                    error as {
                      response?: { data?: { error?: string } };
                    }
                  ).response?.data?.error ??
                    "Check your connection credentials and that the path exists"}
                </p>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-8">
                <Folder className="h-10 w-10 opacity-40" />
                <p className="text-sm">This folder is empty</p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[45%]">Name</TableHead>
                      <TableHead className="w-[15%]">Size</TableHead>
                      <TableHead className="w-[25%]">Modified</TableHead>
                      {isAdmin && <TableHead className="w-[15%]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow
                        key={entry.name}
                        className={
                          entry.isDirectory
                            ? "cursor-pointer"
                            : "cursor-default"
                        }
                        onClick={() => navigate(entry)}
                      >
                        {/* Name */}
                        <TableCell className="font-medium py-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {entry.isDirectory ? (
                              <Folder className="h-4 w-4 shrink-0 text-primary/70" />
                            ) : (
                              <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate text-sm">{entry.name}</span>
                            {entry.isDirectory && (
                              <ChevronRight className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground/40" />
                            )}
                          </div>
                        </TableCell>

                        {/* Size */}
                        <TableCell className="py-2 text-sm text-muted-foreground font-mono">
                          {entry.isDirectory ? "—" : formatSize(entry.size)}
                        </TableCell>

                        {/* Modified */}
                        <TableCell className="py-2 text-sm text-muted-foreground">
                          {entry.modifiedAt &&
                          new Date(entry.modifiedAt).getFullYear() > 2000
                            ? format(new Date(entry.modifiedAt), "MMM d, yyyy HH:mm")
                            : "—"}
                        </TableCell>

                        {/* Actions (admin only) */}
                        {isAdmin && (
                          <TableCell
                            className="py-2 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity [tr:hover_&]:opacity-100">
                              <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={() => setRenameEntry(entry)}
                                    >
                                      <Edit2 className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Rename</TooltipContent>
                                </Tooltip>

                                {!entry.isDirectory && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-destructive hover:text-destructive"
                                        onClick={() => setDeleteEntry(entry)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete file</TooltipContent>
                                  </Tooltip>
                                )}
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/20 shrink-0 text-xs text-muted-foreground">
            <span>
              {entries.length > 0
                ? `${entries.length} item${entries.length !== 1 ? "s" : ""} — ${dirCount} folder${dirCount !== 1 ? "s" : ""}, ${fileCount} file${fileCount !== 1 ? "s" : ""}`
                : isLoading
                ? "Loading…"
                : "Empty folder"}
            </span>
            <Button variant="outline" size="sm" onClick={onClose} className="h-7 text-xs">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Folder dialog */}
      <NewFolderDialog
        open={showNewFolder}
        onClose={() => setShowNewFolder(false)}
        onConfirm={handleNewFolder}
        isPending={mkdirMutation.isPending}
      />

      {/* Rename dialog */}
      <RenameDialog
        entry={renameEntry}
        onClose={() => setRenameEntry(null)}
        onConfirm={handleRename}
        isPending={renameMutation.isPending}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteEntry}
        onOpenChange={(o) => !o && setDeleteEntry(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono text-foreground">{deleteEntry?.name}</span>{" "}
              will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
