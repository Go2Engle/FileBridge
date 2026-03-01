"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Webhook, Terminal, Download, Users, FolderOpen } from "lucide-react";
import type { LibraryHookEntry } from "@/app/api/hooks/library/route";
import type { Hook } from "@/lib/db/schema";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function LibraryBrowser({ open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "webhook" | "shell">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "community" | "local">("all");

  const { data: libraryData, isLoading: libraryLoading } = useQuery<{ hooks: LibraryHookEntry[] }>({
    queryKey: ["hooks-library"],
    queryFn: () => axios.get("/api/hooks/library").then((r) => r.data),
    enabled: open,
  });

  const { data: existingHooks } = useQuery<Hook[]>({
    queryKey: ["hooks"],
    queryFn: () => axios.get("/api/hooks").then((r) => r.data),
  });

  const existingNames = useMemo(
    () => new Set((existingHooks ?? []).map((h) => h.name.toLowerCase())),
    [existingHooks]
  );

  const hasLocal = (libraryData?.hooks ?? []).some((h) => h.source === "local");

  const filtered = useMemo(() => {
    const all = libraryData?.hooks ?? [];
    return all.filter((h) => {
      if (typeFilter !== "all" && h.type !== typeFilter) return false;
      if (sourceFilter !== "all" && h.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          h.name.toLowerCase().includes(q) ||
          h.description?.toLowerCase().includes(q) ||
          h.tags?.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [libraryData, typeFilter, sourceFilter, search]);

  const importMutation = useMutation({
    mutationFn: (entry: LibraryHookEntry) =>
      axios.post("/api/hooks", {
        name: entry.name,
        description: entry.description ?? null,
        type: entry.type,
        config: entry.config,
        enabled: true,
      }),
    onSuccess: (_, entry) => {
      queryClient.invalidateQueries({ queryKey: ["hooks"] });
      toast.success(`"${entry.name}" imported`);
    },
    onError: () => toast.error("Failed to import hook"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>Hook Library</DialogTitle>
          <DialogDescription>
            Browse community and local hook templates. Importing creates a copy in your hooks list.
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="px-6 pb-3 flex gap-2 flex-wrap shrink-0 border-b">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Search hooks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
              <SelectItem value="shell">Shell</SelectItem>
            </SelectContent>
          </Select>
          {hasLocal && (
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
              <SelectTrigger className="w-36 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="community">Community</SelectItem>
                <SelectItem value="local">Local</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {libraryLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No hooks found.
            </div>
          ) : (
            filtered.map((entry) => {
              const alreadyImported = existingNames.has(entry.name.toLowerCase());
              const isImporting = importMutation.isPending && importMutation.variables?.id === entry.id;

              return (
                <div
                  key={`${entry.source}-${entry.id}`}
                  className="border rounded-lg p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{entry.name}</span>
                      <Badge variant="outline" className="text-xs gap-1 py-0">
                        {entry.type === "webhook"
                          ? <Webhook className="h-3 w-3" />
                          : <Terminal className="h-3 w-3" />
                        }
                        {entry.type === "webhook" ? "Webhook" : "Shell"}
                      </Badge>
                      {entry.source === "local" && (
                        <Badge variant="secondary" className="text-xs gap-1 py-0">
                          <FolderOpen className="h-3 w-3" />
                          Local
                        </Badge>
                      )}
                      {entry.source === "community" && (
                        <Badge variant="secondary" className="text-xs gap-1 py-0 opacity-60">
                          <Users className="h-3 w-3" />
                          Community
                        </Badge>
                      )}
                    </div>
                    {entry.description && (
                      <p className="text-xs text-muted-foreground">{entry.description}</p>
                    )}
                    {entry.tags && entry.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {entry.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {entry.author && (
                      <p className="text-xs text-muted-foreground/60">{entry.author}</p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={alreadyImported ? "outline" : "default"}
                    disabled={alreadyImported || isImporting}
                    onClick={() => importMutation.mutate(entry)}
                    className="shrink-0"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    {alreadyImported ? "Imported" : isImporting ? "Importing…" : "Import"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
