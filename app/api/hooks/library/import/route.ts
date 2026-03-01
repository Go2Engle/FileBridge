import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { createHook } from "@/lib/db/hooks";
import { logAudit, getUserId, getIpFromRequest } from "@/lib/audit";
import { createLogger } from "@/lib/logger";
import { load as parseYaml } from "js-yaml";
import fs from "fs";
import path from "path";
import type { LibraryHookInput } from "@/app/api/hooks/library/route";

const log = createLogger("api");

const GITHUB_REPO = "go2engle/FileBridge";
const GITHUB_BRANCH = "main";
const COMMUNITY_PATH = "hooks-library/community";

// ── YAML fetchers (mirrors route.ts logic, single-file variant) ───────────

async function fetchCommunityYaml(id: string): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "FileBridge",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Try .yaml then .yml
  for (const ext of [".yaml", ".yml"]) {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${COMMUNITY_PATH}/${id}${ext}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) return res.text();
    } catch {
      // try next extension
    }
  }
  return null;
}

function readLocalYaml(id: string): string | null {
  const base = path.join(process.cwd(), "hooks-library", "local");
  for (const ext of [".yaml", ".yml"]) {
    const filePath = path.join(base, `${id}${ext}`);
    if (fs.existsSync(filePath)) {
      try { return fs.readFileSync(filePath, "utf-8"); } catch { /* fall through */ }
    }
  }
  return null;
}

// ── Config substitution ───────────────────────────────────────────────────

// Only known runtime vars — these must NOT be substituted at import time.
const RUNTIME_VARS = new Set([
  "job_id", "job_name", "run_id", "trigger", "status",
  "files_transferred", "bytes_transferred", "error_message",
]);

function substituteValue(
  str: string,
  inputs: LibraryHookInput[],
  values: Record<string, string>
): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    if (RUNTIME_VARS.has(trimmed)) return match; // leave runtime vars as-is
    const input = inputs.find((i) => i.id === trimmed);
    if (!input) return match; // unknown placeholder — leave as-is
    return values[trimmed] ?? input.default ?? "";
  });
}

function substituteConfig(
  obj: unknown,
  inputs: LibraryHookInput[],
  values: Record<string, string>
): unknown {
  if (typeof obj === "string") return substituteValue(obj, inputs, values);
  if (Array.isArray(obj)) return obj.map((item) => substituteConfig(item, inputs, values));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = substituteConfig(v, inputs, values);
    }
    return result;
  }
  return obj;
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authResult = await requireRole("admin");
  if ("error" in authResult) return authResult.error;
  const { session } = authResult;

  let body: { id?: string; source?: string; values?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, source, values = {} } = body;
  if (!id || (source !== "community" && source !== "local")) {
    return NextResponse.json({ error: "id and source are required" }, { status: 400 });
  }

  // Fetch YAML
  const raw = source === "community"
    ? await fetchCommunityYaml(id)
    : readLocalYaml(id);

  if (!raw) {
    return NextResponse.json({ error: "Hook template not found" }, { status: 404 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Failed to parse hook template" }, { status: 500 });
  }

  if (!parsed.name || !parsed.type || !parsed.config) {
    return NextResponse.json({ error: "Malformed hook template" }, { status: 400 });
  }

  const inputs: LibraryHookInput[] = Array.isArray(parsed.inputs)
    ? (parsed.inputs as LibraryHookInput[])
    : [];

  // Validate required inputs
  const missing = inputs.filter((inp) => inp.required && !values[inp.id]?.trim());
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required fields", fields: missing.map((m) => m.id) },
      { status: 400 }
    );
  }

  // Substitute + encrypt
  const resolvedConfig = substituteConfig(parsed.config, inputs, values);

  try {
    const hook = createHook({
      name: String(parsed.name),
      description: parsed.description != null ? String(parsed.description) : null,
      type: parsed.type as "webhook" | "shell",
      config: JSON.stringify(resolvedConfig),
      enabled: true,
    });

    logAudit({
      userId: getUserId(session),
      action: "create",
      resource: "settings",
      resourceId: hook.id,
      resourceName: hook.name,
      ipAddress: getIpFromRequest(req),
      details: { source, libraryId: id },
    });

    return NextResponse.json(hook, { status: 201 });
  } catch (err) {
    log.error("Failed to create hook from library", { error: err });
    return NextResponse.json({ error: "Failed to create hook" }, { status: 500 });
  }
}
