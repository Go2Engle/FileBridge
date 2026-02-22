"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Edit2, FolderSearch, Loader2, Plus, PlugZap, Trash2 } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Connection } from "@/lib/db/schema";

// The list endpoint strips credentials and adds a top-level username for display
type ConnectionSummary = Omit<Connection, "credentials"> & { username: string };
import { parseDBDate } from "@/lib/utils";
import { FolderBrowser } from "@/components/ui/folder-browser";

interface ConnectionListProps {
  onEdit: (connection: ConnectionSummary) => void;
  onNew: () => void;
}

export function ConnectionList({ onEdit, onNew }: ConnectionListProps) {
  const queryClient = useQueryClient();
  const [browser, setBrowser] = useState<{ conn: ConnectionSummary } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

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

  return (
    <>
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Connection
        </Button>
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
            {data.map((conn) => (
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
