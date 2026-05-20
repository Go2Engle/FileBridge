import type { Job } from "@/lib/db/schema";

export function getPostRunJobStatus(previousStatus: Job["status"]): "active" | "inactive" {
  return previousStatus === "inactive" ? "inactive" : "active";
}
