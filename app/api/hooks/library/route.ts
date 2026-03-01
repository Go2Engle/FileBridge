import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/rbac";
import { createLogger } from "@/lib/logger";
import fs from "fs";
import path from "path";
import { load as parseYaml } from "js-yaml";

const log = createLogger("api");

const GITHUB_REPO = "go2engle/FileBridge";
const GITHUB_BRANCH = "main";
const COMMUNITY_PATH = "hooks-library/community";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface LibraryHookInput {
  id: string;
  label: string;
  type: "text" | "secret" | "number";
  required?: boolean;
  default?: string;
  placeholder?: string;
  description?: string;
}

export interface LibraryHookEntry {
  id: string;
  source: "community" | "local";
  name: string;
  description?: string;
  type: "webhook" | "email" | "shell";
  tags?: string[];
  author?: string;
  config: Record<string, unknown>;
  inputs?: LibraryHookInput[];
}

// ── In-memory cache for remote community hooks ────────────────────────────

let communityCache: { hooks: LibraryHookEntry[]; fetchedAt: number } | null = null;

function parseHookYaml(raw: string, filename: string, source: "community" | "local"): LibraryHookEntry | null {
  try {
    const parsed = parseYaml(raw) as Record<string, unknown>;
    if (!parsed.name || !parsed.type || !parsed.config) return null;
    if (parsed.type !== "webhook" && parsed.type !== "email" && parsed.type !== "shell") return null;

    return {
      id: filename.replace(/\.ya?ml$/, ""),
      source,
      name: parsed.name as string,
      description: parsed.description != null ? String(parsed.description) : undefined,
      type: parsed.type as "webhook" | "email" | "shell",
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : undefined,
      author: parsed.author != null ? String(parsed.author) : undefined,
      config: parsed.config as Record<string, unknown>,
      inputs: Array.isArray(parsed.inputs) ? (parsed.inputs as LibraryHookInput[]) : undefined,
    };
  } catch {
    return null;
  }
}

// ── Remote community hooks (GitHub) ──────────────────────────────────────

async function fetchCommunityHooks(): Promise<LibraryHookEntry[]> {
  if (communityCache && Date.now() - communityCache.fetchedAt < CACHE_TTL_MS) {
    return communityCache.hooks;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "FileBridge",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const listRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${COMMUNITY_PATH}?ref=${GITHUB_BRANCH}`,
      { headers, signal: AbortSignal.timeout(8000) }
    );

    if (!listRes.ok) {
      log.warn("GitHub API returned non-OK listing community hooks", { status: listRes.status });
      return communityCache?.hooks ?? [];
    }

    const files = (await listRes.json()) as Array<{ name: string; download_url: string }>;
    const yamlFiles = files.filter((f) => f.name.endsWith(".yaml") || f.name.endsWith(".yml"));

    const results = await Promise.allSettled(
      yamlFiles.map(async (file) => {
        const res = await fetch(file.download_url, { headers, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        return parseHookYaml(raw, file.name, "community");
      })
    );

    const entries: LibraryHookEntry[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        entries.push(result.value);
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    communityCache = { hooks: entries, fetchedAt: Date.now() };
    return entries;
  } catch (err) {
    log.warn("Failed to fetch community hooks from GitHub — returning cached/empty", { error: err });
    return communityCache?.hooks ?? [];
  }
}

// ── Local hooks (filesystem) ──────────────────────────────────────────────

function readLocalHooks(): LibraryHookEntry[] {
  const folderPath = path.join(process.cwd(), "hooks-library", "local");
  if (!fs.existsSync(folderPath)) return [];

  let files: string[];
  try {
    files = fs.readdirSync(folderPath).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  } catch {
    return [];
  }

  const entries: LibraryHookEntry[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(folderPath, file), "utf-8");
      const entry = parseHookYaml(raw, file, "local");
      if (entry) entries.push(entry);
      else log.warn("Skipping malformed local hook file", { file });
    } catch (err) {
      log.warn("Failed to read local hook file", { file, error: err });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Route ─────────────────────────────────────────────────────────────────

export async function GET() {
  const result = await requireAuth();
  if ("error" in result) return result.error;

  const [community, local] = await Promise.all([
    fetchCommunityHooks(),
    Promise.resolve(readLocalHooks()),
  ]);

  return NextResponse.json({ hooks: [...community, ...local] });
}
