import { describe, expect, it } from "vitest";
import {
  cancelActiveJob,
  detachActiveJob,
  isJobCancelledError,
  registerActiveJob,
  throwIfJobCancelled,
  withJobCancellation,
} from "@/lib/transfer/cancellation";

describe("job cancellation registry", () => {
  it("aborts a registered job and resolves completion after cleanup", async () => {
    const handle = registerActiveJob(101);
    const completion = cancelActiveJob(101);

    expect(completion).not.toBeNull();
    expect(() => throwIfJobCancelled(handle.signal)).toThrow("stopped by an administrator");

    let completed = false;
    completion!.then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false);

    handle.finish();
    await completion;
    expect(completed).toBe(true);
    expect(cancelActiveJob(101)).toBeNull();
  });

  it("rejects a hung await as soon as the job is cancelled", async () => {
    const handle = registerActiveJob(102);
    const pending = withJobCancellation(new Promise<void>(() => {}), handle.signal);

    cancelActiveJob(102);
    await expect(pending).rejects.toSatisfy(isJobCancelledError);
    handle.finish();
  });

  it("detaches a wedged run so a new run owns the job", async () => {
    const zombie = registerActiveJob(103);
    const completion = cancelActiveJob(103);
    detachActiveJob(103);
    await completion; // detach resolves waiters
    expect(zombie.isCurrent()).toBe(false);

    const fresh = registerActiveJob(103);
    expect(fresh.isCurrent()).toBe(true);
    zombie.finish(); // late unwind of the zombie must not evict the new run
    expect(fresh.isCurrent()).toBe(true);
    expect(cancelActiveJob(103)).not.toBeNull();
    fresh.finish();
  });
});
