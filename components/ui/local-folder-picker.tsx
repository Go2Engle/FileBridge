"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronRight, Folder, FolderOpen, File, Home, CircleAlert, ArrowLeft, HardDrive,
} from "lucide-react";
import type { FileInfo } from "@/lib/storage/interface";

interface LocalFolderPickerProps {
  open: boolean;
  onClose: () => void;
  /** Starting path when the dialog opens — defaults to "/" */
  initialPath?: string;
  /** Called with the chosen absolute path when the user clicks "Select" */
  onSelect: (path: string) => void;
}

function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (p: string) => void;
}) {
  const parts = path.split("/").filter(Boolean);
  const MAX_VISIBLE = 3;
  const truncated = parts.length > MAX_VISIBLE;
  const visibleParts = truncated ? parts.slice(-MAX_VISIBLE) : parts;
  const startIndex = truncated ? parts.length - MAX_VISIBLE : 0;

  return (
    <div className="flex items-center gap-1 text-sm min-h-[24px] overflow-hidden">
      <button
        onClick={() => onNavigate("/")}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
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
                "block truncate",
                isLast ? "max-w-[7rem] font-medium text-foreground" : "max-w-[5rem] text-muted-foreground hover:text-foreground transition-colors",
              ].join(" ")}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function LocalFolderPicker({
  open,
  onClose,
  initialPath = "/",
  onSelect,
}: LocalFolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);

  // Reset path when dialog opens
  useEffect(() => {
    if (open) setCurrentPath(initialPath || "/");
  }, [open, initialPath]);

  const { data, isLoading, error } = useQuery<{
    path: string;
    entries: FileInfo[];
  }>({
    queryKey: ["filesystem-browse", currentPath],
    queryFn: () =>
      axios
        .get(`/api/filesystem/browse?path=${encodeURIComponent(currentPath)}`)
        .then((r) => r.data),
    enabled: open,
    retry: false,
    staleTime: 10_000,
  });

  const navigate = (entry: FileInfo) => {
    if (!entry.isDirectory) return;
    const next =
      currentPath.endsWith("/")
        ? `${currentPath}${entry.name}`
        : `${currentPath}/${entry.name}`;
    setCurrentPath(next);
  };

  const goUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? "/" : "/" + parts.join("/"));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Select Base Path
          </DialogTitle>
        </DialogHeader>

        {/* Breadcrumb + Up button */}
        <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-muted/40">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={goUp}
            disabled={currentPath === "/"}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Breadcrumb path={currentPath} onNavigate={setCurrentPath} />
        </div>

        {/* Directory listing */}
        <ScrollArea className="h-72 border rounded-md">
          {isLoading ? (
            <div className="p-3 space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-destructive p-6 text-center">
              <CircleAlert className="h-6 w-6" />
              <p className="text-sm font-medium">Failed to read directory</p>
              <p className="text-xs text-muted-foreground">
                {(error as { response?: { data?: { error?: string } } }).response?.data?.error ??
                  "Check that the path exists and the server has permission to read it"}
              </p>
            </div>
          ) : !data?.entries?.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground p-6">
              <Folder className="h-6 w-6" />
              <p className="text-sm">This folder is empty</p>
            </div>
          ) : (
            <div className="p-1">
              {data.entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => navigate(entry)}
                  disabled={!entry.isDirectory}
                  className={[
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-sm text-left transition-colors",
                    entry.isDirectory
                      ? "hover:bg-accent hover:text-accent-foreground cursor-pointer"
                      : "text-muted-foreground cursor-default opacity-60",
                  ].join(" ")}
                >
                  {entry.isDirectory ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
                  ) : (
                    <File className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.isDirectory && (
                    <ChevronRight className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground/50" />
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="w-full space-y-2">
          <p className="truncate text-xs text-muted-foreground font-mono w-full">
            {currentPath}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => { onSelect(currentPath); onClose(); }}>
              Select This Folder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
