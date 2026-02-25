"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRole } from "@/hooks/use-role";

const TIMEZONES: { group: string; zones: { value: string; label: string }[] }[] = [
  {
    group: "UTC",
    zones: [{ value: "UTC", label: "UTC — Coordinated Universal Time" }],
  },
  {
    group: "United States",
    zones: [
      { value: "America/New_York", label: "Eastern Time (New York)" },
      { value: "America/Chicago", label: "Central Time (Chicago)" },
      { value: "America/Denver", label: "Mountain Time (Denver)" },
      { value: "America/Phoenix", label: "Mountain Time — no DST (Phoenix)" },
      { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
      { value: "America/Anchorage", label: "Alaska Time (Anchorage)" },
      { value: "America/Honolulu", label: "Hawaii Time (Honolulu)" },
    ],
  },
  {
    group: "Canada",
    zones: [
      { value: "America/Toronto", label: "Eastern Time (Toronto)" },
      { value: "America/Vancouver", label: "Pacific Time (Vancouver)" },
    ],
  },
  {
    group: "Latin America",
    zones: [
      { value: "America/Mexico_City", label: "Central Time (Mexico City)" },
      { value: "America/Bogota", label: "Colombia Time (Bogotá)" },
      { value: "America/Lima", label: "Peru Time (Lima)" },
      { value: "America/Santiago", label: "Chile Time (Santiago)" },
      { value: "America/Sao_Paulo", label: "Brasília Time (São Paulo)" },
      { value: "America/Buenos_Aires", label: "Argentina Time (Buenos Aires)" },
    ],
  },
  {
    group: "Europe",
    zones: [
      { value: "Europe/London", label: "GMT/BST (London)" },
      { value: "Europe/Lisbon", label: "Western European Time (Lisbon)" },
      { value: "Europe/Paris", label: "Central European Time (Paris)" },
      { value: "Europe/Berlin", label: "Central European Time (Berlin)" },
      { value: "Europe/Madrid", label: "Central European Time (Madrid)" },
      { value: "Europe/Rome", label: "Central European Time (Rome)" },
      { value: "Europe/Amsterdam", label: "Central European Time (Amsterdam)" },
      { value: "Europe/Stockholm", label: "Central European Time (Stockholm)" },
      { value: "Europe/Helsinki", label: "Eastern European Time (Helsinki)" },
      { value: "Europe/Athens", label: "Eastern European Time (Athens)" },
      { value: "Europe/Istanbul", label: "Turkey Time (Istanbul)" },
      { value: "Europe/Moscow", label: "Moscow Time (Moscow)" },
    ],
  },
  {
    group: "Africa",
    zones: [
      { value: "Africa/Cairo", label: "Eastern European Time (Cairo)" },
      { value: "Africa/Johannesburg", label: "South Africa Time (Johannesburg)" },
      { value: "Africa/Lagos", label: "West Africa Time (Lagos)" },
      { value: "Africa/Nairobi", label: "East Africa Time (Nairobi)" },
    ],
  },
  {
    group: "Middle East",
    zones: [
      { value: "Asia/Dubai", label: "Gulf Standard Time (Dubai)" },
      { value: "Asia/Riyadh", label: "Arabia Standard Time (Riyadh)" },
      { value: "Asia/Tehran", label: "Iran Time (Tehran)" },
    ],
  },
  {
    group: "Asia",
    zones: [
      { value: "Asia/Karachi", label: "Pakistan Time (Karachi)" },
      { value: "Asia/Kolkata", label: "India Standard Time (Kolkata)" },
      { value: "Asia/Dhaka", label: "Bangladesh Time (Dhaka)" },
      { value: "Asia/Bangkok", label: "Indochina Time (Bangkok)" },
      { value: "Asia/Singapore", label: "Singapore Time (Singapore)" },
      { value: "Asia/Shanghai", label: "China Standard Time (Shanghai)" },
      { value: "Asia/Hong_Kong", label: "Hong Kong Time (Hong Kong)" },
      { value: "Asia/Taipei", label: "China Standard Time (Taipei)" },
      { value: "Asia/Tokyo", label: "Japan Standard Time (Tokyo)" },
      { value: "Asia/Seoul", label: "Korea Standard Time (Seoul)" },
    ],
  },
  {
    group: "Australia & Pacific",
    zones: [
      { value: "Australia/Perth", label: "Australian Western Time (Perth)" },
      { value: "Australia/Darwin", label: "Australian Central Time (Darwin)" },
      { value: "Australia/Brisbane", label: "Australian Eastern Time (Brisbane)" },
      { value: "Australia/Adelaide", label: "Australian Central Time (Adelaide)" },
      { value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)" },
      { value: "Australia/Melbourne", label: "Australian Eastern Time (Melbourne)" },
      { value: "Pacific/Auckland", label: "New Zealand Time (Auckland)" },
      { value: "Pacific/Fiji", label: "Fiji Time (Fiji)" },
    ],
  },
];

const schema = z.object({
  timezone: z.string().min(1, "Please select a timezone"),
});

type FormValues = z.infer<typeof schema>;

export function TimezoneSettings() {
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();

  const { data } = useQuery<{ timezone: string }>({
    queryKey: ["settings", "timezone"],
    queryFn: () => axios.get("/api/settings/timezone").then((r) => r.data),
    staleTime: 30_000,
  });

  // Extract the primitive so the effect only fires when the value actually changes,
  // not every time TanStack Query returns a new object reference on a background refetch.
  const savedTimezone = data?.timezone;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    // Initialise from cache immediately on re-visits so the Select has the
    // correct value on the very first render with no flash or reset needed.
    defaultValues: { timezone: savedTimezone ?? "UTC" },
  });

  useEffect(() => {
    if (savedTimezone) {
      form.reset({ timezone: savedTimezone });
    }
  }, [savedTimezone, form]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => axios.post("/api/settings/timezone", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "timezone"] });
      toast.success("Timezone saved — all active jobs rescheduled");
    },
    onError: () => toast.error("Failed to save timezone"),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scheduler Timezone</CardTitle>
            <CardDescription>
              All job schedules are interpreted in this timezone. Changing it will
              immediately reschedule all active jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!isAdmin}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a timezone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-80">
                      {TIMEZONES.map((group) => (
                        <SelectGroup key={group.group}>
                          <SelectLabel>{group.group}</SelectLabel>
                          {group.zones.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Cron expressions for all jobs are evaluated in this timezone
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || !isAdmin}>
            {mutation.isPending ? "Saving..." : "Save Timezone"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
