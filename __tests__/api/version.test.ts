import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the /api/version route.
 *
 * compareSemver is a module-private function; we validate its behavior
 * indirectly by calling the GET handler with different mocked GitHub responses.
 */

// Must mock before importing the route handler so the module sees the mock
vi.mock("@/package.json", () => ({ default: { version: "1.2.0" } }));

// Helpers to create a fake fetch response
function mockFetchOk(tagName: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tag_name: tagName }),
  } as unknown as Response);
}

function mockFetchFail() {
  return vi.fn().mockRejectedValue(new Error("network error"));
}

describe("GET /api/version", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns current version from package.json", async () => {
    vi.stubGlobal("fetch", mockFetchFail()); // offline — no latest
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.currentVersion).toBe("1.2.0");
  });

  it("reports updateAvailable=false when already on latest", async () => {
    vi.stubGlobal("fetch", mockFetchOk("v1.2.0"));
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.updateAvailable).toBe(false);
    expect(body.latestVersion).toBe("1.2.0");
  });

  it("reports updateAvailable=true when a newer version exists", async () => {
    vi.stubGlobal("fetch", mockFetchOk("v1.3.0"));
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.updateAvailable).toBe(true);
    expect(body.latestVersion).toBe("1.3.0");
  });

  it("reports updateAvailable=false when running a newer version (e.g. pre-release)", async () => {
    vi.stubGlobal("fetch", mockFetchOk("v1.1.9"));
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.updateAvailable).toBe(false);
  });

  it("handles GitHub API failure gracefully", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.currentVersion).toBe("1.2.0");
    expect(body.latestVersion).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });

  it("handles non-ok GitHub API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false } as unknown as Response)
    );
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.latestVersion).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });

  it("includes the GitHub releases URL", async () => {
    vi.stubGlobal("fetch", mockFetchFail());
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    const body = await res.json();
    expect(body.releasesUrl).toContain("github.com");
    expect(body.releasesUrl).toContain("Go2Engle/FileBridge");
  });
});
