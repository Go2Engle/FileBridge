"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Activity, CircleAlert, Send, Save } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRole } from "@/hooks/use-role";

// Mirrors DATADOG_SITES in lib/datadog/shipper.ts (server-only module).
const SITES = [
  { value: "datadoghq.com", label: "US1 (datadoghq.com)" },
  { value: "us3.datadoghq.com", label: "US3 (us3.datadoghq.com)" },
  { value: "us5.datadoghq.com", label: "US5 (us5.datadoghq.com)" },
  { value: "datadoghq.eu", label: "EU1 (datadoghq.eu)" },
  { value: "ap1.datadoghq.com", label: "AP1 (ap1.datadoghq.com)" },
  { value: "ap2.datadoghq.com", label: "AP2 (ap2.datadoghq.com)" },
  { value: "ddog-gov.com", label: "US1-FED (ddog-gov.com)" },
];

const LEVELS = [
  { value: "debug", label: "Debug and above" },
  { value: "info", label: "Info and above" },
  { value: "warn", label: "Warnings and errors" },
  { value: "error", label: "Errors only" },
];

const schema = z.object({
  enabled: z.boolean(),
  site: z.string().min(1),
  apiKey: z.string().trim(),
  service: z.string().trim().min(1, "Service is required"),
  env: z.string().trim(),
  hostname: z.string().trim(),
  tags: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || v.split(",").every((t) => /^[^\s,:]+:[^\s,]+$/.test(t.trim())),
      "Use comma-separated key:value pairs, e.g. team:platform,region:east",
    ),
  minLevel: z.enum(["debug", "info", "warn", "error"]),
  sendAppLogs: z.boolean(),
  sendJobLogs: z.boolean(),
  sendAuditLogs: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface PublicConfig extends Omit<FormValues, "apiKey"> {
  hasApiKey: boolean;
  apiKeyHint: string | null;
}

interface Stats {
  enabled: boolean;
  queued: number;
  sent: number;
  dropped: number;
  failedBatches: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

interface DatadogResponse {
  config: PublicConfig;
  stats: Stats;
}

function errorMessage(err: unknown, fallback: string): string {
  return (axios.isAxiosError(err) && err.response?.data?.error) || fallback;
}

function ago(iso: string | null): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "never";
}

export default function DatadogPage() {
  const { isAdmin } = useRole();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<DatadogResponse>({
    queryKey: ["admin-datadog"],
    queryFn: () => axios.get("/api/admin/datadog").then((r) => r.data),
    refetchInterval: 10_000,
    enabled: isAdmin,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: {
      enabled: false,
      site: "datadoghq.com",
      apiKey: "",
      service: "filebridge",
      env: "",
      hostname: "",
      tags: "",
      minLevel: "info",
      sendAppLogs: true,
      sendJobLogs: true,
      sendAuditLogs: true,
    },
  });

  // Populate once loaded; don't clobber in-progress edits on background refetches.
  const config = data?.config;
  useEffect(() => {
    if (config && !form.formState.isDirty) {
      form.reset({
        enabled: config.enabled,
        site: config.site,
        apiKey: "",
        service: config.service,
        env: config.env,
        hostname: config.hostname,
        tags: config.tags,
        minLevel: config.minLevel,
        sendAppLogs: config.sendAppLogs,
        sendJobLogs: config.sendJobLogs,
        sendAuditLogs: config.sendAuditLogs,
      });
    }
  }, [config, form]);

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      axios.put<DatadogResponse>("/api/admin/datadog", values).then((r) => r.data),
    onSuccess: (res) => {
      queryClient.setQueryData(["admin-datadog"], res);
      form.reset({ ...form.getValues(), apiKey: "" });
      toast.success(res.config.enabled ? "Datadog log forwarding enabled" : "Datadog settings saved");
    },
    onError: (err) => toast.error(errorMessage(err, "Failed to save settings")),
  });

  const testMutation = useMutation({
    mutationFn: (values: FormValues) =>
      axios.post("/api/admin/datadog/test", values).then((r) => r.data),
    onSuccess: (res) => toast.success(res.message ?? "Test log sent"),
    onError: (err) => toast.error(errorMessage(err, "Test failed")),
  });

  if (!isAdmin) {
    router.replace("/dashboard");
    return null;
  }

  const stats = data?.stats;
  const enabled = form.watch("enabled");

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="h-6 w-6" />
          Datadog
        </h1>
        <p className="text-muted-foreground">
          Forward application logs, job logs and the audit trail to Datadog Logs.
        </p>
      </div>

      {/* Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-lg">Forwarding status</CardTitle>
            <CardDescription>Refreshes every 10 seconds</CardDescription>
          </div>
          {stats?.enabled ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">Active</Badge>
          ) : (
            <Badge variant="secondary">Off</Badge>
          )}
        </CardHeader>
        <CardContent>
          {isLoading || !stats ? (
            <div className="h-16 rounded-md bg-muted animate-pulse" />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Sent</div>
                  <div className="text-xl font-semibold tabular-nums">{stats.sent.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Queued</div>
                  <div className="text-xl font-semibold tabular-nums">{stats.queued.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Dropped</div>
                  <div className="text-xl font-semibold tabular-nums">{stats.dropped.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last delivery</div>
                  <div className="font-medium">{ago(stats.lastSuccessAt)}</div>
                </div>
              </div>
              {stats.lastError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <CircleAlert className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  <div>
                    <div className="font-medium">Last error {ago(stats.lastErrorAt)}</div>
                    <div className="text-muted-foreground break-all">{stats.lastError}</div>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Counters reset when the FileBridge service restarts.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Settings</CardTitle>
          <CardDescription>
            Logs are sent directly to the Datadog HTTP intake — no Agent required. All of these
            events are also written to FileBridge&apos;s server log, so if a Datadog Agent already
            collects its stdout/journald you already have them; enabling this would send duplicates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-5">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Forward logs to Datadog</FormLabel>
                      <FormDescription>Turn log forwarding on or off without losing settings</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="site"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Datadog site</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SITES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Matches the domain you log in to Datadog with</FormDescription>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API key</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="off"
                          className="font-mono"
                          placeholder={
                            config?.hasApiKey
                              ? `Saved (${config.apiKeyHint ?? "••••"}) — leave blank to keep`
                              : "Datadog API key"
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Organization Settings → API Keys. Stored encrypted.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="service"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Service</FormLabel>
                      <FormControl>
                        <Input placeholder="filebridge" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="env"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Environment</FormLabel>
                      <FormControl>
                        <Input placeholder="prod" {...field} />
                      </FormControl>
                      <FormDescription>Sent as the env tag</FormDescription>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="hostname"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hostname</FormLabel>
                      <FormControl>
                        <Input placeholder="Defaults to the server hostname" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minLevel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum level</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Debug also needs LOG_LEVEL=debug on the server</FormDescription>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extra tags</FormLabel>
                    <FormControl>
                      <Input placeholder="team:platform,datacenter:newholland" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <div className="text-sm font-medium">What to send</div>
                {(
                  [
                    ["sendAppLogs", "Application logs", "Everything FileBridge writes to its server log (engine, connections, API, scheduler)"],
                    ["sendJobLogs", "Job logs", "Run started/finished events (job name, trigger, duration, files, bytes, outcome), per-file results and hook runs"],
                    ["sendAuditLogs", "Audit trail", "Who changed or ran what, mirrored from the Audit Log page"],
                  ] as const
                ).map(([name, label, description]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                          <FormLabel>{label}</FormLabel>
                          <FormDescription>{description}</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={form.handleSubmit((v) => testMutation.mutate(v))}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {testMutation.isPending ? "Sending…" : "Send test log"}
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  <Save className="mr-2 h-4 w-4" />
                  {saveMutation.isPending ? "Saving…" : enabled ? "Save & enable" : "Save"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
