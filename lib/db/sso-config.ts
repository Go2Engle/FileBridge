import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, like } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";

const SSO_KEY_PREFIX = "sso_provider_";

export interface SsoProviderConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
}

interface StoredSsoConfig {
  enabled: boolean;
  clientId: string;
  clientSecretEncrypted: string;
  tenantId?: string;
}

export function getSsoConfig(provider: string): SsoProviderConfig | null {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, `${SSO_KEY_PREFIX}${provider}`))
    .get();

  if (!row?.value) return null;

  const stored = row.value as unknown as StoredSsoConfig;
  return {
    enabled: stored.enabled,
    clientId: stored.clientId,
    clientSecret: decrypt(stored.clientSecretEncrypted),
    tenantId: stored.tenantId,
  };
}

export function setSsoConfig(
  provider: string,
  config: SsoProviderConfig
): void {
  const stored: StoredSsoConfig = {
    enabled: config.enabled,
    clientId: config.clientId,
    clientSecretEncrypted: encrypt(config.clientSecret),
    tenantId: config.tenantId,
  };

  const key = `${SSO_KEY_PREFIX}${provider}`;
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();

  if (existing) {
    db.update(settings)
      .set({ value: stored as unknown as Record<string, unknown> })
      .where(eq(settings.key, key))
      .run();
  } else {
    db.insert(settings)
      .values({ key, value: stored as unknown as Record<string, unknown> })
      .run();
  }
}

export function getAllEnabledSsoConfigs(): Array<{
  provider: string;
  config: SsoProviderConfig;
}> {
  const rows = db
    .select()
    .from(settings)
    .where(like(settings.key, `${SSO_KEY_PREFIX}%`))
    .all();

  const results: Array<{ provider: string; config: SsoProviderConfig }> = [];

  for (const row of rows) {
    if (!row.value) continue;
    const stored = row.value as unknown as StoredSsoConfig;
    if (!stored.enabled) continue;

    const provider = row.key.replace(SSO_KEY_PREFIX, "");
    try {
      results.push({
        provider,
        config: {
          enabled: stored.enabled,
          clientId: stored.clientId,
          clientSecret: decrypt(stored.clientSecretEncrypted),
          tenantId: stored.tenantId,
        },
      });
    } catch {
      // Skip configs with decryption errors (e.g. AUTH_SECRET changed)
    }
  }

  return results;
}

export function getAllSsoConfigs(): Array<{
  provider: string;
  config: { enabled: boolean; clientId: string; tenantId?: string };
}> {
  const rows = db
    .select()
    .from(settings)
    .where(like(settings.key, `${SSO_KEY_PREFIX}%`))
    .all();

  return rows
    .filter((row) => row.value)
    .map((row) => {
      const stored = row.value as unknown as StoredSsoConfig;
      return {
        provider: row.key.replace(SSO_KEY_PREFIX, ""),
        config: {
          enabled: stored.enabled,
          clientId: stored.clientId,
          tenantId: stored.tenantId,
        },
      };
    });
}

export function deleteSsoConfig(provider: string): void {
  db.delete(settings)
    .where(eq(settings.key, `${SSO_KEY_PREFIX}${provider}`))
    .run();
}
