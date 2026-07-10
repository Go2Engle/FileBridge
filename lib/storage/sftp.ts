import SftpClient from "ssh2-sftp-client";
import type { Readable } from "stream";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("sftp");

// ── SFTP performance tuning ──────────────────────────────────────────────────
// These values match what modern SFTP clients (WinSCP, FileZilla) use for
// large-file transfers. The defaults in ssh2-sftp-client are conservatively
// low (~32 KB chunks, ~few concurrent requests) which causes poor throughput.
const SFTP_CHUNK_SIZE = 256 * 1024;        // 256 KB per SFTP read/write request
const SFTP_CONCURRENT_REQUESTS = 16;       // pipelined in-flight requests

// ── Dead-connection protection ───────────────────────────────────────────────
// ssh2 sends no keepalives by default, so a NAT/firewall silently dropping an
// idle connection (common while a job is busy uploading to the other side of
// the transfer) leaves a half-open socket: SFTP requests are written into the
// void and their callbacks never fire, hanging the awaiting job forever.
// Keepalive probes detect a dead peer within ~30 s and error the connection,
// which rejects in-flight operations.
const SFTP_KEEPALIVE_INTERVAL_MS = 10_000;
const SFTP_KEEPALIVE_COUNT_MAX = 3;
// Backstop for quick (non-streaming) operations in case the connection dies in
// a way keepalive doesn't surface. Streaming transfers are NOT wrapped — they
// can legitimately run for hours and are covered by the engine's idle monitor.
const SFTP_OP_TIMEOUT_MS = 60_000;
const SFTP_DISCONNECT_TIMEOUT_MS = 15_000;

/**
 * Bound a quick SFTP operation so a dead connection rejects instead of
 * hanging the job forever (mirror of the SMB per-request timeout).
 */
function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: Error & { code?: string } = new Error(
        `SFTP ${label} timed out after ${timeoutMs}ms — connection likely dead`,
      );
      err.code = "SFTP_OP_TIMEOUT";
      reject(err);
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export interface SftpCredentials {
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export class SftpProvider implements StorageProvider {
  private client: SftpClient;
  private credentials: SftpCredentials;
  private host: string;
  private port: number;

  constructor(host: string, port: number, credentials: SftpCredentials) {
    this.client = new SftpClient();
    this.host = host;
    this.port = port;
    this.credentials = credentials;
  }

  async connect(): Promise<void> {
    log.info("Connecting", {
      host: this.host,
      port: this.port,
      username: this.credentials.username,
      hasKey: !!this.credentials.privateKey,
      hasPassword: !!this.credentials.password,
    });
    try {
      await this.client.connect({
        host: this.host,
        port: this.port,
        username: this.credentials.username,
        password: this.credentials.password,
        privateKey: this.credentials.privateKey,
        passphrase: this.credentials.passphrase,
        readyTimeout: 20000,
        // Detect silently-dropped connections (NAT/firewall idle timeouts)
        // instead of hanging forever on a half-open socket.
        keepaliveInterval: SFTP_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SFTP_KEEPALIVE_COUNT_MAX,
      });
      log.info("Connected", { host: this.host, port: this.port });
    } catch (err) {
      log.error("Connection failed", { host: this.host, port: this.port, error: err });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await withTimeout(this.client.end(), "disconnect", SFTP_DISCONNECT_TIMEOUT_MS);
      log.info("Disconnected", { host: this.host });
    } catch (err) {
      log.warn("Error during disconnect — force-destroying connection", { host: this.host, error: err });
      // Tear down the underlying ssh2 client so a dead socket can't keep the
      // job waiting on a graceful end that will never come.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.client as any).client?.destroy?.();
      } catch {
        // Already dead — nothing left to clean up
      }
    }
  }

  async listFiles(remotePath: string, filter = ""): Promise<FileInfo[]> {
    log.info("Listing files", { remotePath, filter });
    try {
      const listing = await withTimeout(this.client.list(remotePath), `list ${remotePath}`, SFTP_OP_TIMEOUT_MS);
      const regex = globToRegex(filter);
      const filtered = listing
        .filter((item) => item.type === "-" && regex.test(item.name))
        .map((item) => ({
          name: item.name,
          size: item.size,
          modifiedAt: new Date(item.modifyTime),
          isDirectory: false,
        }));
      log.info("Files listed", { remotePath, total: listing.length, matched: filtered.length });
      return filtered;
    } catch (err) {
      log.error("listFiles failed", { remotePath, error: err });
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    log.info("Listing directory", { remotePath });
    try {
      const listing = await withTimeout(this.client.list(remotePath), `list ${remotePath}`, SFTP_OP_TIMEOUT_MS);
      return listing.map((item) => ({
        name: item.name,
        size: item.size,
        modifiedAt: new Date(item.modifyTime),
        isDirectory: item.type === "d",
      }));
    } catch (err) {
      log.error("listDirectory failed", { remotePath, error: err });
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Readable> {
    log.info("Downloading file (stream)", { remotePath, chunkSize: SFTP_CHUNK_SIZE, concurrentRequests: SFTP_CONCURRENT_REQUESTS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client as any).createReadStream(remotePath, {
      chunkSize: SFTP_CHUNK_SIZE,
      concurrentRequests: SFTP_CONCURRENT_REQUESTS,
      readStreamOptions: {
        highWaterMark: SFTP_CHUNK_SIZE,
      },
    }) as Readable;
  }

  async uploadFile(stream: Readable, remotePath: string, _sizeHint?: number): Promise<void> {
    // Ensure parent directory exists
    const dir = path.posix.dirname(remotePath);
    await withTimeout(this.client.mkdir(dir, true), `mkdir ${dir}`, SFTP_OP_TIMEOUT_MS).catch(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.client as any).put(stream, remotePath, {
      chunkSize: SFTP_CHUNK_SIZE,
      concurrentRequests: SFTP_CONCURRENT_REQUESTS,
      writeStreamOptions: {
        highWaterMark: SFTP_CHUNK_SIZE,
      },
    });
  }

  async deleteFile(remotePath: string): Promise<void> {
    await withTimeout(this.client.delete(remotePath), `delete ${remotePath}`, SFTP_OP_TIMEOUT_MS);
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    // Ensure destination directory exists before renaming
    const dir = path.posix.dirname(destinationPath);
    await withTimeout(this.client.mkdir(dir, true), `mkdir ${dir}`, SFTP_OP_TIMEOUT_MS).catch(() => {});
    await withTimeout(this.client.rename(sourcePath, destinationPath), `rename ${sourcePath}`, SFTP_OP_TIMEOUT_MS);
  }

  async createDirectory(remotePath: string): Promise<void> {
    log.info("Creating directory", { remotePath });
    try {
      await withTimeout(this.client.mkdir(remotePath, true), `mkdir ${remotePath}`, SFTP_OP_TIMEOUT_MS);
    } catch (err) {
      log.error("createDirectory failed", { remotePath, error: err });
      throw err;
    }
  }

  async getWorkingDirectory(): Promise<string> {
    return withTimeout(this.client.cwd(), "cwd", SFTP_OP_TIMEOUT_MS);
  }
}
