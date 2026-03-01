import { db, sqlite } from "@/lib/db";
import { hooks, jobHooks } from "@/lib/db/schema";
import type { Hook, NewHook } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";

export function getAllHooks(): Hook[] {
  return db.select().from(hooks).orderBy(desc(hooks.createdAt)).all();
}

export function getHook(id: number): Hook | undefined {
  return db.select().from(hooks).where(eq(hooks.id, id)).get();
}

export function createHook(data: NewHook): Hook {
  const [row] = db.insert(hooks).values(data).returning().all();
  return row;
}

export function updateHook(id: number, data: Partial<NewHook>): Hook | undefined {
  const [row] = db
    .update(hooks)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(hooks.id, id))
    .returning()
    .all();
  return row;
}

export function deleteHook(id: number): void {
  db.delete(hooks).where(eq(hooks.id, id)).run();
}

/** Returns Hook[] for a job+trigger, ordered by sort_order. */
export function getJobHooksWithDetail(
  jobId: number,
  trigger: "pre_job" | "post_job"
): Hook[] {
  const rows = db
    .select({ hook: hooks })
    .from(jobHooks)
    .innerJoin(hooks, eq(jobHooks.hookId, hooks.id))
    .where(and(eq(jobHooks.jobId, jobId), eq(jobHooks.trigger, trigger)))
    .orderBy(asc(jobHooks.sortOrder))
    .all();
  return rows.map((r) => r.hook);
}

/** Returns all hook IDs attached to a job by trigger. */
export function getJobHookIds(
  jobId: number,
  trigger: "pre_job" | "post_job"
): number[] {
  const rows = db
    .select({ hookId: jobHooks.hookId })
    .from(jobHooks)
    .where(and(eq(jobHooks.jobId, jobId), eq(jobHooks.trigger, trigger)))
    .orderBy(asc(jobHooks.sortOrder))
    .all();
  return rows.map((r) => r.hookId);
}

/** Returns job IDs that reference a given hook. */
export function getJobsUsingHook(hookId: number): number[] {
  const rows = db
    .select({ jobId: jobHooks.jobId })
    .from(jobHooks)
    .where(eq(jobHooks.hookId, hookId))
    .all();
  return [...new Set(rows.map((r) => r.jobId))];
}

/**
 * Replaces all hook associations for a job+trigger in a single transaction.
 * hookIds order determines sort_order (0-based index).
 */
export function setJobHooks(
  jobId: number,
  trigger: "pre_job" | "post_job",
  hookIds: number[]
): void {
  sqlite.transaction(() => {
    // Remove existing associations for this trigger
    db
      .delete(jobHooks)
      .where(and(eq(jobHooks.jobId, jobId), eq(jobHooks.trigger, trigger)))
      .run();

    if (hookIds.length === 0) return;

    db
      .insert(jobHooks)
      .values(
        hookIds.map((hookId, idx) => ({
          jobId,
          hookId,
          trigger,
          sortOrder: idx,
        }))
      )
      .run();
  })();
}
