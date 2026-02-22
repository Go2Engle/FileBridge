export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();

    const { initializeScheduler } = await import("./lib/scheduler/index");
    await initializeScheduler();

    const { initializeBackupScheduler } = await import("./lib/backup/index");
    await initializeBackupScheduler();
  }
}
