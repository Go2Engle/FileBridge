import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  ContainerClient,
} from "@azure/storage-blob";
import path from "path";
import type { StorageProvider, FileInfo } from "./interface";
import { globToRegex } from "./interface";

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
    console.log(
      `[AzureBlob] Connecting to account="${accountName}" container="${container}" ` +
        `auth=${connectionString ? "connectionString" : "accountKey"}`
    );
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
      console.error(`[AzureBlob] connect failed:`, err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    // Azure Blob SDK is stateless (HTTPS) — no persistent connection to close
  }

  async listFiles(remotePath: string, filter = "*"): Promise<FileInfo[]> {
    const prefix = toBlobPrefix(remotePath);
    console.log(`[AzureBlob] listFiles prefix="${prefix}" filter="${filter}"`);
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

      console.log(`[AzureBlob] listFiles: ${results.length} matched`);
      return results;
    } catch (err) {
      console.error(`[AzureBlob] listFiles failed for prefix="${prefix}":`, err);
      throw err;
    }
  }

  async listDirectory(remotePath: string): Promise<FileInfo[]> {
    const prefix = toBlobPrefix(remotePath);
    console.log(`[AzureBlob] listDirectory prefix="${prefix}"`);
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

      console.log(`[AzureBlob] listDirectory: ${results.length} entries`);
      return results;
    } catch (err) {
      console.error(`[AzureBlob] listDirectory failed for prefix="${prefix}":`, err);
      throw err;
    }
  }

  async downloadFile(remotePath: string): Promise<Buffer> {
    const blobName = toBlobName(remotePath);
    console.log(`[AzureBlob] downloadFile "${blobName}"`);
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
      console.error(`[AzureBlob] downloadFile failed for "${blobName}":`, err);
      throw err;
    }
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    const blobName = toBlobName(remotePath);
    console.log(`[AzureBlob] uploadFile "${blobName}" (${content.length}B)`);
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(content, content.length, {
        blobHTTPHeaders: {
          blobContentType: inferContentType(blobName),
        },
      });
    } catch (err) {
      console.error(`[AzureBlob] uploadFile failed for "${blobName}":`, err);
      throw err;
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    const blobName = toBlobName(remotePath);
    console.log(`[AzureBlob] deleteFile "${blobName}"`);
    try {
      const blobClient = this.containerClient.getBlobClient(blobName);
      await blobClient.delete();
    } catch (err) {
      console.error(`[AzureBlob] deleteFile failed for "${blobName}":`, err);
      throw err;
    }
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const srcName = toBlobName(sourcePath);
    const dstName = toBlobName(destinationPath);
    console.log(`[AzureBlob] moveFile "${srcName}" → "${dstName}"`);
    try {
      const srcClient = this.containerClient.getBlobClient(srcName);
      const dstClient = this.containerClient.getBlockBlobClient(dstName);

      // Server-side copy within the same storage account (no egress charges)
      const poller = await dstClient.beginCopyFromURL(srcClient.url);
      await poller.pollUntilDone();

      // Delete source after successful copy
      await srcClient.delete();
    } catch (err) {
      console.error(`[AzureBlob] moveFile failed "${srcName}" → "${dstName}":`, err);
      throw err;
    }
  }
}
