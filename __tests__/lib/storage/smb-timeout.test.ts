// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { createRequire } from "module";

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => logMock }));

const nodeRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const forge: any = nodeRequire("v9u-smb2/lib/tools/smb2-forge");
const inner = vi.fn();
let REQUEST_TIMEOUT_MS = 0;

beforeAll(async () => {
  // Swap the library's request for a stub BEFORE the timeout wrapper captures it.
  forge.request = inner;
  ({ REQUEST_TIMEOUT_MS } = await import("@/lib/storage/smb-timeout"));
});

function makeConnection() {
  return { ip: "smb.test", socket: new EventEmitter() };
}

describe("smb-timeout request wrapper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    inner.mockReset();
    Object.values(logMock).forEach((fn) => fn.mockReset());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not throw when a request without a callback times out", () => {
    const conn = makeConnection();
    forge.request("close", { FileId: Buffer.alloc(16) }, conn, undefined);

    expect(() => vi.advanceTimersByTime(REQUEST_TIMEOUT_MS)).not.toThrow();
    expect(logMock.warn).toHaveBeenCalledWith(
      "SMB request timed out — connection likely dead",
      expect.objectContaining({ messageName: "close" }),
    );
  });

  it("disarms the timer and rethrows when the request throws synchronously", () => {
    // Regression: client.close() with no args reached the CLOSE generator with
    // params === undefined, which threw — but the 60s timer stayed armed.
    inner.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'FileId')");
    });
    const conn = makeConnection();

    expect(() => forge.request("close", undefined, conn, undefined)).toThrow(TypeError);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it("passes the response through once and clears the timer", () => {
    const conn = makeConnection();
    const cb = vi.fn();
    forge.request("create", {}, conn, cb);

    const onResponse = inner.mock.calls[0][3];
    onResponse(null, { FileId: "x" });
    expect(cb).toHaveBeenCalledExactlyOnceWith(null, { FileId: "x" });
    expect(vi.getTimerCount()).toBe(0);

    onResponse(null, "late duplicate");
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("calls back with SMB_REQUEST_TIMEOUT and drops a late response", () => {
    const conn = makeConnection();
    const cb = vi.fn();
    forge.request("read", {}, conn, cb);

    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ code: "SMB_REQUEST_TIMEOUT", messageName: "read" });

    inner.mock.calls[0][3](null, "late");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fails pending requests immediately when the socket closes", () => {
    const conn = makeConnection();
    const cbA = vi.fn();
    const cbB = vi.fn();
    forge.request("write", {}, conn, cbA);
    forge.request("close", {}, conn, cbB);
    forge.request("close", {}, conn, undefined);

    conn.socket.emit("close");

    expect(cbA.mock.calls[0][0]).toMatchObject({ code: "SMB_CONNECTION_CLOSED", messageName: "write" });
    expect(cbB.mock.calls[0][0]).toMatchObject({ code: "SMB_CONNECTION_CLOSED", messageName: "close" });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it("logs instead of throwing when a callback throws on timeout", () => {
    const conn = makeConnection();
    forge.request("close", {}, conn, () => {
      throw new Error("callback blew up");
    });

    expect(() => vi.advanceTimersByTime(REQUEST_TIMEOUT_MS)).not.toThrow();
    expect(logMock.error).toHaveBeenCalledWith(
      "SMB request callback threw",
      expect.objectContaining({ messageName: "close" }),
    );
  });
});
