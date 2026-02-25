import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  ContainerClient,
} from "@azure/storage-blob";
import path from "path";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";
import { createLogger } from "@/lib/logger";

const log = createLogger("azure-blob");

export interface AzureBlobCredentials {
  accountName: string;
  accountKey?: string;
  connectionString?: string;
  container: string;
}

/**
 * Normalize a POSIX-style path to an Azure Blob prefix string.
 *
 *   "/"              → ""              (container root, no prefix)
 *   "/reports"       → "reports/"      (virtual directory)
 *   "/reports/"      → "reports/"
 *   "/reports/q1.csv"→ "reports/q1.csv"
 */
function toBlobPrefix(posixPath: string): string {
  const stripped = posixPath.replace(/^\/+/, "");
  if (!stripped) return "";
  // Paths with no file extension treated as directories → ensure trailing slash
  if (!stripped.endsWith("/") && !path.posix.extname(stripped)) {
    return stripped + "/";
  }
  return stripped;
}

function toBlobName(posixPath: string): string {
  return posixPath.replace(/^\/+/, "");
}

function inferContentType(blobName: string): string {
  const ext = path.posix.extname(blobName).toLowerCase();
  const types: Record<string, string> = {
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
  };
  return types[ext] ?? "application/octet-stream";
}

/**
 * Azure Blob Storage provider.
 *
 * Auth modes (connectionString takes priority):
 *   1. connectionString — full Azure connection string from portal
 *   2. accountName + accountKey — shared key credential
 *
 * The `host` field stores the storage account name.
 * The `container` credential field is analogous to SMB's share.
 *
 * disconnect() is a no-op — the SDK uses stateless HTTPS requests.
 * moveFile() performs a server-side copy then deletes the source blob.
 */
export class AzureBlobProvider implements StorageProvider {
  private containerClient!: ContainerClient;
  private credentials: AzureBlobCredentials;

  constructor(_host: string, _port: number, credentials: AzureBlobCredentials) {
    this.credentials = credentials;
  }

  async connect(): Promise<void> {
    const { accountName, accountKey, connectionString, container } = this.credentials;
    log.info("Connecting", {
      accountName,
      container,
      authMethod: connectionString ? "connectionString" : "accountKey",
    });
    try {
      let serviceClient: BlobServiceClient;

      if (connectionString) {
        serviceClient = BlobServiceClient.fromConnectionString(connectionString);
      } else if (accountName && accountKey) {
        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        serviceClient = new BlobServiceClient(
          `https://${accountName}.blob.core.windows.net`,
          sharedKeyCredential
        );
      } else {
        throw new Error(
          "[AzureBlob] Either connectionString or accountName+accountKey must be provided"
        );
      }

      this.containerClient = serviceClient.getContainerClient(container);
    } catch (err) {
      log.error("connect failed", { accountName, container, error: err });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    // Azure Blob SDK is stateless (HTTPS) — no persistent connection to close
  }

  async listFiles(remotePath: string, filter = ""): Promise<FileInfo[]> {
    const prefix = toBlobPrefix(remotePath);
    log.info("Listing files", { prefix, filter });
    try {
      const regex = globToRegex(filter);
      const results: FileInfo[] = [];

      for await (const item of this.containerClient.listBlobsByHierarchy("/", { prefix })) {
        if (item.kind === "prefix") continue; // skip virtual directories

        // item.name is the full blob key — slice off the prefix to get basename
        const blobName = item.name.slice(prefix.length);
        if (!blobName || blobName.includes("/")) continue; // skip nested blobs

        if (!regex.test(blobName)) continue;

        results.push({
          name: blobName,
          size: item.properties.contentLength ?? 0,
          modifiedAt: item.properties.lastModified ?? new Date(0),
          isDirectory: false,
        });
      }

      log.info("Files listed", { prefix, matched: results.length });
      return results;
    } catch (err) {
      log.error("listFiles failed", { prefix, error: err });
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const prefix = toBlobPrefix(remotePath);
    log.info("Listing directory", { prefix });
    try {
      const results: FileInfo[] = [];

      for await (const item of this.containerClient.listBlobsByHierarchy("/", { prefix })) {
        if (item.kind === "prefix") {
          // Virtual directory — strip prefix and trailing slash for display name
          const dirName = item.name.slice(prefix.length).replace(/\/$/, "");
          if (!dirName) continue;
          results.push({
            name: dirName,
            size: 0,
            modifiedAt: new Date(0),
            isDirectory: true,
          });
        } else {
          const blobName = item.name.slice(prefix.length);
          if (!blobName || blobName.includes("/")) continue;
          results.push({
            name: blobName,
            size: item.properties.contentLength ?? 0,
            modifiedAt: item.properties.lastModified ?? new Date(0),
            isDirectory: false,
          });
        }
      }

      log.info("Directory listed", { prefix, entryCount: results.length });
      return results;
    } catch (err) {
      log.error("listDirectory failed", { prefix, error: err });
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Buffer> {
    const blobName = toBlobName(remotePath);
    log.info("Downloading blob", { blobName });
    try {
      const blobClient = this.containerClient.getBlobClient(blobName);
      const response = await blobClient.download(0);

      if (!response.readableStreamBody) {
        throw new Error(`[AzureBlob] No stream body returned for "${blobName}"`);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of response.readableStreamBody) {
        // chunk may be Buffer, Uint8Array, or string depending on stream encoding
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
      }
      return Buffer.concat(chunks);
    } catch (err) {
      log.error("downloadFile failed", { blobName, error: err });
      throw err;
    }
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    const blobName = toBlobName(remotePath);
    log.info("Uploading blob", { blobName, size: content.length });
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(content, content.length, {
        blobHTTPHeaders: {
          blobContentType: inferContentType(blobName),
        },
      });
    } catch (err) {
      log.error("uploadFile failed", { blobName, error: err });
      throw err;
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    const blobName = toBlobName(remotePath);
    log.info("Deleting blob", { blobName });
    try {
      const blobClient = this.containerClient.getBlobClient(blobName);
      await blobClient.delete();
    } catch (err) {
      log.error("deleteFile failed", { blobName, error: err });
      throw err;
    }
  }

  async createDirectory(remotePath: string): Promise<void> {
    // Azure Blob has no real directories; create a zero-byte sentinel blob to
    // materialise the virtual folder so it appears in hierarchy listings.
    const blobName = toBlobName(remotePath).replace(/\/$/, "") + "/.keep";
    log.info("Creating virtual directory", { blobName });
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(Buffer.alloc(0), 0);
    } catch (err) {
      log.error("createDirectory failed", { blobName, error: err });
      throw err;
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const srcName = toBlobName(sourcePath);
    const dstName = toBlobName(destinationPath);
    log.info("Moving blob", { srcName, dstName });
    try {
      const srcClient = this.containerClient.getBlobClient(srcName);
      const dstClient = this.containerClient.getBlockBlobClient(dstName);

      // Server-side copy within the same storage account (no egress charges)
      const poller = await dstClient.beginCopyFromURL(srcClient.url);
      await poller.pollUntilDone();

      // Delete source after successful copy
      await srcClient.delete();
    } catch (err) {
      log.error("moveFile failed", { srcName, dstName, error: err });
      throw err;
    }
  }
}
