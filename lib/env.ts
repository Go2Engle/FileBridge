import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("env");

/**
 * Server-side environment variable validation.
 * Call validateEnv() at startup to fail fast with clear error messages
 * instead of mysterious runtime failures deep in the request cycle.
 *
 * Only AUTH_SECRET is required. SSO providers are configured via the admin UI.
 */

const envSchema = z.object({
  // NextAuth — always required
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (generate with: openssl rand -base64 32)"),

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

    log.error("Invalid environment configuration — server cannot start", { errors });
    process.exit(1);
  }

  const devBypass = process.env.AUTH_BYPASS_DEV === "true";
  log.info("Environment validated", { authBypass: devBypass });
}
