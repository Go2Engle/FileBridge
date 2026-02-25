"use client";

import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const ssoSchema = z.object({
  provider: z.enum(["azure-ad", "github"]),
  enabled: z.boolean(),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
  tenantId: z.string().optional(),
});

type SsoFormValues = z.infer<typeof ssoSchema>;

interface SsoConfigFormProps {
  open: boolean;
  onClose: () => void;
  editProvider: string | null;
  configuredProviders: Set<string>;
}

export function SsoConfigForm({
  open,
  onClose,
  editProvider,
  configuredProviders,
}: SsoConfigFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editProvider;

  const form = useForm<SsoFormValues>({
    resolver: zodResolver(ssoSchema) as Resolver<SsoFormValues>,
    defaultValues: {
      provider: "azure-ad",
      enabled: true,
      clientId: "",
      clientSecret: "",
      tenantId: "",
    },
  });

  useEffect(() => {
    if (editProvider) {
      form.reset({
        provider: editProvider as "azure-ad" | "github",
        enabled: true,
        clientId: "",
        clientSecret: "",
        tenantId: "",
      });
    } else {
      // Pick first unconfigured provider
      const defaultProvider = !configuredProviders.has("azure-ad")
        ? "azure-ad"
        : !configuredProviders.has("github")
          ? "github"
          : "azure-ad";
      form.reset({
        provider: defaultProvider as "azure-ad" | "github",
        enabled: true,
        clientId: "",
        clientSecret: "",
        tenantId: "",
      });
    }
  }, [editProvider, configuredProviders, form]);

  const mutation = useMutation({
    mutationFn: async (values: SsoFormValues) => {
      const res = await fetch("/api/admin/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sso"] });
      toast.success(isEdit ? "SSO provider updated" : "SSO provider added");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const provider = form.watch("provider");
  const isAzure = provider === "azure-ad";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Configure SSO Provider" : "Add SSO Provider"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isEdit}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="azure-ad">
                        Microsoft Azure AD
                      </SelectItem>
                      <SelectItem value="github">GitHub</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Enabled</FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Show on the login page
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Application (client) ID" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clientSecret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Client Secret
                    {isEdit && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        (enter new value to update)
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Client secret value" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isAzure && (
              <FormField
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tenant ID</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Directory (tenant) ID"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Configuration"
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
