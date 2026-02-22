import { z } from "zod";

/**
 * Server-side environment variable validation.
 * Call validateEnv() at startup to fail fast with clear error messages
 * instead of mysterious runtime failures deep in the request cycle.
 *
 * Azure AD vars are skipped when AUTH_BYPASS_DEV=true (local dev only).
 */

const devBypass = process.env.AUTH_BYPASS_DEV === "true";

const envSchema = z.object({
  // NextAuth — always required
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (generate with: openssl rand -base64 32)"),

  // Azure AD — required in production, optional when dev bypass is active
  AZURE_AD_CLIENT_ID: devBypass
    ? z.string().optional()
    : z.string().min(1, "AZURE_AD_CLIENT_ID is required"),
  AZURE_AD_CLIENT_SECRET: devBypass
    ? z.string().optional()
    : z.string().min(1, "AZURE_AD_CLIENT_SECRET is required"),
  AZURE_AD_TENANT_ID: devBypass
    ? z.string().optional()
    : z.string().min(1, "AZURE_AD_TENANT_ID is required"),

  // Optional with sensible defaults
  DATABASE_PATH: z.string().optional(),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL").optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).optional(),
});

export function validateEnv(): void {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    console.error(
      `\n[FileBridge] ❌ Invalid environment configuration — server cannot start:\n${errors}\n` +
      `  Copy .env.example to .env and fill in the required values.\n`
    );
    process.exit(1);
  }

  console.log(`[FileBridge] ✓ Environment validated${devBypass ? " (auth bypass active)" : ""}`);
}
