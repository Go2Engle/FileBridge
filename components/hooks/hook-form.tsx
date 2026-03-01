"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2 } from "lucide-react";
import type { Hook } from "@/lib/db/schema";

// ---------- Schema ----------

const webhookSchema = z.object({
  type: z.literal("webhook"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.object({
    url: z.string().url("Must be a valid URL"),
    method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
    headers: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
    body: z.string().optional(),
    timeoutMs: z.coerce.number().int().min(100).max(120_000).optional(),
  }),
});

const shellSchema = z.object({
  type: z.literal("shell"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.object({
    command: z.string().min(1, "Command is required"),
    timeoutMs: z.coerce.number().int().min(100).max(300_000).optional(),
    workingDir: z.string().optional(),
  }),
});

const hookFormSchema = z.discriminatedUnion("type", [webhookSchema, shellSchema]);

type FormValues = z.infer<typeof hookFormSchema>;

// ---------- Props ----------

interface HookFormProps {
  open: boolean;
  onClose: () => void;
  editHook?: Hook | null;
}

// ---------- Component ----------

export function HookForm({ open, onClose, editHook }: HookFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editHook;
  const [selectedType, setSelectedType] = useState<"webhook" | "shell">("webhook");

  const form = useForm<FormValues>({
    resolver: zodResolver(hookFormSchema) as Resolver<FormValues>,
    defaultValues: {
      type: "webhook",
      name: "",
      description: "",
      enabled: true,
      config: { url: "", method: "POST", headers: [], body: "", timeoutMs: undefined },
    },
  });

  const { fields: headerFields, append: appendHeader, remove: removeHeader } = useFieldArray({
    control: form.control,
    name: "config.headers" as never,
  });

  useEffect(() => {
    if (!open) return;
    if (editHook) {
      const config = JSON.parse(editHook.config) as Record<string, unknown>;
      const type = editHook.type as "webhook" | "shell";
      setSelectedType(type);
      if (type === "webhook") {
        const headers = config.headers
          ? Object.entries(config.headers as Record<string, string>).map(([key, value]) => ({ key, value }))
          : [];
        form.reset({
          type: "webhook",
          name: editHook.name,
          description: editHook.description ?? "",
          enabled: editHook.enabled,
          config: {
            url: (config.url as string) ?? "",
            method: (config.method as "GET" | "POST" | "PUT" | "PATCH") ?? "POST",
            headers,
            body: (config.body as string) ?? "",
            timeoutMs: (config.timeoutMs as number | undefined),
          },
        });
      } else {
        form.reset({
          type: "shell",
          name: editHook.name,
          description: editHook.description ?? "",
          enabled: editHook.enabled,
          config: {
            command: (config.command as string) ?? "",
            timeoutMs: (config.timeoutMs as number | undefined),
            workingDir: (config.workingDir as string | undefined) ?? "",
          },
        });
      }
    } else {
      setSelectedType("webhook");
      form.reset({
        type: "webhook",
        name: "",
        description: "",
        enabled: true,
        config: { url: "", method: "POST", headers: [], body: "", timeoutMs: undefined },
      });
    }
  }, [open, editHook, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      // Convert headers array to object for webhook
      const payload = { ...values };
      if (payload.type === "webhook") {
        const headersArr = (payload.config.headers ?? []) as { key: string; value: string }[];
        const headersObj: Record<string, string> = {};
        for (const { key, value } of headersArr) {
          if (key.trim()) headersObj[key.trim()] = value;
        }
        (payload.config as Record<string, unknown>).headers = headersObj;
      }
      return isEditing
        ? axios.put(`/api/hooks/${editHook!.id}`, payload)
        : axios.post("/api/hooks", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hooks"] });
      toast.success(isEditing ? "Hook updated" : "Hook created");
      onClose();
    },
    onError: () => toast.error("Failed to save hook"),
  });

  function handleTypeChange(t: "webhook" | "shell") {
    setSelectedType(t);
    const name = form.getValues("name");
    const description = form.getValues("description");
    const enabled = form.getValues("enabled");
    if (t === "webhook") {
      form.reset({
        type: "webhook",
        name,
        description,
        enabled,
        config: { url: "", method: "POST", headers: [], body: "", timeoutMs: undefined },
      });
    } else {
      form.reset({
        type: "shell",
        name,
        description,
        enabled,
        config: { command: "", timeoutMs: undefined, workingDir: "" },
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Hook" : "New Hook"}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(85vh-10rem)] -mx-6 px-6">
          <Form {...form}>
            <form
              id="hook-form"
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="space-y-4 pb-4"
            >
              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Notify Slack on completion" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Short description of what this hook does" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Type */}
              <Separator />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={selectedType === "webhook" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => handleTypeChange("webhook")}
                >
                  Webhook
                </Button>
                <Button
                  type="button"
                  variant={selectedType === "shell" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => handleTypeChange("shell")}
                >
                  Shell Command
                </Button>
              </div>

              {/* Webhook fields */}
              {selectedType === "webhook" && (
                <>
                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Webhook</p>

                  <div className="grid grid-cols-[1fr_120px] gap-3">
                    <FormField
                      control={form.control}
                      name={"config.url" as "config.url" & string}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://hooks.example.com/notify" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={"config.method" as "config.method" & string}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Method</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value as string ?? "POST"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {["GET", "POST", "PUT", "PATCH"].map((m) => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Headers */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <FormLabel>Headers <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => appendHeader({ key: "", value: "" })}
                        disabled={headerFields.length >= 10}
                      >
                        <Plus className="h-3 w-3" />
                        Add
                      </Button>
                    </div>
                    {headerFields.map((f, i) => (
                      <div key={f.id} className="flex gap-2">
                        <Input
                          placeholder="Header name"
                          {...form.register(`config.headers.${i}.key` as never)}
                          className="flex-1"
                        />
                        <Input
                          placeholder="Value"
                          {...form.register(`config.headers.${i}.value` as never)}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          onClick={() => removeHeader(i)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Body */}
                  <FormField
                    control={form.control}
                    name={"config.body" as "config.body" & string}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Body template <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={`Leave blank to use the default JSON payload.\nAvailable variables: {{job_id}}, {{job_name}}, {{trigger}}, {{status}}, {{files_transferred}}, {{bytes_transferred}}, {{error_message}}`}
                            className="font-mono text-xs min-h-[80px]"
                            {...field}
                            value={field.value as string ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Timeout */}
                  <FormField
                    control={form.control}
                    name={"config.timeoutMs" as "config.timeoutMs" & string}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Timeout (ms) <span className="text-muted-foreground font-normal">(optional, default 10000)</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="10000"
                            {...field}
                            value={field.value as number ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {/* Shell fields */}
              {selectedType === "shell" && (
                <>
                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shell Command</p>

                  <FormField
                    control={form.control}
                    name={"config.command" as "config.command" & string}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Command</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={"bash /opt/scripts/notify.sh\n# or multi-line:\nexport FOO=bar\nbash /opt/scripts/notify.sh"}
                            className="font-mono text-sm min-h-24 resize-y"
                            {...field}
                            value={field.value as string ?? ""}
                          />
                        </FormControl>
                        <FormDescription className="text-xs">
                          Available env vars: <code className="text-xs">FILEBRIDGE_JOB_ID</code>, <code className="text-xs">FILEBRIDGE_JOB_NAME</code>, <code className="text-xs">FILEBRIDGE_TRIGGER</code>, <code className="text-xs">FILEBRIDGE_STATUS</code>, <code className="text-xs">FILEBRIDGE_FILES_TRANSFERRED</code>, <code className="text-xs">FILEBRIDGE_BYTES_TRANSFERRED</code>
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name={"config.workingDir" as "config.workingDir" & string}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Working directory <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                          <FormControl>
                            <Input
                              placeholder="/opt/scripts"
                              className="font-mono text-sm"
                              {...field}
                              value={field.value as string ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={"config.timeoutMs" as "config.timeoutMs" & string}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Timeout (ms) <span className="text-muted-foreground font-normal">(optional, default 30000)</span></FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="30000"
                              {...field}
                              value={field.value as number ?? ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </>
              )}

              {/* Enabled */}
              <Separator />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div>
                      <FormLabel>Enabled</FormLabel>
                      <FormDescription className="text-xs">
                        Disabled hooks are skipped silently when a job runs.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="hook-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : isEditing ? "Save Changes" : "Create Hook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
