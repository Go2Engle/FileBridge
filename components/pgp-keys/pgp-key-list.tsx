"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { PenLine, Trash2, Plus, Download, Eye, Copy, RefreshCw } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { PgpKeyForm } from "./pgp-key-form";
import { PgpKeyDetail } from "./pgp-key-detail";
import { PgpKeyRotateDialog } from "./pgp-key-rotate-dialog";

export interface PgpKeyPublic {
  id: number;
  name: string;
  description: string | null;
  keyType: "public" | "keypair";
  algorithm: string;
  fingerprint: string;
  userId: string | null;
  keyCreatedAt: string | null;
  keyExpiresAt: string | null;
  publicKey: string;
  createdAt: string;
  updatedAt: string;
}

export function PgpKeyList() {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const [formOpen, setFormOpen] = useState(false);
  const [editKey, setEditKey] = useState<PgpKeyPublic | null>(null);
  const [detailKey, setDetailKey] = useState<PgpKeyPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PgpKeyPublic | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState<PgpKeyPublic | null>(null);

  const { data: keys, isLoading } = useQuery<PgpKeyPublic[]>({
    queryKey: ["pgp-keys"],
    queryFn: () => axios.get("/api/pgp-keys").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/pgp-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pgp-keys"] });
      toast.success("PGP key deleted");
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        const jobs = (err.response.data as { jobs: { name: string }[] }).jobs ?? [];
        setDeleteError(
          `This key is used by: ${jobs.map((j) => j.name).join(", ")}. Remove it from those jobs first.`
        );
      } else {
        toast.error("Failed to delete PGP key");
        setDeleteTarget(null);
      }
    },
  });

  function copyFingerprint(fp: string) {
    navigator.clipboard.writeText(fp);
    toast.success("Fingerprint copied");
  }

  function exportKey(key: PgpKeyPublic, type: "public" | "private") {
    window.open(`/api/pgp-keys/${key.id}/export?type=${type}`, "_blank");
  }

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
          {keys?.length === 0
            ? "No PGP keys yet. Create or import one to get started."
            : `${keys?.length} key${keys?.length !== 1 ? "s" : ""}`}
        </p>
        {isAdmin && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => { setEditKey(null); setFormOpen(true); }}
          >
            <Plus className="h-4 w-4" />
            New Key
          </Button>
        )}
      </div>

      {keys && keys.length > 0 && (
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Algorithm</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">
                    <div>
                      {key.name}
                      {key.userId && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {key.userId}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={key.keyType === "keypair" ? "default" : "secondary"}>
                      {key.keyType === "keypair" ? "Keypair" : "Public"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{key.algorithm}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="font-mono text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => copyFingerprint(key.fingerprint)}
                        >
                          {key.fingerprint.slice(-16)}
                          <Copy className="inline ml-1 h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono text-xs">{key.fingerprint}</p>
                        <p className="text-xs mt-1">Click to copy</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm">
                    {key.keyExpiresAt
                      ? new Date(key.keyExpiresAt).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDetailKey(key)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View details</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => exportKey(key, "public")}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Export public key</TooltipContent>
                      </Tooltip>
                      {isAdmin && (
                        <>
                          {key.keyType === "keypair" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setRotateKey(key)}
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Rotate key</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setEditKey(key); setFormOpen(true); }}
                              >
                                <PenLine className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => { setDeleteError(null); setDeleteTarget(key); }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}

      <PgpKeyForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditKey(null); }}
        editKey={editKey}
      />

      <PgpKeyDetail
        pgpKey={detailKey}
        open={!!detailKey}
        onClose={() => setDetailKey(null)}
      />

      <PgpKeyRotateDialog
        open={!!rotateKey}
        onClose={() => setRotateKey(null)}
        sourceKey={rotateKey}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete PGP key?</AlertDialogTitle>
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
                onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
