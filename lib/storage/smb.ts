import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";
import { createLogger } from "@/lib/logger";

const log = createLogger("smb");

export interface SmbCredentials {
  username: string;
  password: string;
  domain?: string;
  share: string;
}

/**
 * SMB/CIFS storage provider using v9u-smb2 (NTLMv2-capable fork of @marsaud/smb2).
 *
 * v9u-smb2 is callback-based so every operation is manually promisified here.
 * Downloads and uploads use the library's createReadStream/createWriteStream
 * for true 64 KB chunk streaming — no full-file buffering, so files of any size
 * can be transferred with constant memory usage.
 *
 * SMB paths use backslashes and are relative to the share root — the root itself
 * is represented as "" (empty string), not "/". All incoming Unix-style paths are
 * converted with toSmbPath() before being passed to the library.
 */
export class SmbProvider implements StorageProvider {
  private static readonly BUFFERED_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private credentials: SmbCredentials;
  private host: string;
  constructor(host: string, _port: number, credentials: SmbCredentials) {
    this.host = host;
    this.credentials = credentials;
  }

  /**
   * Convert a Unix-style absolute path to an SMB-relative path.
   *   "/"           → ""          (share root)
   *   "/foo/bar"    → "foo\\bar"
   */
  private toSmbPath(unixPath: string): string {
    if (!unixPath || unixPath === "/") return "";
    return unixPath.replace(/^\/+/, "").replace(/\//g, "\\");
  }

  // ── Promisified wrappers ──────────────────────────────────────────────────

  private readdirWithStatsAsync(smbPath: string): Promise<Array<{ name: string; size: number; mtime: Date; isDirectory: () => boolean }>> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.readdir(smbPath, { stats: true }, (err: any, files: any[]) => {
        if (err) reject(err);
        else resolve(files ?? []);
      });
    });
  }

  /**
   * Promisified wrapper around v9u-smb2's callback-based createReadStream.
   * Returns a true Node.js Readable that reads from the SMB share in 64 KB
   * chunks — no full-file buffering.
   */
  private createReadStreamAsync(smbPath: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SMB2Request = require("v9u-smb2/lib/tools/smb2-forge").request;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const constants = require("v9u-smb2/lib/structures/constants");

      SMB2Request(
        "create",
        {
          path: smbPath,
          createDisposition: constants.FILE_OPEN,
          shareAccess:
            constants.FILE_SHARE_READ |
            constants.FILE_SHARE_WRITE |
            constants.FILE_SHARE_DELETE,
        },
        this.client,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (openErr: any, file: any) => {
          if (openErr) {
            reject(openErr);
            return;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.client.createReadStream(smbPath, { fd: file }, (streamErr: any, stream: Readable) => {
            if (streamErr) reject(streamErr);
            else resolve(stream);
          });
        }
      );
    });
  }

  /**
   * Promisified wrapper around v9u-smb2's callback-based createWriteStream.
   * Returns a true Node.js Writable that writes to the SMB share in 64 KB
   * chunks — no full-file buffering.
   */
  private createWriteStreamAsync(smbPath: string): Promise<Writable> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.createWriteStream(smbPath, { flags: "w" }, (err: any, stream: Writable) => {
        if (err) reject(err);
        else resolve(stream);
      });
    });
  }

  private writeFileAsync(smbPath: string, content: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.writeFile(smbPath, content, { flags: "w" }, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private unlinkAsync(smbPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SMB2Request = require("v9u-smb2/lib/tools/smb2-forge").request;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const constants = require("v9u-smb2/lib/structures/constants");

      SMB2Request(
        "create",
        {
          path: smbPath,
          shareAccess:
            constants.FILE_SHARE_READ |
            constants.FILE_SHARE_WRITE |
            constants.FILE_SHARE_DELETE,
          createDisposition: constants.FILE_OPEN,
        },
        this.client,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (openErr: any, file: any) => {
          if (openErr) {
            reject(openErr);
            return;
          }

          SMB2Request(
            "set_info",
            {
              FileId: file.FileId,
              FileInfoClass: "FileDispositionInformation",
              Buffer: Buffer.from([1]),
            },
            this.client,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (setInfoErr: any) => {
              SMB2Request("close", file, this.client, () => {
                if (setInfoErr) reject(setInfoErr);
                else resolve();
              });
            }
          );
        }
      );
    });
  }

  private renameAsync(oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.rename(oldPath, newPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private mkdirAsync(smbPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.mkdir(smbPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }


  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Patch a stream's _destroy to suppress STATUS_FILE_CLOSED from v9u-smb2's
   * double-close bug: the stream's EOF/finish handler calls close() on the SMB
   * file handle, then Node.js calls _destroy which calls close() again.
   */
  private patchDestroyForDoubleClose(stream: Readable | Writable): void {
    const origDestroy = stream._destroy?.bind(stream);
    if (!origDestroy) return;
    stream._destroy = (err: Error | null, cb: (err?: Error | null) => void) => {
      origDestroy(err, (destroyErr?: Error | null) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (destroyErr && (destroyErr as any).code === "STATUS_FILE_CLOSED") {
          cb(err); // suppress double-close error, pass through original
        } else {
          cb(destroyErr ?? err);
        }
      });
    };
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Tear down and re-establish the SMB client.
   * Used when STATUS_FILE_CLOSED is returned, indicating the server closed
   * the session (e.g. idle timeout). A fresh client resolves this immediately.
   */
  private async reconnect(): Promise<void> {
    log.info("Reconnecting to reset stale session state", { host: this.host });
    await this.disconnect();
    await this.connect();
  }

  // ── StorageProvider implementation ────────────────────────────────────────

  async connect(): Promise<void> {
    const share = `\\\\${this.host}\\${this.credentials.share}`;
    log.info("Creating SMB client", {
      host: this.host,
      share: this.credentials.share,
      username: this.credentials.username,
      domain: this.credentials.domain || "(local/NAS account)",
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SMB2 = require("v9u-smb2");
      this.client = new SMB2({
        share,
        // Empty string = local/NAS account (no domain). Only pass a domain if explicitly set.
        domain: this.credentials.domain || "",
        username: this.credentials.username,
        password: this.credentials.password,
        // Disabled (0) so the connection stays alive during streaming transfers.
        // The engine calls disconnect() when the job completes.
        autoCloseTimeout: 0,
      });
      log.info("SMB client ready (TCP handshake deferred to first operation)", { host: this.host });
    } catch (err) {
      log.error("Failed to create SMB client", { host: this.host, error: err });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        // close() can throw if authentication never completed and internal state is uninitialized
        this.client.close();
        log.info("Disconnected", { host: this.host });
      } catch {
        // Silently ignore — happens when auth failed before a session was established
      } finally {
        this.client = null;
      }
    }
  }

  async listFiles(remotePath: string, filter = ""): Promise<FileInfo[]> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Listing files", { smbPath, remotePath, filter });
    try {
      const entries = await this.readdirWithStatsAsync(smbPath);
      const regex = globToRegex(filter);
      const filtered = entries
        .filter((e) => !e.isDirectory() && regex.test(e.name))
        .map((e) => ({
          name: e.name,
          size: e.size,
          modifiedAt: new Date(e.mtime),
          isDirectory: false,
        }));
      log.info("Files listed", { smbPath, total: entries.length, matched: filtered.length });
      return filtered;
    } catch (err) {
      log.error("listFiles failed", { smbPath, error: err });
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Listing directory", { smbPath, remotePath });
    try {
      const entries = await this.readdirWithStatsAsync(smbPath);
      log.info("Directory listed", { smbPath, entryCount: entries.length });
      return entries.map((e) => ({
        name: e.name,
        size: e.size,
        modifiedAt: new Date(e.mtime),
        isDirectory: e.isDirectory(),
      }));
    } catch (err) {
      log.error("listDirectory failed", { smbPath, error: err });
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Readable> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Downloading file (stream)", { smbPath });
    // Retry on STATUS_FILE_CLOSED / ERR_STREAM_WRITE_AFTER_END: the server
    // may have closed the session while idle; reconnect creates a fresh one.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const stream = await this.createReadStreamAsync(smbPath);
        this.patchDestroyForDoubleClose(stream);
        return stream;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isStaleSession =
          code === "STATUS_FILE_CLOSED" ||
          code === "ERR_STREAM_WRITE_AFTER_END" ||
          (err instanceof Error && err.message?.includes("write after end"));
        if (isStaleSession && attempt < 3) {
          log.info("Session expired during download — reconnecting", { smbPath, code, attempt });
          await this.reconnect();
          continue;
        }
        log.error("downloadFile failed", { smbPath, error: err });
        throw err;
      }
    }
    // Unreachable, but satisfies TypeScript
    throw new Error("[SMB] downloadFile: exceeded retry limit");
  }

  async uploadFile(stream: Readable, remotePath: string, sizeHint?: number): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Uploading file (stream)", { smbPath });

    if (typeof sizeHint === "number" && sizeHint <= SmbProvider.BUFFERED_UPLOAD_MAX_BYTES) {
      const content = await this.streamToBuffer(stream);
      if (content.length !== sizeHint) {
        throw new Error(`SMB buffered upload byte mismatch: expected ${sizeHint}, got ${content.length}`);
      }
      await this.writeFileAsync(smbPath, content);
      return;
    }

    // Retry only the stream establishment — once pipeline starts, the source
    // stream is consumed and cannot be replayed.
    let dest!: Writable;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        dest = await this.createWriteStreamAsync(smbPath);
        break;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isStaleSession =
          code === "STATUS_FILE_CLOSED" ||
          code === "ERR_STREAM_WRITE_AFTER_END" ||
          (err instanceof Error && err.message?.includes("write after end"));
        if (isStaleSession && attempt < 3) {
          log.info("Session expired before upload — reconnecting", { smbPath, code, attempt });
          await this.reconnect();
          continue;
        }
        log.error("uploadFile failed", { smbPath, error: err });
        throw err;
      }
    }
    this.patchDestroyForDoubleClose(dest);
    await pipeline(stream, dest);
  }

  async deleteFile(remotePath: string): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Deleting file", { smbPath });
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.unlinkAsync(smbPath);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_FILE_CLOSED" && attempt < maxAttempts) {
          log.info("STATUS_FILE_CLOSED on delete — reconnecting", { smbPath, attempt });
          await this.reconnect();
          continue;
        }
        if (code === "STATUS_SHARING_VIOLATION" && attempt < maxAttempts) {
          const waitMs = Math.min(500 * 2 ** (attempt - 1), 5000);
          log.info("STATUS_SHARING_VIOLATION on delete — waiting for handle release", { smbPath, waitMs, attempt });
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (code === "STATUS_PENDING" && attempt < maxAttempts) {
          const delayMs = Math.min(500 * attempt, 5000);
          log.info("STATUS_PENDING on delete — retrying", { smbPath, delayMs, attempt });
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        log.warn("Delete file retries exhausted", { smbPath, attempt, code });
        throw err;
      }
    }
  }

  async createDirectory(remotePath: string): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    log.info("Creating directory", { smbPath });
    try {
      await this.mkdirAsync(smbPath);
    } catch (err) {
      log.error("createDirectory failed", { smbPath, error: err });
      throw err;
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const smbSrc = this.toSmbPath(sourcePath);
    const smbDst = this.toSmbPath(destinationPath);
    log.info("Moving file", { smbSrc, smbDst });
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.renameAsync(smbSrc, smbDst);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_FILE_CLOSED" && attempt < 5) {
          log.info("STATUS_FILE_CLOSED on move — reconnecting", { smbSrc, attempt });
          await this.reconnect();
          continue;
        }
        if (code === "STATUS_SHARING_VIOLATION" && attempt < 5) {
          const waitMs = 500;
          log.info("STATUS_SHARING_VIOLATION on move — waiting for handle release", { smbSrc, waitMs, attempt });
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (code === "STATUS_PENDING" && attempt < 5) {
          const delay = attempt * 1000;
          log.info("STATUS_PENDING on move — retrying", { smbSrc, delayMs: delay, attempt });
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }
}
