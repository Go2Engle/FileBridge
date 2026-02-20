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
   */
  private static readonly AUTO_CLOSE_MS = 2000;

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
   * Wait until the library's auto-close mechanism has had time to fire since
   * the last readFile call.
   *
   * With autoCloseTimeout set, v9u-smb2 will, after AUTO_CLOSE_MS of idleness:
   *   1. Send SMB2 CLOSE for every open FID
   *   2. Send TREE_DISCONNECT + SESSION_LOGOFF
   *   3. Close the TCP socket
   *
   * This is the only reliable way to release server-side file handles without
   * closing the connection manually (which doesn't consistently send CLOSE PDUs).
   * We add a small margin so the server has time to process the LOGOFF.
   */
  private async waitForHandleRelease(): Promise<void> {
    if (this.lastDownloadAt === 0) return;
    const elapsed = Date.now() - this.lastDownloadAt;
    const target = SmbProvider.AUTO_CLOSE_MS + 500; // 500ms margin after auto-close
    const remaining = target - elapsed;
    if (remaining > 0) {
      console.log(`[SMB] Waiting ${remaining}ms for server to release file handles (auto-close)...`);
      await new Promise((r) => setTimeout(r, remaining));
    }
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
    try {
      const data = await this.readFileAsync(smbPath);
      // Record when the read completed so waitForHandleRelease() knows how long
      // to wait before any subsequent delete/move on this connection.
      this.lastDownloadAt = Date.now();
      return data;
    } catch (err) {
      console.error(`[SMB] downloadFile FAILED for "${smbPath}":`, err);
      throw err;
    }
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] uploadFile "${smbPath}" (${content.length}B)`);
    try {
      await this.writeFileAsync(smbPath, content);
    } catch (err) {
      console.error(`[SMB] uploadFile FAILED for "${smbPath}":`, err);
      throw err;
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    // Wait for the library's auto-close to have fired so all FIDs from any
    // recent readFile are cleanly closed on the server before we try to unlink.
    await this.waitForHandleRelease();
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] deleteFile "${smbPath}"`);
    // Retry on STATUS_PENDING (transient server state, distinct from handle issues).
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.unlinkAsync(smbPath);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_PENDING" && attempt < 5) {
          const delay = attempt * 2000;
          console.log(`[SMB] deleteFile "${smbPath}": STATUS_PENDING, retrying in ${delay / 1000}s (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    // Wait for the library's auto-close to have fired so all FIDs from any
    // recent readFile are cleanly closed on the server before we try to rename.
    await this.waitForHandleRelease();
    const smbSrc = this.toSmbPath(sourcePath);
    const smbDst = this.toSmbPath(destinationPath);
    console.log(`[SMB] moveFile "${smbSrc}" → "${smbDst}"`);
    // Retry on STATUS_PENDING (transient server state, distinct from handle issues).
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await this.renameAsync(smbSrc, smbDst);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_PENDING" && attempt < 5) {
          const delay = attempt * 2000;
          console.log(`[SMB] moveFile "${smbSrc}": STATUS_PENDING, retrying in ${delay / 1000}s (attempt ${attempt}/4)...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }
}
