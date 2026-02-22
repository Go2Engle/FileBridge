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
import { Loader2, PlugZap } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { Connection } from "@/lib/db/schema";

const baseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  protocol: z.enum(["sftp", "smb"]),
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535),
  // SFTP fields
  username: z.string().min(1, "Username is required"),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  // SMB extra fields
  domain: z.string().optional(),
  share: z.string().optional(),
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
    if (editConnection && fullConnection) {
      const creds = fullConnection.credentials as Record<string, string>;
      form.reset({
        name: fullConnection.name,
        protocol: fullConnection.protocol,
        host: fullConnection.host,
        port: fullConnection.port,
        username: creds.username ?? "",
        password: creds.password ?? "",
        privateKey: creds.privateKey ?? "",
        passphrase: creds.passphrase ?? "",
        domain: creds.domain ?? "",
        share: creds.share ?? "",
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
      });
    }
  }, [editConnection, fullConnection, form]);

  // Auto-update default port when protocol changes
  useEffect(() => {
    if (!isEditing) {
      form.setValue("port", protocol === "smb" ? 445 : 22);
    }
  }, [protocol, isEditing, form]);

  async function testConnection() {
    const values = form.getValues();
    const { protocol, host, port, username, password, privateKey, passphrase, domain, share } = values;
    const credentials: Record<string, string> = { username };
    if (protocol === "sftp") {
      if (password) credentials.password = password;
      if (privateKey) credentials.privateKey = privateKey;
      if (passphrase) credentials.passphrase = passphrase;
    } else {
      if (password) credentials.password = password;
      credentials.domain = domain ?? "";
      credentials.share = share ?? "";
    }
    setIsTesting(true);
    try {
      const { data } = await axios.post("/api/connections/test", { protocol, host, port, credentials });
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
      const { name, protocol, host, port, username, password, privateKey, passphrase, domain, share } = values;
      const credentials: Record<string, string> = { username };
      if (protocol === "sftp") {
        if (password) credentials.password = password;
        if (privateKey) credentials.privateKey = privateKey;
        if (passphrase) credentials.passphrase = passphrase;
      } else {
        if (password) credentials.password = password;
        // Always persist domain and share even when empty so they're never undefined
        credentials.domain = domain ?? "";
        credentials.share = share ?? "";
      }
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

            <div className="grid grid-cols-2 gap-4">
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
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
            </div>

            <FormField
              control={form.control}
              name="host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Host</FormLabel>
                  <FormControl>
                    <Input placeholder="192.168.1.100 or server.example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Credentials
            </p>

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
  );
}
