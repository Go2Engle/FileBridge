"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderOpen, Loader2, PlugZap } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Connection } from "@/lib/db/schema";
import { LocalFolderPicker } from "@/components/ui/local-folder-picker";

const baseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  protocol: z.enum(["sftp", "smb", "azure-blob", "local"]),
  host: z.string().min(1, "Required"),
  port: z.coerce.number().int().min(0).max(65535),
  // SFTP / SMB fields
  username: z.string().optional(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  // SMB extra fields
  domain: z.string().optional(),
  share: z.string().optional(),
  // Azure Blob fields
  container: z.string().optional(),
  accountKey: z.string().optional(),
  connectionString: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.protocol === "sftp" || data.protocol === "smb") {
    if (!data.username?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Username is required",
        path: ["username"],
      });
    }
  }
  if (data.protocol === "azure-blob") {
    if (!data.container?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Container is required",
        path: ["container"],
      });
    }
    if (!data.accountKey?.trim() && !data.connectionString?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account Key or Connection String is required",
        path: ["accountKey"],
      });
    }
  }
});

type FormValues = z.infer<typeof baseSchema>;

interface ConnectionFormProps {
  open: boolean;
  onClose: () => void;
  editConnection?: Pick<Connection, "id"> | null;
}

export function ConnectionForm({ open, onClose, editConnection }: ConnectionFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editConnection;
  const [isTesting, setIsTesting] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      name: "",
      protocol: "sftp",
      host: "",
      port: 22,
      username: "",
      password: "",
      privateKey: "",
      passphrase: "",
      domain: "",
      share: "",
      container: "",
      accountKey: "",
      connectionString: "",
    },
  });

  const protocol = form.watch("protocol");

  // Fetch the full connection (including credentials) when editing.
  // The list endpoint strips credentials for security, so we need a dedicated fetch.
  const { data: fullConnection } = useQuery<Connection>({
    queryKey: ["connections", editConnection?.id],
    queryFn: () => axios.get(`/api/connections/${editConnection!.id}`).then((r) => r.data),
    enabled: !!editConnection,
  });

  useEffect(() => {
    if (!open) return;
    if (editConnection && fullConnection) {
      const creds = fullConnection.credentials as Record<string, string>;
      form.reset({
        name: fullConnection.name,
        protocol: fullConnection.protocol as FormValues["protocol"],
        host: fullConnection.host,
        port: fullConnection.port,
        username: creds.username ?? "",
        password: creds.password ?? "",
        privateKey: creds.privateKey ?? "",
        passphrase: creds.passphrase ?? "",
        domain: creds.domain ?? "",
        share: creds.share ?? "",
        container: creds.container ?? "",
        accountKey: creds.accountKey ?? "",
        connectionString: creds.connectionString ?? "",
      });
    } else if (!editConnection) {
      form.reset({
        name: "",
        protocol: "sftp",
        host: "",
        port: 22,
        username: "",
        password: "",
        privateKey: "",
        passphrase: "",
        domain: "",
        share: "",
        container: "",
        accountKey: "",
        connectionString: "",
      });
    }
  }, [open, editConnection, fullConnection, form]);

  // Auto-update default port when protocol changes
  useEffect(() => {
    if (!isEditing) {
      if (protocol === "smb") form.setValue("port", 445);
      else if (protocol === "azure-blob") form.setValue("port", 443);
      else if (protocol === "local") form.setValue("port", 0);
      else form.setValue("port", 22);
    }
  }, [protocol, isEditing, form]);

  function buildCredentials(values: FormValues): Record<string, string> {
    const { protocol, host, username, password, privateKey, passphrase, domain, share, container, accountKey, connectionString } = values;
    const credentials: Record<string, string> = {};

    if (protocol === "sftp") {
      credentials.username = username ?? "";
      if (password) credentials.password = password;
      if (privateKey) credentials.privateKey = privateKey;
      if (passphrase) credentials.passphrase = passphrase;
    } else if (protocol === "smb") {
      credentials.username = username ?? "";
      if (password) credentials.password = password;
      credentials.domain = domain ?? "";
      credentials.share = share ?? "";
    } else if (protocol === "azure-blob") {
      credentials.accountName = host;
      credentials.container = container ?? "";
      if (accountKey) credentials.accountKey = accountKey;
      if (connectionString) credentials.connectionString = connectionString;
    }
    // "local" needs no credentials — basePath is stored in host

    return credentials;
  }

  async function testConnection() {
    const values = form.getValues();
    const credentials = buildCredentials(values);
    setIsTesting(true);
    try {
      const { data } = await axios.post("/api/connections/test", {
        protocol: values.protocol,
        host: values.host,
        port: values.port,
        credentials,
      });
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Connection test failed");
      }
    } catch {
      toast.error("Test request failed");
    } finally {
      setIsTesting(false);
    }
  }

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const { name, protocol, host, port } = values;
      const credentials = buildCredentials(values);
      const payload = { name, protocol, host, port, credentials };
      return isEditing
        ? axios.put(`/api/connections/${editConnection!.id}`, payload)
        : axios.post("/api/connections", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connections"] });
      toast.success(isEditing ? "Connection updated" : "Connection created");
      onClose();
    },
    onError: () => toast.error("Failed to save connection"),
  });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Connection" : "New Connection"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Production SFTP" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className={protocol === "local" ? "" : "grid grid-cols-2 gap-4"}>
              <FormField
                control={form.control}
                name="protocol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Protocol</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sftp">SFTP</SelectItem>
                        <SelectItem value="smb">SMB</SelectItem>
                        <SelectItem value="azure-blob">Azure Blob</SelectItem>
                        <SelectItem value="local">Local</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {protocol !== "local" && (
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Port</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <FormField
              control={form.control}
              name="host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {protocol === "local"
                      ? "Base Path"
                      : protocol === "azure-blob"
                        ? "Storage Account Name"
                        : "Host"}
                  </FormLabel>
                  <FormControl>
                    {protocol === "local" ? (
                      <div className="flex gap-2">
                        <Input
                          placeholder="/data/files"
                          {...field}
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Browse server filesystem"
                          onClick={() => setIsBrowsing(true)}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Input
                        placeholder={
                          protocol === "azure-blob"
                            ? "myaccount"
                            : "192.168.1.100 or server.example.com"
                        }
                        {...field}
                      />
                    )}
                  </FormControl>
                  {protocol === "local" && (
                    <FormDescription>
                      Absolute path to the root directory on the server&apos;s filesystem. Job paths are resolved relative to this directory.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {protocol !== "local" && <Separator />}
            {protocol !== "local" && (
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Credentials
              </p>
            )}

            {(protocol === "sftp" || protocol === "smb") && (
              <>
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={isEditing ? "Leave blank to keep current" : ""} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {protocol === "sftp" && (
              <>
                <FormField
                  control={form.control}
                  name="privateKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Private Key (PEM)</FormLabel>
                      <FormControl>
                        <Input placeholder="Optional — paste PEM content" {...field} />
                      </FormControl>
                      <FormDescription>Use instead of or alongside password</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="passphrase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Key Passphrase</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Optional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {protocol === "smb" && (
              <>
                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domain</FormLabel>
                      <FormControl>
                        <Input placeholder="Leave blank for NAS / local accounts" {...field} />
                      </FormControl>
                      <FormDescription>
                        Leave blank for NAS devices and local Windows accounts. Only set for Active Directory domain accounts (e.g. CORP).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="share"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Share Name</FormLabel>
                      <FormControl>
                        <Input placeholder="shared" {...field} />
                      </FormControl>
                      <FormDescription>
                        The share portion of \\server\share
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {protocol === "azure-blob" && (
              <>
                <FormField
                  control={form.control}
                  name="container"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Container</FormLabel>
                      <FormControl>
                        <Input placeholder="my-container" {...field} />
                      </FormControl>
                      <FormDescription>
                        The blob container within the storage account
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="accountKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Key</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder={isEditing ? "Leave blank to keep current" : "Base64 access key"}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        The base64 storage account key. Not required if Connection String is provided.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="connectionString"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Connection String{" "}
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        If provided, overrides Account Name and Account Key. Found in Azure Portal under Access keys.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={isTesting}
                onClick={testConnection}
              >
                {isTesting
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Testing...</>
                  : <><PlugZap className="h-4 w-4 mr-2" />Test Connection</>}
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    {protocol === "local" && (
      <LocalFolderPicker
        open={isBrowsing}
        initialPath={form.getValues("host") || "/"}
        onClose={() => setIsBrowsing(false)}
        onSelect={(path) => form.setValue("host", path, { shouldValidate: true })}
      />
    )}
    </>
  );
}
