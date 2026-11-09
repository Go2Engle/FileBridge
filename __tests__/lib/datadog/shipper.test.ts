import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "zlib";
import {
  configureDatadogShipper,
  flushDatadogLogs,
  getShipperStats,
  intakeUrl,
  shipPinoLine,
  shipToDatadog,
  type DatadogShipperConfig,
} from "@/lib/datadog/shipper";

const baseConfig: DatadogShipperConfig = {
  enabled: true,
  site: "us5.datadoghq.com",
  apiKey: "test-key",
  service: "filebridge",
  env: "prod",
  hostname: "fb-host",
  tags: "team:platform",
  minLevel: "info",
  sendAppLogs: true,
  sendJobLogs: true,
  sendAuditLogs: false,
};

function sentEntries(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown>[] {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(gunzipSync(init.body as Buffer).toString());
}

describe("datadog shipper", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    configureDatadogShipper(null); // reset queue
  });

  afterEach(() => {
    configureDatadogShipper(null);
    vi.unstubAllGlobals();
  });

  it("does nothing when disabled", async () => {
    shipToDatadog("job", { message: "x" });
    await flushDatadogLogs();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts gzipped batches with tags, service and API key", async () => {
    configureDatadogShipper(baseConfig);
    shipToDatadog("job", { message: "File transferred: a.csv", jobId: 3 });
    await flushDatadogLogs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(intakeUrl("us5.datadoghq.com"));
    expect((init.headers as Record<string, string>)["DD-API-KEY"]).toBe("test-key");
    const [entry] = sentEntries(fetchMock);
    expect(entry).toMatchObject({
      message: "File transferred: a.csv",
      service: "filebridge",
      hostname: "fb-host",
      ddsource: "filebridge",
      jobId: 3,
    });
    expect(entry.ddtags).toBe("team:platform,env:prod,filebridge.log_type:job");
    expect(getShipperStats().sent).toBeGreaterThanOrEqual(1);
  });

  it("respects per-source toggles and minimum level", async () => {
    configureDatadogShipper({ ...baseConfig, minLevel: "warn" });
    shipToDatadog("audit", { message: "audit disabled", status: "error" });
    shipToDatadog("job", { message: "too quiet", status: "info" });
    shipToDatadog("job", { message: "kept", status: "error" });
    await flushDatadogLogs();
    expect(sentEntries(fetchMock).map((e) => e.message)).toEqual(["kept"]);
  });

  it("maps pino lines to Datadog status and timestamp", async () => {
    configureDatadogShipper(baseConfig);
    shipPinoLine(
      JSON.stringify({ level: 40, time: "2026-11-09T18:57:55.005Z", service: "filebridge", component: "engine", jobId: 3, msg: "Stopping active job operations" }),
    );
    await flushDatadogLogs();
    const [entry] = sentEntries(fetchMock);
    expect(entry).toMatchObject({
      message: "Stopping active job operations",
      status: "warn",
      component: "engine",
      jobId: 3,
      timestamp: Date.parse("2026-11-09T18:57:55.005Z"),
    });
  });

  it("routes job-log and audit-log lines by their component toggle", async () => {
    configureDatadogShipper({ ...baseConfig, sendAppLogs: false, sendJobLogs: true, sendAuditLogs: false });
    const line = (component: string, msg: string) =>
      JSON.stringify({ level: 30, time: "2026-11-09T19:00:00.000Z", component, jobName: "Origami Policy", msg });
    shipPinoLine(line("engine", "Transferring file"));
    shipPinoLine(line("job-log", "Job run succeeded: Origami Policy"));
    shipPinoLine(line("audit-log", "admin execute job"));
    await flushDatadogLogs();
    const entries = sentEntries(fetchMock);
    expect(entries.map((e) => e.message)).toEqual(["Job run succeeded: Origami Policy"]);
    expect(entries[0].jobName).toBe("Origami Policy");
    expect(String(entries[0].ddtags)).toContain("filebridge.log_type:job");
  });

  it("records an error and drops the batch on a non-retryable response", async () => {
    fetchMock.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    configureDatadogShipper(baseConfig);
    shipToDatadog("job", { message: "x" });
    await flushDatadogLogs();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stats = getShipperStats();
    expect(stats.lastError).toContain("HTTP 403");
    expect(stats.queued).toBe(0);
    stderr.mockRestore();
  });
});
