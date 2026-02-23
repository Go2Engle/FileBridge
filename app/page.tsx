import { redirect } from "next/navigation";
import { isFirstRun } from "@/lib/db/users";

export default function RootPage() {
  if (isFirstRun()) {
    redirect("/setup");
  }
  redirect("/dashboard");
}
