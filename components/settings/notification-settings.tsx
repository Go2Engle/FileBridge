"use client";

import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/hooks/use-role";

const settingsSchema = z.object({
  emailEnabled: z.boolean().default(false),
  emailSmtpHost: z.string().optional(),
  emailSmtpPort: z.coerce.number().optional(),
  emailSmtpUser: z.string().optional(),
  emailSmtpPassword: z.string().optional(),
  emailRecipients: z.string().optional(),
  teamsWebhookEnabled: z.boolean().default(false),
  teamsWebhookUrl: z.string().url().optional().or(z.literal("")),
  alertOnFailure: z.boolean().default(true),
  alertOnConsecutiveErrors: z.coerce.number().min(1).default(3),
});

type FormValues = z.infer<typeof settingsSchema>;

interface SettingsData {
  emailEnabled: boolean;
  emailSmtpHost?: string;
  emailSmtpPort?: number;
  emailSmtpUser?: string;
  emailSmtpPassword?: string;
  emailRecipients?: string;
  teamsWebhookEnabled: boolean;
  teamsWebhookUrl?: string;
  alertOnFailure: boolean;
  alertOnConsecutiveErrors: number;
}

export function NotificationSettings() {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();

  const { data } = useQuery<SettingsData>({
    queryKey: ["settings"],
    queryFn: () => axios.get("/api/settings").then((r) => r.data),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(settingsSchema) as Resolver<FormValues>,
    defaultValues: {
      emailEnabled: false,
      emailSmtpHost: "",
      emailSmtpPort: 587,
      emailSmtpUser: "",
      emailSmtpPassword: "",
      emailRecipients: "",
      teamsWebhookEnabled: false,
      teamsWebhookUrl: "",
      alertOnFailure: true,
      alertOnConsecutiveErrors: 3,
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        emailEnabled: data.emailEnabled,
        emailSmtpHost: data.emailSmtpHost ?? "",
        emailSmtpPort: data.emailSmtpPort ?? 587,
        emailSmtpUser: data.emailSmtpUser ?? "",
        emailSmtpPassword: data.emailSmtpPassword ?? "",
        emailRecipients: data.emailRecipients ?? "",
        teamsWebhookEnabled: data.teamsWebhookEnabled,
        teamsWebhookUrl: data.teamsWebhookUrl ?? "",
        alertOnFailure: data.alertOnFailure,
        alertOnConsecutiveErrors: data.alertOnConsecutiveErrors,
      });
    }
  }, [data, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => axios.post("/api/settings", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const emailEnabled = form.watch("emailEnabled");
  const teamsEnabled = form.watch("teamsWebhookEnabled");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        className="space-y-6"
      >
        {/* Alert triggers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert Triggers</CardTitle>
            <CardDescription>Configure when notifications are sent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="alertOnFailure"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Alert on job failure</FormLabel>
                    <FormDescription>Send notification when any job fails</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="alertOnConsecutiveErrors"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alert after consecutive errors</FormLabel>
                  <FormControl>
                    <Input type="number" className="w-24" {...field} />
                  </FormControl>
                  <FormDescription>
                    Send alert after this many consecutive failures on a single job
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email (SMTP)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="emailEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel>Enable email notifications</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            {emailEnabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="emailSmtpHost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SMTP Host</FormLabel>
                        <FormControl>
                          <Input placeholder="smtp.example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="emailSmtpPort"
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
                  name="emailSmtpUser"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Username</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailSmtpPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SMTP Password</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailRecipients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipients</FormLabel>
                      <FormControl>
                        <Input placeholder="admin@example.com, ops@example.com" {...field} />
                      </FormControl>
                      <FormDescription>Comma-separated email addresses</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Teams */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Microsoft Teams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="teamsWebhookEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <FormLabel>Enable Teams webhook</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            {teamsEnabled && (
              <FormField
                control={form.control}
                name="teamsWebhookUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook URL</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="https://outlook.office.com/webhook/..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !isAdmin}>
            {mutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
