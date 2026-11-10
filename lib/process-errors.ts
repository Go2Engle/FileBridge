import { createLogger } from "@/lib/logger";

const log = createLogger("process");

let installed = false;

/**
 * Log uncaught exceptions and unhandled rejections through the structured
 * logger so each one lands as a single `level: error` entry with the full
 * stack (`err.stack`) and — when it was thrown inside a job — the jobId /
 * runId / jobName from the async log context.
 *
 * This only adds a listener. Next.js installs its own handlers that keep the
 * process alive (and print the multi-line "⨯ uncaughtException" to stderr);
 * that behaviour is unchanged.
 */
export function installProcessErrorHandlers(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err, origin) => {
    log.error("Uncaught exception", { err, origin });
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", {
      err: reason instanceof Error ? reason : new Error(String(reason)),
    });
  });
}
