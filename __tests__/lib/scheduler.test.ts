import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type MockTask = {
    id: string;
    name?: string;
    destroy: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getNextRun: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  };

  return {
    cronTasks: new Map<string, MockTask>(),
    callbacks: new Map<string, () => Promise<void>>(),
    nextTaskId: 1,
    findJob: vi.fn(),
    findSetting: vi.fn(),
    selectJobs: vi.fn(),
    runJob: vi.fn(),
    logAudit: vi.fn(),
  };
});

vi.mock("node-cron", () => ({
  validate: vi.fn((expression: string) => expression !== "invalid"),
  getTasks: vi.fn(() => mocks.cronTasks),
  schedule: vi.fn(
    (
      _expression: string,
      callback: () => Promise<void>,
      options?: { name?: string }
    ) => {
      const id = `task-${mocks.nextTaskId++}`;
      const task = {
        id,
        name: options?.name,
        destroy: vi.fn(() => {
          mocks.cronTasks.delete(id);
          mocks.callbacks.delete(id);
        }),
        stop: vi.fn(),
        start: vi.fn(),
        getStatus: vi.fn(() => "idle"),
        getNextRun: vi.fn(() => null),
        execute: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
      };
      mocks.cronTasks.set(id, task);
      mocks.callbacks.set(id, callback);
      return task;
    }
  ),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: mocks.selectJobs })),
    })),
    query: {
      jobs: { findFirst: mocks.findJob },
      settings: { findFirst: mocks.findSetting },
    },
  },
}));

vi.mock("@/lib/transfer/engine", () => ({ runJob: mocks.runJob }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  getScheduledJobIds,
  rescheduleAllJobs,
  scheduleJob,
  unscheduleJob,
} from "@/lib/scheduler";

describe("job scheduler", () => {
  beforeEach(() => {
    for (const jobId of getScheduledJobIds()) unscheduleJob(jobId);
    mocks.cronTasks.clear();
    mocks.callbacks.clear();
    mocks.nextTaskId = 1;
    mocks.findSetting.mockReset();
    mocks.findSetting.mockResolvedValue({ value: { timezone: "UTC" } });
    mocks.findJob.mockReset();
    mocks.selectJobs.mockReset();
    mocks.runJob.mockReset();
    mocks.logAudit.mockReset();
  });

  it("destroys the previous task when a job schedule changes", async () => {
    await scheduleJob(7, "0 4 * * 0");
    const previousTask = Array.from(mocks.cronTasks.values())[0];

    await scheduleJob(7, "0 20 * * 0");

    expect(previousTask.destroy).toHaveBeenCalledOnce();
    expect(mocks.cronTasks).toHaveLength(1);
    expect(Array.from(mocks.cronTasks.values())[0].name).toBe("filebridge-job-7");
    expect(getScheduledJobIds()).toEqual([7]);
  });

  it("destroys an orphaned duplicate found in the node-cron registry", async () => {
    const orphanedTask = {
      id: "orphan",
      name: "filebridge-job-7",
      destroy: vi.fn(() => mocks.cronTasks.delete("orphan")),
      stop: vi.fn(),
      start: vi.fn(),
      getStatus: vi.fn(),
      getNextRun: vi.fn(),
      execute: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };
    mocks.cronTasks.set(orphanedTask.id, orphanedTask);

    await scheduleJob(7, "0 20 * * 0");

    expect(orphanedTask.destroy).toHaveBeenCalledOnce();
    expect(mocks.cronTasks).toHaveLength(1);
  });

  it("reconciles all existing tasks and removes jobs that are no longer active", async () => {
    await scheduleJob(7, "0 4 * * 0");
    await scheduleJob(8, "0 6 * * 0");
    const previousTasks = Array.from(mocks.cronTasks.values());
    mocks.selectJobs.mockResolvedValue([
      { id: 7, status: "active", schedule: "0 20 * * 0" },
    ]);

    await rescheduleAllJobs();

    expect(previousTasks[0].destroy).toHaveBeenCalledOnce();
    expect(previousTasks[1].destroy).toHaveBeenCalledOnce();
    expect(getScheduledJobIds()).toEqual([7]);
    expect(mocks.cronTasks).toHaveLength(1);
  });

  it("does not execute a stale callback after the persisted schedule changes", async () => {
    await scheduleJob(7, "0 4 * * 0");
    const callback = Array.from(mocks.callbacks.values())[0];
    mocks.findJob.mockResolvedValue({
      id: 7,
      name: "Outbound",
      status: "active",
      schedule: "0 20 * * 0",
    });

    await callback();

    expect(mocks.runJob).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("executes the callback when status and schedule still match", async () => {
    await scheduleJob(7, "0 20 * * 0");
    const callback = Array.from(mocks.callbacks.values())[0];
    mocks.findJob.mockResolvedValue({
      id: 7,
      name: "Outbound",
      status: "active",
      schedule: "0 20 * * 0",
    });

    await callback();

    expect(mocks.runJob).toHaveBeenCalledWith(7);
    expect(mocks.logAudit).toHaveBeenCalledOnce();
  });
});
