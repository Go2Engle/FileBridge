"use client";

import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export type TimeFormat = "12h" | "24h";

export const TIME_FORMATS = {
  "12h": { short: "h:mm a", withSec: "h:mm:ss a" },
  "24h": { short: "HH:mm", withSec: "HH:mm:ss" },
} as const;

export function useTimeFormat(): TimeFormat {
  const { data } = useQuery<{ timeFormat: TimeFormat }>({
    queryKey: ["settings", "display"],
    queryFn: () => axios.get("/api/settings/display").then((r) => r.data),
    staleTime: 60_000,
  });
  return data?.timeFormat ?? "24h";
}
