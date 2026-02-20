import cron from "node-cron";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runJob } from "@/lib/transfer/engine";

const scheduledTasks = new Map<number, cron.ScheduledTask>();

export async function initializeScheduler(): Promise<void> {
  console.log("[Scheduler] Initializing...");

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

  for (const job of activeJobs) {
    scheduleJob(job.id, job.schedule);
  }

  console.log(`[Scheduler] Scheduled ${activeJobs.length} active job(s)`);
}

export function scheduleJob(jobId: number, cronExpression: string): void {
  unscheduleJob(jobId);

  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron expression for job ${jobId}: "${cronExpression}"`);
    return;
  }

  const task = cron.schedule(cronExpression, async () => {
    // Re-check status from DB before running — the in-memory map can drift
    // out of sync in Next.js where API routes may use separate module instances.
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!job || job.status !== "active") {
      console.log(`[Scheduler] Skipping job ${jobId} — status is "${job?.status ?? "deleted"}"`);
      return;
    }
    console.log(`[Scheduler] Triggering job ${jobId}`);
    try {
      await runJob(jobId);
    } catch (error) {
      console.error(`[Scheduler] Job ${jobId} failed:`, error);
    }
  });

  scheduledTasks.set(jobId, task);
  console.log(`[Scheduler] Job ${jobId} scheduled: "${cronExpression}"`);
}

export function unscheduleJob(jobId: number): void {
  const task = scheduledTasks.get(jobId);
  if (task) {
    task.stop();
    scheduledTasks.delete(jobId);
    console.log(`[Scheduler] Job ${jobId} unscheduled`);
  }
}

export function getScheduledJobIds(): number[] {
  return Array.from(scheduledTasks.keys());
}
