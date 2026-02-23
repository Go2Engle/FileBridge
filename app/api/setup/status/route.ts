import { NextResponse } from "next/server";
import { isFirstRun } from "@/lib/db/users";

export async function GET() {
  try {
    const needsSetup = isFirstRun();
    return NextResponse.json({ needsSetup });
  } catch {
    return NextResponse.json({ needsSetup: true });
  }
}
