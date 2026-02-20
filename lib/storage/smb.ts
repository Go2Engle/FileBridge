import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";

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
 * SMB paths use backslashes and are relative to the share root — the root itself
 * is represented as "" (empty string), not "/". All incoming Unix-style paths are
 * converted with toSmbPath() before being passed to the library.
 */
export class SmbProvider implements StorageProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private credentials: SmbCredentials;
  private host: string;
  /**
   * Timestamp (ms) of the last completed readFile call.
   * Used to ensure the library's auto-close has had time to fire — and with it,
   * properly send CLOSE PDUs for all open FIDs — before we attempt destructive
   * operations (delete / move) on the same file.
   */
  private lastDownloadAt = 0;
  /**
   * The library closes idle connections after this many ms of inactivity.
   * When it fires it properly sends CLOSE for every open FID, then TREE_DISCONNECT,
   * then SESSION_LOGOFF, then drops the TCP socket — releasing all server-side
   * handles. Must be kept in sync with the autoCloseTimeout value in connect().
   * Kept short so the handles are released quickly after a readFile, avoiding
   * long waits before destructive operations (delete / move).
   */
  private static readonly AUTO_CLOSE_MS = 100;

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

  private readdirAsync(smbPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.readdir(smbPath, (err: any, files: string[]) => {
        if (err) reject(err);
        else resolve(files ?? []);
      });
    });
  }

  private readFileAsync(smbPath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.readFile(smbPath, (err: any, data: Buffer) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  private writeFileAsync(smbPath: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.writeFile(smbPath, data, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private unlinkAsync(smbPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.client.unlink(smbPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
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

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * On STATUS_SHARING_VIOLATION, compute how long to wait before retrying so
   * that the auto-close timeout has had time to fire from the last readFile.
   * Auto-close sends proper SMB2 CLOSE PDUs for every open FID, releasing
   * server-side handles. The library then auto-reconnects on the next call.
   */
  private sharingViolationWaitMs(): number {
    const elapsed = this.lastDownloadAt > 0 ? Date.now() - this.lastDownloadAt : 0;
    // Add 200ms margin for server-side processing after the CLOSE PDUs are sent.
    return Math.max(200, SmbProvider.AUTO_CLOSE_MS + 200 - elapsed);
  }

  /**
   * Tear down and re-establish the SMB client.
   * Used when STATUS_FILE_CLOSED is returned, indicating the library's internal
   * session state is stale (auto-close fired during a long operation like extracting
   * an archive + uploading 100+ files). A fresh client resolves this immediately.
   */
  private async reconnect(): Promise<void> {
    console.log(`[SMB] Reconnecting to ${this.host} to reset stale session state...`);
    await this.disconnect();
    await this.connect();
  }

  // ── StorageProvider implementation ────────────────────────────────────────

  async connect(): Promise<void> {
    const share = `\\\\${this.host}\\${this.credentials.share}`;
    console.log(
      `[SMB] Creating client for ${share} as "${this.credentials.username}" ` +
      `domain="${this.credentials.domain || "(empty — local/NAS account)"}"`
    );
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const SMB2 = require("v9u-smb2");
      this.client = new SMB2({
        share,
        // Empty string = local/NAS account (no domain). Only pass a domain if explicitly set.
        domain: this.credentials.domain || "",
        username: this.credentials.username,
        password: this.credentials.password,
        // Non-zero so the library properly closes FIDs + TCP after this many ms idle.
        // Must stay in sync with SmbProvider.AUTO_CLOSE_MS.
        autoCloseTimeout: SmbProvider.AUTO_CLOSE_MS,
      });
      console.log(`[SMB] Client ready for ${share} (actual TCP handshake happens on first operation)`);
    } catch (err) {
      console.error(`[SMB] Failed to create client for ${share}:`, err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        // close() can throw if authentication never completed and internal state is uninitialized
        this.client.close();
        console.log(`[SMB] Disconnected from ${this.host}`);
      } catch {
        // Silently ignore — happens when auth failed before a session was established
      } finally {
        this.client = null;
      }
    }
  }

  async listFiles(remotePath: string, filter = "*"): Promise<FileInfo[]> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] listFiles "${smbPath}" (unix: "${remotePath}") filter="${filter}"`);
    try {
      const files = await this.readdirAsync(smbPath);
      const regex = globToRegex(filter);
      const filtered = files
        // SMB readdir returns directory names too — filter them out using
        // the same extension heuristic as listDirectory (entries without a
        // file extension are treated as directories).
        .filter((name) => /\.[a-zA-Z0-9]{1,8}$/.test(name))
        .filter((name) => regex.test(name))
        .map((name) => ({
          name,
          size: 0,
          modifiedAt: new Date(),
          isDirectory: false,
        }));
      console.log(`[SMB] listFiles "${smbPath}": ${files.length} total, ${filtered.length} matched filter`);
      return filtered;
    } catch (err) {
      console.error(`[SMB] listFiles FAILED for "${smbPath}":`, err);
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] listDirectory "${smbPath}" (unix: "${remotePath}")`);
    try {
      const names = await this.readdirAsync(smbPath);
      console.log(`[SMB] listDirectory "${smbPath}": ${names.length} entries`);
      // Heuristic: names without a short file extension are treated as directories.
      return names.map((name) => ({
        name,
        size: 0,
        modifiedAt: new Date(),
        isDirectory: !/\.[a-zA-Z0-9]{1,8}$/.test(name),
      }));
    } catch (err) {
      console.error(`[SMB] listDirectory FAILED for "${smbPath}":`, err);
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Buffer> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] downloadFile "${smbPath}"`);
    // Retry on ERR_STREAM_WRITE_AFTER_END / STATUS_FILE_CLOSED: auto-close fired
    // while the connection was idle; reconnect creates a fresh session.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const data = await this.readFileAsync(smbPath);
        // Record when the read completed so sharingViolationWaitMs() knows how
        // long to wait before any subsequent delete/move on this connection.
        this.lastDownloadAt = Date.now();
        return data;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isStaleSession =
          code === "STATUS_FILE_CLOSED" ||
          code === "ERR_STREAM_WRITE_AFTER_END" ||
          (err instanceof Error && err.message?.includes("write after end"));
        if (isStaleSession && attempt < 3) {
          console.log(`[SMB] downloadFile "${smbPath}": session expired (${code}), reconnecting (attempt ${attempt}/2)...`);
          await this.reconnect();
          continue;
        }
        console.error(`[SMB] downloadFile FAILED for "${smbPath}":`, err);
        throw err;
      }
    }
    // Unreachable, but satisfies TypeScript
    throw new Error("[SMB] downloadFile: exceeded retry limit");
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] uploadFile "${smbPath}" (${content.length}B)`);
    // Retry on ERR_STREAM_WRITE_AFTER_END / STATUS_FILE_CLOSED: auto-close fired
    // while the SMB connection was idle (e.g. during a long SFTP extraction loop);
    // reconnect creates a fresh session and the upload succeeds immediately.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.writeFileAsync(smbPath, content);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const isStaleSession =
          code === "STATUS_FILE_CLOSED" ||
          code === "ERR_STREAM_WRITE_AFTER_END" ||
          (err instanceof Error && err.message?.includes("write after end"));
        if (isStaleSession && attempt < 3) {
          console.log(`[SMB] uploadFile "${smbPath}": session expired (${code}), reconnecting (attempt ${attempt}/2)...`);
          await this.reconnect();
          continue;
        }
        console.error(`[SMB] uploadFile FAILED for "${smbPath}":`, err);
        throw err;
      }
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] deleteFile "${smbPath}"`);
    // Try immediately — no proactive wait. Handle errors reactively:
    //   STATUS_FILE_CLOSED:      auto-close fired during a long inter-operation gap
    //                            (e.g. extracting a large ZIP + uploading many files);
    //                            reconnect to get a fresh session, then retry.
    //   STATUS_SHARING_VIOLATION: our FID is still open on the server; wait for
    //                            auto-close to send proper CLOSE PDUs, then retry.
    //   STATUS_PENDING:          transient server state; short backoff, then retry.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.unlinkAsync(smbPath);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_FILE_CLOSED" && attempt < 5) {
          console.log(`[SMB] deleteFile "${smbPath}": STATUS_FILE_CLOSED (session expired), reconnecting (attempt ${attempt}/4)...`);
          await this.reconnect();
          continue;
        }
        if (code === "STATUS_SHARING_VIOLATION" && attempt < 5) {
          const waitMs = this.sharingViolationWaitMs();
          console.log(`[SMB] deleteFile "${smbPath}": STATUS_SHARING_VIOLATION, waiting ${waitMs}ms for auto-close (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (code === "STATUS_PENDING" && attempt < 5) {
          const delay = attempt * 1000;
          console.log(`[SMB] deleteFile "${smbPath}": STATUS_PENDING, retrying in ${delay / 1000}s (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const smbSrc = this.toSmbPath(sourcePath);
    const smbDst = this.toSmbPath(destinationPath);
    console.log(`[SMB] moveFile "${smbSrc}" → "${smbDst}"`);
    // Try immediately — no proactive wait. Handle errors reactively:
    //   STATUS_FILE_CLOSED:      auto-close fired during a long inter-operation gap;
    //                            reconnect to get a fresh session, then retry.
    //   STATUS_SHARING_VIOLATION: FID still open; wait for auto-close, then retry.
    //   STATUS_PENDING:          transient server state; short backoff, then retry.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.renameAsync(smbSrc, smbDst);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_FILE_CLOSED" && attempt < 5) {
          console.log(`[SMB] moveFile "${smbSrc}": STATUS_FILE_CLOSED (session expired), reconnecting (attempt ${attempt}/4)...`);
          await this.reconnect();
          continue;
        }
        if (code === "STATUS_SHARING_VIOLATION" && attempt < 5) {
          const waitMs = this.sharingViolationWaitMs();
          console.log(`[SMB] moveFile "${smbSrc}": STATUS_SHARING_VIOLATION, waiting ${waitMs}ms for auto-close (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (code === "STATUS_PENDING" && attempt < 5) {
          const delay = attempt * 1000;
          console.log(`[SMB] moveFile "${smbSrc}": STATUS_PENDING, retrying in ${delay / 1000}s (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }
}
