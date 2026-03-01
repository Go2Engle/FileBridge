"use client";

import { useState, useMemo, useEffect } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Webhook, Terminal, Download, Users, FolderOpen, ArrowLeft, KeyRound } from "lucide-react";
import type { LibraryHookEntry, LibraryHookInput } from "@/app/api/hooks/library/route";
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

  // Two-step state: null = list view, entry = configure view
  const [configuring, setConfiguring] = useState<LibraryHookEntry | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Reset config state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setConfiguring(null);
      setFieldValues({});
      setSearch("");
    }
  }, [open]);

  // Reset field values when switching to a different hook
  useEffect(() => {
    if (configuring) {
      const defaults: Record<string, string> = {};
      configuring.inputs?.forEach((inp) => {
        if (inp.default) defaults[inp.id] = inp.default;
      });
      setFieldValues(defaults);
    }
  }, [configuring]);

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

  // Direct import (no inputs)
  const directImportMutation = useMutation({
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

  // Configure + import (has inputs)
  const configImportMutation = useMutation({
    mutationFn: ({ entry, values }: { entry: LibraryHookEntry; values: Record<string, string> }) =>
      axios.post("/api/hooks/library/import", {
        id: entry.id,
        source: entry.source,
        values,
      }),
    onSuccess: (_, { entry }) => {
      queryClient.invalidateQueries({ queryKey: ["hooks"] });
      toast.success(`"${entry.name}" imported`);
      setConfiguring(null);
    },
    onError: () => toast.error("Failed to import hook"),
  });

  function handleConfigSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!configuring) return;

    // Client-side required validation
    const missing = (configuring.inputs ?? []).filter(
      (inp) => inp.required && !fieldValues[inp.id]?.trim()
    );
    if (missing.length > 0) {
      toast.error(`Required: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }

    configImportMutation.mutate({ entry: configuring, values: fieldValues });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">

        {configuring ? (
          /* ── Configure view ── */
          <>
            <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setConfiguring(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <DialogTitle className="text-base">{configuring.name}</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    Fill in the required fields to complete the import.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <form onSubmit={handleConfigSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
                {(configuring.inputs ?? []).map((inp: LibraryHookInput) => (
                  <div key={inp.id} className="space-y-1.5">
                    <Label htmlFor={inp.id} className="flex items-center gap-1.5">
                      {inp.label}
                      {inp.required && <span className="text-destructive">*</span>}
                      {inp.type === "secret" && (
                        <KeyRound className="h-3 w-3 text-muted-foreground" />
                      )}
                    </Label>
                    <Input
                      id={inp.id}
                      type={inp.type === "secret" ? "password" : inp.type === "number" ? "number" : "text"}
                      placeholder={inp.placeholder}
                      value={fieldValues[inp.id] ?? ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [inp.id]: e.target.value }))
                      }
                      autoComplete={inp.type === "secret" ? "off" : undefined}
                    />
                    {inp.description && (
                      <p className="text-xs text-muted-foreground">{inp.description}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setConfiguring(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={configImportMutation.isPending}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  {configImportMutation.isPending ? "Importing…" : "Import"}
                </Button>
              </div>
            </form>
          </>
        ) : (
          /* ── List view ── */
          <>
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
                  const hasInputs = (entry.inputs?.length ?? 0) > 0;
                  const isDirectImporting =
                    directImportMutation.isPending &&
                    directImportMutation.variables?.id === entry.id;

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
                              : <Terminal className="h-3 w-3" />}
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
                        disabled={alreadyImported || isDirectImporting}
                        onClick={() => {
                          if (hasInputs) {
                            setConfiguring(entry);
                          } else {
                            directImportMutation.mutate(entry);
                          }
                        }}
                        className="shrink-0"
                      >
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        {alreadyImported
                          ? "Imported"
                          : isDirectImporting
                            ? "Importing…"
                            : hasInputs
                              ? "Configure & Import"
                              : "Import"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
