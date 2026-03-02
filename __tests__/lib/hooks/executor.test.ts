import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.AUTH_SECRET = "executor-test-secret-key";

vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { executeHooks, type HookContext } from "@/lib/hooks/executor";
import { db } from "@/lib/db";

type Hook = {
  id: number; name: string; type: "webhook" | "shell" | "email";
  config: string; enabled: boolean; description: string | null;
  createdAt: string; updatedAt: string;
};

function makeHook(overrides: Partial<Hook> = {}): Hook {
  return {
    id: 1, name: "Test Hook", type: "webhook",
    config: JSON.stringify({ url: "https://example.com/hook", method: "POST" }),
    enabled: true, description: null,
    createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const ctx: HookContext = {
  jobId: 42,
  jobName: "Nightly Backup",
  runId: 100,
  trigger: "post_job",
  status: "success",
  filesTransferred: 7,
  bytesTransferred: 2048,
};

describe("executeHooks()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset db.insert mock to return a fresh chain per call
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) } as never);
  });

  it("completes without error for an empty hook list", async () => {
    await expect(executeHooks([], ctx, 999)).resolves.toBeUndefined();
  });

  it("skips disabled hooks without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hook = makeHook({ enabled: false });
    await executeHooks([hook as never], ctx, 1);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("calls fetch with the configured webhook URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "ok", status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);
    const hook = makeHook({ config: JSON.stringify({ url: "https://hooks.example.com/notify", method: "POST" }) });
    await executeHooks([hook as never], ctx, 1);
    expect(fetchMock).toHaveBeenCalledWith("https://hooks.example.com/notify", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("interpolates context variables into a custom webhook body", async () => {
    let capturedBody = "";
    const fetchMock = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
      return { ok: true, text: async () => "ok", status: 200, statusText: "OK" };
    });
    vi.stubGlobal("fetch", fetchMock);
    const hook = makeHook({
      config: JSON.stringify({
        url: "https://x.com",
        method: "POST",
        body: "job={{job_id}},name={{job_name}},run={{run_id}},files={{files_transferred}}",
      }),
    });
    await executeHooks([hook as never], ctx, 1);
    expect(capturedBody).toBe("job=42,name=Nightly Backup,run=100,files=7");
    vi.unstubAllGlobals();
  });

  it("records the run result in hookRuns on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, text: async () => "acknowledged", status: 200, statusText: "OK",
    }));
    await executeHooks([makeHook() as never], ctx, 5);
    const insertMock = vi.mocked(db.insert);
    expect(insertMock).toHaveBeenCalled();
    const valuesCall = insertMock.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", hookId: 1, jobRunId: 5 })
    );
    vi.unstubAllGlobals();
  });

  it("records failure and throws when webhook returns a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, text: async () => "Internal Server Error", status: 500, statusText: "Internal Server Error",
    }));
    const hook = makeHook({ name: "Failing Hook" });
    await expect(executeHooks([hook as never], ctx, 1)).rejects.toThrow("Failing Hook");
    const valuesCall = vi.mocked(db.insert).mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(expect.objectContaining({ status: "failure" }));
    vi.unstubAllGlobals();
  });

  it("throws and records failure when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const hook = makeHook({ name: "Unreachable Hook" });
    await expect(executeHooks([hook as never], ctx, 1)).rejects.toThrow("Unreachable Hook");
    vi.unstubAllGlobals();
  });

  it("throws with a descriptive message when hook config is invalid JSON", async () => {
    const hook = makeHook({ config: "NOT VALID JSON", name: "Bad Config Hook" });
    await expect(executeHooks([hook as never], ctx, 1)).rejects.toThrow("Bad Config Hook");
  });

  it("executes multiple hooks in order, stopping at first failure", async () => {
    const order: number[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
      if (url === "https://ok.example.com") {
        order.push(1);
        return { ok: true, text: async () => "ok", status: 200, statusText: "OK" };
      }
      order.push(2);
      return { ok: false, text: async () => "fail", status: 500, statusText: "Error" };
    }));
    const hooks = [
      makeHook({ id: 1, name: "First", config: JSON.stringify({ url: "https://ok.example.com" }) }),
      makeHook({ id: 2, name: "Second (will fail)", config: JSON.stringify({ url: "https://fail.example.com" }) }),
      makeHook({ id: 3, name: "Third (should not run)", config: JSON.stringify({ url: "https://third.example.com" }) }),
    ];
    await expect(executeHooks(hooks as never[], ctx, 1)).rejects.toThrow("Second");
    expect(order).toEqual([1, 2]);
    vi.unstubAllGlobals();
  });

  it("truncates large webhook responses to 4096 bytes in the recorded output", async () => {
    const bigResponse = "X".repeat(5000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, text: async () => bigResponse, status: 200, statusText: "OK",
    }));
    await executeHooks([makeHook() as never], ctx, 1);
    const valuesCall = vi.mocked(db.insert).mock.results[0].value.values;
    const recorded = valuesCall.mock.calls[0][0] as { output: string };
    expect(recorded.output.length).toBeLessThanOrEqual(4096 + 20); // +20 for truncation marker
    expect(recorded.output).toContain("[truncated]");
    vi.unstubAllGlobals();
  });
});
