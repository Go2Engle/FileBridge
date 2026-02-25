import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import pkg from "@/package.json";

const GITHUB_REPO = "Go2Engle/FileBridge";
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

function getInstalledVersion(): string {
  try {
    return readFileSync(join(process.cwd(), "FILEBRIDGE_VERSION"), "utf-8")
      .trim()
      .replace(/^v/, "");
  } catch {
    // FILEBRIDGE_VERSION not present (Docker or dev) — fall back to build-time value
    return pkg.version;
  }
}

export async function GET() {
  const currentVersion = getInstalledVersion();
  let latestVersion: string | null = null;
  let updateAvailable = false;

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github.v3+json" },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (res.ok) {
      const data = await res.json();
      latestVersion = (data.tag_name as string)?.replace(/^v/, "") ?? null;
      if (latestVersion) {
        updateAvailable = compareSemver(latestVersion, currentVersion) > 0;
      }
    }
  } catch {
    // Version check is non-critical; silently fail
  }

  return NextResponse.json({
    currentVersion,
    latestVersion,
    updateAvailable,
    releasesUrl: RELEASES_PAGE,
  });
}
