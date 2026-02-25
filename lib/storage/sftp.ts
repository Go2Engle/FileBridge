import SftpClient from "ssh2-sftp-client";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";
import path from "path";
import { createLogger } from "@/lib/logger";

const log = createLogger("sftp");

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

  async downloadFile(remotePath: string): Promise<Buffer> {
    const data = await this.client.get(remotePath);
    if (Buffer.isBuffer(data)) return data;
    if (typeof data === "string") return Buffer.from(data);
    // Stream case — treat as unknown to work around ssh2-sftp-client type variance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = data as unknown as NodeJS.ReadableStream;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    // Ensure parent directory exists
    const dir = path.posix.dirname(remotePath);
    await this.client.mkdir(dir, true).catch(() => {});
    await this.client.put(content, remotePath);
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
