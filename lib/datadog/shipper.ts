/**
 * Datadog log shipper.
 *
 * Batches log entries in memory and POSTs them (gzip) to the Datadog HTTP
 * logs intake. Three sources feed it:
 *   - "app":   every structured pino line (wired up in lib/logger.ts)
 *   - "job":   per-file transfer results, hook runs and run summaries
 *   - "audit": audit-trail entries
 *
 * This module deliberately imports nothing from the app (no logger, no DB) so
 * the logger can depend on it without a cycle. Its own diagnostics go straight
 * to stderr — routing them through pino would feed them back into the queue.
 *
 * State lives on globalThis because Next.js compiles instrumentation, route
 * handlers and the engine into separate bundles within the same process;
 * they must share one queue and one config.
 */
import { gzipSync } from "zlib";
import os from "os";

export const DATADOG_SITES = [
  { value: "datadoghq.com", label: "US1 (datadoghq.com)" },
  { value: "us3.datadoghq.com", label: "US3 (us3.datadoghq.com)" },
  { value: "us5.datadoghq.com", label: "US5 (us5.datadoghq.com)" },
  { value: "datadoghq.eu", label: "EU1 (datadoghq.eu)" },
  { value: "ap1.datadoghq.com", label: "AP1 (ap1.datadoghq.com)" },
  { value: "ap2.datadoghq.com", label: "AP2 (ap2.datadoghq.com)" },
  { value: "ddog-gov.com", label: "US1-FED (ddog-gov.com)" },
] as const;

export type DatadogSite = (typeof DATADOG_SITES)[number]["value"];
export type DatadogLevel = "debug" | "info" | "warn" | "error";
export type LogKind = "app" | "job" | "audit";

export interface DatadogShipperConfig {
  enabled: boolean;
  site: string;
  apiKey: string;
  service: string;
  env: string;
  hostname: string;
  /** Comma-separated `key:value` tags added to every log. */
  tags: string;
  minLevel: DatadogLevel;
  sendAppLogs: boolean;
  sendJobLogs: boolean;
  sendAuditLogs: boolean;
}

export interface ShipperStats {
  enabled: boolean;
  queued: number;
  sent: number;
  dropped: number;
  failedBatches: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

export type DatadogLogEntry = Record<string, unknown> & {
  message: string;
  status?: string;
};

const LEVEL_RANK: Record<DatadogLevel, number> = { debug: 20, info: 30, warn: 40, error: 50 };
const PINO_STATUS: Record<number, string> = {
  10: "debug", // trace
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "critical", // fatal
};

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 500;
const MAX_QUEUE = 20_000;
const MAX_BATCH_ENTRIES = 1_000; // Datadog intake limit per request
const MAX_BATCH_BYTES = 4 * 1024 * 1024; // stay under the 5 MB uncompressed limit
const MAX_ENTRY_BYTES = 900 * 1024; // intake truncates single logs above 1 MB
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 15_000;

interface QueuedEntry {
  body: string;
  bytes: number;
}

interface ShipperState {
  config: DatadogShipperConfig | null;
  queue: QueuedEntry[];
  timer: ReturnType<typeof setInterval> | null;
  flushing: Promise<void> | null;
  stats: Omit<ShipperStats, "enabled" | "queued">;
}

declare global {
  var __fileBridgeDatadogShipper: ShipperState | undefined;
}

const state: ShipperState =
  globalThis.__fileBridgeDatadogShipper ??
  (globalThis.__fileBridgeDatadogShipper = {
    config: null,
    queue: [],
    timer: null,
    flushing: null,
    stats: {
      sent: 0,
      dropped: 0,
      failedBatches: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
    },
  });

function diag(message: string, extra?: unknown) {
  // Bypass pino on purpose (see header comment).
  process.stderr.write(
    JSON.stringify({ level: 40, time: new Date().toISOString(), component: "datadog", msg: message, extra }) + "\n",
  );
}

export function intakeUrl(site: string): string {
  return `https://http-intake.logs.${site}/api/v2/logs`;
}

export function apiUrl(site: string): string {
  return `https://api.${site}`;
}

function isActive(config: DatadogShipperConfig | null): config is DatadogShipperConfig {
  return !!config && config.enabled && !!config.apiKey && !!config.site;
}

/** Apply (or clear) the shipper configuration. Safe to call repeatedly. */
export function configureDatadogShipper(config: DatadogShipperConfig | null): void {
  state.config = config;
  if (isActive(config)) {
    if (!state.timer) {
      state.timer = setInterval(() => {
        void flushDatadogLogs();
      }, FLUSH_INTERVAL_MS);
      state.timer.unref?.();
    }
  } else {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    state.queue = [];
  }
}

export function getShipperStats(): ShipperStats {
  return {
    enabled: isActive(state.config),
    queued: state.queue.length,
    ...state.stats,
  };
}

function kindEnabled(config: DatadogShipperConfig, kind: LogKind): boolean {
  if (kind === "app") return config.sendAppLogs;
  if (kind === "job") return config.sendJobLogs;
  return config.sendAuditLogs;
}

function statusRank(status: string | undefined): number {
  switch (status) {
    case "debug":
      return 20;
    case "warn":
    case "warning":
      return 40;
    case "error":
    case "critical":
    case "alert":
    case "emergency":
      return 50;
    default:
      return 30;
  }
}

function buildTags(config: DatadogShipperConfig, kind: LogKind): string {
  const tags = config.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (config.env) tags.push(`env:${config.env}`);
  tags.push(`filebridge.log_type:${kind}`);
  return tags.join(",");
}

/** Queue one log entry. Cheap no-op when shipping is disabled. */
export function shipToDatadog(kind: LogKind, entry: DatadogLogEntry): void {
  const config = state.config;
  if (!isActive(config) || !kindEnabled(config, kind)) return;
  if (statusRank(entry.status) < LEVEL_RANK[config.minLevel]) return;

  const payload: Record<string, unknown> = {
    ddsource: "filebridge",
    service: config.service || "filebridge",
    hostname: config.hostname || os.hostname(),
    ddtags: buildTags(config, kind),
    status: entry.status ?? "info",
    timestamp: Date.now(),
    ...entry,
  };

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return; // unserializable — drop silently
  }
  if (body.length > MAX_ENTRY_BYTES) {
    payload.message = String(payload.message).slice(0, 8_000) + " …[truncated]";
    for (const key of Object.keys(payload)) {
      if (!["ddsource", "service", "hostname", "ddtags", "status", "timestamp", "message"].includes(key)) {
        delete payload[key];
      }
    }
    payload.truncated = true;
    body = JSON.stringify(payload);
  }

