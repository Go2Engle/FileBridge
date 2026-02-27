import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const GITHUB_REPO = "Go2Engle/FileBridge";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const ALLOWED_DOWNLOAD_PREFIX = `https://github.com/${GITHUB_REPO}/releases/download/`;

/**
 * Build the download URL for a release artifact.
 * @param tagName - e.g. "v0.6.0"
 * @param platformArch - FILEBRIDGE_ARCH value, e.g. "linux-amd64", "windows-amd64"
 */
function getArtifactUrl(tagName: string, platformArch: string): string {
  const ext = platformArch.startsWith("windows") ? "zip" : "tar.gz";
  return `${ALLOWED_DOWNLOAD_PREFIX}${tagName}/filebridge-${tagName}-${platformArch}.${ext}`;
}

/** Validate that a URL is a legitimate FileBridge release download. */
function isValidArtifactUrl(url: string): boolean {
  return (
    url.startsWith(ALLOWED_DOWNLOAD_PREFIX) &&
    /^https:\/\/github\.com\/Go2Engle\/FileBridge\/releases\/download\/v[\d.]+\/filebridge-v[\d.]+-[a-z]+-[a-z0-9]+(\.tar\.gz|\.zip)$/.test(url)
  );
}

export async function POST() {
  const result = await requireRole("admin");
  if ("error" in result) return result.error;

  const installType = process.env.FILEBRIDGE_INSTALL_TYPE ?? "manual";

  if (installType === "docker") {
    return NextResponse.json(
      { error: "In-app updates are not available for Docker installs. Pull the latest image instead." },
      { status: 400 }
    );
  }

  if (installType === "manual") {
    return NextResponse.json(
      { error: "In-app updates are only available for native installs. Download the latest release from GitHub." },
      { status: 400 }
    );
  }

  // Check for active job runs
  const activeRuns = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(eq(jobRuns.status, "running"));

  if (activeRuns.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot update while ${activeRuns.length} transfer${activeRuns.length === 1 ? " is" : "s are"} running. Wait for them to finish and try again.`,
        activeRunCount: activeRuns.length,
      },
      { status: 409 }
    );
  }

  // Fetch latest release info from GitHub
  let tagName: string;
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const data = await res.json();
    tagName = data.tag_name as string;
    if (!tagName) throw new Error("No tag_name in GitHub response");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch latest release info: ${message}` },
      { status: 502 }
    );
  }

  // FILEBRIDGE_ARCH is set by install scripts as e.g. "linux-amd64", "darwin-arm64", "windows-amd64"
  const os = process.env.FILEBRIDGE_OS ?? process.platform;
  const defaultArch = `${os}-${process.arch === "x64" ? "amd64" : process.arch}`;
  const platformArch = process.env.FILEBRIDGE_ARCH ?? defaultArch;
  const artifactUrl = getArtifactUrl(tagName, platformArch);

  if (!isValidArtifactUrl(artifactUrl)) {
    return NextResponse.json(
      { error: "Generated artifact URL failed validation. Check FILEBRIDGE_OS and FILEBRIDGE_ARCH." },
      { status: 500 }
    );
  }

  const dataDir = process.env.FILEBRIDGE_DATA_DIR;
  const installDir = process.env.FILEBRIDGE_INSTALL_DIR;

  try {
    if (os === "linux") {
      // Write trigger file — picked up by the filebridge-update.path systemd unit
      if (!dataDir) {
        return NextResponse.json(
          { error: "FILEBRIDGE_DATA_DIR is not set. Reinstall FileBridge using the latest install.sh." },
          { status: 500 }
        );
      }
      const triggerPath = path.join(dataDir, ".update-trigger");
      fs.writeFileSync(triggerPath, artifactUrl, { mode: 0o644 });
    } else if (os === "darwin") {
      // Spawn upgrade helper via sudo (NOPASSWD entry created by install.sh)
      if (!installDir) {
        return NextResponse.json(
          { error: "FILEBRIDGE_INSTALL_DIR is not set. Reinstall FileBridge using the latest install.sh." },
          { status: 500 }
        );
      }
      const helperPath = path.join(installDir, "upgrade-helper.sh");
      const child = spawn("sudo", [helperPath, artifactUrl], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else if (os === "windows") {
      // Write trigger file then invoke the scheduled task
      if (!dataDir) {
        return NextResponse.json(
          { error: "FILEBRIDGE_DATA_DIR is not set. Reinstall FileBridge using the latest install.ps1." },
          { status: 500 }
        );
      }
      const triggerPath = path.join(dataDir, ".update-trigger");
      fs.writeFileSync(triggerPath, artifactUrl, { mode: 0o644 });

      const child = spawn("schtasks.exe", ["/run", "/tn", "FileBridgeUpdater"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } else {
      return NextResponse.json(
        { error: `Unsupported OS: ${os}` },
        { status: 400 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to initiate update: ${message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "Update initiated — the service will restart in approximately 30 seconds.",
    version: tagName,
  });
}
