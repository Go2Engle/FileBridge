"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/hooks/use-role";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { toast } from "sonner";
import { SsoConfigForm } from "@/components/admin/sso-config-form";

interface SsoConfig {
  provider: string;
  config: {
    enabled: boolean;
    clientId: string;
    tenantId?: string;
  };
}

const PROVIDER_META: Record<
  string,
  { name: string; description: string }
> = {
  "azure-ad": {
    name: "Microsoft Azure AD",
    description: "Allow users to sign in with their Microsoft work accounts",
  },
  github: {
    name: "GitHub",
    description: "Allow users to sign in with their GitHub accounts",
  },
};

export default function AuthenticationPage() {
  const { isAdmin } = useRole();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: configs = [], isLoading } = useQuery<SsoConfig[]>({
    queryKey: ["admin-sso"],
    queryFn: () => fetch("/api/admin/sso").then((r) => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/admin/sso/${provider}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sso"] });
      toast.success("SSO provider removed");
      setDeleteTarget(null);
    },
    onError: () => toast.error("Failed to remove provider"),
  });

  if (!isAdmin) {
    router.replace("/dashboard");
    return null;
  }

  const configuredProviders = new Set(configs.map((c) => c.provider));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-6 w-6" />
            Authentication
          </h1>
          <p className="text-muted-foreground">
            Configure external single sign-on providers.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditProvider(null);
            setFormOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Provider
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-24 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <KeyRound className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>No SSO providers configured.</p>
            <p className="text-sm">
              Users can sign in with local credentials. Add an SSO provider to
              enable external authentication.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {configs.map(({ provider, config }) => {
            const meta = PROVIDER_META[provider] ?? {
              name: provider,
              description: "",
            };
            return (
              <Card key={provider}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-lg">{meta.name}</CardTitle>
                    <CardDescription>{meta.description}</CardDescription>
                  </div>
                  <Badge
                    variant={config.enabled ? "default" : "secondary"}
                  >
                    {config.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>
                        Client ID:{" "}
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {config.clientId}
                        </code>
                      </p>
                      {config.tenantId && (
                        <p>
                          Tenant ID:{" "}
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {config.tenantId}
                          </code>
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditProvider(provider);
                          setFormOpen(true);
                        }}
                      >
                        <Settings2 className="mr-1 h-4 w-4" />
                        Configure
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTarget(provider)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SsoConfigForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditProvider(null);
        }}
        editProvider={editProvider}
        configuredProviders={configuredProviders}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove SSO Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this SSO provider? Users will no
              longer be able to sign in with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
