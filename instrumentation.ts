export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProcessErrorHandlers } = await import("./lib/process-errors");
    installProcessErrorHandlers();

    const { validateEnv } = await import("./lib/env");
    validateEnv();

    const { initDatadogFromSettings } = await import("./lib/datadog/config");
    initDatadogFromSettings();

    const { initializeScheduler } = await import("./lib/scheduler/index");
    await initializeScheduler();

    const { initializeBackupScheduler } = await import("./lib/backup/index");
    await initializeBackupScheduler();
  }
}
