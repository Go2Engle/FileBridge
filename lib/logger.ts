import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";
import { shipPinoLine } from "@/lib/datadog/shipper";

// ---------------------------------------------------------------------------
// Async context store — propagates log context through async call stacks
// without threading parameters through every function signature.
// ---------------------------------------------------------------------------
interface LogContext {
  requestId?: string;
  jobId?: number;
  runId?: number;
  jobName?: string;
  trigger?: string;
}

const store = new AsyncLocalStorage<LogContext>();

// ---------------------------------------------------------------------------
// Sensitive field redaction — these paths are matched against every log
// object and replaced with "[REDACTED]" before the line is written.
// Covers direct fields and nested objects (*.field notation).
// ---------------------------------------------------------------------------
const REDACT_PATHS = [
  "password",
  "privateKey",
  "passphrase",
  "accountKey",
  "connectionString",
  "token",
  "secret",
  "credentials",
  "*.password",
  "*.privateKey",
  "*.passphrase",
  "*.accountKey",
  "*.connectionString",
  "*.token",
  "*.secret",
  "*.credentials",
];

// ---------------------------------------------------------------------------
// Base pino logger
// - JSON output to stdout (NDJSON — ingested natively by Datadog, Grafana
//   Loki/Promtail, AWS CloudWatch, Azure Monitor, etc.)
// - Control log verbosity via LOG_LEVEL env var (default: info)
// - Every line is also offered to the Datadog shipper, which forwards it when
//   log forwarding is enabled in Admin → Datadog (no-op otherwise). Lines are
//   already redacted at this point.
// ---------------------------------------------------------------------------
const datadogStream = {
  write(line: string) {
    try {
      shipPinoLine(line);
    } catch {
      // Never let log forwarding break logging
    }
  },
};

const baseLogger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: "filebridge" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { level: "trace", stream: pino.destination({ dest: 1, sync: true }) },
    { level: "trace", stream: datadogStream },
  ]),
);

// ---------------------------------------------------------------------------
// Logger factory — returns a thin wrapper that automatically merges the
// current async context (requestId, jobId, runId) into every log line.
// ---------------------------------------------------------------------------
type Extra = Record<string, unknown>;

function child(component: string) {
  return baseLogger.child({ component, ...store.getStore() });
}

/**
 * Create a structured logger bound to a named component.
 *
 * Usage:
 *   const log = createLogger('engine');
 *   log.info('Job started', { jobId: 42 });
 *
 * Each call emits a JSON line with at minimum:
 *   { level, time, service, component, jobId?, runId?, requestId?, msg, ...extra }
 */
export function createLogger(component: string) {
  return {
    debug: (msg: string, extra?: Extra) => child(component).debug(extra ?? {}, msg),
    info:  (msg: string, extra?: Extra) => child(component).info(extra ?? {}, msg),
    warn:  (msg: string, extra?: Extra) => child(component).warn(extra ?? {}, msg),
    error: (msg: string, extra?: Extra) => child(component).error(extra ?? {}, msg),
  };
}

// ---------------------------------------------------------------------------
// Context runners — wrap an async operation so all log calls inside it
// automatically include the relevant correlation fields.
// ---------------------------------------------------------------------------

/**
 * Run `fn` with a request ID attached to all log lines emitted inside it.
 * Call this at the top of an API route handler.
 */
export function withRequestContext<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId }, fn);
}

/**
 * Run `fn` with jobId + runId (and optionally jobName + trigger) attached to
 * all log lines emitted inside it — including provider (SMB/SFTP/…) lines.
 * Call this at the start of `runJob()` in the transfer engine.
 */
export function withJobContext<T>(
  jobId: number,
  runId: number,
  fn: () => Promise<T>,
  extra: { jobName?: string; trigger?: string } = {}
): Promise<T> {
  return store.run({ jobId, runId, ...extra }, fn) as Promise<T>;
}
