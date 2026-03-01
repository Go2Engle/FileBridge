"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PenLine, Trash2, Plus, Terminal, Webhook } from "lucide-react";
import type { Hook } from "@/lib/db/schema";
import { HookForm } from "./hook-form";
import { useRole } from "@/hooks/use-role";

export function HooksList() {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const [formOpen, setFormOpen] = useState(false);
  const [editHook, setEditHook] = useState<Hook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Hook | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data: hooks, isLoading } = useQuery<Hook[]>({
    queryKey: ["hooks"],
    queryFn: () => axios.get("/api/hooks").then((r) => r.data),
  });

  const toggleMutation = useMutation({
    mutationFn: (hook: Hook) =>
      axios.put(`/api/hooks/${hook.id}`, { enabled: !hook.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hooks"] }),
    onError: () => toast.error("Failed to update hook"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/hooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hooks"] });
      toast.success("Hook deleted");
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const jobs = (err.response.data as { jobs: { name: string }[] }).jobs ?? [];
        setDeleteError(
          `This hook is attached to: ${jobs.map((j) => j.name).join(", ")}. Remove it from those jobs first.`
        );
      } else {
        toast.error("Failed to delete hook");
        setDeleteTarget(null);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {hooks?.length === 0
            ? "No hooks yet. Create one to get started."
            : `${hooks?.length} hook${hooks?.length !== 1 ? "s" : ""}`}
        </p>
        {isAdmin && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => { setEditHook(null); setFormOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            New Hook
          </Button>
        )}
      </div>

      {hooks && hooks.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Enabled</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {hooks.map((hook) => (
              <TableRow key={hook.id}>
                <TableCell className="font-medium">{hook.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1 text-xs capitalize">
                    {hook.type === "webhook" ? (
                      <Webhook className="h-3 w-3" />
                    ) : (
                      <Terminal className="h-3 w-3" />
                    )}
                    {hook.type === "webhook" ? "Webhook" : "Shell"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[280px] truncate">
                  {hook.description ?? "—"}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={hook.enabled}
                    onCheckedChange={() => isAdmin && toggleMutation.mutate(hook)}
                    disabled={!isAdmin || toggleMutation.isPending}
                    aria-label="Toggle hook enabled"
                  />
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setEditHook(hook); setFormOpen(true); }}
                      >
                        <PenLine className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setDeleteError(null); setDeleteTarget(hook); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <HookForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditHook(null); }}
        editHook={editHook}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete hook?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>
                  <strong>{deleteTarget?.name}</strong> will be permanently deleted.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
