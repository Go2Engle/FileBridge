"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { format } from "date-fns";
import { Database, HardDrive, Play, RefreshCw } from "lucide-react";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const PRESET_SCHEDULES = [
  { label: "Daily at 2 AM", value: "0 2 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Custom", value: "custom" },
];

const backupSchema = z.object({
  enabled: z.boolean().default(false),
  schedulePreset: z.string(),
  schedule: z.string().min(1, "Schedule is required"),
  localPath: z.string().min(1, "Backup path is required"),
  retentionCount: z.coerce.number().min(1).max(365),
});

type FormValues = z.infer<typeof backupSchema>;

interface BackupConfig {
  enabled: boolean;
  schedule: string;
  localPath: string;
  retentionCount: number;
}

interface BackupEntry {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function scheduleToPreset(schedule: string): string {
  const match = PRESET_SCHEDULES.find(
    (p) => p.value !== "custom" && p.value === schedule
  );
  return match ? match.value : "custom";
}

export function BackupSettings() {
  const queryClient = useQueryClient();
  const [showCustom, setShowCustom] = useState(false);

  const { data: config } = useQuery<BackupConfig>({
    queryKey: ["settings-backup"],
    queryFn: () => axios.get("/api/settings/backup").then((r) => r.data),
  });

  const { data: backups, refetch: refetchBackups } = useQuery<BackupEntry[]>({
    queryKey: ["backup-list"],
    queryFn: () => axios.get("/api/backup/list").then((r) => r.data),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(backupSchema),
    defaultValues: {
      enabled: false,
      schedulePreset: "0 2 * * *",
      schedule: "0 2 * * *",
      localPath: "data/backups",
      retentionCount: 7,
    },
  });

  useEffect(() => {
    if (config) {
      const preset = scheduleToPreset(config.schedule);
      setShowCustom(preset === "custom");
      form.reset({
        enabled: config.enabled,
        schedulePreset: preset,
        schedule: config.schedule,
        localPath: config.localPath,
        retentionCount: config.retentionCount,
      });
    }
  }, [config, form]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      axios.post("/api/settings/backup", {
        enabled: values.enabled,
        schedule: values.schedule,
        localPath: values.localPath,
        retentionCount: values.retentionCount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-backup"] });
      toast.success("Backup settings saved");
    },
    onError: (err) => {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error
        : "Failed to save settings";
      toast.error(msg ?? "Failed to save settings");
    },
  });

  const runMutation = useMutation({
    mutationFn: () => axios.post("/api/backup/run"),
    onSuccess: (res) => {
      const { filename, sizeBytes } = res.data;
      toast.success(`Backup created: ${filename} (${formatBytes(sizeBytes)})`);
      queryClient.invalidateQueries({ queryKey: ["backup-list"] });
    },
    onError: (err) => {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error
        : "Backup failed";
      toast.error(msg ?? "Backup failed");
    },
  });

  const enabled = form.watch("enabled");

  function handlePresetChange(value: string) {
    if (value === "custom") {
      setShowCustom(true);
    } else {
      setShowCustom(false);
      form.setValue("schedule", value, { shouldValidate: true });
    }
    form.setValue("schedulePreset", value);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Database Backups
        </CardTitle>
        <CardDescription>
          Automatically snapshot the SQLite database on a schedule. Backups are
          verified for integrity and old copies are pruned automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}
            className="space-y-4"
          >
            {/* Enable toggle */}
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Enable scheduled backups</FormLabel>
                    <FormDescription>
                      Automatically back up the database on the configured
                      schedule
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

            {enabled && (
              <>
                {/* Schedule */}
                <FormField
                  control={form.control}
                  name="schedulePreset"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Backup schedule</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={handlePresetChange}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRESET_SCHEDULES.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                {showCustom && (
                  <FormField
                    control={form.control}
                    name="schedule"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Custom cron expression</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="0 2 * * *"
                            className="font-mono"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Standard 5-field cron format (minute hour day month
                          weekday)
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* Local path */}
                <FormField
                  control={form.control}
                  name="localPath"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4" />
                        Backup directory
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="data/backups"
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Absolute or relative path where backup files are stored.
                        The directory will be created if it does not exist.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Retention */}
                <FormField
                  control={form.control}
                  name="retentionCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Keep last N backups</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          className="w-24"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Older backups beyond this count are automatically
                        deleted
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={runMutation.isPending}
                onClick={() => runMutation.mutate()}
              >
                <Play className="mr-2 h-4 w-4" />
                {runMutation.isPending ? "Running..." : "Backup Now"}
              </Button>
            </div>
          </form>
        </Form>

        {/* Recent backups list */}
        {backups && backups.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Recent Backups</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchBackups()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="rounded-md border divide-y text-sm">
              {backups.slice(0, 10).map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-mono truncate text-xs text-muted-foreground">
                      {b.filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <Badge variant="secondary">{formatBytes(b.sizeBytes)}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(b.createdAt), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
