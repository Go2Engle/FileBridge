import { NextResponse } from "next/server";
import { getAllSsoConfigs } from "@/lib/db/sso-config";

const PROVIDER_NAMES: Record<string, string> = {
  "azure-ad": "Microsoft",
  github: "GitHub",
};

export async function GET() {
  try {
    const configs = getAllSsoConfigs();
    const providers = configs
      .filter((c) => c.config.enabled)
      .map((c) => ({
        id: c.provider,
        name: PROVIDER_NAMES[c.provider] ?? c.provider,
      }));
    return NextResponse.json(providers);
  } catch {
    return NextResponse.json([]);
  }
}
