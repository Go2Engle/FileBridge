import { describe, expect, it } from "vitest";
import { getPostRunJobStatus } from "@/lib/transfer/status";

describe("getPostRunJobStatus", () => {
  it("keeps enabled jobs retryable after a run completes", () => {
    expect(getPostRunJobStatus("active")).toBe("active");
    expect(getPostRunJobStatus("error")).toBe("active");
  });

  it("keeps inactive manually-run jobs inactive", () => {
    expect(getPostRunJobStatus("inactive")).toBe("inactive");
  });
});
