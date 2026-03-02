import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRole } from "@/hooks/use-role";

const mockUseSession = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

type MockSessionReturn =
  | { data: null; status: "unauthenticated" }
  | { data: { user: { role: "admin" | "viewer"; email: string }; expires: string }; status: "authenticated" };

describe("useRole()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role='viewer' and isAdmin=false when there is no session", () => {
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" } satisfies MockSessionReturn);
    const { result } = renderHook(() => useRole());
    expect(result.current.role).toBe("viewer");
    expect(result.current.isAdmin).toBe(false);
  });

  it("returns role='admin' and isAdmin=true for an admin user", () => {
    mockUseSession.mockReturnValue({
      data: { user: { role: "admin", email: "admin@example.com" }, expires: "2099-01-01" },
      status: "authenticated",
    } satisfies MockSessionReturn);
    const { result } = renderHook(() => useRole());
    expect(result.current.role).toBe("admin");
    expect(result.current.isAdmin).toBe(true);
  });

  it("returns role='viewer' and isAdmin=false for a viewer user", () => {
    mockUseSession.mockReturnValue({
      data: { user: { role: "viewer", email: "viewer@example.com" }, expires: "2099-01-01" },
      status: "authenticated",
    } satisfies MockSessionReturn);
    const { result } = renderHook(() => useRole());
    expect(result.current.role).toBe("viewer");
    expect(result.current.isAdmin).toBe(false);
  });

  it("defaults to 'viewer' when session exists but role is undefined", () => {
    mockUseSession.mockReturnValue({
      data: { user: {}, expires: "2099-01-01" },
      status: "authenticated",
    });
    const { result } = renderHook(() => useRole());
    expect(result.current.role).toBe("viewer");
    expect(result.current.isAdmin).toBe(false);
  });
});