  state.queue.push({ body, bytes: Buffer.byteLength(body) });
  if (state.queue.length > MAX_QUEUE) {
    const overflow = state.queue.length - MAX_QUEUE;
    state.queue.splice(0, overflow);
    state.stats.dropped += overflow;
  }
  if (state.queue.length >= FLUSH_THRESHOLD) void flushDatadogLogs();
}

/** Pino components whose lines count as "job" / "audit" logs rather than app logs. */
export const JOB_LOG_COMPONENT = "job-log";
export const AUDIT_LOG_COMPONENT = "audit-log";

export function classifyLogLine(component: unknown): LogKind {
  if (component === JOB_LOG_COMPONENT) return "job";
  if (component === AUDIT_LOG_COMPONENT) return "audit";
  return "app";
}

/**
 * Ingest one NDJSON line produced by pino. Called for every log line; the
 * line's `component` decides whether it is an app, job or audit log.
 */
export function shipPinoLine(line: string): void {
  const config = state.config;
  if (!isActive(config)) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  const kind = classifyLogLine(parsed.component);
  if (!kindEnabled(config, kind)) return;
  const { level, time, msg, service: _service, ...rest } = parsed;
  void _service;
  const timestamp = typeof time === "string" ? Date.parse(time) : typeof time === "number" ? time : Date.now();
  shipToDatadog(kind, {
    ...rest,
    message: typeof msg === "string" ? msg : "",
    status: PINO_STATUS[Number(level)] ?? "info",
    level_value: level,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  });
}

function takeBatch(): QueuedEntry[] {
  const batch: QueuedEntry[] = [];
  let bytes = 2;
  while (state.queue.length > 0 && batch.length < MAX_BATCH_ENTRIES) {
    const next = state.queue[0];
    if (batch.length > 0 && bytes + next.bytes + 1 > MAX_BATCH_BYTES) break;
    batch.push(state.queue.shift()!);
    bytes += next.bytes + 1;
  }
  return batch;
}

async function postBatch(config: DatadogShipperConfig, batch: QueuedEntry[]): Promise<{ ok: boolean; retryable: boolean; error?: string }> {
  const body = gzipSync(Buffer.from(`[${batch.map((e) => e.body).join(",")}]`));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(intakeUrl(config.site), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "DD-API-KEY": config.apiKey,
      },
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, retryable: false };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      retryable: res.status === 429 || res.status >= 500 || res.status === 408,
      error: `HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    };
  } catch (err) {
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function doFlush(): Promise<void> {
  while (state.queue.length > 0) {
    const config = state.config;
    if (!isActive(config)) return;
    const batch = takeBatch();
    let result = await postBatch(config, batch);
    for (let attempt = 2; !result.ok && result.retryable && attempt <= MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 2)));
      result = await postBatch(config, batch);
    }
    if (result.ok) {
      state.stats.sent += batch.length;
      state.stats.lastSuccessAt = new Date().toISOString();
    } else {
      state.stats.failedBatches++;
      state.stats.dropped += batch.length;
      state.stats.lastErrorAt = new Date().toISOString();
      state.stats.lastError = result.error ?? "Unknown error";
      diag("Failed to ship logs to Datadog", { error: result.error, entries: batch.length });
      return; // back off until the next interval
    }
  }
}

/** Flush everything queued. Concurrent callers share one in-flight flush. */
export function flushDatadogLogs(): Promise<void> {
  if (!state.flushing) {
    state.flushing = doFlush().finally(() => {
      state.flushing = null;
    });
  }
  return state.flushing;
}

/**
 * Validate an API key and send a single test log. Does not touch the queue,
 * so it works with unsaved settings from the admin form.
 */
export async function sendDatadogTestLog(
  config: DatadogShipperConfig,
  actor: string,
): Promise<{ ok: boolean; step: "validate" | "send"; error?: string }> {
  try {
    const res = await fetch(`${apiUrl(config.site)}/api/v1/validate`, {
      headers: { "DD-API-KEY": config.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: false,
        step: "validate",
        error: res.status === 403 ? "API key rejected by Datadog (403). Check the key and site." : `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    return { ok: false, step: "validate", error: err instanceof Error ? err.message : String(err) };
  }

  const entry = JSON.stringify({
    ddsource: "filebridge",
    service: config.service || "filebridge",
    hostname: config.hostname || os.hostname(),
    ddtags: buildTags(config, "app"),
    status: "info",
    timestamp: Date.now(),
    message: "FileBridge Datadog log forwarding test",
    component: "datadog",
    triggeredBy: actor,
  });
  const result = await postBatch(config, [{ body: entry, bytes: entry.length }]);
  return result.ok ? { ok: true, step: "send" } : { ok: false, step: "send", error: result.error };
}
