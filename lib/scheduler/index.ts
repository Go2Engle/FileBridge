import { schedule, validate } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { db } from "@/lib/db";
import { jobs, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runJob } from "@/lib/transfer/engine";
import { logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("scheduler");
const scheduledTasks = new Map<number, ScheduledTask>();

export async function getSchedulerTimezone(): Promise<string> {
  try {
    const row = await db.query.settings.findFirst({ where: eq(settings.key, "timezone") });
    const val = row?.value as { timezone?: string } | undefined;
    return val?.timezone ?? "UTC";
  } catch {
    return "UTC";
  }
}

export async function initializeScheduler(): Promise<void> {
  log.info("Initializing");

  // Reset any jobs that were stuck in 'running' state from a previous crash
  await db
    .update(jobs)
    .set({ status: "error" })
    .where(eq(jobs.status, "running"));

  // Load all active jobs and schedule them
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "active"));

  const timezone = await getSchedulerTimezone();

  for (const job of activeJobs) {
    scheduleJobWithTimezone(job.id, job.schedule, timezone);
  }

  log.info("Initialization complete", { scheduledJobs: activeJobs.length, timezone });
}

function scheduleJobWithTimezone(jobId: number, cronExpression: string, timezone: string): void {
  unscheduleJob(jobId);

  if (!validate(cronExpression)) {
    log.error("Invalid cron expression", { jobId, cronExpression });
    return;
  }

  const task = schedule(
    cronExpression,
    async () => {
      // Re-check status from DB before running — the in-memory map can drift
      // out of sync in Next.js where API routes may use separate module instances.
      const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!job || job.status !== "active") {
        log.info("Skipping job — not active", { jobId, status: job?.status ?? "deleted" });
        return;
      }
      log.info("Triggering scheduled job", { jobId });
      logAudit({
        userId: "scheduler",
        action: "execute",
        resource: "job",
        resourceId: jobId,
        resourceName: job.name,
        details: { trigger: "scheduled", schedule: job.schedule },
      });
      try {
        await runJob(jobId);
      } catch (error) {
        log.error("Scheduled job failed", { jobId, error });
      }
    },
    { timezone }
  );

  scheduledTasks.set(jobId, task);
  log.info("Job scheduled", { jobId, cronExpression, timezone });
}

export async function scheduleJob(jobId: number, cronExpression: string): Promise<void> {
  const timezone = await getSchedulerTimezone();
  scheduleJobWithTimezone(jobId, cronExpression, timezone);
}

export function unscheduleJob(jobId: number): void {
  const task = scheduledTasks.get(jobId);
  if (task) {
    task.stop();
    scheduledTasks.delete(jobId);
    log.info("Job unscheduled", { jobId });
  }
}

export function getScheduledJobIds(): number[] {
  return Array.from(scheduledTasks.keys());
}

export async function rescheduleAllJobs(): Promise<void> {
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "active"));

  const timezone = await getSchedulerTimezone();

  for (const job of activeJobs) {
    scheduleJobWithTimezone(job.id, job.schedule, timezone);
  }

  log.info("All jobs rescheduled", { count: activeJobs.length, timezone });
}
