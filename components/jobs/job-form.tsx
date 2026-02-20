"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { FolderSearch } from "lucide-react";
import { FolderBrowser } from "@/components/ui/folder-browser";
import type { Connection, Job } from "@/lib/db/schema";

const jobSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceConnectionId: z.coerce.number().min(1, "Source connection required"),
  sourcePath: z.string().min(1, "Source path is required"),
  destinationConnectionId: z.coerce.number().min(1, "Destination connection required"),
  destinationPath: z.string().min(1, "Destination path is required"),
  fileFilter: z.string().default("*"),
  schedule: z.string().min(1, "Schedule is required"),
  postTransferAction: z.enum(["retain", "delete", "move"]).default("retain"),
  movePath: z.string().optional(),
  overwriteExisting: z.boolean().default(false),
  skipHiddenFiles: z.boolean().default(true),
  extractArchives: z.boolean().default(false),
});

type FormValues = z.infer<typeof jobSchema>;

interface JobFormProps {
  job?: Job | null;
}

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

export function JobForm({ job }: JobFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!job;
  const [browsing, setBrowsing] = useState<BrowseTarget | null>(null);

  const { data: connections } = useQuery<Connection[]>({
    queryKey: ["connections"],
    queryFn: () => axios.get("/api/connections").then((r) => r.data),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      name: job?.name ?? "",
      sourceConnectionId: job?.sourceConnectionId ?? 0,
      sourcePath: job?.sourcePath ?? "",
      destinationConnectionId: job?.destinationConnectionId ?? 0,
      destinationPath: job?.destinationPath ?? "",
      fileFilter: job?.fileFilter ?? "*",
      schedule: job?.schedule ?? "0 * * * *",
      postTransferAction: (job?.postTransferAction as FormValues["postTransferAction"]) ?? "retain",
      movePath: job?.movePath ?? "",
      overwriteExisting: job?.overwriteExisting ?? false,
      skipHiddenFiles: job?.skipHiddenFiles ?? true,
      extractArchives: job?.extractArchives ?? false,
    },
  });

  const postAction = form.watch("postTransferAction");
  const sourceConnectionId = form.watch("sourceConnectionId");
  const destinationConnectionId = form.watch("destinationConnectionId");

  const getConnectionName = (id: number) =>
    connections?.find((c) => c.id === id)?.name ?? "Connection";

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      isEditing
        ? axios.put(`/api/jobs/${job!.id}`, values)
        : axios.post("/api/jobs", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(isEditing ? "Job updated" : "Job created");
      router.push("/jobs");
    },
    onError: () => toast.error("Failed to save job"),
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                        <SelectValue placeholder="Select source connection" />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                        <SelectValue placeholder="Select destination connection" />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transfer Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="fileFilter"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>File Filter</FormLabel>
                  <FormControl>
                    <Input placeholder="*.csv" {...field} />
                  </FormControl>
                  <FormDescription>
                    Wildcard pattern (e.g. *.csv, report_*.txt, *)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="schedule"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Schedule (Cron)</FormLabel>
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
                  <FormDescription>Standard 5-field cron expression</FormDescription>
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
                      <SelectItem value="retain">Retain (keep source file)</SelectItem>
                      <SelectItem value="delete">Delete (remove source file)</SelectItem>
                      <SelectItem value="move">Move (relocate source file)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            <Separator />

            <FormField
              control={form.control}
              name="overwriteExisting"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Overwrite existing files</FormLabel>
                    <FormDescription>
                      Replace files at the destination if they already exist.
                      When off, existing files are silently skipped.
                    </FormDescription>
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
              name="skipHiddenFiles"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Skip hidden files</FormLabel>
                    <FormDescription>
                      Ignore files starting with a dot (e.g. .DS_Store, .thumbs.db).
                    </FormDescription>
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
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : isEditing ? "Update Job" : "Create Job"}
          </Button>
        </div>
      </form>

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
    </Form>
  );
}
