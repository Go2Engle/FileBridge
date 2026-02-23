"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { sub, format } from "date-fns";
import { Trash2 } from "lucide-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRole } from "@/hooks/use-role";

const purgeSchema = z.object({
  retentionValue: z.coerce.number().min(1, "Must be at least 1"),
  retentionUnit: z.enum(["days", "weeks", "months", "years"]),
});

type PurgeFormValues = z.infer<typeof purgeSchema>;

export function PurgeLogsSettings() {
  const { isAdmin } = useRole();
  const [showConfirm, setShowConfirm] = useState(false);
  const [cutoffDate, setCutoffDate] = useState("");
  const queryClient = useQueryClient();

  const form = useForm<PurgeFormValues>({
    resolver: zodResolver(purgeSchema),
    defaultValues: {
      retentionValue: 30,
      retentionUnit: "days",
    },
  });

  const { data: preview, isLoading: previewLoading } = useQuery<{
    logsCount: number;
    runsCount: number;
  }>({
    queryKey: ["purge-preview", cutoffDate],
    queryFn: () =>
      axios
        .get("/api/logs/purge", { params: { cutoffDate } })
        .then((r) => r.data),
    enabled: showConfirm && !!cutoffDate,
  });

  const purgeMutation = useMutation({
    mutationFn: () => axios.post("/api/logs/purge", { cutoffDate }),
    onSuccess: (res) => {
      const { deletedLogs, deletedRuns } = res.data;
      toast.success(
        `Purged ${deletedLogs} transfer log(s) and ${deletedRuns} job run(s)`
      );
      queryClient.invalidateQueries({ queryKey: ["logs"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setShowConfirm(false);
    },
    onError: () => toast.error("Failed to purge logs"),
  });

  function computeCutoffDate(values: PurgeFormValues): string {
    return sub(new Date(), {
      [values.retentionUnit]: values.retentionValue,
    }).toISOString();
  }

  function handlePurgeClick(values: PurgeFormValues) {
    const computed = computeCutoffDate(values);
    setCutoffDate(computed);
    setShowConfirm(true);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Purge Logs</CardTitle>
          <CardDescription>
            Remove old transfer logs and job run records to free up database
            space
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handlePurgeClick)}
              className="space-y-4"
            >
              <FormLabel>Delete records older than</FormLabel>
              <div className="flex items-start gap-3">
                <FormField
                  control={form.control}
                  name="retentionValue"
                  render={({ field }) => (
                    <FormItem className="w-24">
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="retentionUnit"
                  render={({ field }) => (
                    <FormItem className="w-32">
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="days">days</SelectItem>
                          <SelectItem value="weeks">weeks</SelectItem>
                          <SelectItem value="months">months</SelectItem>
                          <SelectItem value="years">years</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <Button type="submit" variant="destructive" disabled={!isAdmin}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Purge Now
                </Button>
              </div>
              <FormDescription>
                This will permanently delete transfer logs and job run records
                older than the specified period.
              </FormDescription>
            </form>
          </Form>
        </CardContent>
      </Card>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Log Purge</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {previewLoading ? (
                  <p>Calculating records to delete...</p>
                ) : preview ? (
                  <>
                    <p className="mb-2">
                      This action will permanently delete:
                    </p>
                    <ul className="list-disc pl-5 mb-2 space-y-1">
                      <li>
                        <strong>{preview.logsCount}</strong> transfer log
                        record(s)
                      </li>
                      <li>
                        <strong>{preview.runsCount}</strong> job run record(s)
                      </li>
                    </ul>
                    <p>
                      Records created before{" "}
                      <strong>
                        {format(new Date(cutoffDate), "MMM d, yyyy HH:mm")}
                      </strong>{" "}
                      will be removed. This action cannot be undone.
                    </p>
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => purgeMutation.mutate()}
              disabled={previewLoading || purgeMutation.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {purgeMutation.isPending ? "Purging..." : "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
