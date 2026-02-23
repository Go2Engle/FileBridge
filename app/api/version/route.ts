import { NextResponse } from "next/server";
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

export async function GET() {
  const currentVersion = pkg.version;
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
