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
const SSH_WINDOW_SIZE = 16 * 1024 * 1024;  // 16 MB SSH transport window
const SSH_PACKET_SIZE = 256 * 1024;        // 256 KB max SSH packet size

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
        // ── SSH transport tuning for large-file throughput ──────────────────
        // These match settings used by high-performance SFTP clients.
        // readableHighWaterMark: buffer size for the SSH socket stream
        readableHighWaterMark: SSH_WINDOW_SIZE,
      });
      log.info("Connected", { host: this.host, port: this.port });
    } catch (err) {
      log.error("Connection failed", { host: this.host, port: this.port, error: err });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.end();
      log.info("Disconnected", { host: this.host });
    } catch (err) {
      log.warn("Error during disconnect", { host: this.host, error: err });
    }
  }

  async listFiles(remotePath: string, filter = ""): Promise<FileInfo[]> {
    log.info("Listing files", { remotePath, filter });
    try {
      const listing = await this.client.list(remotePath);
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
      const listing = await this.client.list(remotePath);
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
    await this.client.mkdir(dir, true).catch(() => {});
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
    await this.client.delete(remotePath);
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    // Ensure destination directory exists before renaming
    const dir = path.posix.dirname(destinationPath);
    await this.client.mkdir(dir, true).catch(() => {});
    await this.client.rename(sourcePath, destinationPath);
  }

  async createDirectory(remotePath: string): Promise<void> {
    log.info("Creating directory", { remotePath });
    try {
      await this.client.mkdir(remotePath, true);
    } catch (err) {
      log.error("createDirectory failed", { remotePath, error: err });
      throw err;
    }
  }

  async getWorkingDirectory(): Promise<string> {
    return this.client.cwd();
  }
}
