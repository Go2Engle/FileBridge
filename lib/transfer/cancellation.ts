const CANCEL_MESSAGE = "Job stopped by an administrator";

export class JobCancelledError extends Error {
  constructor(message = CANCEL_MESSAGE) {
    super(message);
    this.name = "JobCancelledError";
  }
}

interface ActiveJobRun {
  controller: AbortController;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

declare global {
  // Keep one registry across Next.js route/server bundles in this process.
  var __fileBridgeActiveJobRuns: Map<number, ActiveJobRun> | undefined;
}

const activeJobRuns =
  globalThis.__fileBridgeActiveJobRuns ??
  (globalThis.__fileBridgeActiveJobRuns = new Map<number, ActiveJobRun>());

export interface JobCancellationHandle {
  signal: AbortSignal;
  finish: () => void;
}

export function registerActiveJob(jobId: number): JobCancellationHandle {
  const controller = new AbortController();
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const entry = { controller, completion, resolveCompletion };
  activeJobRuns.set(jobId, entry);

  let finished = false;
  return {
    signal: controller.signal,
    finish: () => {
      if (finished) return;
      finished = true;
      if (activeJobRuns.get(jobId) === entry) {
        activeJobRuns.delete(jobId);
      }
      resolveCompletion();
    },
  };
}

export function cancelActiveJob(jobId: number): Promise<void> | null {
  const entry = activeJobRuns.get(jobId);
  if (!entry) return null;
  if (!entry.controller.signal.aborted) {
    entry.controller.abort(new JobCancelledError());
  }
  return entry.completion;
}

export function throwIfJobCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof JobCancelledError
    ? signal.reason
    : new JobCancelledError();
}

export function isJobCancelledError(error: unknown): error is JobCancelledError {
  return error instanceof JobCancelledError ||
    (error instanceof Error && error.name === "JobCancelledError");
}

/**
 * Stop awaiting a potentially hung operation as soon as the job is cancelled.
 * The caller's abort handler is responsible for closing the underlying provider
 * connection or stream; the original promise remains observed to avoid an
 * unhandled rejection if it settles later.
 */
export function withJobCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof JobCancelledError
        ? signal.reason
        : new JobCancelledError(),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason instanceof JobCancelledError
          ? signal.reason
          : new JobCancelledError(),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
