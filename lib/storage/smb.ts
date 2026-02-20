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
        autoCloseTimeout: 0,
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
      return await this.readFileAsync(smbPath);
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
    const smbPath = this.toSmbPath(remotePath);
    console.log(`[SMB] deleteFile "${smbPath}"`);
    // Retry with backoff — SMB can return STATUS_PENDING if the file
    // handle from a recent read hasn't been fully released yet.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.unlinkAsync(smbPath);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_PENDING" && attempt < 3) {
          console.log(`[SMB] deleteFile "${smbPath}": STATUS_PENDING, retrying in ${attempt}s...`);
          await new Promise((r) => setTimeout(r, attempt * 1000));
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
    // Retry with backoff — SMB can return STATUS_PENDING if the file
    // handle from a recent read hasn't been fully released yet.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.renameAsync(smbSrc, smbDst);
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "STATUS_PENDING" && attempt < 3) {
          console.log(`[SMB] moveFile "${smbSrc}": STATUS_PENDING, retrying in ${attempt}s...`);
          await new Promise((r) => setTimeout(r, attempt * 1000));
          continue;
        }
        throw err;
      }
    }
  }
}
