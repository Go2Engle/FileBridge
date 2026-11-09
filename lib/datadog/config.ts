import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  DATADOG_SITES,
  configureDatadogShipper,
  type DatadogShipperConfig,
} from "@/lib/datadog/shipper";

const SETTINGS_KEY = "datadog";

const siteValues = DATADOG_SITES.map((s) => s.value) as [string, ...string[]];

/** Shape accepted from the admin form. `apiKey` blank = keep the stored key. */
export const datadogConfigInputSchema = z.object({
  enabled: z.boolean(),
  site: z.enum(siteValues),
  apiKey: z.string().trim().max(200).optional().default(""),
  service: z.string().trim().min(1, "Service is required").max(100),
  env: z.string().trim().max(100).default(""),
  hostname: z.string().trim().max(255).default(""),
  tags: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .refine(
      (v) => v === "" || v.split(",").every((t) => /^[^\s,:]+:[^\s,]+$/.test(t.trim())),
      "Tags must be comma-separated key:value pairs",
    ),
  minLevel: z.enum(["debug", "info", "warn", "error"]),
  sendAppLogs: z.boolean(),
  sendJobLogs: z.boolean(),
  sendAuditLogs: z.boolean(),
});

export type DatadogConfigInput = z.infer<typeof datadogConfigInputSchema>;

interface StoredDatadogConfig extends Omit<DatadogShipperConfig, "apiKey"> {
  apiKeyEncrypted: string | null;
}

/** What the admin UI gets back — never the raw key. */
export interface PublicDatadogConfig extends Omit<DatadogShipperConfig, "apiKey"> {
  hasApiKey: boolean;
  apiKeyHint: string | null;
}

export const DEFAULT_DATADOG_CONFIG: Omit<DatadogShipperConfig, "apiKey"> = {
  enabled: false,
  site: "datadoghq.com",
  service: "filebridge",
  env: "",
  hostname: "",
  tags: "",
  minLevel: "info",
  sendAppLogs: true,
  sendJobLogs: true,
  sendAuditLogs: true,
};

function readStored(): StoredDatadogConfig | null {
  const row = db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (!row?.value) return null;
  return { ...DEFAULT_DATADOG_CONFIG, apiKeyEncrypted: null, ...(row.value as Partial<StoredDatadogConfig>) };
}

export function getDatadogConfig(): DatadogShipperConfig {
  const stored = readStored();
  if (!stored) return { ...DEFAULT_DATADOG_CONFIG, apiKey: "" };
  const { apiKeyEncrypted, ...rest } = stored;
  let apiKey = "";
  if (apiKeyEncrypted) {
    try {
      apiKey = decrypt(apiKeyEncrypted);
    } catch {
      apiKey = ""; // ENCRYPTION_KEY changed — admin must re-enter the key
    }
  }
  return { ...rest, apiKey };
}

export function toPublicDatadogConfig(config: DatadogShipperConfig): PublicDatadogConfig {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    hasApiKey: apiKey.length > 0,
    apiKeyHint: apiKey.length >= 4 ? `••••${apiKey.slice(-4)}` : null,
  };
}

/**
 * Merge form input with the stored config (keeping the existing API key when
 * the form leaves it blank). Does not persist.
 */
export function resolveDatadogConfig(input: DatadogConfigInput): DatadogShipperConfig {
  const current = getDatadogConfig();
  return {
    enabled: input.enabled,
    site: input.site,
    apiKey: input.apiKey ? input.apiKey : current.apiKey,
    service: input.service,
    env: input.env,
    hostname: input.hostname,
    tags: input.tags,
    minLevel: input.minLevel,
    sendAppLogs: input.sendAppLogs,
    sendJobLogs: input.sendJobLogs,
    sendAuditLogs: input.sendAuditLogs,
  };
}

export function saveDatadogConfig(config: DatadogShipperConfig): void {
  const { apiKey, ...rest } = config;
  const stored: StoredDatadogConfig = {
    ...rest,
    apiKeyEncrypted: apiKey ? encrypt(apiKey) : null,
  };
  const value = stored as unknown as Record<string, unknown>;
  db.insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
  configureDatadogShipper(config);
}

/** Load settings from the DB and start (or stop) the shipper. */
export function initDatadogFromSettings(): void {
  try {
    configureDatadogShipper(getDatadogConfig());
  } catch (err) {
    process.stderr.write(`[datadog] failed to load settings: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
