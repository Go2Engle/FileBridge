import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/users", () => ({
  isFirstRun: vi.fn(),
}));

import { GET } from "@/app/api/setup/status/route";
import { isFirstRun } from "@/lib/db/users";

describe("GET /api/setup/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns needsSetup=true when no users exist", async () => {
    vi.mocked(isFirstRun).mockReturnValue(true);
    const res = await GET();
    const body = await res.json();
    expect(body.needsSetup).toBe(true);
  });

  it("returns needsSetup=false after setup is complete", async () => {
    vi.mocked(isFirstRun).mockReturnValue(false);
    const res = await GET();
    const body = await res.json();
    expect(body.needsSetup).toBe(false);
  });

  it("returns needsSetup=true if isFirstRun throws", async () => {
    vi.mocked(isFirstRun).mockImplementation(() => {
      throw new Error("DB not ready");
    });
    const res = await GET();
    const body = await res.json();
    expect(body.needsSetup).toBe(true);
  });
});
