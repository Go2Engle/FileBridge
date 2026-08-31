import { getTasks, schedule, validate } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { db } from "@/lib/db";
import { jobRuns, jobs, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runJob } from "@/lib/transfer/engine";
import { logAudit } from "@/lib/audit";
import { createLogger } from "@/lib/logger";

const log = createLogger("scheduler");
const TASK_NAME_PREFIX = "filebridge-job-";

// Next.js can evaluate this module in more than one server bundle. Keep the
// task map on globalThis so the instrumentation and API-route copies share the
// same scheduler state within the FileBridge process.
const schedulerGlobal = globalThis as typeof globalThis & {
  __fileBridgeSchedulerState?: {
    scheduledTasks: Map<number, ScheduledTask>;
  };
};
const schedulerState = (schedulerGlobal.__fileBridgeSchedulerState ??= {
  scheduledTasks: new Map<number, ScheduledTask>(),
});
const scheduledTasks = schedulerState.scheduledTasks;

function taskName(jobId: number): string {
  return `${TASK_NAME_PREFIX}${jobId}`;
}

function destroyTask(task: ScheduledTask): void {
  const result = task.destroy();
  if (result instanceof Promise) {
    void result.catch((error) => log.error("Failed to destroy scheduled task", { error }));
  }
}

function destroyJobTasks(jobId: number): void {
  const tasks = new Set<ScheduledTask>();
  const trackedTask = scheduledTasks.get(jobId);
  if (trackedTask) tasks.add(trackedTask);

  // node-cron keeps its own registry. The stable task name lets us clean up
  // duplicates left by a separately evaluated scheduler module.
  for (const task of getTasks().values()) {
    if (task.name === taskName(jobId)) tasks.add(task);
  }

  for (const task of tasks) destroyTask(task);
  scheduledTasks.delete(jobId);
}

function destroyAllJobTasks(): void {
  const tasks = new Set<ScheduledTask>(scheduledTasks.values());
  for (const task of getTasks().values()) {
    if (task.name?.startsWith(TASK_NAME_PREFIX)) tasks.add(task);
  }

  for (const task of tasks) destroyTask(task);
  scheduledTasks.clear();
}

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

  // Reset any jobs/runs that were stuck in 'running' state from a previous crash.
  // The job status alone is not enough: run history rows drive the UI's run
  // state and otherwise remain "running" forever after a service restart.
  const startupRecoveryMessage =
    "FileBridge restarted while this run was still running; marking it failed during scheduler startup.";
  await db
    .update(jobRuns)
    .set({
      status: "failure",
      completedAt: new Date().toISOString(),
      errorMessage: startupRecoveryMessage,
    })
    .where(eq(jobRuns.status, "running"));

  await db
    .update(jobs)
    .set({ status: "active", updatedAt: new Date().toISOString() })
    .where(eq(jobs.status, "running"));

  // Load all active jobs and schedule them
  const activeJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "active"));

  const timezone = await getSchedulerTimezone();

  // Reconcile the complete in-memory state, including tasks for jobs that are
  // now inactive/deleted and duplicate tasks created by another module copy.
  destroyAllJobTasks();
  for (const job of activeJobs) {
    scheduleJobWithTimezone(job.id, job.schedule, timezone);
  }

  log.info("Initialization complete", { scheduledJobs: activeJobs.length, timezone });
}

function scheduleJobWithTimezone(jobId: number, cronExpression: string, timezone: string): void {
  destroyJobTasks(jobId);

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

      // A stale task can survive a schedule edit if it was registered by a
      // different Next.js module instance. Never let that old cron callback
      // execute after the persisted schedule has changed.
      if (job.schedule !== cronExpression) {
        log.info("Skipping stale scheduled task", {
          jobId,
          taskSchedule: cronExpression,
          currentSchedule: job.schedule,
        });
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
    { timezone, name: taskName(jobId), noOverlap: true }
  );

  scheduledTasks.set(jobId, task);
  log.info("Job scheduled", { jobId, cronExpression, timezone });
}

export async function scheduleJob(jobId: number, cronExpression: string): Promise<void> {
  const timezone = await getSchedulerTimezone();
  scheduleJobWithTimezone(jobId, cronExpression, timezone);
}

export function unscheduleJob(jobId: number): void {
  const hadTask =
    scheduledTasks.has(jobId) ||
    Array.from(getTasks().values()).some((task) => task.name === taskName(jobId));
  destroyJobTasks(jobId);
  if (hadTask) {
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

  destroyAllJobTasks();
  for (const job of activeJobs) {
    scheduleJobWithTimezone(job.id, job.schedule, timezone);
  }

  log.info("All jobs rescheduled", { count: activeJobs.length, timezone });
}
