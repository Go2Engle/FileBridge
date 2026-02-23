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
import { Edit2, FolderSearch, Loader2, Plus, PlugZap, Search, Trash2 } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Connection } from "@/lib/db/schema";
import { useRole } from "@/hooks/use-role";

// The list endpoint strips credentials and adds a top-level username for display
type ConnectionSummary = Omit<Connection, "credentials"> & { username: string };
import { parseDBDate } from "@/lib/utils";
import { FolderBrowser } from "@/components/ui/folder-browser";

type ProtocolFilter = "all" | "sftp" | "smb" | "azure-blob" | "local";
type SortOption = "name-asc" | "name-desc" | "created-desc" | "created-asc";

interface ConnectionListProps {
  onEdit: (connection: ConnectionSummary) => void;
  onNew: () => void;
}

export function ConnectionList({ onEdit, onNew }: ConnectionListProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const [browser, setBrowser] = useState<{ conn: ConnectionSummary } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("all");
  const [sort, setSort] = useState<SortOption>("created-desc");

  async function testConnection(conn: ConnectionSummary) {
    setTestingId(conn.id);
    try {
      const { data } = await axios.post(`/api/connections/${conn.id}/test`);
      if (data.success) {
        toast.success(`${conn.name}: ${data.message}`);
      } else {
        toast.error(`${conn.name}: ${data.error}`);
      }
    } catch {
      toast.error(`${conn.name}: Test request failed`);
    } finally {
      setTestingId(null);
    }
  }

  const { data, isLoading } = useQuery<ConnectionSummary[]>({
    queryKey: ["connections"],
    queryFn: () => axios.get("/api/connections").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success("Connection deleted");
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        "Failed to delete connection";
      toast.error(msg);
    },
  });

  const protocolCounts = useMemo(() => {
    if (!data) return { all: 0, sftp: 0, smb: 0, "azure-blob": 0, local: 0 };
    return {
      all: data.length,
      sftp: data.filter((c) => c.protocol === "sftp").length,
      smb: data.filter((c) => c.protocol === "smb").length,
      "azure-blob": data.filter((c) => c.protocol === "azure-blob").length,
      local: data.filter((c) => c.protocol === "local").length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data;

    // Protocol filter
    if (protocolFilter !== "all") {
      list = list.filter((c) => c.protocol === protocolFilter);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q)
      );
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
      case "created-desc":
      default:
        sorted.sort(
          (a, b) =>
            parseDBDate(b.createdAt).getTime() - parseDBDate(a.createdAt).getTime()
        );
        break;
    }
    return sorted;
  }, [data, protocolFilter, search, sort]);

  return (
    <>
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search connections..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[220px]"
            />
          </div>
          <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
            {(["all", "sftp", "smb", "azure-blob", "local"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setProtocolFilter(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                  protocolFilter === p
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "all" ? "All" : p === "azure-blob" ? "Azure" : p === "local" ? "Local" : p.toUpperCase()}
                <span className="ml-1 text-muted-foreground">
                  {protocolCounts[p]}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
            <SelectTrigger className="w-[160px] h-9 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A–Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z–A)</SelectItem>
              <SelectItem value="created-desc">Newest first</SelectItem>
              <SelectItem value="created-asc">Oldest first</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button onClick={onNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Connection
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No connections yet.</p>
          <p className="text-xs mt-1">Add a connection to get started.</p>
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No connections match your filters.</p>
          <p className="text-xs mt-1">Try adjusting your search or filter.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((conn) => (
              <TableRow key={conn.id}>
                <TableCell className="font-medium">{conn.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="uppercase">
                    {conn.protocol}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{conn.host}</TableCell>
                <TableCell>{conn.port}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDistanceToNow(parseDBDate(conn.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Test connection"
                      disabled={testingId === conn.id}
                      onClick={() => testConnection(conn)}
                    >
                      {testingId === conn.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <PlugZap className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Browse file system"
                      onClick={() => setBrowser({ conn })}
                    >
                      <FolderSearch className="h-4 w-4" />
                    </Button>
                    {isAdmin && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEdit(conn)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm("Delete this connection?")) {
                              deleteMutation.mutate(conn.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>

    {browser && (
      <FolderBrowser
        open
        connectionId={browser.conn.id}
        connectionName={browser.conn.name}
        onClose={() => setBrowser(null)}
        onSelect={() => setBrowser(null)}
      />
    )}
    </>
  );
}
