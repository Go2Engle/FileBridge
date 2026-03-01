"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { FolderSearch, Terminal, Webhook } from "lucide-react";
import { FolderBrowser } from "@/components/ui/folder-browser";
import type { Connection, Job, Hook } from "@/lib/db/schema";

const jobSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceConnectionId: z.coerce.number().min(1, "Source connection required"),
  sourcePath: z.string().min(1, "Source path is required"),
  destinationConnectionId: z.coerce.number().min(1, "Destination connection required"),
  destinationPath: z.string().min(1, "Destination path is required"),
  fileFilter: z.string().default(""),
  schedule: z.string().min(1, "Schedule is required"),
  postTransferAction: z.enum(["retain", "delete", "move"]).default("retain"),
  movePath: z.string().optional(),
  overwriteExisting: z.boolean().default(false),
  skipHiddenFiles: z.boolean().default(true),
  extractArchives: z.boolean().default(false),
  deltaSync: z.boolean().default(false),
});

type FormValues = z.infer<typeof jobSchema>;

const CRON_PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Daily at 8am", value: "0 8 * * *" },
  { label: "Weekdays at 9am", value: "0 9 * * 1-5" },
];

type BrowseTarget = { connectionId: number; connectionName: string; field: "sourcePath" | "destinationPath" | "movePath" };

