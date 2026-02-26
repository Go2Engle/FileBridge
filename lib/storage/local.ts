import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";
import path from "path";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";
import { createLogger } from "@/lib/logger";

const log = createLogger("local");

export class LocalProvider implements StorageProvider {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Resolve a remote path against the basePath, preventing directory traversal.
   * Incoming paths are treated as relative to basePath regardless of leading slash.
   */
  private resolvePath(remotePath: string): string {
    const normalized = remotePath.replace(/^\/+/, "");
    const resolved = path.resolve(this.basePath, normalized);
    const normalizedBase = path.resolve(this.basePath);
    if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
      throw new Error(`Path traversal detected: ${remotePath}`);
    }
    return resolved;
  }

  async connect(): Promise<void> {
    log.info("Connecting", { basePath: this.basePath });
    try {
      const stat = await fs.stat(this.basePath);
      if (!stat.isDirectory()) {
        throw new Error(`Base path is not a directory: ${this.basePath}`);
      }
      log.info("Connected", { basePath: this.basePath });
    } catch (err) {
      log.error("Connection failed", { basePath: this.basePath, error: err });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    log.info("Disconnected", { basePath: this.basePath });
  }

  async listFiles(remotePath: string, filter = ""): Promise<FileInfo[]> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Listing files", { fullPath, filter });
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const regex = globToRegex(filter);
      const results = await Promise.all(
        entries
          .filter((e) => e.isFile() && regex.test(e.name))
          .map(async (e) => {
            const stat = await fs.stat(path.join(fullPath, e.name));
            return {
              name: e.name,
              size: stat.size,
              modifiedAt: stat.mtime,
              isDirectory: false,
            };
          })
      );
      log.info("Files listed", { fullPath, matched: results.length });
      return results;
    } catch (err) {
      log.error("listFiles failed", { fullPath, error: err });
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Listing directory", { fullPath });
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const results = await Promise.all(
        entries
          .filter((e) => e.isFile() || e.isDirectory())
          .map(async (e) => {
            const stat = await fs.stat(path.join(fullPath, e.name));
            return {
              name: e.name,
              size: stat.size,
              modifiedAt: stat.mtime,
              isDirectory: e.isDirectory(),
            };
          })
      );
      log.info("Directory listed", { fullPath, entryCount: results.length });
      return results;
    } catch (err) {
      log.error("listDirectory failed", { fullPath, error: err });
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Readable> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Downloading file (stream)", { fullPath });
    return createReadStream(fullPath);
  }

  async uploadFile(stream: Readable, remotePath: string, _sizeHint?: number): Promise<void> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Uploading file (stream)", { fullPath });
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await pipeline(stream, createWriteStream(fullPath));
    } catch (err) {
      log.error("uploadFile failed", { fullPath, error: err });
      throw err;
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Deleting file", { fullPath });
    try {
      await fs.unlink(fullPath);
    } catch (err) {
      log.error("deleteFile failed", { fullPath, error: err });
      throw err;
    }
  }

  async createDirectory(remotePath: string): Promise<void> {
    const fullPath = this.resolvePath(remotePath);
    log.info("Creating directory", { fullPath });
    try {
      await fs.mkdir(fullPath, { recursive: false });
    } catch (err) {
      log.error("createDirectory failed", { fullPath, error: err });
      throw err;
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const src = this.resolvePath(sourcePath);
    const dst = this.resolvePath(destinationPath);
    log.info("Moving file", { src, dst });
    try {
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.rename(src, dst);
    } catch (err: unknown) {
      // Cross-device rename fails with EXDEV — fall back to copy + delete
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        log.info("EXDEV on move — falling back to copy+delete", { src, dst });
        await fs.copyFile(src, dst);
        await fs.unlink(src);
        return;
      }
      log.error("moveFile failed", { src, dst, error: err });
      throw err;
    }
  }
}
