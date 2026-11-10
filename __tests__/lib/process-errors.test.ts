// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

const logMock = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => logMock }));

import { installProcessErrorHandlers } from "@/lib/process-errors";

describe("installProcessErrorHandlers()", () => {
  const before = {
    exception: process.listeners("uncaughtException"),
    rejection: process.listeners("unhandledRejection"),
  };

  afterEach(() => {
    for (const l of process.listeners("uncaughtException")) {
      if (!before.exception.includes(l)) process.removeListener("uncaughtException", l);
    }
    for (const l of process.listeners("unhandledRejection")) {
      if (!before.rejection.includes(l)) process.removeListener("unhandledRejection", l);
    }
  });

  it("logs uncaught exceptions and rejections as structured errors, once", () => {
    installProcessErrorHandlers();
    installProcessErrorHandlers(); // idempotent

    const added = process.listeners("uncaughtException").filter((l) => !before.exception.includes(l));
    expect(added).toHaveLength(1);

    const err = new TypeError("a is not a function");
    added[0](err, "uncaughtException");
    expect(logMock.error).toHaveBeenCalledWith("Uncaught exception", { err, origin: "uncaughtException" });

    const onRejection = process.listeners("unhandledRejection").filter((l) => !before.rejection.includes(l))[0];
    onRejection("plain string reason", Promise.resolve());
    const [msg, extra] = logMock.error.mock.calls[1];
    expect(msg).toBe("Unhandled promise rejection");
    expect(extra.err).toBeInstanceOf(Error);
    expect(extra.err.message).toBe("plain string reason");
  });
});