function formatTime(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const m = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${h}${m} ${ampm}`;
}

const DAY_NAMES: Record<string, string> = {
  "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
  "4": "Thursday", "5": "Friday", "6": "Saturday",
};

function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, month, dow] = parts;
  const minNum = parseInt(min);
  const hrNum = parseInt(hr);
  const isNum = (s: string) => /^\d+$/.test(s);

  if (cron.trim() === "* * * * *") return "Every minute";

  if (/^\*\/\d+$/.test(min) && hr === "*" && dom === "*" && month === "*") {
    const n = parseInt(min.slice(2));
    const freq = `Every ${n} minute${n !== 1 ? "s" : ""}`;
    if (dow === "*") return freq;
    if (dow === "1-5") return `${freq}, weekdays only`;
    if (dow === "0,6" || dow === "6,0") return `${freq}, weekends only`;
    if (isNum(dow) && DAY_NAMES[dow]) return `${freq}, ${DAY_NAMES[dow]}s only`;
    return `${freq} (${dow})`;
  }

  if (isNum(min) && hr === "*" && dom === "*" && month === "*" && dow === "*")
    return minNum === 0 ? "Every hour" : `Every hour at minute ${minNum}`;

  if (min === "0" && /^\*\/\d+$/.test(hr) && dom === "*" && month === "*" && dow === "*") {
    const n = parseInt(hr.slice(2));
    return `Every ${n} hour${n !== 1 ? "s" : ""}`;
  }

  if (isNum(min) && isNum(hr) && dom === "*" && month === "*" && dow === "*")
    return `Daily at ${formatTime(hrNum, minNum)}`;

  if (isNum(min) && isNum(hr) && dom === "*" && month === "*" && dow !== "*") {
    const time = formatTime(hrNum, minNum);
    if (dow === "1-5") return `Weekdays (Mon\u2013Fri) at ${time}`;
    if (dow === "0,6" || dow === "6,0") return `Weekends at ${time}`;
    if (isNum(dow) && DAY_NAMES[dow]) return `Every ${DAY_NAMES[dow]} at ${time}`;
  }

  return null;
}

interface JobFormProps {
  open: boolean;
  onClose: () => void;
  editJob?: Job | null;
}

export function JobForm({ open, onClose, editJob }: JobFormProps) {
  const queryClient = useQueryClient();
  const isEditing = !!editJob;
  const [browsing, setBrowsing] = useState<BrowseTarget | null>(null);

  const { data: connections } = useQuery<Connection[]>({
    queryKey: ["connections"],
    queryFn: () => axios.get("/api/connections").then((r) => r.data),
  });

  const { data: availableHooks } = useQuery<Hook[]>({
    queryKey: ["hooks"],
    queryFn: () => axios.get("/api/hooks").then((r) => r.data),
  });

  const [preHookIds, setPreHookIds] = useState<number[]>([]);
  const [postHookIds, setPostHookIds] = useState<number[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(jobSchema) as Resolver<FormValues>,
    defaultValues: {
      name: "",
      sourceConnectionId: 0,
      sourcePath: "",
      destinationConnectionId: 0,
      destinationPath: "",
      fileFilter: "",
      schedule: "0 * * * *",
      postTransferAction: "retain",
      movePath: "",
      overwriteExisting: false,
      skipHiddenFiles: true,
      extractArchives: false,
      deltaSync: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editJob) {
      form.reset({
        name: editJob.name,
        sourceConnectionId: editJob.sourceConnectionId,
        sourcePath: editJob.sourcePath,
        destinationConnectionId: editJob.destinationConnectionId,
        destinationPath: editJob.destinationPath,
        fileFilter: editJob.fileFilter ?? "",
        schedule: editJob.schedule,
        postTransferAction: (editJob.postTransferAction as FormValues["postTransferAction"]) ?? "retain",
        movePath: editJob.movePath ?? "",
        overwriteExisting: editJob.overwriteExisting ?? false,
        skipHiddenFiles: editJob.skipHiddenFiles ?? true,
        extractArchives: editJob.extractArchives ?? false,
        deltaSync: editJob.deltaSync ?? false,
      });
      // Load existing hook associations
      axios.get(`/api/jobs/${editJob.id}/hooks`).then((r) => {
        const data = r.data as { pre: Hook[]; post: Hook[] };
        setPreHookIds(data.pre.map((h) => h.id));
        setPostHookIds(data.post.map((h) => h.id));
      }).catch(() => {});
    } else {
      form.reset({
        name: "",
        sourceConnectionId: 0,
        sourcePath: "",
        destinationConnectionId: 0,
        destinationPath: "",
        fileFilter: "*",
        schedule: "0 * * * *",
        postTransferAction: "retain",
        movePath: "",
        overwriteExisting: false,
        skipHiddenFiles: true,
        extractArchives: false,
        deltaSync: false,
      });
      setPreHookIds([]);
      setPostHookIds([]);
    }
  }, [open, editJob, form]);

  const postAction = form.watch("postTransferAction");
  const sourceConnectionId = form.watch("sourceConnectionId");
  const destinationConnectionId = form.watch("destinationConnectionId");
  const extractArchives = form.watch("extractArchives");
  const deltaSync = form.watch("deltaSync");

  const getConnectionName = (id: number) =>
    connections?.find((c) => c.id === id)?.name ?? "Connection";

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = isEditing
        ? await axios.put(`/api/jobs/${editJob!.id}`, values)
        : await axios.post("/api/jobs", values);
      const jobId: number = isEditing ? editJob!.id : (res.data as { id: number }).id;
      await axios.put(`/api/jobs/${jobId}/hooks`, { pre: preHookIds, post: postHookIds });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(isEditing ? "Job updated" : "Job created");
      onClose();
    },
    onError: () => toast.error("Failed to save job"),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Job" : "New Job"}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[calc(85vh-10rem)] -mx-6 px-6">
            <Form {...form}>
              <form
                id="job-form"
                onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
                className="space-y-4 pb-4"
              >
                {/* General */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Daily CSV Transfer" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Source */}
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source</p>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="sourceConnectionId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Connection</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select connection" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {connections?.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name} ({c.protocol.toUpperCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sourcePath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Path</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input placeholder="/uploads/incoming" {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={!sourceConnectionId}
                            title={sourceConnectionId ? "Browse folders" : "Select a connection first"}
                            onClick={() =>
                              setBrowsing({
                                connectionId: sourceConnectionId,
                                connectionName: getConnectionName(sourceConnectionId),
                                field: "sourcePath",
                              })
                            }
                          >
                            <FolderSearch className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Destination */}
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Destination</p>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="destinationConnectionId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Connection</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value ? String(field.value) : ""}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select connection" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {connections?.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name} ({c.protocol.toUpperCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="destinationPath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Path</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input placeholder="/archive/processed" {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={!destinationConnectionId}
                            title={destinationConnectionId ? "Browse folders" : "Select a connection first"}
                            onClick={() =>
                              setBrowsing({
                                connectionId: destinationConnectionId,
                                connectionName: getConnectionName(destinationConnectionId),
                                field: "destinationPath",
                              })
                            }
                          >
                            <FolderSearch className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Transfer Rules */}
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transfer Rules</p>

                <div className="grid grid-cols-2 gap-4 items-start">
                  <FormField
                    control={form.control}
                    name="fileFilter"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>File Filter</FormLabel>
                        <FormControl>
                          <Input placeholder="*.csv, *.txt" {...field} />
                        </FormControl>
                        <FormDescription>
                          Comma-separated patterns (e.g. *.csv, *.txt). Leave empty to transfer all files.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="postTransferAction"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Post-Transfer Action</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="retain">Retain (keep source)</SelectItem>
                            <SelectItem value="delete">Delete (remove source)</SelectItem>
                            <SelectItem value="move">Move (relocate source)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {postAction === "move" && (
                  <FormField
                    control={form.control}
                    name="movePath"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Move Destination Path</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input placeholder="/archive/sent" {...field} />
                          </FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={!sourceConnectionId}
                            title={sourceConnectionId ? "Browse source connection folders" : "Select a source connection first"}
                            onClick={() =>
                              setBrowsing({
                                connectionId: sourceConnectionId,
                                connectionName: getConnectionName(sourceConnectionId),
                                field: "movePath",
                              })
                            }
                          >
                            <FolderSearch className="h-4 w-4" />
                          </Button>
                        </div>
                        <FormDescription>
                          Source files will be moved here after transfer
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* Schedule */}
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Schedule</p>

                <FormField
                  control={form.control}
                  name="schedule"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cron Expression</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input
                            placeholder="0 * * * *"
                            className="font-mono"
                            {...field}
                          />
                        </FormControl>
                        <Select onValueChange={(v) => form.setValue("schedule", v)}>
                          <SelectTrigger className="w-48">
                            <SelectValue placeholder="Presets" />
                          </SelectTrigger>
                          <SelectContent>
                            {CRON_PRESETS.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <FormDescription>
                        {describeCron(field.value) ?? "Standard 5-field cron expression"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Options */}
                <Separator />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Options</p>

                <FormField
                  control={form.control}
                  name="overwriteExisting"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Overwrite existing files</FormLabel>
                        <FormDescription>
                          Replace files at the destination if they already exist.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="skipHiddenFiles"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Skip hidden files</FormLabel>
                        <FormDescription>
                          Ignore files starting with a dot (e.g. .DS_Store).
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="extractArchives"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Extract archives</FormLabel>
                        <FormDescription>
                          Extract .zip, .tar, .tar.gz, and .tgz files and transfer
                          their contents instead of the archive itself.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deltaSync"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel>Delta sync</FormLabel>
                        <FormDescription>
                          Only transfer files that are new or modified since the last sync.
                          Files whose destination copy is the same age or newer are skipped.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {extractArchives && deltaSync && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 px-1">
                    Delta sync does not apply to archive files. When both options are enabled,
                    archives are always downloaded and extracted on every run.
                  </p>
                )}

                {/* Hooks */}
                {availableHooks && availableHooks.length > 0 && (
                  <>
                    <Separator />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hooks</p>

                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium mb-2">Pre-job</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Run before any files are transferred. A failure aborts the job.
                        </p>
                        <div className="space-y-2">
                          {availableHooks.map((hook) => (
                            <label
                              key={hook.id}
                              className="flex items-center gap-2.5 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={preHookIds.includes(hook.id)}
                                onCheckedChange={(checked: boolean | "indeterminate") =>
                                  setPreHookIds((ids) =>
                                    checked === true
                                      ? [...ids, hook.id]
                                      : ids.filter((id) => id !== hook.id)
                                  )
                                }
                              />
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                {hook.type === "webhook" ? (
                                  <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                ) : (
                                  <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="text-sm font-medium truncate">{hook.name}</span>
                                {!hook.enabled && (
                                  <Badge variant="outline" className="text-xs shrink-0">Disabled</Badge>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium mb-2">Post-job</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Run after all files complete. Receives job status and transfer counts.
                        </p>
                        <div className="space-y-2">
                          {availableHooks.map((hook) => (
                            <label
                              key={hook.id}
                              className="flex items-center gap-2.5 rounded-md border p-2.5 cursor-pointer hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={postHookIds.includes(hook.id)}
                                onCheckedChange={(checked: boolean | "indeterminate") =>
                                  setPostHookIds((ids) =>
                                    checked === true
                                      ? [...ids, hook.id]
                                      : ids.filter((id) => id !== hook.id)
                                  )
                                }
                              />
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                {hook.type === "webhook" ? (
                                  <Webhook className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                ) : (
                                  <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="text-sm font-medium truncate">{hook.name}</span>
                                {!hook.enabled && (
                                  <Badge variant="outline" className="text-xs shrink-0">Disabled</Badge>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </form>
            </Form>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="job-form" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : isEditing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {browsing && (
        <FolderBrowser
          open
          connectionId={browsing.connectionId}
          connectionName={browsing.connectionName}
          initialPath={form.getValues(browsing.field) || "/"}
          onClose={() => setBrowsing(null)}
          onSelect={(path) => {
            form.setValue(browsing.field, path, { shouldValidate: true });
            setBrowsing(null);
          }}
        />
      )}
    </>
  );
}
