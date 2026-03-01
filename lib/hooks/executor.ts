import { exec } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import { hookRuns } from "@/lib/db/schema";
import type { Hook, WebhookConfig, ShellConfig } from "@/lib/db/schema";
import { createLogger } from "@/lib/logger";

const execAsync = promisify(exec);
const log = createLogger("hooks");

const MAX_OUTPUT_BYTES = 4096;

export interface HookContext {
  jobId: number;
  jobName: string;
  runId: number;
  trigger: "pre_job" | "post_job";
  status?: "success" | "failure";
  filesTransferred?: number;
  bytesTransferred?: number;
  errorMessage?: string;
}

interface HookResult {
  success: boolean;
  output: string | null;
  errorMessage: string | null;
  durationMs: number;
}

function interpolate(template: string, ctx: HookContext): string {
  return template
    .replace(/\{\{job_id\}\}/g, String(ctx.jobId))
    .replace(/\{\{job_name\}\}/g, ctx.jobName)
    .replace(/\{\{run_id\}\}/g, String(ctx.runId))
    .replace(/\{\{trigger\}\}/g, ctx.trigger)
    .replace(/\{\{status\}\}/g, ctx.status ?? "")
    .replace(/\{\{files_transferred\}\}/g, String(ctx.filesTransferred ?? 0))
    .replace(/\{\{bytes_transferred\}\}/g, String(ctx.bytesTransferred ?? 0))
    .replace(/\{\{error_message\}\}/g, ctx.errorMessage ?? "");
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_BYTES) return s;
  return s.slice(0, MAX_OUTPUT_BYTES) + `\n...[truncated]`;
}

async function runWebhook(config: WebhookConfig, ctx: HookContext): Promise<HookResult> {
  const start = Date.now();
  const method = config.method ?? "POST";
  const timeoutMs = config.timeoutMs ?? 10_000;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "FileBridge-Hook/1.0",
    ...config.headers,
  };

  let body: string | undefined;
  if (method !== "GET") {
    if (config.body) {
      body = interpolate(config.body, ctx);
    } else {
      body = JSON.stringify({
        job_id: ctx.jobId,
        job_name: ctx.jobName,
        run_id: ctx.runId,
        trigger: ctx.trigger,
        status: ctx.status ?? null,
        files_transferred: ctx.filesTransferred ?? null,
        bytes_transferred: ctx.bytesTransferred ?? null,
        error_message: ctx.errorMessage ?? null,
      });
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(config.url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const responseText = await res.text().catch(() => "");
    const output = truncate(responseText);

    if (!res.ok) {
      return {
        success: false,
        output,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
        durationMs,
      };
    }

    return { success: true, output, errorMessage: null, durationMs };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      success: false,
      output: null,
      errorMessage: isAbort ? `Webhook timed out after ${timeoutMs}ms` : String(err),
      durationMs,
    };
  }
}

async function runShell(config: ShellConfig, ctx: HookContext): Promise<HookResult> {
  const start = Date.now();
  const timeoutMs = config.timeoutMs ?? 30_000;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FILEBRIDGE_JOB_ID: String(ctx.jobId),
    FILEBRIDGE_JOB_NAME: ctx.jobName,
    FILEBRIDGE_RUN_ID: String(ctx.runId),
    FILEBRIDGE_TRIGGER: ctx.trigger,
    FILEBRIDGE_STATUS: ctx.status ?? "",
    FILEBRIDGE_FILES_TRANSFERRED: String(ctx.filesTransferred ?? 0),
    FILEBRIDGE_BYTES_TRANSFERRED: String(ctx.bytesTransferred ?? 0),
    FILEBRIDGE_ERROR_MESSAGE: ctx.errorMessage ?? "",
  };

  try {
    const { stdout, stderr } = await execAsync(config.command, {
      timeout: timeoutMs,
      cwd: config.workingDir ?? undefined,
      env,
    });
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    return {
      success: true,
      output: truncate(combined),
      errorMessage: null,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const execErr = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim();
    const message = execErr.killed
      ? `Shell command timed out after ${timeoutMs}ms`
      : (execErr.message ?? String(err));
    return {
      success: false,
      output: combined ? truncate(combined) : null,
      errorMessage: message,
      durationMs,
    };
  }
}

/**
 * Executes all hooks in order, recording each result in hook_runs.
 * Throws on first failure — the caller should treat a throw as a job abort
 * for pre_job hooks, or a run failure for post_job hooks.
 */
export async function executeHooks(
  hooksToRun: Hook[],
  ctx: HookContext,
  jobRunId: number
): Promise<void> {
  for (const hook of hooksToRun) {
    if (!hook.enabled) {
      log.info("Hook skipped (disabled)", { hookId: hook.id, hookName: hook.name });
      continue;
    }

    log.info("Executing hook", { hookId: hook.id, hookName: hook.name, type: hook.type, trigger: ctx.trigger });

    let config: WebhookConfig | ShellConfig;
    try {
      config = JSON.parse(hook.config) as WebhookConfig | ShellConfig;
    } catch {
      const errorMessage = "Invalid hook config JSON";
      log.error("Hook config parse failed", { hookId: hook.id, error: errorMessage });
      await db.insert(hookRuns).values({
        jobId: ctx.jobId,
        jobRunId,
        hookId: hook.id,
        hookName: hook.name,
        hookType: hook.type,
        trigger: ctx.trigger,
        status: "failure",
        durationMs: 0,
        output: null,
        errorMessage,
      });
      throw new Error(`Hook "${hook.name}" failed: ${errorMessage}`);
    }

    const result =
      hook.type === "webhook"
        ? await runWebhook(config as WebhookConfig, ctx)
        : await runShell(config as ShellConfig, ctx);

    const runStatus = result.success ? "success" : "failure";

    log.info("Hook executed", {
      hookId: hook.id,
      hookName: hook.name,
      status: runStatus,
      durationMs: result.durationMs,
      ...(result.errorMessage ? { error: result.errorMessage } : {}),
    });

    await db.insert(hookRuns).values({
      jobId: ctx.jobId,
      jobRunId,
      hookId: hook.id,
      hookName: hook.name,
      hookType: hook.type,
      trigger: ctx.trigger,
      status: runStatus,
      durationMs: result.durationMs,
      output: result.output,
      errorMessage: result.errorMessage,
    });

    if (!result.success) {
      throw new Error(
        `Hook "${hook.name}" failed: ${result.errorMessage ?? "unknown error"}`
      );
    }
  }
}
