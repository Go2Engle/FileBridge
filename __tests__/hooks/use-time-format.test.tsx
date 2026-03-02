import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useTimeFormat } from "@/hooks/use-time-format";

// Mock axios
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from "axios";

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryClientWrapper";
  return Wrapper;
}

describe("useTimeFormat()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns '24h' as the default before data loads", () => {
    // Return a promise that never resolves so we can check the loading state
    vi.mocked(axios.get).mockReturnValue(new Promise(() => {}) as never);
    const { result } = renderHook(() => useTimeFormat(), { wrapper: createWrapper() });
    expect(result.current).toBe("24h");
  });

  it("returns '12h' when the API returns 12h format", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { timeFormat: "12h" } });
    const { result } = renderHook(() => useTimeFormat(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("12h"));
  });

  it("returns '24h' when the API returns 24h format", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { timeFormat: "24h" } });
    const { result } = renderHook(() => useTimeFormat(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe("24h"));
  });

  it("falls back to '24h' when the API request fails", async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useTimeFormat(), { wrapper: createWrapper() });
    // On error, data is undefined so the default '24h' is returned
    await waitFor(() => expect(result.current).toBe("24h"));
  });

  it("calls the correct API endpoint", async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { timeFormat: "12h" } });
    renderHook(() => useTimeFormat(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith("/api/settings/display");
    });
  });
});
