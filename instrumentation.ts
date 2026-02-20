export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeScheduler } = await import("./lib/scheduler/index");
    await initializeScheduler();
  }
}
